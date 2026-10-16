/**
 * The crew key: the one credential of the film crew (docs/plan/real-app.md 5.2). This module holds what the gate is made
 * of: which keys count, the cookie's value, and the one counter of wrong keys. The decisions are lib/crew/gate.ts
 * (isCrew, crewGate, the pages' requireCrewPage): every crew-only page and route asks there, and nowhere else. There is no
 * second mechanism any more (the per-session unlock of the scripted fallback, with its own counter, is gone: C2
 * follow-up).
 *
 * Which keys count:
 *   - a production build (`next start`, the judge deployment): only SCRIPTED_FALLBACK_KEY; unset = nobody;
 *   - while the developer tools are on (lib/dev/enabled.ts: `next dev`, vitest, or a production build started with
 *     RIPPLE_DEV_TOOLS=1 to record the journeys): SCRIPTED_FALLBACK_KEY when set, and also DEV_ONLY_CREW_KEY, so the
 *     e2e suite and the journey scripts can play the crew. A real deployment refuses to start with the developer tools
 *     on (RIPPLE_DEPLOYED=1), so it never accepts the dev key.
 *
 * How a request shows it is the crew's (crewCredential; any one is enough):
 *   - cookie `rp_crew`: the crew's browser, after the sign-in door (/backstage/crew, POST /api/session/crew) or a keyed
 *     filming-session creation. The cookie holds a sha256 of the key, never the key itself, and is httpOnly;
 *   - header `x-ripple-crew-key`, or a body field on the routes that take one: the key itself (scripts, tests, the
 *     journey recorder).
 * Anything else is not the crew, and a crew-only route answers it 404 like a route that does not exist: no credential,
 * a stale cookie, a typed key that is wrong. Only the sign-in door (crewSignIn) tells a typo from a closed door: 403
 * crew_key_wrong, and 429 crew_key_attempts once the client is locked out.
 *
 * One counter: a typed key that is wrong (at the door, in the header, in a body) counts against the client; ten within
 * ten minutes lock that client's typed keys out for ten minutes (a browser that already carries the cookie keeps
 * working: a typo on one phone must not stop the director's laptop behind the same router). A stale cookie alone (the
 * key changed) is not a guess. A right key does not clear the count.
 *
 * Where the count lives: in the store's rate_limit buckets, like every other limiter (lib/auth/limits.ts), so a restart
 * or a deploy keeps the wrong keys already counted and a lock already set, and several instances count together. Two
 * buckets per client, named by an HMAC of the client's address (RATE_LIMIT_SALT), never the address:
 *   c:kf:<hmac>   the wrong keys, a window of ten minutes from the first
 *   c:kl:<hmac>   the lock, ten minutes from the tenth wrong key; the count it came from is cleared
 * Nothing of it is kept in the process. A request that shows the cookie, or types nothing, never reaches the store. When
 * the store cannot be read or written, a typed key is not accepted (crewCredential: not the crew; the door lets the
 * error through).
 *
 * Keys are compared through sha256 + timingSafeEqual and never logged, published or returned. Server-only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { bucketKey } from "@/lib/auth/limits";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { clientAddress } from "@/lib/guard/client-ip";
import { isStoreError, type Store } from "@/lib/store/types";
import { crewAttemptStore } from "@/lib/subject/limits";
import { nowMs as appNowMs } from "@/lib/time/now";

/** Accepted only while the developer tools are on (lib/dev/enabled.ts), next to SCRIPTED_FALLBACK_KEY when that is set. */
export const DEV_ONLY_CREW_KEY = "dev-only-rehearsal-key";

export const CREW_COOKIE = "rp_crew";
export const CREW_HEADER = "x-ripple-crew-key";
/** Lifetime of the crew cookie on a crew browser. */
export const CREW_COOKIE_DAYS = 30;

export const MAX_WRONG_KEYS = 10;
export const WRONG_KEY_WINDOW_MS = 10 * 60_000;

type Env = Record<string, string | undefined>;

/** The keys this process accepts right now (empty in a production build without SCRIPTED_FALLBACK_KEY). */
export function acceptedCrewKeys(env: Env = process.env): string[] {
  const keys: string[] = [];
  const configured = (env.SCRIPTED_FALLBACK_KEY ?? "").trim();
  if (configured) keys.push(configured);
  if (devToolsEnabled(env)) keys.push(DEV_ONLY_CREW_KEY);
  return keys;
}

