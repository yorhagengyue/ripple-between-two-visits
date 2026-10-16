/**
 * An account's blood pressure readings as he writes and changes them (C2 track B, second round; real-app 2.9, 12
 * 「当天的读数能删、能改，改动留记录；早晚按真实钟点定」). Server-only. The demo keeps app/api/bp's own writes.
 *
 *   part of the day   morning or evening, by his real clock (real-app 2.9 「早上还是晚上，按新加坡的真实钟点算」): before
 *                     noon is the morning reading, from noon on the evening one. There is no third part: a reading at
 *                     14:00 is the day's evening reading, so the doctor's 「早晚各一次」 is done for the evening and no
 *                     reminder comes for it (lib/daily/bp-run.ts reads the same rule: partOfReading).
 *   the day           today, or yesterday when he says so (`when`, like his dose answers; the server works out the day,
 *                     never the request). A reading written for yesterday says which part it was (`part`); without it,
 *                     yesterday's evening, the last part of that day. A reading that waited on his phone for a network
 *                     (track O, `tap`: the moment he tapped) is dated by that moment: its day, its part, its time.
 *   a change          editing a reading keeps the numbers it had (history: edit); deleting keeps the row with deleted_at
 *                     set (history: delete), so no list shows it and the record stays; putting it back within the undo
 *                     bar clears deleted_at (history: restore) and the reading is exactly what it was, time included.
 *   「这次没量」        a reading in a part replaces that part's "not measured" row (his own tap or the job's), which is
 *                     kept as a deleted row with its history: the part was measured after all.
 * Nothing here judges a reading.
 */
import type { SessionRow, Store, BpChange, BpReadingRow } from "@/lib/store/types";
import { isClockTime, parseClockTime } from "@/lib/story/clock";
import { scopeNowIso } from "@/lib/time/now";
import type { BpPart } from "./bp-schedule";

/** The part of the day a clock time falls in on an account: before noon morning, from noon evening. */
export function accountPartAt(hhmm: string | null): BpPart {
  if (!hhmm || !isClockTime(hhmm)) return "morning";
  return parseClockTime(hhmm) < 12 * 60 ? "morning" : "evening";
}

/** A reading's part of the day on an account (rows written before this rule may say midday or night: the evening). */
export function accountPartOf(r: Pick<BpReadingRow, "slot">): BpPart {
  return r.slot === "morning" ? "morning" : "evening";
}

export type ReadingDay = "today" | "yesterday";

export interface NewAccountReading {
  /** a uuid his phone made: a resend finds the same row */
  id?: string;
  systolic?: number;
  diastolic?: number;
  pulse?: number | null;
  /** 「这次没量」 */
  unconfirmed?: boolean;
  when?: ReadingDay;
  /** only with when "yesterday": which part of that day */
  part?: BpPart;
  /** C2 track O: the moment he tapped, for a reading sent late (lib/offline/tap.ts TapMoment); it dates the reading */
  tap?: { day: number; time: string; iso: string } | null;
}

function before(r: BpReadingRow, action: BpChange["action"], at: string): BpChange {
  return { at, action, systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse ?? null, state: r.state };
}

const historyOf = (r: BpReadingRow): BpChange[] => (Array.isArray(r.history) ? r.history : []);

/** The day and part a new reading goes to. */
export function readingPlace(scope: Pick<SessionRow, "story_day" | "story_time">, input: Pick<NewAccountReading, "when" | "part" | "tap">): { day: number; part: BpPart } {
  if (input.tap) return { day: input.tap.day, part: accountPartAt(input.tap.time) };
  if (input.when === "yesterday") return { day: scope.story_day - 1, part: input.part ?? "evening" };
  return { day: scope.story_day, part: accountPartAt(scope.story_time) };
}

/**
 * Write a reading (or 「这次没量」). Returns the row and whether it was already there (a resend with the same id: the
 * same reading comes back, also when he deleted it meanwhile; nothing is written twice).
 */
export async function recordReading(store: Store, scope: SessionRow, input: NewAccountReading): Promise<{ reading: BpReadingRow; again: boolean }> {
  const { day, part } = readingPlace(scope, input);
  if (input.id) {
    const again = (await store.listBp(scope.id, { fromDay: scope.story_day - 1, toDay: scope.story_day, includeDeleted: true })).find((r) => r.id === input.id);
    if (again) return { reading: again, again: true };
  }
  const unconfirmed = input.unconfirmed === true;
  const reading = await store.addBp(scope.id, {
    ...(input.id ? { id: input.id } : {}),
    day,
    slot: part,
    ...(input.tap ? { created_at: input.tap.iso } : {}),
    systolic: unconfirmed ? null : input.systolic!,
    diastolic: unconfirmed ? null : input.diastolic!,
    state: unconfirmed ? "unconfirmed" : "recorded",
    ...(!unconfirmed && input.pulse ? { pulse: input.pulse } : {}),
  });
  if (!unconfirmed) {
    // the part was measured after all: its "not measured" rows are kept as deleted rows, not shown or counted
    const at = scopeNowIso(scope);
    const stale = (await store.listBp(scope.id, { fromDay: day, toDay: day })).filter((r) => r.id !== reading.id && r.state === "unconfirmed" && accountPartOf(r) === part);
    // best effort: the reading itself is written; on a database without 0016 yet the 「没量」 row simply stays, as before
    for (const r of stale) {
      await store.updateBp(scope.id, r.id, { deleted_at: at, history: [...historyOf(r), before(r, "delete", at)] }).catch((err: unknown) => {
        console.warn("[bp] a 'not measured' row could not be cleared", err instanceof Error ? err.message : err);
      });
    }
  }
  return { reading, again: false };
}

/** One of today's readings (deleted ones too when asked), or null: only today's can be changed. */
export async function todaysReading(store: Store, scope: SessionRow, id: string, opts: { includeDeleted?: boolean } = {}): Promise<BpReadingRow | null> {
  const day = scope.story_day;
  return (await store.listBp(scope.id, { fromDay: day, toDay: day, includeDeleted: opts.includeDeleted === true })).find((r) => r.id === id) ?? null;
}

/** Correct a reading: the numbers it had go into its history. */
export async function editReading(store: Store, scope: SessionRow, r: BpReadingRow, to: { systolic: number; diastolic: number; pulse?: number | null }): Promise<BpReadingRow> {
  const at = scopeNowIso(scope);
  return store.updateBp(scope.id, r.id, {
    systolic: to.systolic,
    diastolic: to.diastolic,
    state: "recorded",
    pulse: to.pulse ?? null,
    history: [...historyOf(r), before(r, "edit", at)],
  });
}

/** Delete a reading: the row stays, marked deleted, with the change in its history. */
export async function deleteReading(store: Store, scope: SessionRow, r: BpReadingRow): Promise<BpReadingRow> {
  const at = scopeNowIso(scope);
  return store.updateBp(scope.id, r.id, { deleted_at: at, history: [...historyOf(r), before(r, "delete", at)] });
}

/** Put a deleted reading back (the undo bar): exactly as it was, with the change in its history. */
export async function restoreReading(store: Store, scope: SessionRow, r: BpReadingRow): Promise<BpReadingRow> {
  const at = scopeNowIso(scope);
  return store.updateBp(scope.id, r.id, { deleted_at: null, history: [...historyOf(r), before(r, "restore", at)] });
}
