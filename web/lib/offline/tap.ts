/**
 * The moment he tapped (C2 track O; real-app 2.25 没网时 「连上后按顺序补发」). Pure; the server and the phone both use it.
 *
 * An answer or a reading kept on the phone goes out late, and is recorded with the time he tapped, never the time it
 * finally went out. The phone sends that instant as `at`, on the account's own clock (the page anchors its clock on the
 * server's, lib/offline/client.ts, so a phone with the wrong time, the developer test clock and a filming account's
 * offset all agree). The server never takes it as it is:
 *   - a tap "after now" is now (a phone cannot date anything into the future);
 *   - the tap's own day, in his time zone, must be today or yesterday (real-app 2.8 「补记只允许今天和昨天」): anything
 *     older is refused as too_late and stays visible on his phone with that reason;
 *   - 「昨天」 on a late answer means the day before the tap, not the day before it was sent: a 23:55 tap that goes out
 *     at 00:10 still lands on the day he meant.
 */
import { accountMoment, localDate } from "@/lib/time/clock";

/** The request header that names the account an entry of the to-send list belongs to (lib/offline/owner.ts). */
export const OUTBOX_OWNER_HEADER = "x-rp-outbox-owner";

export interface TapMoment {
  /** the instant, never after now */
  ms: number;
  iso: string;
  /** the account's day number of the tap */
  day: number;
  /** HH:MM in his zone */
  time: string;
  /** 0 the tap was today, 1 yesterday */
  daysAgo: 0 | 1;
}

export type TapRefusal = "bad_time" | "too_late";

type ScopeClock = { d0: string | null; tz: string | null };

function momentOf(scope: ScopeClock, ms: number): { day: number; time: string } {
  // the instant is already on the account's clock: no offset is added again
  return accountMoment({ kind: "account", d0: scope.d0, tz: scope.tz, filming: false, clock_offset_ms: null }, ms);
}

/**
 * `at` as the server takes it. `scopeNowMs` is the account's own now (lib/store/scope.ts scopeNow), the clock the phone
 * anchored on.
 */
export function tapMoment(scope: ScopeClock, at: string, scopeNowMs: number): TapMoment | TapRefusal {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return "bad_time";
  const ms = Math.min(parsed, scopeNowMs);
  const today = momentOf(scope, scopeNowMs).day;
  const m = momentOf(scope, ms);
  const daysAgo = today - m.day;
  if (daysAgo !== 0 && daysAgo !== 1) return "too_late";
  return { ms, iso: new Date(ms).toISOString(), day: m.day, time: m.time, daysAgo };
}

/**
 * The phone's side of 「昨天」: the cell he answered (its date as the page showed it) relative to the day of the tap.
 * "today" the cell is the tap's own day, "yesterday" the day before, null anything else (the page was older than that:
 * the answer cannot be placed and is not kept).
 */
export function cellWhen(cellDate: string, tapMs: number, tz: string): "today" | "yesterday" | null {
  const tapDate = localDate(tapMs, tz);
  if (cellDate === tapDate) return "today";
  const before = new Date(Date.parse(`${tapDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return cellDate === before ? "yesterday" : null;
}
