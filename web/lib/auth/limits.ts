/**
 * Sign-in protection and rate limits (docs/plan/real-app.md 3.5). Server-only; counts live in the store's rate_limit
 * buckets (a restart keeps them), named by an HMAC of the IP or the login (RATE_LIMIT_SALT), never the value itself.
 *
 * Signing in is protected in two layers, and never by a lock on the whole account: anyone who knows his username could
 * otherwise lock him out of every phone.
 *
 *   per login x device   (the rp_device cookie; per login x IP when the browser has none) Five wrong passwords within 15
 *                        minutes are each answered 401. The sixth wrong one within those 15 minutes locks that one
 *                        device for 15 minutes from that moment (423 with the time it opens again); while it is locked
 *                        no password is tried there. Another device is not affected, and the locked one can still use
 *                        the recovery code. A right password clears the count; a recovery reset lifts the lock on that
 *                        device.
 *   per login, all devices together
 *                        Wrong passwords are counted for one hour from the first. Once nine are counted, every further
 *                        attempt in that hour (the tenth on) first waits: 2 s, then 4, 8, 16, 32, and 60 s from then on
 *                        (slowdownMs). After the wait the password is judged as usual: a right one signs in. It never
 *                        locks, and a right password does not clear this count (someone guessing stays slowed while he
 *                        logs in himself); it ends with the hour.
 *
 * The per-IP limits (log-in, sign-up, recovery, the "is this name free" check, reading a consent aloud) guard the
 * service from one machine hammering it. Where the developer tools are on (next dev, the tests, the recording build:
 * everything from one laptop) they are 100 times looser; the lockout and the slow-down never are.
 */
import { createHmac } from "node:crypto";
import { devToolsEnabled, type Env } from "@/lib/dev/enabled";
import { clientAddress } from "@/lib/guard/client-ip";
import type { Store } from "@/lib/store/types";
import { authSecret } from "./secrets";

export interface Limit {
  windowS: number;
  limit: number;
}

export const LIMITS = {
  /** wrong passwords per login × device that are answered 401; the next one within the window locks the device */
  loginFailures: { windowS: 15 * 60, limit: 5 },
  /** wrong passwords per login over all devices that go unslowed; from the next attempt on, each waits first */
  loginSlowdown: { windowS: 3600, limit: 9 },
  /** how long a device stays locked */
  loginLock: { windowS: 15 * 60, limit: 0 },
  loginPerIp: { windowS: 15 * 60, limit: 30 },
  signupPerIpHour: { windowS: 3600, limit: 5 },
  signupPerIpDay: { windowS: 86_400, limit: 20 },
  signupSiteDay: { windowS: 86_400, limit: 300 },
  examplePerIpHour: { windowS: 3600, limit: 3 },
  recoverPerLogin: { windowS: 3600, limit: 5 },
  recoverPerIp: { windowS: 3600, limit: 20 },
  checkLoginPerIp: { windowS: 3600, limit: 120 },
  /** wrong current passwords (changing the password, a new recovery code) per user × device; the next one locks */
  passwordFailures: { windowS: 15 * 60, limit: 5 },
  /** family-assisted reset (real-app 3.6): requests he starts, and codes she is given, per account a day */
  familyResetRequests: { windowS: 86_400, limit: 3 },
  familyResetCodes: { windowS: 86_400, limit: 3 },
  familyResetPerIp: { windowS: 3600, limit: 20 },
  /** wrong 6-digit codes per request; the next one spends the request */
  familyResetCodeTries: { windowS: 600, limit: 4 },
  /** 「读给我听」 on the consent and recovery-code screens (no sign-in there), per IP */
  readAloudPerIp: { windowS: 3600, limit: 30 },
  /** accepting a family invitation (real-app 3.5: 接受邀请，每 IP 每小时 20), per IP */
  acceptInvitePerIp: { windowS: 3600, limit: 20 },
  /** line bind (only add): binding by account (lib/care/bind.ts), per signed-in person and per IP, an hour */
  bindPerUser: { windowS: 3600, limit: 10 },
  bindPerIp: { windowS: 3600, limit: 30 },
} as const satisfies Record<string, Limit>;

/** The slow-down's waits in seconds, in order; the last one repeats. */
export const SLOWDOWN_STEPS_S = [2, 4, 8, 16, 32, 60] as const;

/**
 * How long an attempt waits before its password is judged, given the wrong passwords already counted for that login
 * in the last hour: nothing below nine, then 2, 4, 8, 16, 32 and 60 seconds (60 at most).
 */
