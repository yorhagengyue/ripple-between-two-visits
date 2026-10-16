/**
 * The question list as of the story day (task M4, /p/questions). Server-only.
 *
 * Story-day gating: the timeline seed is the story's end state, so a question created after session.story_day is
 * not shown yet, and an answer is shown only once it has been said by the story moment (10-10, lib/safety/line-state.ts
 * answerSaid, the rule the sources follow): its visit has happened (visitHappened: an earlier day; on the visit's own
 * day once this session holds its record, or when the clock has no time of day), and a seeded answer for a visit this
 * session replayed or is recording only once its line is in that record. Until then the question reads as still open
 * (等下次看诊问): at D42 08:45 q-extra-tablet waits for the visit, on Today's count and in the brief too. An answer is
 * quoted word for word with its source chip from lib/safety's candidates, so who said it follows this session's
 * transcript (推断：医生 until he confirms, as on the visit screen).
 */
import type { Locale } from "@/lib/i18n";
import { buildCandidates, type Candidate } from "@/lib/safety";
import { answerSaid, liveTranscript, type StoryMoment } from "@/lib/safety/line-state";
import type { QuestionRow, SafetyEventRow, SessionRow, Store, UtteranceRow, VisitRow } from "@/lib/store/types";
import { countedDoseRows } from "./cells";
import { d0Of, routineOf } from "./doses";
import { chipFromCandidate } from "./lines";
import { patternSlugOf, patternText, routinePatterns } from "./patterns";
import type { QuestionItemView, QuestionsView, QuestionWording, QuotedLine } from "./types";

// ---------------------------------------------------------------- his own words (wave B)

/** The asks that put a question on his list (from safety_event: what he typed and what happened to the question). */
export interface AskedFor {
  /** an ask created this question from what was typed (its text is those words) */
  created: boolean;
  /** what he himself typed when an ask reused this question, oldest first */
  reusedBy: { text: string; lang: string | null }[];
}

/**
 * Who asked what, per question id, from the session's safety events (`input`, `output.addedQuestionId`,
 * `output.questionReused`, `output.askedBy`). Only asks by the patient count as his words, for a question an ask
 * created as for one it reused (fix round 2: a refused question created by a judge, backstage or director ask was shown
 * as his words with data-verbatim="question"); an event from before askedBy was recorded is not counted (it is not
 * known who typed it).
 */
export function askedWordsFrom(events: Pick<SafetyEventRow, "input" | "lang" | "output">[]): Map<string, AskedFor> {
  const out = new Map<string, AskedFor>();
  for (const e of events) {
    const o = (e.output ?? {}) as { addedQuestionId?: unknown; questionReused?: unknown; askedBy?: unknown };
    if (typeof o.addedQuestionId !== "string" || !o.addedQuestionId) continue;
    const entry = out.get(o.addedQuestionId) ?? { created: false, reusedBy: [] };
    if (o.questionReused === true) {
      if (o.askedBy === "patient" && e.input.trim()) entry.reusedBy.push({ text: e.input.trim(), lang: e.lang ?? null });
    } else if (o.askedBy === "patient") {
      entry.created = true;
    }
    out.set(o.addedQuestionId, entry);
  }
  return out;
}

/** Questions Ripple words from a pattern in his log (never his verbatim words). */
export const isPatternOrigin = (origin: string): boolean => origin === "pattern" || origin === "watch_pattern";

/** askedWordsFrom over the session's recorded asks (empty when the store has none). */
export async function askedWordsByQuestion(store: Store, sessionId: string): Promise<Map<string, AskedFor>> {
  return askedWordsFrom(await store.listSafetyEvents(sessionId));
}

export interface QuestionWords {
  text: string;
  lang: string | null;
  wording: QuestionWording;
  summary: { text: string; lang: string | null } | null;
}