/** Where the accepted keys come from (prints nothing secret): env, dev default, both, or none. */
export function crewGateSource(env: Env = process.env): "env" | "dev_default" | "env+dev_default" | "none" {
  const configured = !!(env.SCRIPTED_FALLBACK_KEY ?? "").trim();
  const dev = devToolsEnabled(env);
  if (configured && dev) return "env+dev_default";
  if (configured) return "env";
  return dev ? "dev_default" : "none";
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/** The rp_crew cookie value for a key: sha256 of a prefixed key, hex. */
export function crewCookieValue(key: string): string {
  return createHash("sha256").update(`ripple-crew-v1\n${key.trim()}`, "utf8").digest("hex");
}

function sameDigest(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Is this the crew key? */
export function crewKeyAccepted(key: string | null | undefined, env: Env = process.env): boolean {
  const given = (key ?? "").trim();
  if (!given) return false;
  const d = digest(given);
  let ok = false;
  for (const k of acceptedCrewKeys(env)) if (sameDigest(d, digest(k))) ok = true;
  return ok;
}

/** Does this rp_crew cookie value belong to an accepted key? */
export function crewCookieAccepted(value: string | null | undefined, env: Env = process.env): boolean {
  const given = (value ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const d = Buffer.from(given, "hex");
  let ok = false;
  for (const k of acceptedCrewKeys(env)) if (sameDigest(d, Buffer.from(crewCookieValue(k), "hex"))) ok = true;
  return ok;
}

// ------------------------------------------------------------------ wrong-key lockout (per client, rows of the store)

/** What the wrong-key count uses of a store: the hit, reading a bucket without counting, forgetting a bucket. */
export type CrewAttemptStore = Pick<Store, "rateHit" | "getRateWindow" | "clearRate">;

/** A client's two buckets: its wrong keys within the window, and the lock. */
export interface CrewBuckets {
  failures: string;
  lock: string;
}

const WRONG_KEY_WINDOW_S = WRONG_KEY_WINDOW_MS / 1000;
/** A window that ends this much later than its own length started on a clock that has since moved back. */
const CLOCK_SLACK_MS = 60_000;

export interface HeaderLike {
  get(name: string): string | null;
}

/**
 * The client a lockout counts. C2 track L: the address by lib/guard/client-ip.ts (the edge's header only through the
 * origin lock, else what our own proxy saw, else "local"), so a forged X-Forwarded-For no longer starts a fresh count.
 */
export function clientId(headers: HeaderLike): string {
  return clientAddress(headers);
}

/** The two buckets of a client (clientId), named by an HMAC of the address: the same names after a restart. */
export function crewBuckets(client: string, env: Env = process.env): CrewBuckets {
  const who = bucketKey("ip", client, env);
  return { failures: `c:kf:${who}`, lock: `c:kl:${who}` };
}

/** Where one call counts: the store, and the clock its windows are measured against. */
interface Counter {
  store: CrewAttemptStore;
  /** the clock a window may be doubted against (below); null: no window of this store is doubted */
  nowMs: (() => number) | null;
  /** what resetCrewAttempts files the buckets under; null stands for the process-wide store */
  owner: CrewAttemptStore | null;
}

/**
 * The store that was handed in (tests; it keeps its own time), else the process-wide one through its narrow way in
 * (lib/subject/limits.ts), on the app's clock. That clock can only move back where the developer tools are on
 * (lib/time/now.ts): anywhere else no window is doubted, so nothing dismisses a lock on a deployment.
 */
function counterOf(given: CrewAttemptStore | undefined): Counter {
  if (given) return { store: given, nowMs: null, owner: given };
  return { store: crewAttemptStore(), nowMs: devToolsEnabled() ? appNowMs : null, owner: null };
}

/**
 * The developer test clock can jump back (a spec sets a date weeks ahead, then clears it): a window that started "in
 * the future" would stay open until real time caught up. A window that ends further away than its own length can only
 * come from a clock that moved back (lib/guard/limits.ts has the same rule), so it is treated as not there.
 */
function fromAClockThatMovedBack(c: Counter, resetAt: string): boolean {
  return c.nowMs !== null && Date.parse(resetAt) - c.nowMs() > WRONG_KEY_WINDOW_MS + CLOCK_SLACK_MS;
}

/** The buckets this process has written, by the store they were written to. Only resetCrewAttempts reads it. */
const written = new Map<CrewAttemptStore | null, Set<string>>();
/** resetCrewAttempts is for tests, which use a handful of clients: past this many names nothing more is remembered. */
const WRITTEN_MAX = 2000;

function remember(c: Counter, buckets: CrewBuckets): void {
  let names = written.get(c.owner);
  if (!names) {
    if (written.size >= WRITTEN_MAX) return;
    written.set(c.owner, (names = new Set()));
  }
  if (names.size >= WRITTEN_MAX) return;
  names.add(buckets.failures);
  names.add(buckets.lock);
}

async function locked(c: Counter, buckets: CrewBuckets): Promise<boolean> {
  const w = await c.store.getRateWindow(buckets.lock);
  if (!w) return false;
  if (!fromAClockThatMovedBack(c, w.reset_at)) return true;
  await c.store.clearRate(buckets.lock);
  return false;
}

/**
 * A wrong typed key: count it. Nine within the window are only counted; the tenth locks the client for ten minutes
 * from this moment and clears the count (lib/auth/limits.ts noteFailure does the same). True when this one locked.
 */
async function noteWrongKey(c: Counter, buckets: CrewBuckets): Promise<boolean> {
  remember(c, buckets);
  const once = () => c.store.rateHit(buckets.failures, WRONG_KEY_WINDOW_S, MAX_WRONG_KEYS - 1);
  let hit = await once();
  if (fromAClockThatMovedBack(c, hit.reset_at)) {
    await c.store.clearRate(buckets.failures);
    hit = await once();
  }
  if (hit.count < MAX_WRONG_KEYS) return false;
  await c.store.rateHit(buckets.lock, WRONG_KEY_WINDOW_S, 0);
  await c.store.clearRate(buckets.failures);
  return true;
}

/**
 * Are this client's typed keys locked out right now? Reading never counts. `store`: a store of the caller's own, with
 * its own clock (tests); left out, the process-wide one.
 */
export async function crewLockedOut(client: string, env: Env = process.env, store?: CrewAttemptStore): Promise<boolean> {
  return locked(counterOf(store), crewBuckets(client, env));
}

/** Tests only: forget the wrong keys and the locks this process has counted, in the stores it counted them in. */
export async function resetCrewAttempts(): Promise<void> {
  const all = [...written];
  written.clear();
  for (const [owner, names] of all) {
    const store = owner ?? crewAttemptStore();
    for (const name of names) await store.clearRate(name);
  }
}

// ------------------------------------------------------------------ requests

export interface CrewRequestLike {
  headers: HeaderLike;
  cookies: { get(name: string): { value: string } | undefined };
}

/** How a request showed it is the crew's. */
export type CrewWay = "cookie" | "header" | "body";

/**
 * The gate's check (lib/crew/gate.ts isCrew, crewGate): how this request shows it is the crew's, or null. The rp_crew
 * cookie of an accepted key, else the key itself in the header or in `bodyKey`. A typed key that is wrong counts against
 * the client; while the client is locked out its typed keys are not looked at (a cookie still is). The store is asked
 * only when a key was typed: a cookie, or nothing at all, is answered without it. When the store fails, a typed key is
 * not the crew's, and one line says so (without the key or the address). `store`: as crewLockedOut.
 */
export async function crewCredential(req: CrewRequestLike, bodyKey?: string | null, env: Env = process.env, store?: CrewAttemptStore): Promise<CrewWay | null> {
  const fromCookie = req.cookies.get(CREW_COOKIE)?.value ?? "";
  if (fromCookie && crewCookieAccepted(fromCookie, env)) return "cookie";
  const fromBody = (bodyKey ?? "").trim();
  const fromHeader = (req.headers.get(CREW_HEADER) ?? "").trim();
  if (!fromBody && !fromHeader) return null;
  try {
    const counter = counterOf(store);
    const buckets = crewBuckets(clientId(req.headers), env);
    if (await locked(counter, buckets)) return null;
    if (fromBody && crewKeyAccepted(fromBody, env)) return "body";
    if (fromHeader && crewKeyAccepted(fromHeader, env)) return "header";
    await noteWrongKey(counter, buckets);
    return null;
  } catch (err) {
    console.warn("[crew-key] the wrong-key count could not be read or written: a typed key is not accepted", isStoreError(err) ? err.code : err instanceof Error ? err.name : "");
    return null;
  }
}

export type CrewSignIn =
  | { ok: true }
  | { ok: false; status: 403; error: "crew_key_required" | "crew_key_wrong" }
  | { ok: false; status: 429; error: "crew_key_attempts" };

/**
 * The sign-in door (POST /api/session/crew, the /backstage/crew page; the key field on a filming phone's visit page
 * posts here too): the one place that answers a typed key in words. Only the typed key counts here, never a cookie the
 * browser may already carry. Wrong: 403 crew_key_wrong, counted; the tenth within ten minutes, and every try while the
 * client is locked out: 429 crew_key_attempts. A store that fails is not answered in words: the error goes to the
 * caller. `store`: as crewLockedOut.
 */
export async function crewSignIn(headers: HeaderLike, key: string | null | undefined, env: Env = process.env, store?: CrewAttemptStore): Promise<CrewSignIn> {
  const given = (key ?? "").trim();
  if (!given) return { ok: false, status: 403, error: "crew_key_required" };
  const counter = counterOf(store);
  const buckets = crewBuckets(clientId(headers), env);
  if (await locked(counter, buckets)) return { ok: false, status: 429, error: "crew_key_attempts" };
  if (crewKeyAccepted(given, env)) return { ok: true };
  return (await noteWrongKey(counter, buckets)) ? { ok: false, status: 429, error: "crew_key_attempts" } : { ok: false, status: 403, error: "crew_key_wrong" };
}

/**
 * The gate's answer as a value, for a rule that words its own refusal (joining as the director or backstage,
 * lib/family/join.ts: 403 crew_key_required). Not the crew is not the crew, whatever was typed: there is one refusal.
 */
export type CrewCheck = { ok: true; via: CrewWay } | { ok: false; status: 403; error: "crew_key_required" };

export async function checkCrew(req: CrewRequestLike, bodyKey?: string | null, env: Env = process.env, store?: CrewAttemptStore): Promise<CrewCheck> {
  const via = await crewCredential(req, bodyKey, env, store);
  return via ? { ok: true, via } : { ok: false, status: 403, error: "crew_key_required" };
}
