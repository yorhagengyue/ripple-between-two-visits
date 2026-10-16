/**
 * Family-assisted reset over HTTP (track A; docs/plan/real-app.md 2.4, 3.6): the five routes as two browsers use them,
 * with the cookies each really has. His switch (/api/auth/recover/helper), his request from a phone he has used
 * (/api/auth/recover/help, by its rp_device cookie), her code (/api/family/links/[id]/reset-code), his reset
 * (/api/auth/recover/family) and 「知道了」 on the Today line (/api/auth/notice-seen). In-memory store and identity.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as noticeSeenPost } from "@/app/api/auth/notice-seen/route";
import { POST as familyPost } from "@/app/api/auth/recover/family/route";
import { POST as helpPost } from "@/app/api/auth/recover/help/route";
import { GET as helperGet, POST as helperPost } from "@/app/api/auth/recover/helper/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { GET as codeGet, POST as codePost } from "@/app/api/family/links/[id]/reset-code/route";
import { GET as meGet } from "@/app/api/me/route";
import { tokenClaims } from "@/lib/auth/jwt";
import { passwordResetNotice } from "@/lib/auth/notices";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { getMemoryStore } from "@/lib/store/memory";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";
const BASE = "http://localhost:3510";
const store = getMemoryStore();

/** A browser: keeps the cookies the answers set. */
class Browser {
  jar = new Map<string, string>();
  constructor(readonly ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {}
  keep(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...rest] = pair.split("=");
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.jar.delete(name.trim());
      else this.jar.set(name.trim(), rest.join("="));
    }
    return res;
  }
  req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
    const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", "x-forwarded-for": this.ip, ...(init.headers ?? {}) };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    return new NextRequest(`${BASE}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  }
  userId(): string {
    return tokenClaims(this.jar.get("rp_at")!).userId!;
  }
}

async function signUp(b: Browser, space: "blank" | "none", name: string): Promise<string> {
  const login = `r${randomUUID().slice(0, 9)}`;
  const res = b.keep(
    await signupPost(
      b.req("/api/auth/signup", {
        body: {
          login,
          password: PASSWORD,
          display_name: name,
          locale: "zh-Hans",
          assisted: false,
          consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
          space,
        },
      }),
    ),
  );
  expect(res.status).toBe(201);
  return login;
}

