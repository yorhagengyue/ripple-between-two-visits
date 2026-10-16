/**
 * Family-assisted password reset (docs/plan/real-app.md 2.4, 3.6; track A). Off until he turns it on. Server-only; pure
 * apart from the store and the identity provider it is given (lib/auth/service.ts AccountDeps).
 *
 * The four steps, and the rule each one keeps:
 *
 *   1. setResetHelper        Signed in, he turns 「忘记密码时，让 Wei Ling 帮我」 on (or off) for one of his own ACTIVE
 *                            links (care_link.reset_helper, false until then). Each change that changes something writes
 *                            a consent record family_reset_helper (granted / withdrawn) through track H's recordConsent
 *                            (lib/privacy/consents.ts: the version and hash of the text his screen shows,
 *                            lib/privacy/consent-texts-more.ts) and an account event.
 *   2. requestFamilyHelp     Signed out, he asks for help with his login. It works only on a phone he has used: the
 *                            browser came WITH an rp_device cookie whose hash is in his known_device rows and was last
 *                            used within 180 days; and only while at least one active link has the switch on. Then a
 *                            reset_request is made: 10 minutes, bound to that device, no code yet; an older open request
 *                            of his is closed. Anything else (unknown login, another phone, switch off) is one refusal,
 *                            help_unavailable, that never says which. Three requests per account a day (429 after).
 *                            Each helper is then told once, 「爸爸在重设密码」 (lib/auth/family-reset-notice.ts).
 *   3. issueFamilyResetCode  She, signed in, through her active link whose switch is on, is given a 6-digit code for
 *                            his open request (pendingFamilyHelp tells her page there is one). Only the code's hash is
 *                            kept (HMAC with RECOVERY_PEPPER and the request id); a second code replaces the first.
 *                            Three codes per account (his) a day (429 after).
 *   4. recoverWithFamily     He types the code and a new password on the SAME device that asked (the request's
 *                            device_hash is this browser's). Wrong account, another phone (hers, or one he never used),
 *                            no code yet, a wrong code, more than 10 minutes, a link that ended or a switch he turned
 *                            off since: one refusal, invalid_family_code. Four wrong codes are counted; the fifth
 *                            spends the request. On success: the new password, every earlier session of his ends, this
 *                            browser is signed in, the request is spent (one use), the switch stays as it was, and an
 *                            account event password_reset { method: "family_assisted", link_id, helper } is written
 *                            (his Today page then says who helped: lib/auth/notices.ts).
 *
 * She never sees his password and nothing here changes what he shares with her. The code is useless on her phone:
 * step 4 answers only the device that made the request.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Env } from "@/lib/dev/enabled";
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import { recordConsent } from "@/lib/privacy/consents";
import type { AccountRow, CareLinkRow, ResetRequestRow } from "@/lib/store/types";
import type { FamilyHelpAnswer, FamilyHelpState, ResetHelperView } from "./api";
import { nowMs as appNowMs, realNowMs } from "@/lib/time/now";
import { deviceHash } from "./device";
import { announceFamilyHelp } from "./family-reset-notice";
import { bucketKey, clearFailures, hitLimit, LIMITS, lockBuckets } from "./limits";
import { parseLoginName, type LoginName } from "./login-name";
import { destinationAfterSignIn } from "./next";
import { normalizePassword, passwordProblem } from "./passwords";
import { authSecret } from "./secrets";
import { deviceKeys, endOthers, envOf, ownScope, refuse, remember, signInContext, type AccountDeps, type Me, type Refusal, type RequestFacts, type SignedIn } from "./service";

/** How long a request (and its code) lasts. */
export const RESET_REQUEST_TTL_MS = 10 * 60_000;
/** "A phone he has used": its last use is at most this long ago. */
export const KNOWN_DEVICE_MAX_AGE_MS = 180 * 24 * 3600 * 1000;

const now = (d: AccountDeps): number => (d.now ?? appNowMs)();

// ---------------------------------------------------------------------------------------------- the 6-digit code

/** A new code: six digits, every value equally likely ("004711" keeps its zeros). */
export function newResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** What he typed as a code: spaces and dashes dropped, full-width digits accepted; null when it is not six digits. */
export function normalizeResetCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const n = input.normalize("NFKC").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(n) ? n : null;
}

