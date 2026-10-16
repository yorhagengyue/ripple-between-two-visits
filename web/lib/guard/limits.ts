/**
 * The rows of the limits table that had no code (C2 track L; docs/plan/real-app.md 3.5, lines 541-545). Server-only.
 * (「接受邀请，每 IP 每小时 20」 is track A's: lib/auth/limits.ts acceptInvitePerIp, counted in the route.)
 *
 *   | 演示沙盒，每 IP           | 每小时 10        | 429 |   demoSandbox    POST /api/session (a sandbox; the crew's filming session is not one)
 *   | 读药袋，每人              | 每天 30          | 429 |   labelRead      POST /api/labels/read
 *   | 实时字幕分块，每人         | 每天 4 小时音频   | 429 |   captionAudio   POST /api/asr/chunk, counted in seconds of audio
 *   | 上传链接，每人            | 每小时 100       | 429 |   uploadLink     POST /api/upload-url
 * One row is not in the design's table: readAloud, POST /api/tts (a card read aloud by the voice service), per person
 * 30 an hour. The table has no line for the voice; the number is its neighbour's, the read-aloud of the sign-in screens
 * (lib/auth/limits.ts readAloudPerIp: 30 an hour per address, there because nobody is signed in yet).
 *
 * Counted like lib/auth/limits.ts counts: in the store's rate_limit buckets (a restart keeps them), a fixed window that
 * starts with the first hit, the bucket named by an HMAC (RATE_LIMIT_SALT) of the address or the person, never the
 * value. "每人" is the person asking: an account's user id (her own when she comes through a care link), the sandbox
 * for a demo phone. The answer is 429 { error: "too_many", limit, until } with Retry-After.
 *
 * Where the developer tools are on (next dev, the tests, the recording build) every row here is GUARD_DEV_FACTOR times
 * looser: the e2e suite opens a sandbox per test from one address, a few hundred a run, so lib/auth's 100 would not be
 * enough for the 10 an hour. On a deployment the developer tools cannot be on (lib/dev/enabled.ts).
 *
 * The test clock can jump back (a spec sets a date weeks ahead, then clears it): a window that started "in the future"
 * would then stay open until real time caught up. A window that ends further away than its own length can only come
 * from a clock that moved back, so it is started again.
 */
import { bucketKey } from "@/lib/auth/limits";
import { devToolsEnabled, type Env } from "@/lib/dev/enabled";
import { isStoreError, type RateHit, type Store } from "@/lib/store/types";
import { nowMs as appNowMs } from "@/lib/time/now";

export interface GuardLimitRow {
  per: "ip" | "person";
  windowS: number;
  limit: number;
  /** the bucket's prefix ("g:" = track L's rows) */
  bucket: string;
  /** what one count is */
  unit: "request" | "second of audio";
}

export const GUARD_LIMITS = {
  demoSandbox: { per: "ip", windowS: 3600, limit: 10, bucket: "g:ds", unit: "request" },
  labelRead: { per: "person", windowS: 86_400, limit: 30, bucket: "g:lr", unit: "request" },
  captionAudio: { per: "person", windowS: 86_400, limit: 4 * 3600, bucket: "g:ca", unit: "second of audio" },
  uploadLink: { per: "person", windowS: 3600, limit: 100, bucket: "g:ul", unit: "request" },
  readAloud: { per: "person", windowS: 3600, limit: 30, bucket: "g:ra", unit: "request" },
} as const satisfies Record<string, GuardLimitRow>;

export type GuardLimit = keyof typeof GUARD_LIMITS;

/** How much looser these rows are with the developer tools on. */
export const GUARD_DEV_FACTOR = 1000;

/** A window that ends this much later than its own length started on a clock that has since moved back. */
const CLOCK_SLACK_MS = 60_000;

export type LimitStore = Pick<Store, "rateHit" | "rateAdd" | "clearRate">;

export interface Over {
  limit: GuardLimit;
  /** when the window opens again */
  until: string;
}

export interface CountOptions {
  /** how much this request counts (captionAudio: its seconds of audio); left out = one */
  amount?: number;
  env?: Env;
  /** the store's clock (tests that give the store their own clock give it here too) */
  nowMs?: number;
}

let warnedNoRateAdd = false;

/**
 * Count one request (or `amount`) against a row for `who` (an address or a person's key). null: go on. Over: refuse.
 * A database without 0015_l_rate_add (the summed allowance's function) lets the request through and says so once.
 */
export async function countAgainst(store: LimitStore, name: GuardLimit, who: string, opts: CountOptions = {}): Promise<Over | null> {
  const row: GuardLimitRow = GUARD_LIMITS[name];
  const env = opts.env ?? process.env;
  const limit = row.limit * (devToolsEnabled(env) ? GUARD_DEV_FACTOR : 1);
  const bucket = `${row.bucket}:${bucketKey(row.per === "ip" ? "ip" : "user", who, env)}`;
  const summed = opts.amount !== undefined;
  const amount = Math.max(0, Math.ceil(opts.amount ?? 1));
  const once = (): Promise<RateHit> => (summed ? store.rateAdd(bucket, row.windowS, limit, amount) : store.rateHit(bucket, row.windowS, limit));
  let hit: RateHit;
  try {
    hit = await once();
    const now = opts.nowMs ?? appNowMs();
    if (Date.parse(hit.reset_at) - now > row.windowS * 1000 + CLOCK_SLACK_MS) {
      await store.clearRate(bucket);
      hit = await once();
    }
  } catch (err) {
    if (summed && isStoreError(err) && err.code === "not_configured") {
      if (!warnedNoRateAdd) {
        warnedNoRateAdd = true;
        console.warn("[guard] the summed allowance cannot be counted (rp_rate_add is missing: apply the track L migration); letting the request through");
      }
      return null;
    }
    throw err;
  }
  return hit.allowed ? null : { limit: name, until: hit.reset_at };
}

/** The person a per-person row counts: an account's user, else the scope (a demo sandbox has no user). */
export function personKey(subject: { userId: string | null; scope: { id: string } }): string {
  return subject.userId ? `u:${subject.userId}` : `s:${subject.scope.id}`;
}

/** Whole seconds until `until`, at least 1 (the Retry-After of a refusal). */
export function retryAfterS(until: string, nowMs: number = appNowMs()): number {
  const s = Math.ceil((Date.parse(until) - nowMs) / 1000);
  return Number.isFinite(s) && s > 1 ? s : 1;
}
