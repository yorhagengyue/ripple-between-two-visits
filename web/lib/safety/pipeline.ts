/**
 * /api/ask end to end (spec section 5): classify -> candidates -> generate -> three checks -> replace blocked
 * sentences with the referral template -> question list -> safety_event + backstage events.
 *
 * Route by route:
 *   self_harm     fixed helpline templates (B4), no model call; a crisis family reports about someone else ("my dad
 *                 doesn't want to live") gets "if they might hurt themselves" first (classify.ts isThirdPersonReport)
 *   emergency     fixed 995 template (B1); the doctor's own warning line (R2) quoted word for word when the
 *                 symptoms or the reading match it, and they are his (not someone else's: fix round 3); no model
 *                 call. Taking more than the label says: the fixed overdose template (B1-12: medical help straight
 *                 away, 995 or A&E); someone else's overdose "If they took more ..." (a child's: "Call 995 now").
 *                 10-14 (the owner's decision: 「胸口痛就必须打 995」 was too absolute): his own chest pain, a stroke sign
 *                 (one-sided weakness, slurred speech ...) or a reading above his doctor's own number, with no sign
 *                 that it is happening badly now (classify.ts signalFamily: not breathing, collapse, confusion, an
 *                 allergic swelling, bleeding, a bad headache with a high reading, a cold sweat, getting worse, a
 *                 sudden worst headache, an overdose, two kinds of symptom at once, someone else's), stays the
 *                 emergency route but is answered as a sign for his doctor: his
 *                 words are kept as his note, marked for the doctor (lib/daily/signals.ts), and the answer says so
 *                 with the date and time (templates.ts SIGNAL_RECORDED), quotes his doctor's warning line, and ends
 *                 with 995 for when it gets bad, in words for its kind (SIGNAL_995: chest, stroke, or "very
 *                 unwell" for a reading alone, whose doctor's line comes first). No question is added. When the
 *                 note cannot be written the answer is the fixed 995 template as before
 *   unknown_med   the fixed sentence, question for the pharmacist; no model call
 *   refuse_route  prompt-injection: fixed refusal. Dose change / stopping: the doctor's "don't change the dose"
 *                 line and the label directions are always included, plus what the generator picks, then the
 *                 referral template; a question is always added. What to eat with a long-term condition (kidney
 *                 disease, diabetes, heart failure, pregnancy ...: special-diet.ts): the fixed 「这个要问医生或营养师」 and
 *                 a question for the doctor, no generator (C2 track S, journey 13). He says he took one tablet too
 *                 many, or today's dose twice, and names no symptom (10-14; classify.ts rule:extra_dose_taken): the
 *                 doctor's lines about the dose, his label, then the fixed sentence extra_dose_taken (ask the
 *                 pharmacist or doctor today; 995 or A&E if he feels very unwell); no generator; his words go on the
 *                 doctor's list as a question of their own (the same words already there are reused, never another
 *                 dose question, and never "answered before")
 *   explain       generator output; nothing usable -> becomes uncertain
 *   uncertain     generator output for conflicts (each source with its own tag), uncertain template, question. A question
 *                 what X is for whose X is none of his medicines (10-14; classify.ts rule:not_a_medicine: 验血, 血压计) has
 *                 no topic, so no source: the uncertain template and the question for his doctor, never "answered before"
 *                 (the medicines matchAnswered would compare are his prescriptions, which the question is not about)
 *   log_only      the note is saved (after the crisis screen below, so a crisis is never just noted); "Noted." and,
 *                 unless he described a symptom, "Have you taken today's tablet?"
 *                 only when a dose is due today and has no answer yet (taken / missed). The timeline seed is the
 *                 story's end state, so when the story itself records this very note on this day together with
 *                 the check-in question (D20 "我今天好累"), the note came before that day's tick and the check-in
 *                 is asked as the story says (M4). A plain note (「头有点晕」, 「吃多了」) gets nothing else (10-14, the
 *                 owner's decision: the fixed safety line no longer follows a note just because no crisis screen
 *                 looked at it). A note, like every other non-crisis answer, carries the fixed safety line (995 /
 *                 A&E, referral B4-01) only when its own words come near a crisis (classify.ts crisisCue; fix round 1),
 *                 and with no crisis screen such words in a note are first read as a crisis (applyRulesOnlyCue)
 *   logistics     sharing / refill templates, or the doctor's follow-up line. A question about Ripple itself (10-14;
 *                 classify.ts rule:about_ripple: "What is Ripple for?", 「你能做什么？」) gets the fixed about_ripple
 *                 sentence: no model call (no crisis screen either: the rule found no medicine, symptom or crisis word), no
 *                 question, nothing saved
 *   cant_help     chit-chat Ripple has nothing for (the weather, the lottery, the news, a match, a joke: off-topic.ts), only
 *                 when no topic, reading, medicine, symptom or crisis word is in it: the fixed 「这个我帮不上，要我记下来吗？」,
 *                 no model call (no crisis screen either: the rules found no crisis word), no question, nothing saved (C2
 *                 track S, routed from track K)
 * Crisis screen (live models only; 10-09 round 2 widened it from statements to every route): every input the rules
 * did not route to emergency or self_harm also goes to the main model's crisis screen (screenCrisisWithModel). It is
 * started at once and runs alongside classification and generation, so an answer waits for it only when it has no
 * model call of its own (a statement, an unknown medicine, an injection refusal, a template). It can only raise the
 * route to emergency or self_harm (the composed answer is then dropped for the crisis templates); "none", an invalid
 * answer, an error, the spend cap or the deadline keep the rules' route, and the ask.route event says the screen was
 * unavailable (rules only). Offline (mock) there is no screen: the rules are the crisis screen.
 * 10-14 (the owner's decision on one tablet too many): the screen's prompt calls any tablets already taken an emergency,
 * so for the one case the rules took out of it (classify.ts rule:extra_dose_taken: one tablet too many, no symptom or
 * danger word, his own medicine) the screen's "emergency" does not raise the route (crisisScreen.heldBy says so); its
 * "self_harm" still does, and the answer's own fixed sentence still says 995 or A&E if he feels very unwell. The rules
 * already kept every such message with a symptom, a danger word or a larger amount an emergency.
 * Fix round 3: whenever no crisis screen vouched for the answer, the rules are the only screen, so crisis words route too:
 * an emergency described in words no rule knows (classify.ts emergencyCue) goes to the 995 template whatever the sentence
 * form, and a statement with self-harm words (selfHarmCue) to the helplines instead of "Noted." (applyRulesOnlyCue,
 * safety_event.output.rulesOnlyCue). And a live screen that answered "none" no longer takes the safety line away from an
 * answer whose words come near a crisis (reason screen_none). A spoken line or a label is shown whole or not at all
 * (verify.ts sourceQuote), so two sentences cited from one line become one. One exception, set in code (owner 10-14):
 * to a dose-change question the doctor's line with a recording cut by sentence is narrowed to the sentence that says
 * not to change the dose, word for word, and plays only that sentence (lib/asr/sentences.ts narrowQuote).
 * Any blocked sentence adds the referral template and a question (one per answer). M4: a question that is already
 * open from the same story day, for the same person, with the same topic (dose change, stopping, combining) and
 * about the same medicines is reused instead of duplicated (the seeded q-extra-tablet on D29): addedQuestionId names
 * it, questionReused is true and question.updated is published. A question that names no medicine is about his
 * prescriptions, so the painkiller's "can I take two tonight" is its own question (round 2). Open means open at the story
 * moment (waitingAt, 10-10): the seed answers q-extra-tablet at the D42 visit, and on D29 it is still waiting. The same
 * medicine nobody could identify, typed again the same day (the same words or the same unrecognised name), reuses its
 * pharmacist question too (gap 6.4, sameUnknownMedicineQuestion).
 * Story moment (gap 7.5, 10-10): the doctor's warning line (R2) counts as said only once its visit has happened by the
 * session's story day and time (line-state.ts visitHappened), here as in the candidates.
 * A refused request (refuse_route) also publishes one ask.blocked event for the request itself (why it is not
 * answered, which referral replaces the answer), so the backstage always shows what was stopped and why, also when
 * no generated sentence had to be blocked.
 *
 * Deadline (ASK_DEADLINE_MS, default 8 s): the model calls of one answer share one time budget. Classification,
 * the crisis screen and generation must finish before the budget minus a reserve for layer 3; past it they stop and
 * count as a generation failure. Layer-3 checks still running at the deadline fail closed (blocked, referral). Crisis
 * routes the rules found make no model call, so 995 and the helplines never wait for a model.
 * The budget starts with the answer, so the store's time counts too. A model call that starts late (the database was slow
 * that time) still gets a share of its own (lateCallMs), never past the total (fix round of 10-11: the first run against
 * the real database and the real model cut a compose call 1.6 s after it began; DeepSeek's own time was ordinary).
 * A generation that fails (the deadline, an outage, a reply that is not the expected JSON) is not the end of the answer:
 * the offline composer (lib/llm/mock.ts: it picks the sources by the topic table and returns each word for word, the way
 * every answer is made without a model) composes it from the same candidates, and the three checks run on that. He reads
 * "nothing answers this" only when the sources really hold nothing.
 * His own question list comes before the model (fix round of 10-11): whether he asked this before, and whether a clinician
 * has answered it since, are facts in the store. When no rule knows the words, the list is looked at first (ownListRule):
 * a question of his a clinician answered routes to explain and leads with that answer (rule:answered_before); one still
 * waiting on his list routes to uncertain and reuses it (rule:asked_before). The model's classification is not asked for
 * either, so neither fact depends on how a model sorts the words or on whether it answers in time. (The real model sorted
 * 「我家的血压机是绑手腕的，能用吗？」 as logistics, quoted the doctor's answer and never said it had been answered before.)
 * The demo's check drill (AskDeps.plant, lib/crew/drill.ts): one fixed sentence no source says is added to the composed
 * answer here, after generation, whoever composed it (a model, the offline composer, the fallback above), and goes through
 * the three checks like a model's sentence. Layer 1 stops it every time. No model is asked for it.
 * Invisible format characters (zero-width spaces, soft hyphens, bidi controls) are removed from the input first.
 * Ripple's own words (10-14, the owner's decision; gloss.ts): once the answer is what is shown, an answer of explain,
 * uncertain or refuse_route that quotes his sources and carries no 995 gets ONE more model call, which explains in his
 * language what the quoted words say for his question, each sentence tied to its quotes. Every guard of gloss.ts and the
 * checker must pass it, else it is absent; never offline, without his consent, at the spend cap or with no checker; bounded
 * by the explain route's time. It is AskResult.gloss, not a sentence: `sentences` stays what passed the three checks.
 *
 * Streaming (owner 10-15: 「需要非常完整的 SSE 的输出」; AskDeps.stream, types.ts AskStreamEvent): the same answer, told while it
 * is made. Nothing is decided differently and the AskResult is the same; only the order things are said in is added:
 *   - "reading" once his question is admitted (the cost guard has let it through: a 429 is never inside a stream);
 *   - each sentence once it is final: after the three checks, in the answer's order, before any later model call (so a
 *     995 or a helpline line goes out before the crisis wording is asked for, and never waits for a model of its own);
 *     the fixed sentences Ripple's own answer may replace (GENERAL_REPLACES) wait until that answer is decided;
 *   - Ripple's own everyday answer word by word ("writing", then deltas): the words are kept back until the route is
 *     final and is no crisis, has no helplines and is one that takes such an answer (offline also: no quote in it), then
 *     sent as they come; if the answer is not shown in the end (a guard, the gate, a failure, the time) a retraction takes
 *     them back. The crisis wording (crisis-words.ts) never streams: once it passed its checks, a replacement of the
 *     sentences says where it stands.
 */
import { cutTranslation, doseQuoteTopic, narrowQuote, quotedLine } from "@/lib/asr/sentences";
import { publish as busPublish, type BusEventType } from "@/lib/bus";
import { createChecker, createMainLlm, createMockLlm } from "@/lib/llm";
import type { CheckerIndependence } from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/types";
import { medsOnDayAt, prescribingLines } from "@/lib/meds/on-day";
import { DOSE_SLOT, isDue, medName } from "@/lib/session/today";
import { signalMoment, signalMomentWords, signalReply } from "@/lib/daily/signals";
import { cachedTranslation, translateDoctorLine, translateOwnWords } from "@/lib/translate";
import { exampleZh } from "@/lib/translate/example-set";
import { happenedVisits } from "@/lib/visit/happened";
import { scopeD0 } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { StoreError, type MedicationRow, type NoteRow, type QuestionOrigin, type QuestionRow, type SessionRow, type Store, type VisitRow } from "@/lib/store/types";
import { usageStore } from "@/lib/subject/usage";
import {
  aboutSideEffect,
  buildCandidates,
  candidateReads,
  happenedVisitIds,
  medsOnDay,
  referralCandidate,
  templateCandidate,
  transcriptOf,
  type CandidateSet,
} from "./candidates";
import {
  aboutSomeoneElse,
  classifyRules,
  classifyWithModel,
  crisisCue,
  emergencyCue,
  isThirdPersonReport,
  namedDrugs,
  screenCrisisWithModel,
  selfHarmCue,
  signalFamily,
  targetDrugs,
  type Classification,
  type ClassifyContext,
  type CrisisScreen,
  type SignalFamily,
} from "./classify";
import { CostLimitError, storeCostGuard, type AskGuard } from "./cost-guard";
import { hisCareLinks, sharedWith } from "./family-link";
// owner 10-16: his family is told when Ripple answers his own message on the emergency route (the baseline, no switch)
import { familyAlarm, tellFamily, type TellInput } from "@/lib/care/told";
import { findForbiddenNumbers } from "./forbidden";
import { isReadOnce, primeRead, readOnce, warmRead } from "./read-once";
import { generateSentences } from "./generate";
import { voiceCrisis, type CrisisWordsRecord } from "./crisis-words";
import { answerLocale, generalGloss, writeGeneral, type GeneralOutcome, type GeneralRecord } from "./general";
import { glossAt } from "./gloss";
import { clinicianAttribution, type StoryMoment } from "./line-state";
import { mentionsOtherSubstance, OTHER_SUBSTANCE, otherSubstances, unresolvedInCombination } from "./substances";
import { emergencyReferralFor, selfHarmTemplateIds, SIGNAL_995, SIGNAL_RECORDED, signalRecordedText, TEMPLATES, UNKNOWN_MED_SENTENCE, type TemplateId } from "./templates";
import { detectLang, hasHan, normalizeForCompare, stripInvisible } from "./text";
import { dietCondition } from "./special-diet";
import { warningLine, warningLineFor } from "./threshold";
import { detectTopics, facetsOf, findReading, refersToMedicine, sameFacet } from "./topics";
import type { AskResult, AskStreamEvent, Attribution, BlockedSentence, Candidate, Gloss, Locale, Route, Sentence, SentenceVerdict } from "./types";
import { originOf, relevanceReasons, sourceWords, verifySentences } from "./verify";
import { zhFromSlots } from "./zh";