/** The stored form of a code: an HMAC keyed by RECOVERY_PEPPER over the request id and the code (hex). */
export function hashResetCode(requestId: string, code: string, env: Env = process.env): string {
  return createHmac("sha256", authSecret("RECOVERY_PEPPER", env)).update(`family-reset:${requestId}:${code}`, "utf8").digest("hex");
}

/** Does what he typed match the request's stored hash? Compared in constant time; always one comparison. */
export function resetCodeMatches(requestId: string, input: unknown, stored: string | null | undefined, env: Env = process.env): boolean {
  const n = normalizeResetCode(input);
  const got = Buffer.from(hashResetCode(requestId, n ?? "------", env), "hex");
  const want = Buffer.from(stored && /^[0-9a-f]{64}$/.test(stored) ? stored : "00".repeat(32), "hex");
  const same = got.length === want.length && timingSafeEqual(got, want);
  return same && !!n && !!stored;
}

// ---------------------------------------------------------------------------------------------- shared lookups

/** The account behind a login, or null (an unknown login, or an identity without an account row). */
async function accountOf(d: AccountDeps, login: LoginName): Promise<AccountRow | null> {
  const userId = login.kind === "username" ? ((await d.store.getAccountByUsername(login.username))?.user_id ?? null) : await d.auth.findUserIdByEmail(login.email);
  return userId ? d.store.getAccount(userId) : null;
}

/** Is this browser a phone he has used (it came with its device cookie, he signed in on it, at most 180 days ago)? */
async function usedDevice(d: AccountDeps, userId: string, facts: RequestFacts): Promise<boolean> {
  if (!facts.knownDevice) return false;
  const hash = deviceHash(facts.deviceId);
  const row = (await d.store.listKnownDevices(userId)).find((k) => k.device_hash === hash);
  if (!row) return false;
  const last = Date.parse(row.last_seen_at);
  return Number.isFinite(last) && now(d) - last <= KNOWN_DEVICE_MAX_AGE_MS;
}

/** His active links whose switch is on. */
async function helpers(d: AccountDeps, userId: string): Promise<CareLinkRow[]> {
  return (await d.store.listCareLinks({ patient_id: userId, status: ["active"] })).filter((l) => l.reset_helper === true && !!l.family_id);
}

const open = (r: ResetRequestRow, nowMs: number): boolean => !r.used_at && Date.parse(r.expires_at) > nowMs;

/** His newest open request (unused, not past its 10 minutes), or null. */
async function openRequest(d: AccountDeps, userId: string): Promise<ResetRequestRow | null> {
  const t = now(d);
  return (await d.store.listResetRequests(userId)).filter((r) => open(r, t)).at(-1) ?? null;
}

const dayBucket = (kind: "fh" | "fc", userId: string, env: Env): string => `a:${kind}:${bucketKey("user", userId, env)}`;
const triesBucket = (requestId: string): string => `a:ft:${requestId}`;

// ---------------------------------------------------------------------------------------------- 1. his switch

/** His active links with their switch, in the order he invited them. */
export async function listResetHelpers(d: AccountDeps, me: Me): Promise<ResetHelperView[]> {
  const links = await d.store.listCareLinks({ patient_id: me.userId, status: ["active"] });
  return links.map((l) => ({ link_id: l.id, label: l.family_label, relation: l.relation, on: l.reset_helper === true }));
}

/**
 * He turns the switch on or off for one of his active links. A change writes the consent record and an account event;
 * asking for what is already so writes nothing.
 */
export async function setResetHelper(d: AccountDeps, me: Me, input: { link_id: string; on: boolean; locale?: string | null }): Promise<{ ok: true; helper: ResetHelperView } | Refusal> {
  const link = await d.store.getCareLink(input.link_id).catch(() => null);
  if (!link || link.patient_id !== me.userId) return refuse(404, "link_not_found");
  if (link.status !== "active") return refuse(409, "link_not_active");
  const view = (l: CareLinkRow): ResetHelperView => ({ link_id: l.id, label: l.family_label, relation: l.relation, on: l.reset_helper === true });
  if ((link.reset_helper === true) === input.on) return { ok: true, helper: view(link) };
  const r = await d.store.setLinkResetHelper(link.id, me.userId, input.on);
  if (!r.ok) return r.code === "link_not_found" ? refuse(404, "link_not_found") : refuse(409, "link_not_active");
  const locale: ConsentLocale = input.locale === "en" ? "en" : "zh-Hans";
  const scope = await ownScope(d.store, me.userId);
  // track H's writer: it stamps the version and hash of the text in force and publishes that text first
  await recordConsent(
    { records: d.store, texts: d.store },
    { user_id: me.userId, scope_id: scope?.id ?? null, kind: "family_reset_helper", decision: input.on ? "granted" : "withdrawn", locale, method: "me_screen", evidence: { link_id: link.id, screen: "me_reset_help" } },
  );
  await d.store.addAccountEvent(me.userId, input.on ? "reset_helper_on" : "reset_helper_off", { link_id: link.id });
  return { ok: true, helper: view(r.link) };
}