/** His phone and hers, signed up and linked (active); the switch off. */
async function pair(): Promise<{ his: Browser; hers: Browser; login: string; linkId: string }> {
  const his = new Browser();
  const hers = new Browser();
  const login = await signUp(his, "blank", "陈先生");
  await signUp(hers, "none", "Wei Ling");
  const hash = `h-${randomUUID()}`;
  const inv = await store.createInvite({ patient_id: his.userId(), relation: "daughter", family_label: "Wei Ling", patient_label: "爸爸", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  if (!inv.ok) throw new Error("invite");
  await store.acceptInvite(hash, hers.userId());
  await store.confirmLink(inv.link.id, his.userId(), true);
  return { his, hers, login, linkId: inv.link.id };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => [res.status, await res.json()] as const;

describe("the whole path over HTTP, two browsers", () => {
  it("he turns it on, logs out of nothing, asks on his phone; she reads him the code; he resets; his old sign-in is over", async () => {
    const { his, hers, login, linkId } = await pair();

    // his switch: off to start with, then on
    expect(await json(await helperGet(his.req("/api/auth/recover/helper")))).toEqual([200, { helpers: [{ link_id: linkId, label: "Wei Ling", relation: "daughter", on: false }] }]);
    expect(await json(await codeGet(hers.req(`/api/family/links/${linkId}/reset-code`), ctx(linkId)))).toEqual([200, { enabled: false, pending: false, expires_at: null }]);
    const on = await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true, locale: "zh-Hans" } }));
    expect(await json(on)).toEqual([200, { helper: { link_id: linkId, label: "Wei Ling", relation: "daughter", on: true } }]);
    expect(on.headers.get("cache-control")).toBe("private, no-store");

    // a copy of his sign-in cookies, as his other browser would hold them
    const oldCookies = new Browser(his.ip);
    oldCookies.jar = new Map(his.jar);

    // signed out on his phone (only the device cookie is left), he asks for help
    const phone = new Browser(his.ip);
    phone.jar.set("rp_device", his.jar.get("rp_device")!);
    const asked = await helpPost(phone.req("/api/auth/recover/help", { body: { login } }));
    const askedBody = (await asked.json()) as { expires_at: string; helpers: string[] };
    expect(asked.status).toBe(200);
    expect(askedBody.helpers).toEqual(["Wei Ling"]);
    expect(Date.parse(askedBody.expires_at) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(askedBody.expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    // her page sees it, she taps 帮
    expect(await json(await codeGet(hers.req(`/api/family/links/${linkId}/reset-code`), ctx(linkId)))).toEqual([200, { enabled: true, pending: true, expires_at: askedBody.expires_at }]);
    const given = await codePost(hers.req(`/api/family/links/${linkId}/reset-code`, { body: {} }), ctx(linkId));
    const { code } = (await given.json()) as { code: string; expires_at: string };
    expect(given.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);

    // typed on her phone, with his login: refused, and she is not signed in as him
    const onHers = await familyPost(hers.req("/api/auth/recover/family", { body: { login, code, password: NEW_PASSWORD } }));
    expect(await json(onHers)).toEqual([401, { error: "invalid_family_code" }]);
    expect(onHers.headers.getSetCookie().some((c) => c.startsWith("rp_at="))).toBe(false);
    // typed on a browser he never used
    expect((await familyPost(new Browser().req("/api/auth/recover/family", { body: { login, code, password: NEW_PASSWORD } }))).status).toBe(401);

    // typed on his phone: in, with new cookies
    const done = phone.keep(await familyPost(phone.req("/api/auth/recover/family", { body: { login, code, password: NEW_PASSWORD } })));
    expect(await json(done)).toEqual([200, { next: "/onboard", helper: "Wei Ling" }]);
    expect(phone.jar.get("rp_at")).toBeTruthy();
    expect((await meGet(phone.req("/api/me"))).status).toBe(200);
    // his earlier sign-in no longer works; her own still does
    expect((await meGet(oldCookies.req("/api/me"))).status).toBe(401);
    expect((await meGet(hers.req("/api/me"))).status).toBe(200);
    // the old password is refused, the new one accepted
    expect((await loginPost(new Browser().req("/api/auth/login", { body: { login, password: PASSWORD } }))).status).toBe(401);
    expect((await loginPost(new Browser().req("/api/auth/login", { body: { login, password: NEW_PASSWORD } }))).status).toBe(200);
    // the switch is as he left it
    expect(await json(await helperGet(phone.req("/api/auth/recover/helper")))).toEqual([200, { helpers: [{ link_id: linkId, label: "Wei Ling", relation: "daughter", on: true }] }]);

    // his Today line says who helped, until he taps 知道了
    const events = await store.listAccountEvents(phone.userId());
    const notice = passwordResetNotice(events, Date.now(), "zh-Hans");
    expect(notice?.text).toContain("由 Wei Ling 协助重设");
    expect(await json(await noticeSeenPost(phone.req("/api/auth/notice-seen", { body: { event: notice!.event } })))).toEqual([200, { ok: true }]);
    expect(await json(await noticeSeenPost(phone.req("/api/auth/notice-seen", { body: { event: notice!.event } })))).toEqual([200, { ok: true }]);
    const after = await store.listAccountEvents(phone.userId());
    expect(after.filter((e) => e.kind === "reset_notice_seen")).toHaveLength(1);
    expect(passwordResetNotice(after, Date.now(), "zh-Hans")).toBeNull();
  });
});

describe("what each route refuses", () => {
  it("his switch: signed out 401; another person's link 404; a cross-site post 403; a bad body 400", async () => {
    const { his, hers, linkId } = await pair();
    expect((await helperGet(new Browser().req("/api/auth/recover/helper"))).status).toBe(401);
    expect((await helperPost(new Browser().req("/api/auth/recover/helper", { body: { link_id: linkId, on: true } }))).status).toBe(401);
    expect(await json(await helperPost(hers.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true } })))).toEqual([404, { error: "link_not_found" }]);
    expect((await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true }, headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: "nope", on: true } }))).status).toBe(400);
    expect((await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: "yes" } }))).status).toBe(400);
    expect((await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true, patient_id: hers.userId() } }))).status).toBe(400);
    expect((await store.getCareLink(linkId))!.reset_helper).toBe(false);
    // her list is her own: she has no family members of hers
    expect(await json(await helperGet(hers.req("/api/auth/recover/helper")))).toEqual([200, { helpers: [] }]);
  });

  it("asking for help: one 403 for a browser without his device cookie, an unknown login, or the switch off; nothing is made", async () => {
    const { his, login, linkId } = await pair();
    const phone = new Browser(his.ip);
    phone.jar.set("rp_device", his.jar.get("rp_device")!);
    // the switch is still off
    expect(await json(await helpPost(phone.req("/api/auth/recover/help", { body: { login } })))).toEqual([403, { error: "help_unavailable" }]);
    await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true } }));
    const noCookie = await helpPost(new Browser().req("/api/auth/recover/help", { body: { login } }));
    expect(await json(noCookie)).toEqual([403, { error: "help_unavailable" }]);
    expect(await json(await helpPost(phone.req("/api/auth/recover/help", { body: { login: "nobody-here-1" } })))).toEqual([403, { error: "help_unavailable" }]);
    const forged = new Browser();
    forged.jar.set("rp_device", "A".repeat(32)); // a well-formed id that is not one of his phones
    expect((await helpPost(forged.req("/api/auth/recover/help", { body: { login } }))).status).toBe(403);
    expect(await store.listResetRequests(his.userId())).toEqual([]);
    expect((await helpPost(phone.req("/api/auth/recover/help", { body: { login }, headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await helpPost(phone.req("/api/auth/recover/help", { body: { login, device: "x" } }))).status).toBe(400);
    expect((await helpPost(phone.req("/api/auth/recover/help", { body: { login } }))).status).toBe(200);
  });

  it("her code: signed out 401; not her link 404; he cannot take it himself; three a day then 429 with Retry-After", async () => {
    const { his, hers, login, linkId } = await pair();
    await helperPost(his.req("/api/auth/recover/helper", { body: { link_id: linkId, on: true } }));
    const phone = new Browser(his.ip);
    phone.jar.set("rp_device", his.jar.get("rp_device")!);
    expect((await helpPost(phone.req("/api/auth/recover/help", { body: { login } }))).status).toBe(200);
    const path = `/api/family/links/${linkId}/reset-code`;
    expect((await codeGet(new Browser().req(path), ctx(linkId))).status).toBe(401);
    expect((await codePost(new Browser().req(path, { body: {} }), ctx(linkId))).status).toBe(401);
    expect(await json(await codePost(his.req(path, { body: {} }), ctx(linkId)))).toEqual([404, { error: "link_not_found" }]);
    const stranger = new Browser();
    await signUp(stranger, "none", "Someone");
    expect(await json(await codePost(stranger.req(path, { body: {} }), ctx(linkId)))).toEqual([404, { error: "link_not_found" }]);
    expect((await codePost(hers.req(path, { body: {}, headers: { origin: "https://evil.example" } }), ctx(linkId))).status).toBe(403);
    for (let i = 1; i <= 3; i++) expect((await codePost(hers.req(path, { body: {} }), ctx(linkId))).status).toBe(200);
    const over = await codePost(hers.req(path, { body: {} }), ctx(linkId));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe("too_many");
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(23 * 3600);
  });

  it("「知道了」: signed out 401; only one of his own password resets (404 otherwise)", async () => {
    const { his, hers } = await pair();
    expect((await noticeSeenPost(new Browser().req("/api/auth/notice-seen", { body: { event: "evt-x" } }))).status).toBe(401);
    expect(await json(await noticeSeenPost(his.req("/api/auth/notice-seen", { body: { event: "evt-x" } })))).toEqual([404, { error: "not_found" }]);
    const reset = await store.addAccountEvent(his.userId(), "password_reset", { method: "recovery_code" });
    const signup = (await store.listAccountEvents(his.userId())).find((e) => e.kind === "signup")!;
    expect((await noticeSeenPost(his.req("/api/auth/notice-seen", { body: { event: signup.id } }))).status).toBe(404); // not a reset
    expect((await noticeSeenPost(hers.req("/api/auth/notice-seen", { body: { event: reset.id } }))).status).toBe(404); // not hers
    expect((await noticeSeenPost(his.req("/api/auth/notice-seen", { body: {} }))).status).toBe(400);
    expect((await noticeSeenPost(his.req("/api/auth/notice-seen", { body: { event: reset.id } }))).status).toBe(200);
    expect((await store.listAccountEvents(hers.userId())).some((e) => e.kind === "reset_notice_seen")).toBe(false);
  });
});
