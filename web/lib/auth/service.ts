/**
 * The account flows (docs/plan/real-app.md 2.2-2.4, 2.23, 3.4-3.6): sign up, log in, log out, a new password, a new
 * recovery code, recovery with the code, his devices. Server-only. Pure apart from the store and the identity provider
 * it is given: the routes (app/api/auth/**) get the process-wide ones from lib/subject/account.ts; the tests pass their
 * own. Every flow answers { ok: true, ... } or a refusal { ok: false, status, error, until? } the route sends as is.
 *
 * What every flow keeps to:
 *   - one generic refusal for a wrong login or password (never which one), the lockout per login × device (the sixth
 *     wrong password in 15 minutes), the slow-down per login over all devices (lib/auth/limits.ts has the exact rule);
 *   - passwords are NFKC-normalised before the provider sees them (lib/auth/passwords.ts);
 *   - a new password, a recovery reset, 「退出所有设备」 and signing a device out end the sessions they should, in the
 *     registry (their tokens stop working at once) and at the provider where a token allows it;
 *   - account events say what happened, never patient content;
 *   - a sign-up that fails after the identity was made removes everything it made (no half account).
 */
import type { Env } from "@/lib/dev/enabled";
import type { Notice } from "@/lib/jobs/notify";
import { CURRENT_CONSENT_VERSIONS, consentText, type ConsentLocale, type SignupConsentKind } from "@/lib/privacy/consent-texts";
import { assistedEvidence } from "@/lib/privacy/consents";
import { seedAccount } from "@/lib/story/example";
import { StoreError, type AccountRow, type SessionRow, type Store } from "@/lib/store/types";
import type { AuthRouteError, DeviceView, MeAnswer, SignupAnswer, SignupBody } from "./api";
import { deviceHash, deviceLabel, deviceRef } from "./device";
import { tokenClaims } from "./jwt";
import { bucketKey, clearFailures, hitLimit, LIMITS, lockBuckets, lockState, noteFailure, noteLoginFailure, slowdownFor } from "./limits";
import { parseLoginName, type LoginName } from "./login-name";
import { destinationAfterSignIn } from "./next";
import { normalizePassword, passwordProblem } from "./passwords";
import { AuthError, EPHEMERAL_SIGN_IN_MAX_S, REFRESH_TOKEN_TTL_S, type AuthProvider, type AuthSessionInfo, type AuthTokens } from "./provider";
import { hashRecoveryCode, newRecoveryCode, normalizeRecoveryCode, recoveryCodeMatches } from "./recovery";
import type { SignInSince } from "./since";
import { realNowMs } from "@/lib/time/now";

export interface AccountDeps {
  store: Store;
  auth: AuthProvider;
  env?: Env;
  /** how the login's slow-down waits (real-app 3.5); the tests pass their own so they stay fast */
  wait?: (ms: number) => Promise<void>;
  /** the app's clock in epoch ms (lib/time/now.ts nowMs, the one the store stamps rows with); the tests pass their own */
  now?: () => number;
  /** where 「爸爸在重设密码」 goes (default lib/jobs/notify.ts sendNotice: track I's web push); the tests pass their own */
  sendNotice?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
}

const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What the routes know about the request. */
export interface RequestFacts {
  /** the client's address (hashed before it names a bucket) */
  ip: string;
  /** this browser's rp_device id (a new one when it had none: the route sets the cookie) */
  deviceId: string;
  /** the id came with the request (false: a browser without a device cookie, counted by its IP) */
  knownDevice: boolean;
  userAgent: string | null;
}

export type Refusal = { ok: false; status: number; error: AuthRouteError; until?: string };

/** A sign-in the route turns into cookies. */
export interface SignedIn {
  tokens: AuthTokens;
  since: SignInSince;
  /** his UI language (rp_lang) */
  locale: string | null;
}

export const refuse = (status: number, error: AuthRouteError, until?: string): Refusal => (until ? { ok: false, status, error, until } : { ok: false, status, error });

const env = (d: AccountDeps): Env => d.env ?? process.env;
/** The environment a flow reads its secrets and switches from (lib/auth/family-reset.ts shares these few helpers). */
export const envOf = env;

