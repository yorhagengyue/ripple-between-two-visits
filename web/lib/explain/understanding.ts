/**
 * The understanding checklist (task M5 item 4): four fixed items (这个药是做什么的 / 没感觉要不要吃 / 什么时候吃 /
 * 漏了怎么办), each answered by him with 知道 / 不确定. Server-only.
 *
 *   不确定  adds exactly one question per medicine and item to his list (for the doctor, origin
 *          "understanding_check", in his own words, evidence understanding_check:<med>:<item>) and publishes
 *          question.created; answering 不确定 again finds that question and adds nothing.
 *   知道    is his answer; a question he already added stays his.
 * C2 (track F; real-app 12 「理解清单的『知道』刷新后忘了 → 存下来」): every answer, 知道 too, is kept
 * (store.setUnderstandingAnswer, one row per medicine and item), so the checklist shows it again after a reload.
 *
 * No model is called and nobody scores him: there is no right or wrong here, only what he says about himself.
 * The checklist exists only together with the explain card (from the day R3 was said).
 */
import { publish as busPublish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { medDisplayName } from "@/lib/meds/write";
import { StoreError, type QuestionRow, type Store } from "@/lib/store/types";
import { buildExplainCard } from "./card";
import { itemLabel, itemQuestion } from "./i18n";
import { UNDERSTANDING_ITEMS, understandingEvidence, type UnderstandingAnswer, type UnderstandingItem, type UnderstandingView } from "./types";

export type Publisher = (sessionId: string, type: "question.created", say: string, data: unknown) => void;

export class ExplainError extends Error {
  constructor(
    readonly code: "med_not_found" | "not_yet",
    message: string,
  ) {
    super(message);
    this.name = "ExplainError";
  }
}

export interface UnderstandingDeps {
  store: Store;
  publish?: Publisher;
}

function existingQuestion(questions: QuestionRow[], medId: string, item: UnderstandingItem): QuestionRow | null {
  const evidence = understandingEvidence(medId, item);
  return questions.find((q) => q.origin === "understanding_check" && q.evidence === evidence) ?? null;
}

/** Which items already put a question on his list (the checklist's state after a reload). */
export async function understandingView(store: Store, sessionId: string, medId: string): Promise<UnderstandingView> {
  const [questions, answers] = await Promise.all([store.listQuestions(sessionId), store.listUnderstandingAnswers(sessionId, { medication_id: medId })]);
  return {
    medId,
    items: UNDERSTANDING_ITEMS.map((id) => {
      const q = existingQuestion(questions, medId, id);
      const kept = answers.find((a) => a.item === id)?.answer ?? null;
      return { id, questionId: q?.id ?? null, questionStatus: q?.status ?? null, answer: kept ?? (q ? "unsure" : null) };
    }),
  };
}

export interface AnswerInput {
  sessionId: string;
  medId: string;
  item: UnderstandingItem;
  answer: UnderstandingAnswer;
  locale: Locale;
}

export interface AnswerResult {
  item: UnderstandingItem;
  answer: UnderstandingAnswer;
  /** the question this item has on his list (new, or the one 不确定 added before), null when there is none */
  question: QuestionRow | null;
  /** true only when this call added the question */
  created: boolean;
}

export async function answerUnderstanding(input: AnswerInput, deps: UnderstandingDeps): Promise<AnswerResult> {
  const { store } = deps;
  const pub: Publisher = deps.publish ?? ((sid, type, say, data) => void busPublish(sid, type, say, data));
  const session = await store.getSession(input.sessionId);
  if (!session) throw new StoreError("session_not_found", `No session ${input.sessionId}`);
  const med = await store.getMed(input.sessionId, input.medId);
  if (!med) throw new ExplainError("med_not_found", `no medicine ${input.medId}`);
  // the checklist belongs to the explain card: nothing to answer before the doctor said why (R3, D8)
  const card = await buildExplainCard(store, input.sessionId, med, { day: session.story_day, locale: input.locale });
  if (!card) throw new ExplainError("not_yet", "the explain card is not there yet on this story day");

  // his answer is kept, 知道 too (C2): the checklist shows it again after a reload
  await store.setUnderstandingAnswer(input.sessionId, { medication_id: med.id, item: input.item, answer: input.answer, day: session.story_day });
  const questions = await store.listQuestions(input.sessionId);
  const existing = existingQuestion(questions, med.id, input.item);
  if (input.answer === "know" || existing) {
    return { item: input.item, answer: input.answer, question: existing, created: false };
  }
  const name = medDisplayName(med, input.locale);
  const question = await store.addQuestion(input.sessionId, {
    for: "doctor",
    origin: "understanding_check",
    text: itemQuestion(input.locale, input.item, name),
    lang: input.locale,
    status: "open",
    created_day: session.story_day,
    evidence: understandingEvidence(med.id, input.item),
  });
  pub(
    input.sessionId,
    "question.created",
    `Understanding check, ${medDisplayName(med, "en")}: not sure about "${itemLabel("en", input.item)}", added to his questions for the doctor`,
    { question, understanding: { med_id: med.id, item: input.item, label: itemLabel("en", input.item), label_zh: itemLabel("zh-Hans", input.item), answer: "unsure" } },
  );
  return { item: input.item, answer: input.answer, question, created: true };
}