/**
 * The words a question is shown with. A question Ripple refused that no ask of his created (the seeded q-extra-tablet:
 * 「读数高的时候（例如 150/95）可以多吃一粒吗？」 is the story's summary, not what he typed) is a recorded summary, never shown as
 * his verbatim words; once he asks it himself and the ask reuses it, his latest words are the question and the
 * summary is shown beside them as such. A question whose words he changed himself (edited_at, track C's list) is his
 * own words, whatever it was before. Every other question keeps its text as his own words, as before. Pattern
 * questions are worded by the caller (patternText).
 */
export function questionWords(q: Pick<QuestionRow, "origin" | "text" | "lang"> & Partial<Pick<QuestionRow, "edited_at">>, asked: AskedFor | undefined): QuestionWords {
  if (q.origin !== "refused_question" || asked?.created || q.edited_at) return { text: q.text, lang: q.lang, wording: "own_words", summary: null };
  const last = asked?.reusedBy.at(-1);
  if (last) return { text: last.text, lang: last.lang, wording: "own_words", summary: { text: q.text, lang: q.lang } };
  return { text: q.text, lang: q.lang, wording: "recorded_summary", summary: null };
}

type DayFields = Pick<QuestionRow, "created_day" | "asked_at_visit_id"> & Partial<Pick<QuestionRow, "answer_visit_id">>;

/**
 * The day a question appears on the list: its created_day, else the day of the visit where it was asked. A seeded
 * question with neither but with a recorded answer (q-relative-box: answered at the D12 pharmacy) was raised before
 * the visit that answered it, so it appears at the last visit before that one (the relative's box comes up at the
 * D8 counter), or on the answering visit's own day when no visit came before it. Not on the list before then.
 */
export function questionDay(q: DayFields, visits: Pick<VisitRow, "id" | "day">[]): number | null {
  if (q.created_day !== null) return q.created_day;
  if (q.asked_at_visit_id) return visits.find((v) => v.id === q.asked_at_visit_id)?.day ?? null;
  if (q.answer_visit_id) {
    const answeredAt = visits.find((v) => v.id === q.answer_visit_id);
    if (answeredAt) {
      const earlier = visits.filter((v) => v.day < answeredAt.day).map((v) => v.day);
      return earlier.length ? Math.max(...earlier) : answeredAt.day;
    }
  }
  return null;
}

/** Is the question on the list on this story day? (no day known at all = part of the list from the start) */
export function questionVisible(q: DayFields, visits: Pick<VisitRow, "id" | "day">[], day: number): boolean {
  const d = questionDay(q, visits);
  return d === null || d <= day;
}

/**
 * The story moment as the question list sees it: the story day, the clock's time of day, and this session's live
 * transcript of each visit up to the story day (a visit with none was never replayed or recorded here).
 */
export interface AnswerMoment extends StoryMoment {
  records: ReadonlyMap<string, UtteranceRow[]>;
}

/** Reads the moment once per page or route: one transcript read per answering visit up to the story day, side by side. */
export async function answerMoment(
  store: Store,
  session: Pick<SessionRow, "id" | "story_day" | "story_time">,
  visits: Pick<VisitRow, "id" | "day">[],
  questions: Pick<QuestionRow, "answer_visit_id">[],
): Promise<AnswerMoment> {
  const answering = new Set(questions.map((q) => q.answer_visit_id).filter((id): id is string => !!id));
  const read = visits.filter((v) => v.day <= session.story_day && answering.has(v.id));
  const rows = await Promise.all(read.map((v) => store.listUtterances(session.id, v.id)));
  return { day: session.story_day, time: session.story_time ?? null, records: new Map(read.map((v, i) => [v.id, liveTranscript(rows[i])])) };
}

/** Has its recorded answer been said by the story moment? (line-state.ts answerSaid, the same rule as the sources) */
export function answerVisible(
  q: Pick<QuestionRow, "answer_text" | "answer_visit_id" | "answer_utterance_id">,
  visits: Pick<VisitRow, "id" | "day" | "status">[],
  moment: AnswerMoment,
): boolean {
  if (!q.answer_text || !q.answer_visit_id) return false;
  const v = visits.find((x) => x.id === q.answer_visit_id);
  return !!v && answerSaid(q, v, moment, moment.records.get(v.id) ?? []);
}