export function slowdownMs(failuresSoFar: number): number {
  const over = Math.floor(failuresSoFar) - LIMITS.loginSlowdown.limit;
  if (!(over >= 0)) return 0;
  return SLOWDOWN_STEPS_S[Math.min(over, SLOWDOWN_STEPS_S.length - 1)] * 1000;
}

/** The bucket that counts a login's wrong passwords over all devices. */
export function slowdownBucket(loginKey: string): string {
  return `a:la:${loginKey}`;
}

/** The wait this attempt owes (ms; 0: none). Reading never counts. */
export async function slowdownFor(store: Store, loginKey: string): Promise<number> {
  const w = await store.getRateWindow(slowdownBucket(loginKey));
  return slowdownMs(w?.count ?? 0);
}

/** A wrong password for this login, whatever the device: one more in its hour. */
export async function noteLoginFailure(store: Store, loginKey: string): Promise<void> {
  await store.rateHit(slowdownBucket(loginKey), LIMITS.loginSlowdown.windowS, 1_000_000);
}

/** How much looser the per-IP limits are with the developer tools on. */
export const DEV_LIMIT_FACTOR = 100;

/** An HMAC of a value for a bucket name (32 hex characters). */
export function bucketKey(kind: "ip" | "login" | "user", value: string, env: Env = process.env): string {
  return createHmac("sha256", authSecret("RATE_LIMIT_SALT", env)).update(`${kind}:${value}`, "utf8").digest("hex").slice(0, 32);
}

/**
 * The client's address for the per-IP limits. C2 track L: which header may be believed is lib/guard/client-ip.ts (the
 * edge's header only through the origin lock, else what our own proxy saw, else "local"); nothing a client sends by
 * itself picks the bucket any more.
 */
export function clientIp(headers: Headers): string {
  return clientAddress(headers);
}

export type LimitResult = { ok: true } | { ok: false; until: string };

/** One hit on a per-IP style limit; refused once over (looser with the developer tools on). */
export async function hitLimit(store: Store, bucket: string, limit: Limit, env: Env = process.env): Promise<LimitResult> {
  const factor = devToolsEnabled(env) ? DEV_LIMIT_FACTOR : 1;
  const hit = await store.rateHit(bucket, limit.windowS, limit.limit * factor);
  return hit.allowed ? { ok: true } : { ok: false, until: hit.reset_at };
}

export type LockState = { locked: false } | { locked: true; until: string };

/** A lockout's two buckets: the count of wrong passwords, and the lock itself. */
export interface LockBuckets {
  failures: string;
  lock: string;
}

/**
 * The lockout's buckets for one login (or user) on one device. A browser that came without a device cookie is counted
 * twice, on the device id it is about to be given and on its address: if it keeps the cookie the count goes on, if it
 * drops it every time the address still adds up.
 */
export function lockBuckets(prefix: "login" | "password", who: string, devices: string | readonly string[]): LockBuckets[] {
  const p = prefix === "login" ? "a:l" : "a:p";
  return (typeof devices === "string" ? [devices] : devices).map((device) => ({ failures: `${p}f:${who}:${device}`, lock: `${p}l:${who}:${device}` }));
}

const latest = (states: LockState[]): LockState => {
  const until = states.flatMap((s) => (s.locked ? [s.until] : [])).sort().at(-1);
  return until ? { locked: true, until } : { locked: false };
};

/** Is this login (or user) locked on this device right now? Reading never counts. */
export async function lockState(store: Store, buckets: readonly LockBuckets[]): Promise<LockState> {
  const states: LockState[] = [];
  for (const b of buckets) {
    const w = await store.getRateWindow(b.lock);
    states.push(w ? { locked: true, until: w.reset_at } : { locked: false });
  }
  return latest(states);
}

/**
 * A wrong password: count it. `limit.limit` of them within the window are only counted; the next one (the sixth for the
 * login) locks the device for loginLock.windowS from now.
 */
export async function noteFailure(store: Store, buckets: readonly LockBuckets[], limit: Limit = LIMITS.loginFailures): Promise<LockState> {
  const states: LockState[] = [];
  for (const b of buckets) {
    const hit = await store.rateHit(b.failures, limit.windowS, limit.limit);
    if (hit.count <= limit.limit) {
      states.push({ locked: false });
      continue;
    }
    const lock = await store.rateHit(b.lock, LIMITS.loginLock.windowS, 0);
    await store.clearRate(b.failures);
    states.push({ locked: true, until: lock.reset_at });
  }
  return latest(states);
}

/** A right password (or a recovery): forget the count and lift the lock. */
export async function clearFailures(store: Store, buckets: readonly LockBuckets[]): Promise<void> {
  for (const b of buckets) {
    await store.clearRate(b.failures);
    await store.clearRate(b.lock);
  }
}