export interface AskInput {
  sessionId: string;
  text: string;
  /** UI language; default: the language of the input */
  locale?: Locale;
  /** who is asking (patient, family, judge ...); family questions are still Mr Tan's question list */
  role?: string;
  /** medicines the question is about ("ask about this" on a medicine card) */
  medIds?: string[];
  /** leave out the doctor's numbers (eval: before R1 exists) */
  noDoctorTarget?: boolean;
  /** names came from a low-confidence transcript: no fuzzy drug matching */
  asrLowConfidence?: boolean;
  /** override the session's story day */
  storyDay?: number;
}

type Publisher = (sessionId: string, type: BusEventType, say: string, data: unknown) => void;

export interface AskDeps {
  /** the request subject's scoped store (lib/subject), or a test's store */
  store: Store;
  llm?: LlmClient;
  /** layer-3 checker; null = none (borderline sentences blocked). Omit to read CHECKER_* from the environment. */
  checker?: LlmClient | null;
  checkerReason?: string | null;
  /** how independent the given checker is from the main model (shown with layer 3) */
  checkerIndependence?: CheckerIndependence | null;
  publish?: Publisher;
  /**
   * null = no cost guard (eval, tests). Left out: this person's guard counted in the store (cost-guard.ts storeCostGuard:
   * questions an hour, model tokens a day, model spend a day). The route passes the one it already started.
   */
  costGuard?: AskGuard | null;
  now?: () => number;
  /** total time budget of this answer in ms; default ASK_DEADLINE_MS or 8000 */
  deadlineMs?: number;
  /**
   * C2 track S: his consent to AI processing (lib/safety/consent.ts aiConsent). false: no model of any kind sees this ask:
   * the rules classify, the offline composer picks the sources (word for word, by topic), no checker (so nothing worded by
   * a model can pass), no crisis screen (the rules are the crisis screen), no translation; when the rules find nothing to
   * relay the answer says so (no_ai_consent) and the question goes to the doctor. Default true (the demo, tests, eval).
   */
  aiAllowed?: boolean;
  /**
   * C2 track S (latency pass): the scope row the request already read (lib/subject), so ask() does not read it again.
   * Used only when it is the asked session's row.
   */
  session?: SessionRow;
  /**
   * The demo's check drill (lib/crew/drill.ts; POST /api/ask sets it for a demo scope only, never for an account): one
   * fixed sentence that no source says. It is added to the composed answer as a careless model might have written it,
   * citing the answer's first source, and the three checks run on it as on every sentence. Not added to a crisis answer,
   * a note or a fixed refusal (AskResult.drill says whether it was).
   */
  plant?: string;
  /**
   * SSE (owner 10-15; POST /api/ask with Accept: text/event-stream): where the answer's progress goes while it is made
   * (types.ts AskStreamEvent; see "Streaming" in the header). Never called before his question is admitted (a 429 is
   * still a plain answer); a sink that throws is ignored. The returned AskResult is the same with or without it.
   */
  stream?: (event: AskStreamEvent) => void;
  /**
   * Owner 10-16 (lib/care/told.ts): his family is told when Ripple answers his own message on the emergency route, with
   * the conversation. Called once the safety_event is written and not waited for (his answer never waits for her phone);
   * default tellFamily. Tests pass a spy.
   */
  tellFamily?: (input: TellInput) => Promise<unknown>;
}

/**
 * Start the reads every answer makes, side by side, on the request's read-once store (C2 track S, latency pass; see
 * read-once.ts): what the classifier and the candidates read (candidates.ts candidateReads), his question list, the scope's
 * translations when the answer is in Mandarin, and, once the visits are known, each visit's transcript (a planned one has
 * none). Nothing here waits: the route calls it as soon as it has the scope row (alongside his consent), and ask() again
 * (a no-op by then); ask()'s own reads then find the rows. On a store that is not wrapped it does nothing.
 */
export function prefetchAsk(store: Store, session: SessionRow, opts: { text?: string; locale?: Locale; storyDay?: number } = {}): void {
  if (!isReadOnce(store)) return;
  const sid = session.id;
  const day = opts.storyDay ?? session.story_day;
  const locale = opts.locale ?? (opts.text !== undefined ? detectLang(stripInvisible(opts.text).trim()) : undefined);
  void candidateReads(store, sid, day).catch(() => undefined);
  void warmRead(store, "listQuestions", sid);
  if (locale === "zh-Hans") void warmRead(store, "listTranslations", sid);
  void warmRead(store, "listVisits", sid).then((visits) => {
    for (const v of (visits as VisitRow[] | undefined) ?? []) void transcriptOf(store, sid, v).catch(() => undefined);
  });
}

type Env = Record<string, string | undefined>;

/** ask()'s total time budget (ASK_DEADLINE_MS, default 8 s; the p90 target is 4 s). */
export function askDeadlineMs(env: Env = process.env): number {
  const n = Number(env.ASK_DEADLINE_MS);
  return env.ASK_DEADLINE_MS && Number.isFinite(n) && n > 0 ? n : 8000;
}

/** The part of the budget kept for the layer-3 checks after generation (a third, at most 2.5 s). */
export function layer3ReserveMs(deadlineMs: number): number {
  return Math.min(2500, Math.floor(deadlineMs / 3));
}

/**
 * What a model call is given when it starts with less than this left of the generation budget (three eighths of the
 * total, at most 3 s; never past the total). The budget starts with the answer, so a slow database eats into it: on the
 * first real run a compose call was cut 1566 ms after it began, so it began about 3.9 s into the answer (the generation
 * budget's 5.5 s less those 1566 ms). Recorded deepseek-flash compose calls (fixtures/cassettes, 75 of them): median
 * 1.0 s, nine in ten under 1.4 s, the slowest 3.0 s.
 */
export function lateCallMs(deadlineMs: number): number {
  return Math.min(3000, Math.floor((deadlineMs * 3) / 8));
}

