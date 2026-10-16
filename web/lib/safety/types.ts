/**
 * Safety-layer types (docs/plan/spec.md section 4). Spec fields keep their names; extensions are marked.
 */
import type { SafetyEventRow } from "@/lib/store/types";
import type { Slots, SlotMismatch } from "./slots";

export type Route =
  | "explain"
  | "refuse_route"
  | "unknown_med"
  | "emergency"
  | "self_harm"
  | "log_only"
  | "logistics"
  | "uncertain"
  /**
   * C2 track S (routed from track K's chat): chit-chat Ripple has nothing for (the weather, the lottery, the news, a match,
   * a joke): the fixed 「这个我帮不上，要我记下来吗？」, no model call, no question. Only the rules give it (classify.ts
   * classifyRules, off-topic.ts); it is not in ROUTES, the list the model picks from.
   */
  | "cant_help";

/** The routes the model may pick (classify.ts sends this list; recorded cassettes key on it): every route but cant_help. */
export const ROUTES: Route[] = ["explain", "refuse_route", "unknown_med", "emergency", "self_harm", "log_only", "logistics", "uncertain"];

export type Attribution = "label" | "doctor" | "dispenser" | "pharmacist" | "leaflet";
export const DIRECTIVE_ATTRIBUTIONS: Attribution[] = ["label", "doctor", "dispenser", "pharmacist", "leaflet"];

export type Locale = "en" | "zh-Hans";

/**
 * Whose words a visit line is, as this session's transcript has it now (M4 cross-module fix):
 * - confirmed: he confirmed the speaker in the after-visit review (or the seed's end state of a visit that was
 *   never replayed in this session): the UI may say 医生说 / Doctor said;
 * - inferred: Ripple's guess (a replayed or recorded visit he has not confirmed yet): the UI says
 *   推断：医生 / Inferred: doctor, exactly as the visit screen does;
 * - unknown: nobody knows who said it (no attribution at all).
 */
export type LineRoleState = "confirmed" | "inferred" | "unknown";

/** Where a quoted line came from, for the source tag and "play the doctor's own words". (extension) */
export interface Citation {
  /** visit id (v1, v2, p1, v3) for visit lines */
  visitId?: string;
  /** story day of the visit or record */
  day?: number;
  /** ISO date of the visit or label */
  date?: string;
  /** R1-R4 when the line is a required doctor line */
  requiredLine?: string;
  utteranceId?: string;
  tStartMs?: number;
  tEndMs?: number;
  /** web/fixtures relative path of the stand-in clip, when one exists ("visits/clips/v2-u08.wav") */
  clipPath?: string;
  /** clip is a synthetic stand-in voice (label it in the UI) */
  standInVoice?: boolean;
  /** same-origin URL that plays the clip (GET /api/visits/<visit>/clip?u=<utterance>&session=<id>) */
  clipUrl?: string;
  /** the UI label of a stand-in clip in the answer's language: 代录音 / stand-in recording (set by ask()) */
  clipLabel?: string;
  /** visit lines: the speaker role in this session's transcript (or the seed's speaker when never replayed) */
  role?: "doctor" | "dispenser" | "pharmacist" | "patient" | "family" | "unknown";
  /** visit lines: confirmed / inferred / unknown, the same state the visit screen shows (see LineRoleState) */
  roleState?: LineRoleState;
  medId?: string;
  kbSourceId?: string;
  url?: string;
  title?: string;
  pageDate?: string;
  /** patient_text review status ("draft" until a pharmacist checks it) */
  reviewStatus?: string;
  /** referrals.json row id */
  referralId?: string;
}

export type CandidateKind = "visit" | "label" | "kb" | "patient_text" | "referral" | "log";

/** Candidate.about marker: a medicine nobody could identify (never one of the KB drug ids). */
export const UNIDENTIFIED_DRUG = "unidentified";

