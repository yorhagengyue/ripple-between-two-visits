/**
 * Questions still waiting for a visit on the story day (M6 "how many questions wait for the next visit", M7 "at most
 * three questions"). Server-only (lib/daily/questions pulls lib/safety in).
 *
 * The gating is M4's (lib/daily/questions.ts): a question shows from its created day (or the visit it was asked at);
 * an answer counts only once it has been said by the story moment (10-10: its visit has happened by the story day and
 * time, lib/safety/line-state.ts answerSaid), so before then the question still waits: the D42 morning brief lists
 * q-extra-tablet until the v3 visit answers it. A routine-pattern question is worded from his log in the UI language
 * (lib/daily/patterns.ts), never as advice.
 *
 * The brief keeps at most three questions for the doctor, ordered by where they came from: a question Ripple refused
 * to answer first, then a pattern in his log, then his own; anything else after those.
 */
import type { Locale } from "@/lib/i18n";
import { patternSlugOf, patternText, routinePatterns } from "@/lib/daily/patterns";
import { isPatternOrigin, questionDay, questionVisible, questionWaiting, questionWords, type AnswerMoment, type AskedFor } from "@/lib/daily/questions";
import type { QuestionWording } from "@/lib/daily/types";
import type { RoutineEntry } from "@/lib/daily/schedule";
import type { DoseLogRow, MedicationRow, QuestionFor, QuestionOrigin, QuestionRow, VisitRow } from "@/lib/store/types";

export interface WaitingQuestion {
  id: string;
  for: QuestionFor;
  origin: QuestionOrigin | (string & {});
  /** his words, or the pattern wording in the UI language */
  text: string;
  lang: string | null;
  createdDay: number | null;
  /** what `text` is: his own words (verbatim), a recorded summary (not his words) or Ripple's pattern wording */
  wording: QuestionWording;
  /** the recorded summary shown beside his own words, or null */
  summary: { text: string; lang: string | null } | null;
}

export interface WaitingInput {
  questions: QuestionRow[];
  visits: Pick<VisitRow, "id" | "day" | "status">[];
  doses: DoseLogRow[];
  meds: MedicationRow[];
  routine: RoutineEntry[];
  d0: string;
  day: number;
  /** the story moment of `day` (lib/daily/questions.ts answerMoment): whether an answer has been said yet */
  moment: AnswerMoment;
  locale: Locale;
  /** his asks per question (lib/daily/questions.ts askedWordsByQuestion); without it every refused question is a summary unless an ask created it */
  asked?: Map<string, AskedFor>;
}

/** Open at the story moment (not answered yet, or answered at a visit whose answer has not been said by then). */
export function waitingQuestions(input: WaitingInput): WaitingQuestion[] {
  const routine = input.routine;
  const patterns = routinePatterns({ doses: input.doses, meds: input.meds, routine, d0: input.d0, day: input.day });
  const out: WaitingQuestion[] = [];
  for (const q of input.questions) {
    if (!questionVisible(q, input.visits, input.day)) continue;
    if (!questionWaiting(q, input.visits, input.moment)) continue;
    const slug = patternSlugOf(q, routine);
    const pattern = slug ? patterns.find((p) => p.slug === slug) : undefined;
    const words = pattern ? null : questionWords(q, input.asked?.get(q.id));
    out.push({
      id: q.id,
      for: q.for,
      origin: q.origin,
      text: words ? words.text : patternText(pattern!, input.d0, input.locale),
      lang: words ? words.lang : input.locale,
      createdDay: questionDay(q, input.visits),
      wording: isPatternOrigin(q.origin) ? "pattern" : (words?.wording ?? "pattern"),
      summary: words?.summary ?? null,
    });
  }
  return out;
}

/**
 * refused question > pattern in his log > his own > the rest (list order inside each). A "not sure" from his
 * understanding checklist (M5) is his own question too: same label (lib/daily/i18n q.origin.*), same rank.
 */
export const BRIEF_ORIGIN_RANK: Record<string, number> = {
  refused_question: 0,
  pattern: 1,
  watch_pattern: 1,
  own: 2,
  understanding_check: 2,
};

export const BRIEF_MAX_QUESTIONS = 3;

/** The doctor's questions for the brief: at most three, by origin rank; `more` counts the rest. */
export function briefQuestions(waiting: WaitingQuestion[], max = BRIEF_MAX_QUESTIONS): { shown: WaitingQuestion[]; more: number } {
  const forDoctor = waiting.filter((q) => q.for === "doctor");
  const rank = (q: WaitingQuestion) => BRIEF_ORIGIN_RANK[q.origin] ?? 3;
  const sorted = forDoctor
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i)
    .map((x) => x.q);
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}
