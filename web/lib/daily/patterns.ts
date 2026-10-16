/**
 * Patterns in his own log (task M4 item 2): missed doses that keep falling on the same weekly routine (tai chi on
 * Tue and Thu). When the overlap reaches 3, the question list gets exactly one question about it, and its words
 * only describe the pattern: how many mornings, which routine, which days. No proposal of another time or any
 * change (never 换, 改到, 建议, move, switch, should, try): what to do is for the doctor.
 *
 * The seed's q-tai-chi (origin pattern) is the same question in the story's end state, so it is reused (its text
 * becomes the pattern wording, its created_day the day the pattern appeared when that is earlier), never
 * duplicated; an answered pattern question is left alone. syncPatternQuestions is idempotent and runs when the
 * daily screens are read and after a missed dose is logged.
 */
import { publish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { isAccount } from "@/lib/store/scope";
import type { DoseLogRow, MedicationRow, QuestionRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { countedDoseRows } from "./cells";
import { d0Of, routineOf } from "./doses";
import { dt, shortDay, weekdayList } from "./i18n";
import { routineSlug, type RoutineEntry } from "./schedule";

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const PATTERN_MIN_OVERLAP = 3;

export interface RoutinePattern {
  slug: string;
  routine: RoutineEntry;
  /** the routine's weekdays ("Tue", "Thu") */
  weekdays: string[];
  /** every missed morning so far (any prescription medicine) */
  missedDays: number[];
  /** the missed mornings that fall on the routine */
  onRoutine: number[];
  /** the day the overlap reached PATTERN_MIN_OVERLAP */
  firstDay: number;
}

export interface PatternInput {
  doses: DoseLogRow[];
  meds: MedicationRow[];
  routine: RoutineEntry[];
  d0: string;
  /** story day: nothing after it counts */
  day: number;
  minOverlap?: number;
}

export function routinePatterns(input: PatternInput): RoutinePattern[] {
  const min = input.minOverlap ?? PATTERN_MIN_OVERLAP;
  const rx = new Set(input.meds.filter((m) => m.origin === "prescription").map((m) => m.id));
  const missedDays = [
    ...new Set(input.doses.filter((d) => rx.has(d.medication_id) && d.state === "missed" && d.slot === "morning" && d.day <= input.day).map((d) => d.day)),
  ].sort((a, b) => a - b);
  const out: RoutinePattern[] = [];
  for (const r of input.routine) {
    if (!Array.isArray(r.days)) continue;
    const days = r.days;
    const onRoutine = missedDays.filter((day) => days.includes(WEEKDAY_EN[weekdayIndex(input.d0, day)]));
    if (onRoutine.length < min) continue;
    out.push({ slug: routineSlug(r.label), routine: r, weekdays: days, missedDays, onRoutine, firstDay: onRoutine[min - 1] });
  }
  return out;
}

function patternVars(p: RoutinePattern, d0: string, locale: Locale) {
  return {
    n: p.onRoutine.length,
    total: p.missedDays.length,
    routine: locale === "zh-Hans" ? (p.routine.label_zh ?? p.routine.label) : p.routine.label.toLowerCase(),
    weekdays: weekdayList(locale, p.weekdays),
    dates: p.onRoutine.map((day) => shortDay(locale, storyDate(d0, day))).join(locale === "zh-Hans" ? "、" : ", "),
  };
}

/** The question's words: the pattern only, in his language (or the UI language when shown). */
export function patternText(p: RoutinePattern, d0: string, locale: Locale): string {
  return dt(locale, p.onRoutine.length === p.missedDays.length ? "pattern.all" : "pattern.some", patternVars(p, d0, locale));
}

/**
 * The question's evidence: "pattern:<slug>; " (patternSlugOf reads it back), then the facts. The demo keeps its story
 * days ("Day 15, 17, 24"); an account names the real dates, in the question's language (C2: 「…：9月8日、9月10日…」),
 * never a day number.
 */
export function patternEvidence(p: RoutinePattern, account?: { d0: string; locale?: Locale }): string {
  if (account) return `pattern:${p.slug}; ${dt(account.locale ?? "zh-Hans", "pattern.evidence", patternVars(p, account.d0, account.locale ?? "zh-Hans"))}`;
  return `pattern:${p.slug}; missed mornings on ${p.weekdays.join("/")}: Day ${p.onRoutine.join(", ")} (${p.onRoutine.length} of ${p.missedDays.length} missed)`;
}

/** Slug of the routine a pattern question is about ("pattern:tai_chi" in evidence, else the routine's words). */
export function patternSlugOf(q: Pick<QuestionRow, "origin" | "text" | "evidence">, routine: RoutineEntry[]): string | null {
  if (q.origin !== "pattern") return null;
  const tagged = /pattern:([a-z0-9_]+)/.exec(q.evidence ?? "");
  if (tagged) return tagged[1];
  const hay = `${q.text} ${q.evidence ?? ""}`.toLowerCase();
  for (const r of routine) {
    if (!Array.isArray(r.days)) continue;
    const words = [r.label.toLowerCase(), r.label.toLowerCase().replace(/\s+/g, ""), r.label_zh ?? ""].filter(Boolean);
    if (words.some((w) => hay.includes(w))) return routineSlug(r.label);
  }
  return null;
}

export interface PatternSync {
  question: QuestionRow;
  change: "created" | "updated" | "unchanged";
}

/** Make the question list hold exactly one question per routine pattern on this story day. */
export async function syncPatternQuestions(store: Store, session: SessionRow): Promise<PatternSync[]> {
  const day = session.story_day;
  const d0 = d0Of(session);
  const routine = routineOf(session);
  const [doseRows, meds, questions] = await Promise.all([store.listDoses(session.id, { toDay: day }), store.listMeds(session.id), store.listQuestions(session.id)]);
  // real-app 4.4: the pattern question never counts an untracked cell (an account's answer on a window that closed
  // before he started); a demo scope's rows all stay
  const doses = countedDoseRows(session, meds, doseRows);
  const out: PatternSync[] = [];
  for (const p of routinePatterns({ doses, meds, routine, d0, day })) {
    const text = patternText(p, d0, "zh-Hans");
    const evidence = patternEvidence(p, isAccount(session) ? { d0 } : undefined);
    const existing = questions.find((q) => patternSlugOf(q, routine) === p.slug) ?? null;
    if (existing) {
      if (existing.status !== "open") {
        out.push({ question: existing, change: "unchanged" });
        continue;
      }
      const patch: Partial<QuestionRow> = {};
      if (existing.text !== text) Object.assign(patch, { text, lang: "zh-Hans" });
      if (existing.evidence !== evidence) patch.evidence = evidence;
      if (existing.created_day === null || existing.created_day > day) patch.created_day = p.firstDay;
      if (Object.keys(patch).length === 0) {
        out.push({ question: existing, change: "unchanged" });
        continue;
      }
      const row = await store.updateQuestion(session.id, existing.id, patch);
      publish(session.id, "question.updated", `Pattern in his log, ${p.routine.label}: ${p.onRoutine.length} missed mornings on ${p.weekdays.join("/")}`, { question: row, pattern: p.slug });
      out.push({ question: row, change: "updated" });
      continue;
    }
    const row = await store.addQuestion(session.id, {
      id: `q-pattern-${p.slug}`,
      for: "doctor",
      origin: "pattern",
      text,
      lang: "zh-Hans",
      created_day: p.firstDay,
      evidence,
    });
    publish(session.id, "question.created", `Pattern in his log, ${p.routine.label}: ${p.onRoutine.length} missed mornings on ${p.weekdays.join("/")}`, { question: row, pattern: p.slug });
    out.push({ question: row, change: "created" });
  }
  return out;
}
