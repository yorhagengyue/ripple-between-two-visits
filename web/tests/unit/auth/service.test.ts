/**
 * The account flows (lib/auth/service.ts, track A; real-app 2.2-2.4, 3.4-3.6, 8.2) on the in-memory store and identity
 * provider: sign-up in one step (identity, account, space through track C's seedAccount, consent records with version,
 * hash and assisted, a recovery code shown once, a session), its clean-up on failure, the generic login refusal, the
 * lockout per login × device, recovery with a single-use code, a new password and a new code, and his devices.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignupBody } from "@/lib/auth/api";
import { deviceHash, deviceRef, newDeviceId } from "@/lib/auth/device";
import { tokenClaims } from "@/lib/auth/jwt";
import { MemoryAuthProvider } from "@/lib/auth/memory";
import { AuthError } from "@/lib/auth/provider";
import { normalizeRecoveryCode, recoveryCodeMatches } from "@/lib/auth/recovery";
import {
  changePassword,
  checkLogin,
  listDevices,
  logIn,
  logOut,
  meAnswer,
  recover,
  regenerateRecoveryCode,
  signOutDevice,
  signUp,
  type AccountDeps,
  type Me,
  type RequestFacts,
} from "@/lib/auth/service";
import { CURRENT_CONSENT_VERSIONS, consentText } from "@/lib/privacy/consent-texts";
import { MemoryStore } from "@/lib/store/memory";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";

let clock = Date.parse("2026-10-10T02:00:00.000Z");
function deps(): AccountDeps & { store: MemoryStore; auth: MemoryAuthProvider } {
  return { store: new MemoryStore({ now: () => new Date(clock) }), auth: new MemoryAuthProvider(), env: { NODE_ENV: "test" }, now: () => clock };
}
const phone = (over: Partial<RequestFacts> = {}): RequestFacts => ({ ip: "10.0.0.7", deviceId: newDeviceId(), knownDevice: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1", ...over });
const login = () => `tan${randomUUID().slice(0, 8)}`;

function body(over: Partial<SignupBody> = {}): SignupBody {
  const space = over.space ?? "blank";
  return {
    login: login(),
    password: PASSWORD,
    display_name: "陈先生",
    locale: "zh-Hans",
    assisted: false,
    consents: {
      terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy },
      ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing },
      ...(space === "example" ? { example_data: { version: CURRENT_CONSENT_VERSIONS.example_data } } : {}),
    },
    space,
    ...over,
  };
}

async function me(d: AccountDeps, accessToken: string, ephemeral = false): Promise<Me> {
  const c = tokenClaims(accessToken);
  return { userId: c.userId!, sessionId: c.sessionId, account: (await d.store.getAccount(c.userId!))!, email: c.email, ephemeral };
}

afterEach(() => vi.restoreAllMocks());

describe("sign-up", () => {
  it("makes the identity, the account, a blank space, three consent facts and a recovery code; he is signed in", async () => {
    const d = deps();
    const b = body();
    const r = await signUp(d, b, phone());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.next).toBe("/onboard");
    expect(r.answer.login).toBe(b.login);
    expect(r.answer.recovery_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const userId = r.signedIn.tokens.user_id;
    expect(await d.store.getAccount(userId)).toMatchObject({ login_kind: "username", username: b.login, display_name: "陈先生", locale: "zh-Hans" });
    const scope = await d.store.getSession(userId);
    expect(scope).toMatchObject({ kind: "account", template: "blank", example_data: false, onboarding: "started", settings: { locale: "zh-Hans" } });
    // the code is stored only as a hash, and it matches
    const stored = await d.store.getRecoveryCode(userId);
    expect(stored!.code_hash).not.toContain(normalizeRecoveryCode(r.answer.recovery_code)!);
    expect(await recoveryCodeMatches(r.answer.recovery_code, stored!.code_hash, d.env)).toBe(true);
    // consents: version and text hash of what he saw
    const records = await d.store.listConsentRecords(userId);
    expect(records.map((c) => [c.kind, c.decision, c.version, c.assisted, c.method])).toEqual([
      ["terms_privacy", "granted", CURRENT_CONSENT_VERSIONS.terms_privacy, false, "signup_screen"],
      ["ai_processing", "granted", CURRENT_CONSENT_VERSIONS.ai_processing, false, "signup_screen"],
    ]);
    expect(records[0].text_sha256).toBe(consentText("terms_privacy", CURRENT_CONSENT_VERSIONS.terms_privacy, "zh-Hans")!.sha256);
    expect(await d.store.getConsentText("terms_privacy", CURRENT_CONSENT_VERSIONS.terms_privacy, "zh-Hans")).toMatchObject({ sha256: records[0].text_sha256 });
    // a session for this device, in the registry
    expect(await d.auth.sessionAlive(tokenClaims(r.signedIn.tokens.access_token).sessionId)).toBe(true);
    expect((await d.auth.listSessions(userId))[0]).toMatchObject({ device_label: "iPhone · Safari", ephemeral: false });
    expect((await d.store.listAccountEvents(userId)).map((e) => e.kind)).toEqual(["signup"]);
  });

  it("「家人帮我操作」: every consent record says assisted; refusing AI still signs him up; the example lands on today", async () => {
    const d = deps();
    const r = await signUp(d, body({ assisted: true, space: "example", consents: { ...body({ space: "example" }).consents, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } } }), phone());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.next).toBe("/p/today");
    const userId = r.signedIn.tokens.user_id;
    const records = await d.store.listConsentRecords(userId);
    expect(records.map((c) => [c.kind, c.decision, c.assisted])).toEqual([
      ["terms_privacy", "granted", true],
      ["ai_processing", "declined", true],
      ["example_data", "granted", true],
    ]);
    expect(await d.store.getSession(userId)).toMatchObject({ example_data: true, onboarding: "done", story_day: 42 });
  });

  it("English texts are recorded with the English hash", async () => {
    const d = deps();
    const r = await signUp(d, body({ locale: "en" }), phone());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [terms] = await d.store.listConsentRecords(r.signedIn.tokens.user_id, { kind: "terms_privacy" });
    expect(terms.text_sha256).toBe(consentText("terms_privacy", CURRENT_CONSENT_VERSIONS.terms_privacy, "en")!.sha256);
    expect(r.signedIn.locale).toBe("en");
  });

  it("refuses a bad login, a weak password, an old consent text, a taken name; makes nothing then", async () => {
    const d = deps();
    const taken = body();
    expect((await signUp(d, taken, phone())).ok).toBe(true);
    const cases: [Partial<SignupBody>, number, string][] = [
      [{ login: "ab" }, 400, "username_invalid"],
      [{ login: "admin" }, 400, "username_reserved"],
      [{ login: "x@users.ripple.invalid" }, 400, "email_reserved_domain"],
      [{ password: "short" }, 400, "password_short"],
      [{ password: "12345678" }, 400, "password_common"],
      [{ login: "chen.tan.ok", password: "chen.tan.ok" }, 400, "password_like_login"],
      [{ consents: { terms_privacy: { version: "2020-01-01" }, ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing } } }, 409, "consent_version"],
      [{ space: "example" as const, consents: body().consents }, 400, "consent_required"],
      [{ login: taken.login }, 409, "login_taken"],
      [{ login: taken.login.toUpperCase() }, 409, "login_taken"],
    ];
    for (const [over, status, error] of cases) {
      const r = await signUp(d, body(over), phone());
      expect(r, error).toMatchObject({ ok: false, status, error });
    }
  });

  it("a step that fails after the identity exists removes the account, the space and the identity", async () => {
    const d = deps();
    vi.spyOn(d.store, "setRecoveryCode").mockRejectedValueOnce(new Error("disk full"));
    const deleteUser = vi.spyOn(d.auth, "deleteUser");
    const b = body({ space: "example", consents: body({ space: "example" }).consents });
    await expect(signUp(d, b, phone())).rejects.toThrow("disk full");
    expect(deleteUser).toHaveBeenCalledTimes(1);
    const userId = deleteUser.mock.calls[0][0];
    expect(await d.store.getAccount(userId)).toBeNull();
    expect(await d.store.getSession(userId)).toBeNull();
    expect(await d.auth.findUserIdByEmail(`${b.login}@users.ripple.invalid`)).toBeNull();
    // and the name is free again
    expect((await signUp(d, body({ login: b.login }), phone())).ok).toBe(true);
  });

  it("the name check: free, taken, or what is wrong with it", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    expect(await checkLogin(d, login(), phone())).toEqual({ ok: true, kind: "username" });
    expect(await checkLogin(d, "someone@example.test", phone())).toEqual({ ok: true, kind: "email" });
    expect(await checkLogin(d, b.login, phone())).toMatchObject({ ok: false, status: 409, error: "login_taken" });
    expect(await checkLogin(d, "a", phone())).toMatchObject({ ok: false, status: 400, error: "username_invalid" });
  });
});

describe("log in", () => {
  it("the right password signs in and comes back to the page he wanted; wrong login or password is the same refusal", async () => {
    const d = deps();
    const b = body({ space: "example", consents: body({ space: "example" }).consents });
    await signUp(d, b, phone());
    const ok = await logIn(d, { login: b.login.toUpperCase(), password: PASSWORD, next: "/p/bp" }, phone());
    expect(ok).toMatchObject({ ok: true, next: "/p/bp" });
    expect(await logIn(d, { login: b.login, password: PASSWORD, next: "https://evil.example/p" }, phone())).toMatchObject({ ok: true, next: "/p/today" });
    const wrongPassword = await logIn(d, { login: b.login, password: "not his password" }, phone());
    const noSuchLogin = await logIn(d, { login: login(), password: PASSWORD }, phone());
    const badName = await logIn(d, { login: "!", password: PASSWORD }, phone());
    for (const r of [wrongPassword, noSuchLogin, badName]) expect(r).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
  });

  it("full-width input (a Chinese keyboard) is the same login and password", async () => {
    const d = deps();
    const b = body({ password: "ａｂｃ１２３ｘｙｚ９" });
    await signUp(d, b, phone());
    expect((await logIn(d, { login: b.login, password: "abc123xyz9" }, phone())).ok).toBe(true);
  });

  it("the sixth wrong password in 15 minutes locks this device for 15 minutes; another device still logs in; then it opens again", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    const his = phone();
    // five wrong passwords are each answered 401 (real-app 3.5: 15 分钟 5 次)
    for (let i = 1; i <= 5; i++) expect(await logIn(d, { login: b.login, password: `wrong guess ${i}` }, his)).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    // the sixth locks this device, for 15 minutes from now (real-app 8.2: 第 6 次失败锁这一台)
    clock += 60_000;
    const sixth = await logIn(d, { login: b.login, password: "wrong guess 6" }, his);
    expect(sixth).toMatchObject({ ok: false, status: 423, error: "locked", until: new Date(clock + 15 * 60_000).toISOString() });
    // the right password on the locked device: still locked, the password is not even tried
    const tried = vi.spyOn(d.auth, "signInWithPassword");
    expect(await logIn(d, { login: b.login, password: PASSWORD }, his)).toMatchObject({ status: 423 });
    expect(tried).not.toHaveBeenCalled();
    // another device is not affected
    expect((await logIn(d, { login: b.login, password: PASSWORD }, phone())).ok).toBe(true);
    // 15 minutes later this device logs in again
    clock += 15 * 60_000 + 1000;
    expect((await logIn(d, { login: b.login, password: PASSWORD }, his)).ok).toBe(true);
  });

  it("a right password clears the count; a browser without a device cookie is counted by its address", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    const his = phone();
    for (let i = 1; i <= 5; i++) await logIn(d, { login: b.login, password: `wrong ${i} guess` }, his);
    // the sixth attempt with the right password signs in (only a sixth WRONG one locks), and the count starts again
    expect((await logIn(d, { login: b.login, password: PASSWORD }, his)).ok).toBe(true);
    for (let i = 1; i <= 2; i++) expect(await logIn(d, { login: b.login, password: `wrong ${i} guess` }, his)).toMatchObject({ status: 401 });
    // no cookie: a new device id each time, but the same address is the same bucket (another account: this one's hour
    // would otherwise reach the slow-down, which has its own tests below)
    const b2 = body();
    await signUp(d, b2, phone());
    const fresh = () => phone({ knownDevice: false, deviceId: newDeviceId(), ip: "10.9.9.9" });
    for (let i = 1; i <= 5; i++) expect(await logIn(d, { login: b2.login, password: `cookie-less ${i}` }, fresh())).toMatchObject({ status: 401 });
    expect(await logIn(d, { login: b2.login, password: "cookie-less 6" }, fresh())).toMatchObject({ status: 423 });
    // the same address with another login is another bucket
    expect((await logIn(d, { login: b.login, password: PASSWORD }, fresh())).ok).toBe(true);
  });

  it("failures older than 15 minutes no longer count towards the lock", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    const his = phone();
    for (let i = 1; i <= 5; i++) await logIn(d, { login: b.login, password: `wrong ${i} guess` }, his);
    clock += 15 * 60_000 + 1000;
    expect(await logIn(d, { login: b.login, password: "one more wrong" }, his)).toMatchObject({ status: 401 });
    expect((await logIn(d, { login: b.login, password: PASSWORD }, his)).ok).toBe(true);
  });

  it("the counts live in the store: after a restart of the app code the sixth wrong password still locks", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    const his = phone();
    for (let i = 1; i <= 3; i++) expect(await logIn(d, { login: b.login, password: `before ${i} restart` }, his)).toMatchObject({ status: 401 });
    // a restart: every module of the account layer is loaded again, with a new identity provider, so nothing the old
    // process kept in memory survives; the store object stands for the database, which keeps its rows
    const restart = async () => {
      vi.resetModules();
      const service = await import("@/lib/auth/service");
      const { MemoryAuthProvider: FreshProvider } = await import("@/lib/auth/memory");
      return { logIn: service.logIn, deps: { store: d.store, auth: new FreshProvider(), env: d.env } };
    };
    const second = await restart();
    for (let i = 4; i <= 5; i++) expect(await second.logIn(second.deps, { login: b.login, password: `after ${i} restart` }, his)).toMatchObject({ status: 401 });
    expect(await second.logIn(second.deps, { login: b.login, password: "after 6 restart" }, his)).toMatchObject({ status: 423, error: "locked" });
    // the lock itself is a row too: after another restart this device is still locked, and no password is tried
    const third = await restart();
    const tried = vi.spyOn(third.deps.auth, "signInWithPassword");
    expect(await third.logIn(third.deps, { login: b.login, password: PASSWORD }, his)).toMatchObject({ status: 423, until: new Date(clock + 15 * 60_000).toISOString() });
    expect(tried).not.toHaveBeenCalled();
    // another device after the restart is not locked: its password is tried, and the right one signs in
    expect((await third.logIn(third.deps, { login: b.login, password: PASSWORD }, phone())).ok).toBe(true);
    expect(tried).toHaveBeenCalledTimes(1);
  });

  it("per account over all devices: from the tenth wrong password in an hour each attempt first waits 2, 4, 8 ... 60 s, then is judged; it never locks", async () => {
    const waits: number[] = [];
    const d = { ...deps(), wait: async (ms: number) => void waits.push(ms) };
    const b = body();
    await signUp(d, b, phone());
    // nine wrong passwords from nine phones (no single device reaches its own lock): none of them waits
    for (let i = 1; i <= 9; i++) expect(await logIn(d, { login: b.login, password: `guess number ${i}` }, phone())).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    expect(waits).toEqual([]);
    // the tenth attempt on waits first, and is then judged as usual: still the plain 401, never a lock
    const expected = [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000];
    for (let i = 0; i < expected.length; i++) {
      expect(await logIn(d, { login: b.login, password: `guess number ${10 + i}` }, phone())).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
      expect(waits).toEqual(expected.slice(0, i + 1));
    }
    // the right password after the wait signs in: slowed, not locked (on a phone that never failed)
    const tried = vi.spyOn(d.auth, "signInWithPassword");
    const ok = await logIn(d, { login: b.login, password: PASSWORD }, phone());
    expect(ok.ok).toBe(true);
    expect(waits.at(-1)).toBe(60_000);
    expect(waits.length).toBe(expected.length + 1);
    expect(tried).toHaveBeenCalledTimes(1);
    // signing in does not clear the account's count: the next guess is still slowed
    await logIn(d, { login: b.login, password: "another guess" }, phone());
    expect(waits.at(-1)).toBe(60_000);
    // another account is not slowed by this one
    const other = body();
    await signUp(d, other, phone());
    const before = waits.length;
    expect((await logIn(d, { login: other.login, password: PASSWORD }, phone())).ok).toBe(true);
    expect(waits.length).toBe(before);
    // an hour after the first wrong password the count is gone
    clock += 3600_000 + 1000;
    expect((await logIn(d, { login: b.login, password: PASSWORD }, phone())).ok).toBe(true);
    expect(waits.length).toBe(before);
  });

  it("the slow-down is the same for a login nobody has (it tells nothing), and a locked device does not wait", async () => {
    const waits: number[] = [];
    const d = { ...deps(), wait: async (ms: number) => void waits.push(ms) };
    const ghost = login();
    for (let i = 1; i <= 9; i++) expect(await logIn(d, { login: ghost, password: `nobody home ${i}` }, phone())).toMatchObject({ status: 401, error: "invalid_credentials" });
    expect(waits).toEqual([]);
    expect(await logIn(d, { login: ghost, password: "nobody home 10" }, phone())).toMatchObject({ status: 401, error: "invalid_credentials" });
    expect(waits).toEqual([2000]);
    // one phone that reaches its own lock answers 423 at once, with no wait and no password tried
    const b = body();
    await signUp(d, b, phone());
    const his = phone();
    for (let i = 1; i <= 6; i++) await logIn(d, { login: b.login, password: `locked out ${i}` }, his);
    const n = waits.length;
    expect(await logIn(d, { login: b.login, password: PASSWORD }, his)).toMatchObject({ status: 423 });
    expect(waits.length).toBe(n);
  });

  it("「这不是我的手机」 is kept on the sign-in and its session", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    const r = await logIn(d, { login: b.login, password: PASSWORD, not_my_phone: true }, phone());
    expect(r.ok && r.signedIn.since.ephemeral).toBe(true);
    if (!r.ok) return;
    const sessions = await d.auth.listSessions(r.signedIn.tokens.user_id);
    expect(sessions.at(-1)).toMatchObject({ ephemeral: true, ended_at: null });
  });
});

describe("log out", () => {
  it("this device, or every device", async () => {
    const d = deps();
    const b = body();
    const s = await signUp(d, b, phone());
    if (!s.ok) throw new Error("sign-up");
    const other = await logIn(d, { login: b.login, password: PASSWORD }, phone());
    if (!other.ok) throw new Error("log-in");
    const sid = (t: string) => tokenClaims(t).sessionId;
    await logOut(d, s.signedIn.tokens.access_token, false, s.signedIn.tokens.user_id);
    expect(await d.auth.sessionAlive(sid(s.signedIn.tokens.access_token))).toBe(false);
    expect(await d.auth.sessionAlive(sid(other.signedIn.tokens.access_token))).toBe(true);
    const third = await logIn(d, { login: b.login, password: PASSWORD }, phone());
    if (!third.ok) throw new Error("log-in");
    await logOut(d, third.signedIn.tokens.access_token, true, third.signedIn.tokens.user_id);
    expect(await d.auth.sessionAlive(sid(other.signedIn.tokens.access_token))).toBe(false);
    expect(await d.auth.sessionAlive(sid(third.signedIn.tokens.access_token))).toBe(false);
    expect((await d.store.listAccountEvents(third.signedIn.tokens.user_id)).map((e) => e.kind)).toContain("logout_everywhere");
  });
});

describe("recovery with the code", () => {
  it("resets the password, ends every old session, gives a new code; the used code no longer works", async () => {
    const d = deps();
    const b = body();
    const s = await signUp(d, b, phone());
    if (!s.ok) throw new Error("sign-up");
    const tablet = await logIn(d, { login: b.login, password: PASSWORD }, phone());
    if (!tablet.ok) throw new Error("log-in");
    const his = phone();
    const r = await recover(d, { login: b.login, code: s.answer.recovery_code.toLowerCase().replace(/-/g, " "), password: NEW_PASSWORD }, his);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).not.toBe(s.answer.recovery_code);
    expect(r.next).toBe("/onboard");
    // old sessions are gone, the new one is open
    for (const t of [s.signedIn.tokens, tablet.signedIn.tokens]) expect(await d.auth.sessionAlive(tokenClaims(t.access_token).sessionId)).toBe(false);
    expect(await d.auth.sessionAlive(tokenClaims(r.signedIn.tokens.access_token).sessionId)).toBe(true);
    // the new password works, the old one does not
    expect((await logIn(d, { login: b.login, password: NEW_PASSWORD }, phone())).ok).toBe(true);
    expect(await logIn(d, { login: b.login, password: PASSWORD }, phone())).toMatchObject({ status: 401 });
    // the used code: refused; the new one works once
    expect(await recover(d, { login: b.login, code: s.answer.recovery_code, password: "another new one 9" }, phone())).toEqual({ ok: false, status: 401, error: "invalid_recovery" });
    expect((await recover(d, { login: b.login, code: r.code, password: "another new one 9" }, phone())).ok).toBe(true);
    const events = (await d.store.listAccountEvents(r.signedIn.tokens.user_id)).map((e) => [e.kind, e.detail]);
    expect(events).toContainEqual(["password_reset", { method: "recovery_code" }]);
  });

  it("works on a device the login lock has locked, and lifts that lock", async () => {
    const d = deps();
    const b = body();
    const s = await signUp(d, b, phone());
    if (!s.ok) throw new Error("sign-up");
    const his = phone();
    for (let i = 1; i <= 6; i++) await logIn(d, { login: b.login, password: `forgot it ${i}` }, his);
    expect(await logIn(d, { login: b.login, password: PASSWORD }, his)).toMatchObject({ status: 423 });
    expect((await recover(d, { login: b.login, code: s.answer.recovery_code, password: NEW_PASSWORD }, his)).ok).toBe(true);
    expect((await logIn(d, { login: b.login, password: NEW_PASSWORD }, his)).ok).toBe(true);
  });

  it("a wrong code or an unknown login is one refusal; five tries an hour per login; a weak new password is refused first", async () => {
    const d = deps();
    const b = body();
    const s = await signUp(d, b, phone());
    if (!s.ok) throw new Error("sign-up");
    expect(await recover(d, { login: login(), code: s.answer.recovery_code, password: NEW_PASSWORD }, phone())).toEqual({ ok: false, status: 401, error: "invalid_recovery" });
    // five tries an hour for one login (the weak password above was the first): the sixth is refused, right code or not
    expect(await recover(d, { login: b.login, code: "AAAA-AAAA-AAAA", password: "1234" }, phone())).toMatchObject({ status: 400, error: "password_short" });
    for (let i = 0; i < 4; i++) expect(await recover(d, { login: b.login, code: "AAAA-AAAA-AAAA", password: NEW_PASSWORD }, phone())).toMatchObject({ status: 401 });
    expect(await recover(d, { login: b.login, code: s.answer.recovery_code, password: NEW_PASSWORD }, phone())).toMatchObject({ status: 429, error: "too_many" });
  });
});

describe("his own: a new password, a new code, his devices, /api/me", () => {
  it("a new password needs the current one; other devices are signed out, this one goes on", async () => {
    const d = deps();
    const b = body();
    const here = phone();
    const s = await signUp(d, b, here);
    if (!s.ok) throw new Error("sign-up");
    const other = await logIn(d, { login: b.login, password: PASSWORD }, phone());
    if (!other.ok) throw new Error("log-in");
    const m = await me(d, s.signedIn.tokens.access_token);
    expect(await changePassword(d, m, { current: "not it at all", password: NEW_PASSWORD }, here)).toEqual({ ok: false, status: 401, error: "wrong_password" });
    expect(await changePassword(d, m, { current: PASSWORD, password: "1234567" }, here)).toMatchObject({ status: 400, error: "password_short" });
    const r = await changePassword(d, m, { current: PASSWORD, password: NEW_PASSWORD }, here);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await d.auth.sessionAlive(tokenClaims(other.signedIn.tokens.access_token).sessionId)).toBe(false);
    expect(await d.auth.sessionAlive(tokenClaims(s.signedIn.tokens.access_token).sessionId)).toBe(false);
    expect(await d.auth.sessionAlive(tokenClaims(r.signedIn.tokens.access_token).sessionId)).toBe(true);
    expect((await logIn(d, { login: b.login, password: NEW_PASSWORD }, phone())).ok).toBe(true);
  });

  it("the sixth wrong current password locks that page on this device", async () => {
    const d = deps();
    const b = body();
    const here = phone();
    const s = await signUp(d, b, here);
    if (!s.ok) throw new Error("sign-up");
    const m = await me(d, s.signedIn.tokens.access_token);
    for (let i = 1; i <= 5; i++) expect(await regenerateRecoveryCode(d, m, { password: `nope ${i} nope` }, here)).toMatchObject({ status: 401, error: "wrong_password" });
    expect(await regenerateRecoveryCode(d, m, { password: "nope 6 nope" }, here)).toMatchObject({ status: 423, error: "locked" });
    expect(await regenerateRecoveryCode(d, m, { password: PASSWORD }, here)).toMatchObject({ status: 423 });
  });

  it("a new recovery code replaces the old one", async () => {
    const d = deps();
    const b = body();
    const here = phone();
    const s = await signUp(d, b, here);
    if (!s.ok) throw new Error("sign-up");
    const r = await regenerateRecoveryCode(d, await me(d, s.signedIn.tokens.access_token), { password: PASSWORD }, here);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = (await d.store.getRecoveryCode(s.signedIn.tokens.user_id))!.code_hash;
    expect(await recoveryCodeMatches(r.code, stored, d.env)).toBe(true);
    expect(await recoveryCodeMatches(s.answer.recovery_code, stored, d.env)).toBe(false);
  });

  it("his devices: this one first; signing another out ends its session at once; naming this one signs this browser out", async () => {
    const d = deps();
    const b = body();
    const here = phone();
    const tablet = phone({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" });
    const s = await signUp(d, b, here);
    if (!s.ok) throw new Error("sign-up");
    const t = await logIn(d, { login: b.login, password: PASSWORD, not_my_phone: true }, tablet);
    if (!t.ok) throw new Error("log-in");
    const m = await me(d, s.signedIn.tokens.access_token);
    const list = await listDevices(d, m, here);
    expect(list.map((v) => [v.label, v.current, v.signed_in, v.ephemeral])).toEqual([
      ["iPhone · Safari", true, true, false],
      ["Android · Chrome", false, true, true],
    ]);
    expect(list[1].ref).toBe(deviceRef(deviceHash(tablet.deviceId)));
    expect(JSON.stringify(list)).not.toContain(deviceHash(tablet.deviceId)); // only the short ref leaves
    expect(await signOutDevice(d, m, list[1].ref, here)).toEqual({ ok: true, ended: 1, current: false });
    expect(await d.auth.sessionAlive(tokenClaims(t.signedIn.tokens.access_token).sessionId)).toBe(false);
    expect((await listDevices(d, m, here))[1].signed_in).toBe(false);
    expect(await signOutDevice(d, m, "0".repeat(16), here)).toMatchObject({ status: 404, error: "device_not_found" });
    expect(await signOutDevice(d, m, list[0].ref, here)).toEqual({ ok: true, ended: 1, current: true });
  });

  it("/api/me: no user id, no scope id; his login, his space in short, the latest decision per consent", async () => {
    const d = deps();
    const b = body({ space: "example", assisted: true, consents: body({ space: "example" }).consents });
    const s = await signUp(d, b, phone());
    if (!s.ok) throw new Error("sign-up");
    const m = await me(d, s.signedIn.tokens.access_token);
    const answer = await meAnswer(d, m);
    expect(answer.account).toMatchObject({ login: b.login, login_kind: "username", display_name: "陈先生", locale: "zh-Hans" });
    expect(answer.scope).toMatchObject({ example_data: true, onboarding: "done", tz: "Asia/Singapore", today: "2026-10-10" });
    expect(answer.consents.map((c) => [c.kind, c.decision, c.assisted])).toEqual([
      ["terms_privacy", "granted", true],
      ["ai_processing", "granted", true],
      ["example_data", "granted", true],
    ]);
    expect(JSON.stringify(answer)).not.toContain(m.userId);
  });
});

describe("the identity provider failing", () => {
  it("a provider that is down during a log-in is an error for the route, not a wrong password", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone());
    vi.spyOn(d.auth, "signInWithPassword").mockRejectedValueOnce(new AuthError("unavailable", "down"));
    await expect(logIn(d, { login: b.login, password: PASSWORD }, phone())).rejects.toMatchObject({ code: "unavailable" });
  });
});
