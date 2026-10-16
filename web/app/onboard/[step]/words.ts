/**
 * Small pure helpers of the setting-up screens, shared by the server page and its client controls (and by
 * 「我 › 我的档案」, which lists the same routine). No React, no store: safe on both sides.
 */
import { weekdaysWords, type DateLocale } from "@/lib/profile/dates";
import type { OnboardStep } from "@/lib/profile/onboarding";

/**
 * Which of the six items a screen belongs to (real-app 2.5 and the draft's 01-5a to 01-5f): the clinic, the routine
 * (breakfast, then the list), the medicines, about him (age, conditions, allergies), family, the reminders. 「谁在填」
 * comes before the six and 「建好了」 after them: neither has a number.
 */
export const SETUP_ITEM_OF: Partial<Record<OnboardStep, number>> = {
  clinic: 1,
  breakfast: 2,
  habits: 2,
  meds: 3,
  age: 4,
  conditions: 4,
  allergies: 4,
  family: 5,
  reminders: 6,
};

/** 「每天」 for a daily entry and for one whose seven weekdays were picked one by one; else the weekdays. */
export function daysWords(days: "daily" | string[], locale: DateLocale): string {
  return days === "daily" || new Set(days).size >= 7 ? weekdaysWords("daily", locale) : weekdaysWords(days, locale);
}

/** "08:30" + 15 -> "08:45" (never past 23:59) */
export function addMinutes(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + min);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * A fixed sentence as a box's bold line and the rest under it: cut after its first full stop, nothing dropped (the two
 * parts read on as the same words).
 */
export function firstSentence(text: string): { title: string; rest: string | null } {
  const m = /^(.+?[。.])(\s*\S[\s\S]*)$/.exec(text);
  return m ? { title: m[1], rest: m[2] } : { title: text, rest: null };
}
