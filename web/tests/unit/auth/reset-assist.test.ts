/**
 * Family-assisted password reset (lib/auth/family-reset.ts, track A; docs/plan/real-app.md 2.4, 3.6, 3.5 「家人协助重设，
 * 每账号每天 3」, 8.2 「单元 auth/reset-assist」) on the in-memory store and identity provider. Every rule of 3.6:
 *   - off until he turns it on; each change writes a consent record family_reset_helper (granted / withdrawn);
 *   - he asks only from a phone he has used (rp_device known, used within 180 days); the request lasts 10 minutes and
 *     is bound to that phone;
 *   - she is given a 6-digit code (only its hash is kept), one use;
 *   - the code works only typed on the phone that asked: not on hers, not on a phone he never used;
 *   - success ends all his sessions, leaves the switch as it was, writes account_event password_reset
 *     { method: "family_assisted", link_id }, and his Today line names her;
 *   - three requests and three codes per account a day, then 429.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignupBody } from "@/lib/auth/api";
import { deviceHash, newDeviceId } from "@/lib/auth/device";
import {
  hashResetCode,
  issueFamilyResetCode,
  KNOWN_DEVICE_MAX_AGE_MS,
  listResetHelpers,
  newResetCode,
  normalizeResetCode,
  pendingFamilyHelp,
  recoverWithFamily,
  requestFamilyHelp,
  RESET_REQUEST_TTL_MS,
  resetCodeMatches,
  setResetHelper,
} from "@/lib/auth/family-reset";
import { tokenClaims } from "@/lib/auth/jwt";
import { MemoryAuthProvider } from "@/lib/auth/memory";
import { passwordResetNotice } from "@/lib/auth/notices";
import { logIn, recover, signUp, type AccountDeps, type Me, type RequestFacts } from "@/lib/auth/service";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { MORE_CONSENT_VERSIONS, moreConsentText } from "@/lib/privacy/consent-texts-more";
import { ASSISTED_NOTE, consentStamp } from "@/lib/privacy/consents";
import { MemoryStore } from "@/lib/store/memory";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";

let clock = Date.parse("2026-10-10T02:00:00.000Z");
type Deps = AccountDeps & { store: MemoryStore; auth: MemoryAuthProvider };
function deps(): Deps {
  return { store: new MemoryStore({ now: () => new Date(clock) }), auth: new MemoryAuthProvider(), env: { NODE_ENV: "test" }, now: () => clock };
}
const phone = (over: Partial<RequestFacts> = {}): RequestFacts => ({ ip: "10.0.0.7", deviceId: newDeviceId(), knownDevice: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1", ...over });
const newLogin = (p: string) => `${p}${randomUUID().slice(0, 8)}`;

function signupBody(login: string, space: SignupBody["space"], name: string): SignupBody {
  return {
    login,
    password: PASSWORD,
    display_name: name,
    locale: "zh-Hans",
    assisted: false,
    consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
    space,
  };
}

async function meOf(d: AccountDeps, accessToken: string): Promise<Me> {
  const c = tokenClaims(accessToken);
  return { userId: c.userId!, sessionId: c.sessionId, account: (await d.store.getAccount(c.userId!))!, email: c.email, ephemeral: false };
}

interface Family {
  d: Deps;
  him: Me;
  her: Me;
  hisLogin: string;
  /** the phone he signed up on */
  hisPhone: RequestFacts;
  /** her own phone */
  herPhone: RequestFacts;
  linkId: string;
  hisToken: string;
}

/** Mr Tan and Wei Ling, linked and confirmed (active); the helper switch as the store makes it: off. */
async function family(opts: { label?: string | null } = {}): Promise<Family> {
  const d = deps();
  const hisLogin = newLogin("tan");
  const hisPhone = phone();
  const herPhone = phone({ ip: "10.0.0.9" });
  const a = await signUp(d, signupBody(hisLogin, "blank", "陈先生"), hisPhone);
  const b = await signUp(d, signupBody(newLogin("wl"), "none", "Wei Ling"), herPhone);
  if (!a.ok || !b.ok) throw new Error("sign-up");
  const him = await meOf(d, a.signedIn.tokens.access_token);
  const her = await meOf(d, b.signedIn.tokens.access_token);
  const hash = `h-${randomUUID()}`;
  const label = opts.label === undefined ? "Wei Ling" : opts.label;
  const inv = await d.store.createInvite({ patient_id: him.userId, relation: "daughter", family_label: label, patient_label: "爸爸", invite_token_hash: hash, invite_expires_at: new Date(clock + 7 * 86_400_000).toISOString() });
  if (!inv.ok) throw new Error("invite");
  await d.store.acceptInvite(hash, her.userId);
  await d.store.confirmLink(inv.link.id, him.userId, true);
  return { d, him, her, hisLogin, hisPhone, herPhone, linkId: inv.link.id, hisToken: a.signedIn.tokens.access_token };
}