export interface Candidate {
  sourceId: string;
  /** The text a sentence citing this candidate is checked against. */
  span: string;
  kind: CandidateKind;
  // ---- extensions
  /** Mandarin side of the same source (patient_text zh is NOT here: it is a restatement, not evidence). */
  spanZh?: string;
  attribution?: Attribution;
  /** drug ids this source is about */
  drugs?: string[];
  /**
   * The medicines a spoken line is about, from its own words or, when it names none, from the conversation it is part
   * of (the question it answers, the medicine named just before it, the visit's prescriptions); UNIDENTIFIED_DRUG for
   * a line about a medicine nobody could identify (the relative's box). Used only by the layer-1 relevance rule
   * (verify.ts relevanceReasons); never sent to the model, so the recorded prompts stay the same. (fix round 1)
   */
  about?: string[];
  /** a spoken answer: the topics of the question it answers ("Yes, both together after breakfast is fine." -> combination) */
  answers?: string[];
  /**
   * C2 track S: the words of the question it answers (his line just before it, or the question on his list), so an answer to
   * "Can I take one more tablet when it's high?" never answers "Can I halve it?" (topics.ts sameFacet; verify.ts
   * relevanceReasons). Never sent to the model.
   */
  answersQuestion?: string;
  /**
   * A transcript line's neighbours by the same speaker (the line just before and just after, when the same person kept
   * talking): a line after one that leaves it hanging ("Please don't.") or before one that takes it back ("No, one.") is
   * never shown (verify.ts wholeSourceBlock; fix round 3). Never sent to the model.
   */
  context?: { before?: string; after?: string };
  /** topic tags used to pick sources (purpose, food, missed, dose_change, target, threshold ...) */
  topics?: string[];
  /** the cited text is itself an instruction (label directions, doctor instruction, leaflet how-to-take) */
  instruction?: boolean;
  /** pre-written restatement shown to the patient (patient_text en / zh) */
  restatement?: { id: string; en: string; zh: string; status: string };
  cite?: Citation;
}

export type SpeechAct = "restate" | "question" | "referral" | "logistics";

/**
 * How a sentence's text came to be (extension, set by the pipeline, never by the model):
 * - span: the text is one or more whole sentences of the cited source (after normalising case and punctuation);
 *   a fragment cut out of a sentence is not a span
 * - patient_text: the pre-written restatement of a kb field
 * - template: a fixed text from lib/safety/templates.ts (en must equal that template's en)
 * - slot_template: the Mandarin label template built from the cited label's own slots (zh.ts), placed in `en`
 * - model: anything else, i.e. a model paraphrase -> borderline. A paraphrase may not cite the doctor's words,
 *   a label or a referral row (layer 1), may not be in Chinese (layer 1), may not be a directive or carry a
 *   judgement word (layer 2); what is left goes to the second-vendor checker (layer 3)
 * - voiced (owner 10-15, crisis-words.ts): a fixed 995 or self-harm sentence the model put in a person's words after the
 *   checks, for what he said; it keeps its templateId (the screen draws it as that template: the red card, the call
 *   buttons) and every number of the fixed sentence. Set only after the three checks; the fixed sentence is the fallback
 */
export type SentenceOrigin = "span" | "patient_text" | "template" | "slot_template" | "model" | "voiced";

export interface Sentence {
  speechAct: SpeechAct;
  sourceId: string;
  span: string;
  slots: { drug?: string; quantity?: string; unit?: string; frequency?: string; time?: string; numbers?: string[] };
  en: string;
  /** From a template or patient_text.json, never translated by the model. Undefined = show `en` (original words). */
  zh?: string;
  attribution?: Attribution;
  // ---- extensions
  origin?: SentenceOrigin;
  /** template id when origin = template */
  templateId?: string;
  cite?: Citation;
  /**
   * C2 track S: a checked translation of a quoted line (lib/translate: the same facts on both sides, then the checker
   * model said the meaning is unchanged), shown under the original words and labelled as a translation (「中文翻译，以英文
   * 原话为准」). Set by the pipeline after the three checks, from the scope's translation cache only; never in place of
   * the original, never the generator's text. Absent: show the original words and the recording alone.
   */
  translation?: { lang: Locale; text: string };
}