// ---------------------------------------------------------------------------------------------- 2. he asks for help

/**
 * He asks for help (signed out). One refusal, help_unavailable, for an unknown login, a phone he has not used or no
 * switch on; 429 too_many after three requests in a day (counted only for requests that are really made, so a
 * stranger cannot use his three up).
 */
export async function requestFamilyHelp(d: AccountDeps, input: { login: string }, facts: RequestFacts): Promise<({ ok: true } & FamilyHelpAnswer) | Refusal> {
  const e = envOf(d);
  const ipLimit = await hitLimit(d.store, `a:fi:${bucketKey("ip", facts.ip, e)}`, LIMITS.familyResetPerIp, e);
  if (!ipLimit.ok) return refuse(429, "too_many", ipLimit.until);
  const parsed = parseLoginName(input.login, e);
  const account = parsed.ok ? await accountOf(d, parsed.login) : null;
  if (!account || !(await usedDevice(d, account.user_id, facts))) return refuse(403, "help_unavailable");
  const who = await helpers(d, account.user_id);
  if (!who.length) return refuse(403, "help_unavailable");
  const day = await d.store.rateHit(dayBucket("fh", account.user_id, e), LIMITS.familyResetRequests.windowS, LIMITS.familyResetRequests.limit);
  if (!day.allowed) return refuse(429, "too_many", day.reset_at);

  // one open request at a time: asking again starts over (an earlier code no longer works)
  const t = now(d);
  for (const old of (await d.store.listResetRequests(account.user_id)).filter((r) => open(r, t))) await d.store.useResetRequest(old.id);
  const request = await d.store.createResetRequest({ user_id: account.user_id, device_hash: deviceHash(facts.deviceId), expires_at: new Date(t + RESET_REQUEST_TTL_MS).toISOString() });
  await d.store.addAccountEvent(account.user_id, "family_reset_requested", {}).catch(() => undefined);
  // 「爸爸在重设密码」 to each helper's phones (real-app 2.24): once per request, best effort
  await announceFamilyHelp(d.store, await ownScope(d.store, account.user_id).catch(() => null), who, request, RESET_REQUEST_TTL_MS / 1000, d.sendNotice).catch(() => 0);
  return { ok: true, expires_at: request.expires_at, helpers: who.map((l) => l.family_label).filter((x): x is string => !!x) };
}

// ---------------------------------------------------------------------------------------------- 3. her side

/** Her link, when it is hers and active; else the refusal. */
async function herLink(d: AccountDeps, her: Me, linkId: string): Promise<{ ok: true; link: CareLinkRow } | Refusal> {
  const link = await d.store.getCareLink(linkId).catch(() => null);
  if (!link || link.family_id !== her.userId) return refuse(404, "link_not_found");
  if (link.status !== "active") return refuse(403, "link_not_active");
  return { ok: true, link };
}

/** Is he asking for help right now? For her page; reads only, writes nothing. */
export async function pendingFamilyHelp(d: AccountDeps, her: Me, linkId: string): Promise<({ ok: true } & FamilyHelpState) | Refusal> {
  const found = await herLink(d, her, linkId);
  if (!found.ok) return found;
  if (found.link.reset_helper !== true) return { ok: true, enabled: false, pending: false, expires_at: null };
  const request = await openRequest(d, found.link.patient_id);
  return { ok: true, enabled: true, pending: !!request, expires_at: request?.expires_at ?? null };
}

/**
 * She taps 「帮」: a 6-digit code for his open request, returned this once (only its hash is kept). 409 helper_off when
 * he has not switched her on, 409 no_request when he is not asking (or his 10 minutes have passed), 429 too_many after
 * three codes for his account in a day.
 */
