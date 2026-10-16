/**
 * The JSON messages lib/safety sends to a model (as the `user` string) and expects back. One shape for every
 * provider, so the mock, a replayed cassette and a live model all answer the same task.
 *
 *   compose  -> { "sentences": ComposedSentence[] }   (spec section 5 step 3: Sentence[] only, sourceId from candidates)
 *   classify -> { "route": Route, "topic": ClassifyTopic, "reason": string }
 *   crisis   -> { "crisis": "emergency" | "self_harm" | "none", "reason": string }  (a statement the rules logged only)
 *   support  -> { "supported": boolean, "reason": string }  (layer 3, sent to the checker)
 *   explain  -> { "verdict": string, "abstain": boolean }   (a long press on one of his records: lib/explain/verdict.ts)
 *   gloss    -> { "sentences": { "text": string, "sourceIds": string[] }[] }   (Ripple's words under an answer's quotes:
 *               lib/safety/gloss.ts)
 *   summary  -> { "points": { "text": string, "lines": string[] }[] }   (Ripple's notes of what was said at a visit, live
 *               while it is recorded and once at its end: lib/visit/ripple-summary.ts)
 *   general  -> { "answer": string, "ask": "doctor" | "pharmacist" | "none" }   (Ripple's own answer, as the owner's policy
 *               file says: lib/safety/general.ts)
 *   crisis_words -> { "answer": string }   (the 995 and self-harm answers in a person's words: lib/safety/crisis-words.ts)
 */

export interface ComposeCandidate {
  sourceId: string;
  kind: string;
  span: string;
  attribution?: string;
  drugs?: string[];
  topics?: string[];
  /** pre-written patient sentence for this source (use it word for word when relevant) */
  restatement?: { en: string; zh: string };
}

export interface ComposePayload {
  task: "compose";
  route: string;
  locale: string;
  input: string;
  /** keyword topics found in the input (purpose, food, missed, dose_change ...) */
  topics: string[];
  /** drug ids the input is about */
  drugs: string[];
  candidates: ComposeCandidate[];
  maxSentences: number;
}

export interface ClassifyPayload {
  task: "classify";
  input: string;
  routes: string[];
}

/** What a refused request is about (the model's answer to classify, next to the route). */
export const CLASSIFY_TOPICS = ["dose_change", "stopping", "combination", "other"] as const;
export type ClassifyTopic = (typeof CLASSIFY_TOPICS)[number];

/** A statement the rules only logged: is it a crisis after all? (the model can only raise it, never lower it) */
export interface CrisisPayload {
  task: "crisis";
  input: string;
}

export const CRISIS_ANSWERS = ["emergency", "self_harm", "none"] as const;
export type CrisisAnswer = (typeof CRISIS_ANSWERS)[number];

/**
 * Layer 3. `source` is the whole text of the cited source (the candidate's span), never the fragment the
 * generator chose: a fragment out of its context can say something the source does not ("most people have no
 * trouble with the medicine" out of a paragraph about liver injury). `fragment` is the part the generator says it
 * relied on, sent as a hint only.
 */
export interface SupportPayload {
  task: "support";
  source: string;
  fragment?: string;
  sentence: string;
}

/**
 * A long press on one of his records (owner's decision of 10-14, modelled on his iOS app; lib/explain/verdict.ts): the
 * facts the server built from his records and the quotes that bear on the thing he held. The model writes at most two
 * short sentences from them and from nothing else; the guards in verdict.ts decide whether they are shown.
 */
export interface ExplainPayload {
  task: "explain";
  /** the language to answer in */
  locale: string;
  /** what he held: med, dose, bp, bp_week, visit, visit_line, question, next_visit */
  subjectType: string;
  /** its name, as the sheet's head says it */
  subject: string;
  /** the lines under 「Ripple 查看了什么」, in the request's language */
  facts: string[];
  /** the quotes shown as sources: who said it or where it is written, and the words themselves */
  sources: { by: string; text: string }[];
  /**
   * only when a family member holds it through her care link (lib/explain/verdict.ts SYSTEM_EXPLAIN_FAMILY): she is the
   * reader, he is the subject. Absent on his own long press, whose payload is what it always was
   */
  reader?: "family";
  /** with `reader`: how she calls him (「爸爸」), the word the sentence uses for him */
  patient?: string;
  /** a family member's read: the pronoun her word for him takes (zh 他 / 她 / the word; en he/his, she/her) */
  pronoun?: string;
}

/** What the model answers to "explain" (the mock: no words of its own, abstain). */
export interface ExplainAnswer {
  verdict: string;
  abstain: boolean;
}

/**
 * Ripple's own words under an answer of /api/ask (owner's decision of 10-14; lib/safety/gloss.ts): his question and the
 * quotes the answer shows, after the three checks. The model writes at most two short sentences about what those quoted
 * words say for his question, each naming the quotes it rests on; the guards in gloss.ts decide whether they are shown.
 */