/** Still waiting for a visit at the story moment: open, or answered at a visit whose answer has not been said yet. */
export function questionWaiting(
  q: Pick<QuestionRow, "status" | "answer_text" | "answer_visit_id" | "answer_utterance_id">,
  visits: Pick<VisitRow, "id" | "day" | "status">[],
  moment: AnswerMoment,
): boolean {
  return q.status === "open" || (q.status === "answered" && !answerVisible(q, visits, moment));
}

function answerLine(q: QuestionRow, cands: Candidate[]): QuotedLine | null {
  const text = q.answer_text!.trim();
  const c =
    cands.find((x) => x.kind === "visit" && x.cite?.visitId === q.answer_visit_id && x.span.trim() === text) ??
    cands.find((x) => x.kind === "visit" && x.span.trim() === text) ??
    null;
  if (!c) return null;
  return {
    sourceId: c.sourceId,
    text: q.answer_text!,
    chip: chipFromCandidate(c),
    visitId: c.cite?.visitId ?? q.answer_visit_id!,
    date: c.cite?.date ?? "",
    tStartMs: c.cite?.tStartMs ?? null,
    clipUrl: c.cite?.clipUrl ?? null,
  };
}

export async function questionsView(store: Store, session: SessionRow, locale: Locale): Promise<QuestionsView> {
  const day = session.story_day;
  const [questions, visits, doses, meds] = await Promise.all([
    store.listQuestions(session.id),
    store.listVisits(session.id),
    store.listDoses(session.id, { toDay: day }),
    store.listMeds(session.id),
  ]);
  const [cands, asked, moment] = await Promise.all([
    buildCandidates(store, session.id, { day, route: "explain", topics: [], scope: session }).then((set) => set.list),
    askedWordsByQuestion(store, session.id),
    answerMoment(store, session, visits, questions),
  ]);
  const d0 = d0Of(session);
  const routine = routineOf(session);
  // real-app 4.4: an untracked cell is never counted (lib/daily/cells.ts countedDoseRows; a demo scope's rows all stay)
  const patterns = routinePatterns({ doses: countedDoseRows(session, meds, doses), meds, routine, d0, day });

  const items: QuestionItemView[] = [];
  for (const q of questions) {
    if (!questionVisible(q, visits, day)) continue;
    const answered = answerVisible(q, visits, moment);
    const slug = patternSlugOf(q, routine);
    const pattern = slug ? patterns.find((p) => p.slug === slug) : undefined;
    const live = pattern && q.status === "open";
    const words = live ? null : questionWords(q, asked.get(q.id));
    items.push({
      id: q.id,
      for: q.for,
      origin: q.origin,
      text: words ? words.text : patternText(pattern!, d0, locale),
      lang: words ? words.lang : locale,
      wording: isPatternOrigin(q.origin) ? "pattern" : (words?.wording ?? "pattern"),
      summary: words?.summary ?? null,
      status: q.status === "answered" && !answered ? "open" : q.status,
      createdDay: questionDay(q, visits),
      answer: answered ? answerLine(q, cands) : null,
    });
  }
  // what is still to ask comes first; otherwise the list keeps its order (seed first, then as added)
  const rank = (q: QuestionItemView) => (q.status === "open" ? 0 : 1);
  const sorted = items.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q);
  return { day, doctor: sorted.filter((q) => q.for === "doctor"), pharmacist: sorted.filter((q) => q.for === "pharmacist") };
}

/** Questions on the list still waiting for a visit at the story moment (the Today card's count). */
export async function openQuestionCount(store: Store, session: SessionRow): Promise<number> {
  const [questions, visits] = await Promise.all([store.listQuestions(session.id), store.listVisits(session.id)]);
  const moment = await answerMoment(store, session, visits, questions);
  return questions.filter((q) => questionVisible(q, visits, session.story_day) && questionWaiting(q, visits, moment)).length;
}
