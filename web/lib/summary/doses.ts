/**
 * Dose counts over a window of story days (M6 "days this week he took his medicine", M7 "doses due, taken, missed
 * and unconfirmed, and which kind of days the misses fall on"). Pure; server and client safe.
 *
 * Due doses come from the calendar, not from the rows: every prescription medicine on the list by that day
 * (lib/session/today isDue: start_day reached) owes one morning dose a day. A due dose with no answer recorded
 * counts as unconfirmed (未确认, "没记录的那次显示「未确认」"); an undone answer is no answer (lib/daily/dose-state).
 * The story day itself counts only once he answered it or its reminder window has closed (lib/daily/schedule):
 * before that today's dose is not due yet, it is still being asked.
 *
 * Missed mornings are only described against his own weekly routine (the seed's persona.routine: tai chi on Tue
 * and Thu), the same facts the M4 pattern question and the M2 check card use. Nothing here judges adherence.
 */
import { shownState } from "@/lib/daily/dose-state";
import { DOSE_SLOT, isDue, medName } from "@/lib/session/today";
import type { DoseLogRow, DoseState, MedicationRow } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface WeeklyRoutine {
  label: string;
  label_zh?: string;
  days: "daily" | string[];
}

export interface DoseDay {
  day: number;
  date: string;
  /** "Tue" */
  weekday: string;
  due: number;
  taken: number;
  missed: number;
  unconfirmed: number;
}

export interface RoutineMatch {
  label: string;
  labelZh: string | null;
  /** the routine's weekdays ("Tue", "Thu") */
  weekdays: string[];
  /** missed mornings that fall on it */
  onRoutine: number[];
  /** every missed morning in the window falls on it */
  all: boolean;
}

export interface DoseSummary {
  fromDay: number;
  toDay: number;
  /** prescription medicines that owed at least one dose in the window */
  meds: { id: string; name: string; strength: string | null }[];
  due: number;
  taken: number;
  missed: number;
  unconfirmed: number;
  /** days with at least one due dose, in order */
  days: DoseDay[];
  /** days on which every due dose was taken */
  daysAllTaken: number;
  /** days with a missed dose, in order */
  missedDays: number[];
  /** the weekly routine most of the missed mornings fall on (null when none does) */
  routine: RoutineMatch | null;
}

export interface DoseSummaryInput {
  meds: MedicationRow[];
  doses: DoseLogRow[];
  fromDay: number;
  toDay: number;
  /** session.story_day: nothing after it counts */
  storyDay: number;
  /** has the answer window of the story day closed (lib/daily/schedule windowClosed)? */
  todayWindowClosed: boolean;
  d0: string;
  routine: WeeklyRoutine[];
}

function stateOf(row: DoseLogRow | undefined): DoseState | null {
  return shownState(row ?? null);
}

/** The weekly routine covering the most missed mornings (ties: the routine listed first). */
export function routineForMissed(missedDays: number[], routine: WeeklyRoutine[], d0: string): RoutineMatch | null {
  if (missedDays.length === 0) return null;
  let best: RoutineMatch | null = null;
  for (const r of routine) {
    if (!Array.isArray(r.days)) continue;
    const days = r.days;
    const onRoutine = missedDays.filter((day) => days.includes(WEEKDAY_EN[weekdayIndex(d0, day)]));
    if (onRoutine.length === 0) continue;
    if (!best || onRoutine.length > best.onRoutine.length) {
      best = { label: r.label, labelZh: r.label_zh ?? null, weekdays: [...days], onRoutine, all: onRoutine.length === missedDays.length };
    }
  }
  return best;
}

export function summarizeDoses(input: DoseSummaryInput): DoseSummary {
  const toDay = Math.min(input.toDay, input.storyDay);
  const byKey = new Map(input.doses.map((d) => [`${d.medication_id}|${d.day}|${d.slot}`, d]));
  const meds = input.meds.filter((m) => m.origin === "prescription" && m.start_day !== null);
  const used = new Set<string>();
  const days: DoseDay[] = [];
  for (let day = Math.max(0, input.fromDay); day <= toDay; day++) {
    const row: DoseDay = { day, date: storyDate(input.d0, day), weekday: WEEKDAY_EN[weekdayIndex(input.d0, day)], due: 0, taken: 0, missed: 0, unconfirmed: 0 };
    for (const m of meds) {
      if (!isDue(m, day)) continue;
      const state = stateOf(byKey.get(`${m.id}|${day}|${DOSE_SLOT}`));
      // today: only once he answered, or the reminder window closed with no answer
      if (day === input.storyDay && state === null && !input.todayWindowClosed) continue;
      used.add(m.id);
      row.due += 1;
      if (state === "taken") row.taken += 1;
      else if (state === "missed") row.missed += 1;
      else row.unconfirmed += 1;
    }
    if (row.due > 0) days.push(row);
  }
  const sum = (k: "due" | "taken" | "missed" | "unconfirmed") => days.reduce((a, d) => a + d[k], 0);
  const missedDays = days.filter((d) => d.missed > 0).map((d) => d.day);
  return {
    fromDay: input.fromDay,
    toDay,
    meds: meds.filter((m) => used.has(m.id)).map((m) => ({ id: m.id, name: medName(m), strength: m.label?.strength ?? null })),
    due: sum("due"),
    taken: sum("taken"),
    missed: sum("missed"),
    unconfirmed: sum("unconfirmed"),
    days,
    daysAllTaken: days.filter((d) => d.taken === d.due).length,
    missedDays,
    routine: routineForMissed(missedDays, input.routine, input.d0),
  };
}
