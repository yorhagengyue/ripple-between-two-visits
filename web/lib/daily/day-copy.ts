/**
 * The words of his day sheet (owner 10-15: every day of his month on Today opens as a sheet from the bottom: that day's
 * medicine, readings, notes and visit) and of the mark for a reading outside his doctor's target. The words his month
 * had before stay where they were (lib/daily/i18n.ts today.month.*); a visit's kind is lib/care/visit-words.ts's, the
 * origin of a question components/ui/QuestionRow.tsx's. Client-safe, pure.
 *
 * Nothing here judges a reading: a reading is said to be outside the target his doctor set, with the doctor's own numbers
 * and the date he gave them (lib/safety/threshold.ts rule B: the target he confirmed is the one number a reading is
 * compared with), never high, low, normal, good or dangerous, and with none of the safety vocabulary's words
 * (tests/unit/daily/day-sheet.test.ts scans both languages with judgementHits).
 */
import type { Locale } from "@/lib/i18n";

const zh = {
  /** the legend's words for the mark, and a day's words for a screen reader */
  legendOutside: "读数超出医生定的目标",
  cellOutside: "有读数超出医生定的目标",
  /** the sheet */
  close: "关闭",
  bpHead: "血压",
  doseHead: "用药",
  visitHead: "就诊",
  notesHead: "你记的话",
  questionsHead: "加到问题单的",
  /** under a reading outside the target: 「超出了林医生定的目标：135/85（9月3日）」 */
  outsideLine: "超出了{doctor}定的目标：{target}（{date}）",
  yourDoctor: "医生",
  /** what he said about a reading, in his words */
  noted: "记下了：「{words}」",
  pulse: "脉搏 {n}",
  forDoctor: "问医生",
  forPharmacist: "问药剂师",
};

export type DayKey = keyof typeof zh;

const en: Record<DayKey, string> = {
  legendOutside: "Reading outside your doctor's target",
  cellOutside: "a reading outside the doctor's target",
  close: "Close",
  bpHead: "Blood pressure",
  doseHead: "Medicine",
  visitHead: "Visit",
  notesHead: "Your notes",
  questionsHead: "Added to your questions",
  outsideLine: "Outside the target {doctor} set: {target} ({date})",
  yourDoctor: "your doctor",
  noted: "Noted: “{words}”",
  pulse: "Pulse {n}",
  forDoctor: "For the doctor",
  forPharmacist: "For the pharmacist",
};

const messages: Record<Locale, Record<DayKey, string>> = { "zh-Hans": zh, en };

/** One phrase, its {names} filled in. */
export function dc(locale: Locale, key: DayKey, vars: Record<string, string | number> = {}): string {
  const s = messages[locale]?.[key] ?? zh[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Every phrase of one language (for the word scans in the tests). */
export function allDayStrings(locale: Locale): [DayKey, string][] {
  return (Object.keys(zh) as DayKey[]).map((k) => [k, messages[locale][k]]);
}