export interface LayerResult {
  pass: boolean;
  /** machine reason codes, e.g. unknown_source, number_not_in_span, directive_without_attribution, no_checker */
  reasons: string[];
  detail?: Record<string, unknown>;
}

export interface Layer1Result extends LayerResult {
  sentenceSlots?: Slots;
  spanSlots?: Slots;
  missing?: SlotMismatch[];
}

export interface Layer2Result extends LayerResult {
  directive: boolean;
  hits?: { pattern: string; text: string }[];
  /** judgement / advice words found in a model-written sentence (lib/safety/judgement.ts) */
  judgement?: { category: string; word: string }[];
}

export interface Layer3Result extends LayerResult {
  /** false when layers 1-2 settle it (verbatim span, patient_text or template) */
  needed: boolean;
  checker?: string | null;
}

export interface SentenceVerdict {
  index: number;
  sentence: Sentence;
  layer1: Layer1Result;
  layer2: Layer2Result | null; // null when layer 1 already blocked
  layer3: Layer3Result | null; // null when an earlier layer blocked
  pass: boolean;
  blockedBy: 1 | 2 | 3 | null;
}

export interface BlockedSentence {
  sentence: Sentence;
  layer: 1 | 2 | 3;
  reasons: string[];
  replacedBy: string; // template id
}

/** One sentence of Ripple's own words under an answer's quotes, and the shown quotes it rests on (their sourceIds). */
export interface GlossSentence {
  text: string;
  sourceIds: string[];
}

/**
 * Ripple's own explanation of an answer's quotes (owner's decision of 10-14; lib/safety/gloss.ts): at most two short
 * sentences a model wrote in his language about what the quoted words say for his question, each resting on quotes the
 * answer shows, every guard passed. Shown as Ripple's entry right before `sentences[at]` (after the last quote, before
 * Ripple's fixed referral line), each sentence with chips naming its quotes, and gloss-note.ts's line under it.
 */
export interface Gloss {
  /**
   * gloss: Ripple's explanation of the quotes above it (10-14, gloss.ts; every sentence names its quotes).
   * general (owner 10-15, general.ts): Ripple's own answer to his question as the owner's policy file says, after his
   * sources when they speak to it; its sentences name no quote (sourceIds empty) and the screen says it is general
   * information from Ripple, not his doctor's words.
   */
  kind: "gloss" | "general";
  /** the language the sentences are written in (the answer's) */
  lang: Locale;
  sentences: GlossSentence[];
  /** where it stands: before the sentence of `sentences` at this index (the answer's sentences, not its own) */
  at: number;
  /**
   * general only: whom Ripple suggests he ask about it (the model's choice, when genuinely useful). The screen offers to put
   * his question on that list; nothing is added unless he taps it (owner 10-15: offer, never silently)
   */
  offer?: "doctor" | "pharmacist";
}

