/**
 * An account's medicine day, cell by cell (C2 track B; real-app 2.7, 4.4). Server-only (it reads the store).
 *
 * A cell is one medicine in one slot of one day. Which cells exist, and when each one's window opens and closes:
 *
 *   active     a prescription medicine on his list (start_day reached), in each slot he takes it (lib/daily/slots.ts);
 *              when the medicine has a start moment (start_at: he confirmed it), a cell whose first reminder came
 *              before that moment is not his yet: he starts with the next cell (real-app 2.16). A cell he answered
 *              stays a cell whatever the medicine's times are now (his record does not vanish with a new bag)
 *   times      the slot's first reminder, second reminder and window close (lib/daily/schedule.ts slotSchedule), as
 *              instants in the scope's time zone on that day
 *   tracked    its window closed after he started using Ripple (the scope's tracking_since) and after he had the
 *              medicine (start_at, else when it was added): a window that closed before is never settled as "no reply",
 *              never reminded about, and never counted (real-app 4.4), except for an answer that is part of his record
 *              from before tracking began: the example's laid-out history and his corrections of it (the row says so,
 *              DoseLogRow.pre_tracking), or an answer he gave while the window was his before a filming account's clock
 *              moved on: `counted` (lib/daily/tracking.ts answerCounts)
 *   answer     the dose_log row: taken / missed (with his reason) / unconfirmed (later: 等一下, or no_reply when the
 *              window closed with no answer); its created_at is when he answered (undo deletes the row, and every
 *              new answer writes a fresh row: lib/daily/doses.ts answerDose)
 *
 * Demo scopes never come here: they keep lib/daily/doses.ts todayDoses (one morning slot, the story clock).
 */
import { medName } from "@/lib/session/today";
import { zhFromSlots } from "@/lib/safety/zh";
import { scopeD0, scopeNow, scopeRoutine, scopeTz } from "@/lib/store/scope";
import type { DaySlot, DoseLogRow, DoseState, MedicationRow, SessionRow, Store } from "@/lib/store/types";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { localDate, zonedTimeToUtcMs } from "@/lib/time/clock";
import { shownState } from "./dose-state";
import { slotSchedule, type RoutineEntry } from "./schedule";
import { doseSlotsOf, SLOT_ORDER, type SlotSource } from "./slots";
import { answerCounts, trackedAfterMs } from "./tracking";
import type { ReminderSchedule } from "./types";

export type SlotPhase = "before" | "first" | "second" | "closed";

export interface DoseCell {
  medicationId: string;
  /** "Amlodipine" (the label's drug, else the kb id) */
  name: string;
  strength: string | null;
  /** the label's own directions, word for word (or its whole text), when there is a label */
  labelWords: string | null;
  /** the label line's Mandarin slot template ("药袋上写着：每天早上吃一粒。"), or null: show the label's own words */
  labelZh: string | null;
  labelConfirmed: boolean;
  /** where the slot came from: the label's time words or his own choice */
  slotSource: SlotSource | null;
  /** the row, as stored (null: no answer) */
  row: DoseLogRow | null;
  /** his answer as shown: null when there is none (an old "undone" row reads as none too) */
  state: DoseState | null;
  reason: string | null;
  reasonText: string | null;
  /** when the answer was written (ISO); null without one */
  answeredAt: string | null;
  /** the window closed (or will close) after he started tracking and had the medicine */
  tracked: boolean;
  /**
   * the summaries may count this cell (real-app 4.4): a tracked cell, or an untracked one whose answer is part of his
   * record from before tracking began (lib/daily/tracking.ts answerCounts: what the row is). Any other answer on an
   * untracked cell is shown on Today, never counted
   */
  counted: boolean;
}

export interface SlotDay {
  day: number;
  /** YYYY-MM-DD in the scope's zone */
  date: string;
  slot: DaySlot;
  /** HH:MM */
  schedule: ReminderSchedule;
  firstMs: number;
  secondMs: number;
  closeMs: number;
  /** where the window stands at the moment the day was read */
  phase: SlotPhase;
  cells: DoseCell[];
}

/** The first reminder he set himself for a slot ("HH:MM"), from the scope's settings, or null. */
export function ownFirstReminder(scope: Pick<SessionRow, "settings">, slot: DaySlot): string | null {
  const s = (scope.settings ?? {}) as { reminder_time?: unknown; reminder_times?: unknown };
  const byslot = s.reminder_times && typeof s.reminder_times === "object" ? (s.reminder_times as Record<string, unknown>)[slot] : undefined;
  const t = typeof byslot === "string" ? byslot : slot === "morning" && typeof s.reminder_time === "string" ? s.reminder_time : null;
  return t && /^\d{1,2}:\d{2}$/.test(t) ? t : null;
}

