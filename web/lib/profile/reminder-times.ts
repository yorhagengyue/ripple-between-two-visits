/**
 * When each part of his day is reminded (real-app 2.16 line 252, 2.23 「早饭时间和提醒」). Track C. Server-only.
 *
 * A medicine's cells hang on four parts of the day (lib/daily: morning, midday, evening, night). Each part's first
 * reminder is, in this order:
 *   the time he set himself     settings.reminder_time for the morning (the key the app has always read),
 *                               settings.reminder_times[slot] for the other three (lib/daily/cells.ts ownFirstReminder)
 *   what his routine says       the meal or bedtime in his routine plus the part's offset (breakfast + 15 min, ...)
 *   the app's own time          lunch 12:30, dinner 18:30, bed 22:00 (lib/daily/schedule.ts SLOT_ANCHORS)
 * This module is the one writer of the first kind: saveSlotReminderTime (one part), saveReminderTimes (several, the
 * profile API) and what a screen needs to show them (slotTimes; slotTimesInUse: only the parts he uses) or to know
 * whether to ask (slotTimeKnown: track F's medicine-add flow asks once for a part whose time he never gave).
 *
 * A time must lie in its part of the day, so the day's parts keep their order and a window never runs past midnight.
 * These are settings, not facts: nothing here writes a profile_fact (2.5: 提醒时间写进 session.settings).
 */
import { ownFirstReminder, scopeSlotSchedule } from "@/lib/daily/cells";
import { slotAnchor, type RoutineEntry } from "@/lib/daily/schedule";
import { doseSlotsOf } from "@/lib/daily/slots";
import { scopeRoutine } from "@/lib/store/scope";
import type { DaySlot, MedicationRow, ScopeSettings, SessionRow, Store } from "@/lib/store/types";
import { cleanTime, ProfileInputError } from "./facts";

export const REMINDER_SLOTS: readonly DaySlot[] = ["morning", "midday", "evening", "night"];

export function isReminderSlot(x: unknown): x is DaySlot {
  return typeof x === "string" && (REMINDER_SLOTS as readonly string[]).includes(x);
}

/** The earliest and latest first reminder each part of the day takes ("HH:MM", inclusive). */
export const SLOT_TIME_RANGE: Readonly<Record<DaySlot, { from: string; to: string }>> = {
  morning: { from: "04:00", to: "11:00" },
  midday: { from: "11:00", to: "15:00" },
  evening: { from: "16:00", to: "20:30" },
  night: { from: "19:00", to: "22:55" },
};

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "8:5"-style input is refused, "8:05" becomes "08:05"; a time outside its part of the day is time_out_of_range. */
export function cleanSlotTime(slot: DaySlot, time: string): string {
  const t = cleanTime(time);
  const r = SLOT_TIME_RANGE[slot];
  if (minutes(t) < minutes(r.from) || minutes(t) > minutes(r.to)) throw new ProfileInputError("time_out_of_range");
  return t;
}

/** The times he set himself for the three later parts (settings.reminder_times), cleaned of anything else. */
function ownTimes(scope: Pick<SessionRow, "settings">): Partial<Record<DaySlot, string>> {
  const raw = scope.settings?.reminder_times;
  const out: Partial<Record<DaySlot, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const slot of REMINDER_SLOTS) {
    const t = (raw as Record<string, unknown>)[slot];
    if (slot !== "morning" && typeof t === "string" && /^\d{2}:\d{2}$/.test(t)) out[slot] = t;
  }
  return out;
}

/**
 * The settings change for these times (null: back to what his routine or the app says). Throws ProfileInputError
 * (time_invalid, time_out_of_range). The morning time lives in settings.reminder_time, the others together in
 * settings.reminder_times (settings merge key by key, so the whole object is written).
 */
export function reminderTimesPatch(scope: Pick<SessionRow, "settings">, times: Partial<Record<DaySlot, string | null>>): ScopeSettings {
  const patch: ScopeSettings = {};
  const others = ownTimes(scope);
  let touched = false;
  for (const slot of REMINDER_SLOTS) {
    const t = times[slot];
    if (t === undefined) continue;
    const clean = t === null ? null : cleanSlotTime(slot, t);
    if (slot === "morning") patch.reminder_time = clean;
    else {
      touched = true;
      if (clean === null) delete others[slot];
      else others[slot] = clean;
    }
  }
  if (touched) patch.reminder_times = others;
  return patch;
}

/** Save several parts' first reminder at once (the profile API). Returns the scope as it is now. */
export async function saveReminderTimes(store: Store, scope: SessionRow, times: Partial<Record<DaySlot, string | null>>): Promise<SessionRow> {
  const settings = reminderTimesPatch(scope, times);
  return Object.keys(settings).length ? store.updateScope(scope.id, { settings }) : scope;
}

/**
 * Save one part's first reminder ("HH:MM"; null: back to what his routine or the app says). The one call a flow needs
 * after asking him 「中午的药，几点提醒你？」 (track F's medicine-add flow, real-app 2.16 line 252). An account's own space
 * only (the store refuses others). Throws ProfileInputError for a time that is not one or lies outside its part of the day.
 */
export async function saveSlotReminderTime(store: Store, scope: SessionRow, slot: DaySlot, time: string | null): Promise<SessionRow> {
  return saveReminderTimes(store, scope, { [slot]: time });
}

/**
 * Does his own data say when this part of the day is reminded: a time he set, or the meal or bedtime in his routine?
 * False: the app's own time applies, and a flow that needs this part asks him once.
 */
export function slotTimeKnown(scope: SessionRow, slot: DaySlot): boolean {
  return ownFirstReminder(scope, slot) !== null || slotAnchor(scopeRoutine(scope) as RoutineEntry[], slot).fromRoutine;
}

export type SlotTimeSource = "own" | "routine" | "app";

export interface SlotTime {
  slot: DaySlot;
  /** the first reminder, "HH:MM" */
  first: string;
  /** asked again, "HH:MM" */
  second: string;
  /** where the time comes from: he set it, his routine's meal or bedtime, or the app's own time */
  source: SlotTimeSource;
}

/** Every part of the day with its reminder times as they stand now, in the day's order. */
export function slotTimes(scope: SessionRow): SlotTime[] {
  const routine = scopeRoutine(scope) as RoutineEntry[];
  return REMINDER_SLOTS.map((slot) => {
    const s = scopeSlotSchedule(scope, slot);
    const source: SlotTimeSource = ownFirstReminder(scope, slot) !== null ? "own" : slotAnchor(routine, slot).fromRoutine ? "routine" : "app";
    return { slot, first: s.first, second: s.second, source };
  });
}

/**
 * The parts of the day 「我 › 早饭时间和提醒」 lists (owner's tidy of 10-13): the morning always; midday, evening and
 * bedtime only when a medicine on his list is taken then or he set that time himself. A part that is left out is not
 * lost: adding a medicine that uses it asks him for its time (lib/meds/slot-times.ts), and the row is there from then
 * on. `meds`: his medicine rows as the store lists them.
 */
export function slotTimesInUse(scope: SessionRow, meds: readonly MedicationRow[]): SlotTime[] {
  const used = new Set<DaySlot>(meds.flatMap((m) => doseSlotsOf(scope, m).slots));
  return slotTimes(scope).filter((t) => t.slot === "morning" || t.source === "own" || used.has(t.slot));
}
