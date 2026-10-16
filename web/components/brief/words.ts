/**
 * The brief's sentences built from counts (shared by the demo's BriefSheet and an account's brief, C2 track B).
 * Client-safe. Words: lib/summary/i18n.ts; nothing judges his adherence: the missed mornings are only described against
 * his own weekly routine.
 */
import { shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { DoseSummary } from "@/lib/summary/doses";
import { bt, weekdayName, weekdaysPlural } from "@/lib/summary/i18n";

/**
 * A sentence of the dictionary that ends in a list (「没吃的 4 次都在周二、周四（打太极的早上）：9月8日、9月10日」,
 * "Medicine: Amlodipine 5 mg") as the two halves the timeline draft sets on two lines of a list row: `head` keeps the
 * colon, so `head + tail` is the sentence as it was, letter for letter; `lead` is the head without it. The split is at
 * the last 「：」, or the last ": " (a clock time's own colon has no space after it). Null when the sentence has none.
 */
export function splitAtColon(sentence: string): { head: string; lead: string; tail: string } | null {
  const wide = sentence.lastIndexOf("：");
  const narrow = sentence.lastIndexOf(": ");
  const cut = wide >= 0 ? wide + 1 : narrow >= 0 ? narrow + 2 : -1;
  if (cut < 0 || cut >= sentence.length) return null;
  const head = sentence.slice(0, cut);
  return { head, lead: head.replace(/[:：]\s*$/, ""), tail: sentence.slice(cut) };
}

export function dateList(locale: Locale, dates: string[]): string {
  return dates.map((d) => shortDay(locale, d)).join(locale === "zh-Hans" ? "、" : ", ");
}

export function missedText(locale: Locale, doses: DoseSummary): string | null {
  if (doses.missed === 0) return null;
  const missedDates = doses.days.filter((d) => d.missed > 0);
  const r = doses.routine;
  if (r) {
    const routine = locale === "zh-Hans" ? (r.labelZh ?? r.label) : r.label.toLowerCase();
    const onDates = missedDates.filter((d) => r.onRoutine.includes(d.day)).map((d) => d.date);
    if (r.all && missedDates.length === 1) {
      return bt(locale, "brief.doses.missedOne", { weekday: weekdayName(locale, missedDates[0].weekday), routine, dates: dateList(locale, onDates) });
    }
    if (r.all) return bt(locale, "brief.doses.missedAll", { n: missedDates.length, weekdays: weekdaysPlural(locale, r.weekdays), routine, dates: dateList(locale, onDates) });
    return bt(locale, "brief.doses.missedSome", { k: r.onRoutine.length, n: missedDates.length, weekdays: weekdaysPlural(locale, r.weekdays), routine, dates: dateList(locale, onDates) });
  }
  const list = missedDates.map((d) => `${shortDay(locale, d.date)}${locale === "zh-Hans" ? `（${weekdayName(locale, d.weekday)}）` : ` (${d.weekday})`}`);
  return bt(locale, "brief.doses.missedDays", { dates: list.join(locale === "zh-Hans" ? "、" : ", ") });
}