const CRISIS_ROUTES: Route[] = ["emergency", "self_harm", "unknown_med"];
/** Fixed lines added at the end for safety, not as the answer's referral (the safety line and the helplines). */
const SAFETY_TAIL_IDS = ["safety_line", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"];
/** Routes the crisis screen never looks at: already a crisis. */
const SCREEN_SKIP: Route[] = ["emergency", "self_harm"];
const R2_SYMPTOM_SIGNALS = ["above_doctor_threshold", "chest", "stroke", "high_bp_symptom"];

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Today's prescription doses (due by start day) and whether each already has an answer (taken or missed).
 * null = nothing is due today. "unconfirmed" (later, no reply, undone) is not an answer.
 */
export async function todaysDoseAnswered(store: Store, sessionId: string, day: number, meds: MedicationRow[]): Promise<boolean | null> {
  const due = meds.filter((m) => isDue(m, day));
  if (due.length === 0) return null;
  const doses = await store.listDoses(sessionId, { fromDay: day, toDay: day });
  return due.every((m) => doses.some((d) => d.medication_id === m.id && d.slot === DOSE_SLOT && (d.state === "taken" || d.state === "missed")));
}

/** owner 10-15: the requests that stay refusals (changing, stopping or combining his medicines); see the model's route below. */
const REFUSED_TOPICS = ["dose_change", "stopping", "combination"];
/** The knowledge base's blood-pressure medicines (kb/drugs.json: amlodipine and losartan bring blood pressure down). */
const BP_DRUGS = ["amlodipine", "losartan"];
/** A question about his blood pressure: the words, or a reading (152/96, 152 over 96). */
const ABOUT_BP = /血压|血壓|降压|降壓|blood\s*pressure|\bBP\b|\b\d{2,3}\s*(?:\/|over)\s*\d{2,3}\b/i;
/**
 * owner 10-15: the fixed sentences Ripple's own answer replaces (general.ts): "nothing answers this, I won't guess" and the
 * referrals that only said so; the question then is offered, not added (the answer's offer)
 */
const GENERAL_REPLACES = ["uncertain_no_source", "refer_pharmacist", "refer_diet"];
/** owner 10-15: an answer that still adds his question to his list, Ripple's own answer or not (a side effect he feels ...). */
const KEEPS_QUESTION = ["side_effect_noted", "said_and_added_doctor", "said_and_added_pharmacist"];
/** The self-harm lines: Ripple's own answer never stands next to them (the crisis gets the care, not general advice). */
const HELPLINE_IDS = ["self_harm_995", "self_harm_995_other", "self_harm_sos", "self_harm_mindline", "self_harm_care_corner"];

/** Topics that make two questions the same question (a dose change, stopping, combining; C2: a side effect he feels). */
const SAME_QUESTION_TOPICS = ["dose_change", "stopping", "combination", "side_effects"];

/** C2: who gave a recorded answer, for AskResult.answeredBefore (a candidate's attribution; a doctor when unsure). */
const answeredBy = (a: Attribution | undefined): "doctor" | "pharmacist" | "dispenser" => (a === "pharmacist" || a === "dispenser" ? a : "doctor");

/** C2: the referral templates that say nothing answers the question (never next to a clinician's own answer to it). */
const NOT_ANSWERED_TEMPLATES = ["refer_doctor", "refer_pharmacist", "refer_diet", "uncertain_no_source", "uncertain_conflict"];
const DEFERS = /^[^.?!。？！]*[?？]|\bbring (?:it|them|the \w+|that)\b|\bshow (?:me|it to me)\b|带来给我看|帶來給我看|拿来给我看|拿來給我看|带来看看|帶來看看/i;

/**
 * C2: a recorded answer that puts the question off until the clinician knows more: it opens with a question of its own or
 * asks him to bring or show something ("Which one? Bring it next time and show me.", 「下次带来给我看」). Shown, and the
 * question stays on the list for the next visit. A settled answer that only mentions next time ("... and we'll look at the
 * knee properly next time") is not put off.
 */
export function defersToNextVisit(answer: string): boolean {
  return DEFERS.test(answer);
}

/** C2: a symptom he describes in a side-effect question ("脚踝肿是不是副作用？"), so it goes on the doctor's list. */
const SYMPTOM_WORDS = /\bswollen\b|\bswelling\b|\bpain\b|\bache\b|\bdizzy\b|\brash\b|\bitch|\bcough|肿|腫|痛|疼|晕|暈|疹|痒|癢|咳/i;
/**
 * C2: a symptom asked about together with his medicine ("My ankles are a bit swollen, is that from the amlodipine?",
 * 「吃了这个药脚肿」) is a side-effect question even without the words "side effect". Read here, not as a topic: the topics go
 * into the model's prompt, and the recorded cassettes hold that prompt as it is. A symptom alone (「走了一圈，脚踝有点肿」)
 * is not about a medicine.
 */
const SIDE_EFFECT_ASK =
  /\b(?:swell\w*|swollen|rash|itch\w*|dizz\w*|giddy|headaches?|flush\w*)\b[^.?!]{0,40}\b(?:tablets?|pills?|medicines?|medications?|meds|amlodipine|losartan|ibuprofen)\b|\b(?:tablets?|pills?|medicines?|medications?|meds|amlodipine|losartan|ibuprofen)\b[^.?!]{0,40}\b(?:swell\w*|swollen|rash|itch\w*|dizz\w*|giddy|headaches?|flush\w*)\b|(?:肿|腫|疹|痒|癢|头晕|頭暈|头痛|頭痛)[^。？！，,]{0,12}(?:药|藥)|(?:药|藥)[^。？！]{0,12}(?:肿|腫|疹|痒|癢|头晕|頭暈|头痛|頭痛)/i;

/** C2: what a question is about, for matching a new ask with an answered question of his. */
const MATCH_TOPICS = [
  "dose_change",
  "stopping",
  "combination",
  "food",
  "missed",
  "side_effects",
  "purpose",
  "why_take",
  "blood_test",
  "appointment",
  "target",
  "threshold",
  "readings_summary",
  "grapefruit",
  "label",
];

/**
 * The medicines a question is about, as a sorted set: the ones it names (or the "ask about this" selection, `given`),
 * the self-bought painkiller for painkiller words; a question that names none is about his prescriptions. OTHER_SUBSTANCE
 * is added when it also names a supplement, food, drink or medicine by its use (fish oil, coffee, "sleeping pill"), so
 * two such questions are never merged as the same one (fix round 2).
 */
export function questionDrugs(text: string, meds: MedicationRow[], given: string[] = []): string[] {
  const named = given.length ? given : targetDrugs(text, { doctorThresholdSystolic: null, meds });
  const set = named.length ? named : meds.filter((m) => m.origin === "prescription" && m.drug_id).map((m) => m.drug_id!);
  return [...new Set([...set, ...(mentionsOtherSubstance(text) ? [OTHER_SUBSTANCE] : [])])].sort();
}

/**
 * The medicines an answer may speak about (verify.ts AskScope.drugs, the layer-1 relevance rule; fix round 2): the ones
 * the input names or points at for sure (classify.ts namedDrugs: names, the selected card, the painkiller, BP-medicine
 * words); else his prescriptions, unless it names a medicine by its use ("my sleeping pill", 安眠药), which is not one of
 * his, and is not about taking it together with something (then his medicines are the other party); plus OTHER_SUBSTANCE when it names any other substance (substances.ts otherSubstances) or, in an ask about taking
 * things together, any word that is not one of his medicines (unresolvedInCombination), so the doctor's "both together
 * is fine" about his two BP pills never answers "... together with fish oil / a beer / my cough syrup".
 */
export function askedMedicines(text: string, ctx: Pick<ClassifyContext, "meds" | "medIds">, topics: string[]): string[] {
  const named = namedDrugs(text, ctx);
  const others = otherSubstances(text);
  const prescriptions = ctx.meds.filter((m) => m.origin === "prescription" && m.drug_id).map((m) => m.drug_id!);
  // (an ask about taking a supplement "together" names his medicines as the other party without saying so)
  const set = named.length ? named : others.medicines.length && !topics.includes("combination") ? [] : prescriptions;
  const other = others.medicines.length > 0 || others.foods.length > 0 || (topics.includes("combination") && unresolvedInCombination(text));
  return [...new Set([...set, ...(other ? [OTHER_SUBSTANCE] : [])])].sort();
}

/**
 * An open question from the same story day, for the same person and origin, about the same thing: a shared topic
 * (dose change, stopping, combining) and, when `drugs` is given, the same medicines (questionDrugs of its text with
 * `meds`). Without `drugs` only the topic counts. A question that names another substance (OTHER_SUBSTANCE) is the
 * same only when its words are (`text`): "with fish oil" and "with coffee" are two questions.
 */
export function sameDayQuestion(
  questions: QuestionRow[],
  want: {
    for: "doctor" | "pharmacist";
    origin: QuestionOrigin;
    day: number;
    topics: string[];
    drugs?: string[];
    meds?: MedicationRow[];
    text?: string;
    /**
     * C2 (real-app 4.5, 9.2 item 2): reuse a question made on any day from this one on (the last clinic visit's day), not
     * only today's; default `day`
     */
    sinceDay?: number;
  },
): QuestionRow | null {
  const topics = want.topics.filter((t) => SAME_QUESTION_TOPICS.includes(t));
  if (topics.length === 0) return null;
  const sameDrugs = (q: QuestionRow) => {
    if (!want.drugs) return true;
    const theirs = questionDrugs(q.text, want.meds ?? []);
    if (theirs.includes(OTHER_SUBSTANCE) || want.drugs.includes(OTHER_SUBSTANCE)) {
      return want.text !== undefined && normalizeForCompare(q.text) === normalizeForCompare(want.text);
    }
    return theirs.length === want.drugs.length && theirs.every((d, i) => d === want.drugs![i]);
  };
  return (
    questions.find(
      (q) =>
        q.status === "open" &&
        q.origin === want.origin &&
        q.for === want.for &&
        q.created_day !== null &&
        q.created_day >= (want.sinceDay ?? want.day) &&
        q.created_day <= want.day &&
        // C2: the same topic on the same side of it (an extra tablet is not half a tablet: topics.ts sameFacet), so "已在问题单"
        // always names the question he asked this time
        detectTopics(q.text).some((t) => topics.includes(t) && (want.text === undefined || sameFacet(t, want.text, q.text))) &&
        sameDrugs(q),
    ) ?? null
  );
}

/**
 * C2 (real-app 12: 同一个问题两条 → 重复的合并成一条): an open question about the same thing with no topic of its own, made
 * since his last clinic visit, for an ask with no topic either (「膝盖痛能不能吃布洛芬？」 and the open 「膝盖止痛药还可以吃吗？」):
 * the same medicines, named, or mostly the same words (sameQuestion). Whoever it is for, it is the same question.
 */
export function sameTopiclessQuestion(
  questions: QuestionRow[],
  want: { day: number; sinceDay: number; text: string; drugs: string[]; named: boolean; meds: MedicationRow[] },
): QuestionRow | null {
  if (matchTopicsOf(want.text).length > 0) return null;
  return (
    questions.find(
      (q) =>
        q.status === "open" &&
        q.origin !== "unidentified_medicine" &&
        q.origin !== "pattern" &&
        q.created_day !== null &&
        q.created_day >= want.sinceDay &&
        q.created_day <= want.day &&
        sameQuestion({ text: want.text, topics: [], drugs: want.drugs, named: want.named }, q.text, want.meds),
    ) ?? null
  );
}

/**
 * The questions waiting for a visit at this story moment, as they stand then: the open ones, and the ones the seed records
 * as answered at a visit that has not happened yet (`happened`: line-state.ts visitHappened), shown open with no answer.
 * The seed is the story's end state: q-extra-tablet is answered at the D42 visit, so on D29 the hero question still reuses
 * it and the backstage never sees Dr Lim's D42 words on D29 (the same gating as lib/daily/questions.ts and the brief).
 */
export function waitingAt(questions: QuestionRow[], happened: Set<string>): QuestionRow[] {
  const out: QuestionRow[] = [];
  for (const q of questions) {
    if (q.status === "open") out.push(q);
    else if (q.status === "answered" && q.answer_visit_id && !happened.has(q.answer_visit_id)) {
      out.push({ ...q, status: "open", answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null });
    }
  }
  return out;
}

/**
 * C2 (architecture review 10-10: 再问一遍医生已经回答过的问题 → 直接给医生的回答，不再新建问题; real-status v1: the ibuprofen and
 * the fasting answers were on his list and never quoted). An ask that repeats a question of his a clinician answered at a
 * visit (CandidateSet.answered: the answer is a candidate, said by the story moment), newest visit first:
 *   - the same medicines (questionDrugs of both texts; a question that names another substance only with the same words);
 *   - a shared topic (MATCH_TOPICS) when the ask has one; an ask with no topic ("膝盖痛能不能吃布洛芬？") must name its
 *     medicine (never "can I take it?" alone) and then matches any answered question about that medicine;
 *   - a clinician's words (the candidate carries an attribution): never a recording nobody is named for;
 *   - not a question about a medicine nobody identified (that path has its own fixed sentence).
 * Only for a question Ripple would refer or not be sure about (refuse_route, explain, uncertain), never an injection.
 * Returns the question, the candidate carrying the answer, and the question's topics (the ask shares them).
 */
export function matchAnswered(
  text: string,
  cls: Pick<Classification, "route" | "topics" | "drugs" | "injection">,
  answered: CandidateSet["answered"],
  byId: Map<string, Candidate>,
  ctx: Pick<ClassifyContext, "meds" | "medIds">,
  /** his medicines on a story day (default: the ask's day for every visit) */
  medsAt: (day: number) => MedicationRow[] = () => ctx.meds,
): { question: QuestionRow; candidate: Candidate; topics: string[] } | null {
  if (cls.injection || !(cls.route === "refuse_route" || cls.route === "explain" || cls.route === "uncertain")) return null;
  if (answered.length === 0) return null;
  const askTopics = matchTopicsOf(text, cls.topics);
  const named = namedDrugs(text, ctx).length > 0;
  const askDrugs = matchDrugs(text, ctx.meds, cls.drugs);
  for (const a of answered) {
    const q = a.question;
    if (q.origin === "unidentified_medicine") continue;
    const c = byId.get(a.sourceId);
    if (!c || c.kind !== "visit" || !c.attribution) continue;
    // the question's medicines as they were at the visit that answered it ("together" then meant his prescriptions then)
    if (!sameQuestion({ text, topics: askTopics, drugs: askDrugs, named }, q.text, medsAt(a.visitDay))) continue;
    return { question: q, candidate: c, topics: matchTopicsOf(q.text) };
  }
  return null;
}

/** C2: the symptoms a text names (topics.ts facets of side_effects: swelling, dizzy, headache ...). */
const sideEffectFacets = (text: string): string[] => facetsOf("side_effects", text);

/** C2: the MATCH_TOPICS of a text (and of a classification's topics). */
function matchTopicsOf(text: string, more: string[] = []): string[] {
  return [...new Set([...detectTopics(text), ...more])].filter((t) => MATCH_TOPICS.includes(t));
}

/**
 * C2: the medicines a question is about, for telling two questions apart: questionDrugs, and in a question about taking
 * one medicine together with something unnamed (「膝盖痛吃药房买的止痛药，可以一起吃吗？」) his prescriptions are the other party.
 */
export function matchDrugs(text: string, meds: MedicationRow[], given: string[] = []): string[] {
  // a question about no medicine at all (his blood pressure machine, a reading) is about no medicine, whatever he takes
  const medicineTopics = ["dose_change", "stopping", "combination", "missed", "food", "side_effects", "purpose", "why_take", "label", "grapefruit"];
  if (!given.length && !refersToMedicine(text) && targetDrugs(text, { doctorThresholdSystolic: null, meds }).length === 0 && !detectTopics(text).some((t) => medicineTopics.includes(t))) {
    return mentionsOtherSubstance(text) ? [OTHER_SUBSTANCE] : [];
  }
  const base = questionDrugs(text, meds, given);
  const named = base.filter((d) => d !== OTHER_SUBSTANCE);
  const prescriptions = meds.filter((m) => m.origin === "prescription" && m.drug_id).map((m) => m.drug_id!);
  if (detectTopics(text).includes("combination") && named.length === 1 && !prescriptions.includes(named[0])) {
    return [...new Set([...base, ...prescriptions])].sort();
  }
  return base;
}

/** Characters that carry no meaning of their own in a question (for textOverlap). */
const FUNCTION_CHARS = /[的了吗呢吧啊呀是我你他她它这那个可以能不么什怎样要会就都也还在和与及或吃]/u;

/**
 * C2: how much of two short questions is the same, when neither has a topic or a medicine to go by: the overlap
 * coefficient of their Chinese character pairs (pairs with a function character left out) and their English words of
 * three letters or more. 「家里那个机器是绑手腕的，可以用吗？」 and 「我家的血压机是绑手腕的，能用吗？」 share 绑手 and 手腕: 0.5.
 */
export function textOverlap(a: string, b: string): number {
  const grams = (t: string) => {
    const out = new Set<string>();
    const han = t.replace(/[^\p{Script=Han}]/gu, "");
    for (let i = 0; i < han.length - 1; i++) {
      const g = han.slice(i, i + 2);
      if (!FUNCTION_CHARS.test(g)) out.add(g);
    }
    for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) out.add(w);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / Math.min(ga.size, gb.size);
}

/**
 * C2: is `qText` the same question as the ask? The same medicines (matchDrugs; with another substance in either, the same
 * words); then either a shared topic on the same side of it (topics.ts sameFacet), or neither has a topic and the ask names
 * its medicine or the words mostly agree (textOverlap at least 0.5).
 */
function sameQuestion(ask: { text: string; topics: string[]; drugs: string[]; named: boolean }, qText: string, meds: MedicationRow[]): boolean {
  // C2 (journey 13): what to eat with kidney disease is not what to eat with diabetes, nor any question without a condition
  if (dietCondition(ask.text) !== dietCondition(qText)) return false;
  const qDrugs = matchDrugs(qText, meds);
  if (qDrugs.includes(OTHER_SUBSTANCE) || ask.drugs.includes(OTHER_SUBSTANCE)) {
    if (normalizeForCompare(qText) !== normalizeForCompare(ask.text)) return false;
  } else if (qDrugs.length !== ask.drugs.length || qDrugs.some((d, i) => d !== ask.drugs[i])) {
    return false;
  }
  const qTopics = matchTopicsOf(qText);
  if (ask.topics.length > 0 || qTopics.length > 0) {
    const shared = ask.topics.filter((t) => qTopics.includes(t));
    return shared.length > 0 && shared.some((t) => sameFacet(t, ask.text, qText));
  }
  return ask.named || textOverlap(ask.text, qText) >= 0.5;
}


/**
 * C2 (real-app 4.5, 9.2 item 2): the story day of his last clinic visit that happened by the story moment (not the
 * pharmacy, not a planned follow-up, not a replay copy, not an empty recording: lib/visit/happened.ts), or 0 before any.
 * An open question from that day on, about the same thing, is reused instead of a second one.
 */
async function lastClinicVisitDay(store: Store, sessionId: string, visits: VisitRow[], byMoment: Set<string>): Promise<number> {
  const clinic = visits.filter((v) => byMoment.has(v.id) && v.kind !== "pharmacy");
  const real = await happenedVisits(store, sessionId, clinic);
  return real.reduce((max, v) => Math.max(max, v.day), 0);
}

/**
 * The referral sentence for an ask: the pharmacist's; the doctor's "questions about changing your medicine are for your
 * doctor" when it is about changing his medicine (a dose change, stopping); for any other question that goes to the doctor
 * the plain "no clear answer in his sources, added to the list". Fix round of 10-11: only a live model produces the last
 * case (it sorts a question no rule knows as refuse_route with topic "other", or one of its sentences is stopped under a
 * question about a reading or a side effect), and he then read 「改药的问题要问医生」 under a question that changes nothing.
 */
export function referralFor(cls: Pick<Classification, "questionFor" | "topics">): TemplateId {
  if (cls.questionFor !== "doctor") return "refer_pharmacist";
  return cls.topics.includes("dose_change") || cls.topics.includes("stopping") ? "refer_doctor" : "uncertain_no_source";
}

/** The unrecognised medicine names of a classification (classify.ts signal unknown_name:<name>). */
export function unknownNames(signals: string[]): string[] {
  return signals.filter((s) => s.startsWith("unknown_name:")).map((s) => s.slice("unknown_name:".length)).filter((n) => n.length >= 4);
}

/**
 * Gap 6.4 (10-10): an open question from the same story day about the same medicine nobody could identify, as the dose-change
 * path reuses its question (sameDayQuestion): the same words (normalised), or the same unrecognised name in its text.
 */
export function sameUnknownMedicineQuestion(
  questions: QuestionRow[],
  want: { for: "doctor" | "pharmacist"; day: number; text: string; names: string[] },
): QuestionRow | null {
  const words = normalizeForCompare(want.text);
  const names = want.names.map((n) => n.toLowerCase());
  return (
    questions.find(
      (q) =>
        q.status === "open" &&
        q.origin === "unidentified_medicine" &&
        q.for === want.for &&
        q.created_day === want.day &&
        (normalizeForCompare(q.text) === words || names.some((n) => q.text.toLowerCase().includes(n))),
    ) ?? null
  );
}

/** What the crisis screen did for one answer (safety_event.output.crisisScreen). */
interface CrisisScreenRecord {
  route: string | null;
  reason: string;
  error: string | null;
  /** LlmError code when the screen could not run (budget, timeout, deadline ...): this answer had the rules only */
  errorCode: string | null;
  /** the route it raised from, when it raised one */
  raisedFrom: Route | null;
  /** false when the answer did not wait for it (the model's classification was already a crisis) */
  awaited: boolean;
  /**
   * 10-14: the rule whose route the screen's "emergency" did not raise (rule:extra_dose_taken: one tablet too many with no
   * symptom word is not the emergency route, the owner's decision); `route` still says what the screen answered
   */
  heldBy?: string;
}

/** 10-14: the rules' reason for "he says he took one tablet too many, no symptom" (classify.ts extraDose). */
const EXTRA_DOSE_TAKEN = "rule:extra_dose_taken";
/** 10-14: the rules' reason for a question about Ripple itself (classify.ts aboutRipple; the fixed about_ripple sentence). */
const ABOUT_RIPPLE = "rule:about_ripple";
/** 10-14: the rules' reason for what X is for, X none of his medicines (classify.ts noMedicineSubject). */
const NOT_A_MEDICINE = "rule:not_a_medicine";
/**
 * 10-14: the emergency signals that are the reading alone (above the doctor's own number, perhaps asked as his medicine's
 * doing). With only these the doctor's warning line leads and the 995 template follows; any other signal keeps 995 first.
 */
const READING_ONLY_SIGNALS = ["above_doctor_threshold", "medicine_cause"];

function fromCandidate(c: Candidate, speechAct: Sentence["speechAct"] = "restate"): Sentence {
  return { speechAct, sourceId: c.sourceId, span: c.span, slots: {}, en: c.restatement ? c.restatement.en : c.span, attribution: c.attribution };
}

export async function ask(input: AskInput, deps: AskDeps): Promise<AskResult> {
  const used: { guard: AskGuard | null } = { guard: null };
  try {
    return await answer(input, deps, used);
  } finally {
    // what this ask used (model tokens, model spend) goes to the person's counters, also when it ended in an error
    // (cost-guard.ts settle: written once, never throws, and the answer does not wait for it)
    void used.guard?.settle?.();
  }
}

async function answer(input: AskInput, deps: AskDeps, used: { guard: AskGuard | null }): Promise<AskResult> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  // one read of each thing for the whole answer, side by side (read-once.ts; C2 latency pass)
  const store = readOnce(deps.store);
  const pub: Publisher = deps.publish ?? ((sid, type, say, data) => void busPublish(sid, type, say, data));
  /** SSE: the answer's progress (AskDeps.stream); a sink that throws never costs him the answer */
  const sink = deps.stream;
  const emit = (e: AskStreamEvent) => {
    if (!sink) return;
    try {
      sink(e);
    } catch {
      // the reader has gone: the answer is still made, kept and recorded
    }
  };

  // one time budget for every model call of this answer (see the header)
  const deadlineMs = deps.deadlineMs ?? askDeadlineMs();
  const startedAt = performance.now();
  const answerDeadline = AbortSignal.timeout(deadlineMs);
  const generationMs = Math.max(1, deadlineMs - layer3ReserveMs(deadlineMs));
  const generationDeadline = AbortSignal.timeout(generationMs);
  /**
   * The deadline of a model call that starts now (classification, the crisis screen, generation): the generation budget;
   * a call that starts with less than lateCallMs of it left (the store was slow) gets lateCallMs of its own, and stops at
   * the answer's total deadline whatever it was given.
   */
  const modelSignal = (): AbortSignal => {
    const late = lateCallMs(deadlineMs);
    if (generationMs - (performance.now() - startedAt) >= late) return generationDeadline;
    return AbortSignal.any([answerDeadline, AbortSignal.timeout(Math.max(1, late))]);
  };

  const sid = input.sessionId;
  if (deps.session?.id === sid) primeRead(store, "getSession", [sid], deps.session);
  const session = await store.getSession(sid);
  if (!session) throw new StoreError("session_not_found", `No session ${sid}`);
  // the person's counters (C2 round 2: in the store, per person, his own hour and day; cost-guard.ts)
  const guard: AskGuard | null = deps.costGuard === undefined ? storeCostGuard(usageStore(), session) : deps.costGuard;
  used.guard = guard;
  prefetchAsk(store, session, { text: input.text, locale: input.locale, storyDay: input.storyDay });
  const day = input.storyDay ?? session.story_day;
  const aiAllowed = deps.aiAllowed !== false;
  const text = stripInvisible(input.text).trim();
  const inputLang = detectLang(text);
  const locale: Locale = input.locale ?? inputLang;
  const who = input.role === "family" ? "Wei Ling" : input.role === "judge" ? "A judge" : "Mr Tan";

  pub(sid, "ask.received", `${who} asked: "${short(text)}"`, { text, locale, day, role: input.role ?? "patient" });

  // ---- 1. classify (rules first)
  const [visitsAll, medsAll] = await Promise.all([store.listVisits(sid), store.listMeds(sid)]);
  // the story moment (gap 7.5): the session's clock time on its own story day; another day asked for counts as a whole day.
  // A visit counts once it has happened (line-state.ts visitHappened): R2 is not the warning line before Dr Lim says it.
  const moment: StoryMoment = { day, time: input.storyDay === undefined || input.storyDay === session.story_day ? session.story_time : null };
  const happened = await happenedVisitIds(store, sid, visitsAll, moment);
  // the doctor's warning line (C2: lib/visit/doctor-numbers.ts, track F; the same line the blood pressure page relays,
  // threshold.ts): the latest one said at a visit that happened by the story moment, reviewed or not (labelled by its state)
  // (threshold.ts rule A: the one line for every place where safety depends on it)
  const warn = input.noDoctorTarget ? null : await warningLineFor(store, sid, moment);
  // his medicines at the story moment (C2 round 2, the one rule: lib/meds/on-day.ts): a medicine prescribed at a visit is
  // his once that visit happened, so an ask before the day's visit is not about what that visit prescribes
  const medLines = await prescribingLines(store, sid, medsAll, visitsAll, day);
  const ctx: ClassifyContext = {
    doctorThresholdSystolic: warn?.systolic ?? null,
    meds: medsOnDayAt(medsAll, visitsAll, moment, medLines),
    medIds: input.medIds,
    asrLowConfidence: input.asrLowConfidence,
  };
  let llmTokens = 0;
  let llmCalls = 0;
  let crisisScreen: CrisisScreenRecord | null = null;
  const ruled = classifyRules(text, ctx);
  // Cost guard (fix round 2: the hourly limit used to come before any crisis check but the rules', so "I have written
  // letters to my children and arranged everything." over the limit got HTTP 429 and no 995). Over the limit, a
  // statement and any input near crisis words (crisisCue) are still answered, by the rules alone with no model call
  // (offline composer, no checker), the latter with the fixed safety line; only other questions are refused (429).
  // 10-14: one tablet too many (rule:extra_dose_taken) was an emergency, never limited; it is fixed lines with no model
  // call, so it is still answered over the limit.
  let costLimited: CostLimitError | null = null;
  try {
    await guard?.admit(sid, { exempt: !!ruled && CRISIS_ROUTES.includes(ruled.route) });
  } catch (e) {
    if (!(e instanceof CostLimitError) || (!(ruled?.route === "log_only" || crisisCue(text)) && ruled?.reason !== EXTRA_DOSE_TAKEN)) throw e;
    costLimited = e;
    console.warn(`[safety] cost guard: ${e.limit} reached; answering by the rules alone`);
  }
  // SSE: admitted (a 429 above is still a plain answer); from here on the answer is told as it is made
  emit({ type: "stage", stage: "reading", locale });
  // The per-person model spend (C2 round 2; real-app 3.5 「DeepSeek 花费，每人每天 US$0.20：不发请求，安全层照旧把关」): once his
  // day's US$ are used up no request is sent for him. Nothing is refused: the answer is made the way it is made offline
  // (the rules, the deterministic composer, no checker, no crisis screen, the fixed safety line where his words come near
  // a crisis), until his next midnight.
  const spendCapped = !costLimited && aiAllowed && !(ruled && CRISIS_ROUTES.includes(ruled.route)) && !!(await guard?.spendCapped?.());
  if (spendCapped) console.warn("[safety] per-person model spend cap reached; answering by the rules alone");
  /** A live client whose paid calls are added to his spend (the mock costs nothing and is left as it is). */
  const paid = <T extends LlmClient | null>(client: T): T => {
    const g = guard;
    if (!client || !g?.addSpend || client.provider === "mock") return client;
    const inner: LlmClient = client;
    const counted: LlmClient = {
      provider: inner.provider,
      model: inner.model,
      chat: async (o) => {
        const res = await inner.chat(o);
        g.addSpend!(res.usd);
        return res;
      },
    };
    return counted as T;
  };
  // no consent to AI processing (C2): the offline composer is the rules' own source picker, and nothing reaches a model
  const llm: LlmClient = costLimited || !aiAllowed || spendCapped ? createMockLlm() : paid(deps.llm ?? createMainLlm());
  const checkerRes = costLimited
    ? { client: null, reason: "cost guard limit reached: rules only, no checker", independence: null }
    : !aiAllowed
      ? { client: null, reason: "no consent to AI processing: rules only, no checker", independence: null }
      : spendCapped
        ? { client: null, reason: "per-person model spend cap reached: rules only, no checker", independence: null }
        : deps.checker !== undefined
          ? { client: paid(deps.checker), reason: deps.checkerReason ?? (deps.checker ? null : "no checker configured"), independence: deps.checkerIndependence ?? null }
          : (() => {
              const made = createChecker();
              return { ...made, client: paid(made.client) };
            })();
  // the crisis screen starts now, alongside classification and generation (see the header)
  // (not for chit-chat either: cant_help calls no model, and its rule already found no crisis word: classify.ts; nor for a
  // question about Ripple itself, 10-14, whose rule found no medicine, symptom or crisis word)
  const screenP: Promise<CrisisScreen> | null =
    llm.provider !== "mock" && !(ruled && (SCREEN_SKIP.includes(ruled.route) || ruled.route === "cant_help" || ruled.reason === ABOUT_RIPPLE))
      ? screenCrisisWithModel(text, llm, { signal: modelSignal() })
      : null;
  /** The candidates the list rule built, kept for step 2 when its route stands (the same route and topics). */
  const listed: { cands: CandidateSet | null } = { cands: null };
  /**
   * His own question list, looked at when no rule knows the words and before any model is asked (the header: a fact in
   * the store is not the model's to decide). A question of his a clinician answered at a visit, asked again (matchAnswered:
   * the same medicines, a shared topic on the same side of it, or the same words): explain, led by that answer. A question
   * still waiting on his list, in the same words or about the same thing (sameTopiclessQuestion): uncertain, and that
   * question is reused. null: neither, the model sorts it.
   */
  const ownListRule = async (): Promise<Classification | null> => {
    const topics = detectTopics(text);
    const base = { topics, drugs: targetDrugs(text, ctx), reading: findReading(text), injection: false, conflict: false };
    const set = await buildCandidates(store, sid, { day, time: moment.time, route: "explain", topics, noDoctorTarget: input.noDoctorTarget, scope: session });
    listed.cands = set;
    const answered = matchAnswered(text, { route: "explain", ...base }, set.answered, set.byId, ctx, (d) => medsOnDay(medsAll, visitsAll, d, medLines));
    if (answered) {
      const by = answeredBy(answered.candidate.attribution);
      return { ...base, route: "explain", reason: "rule:answered_before", signals: ["answered_before"], questionFor: by === "doctor" ? "doctor" : "pharmacist" };
    }
    const waiting = waitingAt(await store.listQuestions(sid), happened).filter((q) => q.status === "open" && !q.merged_into && q.origin !== "unidentified_medicine" && q.origin !== "pattern");
    const words = normalizeForCompare(text);
    const open =
      waiting.find((q) => normalizeForCompare(q.text) === words) ??
      sameTopiclessQuestion(waiting, {
        day,
        sinceDay: await lastClinicVisitDay(store, sid, visitsAll, happened),
        text,
        drugs: matchDrugs(text, ctx.meds, base.drugs),
        named: namedDrugs(text, ctx).length > 0,
        meds: ctx.meds,
      });
    // (the same words he once set aside count too: step 7 puts that question back on the list instead of adding a second)
    const asked = open ?? (await store.listQuestions(sid)).find((q) => q.status === "skipped" && !q.merged_into && q.origin !== "unidentified_medicine" && normalizeForCompare(q.text) === words);
    if (asked) return { ...base, route: "uncertain", reason: "rule:asked_before", signals: ["asked_before"], questionFor: asked.for };
    return null;
  };
  const fromList = ruled ? null : await ownListRule();
  let cls: Classification;
  if (ruled) {
    cls = ruled;
  } else if (fromList) {
    cls = fromList;
  } else if (!aiAllowed) {
    // no rule knows it and no model may: not sure, for the doctor (no_ai_consent says why)
    cls = {
      route: "uncertain",
      reason: "rule:no_ai_consent",
      signals: ["no_ai_consent"],
      topics: detectTopics(text),
      drugs: targetDrugs(text, ctx),
      reading: findReading(text),
      questionFor: "doctor",
      injection: false,
      conflict: false,
    };
  } else {
    const res = await classifyWithModel(text, ctx, llm, { signal: modelSignal() });
    cls = res.classification;
    // "logistics" is the rules' route to give: a recording, a refill or an appointment word in his sentence (classifyRules),
    // and such a sentence never comes this far. A question no rule knows that a model sorts as logistics is treated as not
    // sure (fix round of 10-11: the real model sorted a question about his blood pressure machine that way). As logistics it
    // got whatever line the model chose under the "appointment" label, or "not in your records yet", with no referral and
    // nothing on the doctor's list; as not sure it gets his sources by topic, "I won't guess", and the question is kept.
    // The offline mock never answers "logistics" here, so this is also what every offline test has shown.
    if (cls.route === "logistics") cls = { ...cls, route: "uncertain", signals: [...cls.signals, "model_route:logistics"] };
    // owner 10-15 (the rules were too rigid): a request the model sorts as refuse_route that is not about changing, stopping
    // or combining his medicines ("睡不好怎么办？" asks for a recommendation) is an ordinary question: not sure from his sources,
    // so Ripple's own answer (general.ts) answers it. Only those three topics stay refusals (the never-cross line)
    if (cls.route === "refuse_route" && !cls.topics.some((t) => REFUSED_TOPICS.includes(t))) {
      cls = { ...cls, route: "uncertain", questionFor: "doctor", signals: [...cls.signals, "model_route:refuse_route"] };
    }
    llmTokens += res.tokens;
    llmCalls++;
    guard?.addTokens(sid, res.tokens);
  }

  /** Wait for the screen and apply it. True when it raised the route to a crisis. */
  const settleScreen = async (): Promise<boolean> => {
    if (!screenP || crisisScreen) return false;
    if (SCREEN_SKIP.includes(cls.route)) {
      // the model's own classification is already a crisis: 995 and the helplines do not wait for the screen
      crisisScreen = { route: null, reason: "not awaited: already a crisis", error: null, errorCode: null, raisedFrom: null, awaited: false };
      // the call was made (and is billed): it counts as a call here; its tokens reach the cost guard when it ends
      llmCalls++;
      void screenP.then((sc) => {
        void guard?.addTokens(sid, sc.tokens);
        void guard?.settle?.();
      });
      return false;
    }
    const screen = await screenP;
    llmTokens += screen.tokens;
    llmCalls++;
    guard?.addTokens(sid, screen.tokens);
    crisisScreen = { route: screen.route, reason: screen.reason, error: screen.error ?? null, errorCode: screen.errorCode ?? null, raisedFrom: null, awaited: true };
    if (screen.errorCode) console.warn(`[safety] crisis screen unavailable (${screen.errorCode}); rules only for this answer`);
    if (!screen.route) return false;
    // 10-14 (the owner's decision): one tablet too many that he says he took, with no symptom or danger word, is not the
    // emergency route. The screen's prompt calls any tablets already taken an emergency, so its "emergency" would undo the
    // rule every time; it is recorded and not applied. Its "self_harm" still raises the route (see the header)
    if (screen.route === "emergency" && cls.reason === EXTRA_DOSE_TAKEN) {
      crisisScreen.heldBy = cls.reason;
      return false;
    }
    crisisScreen.raisedFrom = cls.route;
    // someone else's crisis: "if they might hurt themselves"; an emergency of someone else gets no R2 line (fix round 3)
    const someoneElse = (screen.route === "self_harm" ? isThirdPersonReport(text) : aboutSomeoneElse(text)) ? ["third_person"] : [];
    cls = { ...cls, route: screen.route, reason: screen.reason, signals: ["model_crisis_screen", ...someoneElse, ...cls.signals], questionFor: "doctor", injection: false, conflict: false };
    return true;
  };
  /**
   * Why no crisis screen vouched for this answer, or null when one did: "offline" (mock: the rules are the only
   * screen), the screen's error code (budget, ledger_unavailable, timeout, deadline ...), or "invalid_answer" (the
   * model answered something that is not emergency / self_harm / none). Crisis words then route by the rules alone
   * (applyRulesOnlyCue), and it is the reason recorded with the fixed safety line of an answer near crisis words. 10-14: a
   * gap alone no longer puts the safety line under a note.
   */
  const screenGap = (): string | null => {
    if (!crisisScreen) return costLimited ? "rate_limited" : !aiAllowed ? "no_ai_consent" : spendCapped ? "spend_cap" : llm.provider === "mock" ? "offline" : "not_run";
    if (crisisScreen.errorCode) return crisisScreen.errorCode;
    if (crisisScreen.route === null && crisisScreen.reason.endsWith(":invalid")) return "invalid_answer";
    return null;
  };
  /**
   * Fix round 3 (the B2 red team: with no crisis screen, "Since lunch my right side is very heavy, can I still take my
   * evening pill?" and five more questions got no 995 at all, 62 more phrasings only the safety line under "Noted."). When
   * no crisis screen vouched for this answer (screenGap), the rules are the only screen: an emergency described in words no
   * rule knows (classify.ts emergencyCue) goes to the 995 template whatever the sentence form, and a statement with
   * self-harm words (selfHarmCue) to the helplines instead of "Noted.". A question with self-harm words keeps its answer and
   * gets the safety line with the helplines (below). Never lowers a route. True when it raised the route.
   */
  let rulesOnlyCue: { from: Route; kinds: string[]; gap: string } | null = null;
  const applyRulesOnlyCue = (): boolean => {
    if (SCREEN_SKIP.includes(cls.route)) return false;
    const gap = screenGap();
    if (!gap) return false;
    const kinds = emergencyCue(text);
    const selfHarmNote = cls.route === "log_only" && selfHarmCue(text);
    if (!selfHarmNote && kinds.length === 0) return false;
    rulesOnlyCue = { from: cls.route, kinds, gap };
    if (selfHarmNote) {
      cls = { ...cls, route: "self_harm", reason: "rule:self_harm_cue", signals: ["self_harm_cue", ...(isThirdPersonReport(text) ? ["third_person"] : []), ...cls.signals], questionFor: "doctor", injection: false, conflict: false };
    } else {
      const someoneElse = aboutSomeoneElse(text) ? ["third_person"] : [];
      cls = { ...cls, route: "emergency", reason: "rule:emergency_cue", signals: ["emergency_cue", ...kinds, ...someoneElse, ...cls.signals], questionFor: "doctor", injection: false, conflict: false };
    }
    console.warn(`[safety] no crisis screen (${gap}); crisis words raised ${rulesOnlyCue.from} to ${cls.route}`);
    return true;
  };
  let safetyLine: { reason: string; cue?: boolean; helplines?: boolean } | null = null;
  const publishRoute = () => {
    const note = costLimited
      ? `; cost guard ${costLimited.limit} reached, rules only`
      : spendCapped
        ? "; per-person model spend cap reached, rules only"
        : crisisScreen?.errorCode
        ? `; crisis screen unavailable (${crisisScreen.errorCode}), rules only`
        : crisisScreen?.raisedFrom
          ? `; raised from ${crisisScreen.raisedFrom} by the crisis screen`
          : "";
    const cueNote = rulesOnlyCue ? `; raised from ${rulesOnlyCue.from} by crisis words, no crisis screen (${rulesOnlyCue.gap})` : "";
    pub(sid, "ask.route", `Route: ${cls.route} (${cls.reason}${note}${cueNote})`, {
      route: cls.route,
      reason: `${cls.reason}${note}${cueNote}`,
      signals: cls.signals,
      topics: cls.topics,
      drugs: cls.drugs,
      crisisScreen,
      rulesOnlyCue,
    });
  };

  // no crisis screen at all (offline mock, the question limit): the rules are the only screen from the start
  if (!screenP) applyRulesOnlyCue();
  // an answer with a model call of its own composes alongside the screen; any other waits for the screen first
  // (a statement's note is written only when it is not a crisis; one tablet too many and Ripple's words about itself are fixed
  // lines, no generator)
  const generates =
    cls.route === "explain" ||
    cls.route === "uncertain" ||
    (cls.route === "refuse_route" && !cls.injection && cls.reason !== EXTRA_DOSE_TAKEN) ||
    (cls.route === "logistics" && !cls.topics.includes("recording") && !cls.topics.includes("refill") && cls.reason !== ABOUT_RIPPLE);
  if (!generates) {
    await settleScreen();
    applyRulesOnlyCue();
    publishRoute();
  }

  // ---- 2. candidates
  // (the list rule's set is this very set when its route stood: explain, the same topics)
  const cands: CandidateSet =
    listed.cands && cls.reason === "rule:answered_before"
      ? listed.cands
      : await buildCandidates(store, sid, { day, time: moment.time, route: cls.route, topics: cls.topics, noDoctorTarget: input.noDoctorTarget, scope: session });
  const byId = cands.byId;
  const prescriptionDrugs = cands.meds.filter((m) => m.origin === "prescription" && m.drug_id).map((m) => m.drug_id!);
  // owner 10-15: Ripple's own answer (general.ts), started now, alongside composing and the crisis screen, for a question
  // that is not a crisis, not an unknown medicine and not a request to change, stop or combine his medicines. Never with
  // no model allowed for him (no consent, the spend cap, the question limit); offline the mock gives its canned answer.
  // Whether it is shown is decided once the answer is composed (below)
  const offlineWhy = costLimited ? "rate_limited" : !aiAllowed ? "no_consent" : spendCapped ? "spend_cap" : undefined;
  const generalRoute = (r: Route) => r === "explain" || (r === "uncertain" && !cls.conflict) || (r === "refuse_route" && cls.signals.includes("special_diet"));
  /**
   * SSE: the words of Ripple's own answer as the model writes them. Kept here until the answer may take them (released
   * below, once the route is final and no crisis), then sent as they come; `sent` once any went out (a retraction takes
   * them back if the answer is not shown), `closed` once the answer is decided.
   */
  const generalWords = { buffer: "", released: false, sent: false, closed: false };
  const onGeneralWords = sink
    ? (words: string) => {
        if (generalWords.closed) return;
        if (!generalWords.released) {
          generalWords.buffer += words;
          return;
        }
        generalWords.sent = true;
        emit({ type: "delta", text: words });
      }
    : undefined;
  const generalP: Promise<GeneralOutcome> | null =
    !offlineWhy && !cls.injection && generalRoute(cls.route)
      ? writeGeneral({
          locale,
          question: text,
          medicines: ctx.meds.map((m) => medName(m)),
          candidates: cands.list,
          topics: cls.topics,
          llm,
          signal: answerDeadline,
          ...(onGeneralWords ? { onWords: onGeneralWords } : {}),
        })
      : null;
  const drugs = cls.drugs.length ? cls.drugs : prescriptionDrugs;
  // owner 10-16: a dose question about his blood pressure that names no medicine (「今天血压一百五十二、九十六，我能不能多
  // 吃一粒？」) relays the label of his blood-pressure medicine only, not every label he has; anything else keeps `drugs`
  const bpDrugs = drugs.filter((d) => BP_DRUGS.includes(d));
  const labelDrugs = !cls.drugs.length && bpDrugs.length && ABOUT_BP.test(text) ? bpDrugs : drugs;

  const tpl = (id: TemplateId, referralId?: string): Sentence => {
    const t = TEMPLATES[id];
    let cand: Candidate | null = referralId ? referralCandidate(referralId) : templateCandidate(t);
    if (!cand) cand = templateCandidate(t);
    if (!byId.has(cand.sourceId)) byId.set(cand.sourceId, cand);
    return { speechAct: t.speechAct, sourceId: cand.sourceId, span: cand.span, slots: {}, en: t.en, zh: t.zh, origin: "template", templateId: t.id, cite: cand.cite };
  };
  /**
   * The fixed safety line (995 / A&E), and when the input comes near self-harm words (classify.ts selfHarmCue) the
   * helplines after it (fix round 2: 87 fresh phrasings got 995 through this line but no helpline offline).
   */
  const pushSafetyTail = (line: { reason: string; cue?: boolean; helplines?: boolean }) => {
    tail.push(tpl("safety_line", TEMPLATES.safety_line.referralId));
    if (!selfHarmCue(text)) return;
    line.helplines = true;
    for (const id of selfHarmTemplateIds(locale).slice(1)) tail.push(tpl(id, TEMPLATES[id].referralId));
  };
  /**
   * 10-14 (the owner's decision): his words kept for his doctor, once per ask: his note, word for word, marked as a sign
   * (lib/daily/signals.ts signalReply), and the sentence that says so with its date and time (templates.ts
   * SIGNAL_RECORDED). The sentence is a line of his own record: a "log" source whose words are exactly the filled sentence
   * in both languages, so it passes the three checks as itself; its templateId makes the screen draw it as Ripple's line.
   * null when the note could not be written: the answer is then the fixed 995 sentence as before.
   */
  let signalNote: NoteRow | null = null;
  const keepSignal = async (family: SignalFamily): Promise<Sentence | null> => {
    if (!signalNote) {
      try {
        signalNote = await store.addNote(sid, { day, text, source: "typed", lang: inputLang, app_reply: signalReply(family) });
      } catch (e) {
        console.error("[safety] his words could not be kept for his doctor; the fixed 995 sentence as before:", (e as Error).message);
        return null;
      }
      pub(sid, "note.logged", `Kept for the doctor, Day ${day}: "${short(text)}"`, { note: signalNote, signal: family });
    }
    // his own clock: an account's is the server's in his time zone, the demo's the story's
    const when = signalMoment(session, signalNote, moment.time);
    const en = signalRecordedText("en", signalMomentWords("en", when));
    const zh = signalRecordedText("zh-Hans", signalMomentWords("zh-Hans", when));
    const c: Candidate = { sourceId: `signal:${signalNote.id}`, kind: "log", span: en, spanZh: zh, topics: ["signal"], cite: { day, date: when.date } };
    byId.set(c.sourceId, c);
    return { speechAct: "logistics", sourceId: c.sourceId, span: en, slots: {}, en, zh, templateId: SIGNAL_RECORDED.id, cite: c.cite };
  };

  // ---- 3. compose
  let route: Route = cls.route;
  let routeChangedFrom: Route | undefined;
  let content: Sentence[] = [];
  let tail: Sentence[] = [];
  let question: { for: "doctor" | "pharmacist"; origin: QuestionOrigin } | null = null;
  let generationError: string | undefined;
  let rejected: unknown[] = [];
  let refusedRequest: AskResult["refusedRequest"];
  /** C2: the clinician's recorded answer this answer leads with (a question of his asked again), and its topics */
  let answeredBefore: NonNullable<AskResult["answeredBefore"]> | null = null;
  /** C2: the clinician's recorded answer the answer leads with, and the template that goes with it (taken back if it is blocked) */
  let ledBy: { sourceId: string; templateId: TemplateId } | null = null;
  let matchedTopics: string[] = [];
  /**
   * What was asked, for the layer-1 relevance rule: a spoken line about other medicines, or an answer to another question
   * of his, is never shown as this answer; a label or leaflet of another medicine neither (verify.ts relevanceReasons,
   * askedMedicines above). An ask that repeats an answered question of his shares that question's topics (C2).
   */
  const askScopeFor = () => ({
    drugs: askedMedicines(text, ctx, cls.topics),
    topics: [...new Set([...cls.topics, ...matchedTopics])],
    namedMedicine: namedDrugs(text, ctx).length > 0 || refersToMedicine(text) || otherSubstances(text).medicines.length > 0,
    text,
  });

  /** The model's generation failed and the offline composer composed this answer instead (safety_event.output.composedBy). */
  let composedByRules = false;
  const runGenerator = async (topics: string[]) => {
    if (topics.length === 0) return [] as Sentence[];
    const asked = { route, locale, input: text, topics, drugs, candidates: cands.list };
    const out = await generateSentences(llm, { ...asked, signal: modelSignal() });
    llmTokens += out.tokens;
    llmCalls++;
    guard?.addTokens(sid, out.tokens);
    generationError = out.error;
    rejected = out.rejected;
    if (!out.error || llm.provider === "mock") return out.sentences;
    // The model did not compose (the deadline, an outage, a reply that is not the expected JSON). The answer is still made
    // from his sources: the offline composer picks them by the topic table, each word for word, as it does for every
    // answer made without a model (no consent, the spend cap, the question limit). The checks below run on what it picked.
    const byRules = await generateSentences(createMockLlm(), asked);
    composedByRules = true;
    rejected = [...out.rejected, ...byRules.rejected];
    console.warn(`[safety] generation failed (${out.error}); the offline composer picked the sources for this answer`);
    return byRules.sentences;
  };

  /** The answer for cls.route (run again from the start when the crisis screen raises the route). */
  const compose = async () => {
    route = cls.route;
    routeChangedFrom = undefined;
    content = [];
    tail = [];
    question = null;
    generationError = undefined;
    composedByRules = false;
    rejected = [];
    refusedRequest = undefined;
    safetyLine = null;
    answeredBefore = null;
    ledBy = null;
    // C2: a question of his that the doctor (or pharmacist) already answered, asked again: their answer comes first
    // (10-14: not for one tablet too many. That is something that happened, for his doctor to hear: never "answered
    // before", always on the list. Nor for what X is for, X none of his medicines: matchAnswered would compare his
    // prescriptions, and the doctor's answer about his tablet is no answer to 「验血是做什么的？」)
    const match =
      cls.reason === EXTRA_DOSE_TAKEN || cls.reason === NOT_A_MEDICINE ? null : matchAnswered(text, cls, cands.answered, byId, ctx, (d) => medsOnDay(medsAll, visitsAll, d, medLines));
    matchedTopics = match && (route === "refuse_route" || route === "explain" || route === "uncertain") ? match.topics : [];
    const answeredTpl = (by: Attribution | undefined): TemplateId => (by === "pharmacist" || by === "dispenser" ? "answered_before_pharmacist" : "answered_before_doctor");
    const putFirst = (s: Sentence) => {
      content = [s, ...content.filter((c) => c.sourceId !== s.sourceId)];
    };
    /**
     * A question of his the clinician already answered, asked again: their recorded words lead the answer. Settled ("No,
     * please don't take an extra tablet on your own."): "answered before" and no new question (architecture review 10-10).
     * Put off to the next visit ("Which one? Bring it next time and show me."): "these are the doctor's own words" and the
     * question stays on the list for that visit. Either way no template says nothing answers it.
     */
    const leadWithAnswer = (m: NonNullable<typeof match>) => {
      const by = m.candidate.attribution;
      putFirst(fromCandidate(m.candidate));
      const deferred = defersToNextVisit(m.candidate.span);
      const said: TemplateId = deferred ? (by === "pharmacist" || by === "dispenser" ? "said_and_added_pharmacist" : "said_and_added_doctor") : answeredTpl(by);
      tail = [tpl(said), ...tail.filter((t) => !NOT_ANSWERED_TEMPLATES.includes(t.templateId ?? "") && t.templateId !== "no_ai_consent")];
      ledBy = { sourceId: m.candidate.sourceId, templateId: said };
      if (refusedRequest) refusedRequest = { ...refusedRequest, replacedBy: said };
      if (deferred) {
        question ??= { for: cls.questionFor, origin: "refused_question" };
      } else {
        const date = m.candidate.cite?.date;
        answeredBefore = { questionId: m.question.id, sourceId: m.candidate.sourceId, by: answeredBy(by), ...(date ? { date } : {}) };
        question = null;
      }
    };
    switch (route) {
      case "self_harm":
        content = selfHarmTemplateIds(locale, cls.signals.includes("third_person")).map((id) => tpl(id, TEMPLATES[id].referralId));
        break;
      case "emergency": {
        // an overdose: his own gets "If you took more ..." (B1-12); a child who swallowed his tablets "Call 995 now" with the
        // B1-12 row; another adult's (a family report, fix round 3) "If they took more ..., get them medical help"
        const someoneElse = cls.signals.includes("third_person");
        // 10-14 (the owner's decision: 「胸口痛就必须打 995」 was too absolute): his own chest pain, stroke sign or reading
        // above his doctor's line, and nothing that says it is happening badly now (classify.ts signalFamily), is kept for his
        // doctor with its date and time, his doctor's warning line is quoted, and 995 is for when it gets bad
        // (templates.ts SIGNAL_995): a symptom: kept, the doctor's line, 995 if ...; a reading alone: the doctor's line
        // first (as on the blood pressure page), kept, 995 if very unwell. No question: it is something to tell the doctor.
        // Everything else, and a sign whose note could not be written, keeps the fixed 995 sentence as before
        const family = cls.signals.includes("overdose") ? null : signalFamily(cls.signals, text);
        const kept = family ? await keepSignal(family) : null;
        if (family && kept) {
          content = [kept];
          if (warn && clinicianAttribution(warn.speaker)) {
            const w = warningLine(session, warn, locale);
            byId.set(w.candidate.sourceId, w.candidate);
            if (family === "reading") content.unshift(w.sentence);
            else content.push(w.sentence);
          }
          const conditional = SIGNAL_995[family];
          content.push(tpl(conditional, TEMPLATES[conditional].referralId));
        } else {
          content = [
            !cls.signals.includes("overdose")
              ? tpl("emergency_995", emergencyReferralFor(cls.signals))
              : !someoneElse
                ? tpl("emergency_overdose", "B1-12")
                : cls.signals.includes("child")
                  ? tpl("emergency_995", "B1-12")
                  : tpl("emergency_overdose_other", "B1-12"),
          ];
        }
        // his doctor's warning line (R2, or the latest one his visits gave: lib/visit/doctor-numbers.ts, the line the blood
        // pressure page relays too) is about his own symptoms: not under someone else's emergency (fix round 3)
        if (!kept && warn && clinicianAttribution(warn.speaker) && !someoneElse && cls.signals.some((sg) => R2_SYMPTOM_SIGNALS.includes(sg))) {
          const w = warningLine(session, warn, locale);
          byId.set(w.candidate.sourceId, w.candidate);
          // 10-14 (the owner's decision): a reading above the doctor's own number and nothing else (no chest pain, no stroke
          // sign, no other emergency signal): his doctor's words and their recording come first, the 995 template after
          // them (the blood pressure page shows the same order: threshold.ts). Every other emergency keeps 995 first
          const readingAlone = cls.signals.includes("above_doctor_threshold") && cls.signals.every((sg) => READING_ONLY_SIGNALS.includes(sg));
          if (readingAlone) content.unshift(w.sentence);
          else content.push(w.sentence);
        }
        // C2 (the 10-10 decision on 「降压药会不会引起胸口痛」): asked as something his medicine might cause, 995 first, then
        // the leaflet's own side-effect line for the medicines asked about
        if (cls.signals.includes("medicine_cause") && !someoneElse) {
          const asked = askedMedicines(text, ctx, cls.topics);
          for (const c of cands.list) {
            if (c.kind === "patient_text" && c.topics?.includes("side_effects") && (c.drugs ?? []).some((d) => asked.includes(d))) content.push(fromCandidate(c));
          }
        }
        break;
      }
      case "unknown_med": {
        const u = tpl("unknown_med");
        u.zh = `${UNKNOWN_MED_SENTENCE}\n${TEMPLATES.unknown_med.zh}`; // the zh-Hans UI shows the fixed English line, then Mandarin
        content = [u];
        question = { for: "pharmacist", origin: "unidentified_medicine" };
        break;
      }
      case "log_only": {
        const symptom = cls.signals.includes("symptom_note");
        // the check-in question only while today's dose has no answer (never a reason for how he feels)
        const answered = symptom ? null : await todaysDoseAnswered(store, sid, day, ctx.meds);
        const checkIn = answered === false;
        const note = await store.addNote(sid, {
          day,
          text,
          source: "typed",
          lang: inputLang,
          app_reply: symptom ? "logged only" : checkIn ? "logged; asked whether today's tablet was taken" : "logged only",
        });
        pub(sid, "note.logged", `Noted for Day ${day}: "${short(text)}"`, { note });
        content = [tpl("noted")];
        if (checkIn) content.push(tpl("check_in_dose"));
        // 10-14 (the owner's decision): nothing else under a plain note (「头有点晕」, 「吃多了」). The fixed safety line used
        // to follow every note no crisis screen had looked at (10-09 wave B); now a note gets it only when its own words
        // carry a crisis cue word, by the same rule as every other answer (after compose, below)
        break;
      }
      case "cant_help":
        // C2 track S (routed from track K's chat): chit-chat Ripple has nothing for. The fixed sentence, no model call, no
        // question, nothing saved (the screen offers 「记下来」, which saves his words as a note: POST /api/notes)
        content = [tpl("cant_help")];
        break;
      case "logistics": {
        if (cls.reason === ABOUT_RIPPLE) {
          // 10-14 (the coordinator's follow-up): a question about Ripple itself: the fixed sentence, nothing else
          content = [tpl("about_ripple")];
        } else if (cls.topics.includes("recording")) {
          if (session.kind === "account") {
            // C2 round 2 (real-app 3.10, 6.16): an account has care links, each with its own switches; the demo's built-in
            // member row does not exist here (it always read as "off"). Who can see the recordings is his own record,
            // worded from each link's relation and the name he gave (family-link.ts), under a fixed sentence said to him.
            const shared = sharedWith(await hisCareLinks(store, session), "visit_transcripts", "en");
            if (shared.length === 0) {
              content = [tpl("grant_recordings_off_self")];
            } else {
              const sharedZh = sharedWith(await hisCareLinks(store, session), "visit_transcripts", "zh-Hans");
              const who: Candidate = {
                sourceId: "log:family",
                kind: "log",
                span: `Family who can see them now: ${shared.join(", ")}.`,
                spanZh: `现在能看到的家人：${sharedZh.join("、")}。`,
                topics: ["recording"],
                cite: { day },
              };
              byId.set(who.sourceId, who);
              content = [tpl("grant_recordings_on_self"), fromCandidate(who)];
            }
          } else {
            const grant = await store.getFamilyGrant(sid);
            content = [tpl(grant?.items.visit_transcripts ? "grant_recordings_on" : "grant_recordings_off")];
          }
        } else if (cls.topics.includes("refill")) {
          content = [tpl("refill")];
        } else {
          content = await runGenerator(["appointment"]);
          if (content.length === 0) content = [tpl("no_record")];
        }
        break;
      }
      case "refuse_route": {
        // C2 track S (journey 13): what to eat with a long-term condition is the doctor's or a dietitian's (special-diet.ts)
        // 10-14 (the owner's decision): he says he took one tablet too many and names no symptom (classify.ts
        // rule:extra_dose_taken). The same lines as a dose question, in the same order (his doctor's words about the dose
        // with their recording, then his label), then the fixed sentence extra_dose_taken in place of the referral; nothing
        // from the generator
        const extraTaken = cls.reason === EXTRA_DOSE_TAKEN;
        const referral: TemplateId = cls.signals.includes("special_diet") ? "refer_diet" : extraTaken ? "extra_dose_taken" : referralFor(cls);
        refusedRequest = {
          rule: cls.reason,
          topics: cls.topics.filter((t) => SAME_QUESTION_TOPICS.includes(t)),
          replacedBy: cls.injection ? "refuse_injection" : referral,
        };
        if (cls.injection) {
          content = [tpl("refuse_injection")];
        } else {
          if (cls.topics.includes("dose_change") || cls.topics.includes("stopping")) {
            // always relay the doctor's own words about changing the dose and the label directions
            // 10-14: of a doctor's line only the sentence(s) that bear on a dose question, with their stretch of the recording; the checks see that copy (lib/asr/sentences.ts)
            const doctorLine = cands.list.filter((c) => c.kind === "visit" && c.topics?.includes("dose_change")).map((c) => narrowQuote(c, doseQuoteTopic(cls.topics, text)));
            for (const c of doctorLine) byId.set(c.sourceId, c);
            const labels = cands.list.filter((c) => c.kind === "label" && c.drugs?.some((d) => prescriptionDrugs.includes(d) && labelDrugs.includes(d)));
            content = [...doctorLine, ...labels].map((c) => fromCandidate(c));
          }
          if (!extraTaken) {
            const generated = await runGenerator(cls.topics);
            for (const g of generated) {
              if (content.some((c) => c.sourceId === g.sourceId)) continue;
              // (the same narrowing for a label the generator picked; anything else goes on to the checks as before)
              const c = labelDrugs !== drugs ? byId.get(g.sourceId) : undefined;
              if (c?.kind === "label" && !c.drugs?.some((d) => labelDrugs.includes(d))) continue;
              content.push(g);
            }
          }
          tail.push(tpl(referral));
        }
        question = { for: cls.questionFor, origin: "refused_question" };
        if (match && !cls.injection) leadWithAnswer(match);
        break;
      }
      case "explain": {
        content = await runGenerator(cls.topics);
        const sideEffectAsk = cls.topics.includes("side_effects") || SIDE_EFFECT_ASK.test(text);
        if (sideEffectAsk && !match) {
          // C2 (real-app 12): the leaflet's side-effect line for the medicines asked about (when the generator did not pick
          // it), and what a clinician said about this very side effect, word for word, first (the doctor's "Some people
          // get ankle swelling with this one. If you notice it, tell me." under 「脚踝肿是不是副作用？」)
          const asked = askedMedicines(text, ctx, cls.topics);
          for (const c of cands.list) {
            if (c.kind === "patient_text" && c.topics?.includes("side_effects") && (c.drugs ?? []).some((d) => asked.includes(d)) && !content.some((s) => s.sourceId === c.sourceId)) {
              content.push(fromCandidate(c));
            }
          }
          const said = cands.list.filter(
            (c) => c.kind === "visit" && !!c.attribution && aboutSideEffect(c.span) && sideEffectFacets(text).some((f) => sideEffectFacets(c.span).includes(f)),
          );
          for (const c of said.reverse()) putFirst(fromCandidate(c));
        }
        if (match) {
          leadWithAnswer(match);
        } else if (content.length === 0) {
          routeChangedFrom = "explain";
          route = "uncertain";
          tail.push(tpl(aiAllowed ? "uncertain_no_source" : "no_ai_consent"));
          question = { for: cls.questionFor, origin: "refused_question" };
        } else if (sideEffectAsk && SYMPTOM_WORDS.test(text)) {
          // C2 (real-app 12): a side effect he describes goes on the doctor's list, after what the doctor and the leaflet
          // said about it (「脚踝肿是不是副作用？」: Dr Lim's "If you notice it, tell me.")
          tail.push(tpl("side_effect_noted"));
          question = { for: "doctor", origin: "own" };
        }
        break;
      }
      case "uncertain": {
        content = await runGenerator(cls.topics);
        tail.push(tpl(cls.conflict ? "uncertain_conflict" : aiAllowed ? "uncertain_no_source" : "no_ai_consent"));
        question = { for: cls.questionFor, origin: "refused_question" };
        if (match && !cls.conflict) {
          routeChangedFrom = "uncertain";
          route = "explain";
          leadWithAnswer(match);
        }
        break;
      }
    }
    // C2 (real-app 12: 回答里已经有医生直接回答过的原话时，不再接「没有回答」的转介模板): a clinician's spoken answer to this
    // same question (Candidate.answers shares a topic and its side with the ask, about the same medicines) is already in the
    // answer, so the "nothing answers this" template would contradict it (real-status v1: 「这两种药可以一起吃吗」 gave Dr Lim's
    // "Yes, both together after breakfast is fine." and then "the doctor's words ... don't answer this"). It becomes "these
    // are the doctor's own words; the question is on the list too". The question stays: only a question on his list that was
    // answered (matchAnswered above) is "answered before".
    if (!answeredBefore && !cls.injection && !cls.conflict && tail.some((t) => NOT_ANSWERED_TEMPLATES.includes(t.templateId ?? ""))) {
      const scope = askScopeFor();
      const direct = content.find((s) => {
        const c = byId.get(s.sourceId);
        return c?.kind === "visit" && !!c.attribution && (c.answers ?? []).some((t) => scope.topics.includes(t)) && relevanceReasons(c, scope).length === 0;
      });
      if (direct) {
        const by = byId.get(direct.sourceId)!.attribution;
        const said: TemplateId = by === "pharmacist" || by === "dispenser" ? "said_and_added_pharmacist" : "said_and_added_doctor";
        tail = [tpl(said), ...tail.filter((t) => !NOT_ANSWERED_TEMPLATES.includes(t.templateId ?? ""))];
        ledBy = { sourceId: direct.sourceId, templateId: said };
        if (refusedRequest) refusedRequest = { ...refusedRequest, replacedBy: said };
      }
    }
  };

  await compose();
  if (generates) {
    // the screen ran alongside the generator; a crisis (the screen's, or crisis words with no screen) drops the composed
    // answer for the crisis templates
    const raised = await settleScreen();
    if (raised || applyRulesOnlyCue()) await compose();
    publishRoute();
  }
  // The demo's check drill (AskDeps.plant): the one sentence no source says joins the composed answer here, whoever
  // composed it, citing the answer's first source (else the first candidate) the way a careless model would. From here on
  // it is a sentence like any other: enriched as a model's wording, then the three checks. Only an answer made from his
  // sources gets it: a crisis answer, a note, chit-chat, a refused instruction, the dietitian referral, one tablet too many
  // and the app's own answers about sharing, refills and itself are fixed sentences and stay as they are.
  let planted = false;
  const composes =
    route === "explain" ||
    route === "uncertain" ||
    (route === "refuse_route" && !cls.injection && !cls.signals.includes("special_diet") && cls.reason !== EXTRA_DOSE_TAKEN) ||
    (route === "logistics" && !cls.topics.includes("recording") && !cls.topics.includes("refill") && cls.reason !== ABOUT_RIPPLE);
  if (deps.plant && composes) {
    const first = content.find((s) => s.origin !== "template" && byId.has(s.sourceId));
    const source = first ? byId.get(first.sourceId) : cands.list.find((c) => !c.topics?.includes("template") && !c.topics?.includes("referral"));
    content.push({ speechAct: "restate", sourceId: source?.sourceId ?? "drill:no-source", span: deps.plant, slots: {}, en: deps.plant, attribution: source?.attribution });
    planted = true;
  }
  // Any other answer (a question, a request, an unknown medicine, a note) whose words come near a crisis (crisisCue: die,
  // kill myself, 一了百了, mouth crooked, no strength, chest ...) carries the same fixed safety line: offline the rules are the
  // only screen, and they will never know every phrasing (fix round 1: "I'd rather be dead, should I stop my tablets?"
  // was a dose refusal with no 995 offline). Fix round 3: also when the live crisis screen answered "none" (it missed
  // 「我的手雄雄袂振動」 and "Dada saya rasa macam ditekan"): the screen can raise a route, never take the line away.
  // 10-14 (the owner's decision): this is now the only way a note gets the line too (a plain note gets nothing more). And
  // a hypothetical question about one tablet more that asks whether it is "an overdose" (classify.ts extraDose, signal
  // extra_dose_question: it holds no other cue word) is a dose question with no emergency sentence: that word alone is not
  // taken for a cue there.
  if (route !== "self_harm" && route !== "emergency" && !safetyLine && !cls.signals.includes("extra_dose_question")) {
    // (the reason: why no screen vouched for it, or "screen_none" when the live screen answered none)
    const gap = screenGap() ?? "screen_none";
    if (gap && crisisCue(text)) {
      safetyLine = { reason: gap, cue: true };
      pushSafetyTail(safetyLine);
    }
  }
  // SSE: the route is final now (the crisis screen settled, the answer composed, the safety tail added). Ripple's own words
  // may be shown while they are written only on an answer that takes them: no crisis, no helplines, a route of that kind,
  // and offline only where no quote answers it (the mock's canned words never stand next to his sources)
  if (sink && generalP && !generalWords.released) {
    const helplines = [...content, ...tail].some((s) => HELPLINE_IDS.includes(s.templateId ?? ""));
    const offlineQuotes = llm.provider === "mock" && content.some((s) => s.origin !== "template" && !s.templateId);
    if (!CRISIS_ROUTES.includes(route) && generalRoute(route) && !helplines && !offlineQuotes) {
      generalWords.released = true;
      emit({ type: "stage", stage: "writing" });
      if (generalWords.buffer) {
        generalWords.sent = true;
        emit({ type: "delta", text: generalWords.buffer });
        generalWords.buffer = "";
      }
    }
  }

  // ---- enrich: the source decides attribution, citation and Mandarin; the model never does
  for (const s of content) {
    if (s.origin === "template") continue;
    const c = byId.get(s.sourceId);
    if (!c) continue;
    // the source decides who said it: a line with no known speaker carries no attribution, whatever the model said
    s.attribution = c.attribution;
    // a synthetic stand-in clip carries its label in the answer's language (代录音 / stand-in recording)
    s.cite = c.cite?.standInVoice && c.cite.clipPath ? { ...c.cite, clipLabel: locale === "zh-Hans" ? "代录音" : "stand-in recording" } : c.cite;
    const origin = originOf(s, c);
    s.origin = origin;
    // a quote is shown in the source's own words, never the generator's string (verify.ts sourceWords)
    const words = sourceWords(s, c, origin);
    if (words !== null) s.en = words;
    if (origin === "patient_text") s.zh = c.restatement?.zh;
    else if (origin === "span" && c.kind === "label") s.zh = zhFromSlots(s.en, "label") ?? undefined;
    else if (origin === "span" && c.kind === "log" && c.spanZh && s.en.trim() === c.span.trim()) s.zh = c.spanZh;
    else s.zh = undefined;
  }
  // a spoken line or a label is shown whole (verify.ts sourceQuote, fix round 3): two sentences the generator cited from
  // one line become the same whole line, shown once
  content = content.filter((s, i) => s.origin === "template" || !content.some((o, j) => j < i && o.sourceId === s.sourceId && o.en === s.en));

  // ---- 4-6. three checks
  const all = [...content, ...tail];
  // what was asked, for the layer-1 relevance rule: a spoken line about other medicines, or an answer to another
  // question of his, is never shown as this answer; a label or leaflet of another medicine neither (verify.ts
  // relevanceReasons, askedMedicines above)
  const askScope = askScopeFor();
  const { verdicts, tokens: checkTokens } = await verifySentences(all, {
    candidates: byId,
    checker: checkerRes.client,
    checkerReason: checkerRes.reason,
    signal: answerDeadline,
    ask: askScope,
  });
  llmTokens += checkTokens;
  guard?.addTokens(sid, checkTokens);

  const blocked: BlockedSentence[] = [];
  const keptContent: Sentence[] = [];
  const keptTail: Sentence[] = [];
  const crisis = CRISIS_ROUTES.includes(route);
  const replacedBy: TemplateId = cls.reason === EXTRA_DOSE_TAKEN ? "extra_dose_taken" : referralFor(cls);
  for (const v of verdicts) {
    const keep = v.index < content.length ? keptContent : keptTail;
    if (v.pass) {
      keep.push(v.sentence);
      continue;
    }
    if (crisis && v.sentence.origin === "template") {
      // never hide 995 or a helpline; a failing crisis template is a bug that the unit tests catch
      console.error("[safety] crisis template failed a check", v.sentence.templateId, v.layer1.reasons, v.layer2?.reasons);
      keep.push(v.sentence);
      continue;
    }
    blocked.push({ sentence: v.sentence, layer: v.blockedBy!, reasons: [...v.layer1.reasons, ...(v.layer2?.reasons ?? []), ...(v.layer3?.reasons ?? [])], replacedBy });
  }
  // C2: the clinician's answer it led with did not pass a check: as if it had not been found (its template goes; the
  // referral below and a question come back)
  // (set inside compose(): read through a cast, as TypeScript does not follow assignments made in a closure)
  const led = ledBy as { sourceId: string; templateId: TemplateId } | null;
  if (led && !keptContent.some((s) => s.sourceId === led.sourceId)) {
    const gone = led.templateId;
    answeredBefore = null;
    ledBy = null;
    for (let i = keptTail.length - 1; i >= 0; i--) if (keptTail[i].templateId === gone) keptTail.splice(i, 1);
    if (refusedRequest) refusedRequest = { ...refusedRequest, replacedBy };
  }
  // a blocked sentence brings a question (one per answer); not when his doctor's own answer to this question is shown (C2)
  if (blocked.length > 0 && !answeredBefore) question ??= { for: cls.questionFor, origin: "refused_question" };
  // blocked sentences are replaced by the referral template, unless a referral or "not sure" template is
  // already part of the answer
  if (blocked.some((b) => b.sentence.origin !== "template") && !keptTail.some((s) => s.speechAct === "referral" && !SAFETY_TAIL_IDS.includes(s.templateId ?? ""))) {
    const ref = tpl(replacedBy);
    const { verdicts: refVerdicts } = await verifySentences([ref], { candidates: byId, checker: null, checkerReason: null });
    verdicts.push({ ...refVerdicts[0], index: verdicts.length });
    if (refVerdicts[0].pass) keptTail.unshift(ref);
    else console.error("[safety] referral template failed a check", refVerdicts[0].layer1.reasons, refVerdicts[0].layer2?.reasons);
  }
  const final = [...keptContent, ...keptTail];
  // belt and braces: nothing on the do-not-display list leaves this function
  let shown = final.filter((s) => findForbiddenNumbers(`${s.en}
${s.zh ?? ""}`).length === 0);

  // SSE: the sentences are final now (they passed the three checks; a crisis template always stands). They go out in the
  // answer's order, before Ripple's own answer is decided and before the crisis wording is asked for. A fixed sentence that
  // Ripple's own answer may replace waits (with what follows it) until that answer is decided
  const streamed: Sentence[] = [];
  const sendSentences = (list: readonly Sentence[], hold: (s: Sentence) => boolean = () => false) => {
    if (!sink) return;
    for (const s of list) {
      if (streamed.includes(s)) continue;
      if (hold(s)) break;
      streamed.push(s);
      emit({ type: "sentence", index: streamed.length - 1, sentence: s, route });
    }
  };
  sendSentences(shown, (s) => !!generalP && GENERAL_REPLACES.includes(s.templateId ?? ""));

  // ---- owner 10-15: Ripple's own answer (general.ts; the policy file says what it may say). Shown after his sources when
  // the answer is still a question of that kind (not raised to a crisis, no helplines in it): it replaces "nothing answers
  // this, I won't guess" and the referrals that only said so, and his question is then offered (the answer's offer), not
  // added, unless something else in the answer puts it on his list (a side effect he feels, a question his doctor's own
  // words answered, a question already waiting there). A request that only the model sorted as a refusal, and the
  // dietitian's referral, become an answer: route explain. Without it (the model failed, a guard, the time) the answer is
  // what it was before
  let gloss: Gloss | null = null;
  let generalRecord: GeneralRecord | null = null;
  /**
   * Ripple's own answer is shown and nothing else in the answer puts his question on his list: it is offered, not added. The
   * same question already waiting there is still named (it adds nothing to his list); no new row, no question he set aside
   * brought back
   */
  let reuseOnly = false;
  if (generalP) {
    const out = await generalP;
    generalRecord = out.record;
    llmCalls += out.record.calls;
    llmTokens += out.record.tokens;
    guard?.addTokens(sid, out.record.tokens);
    const crisisNow = CRISIS_ROUTES.includes(route) || shown.some((s) => HELPLINE_IDS.includes(s.templateId ?? ""));
    // (offline, the mock's one canned answer stands only where nothing of his answers the question: an answer that quotes
    // his sources stays exactly as it was; a live model judges for itself whether its words add anything)
    const offlineQuoted = llm.provider === "mock" && shown.some((s) => s.origin !== "template" && !s.templateId);
    if (out.answer && (crisisNow || !generalRoute(route))) {
      generalRecord = { ...out.record, shown: false, why: "gate" };
    } else if (out.answer && offlineQuoted) {
      generalRecord = { ...out.record, shown: false, why: "offline_quoted" };
    } else if (out.answer) {
      shown = shown.filter((s) => !GENERAL_REPLACES.includes(s.templateId ?? ""));
      gloss = generalGloss(out.answer, answerLocale(text, locale), glossAt(shown));
      if (!shown.some((s) => KEEPS_QUESTION.includes(s.templateId ?? "")) && cls.reason !== "rule:asked_before") reuseOnly = true;
      if (route !== "explain") {
        routeChangedFrom = routeChangedFrom === "explain" ? undefined : route;
        route = "explain";
      }
      refusedRequest = undefined;
    }
    // SSE: Ripple's own answer is decided. Words of it that were shown and are not the answer are taken back (what stands
    // instead comes with the answer); the sentences that waited for it go out now
    generalWords.closed = true;
    if (generalWords.sent && !gloss) emit({ type: "retract", why: generalRecord?.why ?? "not_shown" });
  }
  sendSentences(shown);

  // ---- owner 10-15: the 995 and self-harm answers in a person's words (crisis-words.ts). The fixed sentences above are
  // the answer already (and its record, fixedText); with a live model they are worded for what he said, within
  // CRISIS_WORDS_TIMEOUT_MS, keeping 995 and every number; the helplines and his doctor's line stay as they are
  const fixedShown = shown;
  let crisisWords: CrisisWordsRecord | null = null;
  if (route === "emergency" || route === "self_harm") {
    // (a crisis the rules found is admitted whatever his limits: answered always, but over a limit or at the spend cap no
    // model words it)
    let crisisOffline: string | undefined = offlineWhy;
    if (!crisisOffline && ruled && CRISIS_ROUTES.includes(ruled.route) && guard && llm.provider !== "mock") {
      if (await guard.overLimit?.(sid)) crisisOffline = "rate_limited";
      else if (await guard.spendCapped?.()) crisisOffline = "spend_cap";
    }
    const v = await voiceCrisis({ route, locale, message: text, shown, someoneElse: cls.signals.includes("third_person"), llm, offline: crisisOffline, signal: answerDeadline });
    shown = v.sentences;
    crisisWords = v.record;
    // SSE: the fixed lines went out above; the person's words passed their checks and stand where they stood
    if (v.record.voiced) emit({ type: "replace", sentences: shown, route });
    llmCalls += v.record.calls;
    llmTokens += v.record.tokens;
    guard?.addTokens(sid, v.record.tokens);
  }

  // ---- 7. question list
  let addedQuestionId: string | undefined;
  let questionReused = false;
  /** C2 round 2: when the reused question went onto his list (real-app 4.5: 「你 9月22日 也问过，已经在问题单里」) */
  let reusedQuestion: NonNullable<AskResult["reusedQuestion"]> | undefined;
  if (question) {
    // the same question already open from today (the seeded q-extra-tablet on D29, or his own earlier ask): reuse it. Open
    // as of the story moment: the seed answers q-extra-tablet at the D42 visit, so on D29 it is still waiting (and is
    // published as it stands then, with no answer)
    const waiting = waitingAt(await store.listQuestions(sid), happened);
    const sinceDay = await lastClinicVisitDay(store, sid, visitsAll, happened);
    // (10-14: one tablet too many is its own question: never folded into another dose question on his list, such as the
    // seeded "may I take an extra tablet when the reading is high"; the same words already there are reused below)
    const found = cls.injection || cls.reason === EXTRA_DOSE_TAKEN
      ? null
      : question.origin === "unidentified_medicine"
        ? // gap 6.4: the same unidentified medicine asked about again today (typed; the photo path keeps its own question)
          input.medIds?.length
          ? null
          : sameUnknownMedicineQuestion(waiting, { for: question.for, day, text, names: unknownNames(cls.signals) })
        : sameDayQuestion(waiting, {
            for: question.for,
            origin: question.origin,
            day,
            topics: cls.topics,
            drugs: questionDrugs(text, ctx.meds, cls.drugs),
            meds: ctx.meds,
            text,
            // C2: open since his last clinic visit, not only today (real-app 4.5); on the demo's D29 the same as before
            sinceDay,
          }) ??
          // C2: the same question with no topic (real-app 12: 重复的合并成一条)
          sameTopiclessQuestion(waiting, { day, sinceDay, text, drugs: matchDrugs(text, ctx.meds, cls.drugs), named: namedDrugs(text, ctx).length > 0, meds: ctx.meds });
    let reuse = found;
    let reopened = false;
    if (!reuse && !cls.injection) {
      // C2, track C's list rule (lib/profile/questions.ts addQuestionFor): the same words already on his list for the same
      // person, from any day: one still waiting is reused, one he set aside comes back; never a second row (a duplicate he
      // merged into another question stays folded)
      const key = normalizeForCompare(text);
      const sameWords = (q: QuestionRow) => q.for === question!.for && !q.merged_into && normalizeForCompare(q.text) === key;
      const open = waiting.find((q) => q.status === "open" && sameWords(q));
      const skipped = open ? undefined : (await store.listQuestions(sid)).find((q) => q.status === "skipped" && sameWords(q));
      if (open) reuse = open;
      else if (skipped && !reuseOnly) {
        reuse = await store.updateQuestion(sid, skipped.id, { status: "open" });
        reopened = true;
      }
    }
    if (reuse) {
      addedQuestionId = reuse.id;
      questionReused = true;
      // (only a question from an earlier day: on the demo's day 29 the seeded one is the question this ask makes)
      if (reuse.created_day !== null && reuse.created_day < day) reusedQuestion = { date: storyDate(scopeD0(session), reuse.created_day) };
      pub(
        sid,
        "question.updated",
        reopened ? `Back on his questions for the ${reuse.for}: "${short(reuse.text)}"` : `Already on today's questions for the ${reuse.for}: "${short(reuse.text)}"`,
        { question: reuse, reused: true },
      );
    } else if (!reuseOnly) {
      const q = await store.addQuestion(sid, { for: question.for, origin: question.origin, text, lang: inputLang, created_day: day });
      addedQuestionId = q.id;
      pub(sid, "question.created", `Added to the questions for the ${question.for}: "${short(text)}"`, { question: q });
    }
    // C2: his own Chinese words go into the doctor's English brief with a checked translation under them (lib/translate):
    // made once, in the background, with his consent, never offline
    if (addedQuestionId && aiAllowed && llm.provider !== "mock" && hasHan(text)) {
      void translateOwnWords(store, sid, text, { aiAllowed: true }).catch(() => undefined);
    }
  }

  // ---- C2: a doctor's English words come with their checked Chinese translation in the Mandarin UI (lib/translate):
  // only what the scope already holds (on an example account also the checked-in set's line, example-set.ts); a line not
  // translated yet is translated once in the background (never offline) for the next look. Only with his consent to AI
  // processing (round 2: without it no translation is shown either). It sits under the original, never in its place.
  if (locale === "zh-Hans" && aiAllowed) {
    for (const s of shown) {
      if (s.origin !== "span" || !s.cite?.visitId || hasHan(s.en)) continue;
      const line = quotedLine(s, cands.list); // (a quote narrowed to some sentences: its whole line's translation, cut the same way)
      const found = await cachedTranslation(store, sid, line, "en>zh-Hans").catch(() => null);
      const zh = cutTranslation(line, s.en, found?.text ?? (session.example_data === true ? exampleZh(line) : null));
      if (zh) s.translation = { lang: "zh-Hans", text: zh };
      else if (llm.provider !== "mock") void translateDoctorLine(store, sid, line, { aiAllowed: true }).catch(() => undefined);
    }
  }

  // ---- 8. safety_event and backstage events
  const latencyMs = now() - t0;
  const layerSummary = (n: 1 | 2 | 3) =>
    verdicts.map((v: SentenceVerdict) => {
      const l = n === 1 ? v.layer1 : n === 2 ? v.layer2 : v.layer3;
      return {
        index: v.index,
        sourceId: v.sentence.sourceId,
        text: short(v.sentence.en, 120),
        ran: !!l,
        pass: l?.pass ?? null,
        reasons: l?.reasons ?? [],
        ...(n === 1 ? { missing: v.layer1.missing } : {}),
        ...(n === 2 && v.layer2 ? { directive: v.layer2.directive } : {}),
        ...(n === 3 && v.layer3 ? { needed: v.layer3.needed, checker: v.layer3.checker ?? null } : {}),
      };
    });
  const l1 = layerSummary(1);
  const l2 = layerSummary(2);
  const l3 = layerSummary(3);
  const fixedText =
    route === "unknown_med" ? UNKNOWN_MED_SENTENCE : route === "self_harm" || route === "emergency" ? fixedShown.filter((s) => s.origin === "template").map((s) => s.en).join(" ") : undefined;
  const fixedTextZh =
    route === "unknown_med" ? TEMPLATES.unknown_med.zh : route === "self_harm" || route === "emergency" ? fixedShown.filter((s) => s.origin === "template").map((s) => s.zh ?? s.en).join("") : undefined;

  const event = await store.addSafetyEvent(sid, {
    input: text,
    lang: inputLang,
    route,
    candidates: { count: cands.list.length, ids: cands.list.map((c) => c.sourceId) },
    layer1: l1,
    layer2: l2,
    layer3: {
      checker: checkerRes.client?.provider ?? null,
      checkerModel: checkerRes.client?.model ?? null,
      checkerIndependence: checkerRes.client ? checkerRes.independence : null,
      checkerReason: checkerRes.reason,
      sentences: l3,
    },
    output: {
      locale,
      sentences: shown.map((s) => ({ sourceId: s.sourceId, en: s.en, zh: s.zh ?? null, attribution: s.attribution ?? null, origin: s.origin ?? null })),
      fixedText: fixedText ?? null,
      addedQuestionId: addedQuestionId ?? null,
      questionReused,
      reusedQuestion: reusedQuestion ?? null,
      // who typed the input (patient, family, judge): his own words for a reused question are read from these
      // records (lib/daily/questions.ts askedWordsFrom), so only an ask he made counts as his words
      askedBy: input.role ?? "patient",
      refusedRequest: refusedRequest ?? null,
      routeReason: cls.reason,
      routeChangedFrom: routeChangedFrom ?? null,
      generationError: generationError ?? null,
      // the model's generation failed and the offline composer picked the sources instead (see runGenerator)
      composedBy: composedByRules ? "rules_after_generation_failed" : null,
      // the demo's check drill: whether the planted sentence joined this answer (null: no drill was asked for)
      drill: deps.plant ? { planted } : null,
      crisisScreen,
      // the fixed safety line on an answer (a note too) whose words come near a crisis (cue: always true since 10-14, when
      // a plain note stopped getting the line), and why no screen vouched for it (offline, rate_limited, an error code,
      // invalid_answer, or screen_none: the live screen answered none but the words are near a crisis); helplines: the
      // SOS and mindline lines came with it
      safetyLine,
      // crisis words raised the route with no crisis screen (fix round 3): from which route, the emergency kinds, why no
      // screen
      rulesOnlyCue,
      // the cost guard's limit was reached and this answer came from the rules alone (no model call)
      costLimited: costLimited ? { limit: costLimited.limit, retryAfterSec: costLimited.retryAfterSec } : null,
      // C2 round 2: his day's model spend was used up and this answer came from the rules alone (no model call)
      spendCapped,
      // C2: a clinician's recorded answer to this same question led the answer, and no question was added
      answeredBefore: answeredBefore ?? null,
      // C2: no consent to AI processing: rules and fixed templates only
      noAiConsent: !aiAllowed,
      rejected,
      llm: { provider: llm.provider, model: llm.model, tokens: llmTokens, calls: llmCalls },
      // owner 10-15: Ripple's own answer (general.ts): shown or why not, the guard codes (never the dropped words)
      general: generalRecord,
      // owner 10-15: the 995 or self-harm lines in a person's words (crisis-words.ts), or why the fixed sentences stood
      crisisWords,
    },
    blocked: blocked.map((b) => ({ text: b.sentence.en, sourceId: b.sentence.sourceId, layer: b.layer, reasons: b.reasons, replacedBy: b.replacedBy })),
    latency_ms: latencyMs,
  });

  // ---- owner 10-16 (「直接把功能做出来，通知相应的对话」; lib/care/told.ts): Ripple answered HIS OWN message on the emergency
  // route (995; or his chest pain, stroke sign or reading kept for his doctor with when to call 995), or the helpline answer
  // to his own words about hurting himself (owner 10-16 「也通知女儿」; lib/care/told.ts TELL_FAMILY_ON_SELF_HARM): every
  // family member bound to him is told, with this conversation. THE BASELINE: whatever his sharing switches say. Never
  // someone else's crisis (third_person), only on his account.
  // Not waited for: his answer never waits for her phone, and a failure never costs him the answer
  const alarm = familyAlarm({ route, signals: cls.signals, role: input.role, sentences: shown });
  if (alarm && session.kind === "account" && session.owner_user_id) {
    void (deps.tellFamily ?? tellFamily)({ store: deps.store, scope: { ...session, story_day: day }, eventId: event.id, kind: alarm }).catch(() => undefined);
  }

  const count = (arr: { ran: boolean; pass: boolean | null }[]) => `${arr.filter((x) => x.pass === true).length}/${arr.filter((x) => x.ran).length} passed`;
  pub(sid, "verify.layer1", `Layer 1 (slots): ${count(l1)}`, { sentences: l1 });
  pub(sid, "verify.layer2", `Layer 2 (directives): ${count(l2)}`, { sentences: l2 });
  const l3Needed = l3.filter((x) => x.ran && (x as { needed?: boolean }).needed).length;
  // the checker is deepseek-v4-pro next to the main deepseek-flash: the same vendor, a different model (10-09), so the
  // line names it the checker model, never a cross-model or second-vendor check (components/backstage/sentences.ts
  // names it from `checker` the same way)
  pub(
    sid,
    "verify.layer3",
    l3Needed === 0 ? "Layer 3 (checker model): not needed, every sentence is a quote, a leaflet line or a template" : `Layer 3 (checker model): ${count(l3)}${checkerRes.client ? "" : " (no checker configured: borderline sentences blocked)"}`,
    { checker: checkerRes.client?.provider ?? null, sentences: l3 },
  );
  for (const b of blocked) {
    pub(sid, "ask.blocked", `Blocked at layer ${b.layer} (${b.reasons.join(", ")}): "${short(b.sentence.en)}"`, b);
  }
  if (refusedRequest) {
    // the request itself: a dose change, stopping or combining is not Ripple's to answer (never cross)
    pub(
      sid,
      "ask.blocked",
      `Not answered (${refusedRequest.rule}): "${short(text)}". Instead: the doctor's and the label's own words, ${refusedRequest.replacedBy}, ${answeredBefore ? "already answered at a visit, no new question" : `question ${questionReused ? "already on the list" : "added"}`}`,
      { request: text, stage: "route", layer: null, reasons: [refusedRequest.rule, ...refusedRequest.topics], replacedBy: refusedRequest.replacedBy, questionId: addedQuestionId ?? null },
    );
  }
  pub(sid, "ask.answered", `Answered as ${route} with ${shown.length} sentence${shown.length === 1 ? "" : "s"} in ${latencyMs} ms${composedByRules ? "; the model's generation failed, the offline composer picked the sources" : ""}`, {
    route,
    sentences: shown,
    addedQuestionId,
    safetyEventId: event.id,
    // the backstage says so in words (components/backstage/sentences.ts)
    ...(composedByRules ? { composedBy: "rules_after_generation_failed" } : {}),
    ...(gloss ? { gloss } : {}),
  });

  return {
    route,
    sentences: shown,
    addedQuestionId,
    fixedText,
    fixedTextZh,
    events: [event],
    locale,
    blocked,
    routeReason: cls.reason,
    routeChangedFrom,
    latencyMs,
    llm: { provider: llm.provider, model: llm.model, tokens: llmTokens, calls: llmCalls },
    ...(questionReused ? { questionReused } : {}),
    ...(reusedQuestion ? { reusedQuestion } : {}),
    ...(refusedRequest ? { refusedRequest } : {}),
    ...(costLimited ? { costLimited: { limit: costLimited.limit, retryAfterSec: costLimited.retryAfterSec } } : {}),
    ...(spendCapped ? { spendCapped: true as const } : {}),
    ...(answeredBefore ? { answeredBefore } : {}),
    ...(deps.plant ? { drill: { planted } } : {}),
    // (chit-chat's fixed sentence, and Ripple's about itself, are the same with or without consent: nothing for the screen
    // to say about them)
    ...(!aiAllowed && route !== "cant_help" && cls.reason !== ABOUT_RIPPLE ? { noAiConsent: true as const } : {}),
    ...(gloss ? { gloss } : {}),
  };
}