/** The same, with his switch on for her. */
async function familyOn(opts: { label?: string | null } = {}): Promise<Family> {
  const f = await family(opts);
  expect(await setResetHelper(f.d, f.him, { link_id: f.linkId, on: true })).toMatchObject({ ok: true, helper: { on: true } });
  return f;
}

/** He asks, she is given the code. */
async function askAndCode(f: Family): Promise<string> {
  expect((await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).ok).toBe(true);
  const r = await issueFamilyResetCode(f.d, f.her, f.linkId);
  if (!r.ok) throw new Error(`code: ${r.error}`);
  return r.code;
}

afterEach(() => vi.restoreAllMocks());

describe("the 6-digit code", () => {
  it("six digits with leading zeros kept; what he types may carry spaces, dashes or full-width digits", () => {
    const random = vi.spyOn(Math, "random"); // must stay unused: the code comes from the system's random source
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newResetCode();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(150);
    expect(normalizeResetCode("123 456")).toBe("123456");
    expect(normalizeResetCode("123-456")).toBe("123456");
    expect(normalizeResetCode("１２３４５６")).toBe("123456");
    expect(normalizeResetCode("004711")).toBe("004711");
    for (const bad of ["12345", "1234567", "12345a", "", null, undefined, 123456]) expect(normalizeResetCode(bad)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it("only a keyed hash is kept; it matches that code for that request and nothing else", () => {
    const env = { RECOVERY_PEPPER: "p".repeat(40) };
    const stored = hashResetCode("req-1", "004711", env);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain("004711");
    expect(stored).not.toBe(createHash("sha256").update("004711").digest("hex")); // not a bare hash of six digits
    expect(resetCodeMatches("req-1", "0047 11", stored, env)).toBe(true);
    expect(resetCodeMatches("req-1", "004712", stored, env)).toBe(false);
    expect(resetCodeMatches("req-2", "004711", stored, env)).toBe(false); // another request
    expect(resetCodeMatches("req-1", "004711", stored, { RECOVERY_PEPPER: "q".repeat(40) })).toBe(false); // another pepper
    expect(resetCodeMatches("req-1", "004711", null, env)).toBe(false);
    expect(resetCodeMatches("req-1", "not a code", stored, env)).toBe(false);
  });
});

describe("his switch (off until he turns it on)", () => {
  it("a confirmed family member starts with the switch off, and then nothing works: he cannot ask, she gets no code", async () => {
    const f = await family();
    expect((await f.d.store.getCareLink(f.linkId))!.reset_helper).toBe(false);
    expect(await listResetHelpers(f.d, f.him)).toEqual([{ link_id: f.linkId, label: "Wei Ling", relation: "daughter", on: false }]);
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).toEqual({ ok: false, status: 403, error: "help_unavailable" });
    expect(await f.d.store.listResetRequests(f.him.userId)).toEqual([]);
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toEqual({ ok: true, enabled: false, pending: false, expires_at: null });
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 409, error: "helper_off" });
    // even with a request row somehow there, her code is refused while the switch is off
    await f.d.store.createResetRequest({ user_id: f.him.userId, device_hash: deviceHash(f.hisPhone.deviceId), expires_at: new Date(clock + RESET_REQUEST_TTL_MS).toISOString() });
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 409, error: "helper_off" });
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: "123456", password: NEW_PASSWORD }, f.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });
  });

  it("turning it on and off writes a consent record family_reset_helper each time (granted, withdrawn), with the text's version and hash", async () => {
    const f = await family();
    const text = moreConsentText("family_reset_helper", "zh-Hans");
    expect(consentStamp("family_reset_helper", "zh-Hans")).toEqual({ version: text.version, text_sha256: text.sha256, locale: "zh-Hans" });
    expect(await setResetHelper(f.d, f.him, { link_id: f.linkId, on: true, locale: "zh-Hans" })).toEqual({ ok: true, helper: { link_id: f.linkId, label: "Wei Ling", relation: "daughter", on: true } });
    expect((await f.d.store.getCareLink(f.linkId))!.reset_helper).toBe(true);
    // asking for what is already so writes nothing more
    await setResetHelper(f.d, f.him, { link_id: f.linkId, on: true });
    let records = await f.d.store.listConsentRecords(f.him.userId, { kind: "family_reset_helper" });
    expect(records.map((r) => [r.decision, r.version, r.text_sha256, r.method, r.assisted, r.scope_id])).toEqual([["granted", MORE_CONSENT_VERSIONS.family_reset_helper, text.sha256, "me_screen", false, f.him.userId]]);
    expect(records[0].evidence).toEqual({ locale: "zh-Hans", link_id: f.linkId, screen: "me_reset_help" });
    expect(await f.d.store.getConsentText("family_reset_helper", text.version, "zh-Hans")).toMatchObject({ sha256: text.sha256, text: text.text });

    expect(await setResetHelper(f.d, f.him, { link_id: f.linkId, on: false, locale: "en" })).toMatchObject({ ok: true, helper: { on: false } });
    records = await f.d.store.listConsentRecords(f.him.userId, { kind: "family_reset_helper" });
    expect(records.map((r) => r.decision)).toEqual(["granted", "withdrawn"]);
    expect(records[1].text_sha256).toBe(moreConsentText("family_reset_helper", "en").sha256);
    expect(await f.d.store.getConsentText("family_reset_helper", text.version, "en")).toMatchObject({ sha256: records[1].text_sha256 });
    expect((await f.d.store.listAccountEvents(f.him.userId)).map((e) => e.kind).filter((k) => k.startsWith("reset_helper"))).toEqual(["reset_helper_on", "reset_helper_off"]);
    // nothing of this is written under her name
    expect(await f.d.store.listConsentRecords(f.her.userId, { kind: "family_reset_helper" })).toEqual([]);
  });

  it("only he changes it, only on his own active links", async () => {
    const f = await family();
    // she cannot turn herself on
    expect(await setResetHelper(f.d, f.her, { link_id: f.linkId, on: true })).toEqual({ ok: false, status: 404, error: "link_not_found" });
    expect(await setResetHelper(f.d, f.him, { link_id: randomUUID(), on: true })).toEqual({ ok: false, status: 404, error: "link_not_found" });
    expect((await f.d.store.getCareLink(f.linkId))!.reset_helper).toBe(false);
    // an invitation nobody confirmed yet is not a helper
    const inv = await f.d.store.createInvite({ patient_id: f.him.userId, family_label: "Jun", invite_token_hash: `h-${randomUUID()}`, invite_expires_at: new Date(clock + 86_400_000).toISOString() });
    if (!inv.ok) throw new Error("invite");
    expect(await setResetHelper(f.d, f.him, { link_id: inv.link.id, on: true })).toEqual({ ok: false, status: 409, error: "link_not_active" });
    expect((await listResetHelpers(f.d, f.him)).map((h) => h.link_id)).toEqual([f.linkId]);
    // a link he ended
    await setResetHelper(f.d, f.him, { link_id: f.linkId, on: true });
    await f.d.store.revokeLink(f.linkId, f.him.userId, "patient");
    expect(await setResetHelper(f.d, f.him, { link_id: f.linkId, on: false })).toEqual({ ok: false, status: 409, error: "link_not_active" });
    expect(await listResetHelpers(f.d, f.him)).toEqual([]);
  });

  it("the text his switch page shows (track H's) says what this feature does", () => {
    // each promise in the text is a rule the tests below hold the feature to
    for (const word of ["自己用过的手机", "6 位数", "10 分钟内有效", "只能用一次", "在对方的手机上输入", "没用过的手机上输入", "看不到你的密码", "今天页", "随时可以关掉"]) {
      expect(moreConsentText("family_reset_helper", "zh-Hans").text, word).toContain(word);
    }
    for (const word of ["a phone you have used before", "6-digit", "10 minutes", "only once", "on their phone", "never see your password", "Today page", "switch this off"]) {
      expect(moreConsentText("family_reset_helper", "en").text, word).toContain(word);
    }
  });

  it("sign-up with family helping: the consent records carry the assisted note in words as well as the flag", async () => {
    const d = deps();
    const s = await signUp(d, { ...signupBody(newLogin("as"), "blank", "陈先生"), assisted: true }, phone());
    if (!s.ok) throw new Error("sign-up");
    const records = await d.store.listConsentRecords(tokenClaims(s.signedIn.tokens.access_token).userId!);
    expect(records.length).toBeGreaterThanOrEqual(2);
    for (const r of records) {
      expect(r.assisted).toBe(true);
      expect(r.evidence).toMatchObject({ assisted_note: ASSISTED_NOTE });
    }
    const alone = await signUp(d, signupBody(newLogin("al"), "blank", "林先生"), phone());
    if (!alone.ok) throw new Error("sign-up");
    for (const r of await d.store.listConsentRecords(tokenClaims(alone.signedIn.tokens.access_token).userId!)) {
      expect(r.assisted).toBe(false);
      expect(r.evidence).not.toHaveProperty("assisted_note");
    }
  });
});

