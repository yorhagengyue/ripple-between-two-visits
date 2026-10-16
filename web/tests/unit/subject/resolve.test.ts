/**
 * Who a request is for (lib/subject; C2 F1, real-app 3.7, H1): the demo path for demo rows only, an account from a
 * verified sign-in token, her care link into his space read-only, and a store bound to the one scope it was given.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider, MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { requireDemoSubject, requireSubject, ScopeViolation, scopedStore } from "@/lib/subject";
import { selfSubject } from "@/lib/subject/resolve";

const store = getMemoryStore();
const auth = () => getAuthProvider() as MemoryAuthProvider;

function req(p: string, cookies: Record<string, string> = {}, init: { method?: string } = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost${p}`, { method: init.method ?? "GET", headers: cookie ? { cookie } : {} });
}

async function account(space: "blank" | "example" | "none" = "blank"): Promise<TestAccount> {
  return createAccountWithSpace(store, auth(), { login: `u${randomUUID().slice(0, 12)}`, password: "correct horse battery", space });
}

const body = async (r: Response) => ({ status: r.status, text: await r.text() });

describe("the demo path", () => {
  it("?session= and rp_session name a demo session as before; nothing at all is 400 no_session", async () => {
    const s = await store.createSession({ ttl_hours: 1 });
    const viaQuery = await requireSubject(req(`/api/doses?session=${s.id}`));
    expect(viaQuery.ok && viaQuery.subject).toMatchObject({ kind: "demo", relation: "demo", userId: null, scope: { id: s.id } });
    const viaCookie = await requireSubject(req("/api/doses", { rp_session: s.id }));
    expect(viaCookie.ok && viaCookie.session.id).toBe(s.id);
    const none = await requireSubject(req("/api/doses"));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(await body(none.res)).toEqual({ status: 400, text: JSON.stringify({ error: "no_session" }) });
  });

  it("an account's id on the demo path is the same 404 as an id that does not exist (H1)", async () => {
    const a = await account();
    for (const named of [(id: string) => req(`/api/doses?session=${id}`), (id: string) => req("/api/doses", { rp_session: id })]) {
      const acc = await requireSubject(named(a.userId));
      const nope = await requireSubject(named(randomUUID()));
      expect(acc.ok || nope.ok).toBe(false);
      if (!acc.ok && !nope.ok) expect(await body(acc.res)).toEqual(await body(nope.res));
      if (!acc.ok) expect(acc.res.status).toBe(404);
    }
    // the demo's way in never sees it either
    const { demoEntryStore } = await import("@/lib/subject");
    expect(await demoEntryStore(store).getSession(a.userId)).toBeNull();
  });
});

describe("the account path", () => {
  let him: TestAccount;
  beforeAll(async () => {
    him = await account();
  });

  it("a verified token gives his own scope, today computed, through a store bound to it", async () => {
    const found = await requireSubject(req("/api/doses", { rp_at: him.tokens.access_token }));
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.subject).toMatchObject({ kind: "account", relation: "self", userId: him.userId, link: null });
    expect(found.session).toMatchObject({ id: him.userId, kind: "account", story_day: 0 });
    expect(found.store.scopeId).toBe(him.userId);
    expect(found.store.mode).toBe("self");
    // the token wins over a demo cookie left in the browser, unless the browser is looking at the demo (rp_view)
    const s = await store.createSession({ ttl_hours: 1 });
    const both = await requireSubject(req("/api/doses", { rp_at: him.tokens.access_token, rp_session: s.id }));
    expect(both.ok && both.subject.kind).toBe("account");
    const demoView = await requireSubject(req("/api/doses", { rp_at: him.tokens.access_token, rp_session: s.id, rp_view: "demo" }));
    expect(demoView.ok && demoView.subject.kind).toBe("demo");
    // a demo-only route answers an account 404 (H2, H5)
    const demoOnly = await requireDemoSubject(req("/api/clock", { rp_at: him.tokens.access_token }));
    expect(demoOnly.ok).toBe(false);
    if (!demoOnly.ok) expect(await body(demoOnly.res)).toEqual({ status: 404, text: JSON.stringify({ error: "not_found" }) });
  });

  it("a token for a user without an account row counts as signed out; a bad or ended token is 401", async () => {
    const orphan = await auth().createUser({ email: `${randomUUID()}@example.org`, password: "pw-for-orphan" });
    const tokens = await auth().signInWithPassword(orphan.email, "pw-for-orphan");
    const r = await requireSubject(req("/api/doses", { rp_at: tokens.access_token }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await body(r.res)).toEqual({ status: 401, text: JSON.stringify({ error: "not_signed_in" }) });
    // signed out falls back to the demo cookie, if any
    const s = await store.createSession({ ttl_hours: 1 });
    const demo = await requireSubject(req("/api/doses", { rp_at: tokens.access_token, rp_session: s.id }));
    expect(demo.ok && demo.subject.kind).toBe("demo");
    const garbage = await requireSubject(req("/api/doses", { rp_at: "not.a.jwt" }));
    expect(!garbage.ok && garbage.res.status).toBe(401);
    // signing out ends the session at once (the memory provider can tell)
    const a = await account();
    await auth().signOut(a.tokens.access_token);
    const out = await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }));
    expect(!out.ok && out.res.status).toBe(401);
  });

  it("an account without a space of its own is 404 no_profile (a family member who only helps)", async () => {
    const her = await account("none");
    const r = await requireSubject(req("/api/doses", { rp_at: her.tokens.access_token }));
    expect(!r.ok && (await body(r.res))).toEqual({ status: 404, text: JSON.stringify({ error: "no_profile" }) });
  });
});

describe("her care link", () => {
  it("only an active link of hers opens his space, read-only, and only on a route that accepts it", async () => {
    const dad = await account();
    const her = await account("none");
    const stranger = await account();
    const hash = `h-${randomUUID()}`;
    const inv = await store.createInvite({ patient_id: dad.userId, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true });
    expect(inv.ok).toBe(true);
    const linkId = inv.ok ? inv.link.id : "";
    await store.acceptInvite(hash, her.userId, "Wei Ling");
    const viaLink = (cookieToken: string, allowFamily = true) => requireSubject(req(`/api/family/view?link=${linkId}`, { rp_at: cookieToken }), { allowFamily });

    // accepted, not confirmed yet: nothing
    const early = await viaLink(her.tokens.access_token);
    expect(!early.ok && (await body(early.res))).toEqual({ status: 403, text: JSON.stringify({ error: "link_not_active" }) });
    await store.confirmLink(linkId, dad.userId, true);

    const found = await viaLink(her.tokens.access_token);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.subject).toMatchObject({ kind: "account", relation: "family", userId: her.userId, link: { id: linkId, status: "active" } });
    expect(found.session.id).toBe(dad.userId);
    expect(found.store.mode).toBe("family");
    // she reads his records; rows come without his scope id
    const meds = await found.store.listMeds(dad.userId);
    expect(Array.isArray(meds)).toBe(true);
    const grant = await found.store.getFamilyGrant(dad.userId, linkId);
    expect(grant?.session_id).toBe("");
    // and writes nothing of his
    await expect(found.store.logDose(dad.userId, { medication_id: "m", day: 0, slot: "morning", state: "taken" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(found.store.addNote(dad.userId, { day: 0, text: "x", source: "typed" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(found.store.setFamilyGrant(dad.userId, linkId, { notes: true })).rejects.toBeInstanceOf(ScopeViolation);
    // except her own clip and a proposed fact, both through her link
    const clip = await found.store.addReminderClip(dad.userId, { by: linkId, plays_at: "after_breakfast", by_user_id: her.userId, link_id: linkId, by_label: "Wei Ling" });
    expect(clip.session_id).toBe("");
    await expect(found.store.addReminderClip(dad.userId, { by: linkId, plays_at: "after_breakfast", by_user_id: dad.userId, link_id: linkId })).rejects.toBeInstanceOf(ScopeViolation);
    const fact = await found.store.addProfileFact(dad.userId, { kind: "condition", text: "x", source: "family", entered_by_user_id: her.userId, link_id: linkId });
    expect(fact.confirmed_by).toBeNull();
    await expect(found.store.addProfileFact(dad.userId, { kind: "condition", text: "x", source: "patient", entered_by_user_id: her.userId, link_id: linkId })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(found.store.deleteReminderClip(dad.userId, clip.id)).resolves.toBeUndefined();

    // a route that does not accept her link: her own space (she has none: no_profile), never his
    const ignored = await viaLink(her.tokens.access_token, false);
    expect(!ignored.ok && ignored.res.status).toBe(404);
    // someone else's token with her link: no
    const other = await viaLink(stranger.tokens.access_token);
    expect(!other.ok && (await body(other.res))).toEqual({ status: 404, text: JSON.stringify({ error: "link_not_found" }) });
    // revoked: no
    await store.revokeLink(linkId, dad.userId, "patient");
    const after = await viaLink(her.tokens.access_token);
    expect(!after.ok && after.res.status).toBe(403);
  });
});

describe("the scoped store", () => {
  it("throws on any call that names another scope, and refuses the global methods", async () => {
    const a = await account();
    const b = await account();
    const subject = selfSubject(store, (await store.getSession(a.userId))!, a.userId);
    const s = subject.store;
    await expect(s.listMeds(b.userId)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.getSession(b.userId)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.addNote(b.userId, { day: 0, text: "x", source: "typed" })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.listSessions()).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.createSession()).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.getAccount(b.userId)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.listCareLinks({ patient_id: b.userId })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(s.rateHit("x", 60, 1)).rejects.toBeInstanceOf(ScopeViolation);
    // its own scope and its own rows work; rows come without the scope id; the scope row keeps it for the server
    const note = await s.addNote(a.userId, { day: 0, text: "x", source: "typed" });
    expect(note.session_id).toBe("");
    expect((await s.getSession(a.userId))!.id).toBe(a.userId);
    expect((await s.getAccount(a.userId))!.user_id).toBe(a.userId);
    // the demo-only operations answer as the store does for an account
    await expect(s.setStoryDay(a.userId, 3)).rejects.toMatchObject({ code: "account_scope" });
    // a demo scope keeps today's behaviour (rows as stored, its own id)
    const demo = await store.createSession({ ttl_hours: 1 });
    const d = scopedStore(store, demo, "demo");
    expect((await d.listMeds(demo.id))[0].session_id).toBe(demo.id);
    await expect(d.listMeds(a.userId)).rejects.toBeInstanceOf(ScopeViolation);
    expect((await d.setStoryDay(demo.id, 5)).story_day).toBe(5);
  });

  it("system mode works inside its one account scope and nowhere else", async () => {
    const a = await account();
    const b = await account();
    const sys = scopedStore(store, { id: a.userId }, "system");
    const dose = await sys.addBp(a.userId, { day: 0, slot: "morning", systolic: 120, diastolic: 80 });
    expect(dose.session_id).toBe(a.userId);
    await expect(sys.addBp(b.userId, { day: 0, slot: "morning" })).rejects.toBeInstanceOf(ScopeViolation);
  });
});