/** A slot's reminder times on this scope. */
export function scopeSlotSchedule(scope: SessionRow, slot: DaySlot): ReminderSchedule {
  return slotSchedule(scopeRoutine(scope) as RoutineEntry[], slot, ownFirstReminder(scope, slot));
}

export function phaseAt(nowMs: number, t: { firstMs: number; secondMs: number; closeMs: number }): SlotPhase {
  if (nowMs >= t.closeMs) return "closed";
  if (nowMs >= t.secondMs) return "second";
  if (nowMs >= t.firstMs) return "first";
  return "before";
}

/** The slot's three instants on `day` (the scope's zone). */
export function slotInstants(scope: SessionRow, day: number, schedule: ReminderSchedule): { date: string; firstMs: number; secondMs: number; closeMs: number } {
  const date = storyDate(scopeD0(scope), day);
  const tz = scopeTz(scope);
  return {
    date,
    firstMs: zonedTimeToUtcMs(date, schedule.first, tz),
    secondMs: zonedTimeToUtcMs(date, schedule.second, tz),
    closeMs: zonedTimeToUtcMs(date, schedule.closes, tz),
  };
}

/** Is this medicine's cell in this slot on this day his? (prescription, started, not before he confirmed it) */
export function cellActive(med: Pick<MedicationRow, "origin" | "start_day" | "start_at">, day: number, firstMs: number): boolean {
  if (med.origin !== "prescription" || med.start_day === null || med.start_day > day) return false;
  const start = med.start_at ? Date.parse(med.start_at) : Number.NaN;
  return !Number.isFinite(start) || firstMs >= start;
}

function labelWordsOf(med: MedicationRow): string | null {
  const w = med.label?.directions ?? med.label?.text ?? null;
  return w && w.trim() ? w.trim() : null;
}

/**
 * Pure: the day's slots from rows already read (`doses` may hold other days; only `day` is used). `nowMs` is the app's
 * clock; the phases are read at the scope's own "now" (C2 track J: a filming account's clock offset, lib/store/scope.ts
 * scopeNow; the same instant for every other scope), because the slot instants are on the scope's own dates.
 */
export function buildDoseDay(scope: SessionRow, day: number, meds: MedicationRow[], doses: DoseLogRow[], nowMs: number): SlotDay[] {
  const at = scopeNow(scope, nowMs);
  const out: SlotDay[] = [];
  for (const slot of SLOT_ORDER) {
    const schedule = scopeSlotSchedule(scope, slot);
    const t = slotInstants(scope, day, schedule);
    const cells: DoseCell[] = [];
    for (const med of meds) {
      const slots = doseSlotsOf(scope, med);
      const row = doses.find((d) => d.medication_id === med.id && d.day === day && d.slot === slot) ?? null;
      const state = shownState(row);
      // a cell he answered stays a cell (his record) when the medicine's times or start moment changed afterwards (a new
      // bag photographed, another time of day chosen): only an unanswered cell needs the medicine to be due then
      const due = slots.slots.includes(slot) && cellActive(med, day, t.firstMs);
      if (!due && !(state !== null && med.origin === "prescription")) continue;
      const after = trackedAfterMs(scope, med);
      const words = labelWordsOf(med);
      cells.push({
        medicationId: med.id,
        name: medName(med),
        strength: med.label?.strength ?? null,
        labelWords: words,
        labelZh: words ? zhFromSlots(words, "label") : null,
        labelConfirmed: med.status === "label_confirmed" || med.status === "pharmacist_checked",
        slotSource: slots.source,
        row,
        state,
        reason: state === null ? null : (row?.reason ?? null),
        reasonText: state === null ? null : (row?.reason_text ?? null),
        answeredAt: state === null ? null : (row?.created_at ?? null),
        tracked: after === null || t.closeMs > after,
        counted: answerCounts(after, t.closeMs, state === null ? null : row),
      });
    }
    if (cells.length) out.push({ day, slot, schedule, ...t, phase: phaseAt(at, t), cells });
  }
  return out;
}

/** The scope's medicine day (`day`: a story day of the scope, usually today or yesterday). */
export async function doseDay(store: Store, scope: SessionRow, day: number, nowMs: number): Promise<SlotDay[]> {
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: day, toDay: day })]);
  return buildDoseDay(scope, day, meds, doses, nowMs);
}

/** Prescription medicines on his list (started) that have no slot yet: no time words on the label and none chosen. */
export function medsWithoutSlot(scope: SessionRow, meds: MedicationRow[], day: number): MedicationRow[] {
  return meds.filter((m) => m.origin === "prescription" && m.start_day !== null && m.start_day <= day && doseSlotsOf(scope, m).slots.length === 0);
}