describe("he asks for help: only from a phone he has used", () => {
  it("on the phone he signed in on: a request for 10 minutes bound to that phone, naming who can help", async () => {
    const f = await familyOn();
    const r = await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone);
    expect(r).toEqual({ ok: true, expires_at: new Date(clock + 10 * 60_000).toISOString(), helpers: ["Wei Ling"] });
    const rows = await f.d.store.listResetRequests(f.him.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: f.him.userId, device_hash: deviceHash(f.hisPhone.deviceId), code_hash: null, link_id: null, used_at: null, expires_at: new Date(clock + 10 * 60_000).toISOString() });
    // the upper-case and full-width forms of his login are the same account
    expect((await requestFamilyHelp(f.d, { login: f.hisLogin.toUpperCase() }, f.hisPhone)).ok).toBe(true);
    // asking again starts over: one open request at a time
    const again = await f.d.store.listResetRequests(f.him.userId);
    expect(again.map((x) => !!x.used_at)).toEqual([true, false]);
  });

  it("one refusal that never says why: an unknown login, a phone he never used, her phone, a browser without the device cookie", async () => {
    const f = await familyOn();
    const refused = { ok: false, status: 403, error: "help_unavailable" };
    expect(await requestFamilyHelp(f.d, { login: newLogin("nobody") }, f.hisPhone)).toEqual(refused);
    expect(await requestFamilyHelp(f.d, { login: "not a login!" }, f.hisPhone)).toEqual(refused);
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, phone())).toEqual(refused); // a phone he never used
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, f.herPhone)).toEqual(refused); // her phone
    // his own device id, but the browser did not send the cookie (the id is a fresh one the route made up)
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, { ...f.hisPhone, knownDevice: false })).toEqual(refused);
    expect(await f.d.store.listResetRequests(f.him.userId)).toEqual([]);
    // none of these used up his three a day
    expect((await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).ok).toBe(true);
  });

  it("a phone he last used more than 180 days ago no longer counts; one he used since does", async () => {
    const f = await familyOn();
    clock += KNOWN_DEVICE_MAX_AGE_MS + 60_000;
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).toEqual({ ok: false, status: 403, error: "help_unavailable" });
    // he logs in on a second phone today: that one is a phone he has used
    const second = phone();
    expect((await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, second)).ok).toBe(true);
    expect((await requestFamilyHelp(f.d, { login: f.hisLogin }, second)).ok).toBe(true);
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).toMatchObject({ status: 403 });
  });

  it("three requests per account a day, then 429 until the day's window ends", async () => {
    const f = await familyOn();
    const start = clock;
    for (let i = 1; i <= 3; i++) expect((await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).ok).toBe(true);
    expect(await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 86_400_000).toISOString() });
    // the fourth made nothing
    expect(await f.d.store.listResetRequests(f.him.userId)).toHaveLength(3);
    clock = start + 86_400_000 + 1000;
    expect((await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone)).ok).toBe(true);
  });
});

