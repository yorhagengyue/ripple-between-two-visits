/**
 * Dose counts for any scope, read from the store (C2 track B; real-app 4.4). Server-only. lib/summary/doses.ts stays pure.
 *
 *   summarizeAccountDoses   an account, cell by cell (pure over rows already read)
 *   scopeDoseSummary        any scope: an account cell by cell, a demo session exactly as before (summarizeDoses)
 *
 * Her view (track D), the visit check card (track F), the pattern question and the brief all count with these, so the
 * four places give the same numbers.
 */
import { buildDoseDay } from "@/lib/daily/cells";
import { scheduleFor } from "@/lib/daily/doses";
import { windowClosed } from "@/lib/daily/schedule";
import { medName } from "@/lib/session/today";
import { isAccount, scopeD0, scopeRoutine } from "@/lib/store/scope";
import type { DoseLogRow, MedicationRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { routineForMissed, summarizeDoses, type DoseDay, type DoseSummary, type WeeklyRoutine } from "./doses";

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * An account's counts over a window, cell by cell (lib/daily/cells.ts): every slot he takes each medicine in, each
 * with its own window. One rule for the brief, her view, the visit check card and the pattern question (4.4: the same
 * numbers everywhere):
 *   - an answered tracked cell counts (taken / missed / unconfirmed with 等一下 or no_reply);
 *   - an unanswered cell counts as unconfirmed once its window has closed, and only when it is tracked (it closed after
 *     he started using Ripple and after he had the medicine);
 *   - an unanswered cell whose window is still open (today) is not due yet;
 *   - an untracked cell never counts, answered or not: signing up at 10:00 and tapping 吃了 for that morning leaves
 *     「33 个早上，吃了 29 个」 as it is all day. The one exception is an answer that is part of his record from before
 *     tracking began (the example's 33 laid-out mornings and his corrections of them; the row says so): lib/daily/cells.ts
 *     `counted`, lib/daily/tracking.ts answerCounts.
 * `nowMs` is the moment the summary is read (the brief: now; the check card: when the visit started).
 */
export function summarizeAccountDoses(input: {
  scope: SessionRow;
  meds: MedicationRow[];
  doses: DoseLogRow[];
  fromDay: number;
  toDay: number;
  nowMs: number;
  routine: WeeklyRoutine[];
}): DoseSummary {
  const { scope } = input;
  const d0 = scopeD0(scope);
  const toDay = Math.min(input.toDay, scope.story_day);
  const used = new Set<string>();
  const days: DoseDay[] = [];
  for (let day = Math.max(0, input.fromDay); day <= toDay; day++) {
    const row: DoseDay = { day, date: storyDate(d0, day), weekday: WEEKDAY_EN[weekdayIndex(d0, day)], due: 0, taken: 0, missed: 0, unconfirmed: 0 };
    for (const slotDay of buildDoseDay(scope, day, input.meds, input.doses, input.nowMs)) {
      for (const cell of slotDay.cells) {
        if (cell.state === null && (slotDay.phase !== "closed" || !cell.tracked)) continue;
        if (!cell.counted) continue;
        used.add(cell.medicationId);
        row.due += 1;
        if (cell.state === "taken") row.taken += 1;
        else if (cell.state === "missed") row.missed += 1;
        else row.unconfirmed += 1;
      }
    }
    if (row.due > 0) days.push(row);
  }
  const sum = (k: "due" | "taken" | "missed" | "unconfirmed") => days.reduce((a, d) => a + d[k], 0);
  const missedDays = days.filter((d) => d.missed > 0).map((d) => d.day);
  const meds = input.meds.filter((m) => used.has(m.id));
  return {
    fromDay: input.fromDay,
    toDay,
    meds: meds.map((m) => ({ id: m.id, name: medName(m), strength: m.label?.strength ?? null })),
    due: sum("due"),
    taken: sum("taken"),
    missed: sum("missed"),
    unconfirmed: sum("unconfirmed"),
    days,
    daysAllTaken: days.filter((d) => d.taken === d.due).length,
    missedDays,
    routine: routineForMissed(missedDays, input.routine, d0),
  };
}

/**
 * The counts for any scope over a window, read from the store (C2 track B): an account cell by cell
 * (summarizeAccountDoses), a demo session exactly as before (summarizeDoses with its one morning slot and the story
 * clock). For her view (track D), the visit check card (track F) and the brief, so the four places agree.
 */
export async function scopeDoseSummary(store: Store, scope: SessionRow, window: { fromDay: number; toDay: number; nowMs?: number }): Promise<DoseSummary> {
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: window.fromDay, toDay: window.toDay })]);
  const routine = scopeRoutine(scope) as WeeklyRoutine[];
  if (isAccount(scope)) return summarizeAccountDoses({ scope, meds, doses, fromDay: window.fromDay, toDay: window.toDay, nowMs: window.nowMs ?? appNowMs(), routine });
  const schedule = await scheduleFor(store, scope);
  return summarizeDoses({
    meds,
    doses,
    fromDay: window.fromDay,
    toDay: window.toDay,
    storyDay: scope.story_day,
    todayWindowClosed: windowClosed(scope.story_day, scope.story_day, scope.story_time, schedule),
    d0: scopeD0(scope),
    routine,
  });
}