/**
 * The device part of the lockout buckets: the device's hash; a browser without a device cookie is counted on the id it
 * is about to be given and on its address (lib/auth/limits.ts lockBuckets).
 */
export function deviceKeys(facts: RequestFacts, d: AccountDeps): string[] {
  const own = deviceHash(facts.deviceId).slice(0, 32);
  return facts.knownDevice ? [own] : [own, `ip-${bucketKey("ip", facts.ip, env(d))}`];
}

export function signInContext(facts: RequestFacts, ephemeral: boolean) {
  return { deviceHash: deviceHash(facts.deviceId), deviceLabel: deviceLabel(facts.userAgent), ephemeral };
}

/** A new account's language: what the sign-up screen was in, English unless it says 华语 (owner 10-15: English by default). */
function asLocale(locale: string | null | undefined): ConsentLocale {
  return locale === "zh-Hans" ? "zh-Hans" : "en";
}

/** The login as he types it: his username, or his address. */
export function loginShown(login: LoginName): string {
  return login.kind === "username" ? login.username : login.email;
}

/** His login, from his account row and (for an e-mail account) the address in his token. */
export function loginOf(account: AccountRow, email: string | null): LoginName | null {
  if (account.login_kind === "username" && account.username) {
    const parsed = parseLoginName(account.username);
    return parsed.ok ? parsed.login : null;
  }
  return email ? { kind: "email", email: email.toLowerCase() } : null;
}

