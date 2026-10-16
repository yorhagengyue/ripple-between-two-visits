/**
 * The add flow's one question about a reminder time (C2 track F; real-app 2.16: 「用到的提醒时间（午饭、晚饭、睡前）他的设置里没有时，
 * 当场问一次」). Server-only.
 *
 * There is one implementation of reminder times, track C's lib/profile/reminder-times.ts (the same one 「我 › 早饭时间和
 * 提醒」 uses): whether a part of the day has a time of his own or of his routine (slotTimeKnown), what it is now and
 * where it comes from (slotTimes), the range a time may lie in (SLOT_TIME_RANGE, cleanSlotTime), and the one writer
 * (saveSlotReminderTime). This file is only the add flow's glue around it:
 *
 *   slotTimeQuestions   the parts of the day the flow may have to ask about, with the time used until he answers
 *   checkAskedTimes     his answers, checked before anything is written (a time outside its part of the day: 400)
 *   keepAskedTimes      his answers kept as his own reminder times, only for a part this medicine uses and nothing
 *                       says yet (asked once: a later request never changes a time)
 *
 * Setting up his account asks for breakfast only, so the morning has its time; the other three parts hang on lunch,
 * dinner and bedtime, which nobody asked him.
 */
import { dt, type DailyKey } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { meCopy } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";
import { ProfileInputError } from "@/lib/profile/facts";
import { cleanSlotTime, saveSlotReminderTime, SLOT_TIME_RANGE, slotTimeKnown, slotTimes } from "@/lib/profile/reminder-times";
import type { DaySlot, SessionRow, Store } from "@/lib/store/types";
import { MedsError } from "./errors";

/** The parts of the day setting up never asked about. */
export const ASKED_SLOTS: readonly DaySlot[] = ["midday", "evening", "night"];

/** One question of the add flow: 「中午的药，几点提醒你？」 (the words are track C's, the same as under 「我」). */
export interface SlotTimeQuestion {
  slot: DaySlot;
  /** the time used until he answers ("12:45"), offered first */
  now: string;
  /** the earliest and latest time this part of the day takes ("HH:MM") */
  range: { from: string; to: string };
  /** the headline, in lines */
  title: string[];
  /** said when he picks a time outside the range */
  rangeWords: string;
}

/** The questions the add flow may have to ask: one per part of the day whose time nothing of his says yet. */
export function slotTimeQuestions(scope: SessionRow, locale: Locale): SlotTimeQuestion[] {
  const c = meCopy(locale);
  const now = slotTimes(scope);
  return ASKED_SLOTS.filter((slot) => !slotTimeKnown(scope, slot)).map((slot) => {
    const range = SLOT_TIME_RANGE[slot];
    return {
      slot,
      now: now.find((t) => t.slot === slot)!.first,
      range,
      title: c.slotTitle(dt(locale, `slotMed.${slot}` as DailyKey)),
      rangeWords: c.slotRange(clockWords(range.from, locale), clockWords(range.to, locale)),
    };
  });
}

/**
 * His answers for the parts of the day this medicine uses, cleaned by track C's rule (cleanSlotTime). A time that is
 * not one, or lies outside its part of the day, is MedsError bad_time (400) with the part and its range: nothing has
 * been written yet when this throws.
 */
export function checkAskedTimes(times: Partial<Record<string, string>> | null | undefined, slots: readonly DaySlot[]): Partial<Record<DaySlot, string>> {
  const out: Partial<Record<DaySlot, string>> = {};
  for (const slot of ASKED_SLOTS) {
    const t = times?.[slot];
    if (typeof t !== "string" || !slots.includes(slot)) continue;
    try {
      out[slot] = cleanSlotTime(slot, t);
    } catch (err) {
      if (err instanceof ProfileInputError) throw new MedsError("bad_time", `${slot}: ${err.code}`, { slot, code: err.code, ...SLOT_TIME_RANGE[slot] });
      throw err;
    }
  }
  return out;
}

/**
 * Keep his answers as his own reminder times (track C's saveSlotReminderTime, one part after another). A part that
 * already has a time (he answered before, he set it under 「我」, or his routine says) is left as it is: the question is
 * asked once. Returns the scope row as it is now.
 */
export async function keepAskedTimes(store: Store, scope: SessionRow, slots: readonly DaySlot[], times: Partial<Record<string, string>> | null | undefined): Promise<SessionRow> {
  const clean = checkAskedTimes(times, slots);
  let row = scope;
  for (const slot of ASKED_SLOTS) {
    const t = clean[slot];
    if (!t || slotTimeKnown(row, slot)) continue;
    row = await saveSlotReminderTime(store, row, slot, t);
  }
  return row;
}
