/**
 * The daily check-in clock (task M4 items 1 and 5). Pure; client-safe.
 *
 * His routine (timeline seed persona.routine) says breakfast is at 08:30; Wei Ling's clip plays "after_breakfast".
 * The check-in for the morning tablet follows that:
 *   first reminder   breakfast + 15 min (08:45: the beat "d9-first-dose" and "d15-tai-chi" in lib/session/beats.ts)
 *   second reminder  first + 30 min (09:15)
 *   window closes    second + 30 min (09:45): a dose with no answer by then is recorded as unconfirmed with
 *                    reason "no_reply" ("no reply after two reminders"); that is what Wei Ling may be told about,
 *                    only when he switched family_grant.no_reply_alert on.
 * A plays_at of "HH:MM" sets the first reminder directly. With no story time (the day label shows no hour), today's
 * window is open: nothing is settled for today until the clock says the window has passed.
 *
 * Reasons after 没吃 are his answer to "what happened this morning?": a chip per weekly routine that falls on this
 * day (打太极 on Tue/Thu, code "tai_chi_morning" like the seed), forgot, out, medicine not with me, or his own words.
 * On an account every slot of the day gets its own (reasonOptions with `at`): the routines around that slot.
 */
import { isClockTime, parseClockTime, weekdayIndex } from "@/lib/story/clock";
import type { DaySlot } from "@/lib/store/types";
import type { ReasonOption, ReminderSchedule } from "./types";

export interface RoutineEntry {
  label: string;
  label_zh?: string;
  days: "daily" | string[];
  time: string;
}

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_BREAKFAST = "08:30";
export const AFTER_BREAKFAST_MIN = 15;
export const SECOND_REMINDER_MIN = 30;
export const WINDOW_AFTER_SECOND_MIN = 30;

function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Routine slug: "Tai chi" -> "tai_chi". A habit named in other letters (「打太极」, 「8点散步」 from setting up) gets a stable
 * slug from all its words: "r_" and a hash of them (the same words always give the same slug), never "" and never
 * just the digits in it.
 */
export function routineSlug(label: string): string {
  const words = label.normalize("NFKC").trim();
  const latin = words
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (latin && /^[ -~]*$/.test(words)) return latin;
  return words ? `r_${wordsHash(words)}` : "routine";
}