export async function remember(d: AccountDeps, userId: string, facts: RequestFacts): Promise<void> {
  await d.store.touchKnownDevice(userId, deviceHash(facts.deviceId), deviceLabel(facts.userAgent)).catch(() => undefined);
  await d.store.updateAccount(userId, { last_seen_at: new Date(realNowMs()).toISOString() }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------- is the name free

export async function checkLogin(d: AccountDeps, input: string, facts: RequestFacts): Promise<{ ok: true; kind: LoginName["kind"] } | Refusal> {
  const limited = await hitLimit(d.store, `a:cl:${bucketKey("ip", facts.ip, env(d))}`, LIMITS.checkLoginPerIp, env(d));
  if (!limited.ok) return refuse(429, "too_many", limited.until);
  const parsed = parseLoginName(input, env(d));
  if (!parsed.ok) return refuse(400, parsed.error);
  const taken =
    parsed.login.kind === "username"
      ? !!(await d.store.getAccountByUsername(parsed.login.username)) || !!(await d.auth.findUserIdByEmail(parsed.login.email))
      : !!(await d.auth.findUserIdByEmail(parsed.login.email));
  return taken ? refuse(409, "login_taken") : { ok: true, kind: parsed.login.kind };
}

// ---------------------------------------------------------------------------------------------- sign up

/**
 * Sign up (real-app 3.4, in this order): the limits; the login, password and consent versions; the identity (address
 * confirmed, no mail); his account row; his space through track C's seedAccount (blank, or Mr Tan's example on today's
 * dates; none for a family member with no space of her own); the consent records (version, text hash, method,
 * assisted); a recovery code (returned this once); his device; a session for this browser. A failure after the identity
 * exists removes all of it.
 */
export async function signUp(d: AccountDeps, body: SignupBody, facts: RequestFacts): Promise<{ ok: true; signedIn: SignedIn; answer: SignupAnswer } | Refusal> {
  const e = env(d);
  const ip = bucketKey("ip", facts.ip, e);
  for (const [bucket, limit] of [
    [`a:si:${ip}`, LIMITS.signupPerIpHour],
    [`a:sd:${ip}`, LIMITS.signupPerIpDay],
    ["a:ss", LIMITS.signupSiteDay],
    ...(body.space === "example" ? [[`a:se:${ip}`, LIMITS.examplePerIpHour] as const] : []),
  ] as const) {
    const r = await hitLimit(d.store, bucket, limit, e);
    if (!r.ok) return refuse(429, "too_many", r.until);
  }

  const parsed = parseLoginName(body.login, e);
  if (!parsed.ok) return refuse(400, parsed.error);
  const login = parsed.login;
  const password = normalizePassword(body.password);
  const problem = passwordProblem(password, login);
  if (problem) return refuse(400, problem);

  const locale = asLocale(body.locale);
  const kinds: SignupConsentKind[] = ["terms_privacy", "ai_processing", ...(body.space === "example" ? (["example_data"] as const) : [])];
  for (const kind of kinds) {
    const given = kind === "terms_privacy" ? body.consents.terms_privacy : kind === "ai_processing" ? body.consents.ai_processing : body.consents.example_data;
    if (!given?.version) return refuse(400, "consent_required");
    if (given.version !== CURRENT_CONSENT_VERSIONS[kind] || !consentText(kind, given.version, locale)) return refuse(409, "consent_version");
  }
  if (login.kind === "username" && (await d.store.getAccountByUsername(login.username))) return refuse(409, "login_taken");

  let userId: string;
  try {
    userId = (await d.auth.createUser({ email: login.email, password, app_metadata: { login_kind: login.kind, ...(login.kind === "username" ? { username: login.username } : {}) } })).id;
  } catch (err) {
    if (err instanceof AuthError && err.code === "user_exists") return refuse(409, "login_taken");
    if (err instanceof AuthError && err.code === "weak_password") return refuse(400, "password_common");
    throw err;
  }

  try {
    try {
      await d.store.createAccount({
        user_id: userId,
        login_kind: login.kind,
        username: login.kind === "username" ? login.username : null,
        display_name: body.display_name.trim(),
        locale,
      });
    } catch (err) {
      if (err instanceof StoreError && err.code === "conflict") throw Object.assign(new Error("login_taken"), { refusal: refuse(409, "login_taken") });
      throw err;
    }
    // his space: track C's seedAccount (blank, or the example on today's dates), his UI language kept in its settings
    const scope = body.space === "none" ? null : await seedAccount(d.store, { userId, space: body.space, settings: { locale }, ...(d.now ? { nowMs: d.now() } : {}) });

    for (const kind of kinds) {
      const text = consentText(kind, CURRENT_CONSENT_VERSIONS[kind], locale)!;
      await d.store.putConsentText({ kind, version: text.version, locale: text.locale, sha256: text.sha256, text: text.text });
      await d.store.addConsentRecord({
        user_id: userId,
        scope_id: scope?.id ?? null,
        kind,
        decision: kind === "ai_processing" ? body.consents.ai_processing.decision : "granted",
        version: text.version,
        text_sha256: text.sha256,
        method: "signup_screen",
        // real-app 3.11: a record made while family helped says so in words too (track H's note)
        evidence: { locale, screen: kind === "terms_privacy" ? "signup_terms" : kind === "ai_processing" ? "signup_ai" : "signup_space", ...assistedEvidence(body.assisted) },
        assisted: body.assisted === true,
      });
    }

    const code = newRecoveryCode();
    await d.store.setRecoveryCode(userId, await hashRecoveryCode(code, e));
    await d.store.touchKnownDevice(userId, deviceHash(facts.deviceId), deviceLabel(facts.userAgent));
    await d.store.addAccountEvent(userId, "signup", { space: body.space, login_kind: login.kind, assisted: body.assisted === true });
    const tokens = await d.auth.signInWithPassword(login.email, password, signInContext(facts, false));

    const next = body.space === "none" ? "/f" : destinationAfterSignIn(null, scope);
    return {
      ok: true,
      signedIn: { tokens, since: { atMs: realNowMs(), ephemeral: false }, locale },
      answer: { next, recovery_code: code, login: loginShown(login) },
    };
  } catch (err) {
    await d.store.deleteAccount(userId).catch(() => undefined);
    await d.auth.deleteUser(userId).catch(() => undefined);
    const refusal = (err as { refusal?: Refusal }).refusal;
    if (refusal) return refusal;
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------- log in

export interface LoginInput {
  login: string;
  password: string;
  not_my_phone?: boolean;
  next?: string;
}

/**
 * Log in (real-app 3.5): the per-IP limit; this device's lock (423, no password tried); the login's slow-down (from
 * the tenth wrong password in an hour over all devices, the attempt first waits 2, 4, 8 ... 60 s, then is judged as
 * usual); one generic refusal; the sixth wrong password within 15 minutes on this device locks this device.
 */
export async function logIn(d: AccountDeps, input: LoginInput, facts: RequestFacts): Promise<{ ok: true; signedIn: SignedIn; next: string } | Refusal> {
  const e = env(d);
  const limited = await hitLimit(d.store, `a:li:${bucketKey("ip", facts.ip, e)}`, LIMITS.loginPerIp, e);
  if (!limited.ok) return refuse(429, "too_many", limited.until);
  const parsed = parseLoginName(input.login, e);
  if (!parsed.ok) return refuse(401, "invalid_credentials");
  const loginKey = bucketKey("login", parsed.login.email, e);
  const buckets = lockBuckets("login", loginKey, deviceKeys(facts, d));
  const lock = await lockState(d.store, buckets);
  if (lock.locked) return refuse(423, "locked", lock.until);

  // the whole account is never locked, only slowed: the same wait whether the login exists or not
  const slow = await slowdownFor(d.store, loginKey);
  if (slow > 0) await (d.wait ?? realWait)(slow);

  const ephemeral = input.not_my_phone === true;
  let tokens: AuthTokens;
  try {
    tokens = await d.auth.signInWithPassword(parsed.login.email, normalizePassword(input.password), signInContext(facts, ephemeral));
  } catch (err) {
    if (!(err instanceof AuthError && err.code === "invalid_credentials")) throw err;
    await noteLoginFailure(d.store, loginKey);
    const after = await noteFailure(d.store, buckets);
    return after.locked ? refuse(423, "locked", after.until) : refuse(401, "invalid_credentials");
  }
  const account = await d.store.getAccount(tokens.user_id);
  if (!account) {
    // an identity without an app account (a sign-up that never finished): nothing to sign in to
    await d.auth.signOut(tokens.access_token, "local").catch(() => undefined);
    return refuse(401, "invalid_credentials");
  }
  await clearFailures(d.store, buckets);
  await remember(d, tokens.user_id, facts);
  const scope = await ownScope(d.store, tokens.user_id);
  return {
    ok: true,
    signedIn: { tokens, since: { atMs: realNowMs(), ephemeral }, locale: account.locale },
    next: destinationAfterSignIn(input.next, scope),
  };
}

export async function ownScope(store: Store, userId: string): Promise<SessionRow | null> {
  const row = await store.getSession(userId);
  return row && row.kind === "account" ? row : null;
}

// ---------------------------------------------------------------------------------------------- log out

/** Log out this browser, or every device (「退出所有设备」). The cookies are cleared by the route either way. */
export async function logOut(d: AccountDeps, accessToken: string | null, everywhere: boolean, userId: string | null): Promise<void> {
  if (accessToken) {
    try {
      await d.auth.signOut(accessToken, everywhere ? "global" : "local");
    } catch (err) {
      console.warn(`[auth] sign-out at the provider failed: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
      // the registry still ends what it can, so the tokens stop working here
      const { sessionId } = tokenClaims(accessToken);
      if (userId) await d.auth.endSessions(userId, everywhere ? { reason: "logout_everywhere" } : { sessionIds: sessionId ? [sessionId] : [], reason: "logout" }).catch(() => undefined);
    }
  }
  if (userId && everywhere) await d.store.addAccountEvent(userId, "logout_everywhere", {}).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------- the signed-in person's own

/** A signed-in person, as the routes hand it to the flows below. */
export interface Me {
  userId: string;
  sessionId: string | null;
  account: AccountRow;
  /** his address, from his token (an e-mail account's login) */
  email: string | null;
  /** this sign-in is 「这不是我的手机」 */
  ephemeral: boolean;
}

/** Check his current password, with the same lockout as the login (per user × device). */
async function confirmPassword(d: AccountDeps, me: Me, password: string, facts: RequestFacts): Promise<{ ok: true; login: LoginName } | Refusal> {
  const login = loginOf(me.account, me.email);
  if (!login) return refuse(401, "not_signed_in");
  const buckets = lockBuckets("password", bucketKey("user", me.userId, env(d)), deviceKeys(facts, d));
  const lock = await lockState(d.store, buckets);
  if (lock.locked) return refuse(423, "locked", lock.until);
  if (!(await d.auth.checkPassword(login.email, normalizePassword(password)))) {
    const after = await noteFailure(d.store, buckets, LIMITS.passwordFailures);
    return after.locked ? refuse(423, "locked", after.until) : refuse(401, "wrong_password");
  }
  await clearFailures(d.store, buckets);
  return { ok: true, login };
}

/**
 * A new password: his current one first; then every other session ends (other devices log in again), and this browser
 * gets a new session with the new password.
 */
export async function changePassword(d: AccountDeps, me: Me, input: { current: string; password: string }, facts: RequestFacts): Promise<{ ok: true; signedIn: SignedIn } | Refusal> {
  const confirmed = await confirmPassword(d, me, input.current, facts);
  if (!confirmed.ok) return confirmed;
  const next = normalizePassword(input.password);
  const problem = passwordProblem(next, confirmed.login);
  if (problem) return refuse(400, problem);
  await d.auth.updatePassword(me.userId, next);
  const tokens = await d.auth.signInWithPassword(confirmed.login.email, next, signInContext(facts, me.ephemeral));
  await endOthers(d, me.userId, tokens, "password_changed");
  await d.store.addAccountEvent(me.userId, "password_changed", {});
  await remember(d, me.userId, facts);
  return { ok: true, signedIn: { tokens, since: { atMs: realNowMs(), ephemeral: me.ephemeral }, locale: me.account.locale } };
}

/** Every session but the one these tokens belong to: closed in the registry, and at the provider. */
export async function endOthers(d: AccountDeps, userId: string, keep: AuthTokens, reason: string): Promise<void> {
  const { sessionId } = tokenClaims(keep.access_token);
  await d.auth.endSessions(userId, { exceptSessionId: sessionId, reason });
  await d.auth.signOut(keep.access_token, "others").catch((err: unknown) => {
    console.warn(`[auth] ending the other sessions at the provider failed: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
  });
}

/** A new recovery code (his password first); the old one stops working. The code is returned this once. */
export async function regenerateRecoveryCode(d: AccountDeps, me: Me, input: { password: string }, facts: RequestFacts): Promise<{ ok: true; code: string } | Refusal> {
  const confirmed = await confirmPassword(d, me, input.password, facts);
  if (!confirmed.ok) return confirmed;
  const code = newRecoveryCode();
  await d.store.setRecoveryCode(me.userId, await hashRecoveryCode(code, env(d)));
  await d.store.addAccountEvent(me.userId, "recovery_code_regenerated", {});
  return { ok: true, code };
}

// ---------------------------------------------------------------------------------------------- recovery with the code

export interface RecoverInput {
  login: string;
  code: string;
  password: string;
  not_my_phone?: boolean;
}

/**
 * Recovery (real-app 2.4, 3.6): his login, the code on his card, a new password. One generic refusal for a wrong login
 * or code. Then: the new password, every old session ends, this browser is signed in, the used code is replaced by a new
 * one (returned this once) and this device's login lock is lifted. It works on a device the login lock has locked.
 */
export async function recover(d: AccountDeps, input: RecoverInput, facts: RequestFacts): Promise<{ ok: true; signedIn: SignedIn; code: string; next: string } | Refusal> {
  const e = env(d);
  const ipLimit = await hitLimit(d.store, `a:ri:${bucketKey("ip", facts.ip, e)}`, LIMITS.recoverPerIp, e);
  if (!ipLimit.ok) return refuse(429, "too_many", ipLimit.until);
  const parsed = parseLoginName(input.login, e);
  if (!parsed.ok) return refuse(401, "invalid_recovery");
  const loginKey = bucketKey("login", parsed.login.email, e);
  const loginLimit = await d.store.rateHit(`a:rl:${loginKey}`, LIMITS.recoverPerLogin.windowS, LIMITS.recoverPerLogin.limit);
  if (!loginLimit.allowed) return refuse(429, "too_many", loginLimit.reset_at);

  const password = normalizePassword(input.password);
  const problem = passwordProblem(password, parsed.login);
  if (problem) return refuse(400, problem);

  const userId =
    parsed.login.kind === "username" ? ((await d.store.getAccountByUsername(parsed.login.username))?.user_id ?? null) : await d.auth.findUserIdByEmail(parsed.login.email);
  const account = userId ? await d.store.getAccount(userId) : null;
  const stored = account ? await d.store.getRecoveryCode(account.user_id) : null;
  if (!(await recoveryCodeMatches(input.code, stored?.code_hash, e)) || !account) return refuse(401, "invalid_recovery");

  // the new password first (if it fails nothing has changed and the code still works), then the spent code is replaced
  await d.auth.updatePassword(account.user_id, password);
  const code = newRecoveryCode();
  await d.store.setRecoveryCode(account.user_id, await hashRecoveryCode(code, e));
  const ephemeral = input.not_my_phone === true;
  const tokens = await d.auth.signInWithPassword(parsed.login.email, password, signInContext(facts, ephemeral));
  await endOthers(d, account.user_id, tokens, "recovery");
  await clearFailures(d.store, lockBuckets("login", loginKey, deviceKeys(facts, d)));
  await d.store.clearRate(`a:rl:${loginKey}`);
  await d.store.addAccountEvent(account.user_id, "password_reset", { method: "recovery_code" });
  await remember(d, account.user_id, facts);
  const scope = await ownScope(d.store, account.user_id);
  return {
    ok: true,
    signedIn: { tokens, since: { atMs: realNowMs(), ephemeral }, locale: account.locale },
    code,
    next: destinationAfterSignIn(null, scope),
  };
}

/** Is this something he could have typed as a recovery code (for the page's own check)? */
export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input) !== null;
}

// ---------------------------------------------------------------------------------------------- his devices

/** Is a registry session still signed in for his devices page (open, and not past what the cookies allow)? */
function liveSession(s: AuthSessionInfo, nowMs: number): boolean {
  if (s.ended_at) return false;
  if (s.ephemeral) return nowMs - Date.parse(s.created_at) < EPHEMERAL_SIGN_IN_MAX_S * 1000;
  return nowMs - Date.parse(s.last_seen_at) < REFRESH_TOKEN_TTL_S * 1000;
}

/** His devices (the ones he signed in on), this one first, then the most recently used. */
export async function listDevices(d: AccountDeps, me: Me, facts: RequestFacts): Promise<DeviceView[]> {
  const now = realNowMs();
  const [known, sessions] = await Promise.all([d.store.listKnownDevices(me.userId), d.auth.listSessions(me.userId)]);
  const current = deviceHash(facts.deviceId);
  const byHash = new Map<string, DeviceView & { hash: string }>();
  for (const k of known) {
    byHash.set(k.device_hash, {
      hash: k.device_hash,
      ref: deviceRef(k.device_hash),
      label: k.label,
      current: k.device_hash === current,
      signed_in: false,
      ephemeral: false,
      first_seen_at: k.first_seen_at,
      last_seen_at: k.last_seen_at,
    });
  }
  for (const s of sessions) {
    if (!s.device_hash) continue;
    let v = byHash.get(s.device_hash);
    if (!v) {
      v = { hash: s.device_hash, ref: deviceRef(s.device_hash), label: s.device_label, current: s.device_hash === current, signed_in: false, ephemeral: false, first_seen_at: s.created_at, last_seen_at: s.last_seen_at };
      byHash.set(s.device_hash, v);
    }
    if (!v.label && s.device_label) v.label = s.device_label;
    if (Date.parse(s.last_seen_at) > Date.parse(v.last_seen_at)) v.last_seen_at = s.last_seen_at;
    if (liveSession(s, now)) {
      v.signed_in = true;
      v.ephemeral = v.ephemeral || s.ephemeral;
    }
  }
  return [...byHash.values()]
    .sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
    .map((v): DeviceView => ({ ref: v.ref, label: v.label, current: v.current, signed_in: v.signed_in, ephemeral: v.ephemeral, first_seen_at: v.first_seen_at, last_seen_at: v.last_seen_at }));
}

/** Sign one of his devices out (「退出这台」). Returns whether it was this browser (the route then clears its cookies). */
export async function signOutDevice(d: AccountDeps, me: Me, ref: string, facts: RequestFacts): Promise<{ ok: true; ended: number; current: boolean } | Refusal> {
  if (!/^[0-9a-f]{16}$/.test(ref)) return refuse(404, "device_not_found");
  const [known, sessions] = await Promise.all([d.store.listKnownDevices(me.userId), d.auth.listSessions(me.userId)]);
  const hashes = new Set([...known.map((k) => k.device_hash), ...sessions.map((s) => s.device_hash).filter((h): h is string => !!h)]);
  const hash = [...hashes].find((h) => deviceRef(h) === ref);
  if (!hash) return refuse(404, "device_not_found");
  const ended = await d.auth.endSessions(me.userId, { deviceHash: hash, reason: "device_signed_out" });
  // C2 track D (only add; 0015_d_push_device.sql): that device's push subscriptions go with its sign-in, so a phone he
  // signed out from another phone stops getting his reminders. Never fails the sign-out.
  const pushes = await removeDevicePushes(d.store, me.userId, hash);
  await d.store.addAccountEvent(me.userId, "device_signed_out", { device: ref, sessions: ended, push_subscriptions: pushes });
  return { ok: true, ended, current: hash === deviceHash(facts.deviceId) };
}

/** C2 track D (only add): his push subscriptions made on one device (push_subscription.device_hash); how many went. */
export async function removeDevicePushes(store: Pick<AccountDeps["store"], "listPushSubscriptions" | "deleteOwnPushSubscription">, userId: string, hash: string): Promise<number> {
  let removed = 0;
  try {
    for (const sub of await store.listPushSubscriptions(userId)) {
      if (sub.device_hash === hash && (await store.deleteOwnPushSubscription(userId, sub.endpoint))) removed += 1;
    }
  } catch {
    // the sessions are already ended; the subscriptions go with 「退出所有设备」 or the push service's 410
  }
  return removed;
}

// ---------------------------------------------------------------------------------------------- GET /api/me

export async function meAnswer(d: AccountDeps, me: Me): Promise<MeAnswer> {
  const scope = await ownScope(d.store, me.userId);
  const [asPatient, asFamily, consents] = await Promise.all([
    d.store.listCareLinks({ patient_id: me.userId }),
    d.store.listCareLinks({ family_id: me.userId }),
    d.store.listConsentRecords(me.userId),
  ]);
  const latest = new Map<string, (typeof consents)[number]>();
  for (const c of consents) latest.set(c.kind, c);
  const login = loginOf(me.account, me.email);
  return {
    account: {
      login: login ? loginShown(login) : null,
      login_kind: me.account.login_kind,
      display_name: me.account.display_name,
      locale: me.account.locale,
      created_at: me.account.created_at,
    },
    scope: scope
      ? { example_data: scope.example_data === true, onboarding: scope.onboarding ?? null, d0: scope.d0 ?? "", tz: scope.tz ?? "Asia/Singapore", today: todayOf(scope) }
      : null,
    links: {
      as_patient: asPatient.map((l) => ({ id: l.id, relation: l.relation, family_label: l.family_label, status: l.status, confirmed_at: l.confirmed_at })),
      as_family: asFamily.map((l) => ({ id: l.id, relation: l.relation, patient_label: l.patient_label, status: l.status })),
    },
    consents: [...latest.values()].map((c) => ({ kind: c.kind, decision: c.decision, version: c.version, assisted: c.assisted, at: c.created_at })),
    session: { ephemeral: me.ephemeral },
  };
}

/** His date today ("YYYY-MM-DD"): day 0 plus the scope's computed day. */
function todayOf(scope: SessionRow): string {
  const [y, m, dd] = (scope.d0 ?? "1970-01-01").split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + scope.story_day * 86_400_000).toISOString().slice(0, 10);
}