export interface AskResult {
  route: Route;
  sentences: Sentence[];
  addedQuestionId?: string;
  fixedText?: string;
  events: SafetyEventRow[];
  // ---- extensions
  /** Mandarin fixed text for the zh-Hans UI (unknown medicine: shown under the English line) */
  fixedTextZh?: string;
  locale: Locale;
  blocked: BlockedSentence[];
  /** which rule or model decided the route */
  routeReason: string;
  /** set when the route changed after generation (explain with nothing to say -> uncertain) */
  routeChangedFrom?: Route;
  latencyMs: number;
  llm: { provider: string; model: string; tokens: number; calls: number };
  /**
   * addedQuestionId names a question that was already open on the list from the same story day with the same
   * topic (for example the seeded q-extra-tablet on D29): it was reused, not duplicated (M4)
   */
  questionReused?: boolean;
  /**
   * C2 track S (round 2; real-app 4.5 「回答里那句写『你 9月22日 也问过，已经在问题单里』」): when the reused question went
   * onto his list on an earlier day, that day (YYYY-MM-DD: the real date on an account, the story's date on the demo), so
   * the answer can say when he asked it before. Not set for a question from the same day (the demo's day 29 stays as it
   * was: the seeded question there is the one this very ask makes in the story).
   */
  reusedQuestion?: { date: string };
  /** refuse_route: the request itself is not Ripple's to answer; why, and which referral replaces the answer (M4) */
  refusedRequest?: { rule: string; topics: string[]; replacedBy: string };
  /**
   * The per-session cost guard's limit was reached and this answer (a statement, or an input near crisis words) came
   * from the rules alone, with no model call and the fixed safety line (fix round 2); other inputs get HTTP 429
   */
  costLimited?: { limit: string; retryAfterSec: number };
  /**
   * C2 track S (round 2): his day's model spend (real-app 3.5: US$0.20 a person a day) was used up, so no request was sent:
   * this answer came from the rules, the deterministic composer and the fixed templates alone
   */
  spendCapped?: true;
  /**
   * C2 track S: he asked again what his doctor (or pharmacist) already answered: their recorded answer, word for word,
   * comes first and no new question is added (architecture review: 再问一遍医生已经回答过的问题 → 直接给医生的回答，不再新建问题).
   * questionId: the answered question on his list, when the answer is one; by: who answered; date: the day of the visit
   * it was answered at (YYYY-MM-DD, as the source's citation carries it). Decided from his words and the store alone
   * (pipeline.ts ownListRule, matchAnswered), never by a model: the same on every provider, and when a model is late.
   */
  answeredBefore?: { questionId: string | null; sourceId: string; by: "doctor" | "pharmacist" | "dispenser"; date?: string };
  /** C2 track S: he has not agreed to AI processing: rules and fixed templates only, no model call of any kind */
  noAiConsent?: true;
  /**
   * The demo's check drill was asked for (AskDeps.plant): whether its sentence joined this answer. It never does on a
   * crisis answer, a note, chit-chat or a refused instruction. When it did, `blocked` holds it with the layer that stopped it.
   */
  drill?: { planted: boolean };
  /**
   * Ripple's own explanation of the quotes (lib/safety/gloss.ts): only with his consent, a live model and a checker, on an
   * answer that quotes his sources and carries no 995; absent whenever anything about it fails (the answer is then the
   * same as without it)
   */
  gloss?: Gloss;
}

/**
 * SSE (owner 10-15: 「需要非常完整的 SSE 的输出」): what an answer says while it is being made, in the order it happens
 * (AskDeps.stream; POST /api/ask writes each as one event, app/api/ask/route.ts). Nothing here is the answer: the final
 * AskResult is, and a screen draws these only until it arrives.
 *   stage     where the answer is: "reading" (his sources are being looked at; the first event, sent once his question was
 *             admitted, so a refusal is still a plain HTTP answer) or "writing" (Ripple's own words are being written)
 *   sentence  one sentence of the answer, final: it passed the three checks (a crisis template is never held back), at its
 *             place in the answer; `route` is the answer's route as it then stands
 *   delta     Ripple's own everyday answer (general.ts), words as the model writes them; only once the answer is known not
 *             to be a crisis, never a crisis route's words
 *   retract   the words of the deltas are taken back (the guard dropped them, the answer turned out not to take them, the
 *             model failed): what stands instead comes with the final answer
 *   replace   the answer's sentences as they now stand (the 995 or self-harm lines in a person's words passed their checks
 *             and stand where the fixed lines stood)
 */
export type AskStreamEvent =
  | { type: "stage"; stage: "reading" | "writing"; locale?: Locale }
  | { type: "sentence"; index: number; sentence: Sentence; route: Route }
  | { type: "delta"; text: string }
  | { type: "retract"; why: string }
  | { type: "replace"; sentences: Sentence[]; route: Route };