export async function issueFamilyResetCode(d: AccountDeps, her: Me, linkId: string): Promise<{ ok: true; code: string; expires_at: string } | Refusal> {
  const e = envOf(d);
  const found = await herLink(d, her, linkId);
  if (!found.ok) return found;
  const link = found.link;
  if (link.reset_helper !== true) return refuse(409, "helper_off");
  const request = await openRequest(d, link.patient_id);
  if (!request) return refuse(409, "no_request");
  const day = await d.store.rateHit(dayBucket("fc", link.patient_id, e), LIMITS.familyResetCodes.windowS, LIMITS.familyResetCodes.limit);
  if (!day.allowed) return refuse(429, "too_many", day.reset_at);
  const code = newResetCode();
  const saved = await d.store.setResetRequestCode(request.id, link.id, hashResetCode(request.id, code, e));
  if (!saved) return refuse(409, "no_request");
  await d.store.clearRate(triesBucket(request.id));
  await d.store.addAccountEvent(link.patient_id, "family_reset_code_issued", { link_id: link.id }).catch(() => undefined);
  return { ok: true, code, expires_at: saved.expires_at };
}

// ---------------------------------------------------------------------------------------------- 4. he types the code

export interface FamilyRecoverInput {
  login: string;
  code: string;
  password: string;
  not_my_phone?: boolean;
}

/**
 * He types her code and a new password on the phone that asked. See the file header for every way this is refused
 * (always invalid_family_code) and for what a success does.
 */
export async function recoverWithFamily(
  d: AccountDeps,
  input: FamilyRecoverInput,
  facts: RequestFacts,
): Promise<{ ok: true; signedIn: SignedIn; next: string; helper: string | null } | Refusal> {
  const e = envOf(d);
  const ipLimit = await hitLimit(d.store, `a:fi:${bucketKey("ip", facts.ip, e)}`, LIMITS.familyResetPerIp, e);
  if (!ipLimit.ok) return refuse(429, "too_many", ipLimit.until);
  const parsed = parseLoginName(input.login, e);
  if (!parsed.ok) return refuse(401, "invalid_family_code");
  const password = normalizePassword(input.password);
  const problem = passwordProblem(password, parsed.login);
  if (problem) return refuse(400, problem);

  const account = await accountOf(d, parsed.login);
  const here = deviceHash(facts.deviceId);
  // the request this very device made: her phone, or a phone he never used, has none
  const request = account && (await usedDevice(d, account.user_id, facts)) ? await openRequest(d, account.user_id) : null;
  const mine = request && request.device_hash === here ? request : null;
  const link = mine?.link_id ? await d.store.getCareLink(mine.link_id).catch(() => null) : null;
  // she is still his helper: the link is his, active, and its switch is still on
  const helper = link && account && link.patient_id === account.user_id && link.status === "active" && link.reset_helper === true ? link : null;
  const matches = resetCodeMatches(mine?.id ?? "none", input.code, mine?.code_hash, e);
  if (!account || !mine || !mine.code_hash || !helper || !matches) {
    if (mine?.code_hash) {
      // a wrong guess against a live code: four are counted, the fifth spends the request
      const tries = await d.store.rateHit(triesBucket(mine.id), LIMITS.familyResetCodeTries.windowS, LIMITS.familyResetCodeTries.limit);
      if (!tries.allowed) await d.store.useResetRequest(mine.id);
    }
    return refuse(401, "invalid_family_code");
  }
  // one use: whoever marks it first wins
  if (!(await d.store.useResetRequest(mine.id))) return refuse(401, "invalid_family_code");

  await d.auth.updatePassword(account.user_id, password);
  const ephemeral = input.not_my_phone === true;
  const tokens = await d.auth.signInWithPassword(parsed.login.email, password, signInContext(facts, ephemeral));
  await endOthers(d, account.user_id, tokens, "family_reset");
  await clearFailures(d.store, lockBuckets("login", bucketKey("login", parsed.login.email, e), deviceKeys(facts, d)));
  await d.store.clearRate(triesBucket(mine.id));
  await d.store.addAccountEvent(account.user_id, "password_reset", { method: "family_assisted", link_id: helper.id, helper: helper.family_label ?? null });
  await remember(d, account.user_id, facts);
  const scope = await ownScope(d.store, account.user_id);
  return {
    ok: true,
    signedIn: { tokens, since: { atMs: realNowMs(), ephemeral }, locale: account.locale },
    next: destinationAfterSignIn(null, scope),
    helper: helper.family_label ?? null,
  };
}