describe("she is given the code", () => {
  it("her page learns he is asking; 「帮」 gives six digits once, and only their hash is stored", async () => {
    const f = await familyOn();
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toEqual({ ok: true, enabled: true, pending: false, expires_at: null });
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 409, error: "no_request" });
    const asked = await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone);
    if (!asked.ok) throw new Error("ask");
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toEqual({ ok: true, enabled: true, pending: true, expires_at: asked.expires_at });
    const r = await issueFamilyResetCode(f.d, f.her, f.linkId);
    if (!r.ok) throw new Error("code");
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.expires_at).toBe(asked.expires_at);
    const row = (await f.d.store.listResetRequests(f.him.userId))[0];
    expect(row.link_id).toBe(f.linkId);
    expect(row.code_hash).toBe(hashResetCode(row.id, r.code, f.d.env));
    expect(JSON.stringify(row)).not.toContain(r.code);
    // a second code replaces the first
    const second = await issueFamilyResetCode(f.d, f.her, f.linkId);
    if (!second.ok) throw new Error("code 2");
    const row2 = (await f.d.store.listResetRequests(f.him.userId))[0];
    expect(row2.code_hash).toBe(hashResetCode(row.id, second.code, f.d.env));
    // an event on his account says a code was given, without the code
    const events = await f.d.store.listAccountEvents(f.him.userId);
    expect(events.filter((e) => e.kind === "family_reset_code_issued").map((e) => e.detail)).toEqual([{ link_id: f.linkId }, { link_id: f.linkId }]);
    expect(JSON.stringify(events)).not.toContain(second.code);
  });

  it("only she, through her own active link: not a stranger, not him, not after the link ended", async () => {
    const f = await familyOn();
    await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone);
    const stranger = await signUp(f.d, signupBody(newLogin("x"), "none", "Someone"), phone());
    if (!stranger.ok) throw new Error("sign-up");
    const other = await meOf(f.d, stranger.signedIn.tokens.access_token);
    expect(await issueFamilyResetCode(f.d, other, f.linkId)).toEqual({ ok: false, status: 404, error: "link_not_found" });
    expect(await pendingFamilyHelp(f.d, other, f.linkId)).toEqual({ ok: false, status: 404, error: "link_not_found" });
    expect(await issueFamilyResetCode(f.d, f.him, f.linkId)).toEqual({ ok: false, status: 404, error: "link_not_found" }); // he cannot give himself a code
    expect(await issueFamilyResetCode(f.d, f.her, "not-a-link")).toEqual({ ok: false, status: 404, error: "link_not_found" });
    await f.d.store.revokeLink(f.linkId, f.him.userId, "patient");
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 403, error: "link_not_active" });
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 403, error: "link_not_active" });
    expect((await f.d.store.listResetRequests(f.him.userId))[0].code_hash).toBeNull();
  });

  it("three codes for his account a day, then 429", async () => {
    const f = await familyOn();
    const start = clock;
    await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone);
    for (let i = 1; i <= 3; i++) expect((await issueFamilyResetCode(f.d, f.her, f.linkId)).ok).toBe(true);
    const before = (await f.d.store.listResetRequests(f.him.userId))[0].code_hash;
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 86_400_000).toISOString() });
    expect((await f.d.store.listResetRequests(f.him.userId))[0].code_hash).toBe(before); // the refused one changed nothing
    // asking her page whether he is asking never counts
    for (let i = 0; i < 10; i++) expect((await pendingFamilyHelp(f.d, f.her, f.linkId)).ok).toBe(true);
  });
});

