/**
 * From when a medicine's reminder windows are his (C2 architecture review, finding 12). Pure.
 *
 * On an account, a window counts only when it closed after the scope's tracking_since (he started using Ripple, or a
 * filming account's clock was moved) and after he had the medicine (its start_at: he confirmed it; else the moment it
 * was added). A demo row has no bound.
 */
import { isAccount } from "@/lib/store/scope";
import type { DoseLogRow, MedicationRow, SessionRow } from "@/lib/store/types";

/** The earliest moment (epoch ms) after which a window of this medicine counts as his; null on a demo row (no bound). */
export function trackedAfterMs(
  session: Pick<SessionRow, "kind" | "tracking_since">,
  med: Pick<MedicationRow, "created_at"> & Partial<Pick<MedicationRow, "start_at">>,
): number | null {
  if (!isAccount(session)) return null;
  const bounds = [session.tracking_since, med.start_at ?? med.created_at].filter((x): x is string => typeof x === "string").map((x) => Date.parse(x));
  const ok = bounds.filter((x) => Number.isFinite(x));
  return ok.length ? Math.max(...ok) : null;
}

/** What answerCounts reads of a row: when it was written, and what it says it is (DoseLogRow.pre_tracking). */
export type CountedRow = Pick<DoseLogRow, "created_at"> & Partial<Pick<DoseLogRow, "pre_tracking">>;

/**
 * Does a cell's answer count in the summaries (real-app 4.4: the brief, her view, the visit check card and the pattern
 * question never count an untracked cell)? `after` is trackedAfterMs, `closeMs` the cell's window close.
 *
 *   tracked cell (closed after `after`, or a demo row)   its answer counts
 *   untracked cell, no answer                            never counts
 *   untracked cell, answered                             by what the row is (DoseLogRow.pre_tracking), not by the clock:
 *     pre_tracking true    part of his record from before tracking began: the example's history or a filming account's
 *                          scene, laid out with the space, or his correction of an answer that already counted there
 *                          (answerPreTracking). It counts, whenever it was written.
 *     pre_tracking false   any other answer written on an account. It counts only when it was written strictly before
 *                          tracking began for this cell: he answered while the window was his and the clock moved on
 *                          afterwards (a filming account). An answer written once the window was no longer his stays his
 *                          own note on Today: signing up at 10:00 and tapping 吃了 for that morning, even in the very
 *                          millisecond of the sign-up, leaves 「33 个早上，吃了 29 个」 as it is all day.
 *     no mark at all       a row from before the mark existed (a database without migration 0018, an account laid out
 *                          before it): the rule as it was, written at or before the moment tracking began.
 * Row times and `after` are both in the scope's own time (the stores stamp rows with the scope's "now").
 */
export function answerCounts(after: number | null, closeMs: number, row: CountedRow | null): boolean {
  if (after === null || closeMs > after) return true;
  if (!row) return false;
  if (row.pre_tracking === true) return true;
  const written = Date.parse(row.created_at);
  if (!Number.isFinite(written)) return false;
  return row.pre_tracking === false ? written < after : written <= after;
}

/**
 * What a new answer says it is (DoseLogRow.pre_tracking), from the cell it is written on, before anything is deleted:
 * true exactly when the cell is outside tracking and the answer it replaces counted. So correcting a laid-out morning
 * changes that morning's answer and never drops the morning; an answer on a cell that was not his and held nothing that
 * counted stays his own note; on a tracked cell it is a plain answer.
 */
export function answerPreTracking(cell: { tracked: boolean; counted: boolean }): boolean {
  return !cell.tracked && cell.counted;
}