export interface GlossPayload {
  task: "gloss";
  /** the language to answer in */
  locale: string;
  /** his question, as he typed or said it */
  question: string;
  /** the quotes the answer shows: their source id, who said it or where it is written, and the words themselves */
  sources: { id: string; by: string; text: string }[];
}

/** What the model answers to "gloss" (the mock: no sentence of its own). */
export interface GlossAnswer {
  sentences: { text: string; sourceIds: string[] }[];
}

/**
 * Ripple's notes of a visit (owner's decision of 10-14: recording works like a meeting AI, "I speak, and it summarises";
 * lib/visit/ripple-summary.ts): the visit's lines as the transcript has them, and at most four short points of what was
 * said, each naming the lines it rests on; the guards there decide which points are shown. Never a source for an answer.
 */
export interface SummaryPayload {
  task: "summary";
  /** live: what has been said so far, while the visit is recorded; final: the whole visit, from its transcript */
  stage: "live" | "final";
  /** the language to write in */
  locale: string;
  /** the lines in order: a short id, who said it when the transcript names the speaker (null: it does not), the words */
  lines: { id: string; by: string | null; text: string }[];
  /** live only: the points shown now, which the model keeps while they still hold */
  previous?: string[];
}

/** What the model answers to "summary" (the mock: no point). */
export interface SummaryAnswer {
  points: { text: string; lines: string[] }[];
}

/**
 * Ripple's own answer (owner 10-15, lib/safety/general.ts): his question, his medicines and the sources that may bear on it
 * (his doctor's words, his labels, the leaflets), so the answer never goes against them. The model answers in his language
 * as the owner's policy file (lib/safety/policy/answer-policy.md) says, and says whom he might ask when that helps.
 */
export interface GeneralPayload {
  task: "general";
  /** the language to answer in */
  locale: string;
  /** his question, as he typed or said it */
  question: string;
  /** his medicines, as named on his list */
  medicines: string[];
  /** his sources that may bear on the question: who said it or where it is written, and the words */
  sources: { by: string; text: string }[];
}

/** What the model answers to "general". */
export interface GeneralAnswer {
  answer: string;
  /** whom he might ask about it, when that is genuinely useful; the screen offers to put it on that list */
  ask: "doctor" | "pharmacist" | "none";
}

/**
 * The 995 and self-harm answers in a person's words (owner 10-15, lib/safety/crisis-words.ts): his message, the kind of
 * crisis the rules (or the crisis screen) found, and what the fixed sentences say, which the answer must keep (995, that his
 * words were noted for his doctor and when). The helplines are not in it: they stay fixed lines after the answer.
 */
export interface CrisisWordsPayload {
  task: "crisis_words";
  locale: string;
  /** his words */
  message: string;
  kind: "emergency" | "self_harm";
  /** the fixed sentences this answer stands in for, in his language */
  fixed: string[];
  /** his doctor's own warning line, when the answer quotes it (shown with the answer as the doctor's words) */
  doctorLine?: string;
  /** when his words were kept for his doctor ("10月15日 14:20"), or null */
  noted: string | null;
  /** another person's crisis reported by family (talk about "them") */
  someoneElse: boolean;
  /**
   * now: 995 now (danger signs, a stroke sign, an overdose, self-harm). if_worse: his words are kept for his doctor and 995 is
   * for when it gets bad (his own chest pain or a high reading with nothing that says it is happening badly now; 10-14)
   */
  urgency: "now" | "if_worse";
}

/** What the model answers to "crisis_words". */
export interface CrisisWordsAnswer {
  answer: string;
}

export type TaskPayload = ComposePayload | ClassifyPayload | CrisisPayload | SupportPayload | ExplainPayload | GlossPayload | SummaryPayload | GeneralPayload | CrisisWordsPayload;

export interface ComposedSentence {
  speechAct: "restate" | "question" | "referral" | "logistics";
  sourceId: string;
  span: string;
  slots: Record<string, unknown>;
  en: string;
  attribution?: string;
}

/** Which candidate topics answer which input topic (shared by the mock composer and the prompt). */
export const TOPIC_SOURCES: Record<string, string[]> = {
  purpose: ["purpose"],
  why_take: ["why_take"],
  food: ["food", "label"],
  side_effects: ["side_effects"],
  missed: ["missed"],
  grapefruit: ["grapefruit"],
  label: ["label"],
  stopping: ["stopping"],
  combination: ["combination"],
  target: ["target"],
  threshold: ["threshold"],
  readings_summary: ["readings_summary", "target"],
  blood_test: ["blood_test"],
  appointment: ["appointment"],
  dose_change: ["dose_change", "label"],
};

/** Topics whose sources are not about one drug (doctor's numbers, his records, visit logistics). */
export const DRUG_FREE_TOPICS = new Set(["target", "threshold", "readings_summary", "appointment"]);