describe("he types the code", () => {
  it("on the phone that asked: the new password, every earlier session ended, the switch unchanged, an event with the link, the Today line", async () => {
    const f = await familyOn();
    // he is also signed in on a tablet, and has a login lock on this phone from guessing
    const tablet = phone();
    const onTablet = await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, tablet);
    if (!onTablet.ok) throw new Error("log in");
    for (let i = 1; i <= 6; i++) await logIn(f.d, { login: f.hisLogin, password: `I forgot ${i}` }, f.hisPhone);
    expect(await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, f.hisPhone)).toMatchObject({ status: 423 });
    const recoveryBefore = (await f.d.store.getRecoveryCode(f.him.userId))!.code_hash;

    const code = await askAndCode(f); // the lock does not stop the family path
    clock += 3 * 60_000;
    const r = await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, f.hisPhone);
    if (!r.ok) throw new Error(`reset: ${r.error}`);
    expect(r.next).toBe("/onboard");
    expect(r.helper).toBe("Wei Ling");
    expect(r.signedIn.since.ephemeral).toBe(false);

    // every earlier session of his is over: the one from sign-up on this phone, and the tablet's
    expect(await f.d.auth.sessionAlive!(tokenClaims(f.hisToken).sessionId)).toBe(false);
    expect(await f.d.auth.sessionAlive!(tokenClaims(onTablet.signedIn.tokens.access_token).sessionId)).toBe(false);
    expect(await f.d.auth.sessionAlive!(tokenClaims(r.signedIn.tokens.access_token).sessionId)).toBe(true);
    const open = (await f.d.auth.listSessions(f.him.userId)).filter((s) => !s.ended_at);
    expect(open).toHaveLength(1);
    // the old password is gone, the new one works, and this phone's login lock is lifted
    expect(await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, phone())).toMatchObject({ status: 401 });
    expect((await logIn(f.d, { login: f.hisLogin, password: NEW_PASSWORD }, f.hisPhone)).ok).toBe(true);

    // his switch is as he left it, and her link is untouched
    expect(await f.d.store.getCareLink(f.linkId)).toMatchObject({ reset_helper: true, status: "active" });
    expect((await f.d.store.listConsentRecords(f.him.userId, { kind: "family_reset_helper" })).map((x) => x.decision)).toEqual(["granted"]);
    // her sessions are hers: nothing of hers ended
    expect((await f.d.auth.listSessions(f.her.userId)).every((s) => !s.ended_at)).toBe(true);
    // his recovery code is the one he had
    expect((await f.d.store.getRecoveryCode(f.him.userId))!.code_hash).toBe(recoveryBefore);

    // the account event names the method and the link; his Today line names her
    const events = await f.d.store.listAccountEvents(f.him.userId);
    const reset = events.filter((e) => e.kind === "password_reset");
    expect(reset.map((e) => e.detail)).toEqual([{ method: "family_assisted", link_id: f.linkId, helper: "Wei Ling" }]);
    expect(JSON.stringify(events)).not.toContain(code);
    expect(passwordResetNotice(events, clock, "zh-Hans")).toMatchObject({ method: "family_assisted", text: expect.stringContaining("由 Wei Ling 协助重设") });

    // one use: the same code again is refused, and so is a new code for the spent request
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: "another one 99" }, f.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 409, error: "no_request" });
    expect((await logIn(f.d, { login: f.hisLogin, password: NEW_PASSWORD }, phone())).ok).toBe(true);
  });

  it("the code is no use on her phone, on a phone he never used, or on another phone of his", async () => {
    const f = await familyOn();
    const tablet = phone();
    expect((await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, tablet)).ok).toBe(true); // a phone he has used, but not the one that asked
    const code = await askAndCode(f);
    const refused = { ok: false, status: 401, error: "invalid_family_code" };
    const tried = vi.spyOn(f.d.auth, "updatePassword");
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, f.herPhone)).toEqual(refused);
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, phone())).toEqual(refused);
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, tablet)).toEqual(refused);
    // his own device id without the cookie being sent
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, { ...f.hisPhone, knownDevice: false })).toEqual(refused);
    // her own login with his code
    expect(await recoverWithFamily(f.d, { login: f.her.account.username!, code, password: NEW_PASSWORD }, f.herPhone)).toEqual(refused);
    expect(tried).not.toHaveBeenCalled();
    // none of those spent the request or counted as a wrong guess: on his phone it still works
    expect((await f.d.store.listResetRequests(f.him.userId))[0].used_at).toBeNull();
    expect((await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, f.hisPhone)).ok).toBe(true);
  });

  it("after 10 minutes the request and its code are over", async () => {
    const f = await familyOn();
    const code = await askAndCode(f);
    clock += RESET_REQUEST_TTL_MS - 1000;
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toMatchObject({ pending: true });
    clock += 1000;
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, f.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });
    expect(await pendingFamilyHelp(f.d, f.her, f.linkId)).toMatchObject({ pending: false });
    expect(await issueFamilyResetCode(f.d, f.her, f.linkId)).toEqual({ ok: false, status: 409, error: "no_request" });
    expect((await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, phone())).ok).toBe(true); // nothing changed
  });

  it("a wrong code is one refusal; four wrong ones are counted and the fifth spends the request", async () => {
    const f = await familyOn();
    const code = await askAndCode(f);
    const wrong = code === "000000" ? "000001" : "000000";
    const refused = { ok: false, status: 401, error: "invalid_family_code" };
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: "12345", password: NEW_PASSWORD }, f.hisPhone)).toEqual(refused); // not six digits
    for (let i = 2; i <= 4; i++) expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: wrong, password: NEW_PASSWORD }, f.hisPhone)).toEqual(refused);
    expect((await f.d.store.listResetRequests(f.him.userId))[0].used_at).toBeNull();
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: wrong, password: NEW_PASSWORD }, f.hisPhone)).toEqual(refused);
    expect((await f.d.store.listResetRequests(f.him.userId))[0].used_at).not.toBeNull();
    // the right code is too late now
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code, password: NEW_PASSWORD }, f.hisPhone)).toEqual(refused);
    expect((await logIn(f.d, { login: f.hisLogin, password: PASSWORD }, phone())).ok).toBe(true);
  });

  it("before she gave a code there is nothing to match; a weak new password is refused first and costs no guess", async () => {
    const f = await familyOn();
    await requestFamilyHelp(f.d, { login: f.hisLogin }, f.hisPhone);
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: "123456", password: NEW_PASSWORD }, f.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });
    const r = await issueFamilyResetCode(f.d, f.her, f.linkId);
    if (!r.ok) throw new Error("code");
    for (let i = 0; i < 8; i++) expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: r.code, password: "12345678" }, f.hisPhone)).toEqual({ ok: false, status: 400, error: "password_common" });
    expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: r.code, password: f.hisLogin }, f.hisPhone)).toMatchObject({ status: 400 });
    expect((await recoverWithFamily(f.d, { login: f.hisLogin, code: r.code, password: NEW_PASSWORD }, f.hisPhone)).ok).toBe(true);
  });

  it("he switched her off, or the link ended, after the code was given: the code is void", async () => {
    const a = await familyOn();
    const codeA = await askAndCode(a);
    await setResetHelper(a.d, a.him, { link_id: a.linkId, on: false });
    expect(await recoverWithFamily(a.d, { login: a.hisLogin, code: codeA, password: NEW_PASSWORD }, a.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });

    const b = await familyOn();
    const codeB = await askAndCode(b);
    await b.d.store.revokeLink(b.linkId, b.her.userId, "family"); // she left
    expect(await recoverWithFamily(b.d, { login: b.hisLogin, code: codeB, password: NEW_PASSWORD }, b.hisPhone)).toEqual({ ok: false, status: 401, error: "invalid_family_code" });
    expect((await logIn(b.d, { login: b.hisLogin, password: PASSWORD }, phone())).ok).toBe(true);
  });

  it("asking again voids the earlier code; a helper without a name is 「家人」 on his Today line", async () => {
    const f = await familyOn({ label: null });
    const first = await askAndCode(f);
    const second = await askAndCode(f);
    if (first !== second) expect(await recoverWithFamily(f.d, { login: f.hisLogin, code: first, password: NEW_PASSWORD }, f.hisPhone)).toMatchObject({ status: 401 });
    const r = await recoverWithFamily(f.d, { login: f.hisLogin, code: second, password: NEW_PASSWORD }, f.hisPhone);
    expect(r).toMatchObject({ ok: true, helper: null });
    const events = await f.d.store.listAccountEvents(f.him.userId);
    expect(passwordResetNotice(events, clock, "zh-Hans")?.text).toContain("由 家人 协助重设");
  });

  it("the recovery code still works beside it, and its reset says so on Today instead", async () => {
    const f = await familyOn();
    const s = await signUp(f.d, signupBody(newLogin("solo"), "blank", "林先生"), phone());
    if (!s.ok) throw new Error("sign-up");
    const his = phone();
    const r = await recover(f.d, { login: s.answer.login, code: s.answer.recovery_code, password: NEW_PASSWORD }, his);
    expect(r.ok).toBe(true);
    const events = await f.d.store.listAccountEvents(tokenClaims(s.signedIn.tokens.access_token).userId!);
    expect(passwordResetNotice(events, clock, "zh-Hans")).toMatchObject({ method: "recovery_code", text: expect.stringContaining("用恢复码重设过") });
  });
});