/** A cell he has not answered (or answered "later") and that is his to be reminded about. */
export function waitingForHim(c: Pick<DoseCell, "state" | "reason" | "tracked">): boolean {
  return c.tracked && (c.state === null || (c.state === "unconfirmed" && c.reason === "later"));
}

/**
 * The dose rows the summaries may count (real-app 4.4), for code that reads rows rather than cells (the routine-pattern
 * question): an account's answer written on an untracked cell after tracking began is left out; every other row, and
 * every row of a demo scope, stays.
 */
export function countedDoseRows(scope: SessionRow, meds: MedicationRow[], doses: DoseLogRow[]): DoseLogRow[] {
  const byId = new Map(meds.map((m) => [m.id, m]));
  const closes = new Map<string, number>();
  return doses.filter((d) => {
    const med = byId.get(d.medication_id);
    if (!med) return true;
    const after = trackedAfterMs(scope, med);
    if (after === null) return true;
    const key = `${d.day}|${d.slot}`;
    let closeMs = closes.get(key);
    if (closeMs === undefined) {
      closeMs = slotInstants(scope, d.day, scopeSlotSchedule(scope, d.slot)).closeMs;
      closes.set(key, closeMs);
    }
    return answerCounts(after, closeMs, d);
  });
}

/** One tracked cell whose window closed with no answer (what the settling writes as "no reply"). */
export interface OpenCell {
  day: number;
  slot: DaySlot;
  med: MedicationRow;
  /** a row that reads as no answer (an old "undone" row), to be replaced; else null */
  row: DoseLogRow | null;
  schedule: ReminderSchedule;
  closeMs: number;
}

/** The first story day a window can be his: the day tracking began for the medicine that started earliest. */
export function firstTrackedDay(scope: SessionRow, meds: MedicationRow[]): number | null {
  const starts = meds
    .filter((m) => m.origin === "prescription" && m.start_day !== null)
    .map((m) => trackedAfterMs(scope, m))
    .filter((x): x is number => x !== null);
  if (!starts.length) return null;
  return dayOfDate(scopeD0(scope), localDate(Math.min(...starts), scopeTz(scope)));
}

/**
 * Every tracked cell from `fromDay` to `toDay` whose window has closed with no answer (real-app 6.5: 只结算关窗晚于
 * max(tracking_since, start_at) 的格子), oldest first. Pure and lean: a cell that has an answer costs one lookup, so
 * running it over every day since tracking began is cheap once the old days are settled. `nowMs` is the app's clock.
 */
export function openClosedCells(scope: SessionRow, meds: MedicationRow[], doses: DoseLogRow[], fromDay: number, toDay: number, nowMs: number): OpenCell[] {
  const at = scopeNow(scope, nowMs);
  const rows = new Map<string, DoseLogRow>();
  for (const d of doses) rows.set(`${d.medication_id}|${d.day}|${d.slot}`, d);
  const due = meds
    .filter((m) => m.origin === "prescription" && m.start_day !== null)
    .map((m) => ({ med: m, slots: doseSlotsOf(scope, m).slots, after: trackedAfterMs(scope, m) }));
  const schedules = new Map<DaySlot, ReminderSchedule>();
  const out: OpenCell[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    for (const slot of SLOT_ORDER) {
      let t: ReturnType<typeof slotInstants> | null = null;
      for (const { med, slots, after } of due) {
        if (!slots.includes(slot) || med.start_day! > day) continue;
        const row = rows.get(`${med.id}|${day}|${slot}`) ?? null;
        if (shownState(row) !== null) continue;
        let schedule = schedules.get(slot);
        if (!schedule) schedules.set(slot, (schedule = scopeSlotSchedule(scope, slot)));
        t ??= slotInstants(scope, day, schedule);
        if (at < t.closeMs || !cellActive(med, day, t.firstMs)) continue;
        if (after !== null && t.closeMs <= after) continue;
        out.push({ day, slot, med, row, schedule, closeMs: t.closeMs });
      }
    }
  }
  return out;
}

/**
 * Does this slot ask for him right now (a reminder is due)? Its first or second reminder stretch, with a cell that is
 * his and still waits: no answer at all, or 等一下 said before the second reminder came. After 等一下 the slot is quiet
 * until the second reminder (「好，9:15 再问你」), and after 等一下 to the second one it stays quiet.
 */
export function asksNow(s: Pick<SlotDay, "phase" | "secondMs" | "cells">): boolean {
  if (s.phase !== "first" && s.phase !== "second") return false;
  return s.cells.some((c) => {
    if (!c.tracked) return false;
    if (c.state === null) return true;
    if (!(c.state === "unconfirmed" && c.reason === "later")) return false;
    const said = c.answeredAt ? Date.parse(c.answeredAt) : Number.NaN;
    return s.phase === "second" && Number.isFinite(said) && said < s.secondMs;
  });
}
