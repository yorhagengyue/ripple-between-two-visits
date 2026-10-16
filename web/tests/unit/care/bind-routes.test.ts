/**
 * The two routes of binding by account (line bind): POST /api/family/bind and POST /api/family/bind/seen, called as the
 * browser calls them. What they answer in each case, that nothing answers with the token or its hash, the limit with
 * its Retry-After, FAMILY_BIND_MODE=confirm handing the link to the invitation flow's own 「是她」, and 「知道了」.
 * The flow itself is in bind.test.ts.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as bindPost } from "@/app/api/family/bind/route";
import { POST as seenPost } from "@/app/api/family/bind/seen/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { GET as linksGet } from "@/app/api/family/links/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { linkAcknowledged } from "@/lib/care/ack";
import { DIRECT_GRANTS } from "@/lib/care/bind";
import type { FamilyLinkView, PatientLinkView } from "@/lib/care/types";
import { NO_GRANTS } from "@/lib/family/types";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const elder = (display = "陈先生") => createAccountWithSpace(store, getAuthProvider(), { login: login("t"), password: PASSWORD, space: "example", display_name: display });
const family = (display = "Wei Ling") => createAccountWithSpace(store, getAuthProvider(), { login: login("w"), password: PASSWORD, space: "none", display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const shown = (a: TestAccount) => (a.login.kind === "username" ? a.login.username : a.login.email);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(p: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: body === undefined ? "GET" : "POST", headers, body });
}
const bind = (who: TestAccount | null, body: unknown, headers?: Record<string, string>) => bindPost(req("/api/family/bind", { token: who ? t(who) : undefined, body, headers }));
const seen = (who: TestAccount | null, body: unknown) => seenPost(req("/api/family/bind/seen", { token: who ? t(who) : undefined, body }));

interface Answer {
  link: (FamilyLinkView & PatientLinkView) | undefined;
  role: string;
  made: boolean;
  state: string;
  next: string;
}

describe("POST /api/family/bind", () => {
  it("she types his account: 200 with her side of the link and where to go; nothing answers with the token", async () => {
    const him = await elder();
    const her = await family();
    const res = await bind(her, { account: shown(him), label: "爸爸" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text) as Answer;
    const id = body.link!.id;
    expect(body).toEqual({
      link: { id, state: "active", patientLabel: "爸爸", relation: null, acceptedAt: expect.any(String), confirmedAt: expect.any(String), endedAt: null },
      role: "family",
      made: true,
      state: "active",
      next: `/f?link=${id}`,
    });
    // the token was thrown away: neither it nor its hash is in the answer, and the stored row has none left
    expect(text).not.toMatch(/token|hash|[0-9a-f]{64}/i);
    expect((await store.getCareLink(id))?.invite_token_hash).toBeNull();
    // her home opens at once, with the four default sections and without his words
    const home = (await (await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }))).json()) as { grants: unknown; visitsShared: boolean; notesShared: boolean };
    expect(home.grants).toEqual(DIRECT_GRANTS);
    expect(home).toMatchObject({ visitsShared: false, notesShared: false });

    // the same request again: the link that is there
    const again = (await (await bind(her, { account: shown(him) })).json()) as Answer;
    expect(again).toMatchObject({ made: false, state: "active", next: `/f?link=${id}`, link: { id, patientLabel: "爸爸" } });
    expect(await store.listCareLinks({ patient_id: him.userId })).toHaveLength(1);
  });

  it("he types her account: 200 with his side of the link (the four switches on) and his switches page", async () => {
    const him = await elder();
    const her = await family();
    const res = await bind(him, { account: `  ${shown(her)}  ` });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Answer;
    const id = body.link!.id;
    expect(body).toMatchObject({ role: "patient", made: true, state: "active", next: `/p/family/${id}` });
    expect(body.link).toMatchObject({ id, state: "active", familyLabel: "Wei Ling", patientLabel: "陈先生", relation: null, items: DIRECT_GRANTS, version: 1, her: { displayName: "Wei Ling", username: her.account.username } });
    expect(text).not.toMatch(/token|hash|[0-9a-f]{64}/i);
    // her own list shows it, in force
    const hers = ((await (await linksGet(req("/api/family/links", { token: t(her) }))).json()) as { family: FamilyLinkView[] }).family;
    expect(hers.map((l) => [l.id, l.state])).toEqual([[id, "active"]]);
  });

  it("signed out, a body that is not the shape, an account that is not there, his own, two of a kind", async () => {
    const him = await elder();
    const other = await elder("林女士");
    const her = await family();
    const sister = await family("Hui Min");
    const anon = await bind(null, { account: shown(him) });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "not_signed_in" });
    for (const bad of [{}, { account: "" }, { account: "   " }, { account: "x".repeat(255) }, { account: shown(him), label: "x".repeat(41) }, { account: shown(him), more: 1 }, { account: 7 }]) {
      const res = await bind(her, bad);
      expect(res.status, JSON.stringify(bad).slice(0, 40)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
    }
    expect((await bindPost(req("/api/family/bind", { token: t(her), raw: "{not json" }))).status).toBe(400);

    const missing = await bind(her, { account: `nobody-${login("x")}` });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "account_not_found" });
    const notALogin = await bind(her, { account: "not a login" });
    expect([notALogin.status, await notALogin.json()]).toEqual([404, { error: "account_not_found" }]);

    const self = await bind(her, { account: shown(her) });
    expect([self.status, await self.json()]).toEqual([409, { error: "bind_self" }]);
    const twoFamily = await bind(her, { account: shown(sister) });
    expect([twoFamily.status, await twoFamily.json()]).toEqual([409, { error: "bind_wrong_kind", detail: "both_family" }]);
    const twoElders = await bind(him, { account: shown(other) });
    expect([twoElders.status, await twoElders.json()]).toEqual([409, { error: "bind_wrong_kind", detail: "both_elder" }]);

    expect(await store.listCareLinks({ patient_id: him.userId })).toEqual([]);
    expect(await store.listCareLinks({ family_id: her.userId })).toEqual([]);
  });

  it("the eleventh try of one person in an hour is 429 with when it opens again and Retry-After", async () => {
    const saved = { ...process.env };
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.RIPPLE_DEV_TOOLS = "0";
    process.env.TRUSTED_PROXY_HOPS = "1"; // X-Forwarded-For is believed only behind a proxy of ours (lib/guard/client-ip.ts)
    try {
      const him = await elder();
      const her = await family();
      const from = (n: number) => ({ "x-forwarded-for": `10.40.${Math.floor(Math.random() * 250)}.${n}` });
      for (let i = 1; i <= 10; i++) expect((await bind(her, { account: `nobody-${login("x")}` }, from(i))).status, String(i)).toBe(404);
      const over = await bind(her, { account: shown(him) }, from(99));
      expect(over.status).toBe(429);
      const body = (await over.json()) as { error: string; until: string };
      expect(body.error).toBe("too_many");
      expect(Date.parse(body.until)).toBeGreaterThan(Date.now() + 3500_000);
      expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(3500);
      // nothing was bound by the refused request
      expect(await store.listCareLinks({ patient_id: him.userId })).toEqual([]);
      // signed out is 401 before any counting, and another person from the same address is not limited by her count
      expect((await bind(null, { account: shown(him) }, from(99))).status).toBe(401);
      expect((await bind(await family("Hui Min"), { account: shown(him) }, from(99))).status).toBe(200);
    } finally {
      process.env = saved;
    }
  });

  it("FAMILY_BIND_MODE=confirm: her link waits, his 「是她」 is the invitation flow's own, and then she is in", async () => {
    const saved = process.env.FAMILY_BIND_MODE;
    process.env.FAMILY_BIND_MODE = "confirm";
    try {
      const him = await elder();
      const her = await family();
      const body = (await (await bind(her, { account: shown(him) })).json()) as Answer;
      const id = body.link!.id;
      expect(body).toMatchObject({ role: "family", made: true, state: "accepted", next: `/f?link=${id}`, link: { id, state: "accepted" } });
      // she sees nothing yet, exactly as after accepting an invitation
      const waiting = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
      expect([waiting.status, await waiting.json()]).toEqual([403, { error: "link_not_active" }]);
      // his card: who it is, by her name and her account
      const mine = ((await (await linksGet(req("/api/family/links", { token: t(him) }))).json()) as { patient: PatientLinkView[] }).patient.find((l) => l.id === id)!;
      expect(mine).toMatchObject({ state: "accepted", familyLabel: "Wei Ling", items: NO_GRANTS, her: { displayName: "Wei Ling", username: her.account.username } });
      // typing again changes nothing; 「知道了」 is not the answer to a link that waits
      expect((await (await bind(her, { account: shown(him) })).json()) as Answer).toMatchObject({ made: false, state: "accepted" });
      expect((await seen(him, { link: id })).status).toBe(409);
      // 「是她」
      expect((await confirmPost(req(`/api/family/links/${id}/confirm`, { token: t(him), body: { yes: true } }), params(id))).status).toBe(200);
      const home = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
      expect(home.status).toBe(200);
      expect(((await home.json()) as { grants: unknown }).grants).toEqual(NO_GRANTS);
      expect(await linkAcknowledged(store, { id, patient_id: him.userId })).toBe(true);
      // he, typing her account in confirm mode, binds at once
      const sister = await family("Hui Min");
      expect((await (await bind(him, { account: shown(sister) })).json()) as Answer).toMatchObject({ role: "patient", made: true, state: "active" });
    } finally {
      if (saved === undefined) delete process.env.FAMILY_BIND_MODE;
      else process.env.FAMILY_BIND_MODE = saved;
    }
  });
});

describe("POST /api/family/bind/seen", () => {
  const shares = async (him: TestAccount, id: string) => (await store.listConsentRecords(him.userId, { kind: "family_share" })).filter((r) => (r.evidence as { link_id?: string })?.link_id === id);

  it("「知道了」: 200, his record names the link, once", async () => {
    const him = await elder();
    const her = await family();
    const id = ((await (await bind(her, { account: shown(him) })).json()) as Answer).link!.id;
    expect(await linkAcknowledged(store, { id, patient_id: him.userId })).toBe(false);
    const first = await seen(him, { link: id });
    expect([first.status, await first.json()]).toEqual([200, { ok: true }]);
    expect((await shares(him, id)).map((r) => [r.decision, r.method, r.assisted])).toEqual([["granted", "direct_bind_ack", false]]);
    expect(await linkAcknowledged(store, { id, patient_id: him.userId })).toBe(true);
    const second = await seen(him, { link: id, assisted: true });
    expect([second.status, await second.json()]).toEqual([200, { ok: true }]);
    expect(await shares(him, id)).toHaveLength(1);
  });

  it("someone is helping him on his device right now: the record says so", async () => {
    const him = await elder();
    const her = await family();
    const id = ((await (await bind(her, { account: shown(him) })).json()) as Answer).link!.id;
    expect((await seen(him, { link: id, assisted: true })).status).toBe(200);
    expect((await shares(him, id))[0]).toMatchObject({ method: "direct_bind_ack", assisted: true });
  });

  it("only he, for his own link in force: she gets 404, another elder 404, an ended link 409, a wrong body 400", async () => {
    const him = await elder();
    const other = await elder("林女士");
    const her = await family();
    const id = ((await (await bind(her, { account: shown(him) })).json()) as Answer).link!.id;
    expect((await seen(her, { link: id })).status).toBe(404);
    const stranger = await seen(other, { link: id });
    expect([stranger.status, await stranger.json()]).toEqual([404, { error: "link_not_found" }]);
    expect([400, 401]).toContain((await seen(null, { link: id })).status);
    for (const bad of [{}, { link: "" }, { link: id, more: 1 }, { link_id: id }]) expect((await seen(him, bad)).status, JSON.stringify(bad).slice(0, 30)).toBe(400);
    expect((await seen(him, { link: randomUUID() })).status).toBe(404);
    expect(await shares(him, id)).toEqual([]);
    // 「不认识这个人，解除」 is the existing stop: her next read is refused, and 「知道了」 no longer grants anything
    expect((await revokePost(req(`/api/family/links/${id}/revoke`, { token: t(him), body: {} }), params(id))).status).toBe(200);
    expect((await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }))).status).toBe(403);
    const late = await seen(him, { link: id });
    expect([late.status, await late.json()]).toEqual([409, { error: "link_closed" }]);
    // round two: he never gave a consent for this link, so the stop withdraws none; his account says what he did
    expect(await shares(him, id)).toEqual([]);
    expect((await store.listAccountEvents(him.userId)).filter((e) => e.kind === "family_bound_removed").map((e) => e.detail)).toEqual([{ link_id: id }]);
  });
});

describe("after he removed her (round two)", () => {
  it("her own binding is 403 bind_removed with nothing but the code; his binding her is 200, and then her typing finds that link", async () => {
    const him = await elder();
    const her = await family();
    const id = ((await (await bind(her, { account: shown(him) })).json()) as Answer).link!.id;
    expect((await revokePost(req(`/api/family/links/${id}/revoke`, { token: t(him), body: {} }), params(id))).status).toBe(200);

    const refused = await bind(her, { account: shown(him), label: "爸爸" });
    expect([refused.status, await refused.json()]).toEqual([403, { error: "bind_removed" }]);
    expect((await store.listCareLinks({ patient_id: him.userId })).map((l) => l.status)).toEqual(["revoked"]);
    // his own act: he types her account
    const his = (await (await bind(him, { account: shown(her) })).json()) as Answer;
    expect(his).toMatchObject({ role: "patient", made: true, state: "active" });
    const now = his.link!.id;
    expect(now).not.toBe(id);
    expect(await linkAcknowledged(store, { id: now, patient_id: him.userId })).toBe(true);
    expect((await (await bind(her, { account: shown(him) })).json()) as Answer).toMatchObject({ role: "family", made: false, state: "active", next: `/f?link=${now}`, link: { id: now } });
    // another family member of his was never removed
    expect((await bind(await family("Hui Min"), { account: shown(him) })).status).toBe(200);
  });
});
