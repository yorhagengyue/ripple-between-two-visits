/**
 * Where a signed-in person's /p page lands (lib/guard/landing.ts, lib/subject/landing.ts, web/proxy.ts; track L;
 * real-app 3.7 页面跳转): /onboard until he is set up, /f when he has no space of his own; the demo is untouched.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { isPatientPage, landingFor, OPEN_WHILE_ONBOARDING, openWhileOnboarding } from "@/lib/guard/landing";
import { getMemoryStore } from "@/lib/store/memory";
import { DONE_MEMO_MS, forgetLanders, landerOf, landingRedirect } from "@/lib/subject/landing";
import { proxy } from "@/proxy";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const login = () => `l${randomUUID().slice(0, 10)}`;

function req(p: string, cookies: Record<string, string> = {}, method = "GET"): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost${p}`, { method, headers: cookie ? { cookie } : {} });
}
const at = (a: TestAccount) => ({ rp_at: a.tokens.access_token });
const settingUp = () => createAccountWithSpace(store, getAuthProvider(), { login: login(), password: PASSWORD, space: "blank", onboarding: "started" });
const setUp = () => createAccountWithSpace(store, getAuthProvider(), { login: login(), password: PASSWORD, space: "blank" });
const familyOnly = () => createAccountWithSpace(store, getAuthProvider(), { login: login(), password: PASSWORD, space: "none" });

async function where(p: string, cookies: Record<string, string>, method = "GET"): Promise<string | number> {
  const res = await proxy(req(p, cookies, method));
  if (res.status !== 307) return res.status;
  const loc = new URL(res.headers.get("location")!);
  return `${loc.pathname}${loc.search}`;
}

beforeEach(() => forgetLanders());

describe("the rule", () => {
  it("his pages are /p and everything under it", () => {
    for (const p of ["/p", "/p/today", "/p/me/devices"]) expect(isPatientPage(p), p).toBe(true);
    for (const p of ["/", "/f", "/onboard", "/pp", "/privacy", "/api/doses", "/print"]) expect(isPatientPage(p), p).toBe(false);
  });

  it("not set up: /onboard, except the two parts setting up itself hands him to", () => {
    const started = { kind: "self", onboarding: "started" } as const;
    for (const p of ["/p", "/p/today", "/p/bp", "/p/ask", "/p/visit", "/p/me", "/p/me/devices", "/p/profile", "/p/questions", "/p/medsx", "/p/familyx"]) expect(landingFor(p, started), p).toBe("/onboard");
    expect(OPEN_WHILE_ONBOARDING).toEqual(["/p/meds", "/p/family"]);
    for (const p of ["/p/meds", "/p/meds/add", "/p/meds/med-1", "/p/family", "/p/family/invite", "/p/family/abc"]) {
      expect(openWhileOnboarding(p), p).toBe(true);
      expect(landingFor(p, started), p).toBeNull();
    }
    expect(landingFor("/p/today", { kind: "self", onboarding: null })).toBe("/onboard");
  });

  it("set up: nowhere; a family member with no space: /f from every /p page; nobody we know: left to the page", () => {
    for (const p of ["/p/today", "/p/meds/add", "/p/family"]) {
      expect(landingFor(p, { kind: "self", onboarding: "done" }), p).toBeNull();
      expect(landingFor(p, { kind: "family_only" }), p).toBe("/f");
      expect(landingFor(p, { kind: "nobody" }), p).toBeNull();
    }
  });

  it("only /p pages are ever sent anywhere", () => {
    for (const who of [{ kind: "self", onboarding: "started" }, { kind: "family_only" }] as const) {
      for (const p of ["/onboard", "/onboard/who", "/f", "/f/week", "/login", "/demo", "/api/doses", "/"]) expect(landingFor(p, who), p).toBeNull();
    }
  });
});

describe("who he is, from the store", () => {
  it("his space and its onboarding; no space but an account: family only; no account: nobody", async () => {
    const a = await settingUp();
    expect(await landerOf(a.userId)).toEqual({ kind: "self", onboarding: "started" });
    expect(await landerOf((await setUp()).userId)).toEqual({ kind: "self", onboarding: "done" });
    expect(await landerOf((await familyOnly()).userId)).toEqual({ kind: "family_only" });
    expect(await landerOf(randomUUID())).toEqual({ kind: "nobody" });
  });

  it("finishing onboarding opens his pages at once; 'done' is remembered for a few seconds of real time", async () => {
    const a = await settingUp();
    const t = 1_000_000;
    expect(await landerOf(a.userId, store, t)).toEqual({ kind: "self", onboarding: "started" });
    await store.updateScope(a.userId, { onboarding: "done" });
    expect(await landerOf(a.userId, store, t + 1)).toEqual({ kind: "self", onboarding: "done" });
    // remembered: a row that went back to "started" (the example data cleared) is read again once the memo is over
    await store.updateScope(a.userId, { onboarding: "started" });
    expect(await landerOf(a.userId, store, t + DONE_MEMO_MS)).toEqual({ kind: "self", onboarding: "done" });
    expect(await landerOf(a.userId, store, t + DONE_MEMO_MS + 2)).toEqual({ kind: "self", onboarding: "started" });
    expect(DONE_MEMO_MS).toBeLessThanOrEqual(15_000);
  });

  it("a store that cannot be read sends nobody anywhere", async () => {
    const a = await settingUp();
    const broken = {
      getSession: async () => {
        throw new Error("unreachable");
      },
      getAccount: async () => null,
    };
    expect(await landingRedirect(req("/p/today", at(a)), a.tokens.access_token, broken)).toBeNull();
    expect((await landingRedirect(req("/p/today", at(a)), a.tokens.access_token))?.status).toBe(307);
  });
});

describe("through the proxy", () => {
  it("an account that is still setting up: every /p page goes to /onboard, without the page's own query", async () => {
    const a = await settingUp();
    expect(await where("/p/today", at(a))).toBe("/onboard");
    expect(await where("/p/bp?remind=bp&_rsc=abc", at(a))).toBe("/onboard");
    expect(await where("/p/me/devices", at(a))).toBe("/onboard");
    expect(await where("/p", at(a))).toBe("/onboard");
    const res = await proxy(req("/p/today", at(a)));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("the pages setting up sends him to stay open, and so do the setting-up screens themselves", async () => {
    const a = await settingUp();
    for (const p of ["/p/meds/add?from=onboard", "/p/meds", "/p/family", "/p/family/invite", "/onboard", "/onboard/meds"]) expect(await where(p, at(a)), p).toBe(200);
  });

  it("once he is set up his pages open (the moment onboarding is done)", async () => {
    const a = await settingUp();
    expect(await where("/p/today", at(a))).toBe("/onboard");
    await store.updateScope(a.userId, { onboarding: "done" });
    expect(await where("/p/today", at(a))).toBe(200);
    expect(await where("/p/today", at(await setUp()))).toBe(200);
  });

  it("someone who is only a family member: every /p page goes to /f", async () => {
    const her = await familyOnly();
    for (const p of ["/p/today", "/p/meds/add", "/p/family", "/p/me/devices"]) expect(await where(p, at(her)), p).toBe("/f");
    for (const p of ["/f", "/f/week", "/invite/some-token"]) expect(await where(p, at(her)), p).toBe(200);
  });

  it("only page requests: an API answers as before, a POST is never redirected", async () => {
    const a = await settingUp();
    expect(await where("/api/doses", at(a))).toBe(200);
    expect(await where("/api/profile/onboard", at(a))).toBe(200);
    expect(await where("/p/today", at(a), "POST")).toBe(200);
  });

  it("the demo is the demo's: a sandbox phone, and a signed-in browser that names the demo, are not sent to /onboard or /f", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const member = await store.addMember(s.id, { role: "patient" });
    const phone = { rp_session: s.id, rp_member: member.id, rp_role: "patient" };
    expect(await where("/p/today", phone)).toBe(200);
    const a = await settingUp();
    const her = await familyOnly();
    // looking at the demo (rp_view=demo) with the account cookie still there
    expect(await where("/p/today", { ...phone, rp_view: "demo", ...at(a) })).toBe(200);
    expect(await where("/p/today", { ...phone, rp_view: "demo", ...at(her) })).toBe(200);
    // the same browser back on its own account (no rp_view): the account's rule
    expect(await where("/p/today", { ...phone, ...at(a) })).toBe("/onboard");
    expect(await where("/p/today", { ...phone, ...at(her) })).toBe("/f");
  });

  it("nobody signed in still goes to the login, not to /onboard", async () => {
    expect(await where("/p/today", {})).toBe("/login?next=%2Fp%2Ftoday");
  });
});