/** FNV-1a over the UTF-16 code units, base 36: short, stable, [a-z0-9]. */
function wordsHash(words: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) {
    h ^= words.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Reminder times for the morning dose: from plays_at ("after_breakfast" or "HH:MM") and his breakfast time. */
export function reminderSchedule(routine: RoutineEntry[], playsAt: string | null | undefined = "after_breakfast"): ReminderSchedule {
  let first: number;
  if (playsAt && isClockTime(playsAt)) first = parseClockTime(playsAt);
  else {
    const breakfast = routine.find((r) => /breakfast/i.test(r.label) || r.label_zh === "早饭");
    first = parseClockTime(breakfast && isClockTime(breakfast.time) ? breakfast.time : DEFAULT_BREAKFAST) + AFTER_BREAKFAST_MIN;
  }
  const second = first + SECOND_REMINDER_MIN;
  return { first: hhmm(first), second: hhmm(second), closes: hhmm(second + WINDOW_AFTER_SECOND_MIN) };
}

/** Has the answer window for `doseDay` closed at this story moment? (A missing time never closes today's window.) */
export function windowClosed(doseDay: number, storyDay: number, storyTime: string | null, schedule: ReminderSchedule): boolean {
  if (doseDay < storyDay) return true;
  if (doseDay > storyDay) return false;
  if (!storyTime || !isClockTime(storyTime)) return false;
  return parseClockTime(storyTime) >= parseClockTime(schedule.closes);
}

/** Which reminder is due at this story moment for today's unanswered dose: 0 none, 1 first, 2 second. */
export function reminderDue(storyTime: string | null, schedule: ReminderSchedule): 0 | 1 | 2 {
  if (!storyTime || !isClockTime(storyTime)) return 0;
  const now = parseClockTime(storyTime);
  if (now >= parseClockTime(schedule.closes)) return 0;
  if (now >= parseClockTime(schedule.second)) return 2;
  if (now >= parseClockTime(schedule.first)) return 1;
  return 0;
}

/** Weekly (not daily) routines that fall on this story day. */
export function routinesOnDay(routine: RoutineEntry[], d0: string, day: number): RoutineEntry[] {
  const wd = WEEKDAY_EN[weekdayIndex(d0, day)];
  return routine.filter((r) => Array.isArray(r.days) && r.days.includes(wd));
}

// owner 10-14: the 华语 words are professional (they were 忘了 / 出门了 / 药不在身边); the codes never change. A tap stores
// the words as the dose's reason_text, so an answer given before keeps the words it was given with
export const FIXED_REASONS: ReasonOption[] = [
  { code: "forgot", label: { en: "Forgot", zh: "忘记服用" } },
  { code: "away", label: { en: "I was out", zh: "外出" } },
  { code: "not_with_me", label: { en: "Medicine not with me", zh: "药物不在身边" } },
];

/** How far before a slot's first reminder, and after its window closes, a routine still counts as "around that slot". */
export const ROUTINE_BEFORE_SLOT_MIN = 180;
export const ROUTINE_AFTER_SLOT_MIN = 60;

/** Does a routine's time fall around a slot (three hours before its first reminder to an hour after it closes)? */
export function routineAroundSlot(r: Pick<RoutineEntry, "time">, schedule: ReminderSchedule): boolean {
  if (!isClockTime(r.time)) return false;
  const t = parseClockTime(r.time);
  return t >= parseClockTime(schedule.first) - ROUTINE_BEFORE_SLOT_MIN && t <= parseClockTime(schedule.closes) + ROUTINE_AFTER_SLOT_MIN;
}

/**
 * Reason chips after 未服药 (real-app 2.7, 6.5 「原因选项来自他自己的作息」): his own weekly routines of that day first,
 * then the fixed ones (忘记服用 / 外出 / 药物不在身边; his own words, 「其他原因」, are the screen's last choice).
 *
 *   demo (no `at`)     the morning slot: every weekly routine of the day, code "<slug>_morning" (as before)
 *   account (`at`)     any slot of the day: the weekly routines of the day that fall around that slot (tai chi at
 *                      07:30 for the morning medicine, a Friday 19:30 mahjong for the evening and bedtime ones), code
 *                      "<slug>_<slot>". A routine nowhere near the slot is not offered for it.
 */
export function reasonOptions(routine: RoutineEntry[], d0: string, day: number, at?: { slot: DaySlot; schedule: ReminderSchedule }): ReasonOption[] {
  const fromRoutine = routinesOnDay(routine, d0, day)
    .filter((r) => !at || routineAroundSlot(r, at.schedule))
    .map((r) => ({
      code: `${routineSlug(r.label)}_${at?.slot ?? "morning"}`,
      label: { en: r.label, zh: r.label_zh ?? r.label },
    }));
  return [...fromRoutine, ...FIXED_REASONS];
}

/** Reason codes that do not count as an answer (the window logic may still settle them). */
export const NOT_AN_ANSWER = new Set(["undone"]);

// ---------------------------------------------------------------- C2: every slot of the day (accounts)

/**
 * What each slot's reminder hangs on in his routine, and the time used when his routine does not say (a blank account
 * that skipped the routine screen): breakfast 08:30, lunch 12:30, dinner 18:30, bed 22:00. A meal slot is asked after
 * the meal (meal + 15 min, like the morning dose); the night slot before bed (bed - 30 min). Then, as for the morning:
 * the second reminder 30 min after the first, and the window closes 30 min after that.
 */
export const SLOT_ANCHORS: Readonly<Record<DaySlot, { en: RegExp; zh: RegExp; fallback: string; offsetMin: number }>> = {
  morning: { en: /breakfast/i, zh: /早饭|早餐/, fallback: DEFAULT_BREAKFAST, offsetMin: AFTER_BREAKFAST_MIN },
  midday: { en: /lunch/i, zh: /午饭|午餐|中饭/, fallback: "12:30", offsetMin: 15 },
  evening: { en: /dinner|supper/i, zh: /晚饭|晚餐/, fallback: "18:30", offsetMin: 15 },
  night: { en: /\bbed|sleep/i, zh: /睡觉|睡前|上床/, fallback: "22:00", offsetMin: -30 },
};

/** The routine time a slot hangs on ("08:30"), and whether his routine said it (false: the fallback). */
export function slotAnchor(routine: RoutineEntry[], slot: DaySlot): { time: string; fromRoutine: boolean } {
  const a = SLOT_ANCHORS[slot];
  const r = routine.find((x) => x.days === "daily" && (a.en.test(x.label) || (!!x.label_zh && a.zh.test(x.label_zh))) && isClockTime(x.time));
  return r ? { time: r.time, fromRoutine: true } : { time: a.fallback, fromRoutine: false };
}

/**
 * One slot's reminder times on an account. `firstAt` is the first reminder he set himself for this slot (settings:
 * reminder_time for the morning, reminder_times[slot] for any slot), else the routine's anchor plus the slot's offset.
 */
export function slotSchedule(routine: RoutineEntry[], slot: DaySlot, firstAt?: string | null): ReminderSchedule {
  let first: number;
  if (firstAt && isClockTime(firstAt)) first = parseClockTime(firstAt);
  else first = parseClockTime(slotAnchor(routine, slot).time) + SLOT_ANCHORS[slot].offsetMin;
  const second = first + SECOND_REMINDER_MIN;
  return { first: hhmm(first), second: hhmm(second), closes: hhmm(second + WINDOW_AFTER_SECOND_MIN) };
}
