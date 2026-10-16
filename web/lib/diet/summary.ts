/**
 * The brief's weekly diet line (journey 13 → journey 14; M16 「记下来，每周汇总进给医生的简报」). Server-only. Track K
 * provides it, track B's brief (lib/summary/account-brief.ts) calls it:
 *
 *   const diet = await weeklyDietLine(store, scope, locale);                       // the last 7 days, today included
 *   const diet = await weeklyDietLine(store, scope, locale, { fromDay, toDay });  // or the brief's own window
 *   diet === null  -> nothing to show: he answered no diet check in the window (also when the doctor never gave a diet
 *                     instruction at a visit that happened). A line that only says "answered on 0 days" is noise for the
 *                     doctor, so there is none (integrator, 10-10).
 *   diet.text      -> the line as the brief prints it, in `locale`: counts only, never a judging word
 *
 * What it counts: his answers to the daily diet check (lib/diet/check.ts, diet_check rows) for the question the
 * doctor's newest diet line asks, on the days of the window on or after that visit. Days he did not answer are just
 * not counted (answered N of M days, N at least 1). The doctor's own words ride along word for word (doctor), for a brief that wants
 * to quote them; the line itself only names their date.
 */
import type { Locale } from "@/lib/i18n";
import type { SessionRow, Store } from "@/lib/store/types";
import { scopeD0 } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { checkElementById, checkElementFor, isDietAnswer, type CheckElementId } from "./check";
import { doctorDietLines } from "./doctor";

export interface DietBriefLine {
  /** the doctor's diet line the question comes from, word for word; null when only past answers are left */
  doctor: { text: string; lang: "en" | "zh-Hans"; date: string; visitId: string; utteranceId: string; tStartMs: number } | null;
  /** what the question is about ("soup", "gravy", "sweet_drinks", "fried", "general") */
  item: CheckElementId;
  /** the fixed question in `locale` */
  question: string;
  /** the window counted (YYYY-MM-DD, inclusive) */
  fromDate: string;
  toDate: string;
  /** days of the window the question existed on */
  days: number;
  /** days he answered, and how */
  answered: number;
  yes: number;
  no: number;
  unsure: number;
  /** the line as the brief prints it, in `locale` */
  text: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayWords(locale: Locale, iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return locale === "zh-Hans" ? `${m}月${d}日` : `${d} ${MONTHS[m - 1]}`;
}

/** The brief's diet line for the window (default: the last 7 days, today included), or null when he answered nothing in it. */
export async function weeklyDietLine(store: Store, scope: SessionRow, locale: Locale, opts: { fromDay?: number; toDay?: number } = {}): Promise<DietBriefLine | null> {
  const today = scope.story_day;
  const toDay = Math.min(opts.toDay ?? today, today);
  const fromDay = Math.max(0, opts.fromDay ?? toDay - 6);
  if (fromDay > toDay) return null;
  const d0 = scopeD0(scope);
  const [lines, rows] = await Promise.all([doctorDietLines(store, scope), store.listDietChecks(scope.id, { fromDay, toDay })]);
  const line = lines[0] ?? null;
  const answers = rows.filter((r) => isDietAnswer(r.answer));
  // the element asked: the newest doctor line's; without one, the element of his latest answer in the window
  const element = line ? checkElementFor(line.text) : answers.length ? checkElementById(answers[answers.length - 1].item) : null;
  if (!element) return null;
  const mine = answers.filter((r) => r.item === element.id);
  if (!line && !mine.length) return null;
  const startDay = line ? Math.max(fromDay, line.visitDay) : fromDay;
  const days = Math.max(0, toDay - startDay + 1);
  const counted = mine.filter((r) => r.day >= startDay);
  const n = {
    yes: counted.filter((r) => r.answer === "yes").length,
    no: counted.filter((r) => r.answer === "no").length,
    unsure: counted.filter((r) => r.answer === "unsure").length,
  };
  const answered = n.yes + n.no + n.unsure;
  if (answered === 0) return null;
  const fromDate = storyDate(d0, startDay);
  const toDate = storyDate(d0, toDay);
  const span = fromDate === toDate ? dayWords(locale, fromDate) : `${dayWords(locale, fromDate)}–${dayWords(locale, toDate)}`;
  const when = line ? dayWords(locale, line.visitDate) : null;
  const text =
    locale === "zh-Hans"
      ? `饮食核对${when ? `（问的是医生 ${when} 说的话）` : ""}，${span}：${days} 天里答了 ${answered} 天；${element.counts["zh-Hans"](n)}。`
      : `Diet check${when ? ` (on the doctor's words of ${when})` : ""}, ${span}: answered on ${answered} of ${days} day${days === 1 ? "" : "s"}; ${element.counts.en(n)}.`;
  return {
    doctor: line ? { text: line.text, lang: line.lang, date: line.visitDate, visitId: line.visitId, utteranceId: line.utteranceId, tStartMs: line.tStartMs } : null,
    item: element.id,
    question: element.question[locale],
    fromDate,
    toDate,
    days,
    answered,
    ...n,
    text,
  };
}
