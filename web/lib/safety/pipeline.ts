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
 * The guided harness (2026-10-16; the owner: 「伤害性的言论检索仅仅靠文字匹配是远远不够的……995、药、其他询问都应该有工程化的引导的
 * harness」; the contract lib/safety/risk/types.ts, the decision table web/kb/pathways.json, its reading risk/table.ts and
 * risk/pathways.ts). It replaced the single-message crisis screen (screenCrisisWithModel is no longer called):
 *   - his words are read again normalised (risk/normalize.ts: "k i l l myself", "kil myslef", 「自殺」); the rules run on
 *     every reading and a crisis on any of them counts (rulesOnVariants: it only raises);
 *   - the risk screen (risk/screen.ts: one model call over his message, his last 10 turns of today as askTurns keeps them,
 *     his medicines on the day, his watch state, his language) starts at once and runs beside classification and
 *     generation. Its frame's quotes are checked asymmetrically (risk/evidence.ts) and merged onto the rules' own frame
 *     (risk/rules-floor.ts, risk/merge.ts: the higher wins). An answer waits for it no longer than its own time
 *     (RISK_SCREEN_TIMEOUT_MS, inside the deadline); late, failed, offline, over a limit, at the spend cap or without his
 *     consent the rules' frame decides alone (frameSource "rules"), and crisisScreen records what the screen did, so the
 *     rules-only cue words below work as they did. Two adjustments to the rules' floor before the merge: a wish to die only
 *     the rules' frame calls "active" while classify.ts's own self-harm rules (with their reviewed exceptions) did not route
 *     it is "unclear" (asked about), and an urgent sign only cue words saw (no crisis rule, not the model's) fires no 995-now
 *     row of its own (cueOnly: the rules-only cue words raise it offline, as before; online the safety line stays);
 *   - code decides (decideNow): the medical level 1-4 and the self-harm ladder (none, possible, thoughts, danger), the
 *     table's rows, its fixed lines and at most one follow-up question (AskResult.followUp). The rules' crisis routes are
 *     the floor: never lowered, never waiting for a model before their 995 and helpline lines, which go out first; the
 *     screen's frame then raises them only (a sign kept for his doctor becomes 995 now when the frame says so; the
 *     self-harm answer's 995 line becomes 995 now at danger: raiseCrisisLate, a "replace" of the sentences), waited for
 *     beside the crisis wording and no longer than its own time. Level 1: the emergency route, the 995 line first (on the
 *     row's own B1 source), his doctor's warning line after it for his own chest pain, stroke sign or reading. The ladder at
 *     thoughts or danger: the self-harm route, the helplines as before, then "I'm here ...", "I've let your family know"
 *     (only when lib/care/told.ts tells someone: an account with an active care link) and "tell your doctor"; at danger 995
 *     now first. "possible": the route stays, the safety line and the helplines come first and the confirm question last;
 *     for a lethality question, saved-up tablets or any amount with the watch state on nothing of the composed answer stays
 *     (no label, no dose line, no amount, nothing on his list). Levels 2 and 3: the route's own answer and the row's lines
 *     it does not carry yet (a 995 line first for chest pain, breathing and a reading), the row's question on his list; a
 *     statement whose pathway is at level 2 or 3 is answered on that pathway's route ("Noted." alone is below level 3).
 *     Level 4: as before;
 *   - a reply (AskInput.reply, or typed words that are one of the waiting question's buttons or whose frame fills its fact)
 *     continues the pathway from the state the asking answer kept on its safety record (risk/state.ts: output.harness),
 *     never older than 30 minutes or answered already; no rule, model or note reads a button's words. His family is told
 *     again only when a reply raises what was decided when the question was asked;
 *   - the safety record keeps output.risk (codes only: the watch state, risk/watch.ts, reads it) and output.harness; the
 *     backstage's ask.route and ask.answered events carry the level, the ladder step, the rows and where the frame came
 *     from; the stream sends the follow-up question last.
 * The crisis screen as it was (kept as the record of what the risk screen did): every input the rules did not route to
 * emergency or self_harm also went to the main model's crisis screen. It was
 * started at once and ran alongside classification and generation, so an answer waited for it only when it had no
 * model call of its own (a statement, an unknown medicine, an injection refusal, a template). It could only raise the
 * route to emergency or self_harm (the composed answer is then dropped for the crisis templates); "none", an invalid
 * answer, an error, the spend cap or the deadline keep the rules' route, and the ask.route event says the screen was
 * unavailable (rules only). Offline (mock) there is no screen: the rules are the crisis screen.
 * 10-14 (the owner's decision on one tablet too many) holds in the table: one tablet too many of his own with no sign is
 * level 2, the dose answer and its "995 if very unwell", and the harness asks whether he has a sign now.
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
 * the real database and the real model cut a compose call 1.6 s after it began; the model's own time was ordinary).
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
import type { FollowUp, FollowUpReply, Frame, FrameSource, LadderStep, MedicalLevel, RiskScreenInput, RiskSummary } from "./risk/types";
import { normalizedVariants } from "./risk/normalize";
import { missedDoseQuote, rulesFrame } from "./risk/rules-floor";
import { RISK_SCREEN_TIMEOUT_MS, screenRisk as screenRiskModel, type ScreenResult } from "./risk/screen";
import { checkEvidence, type EvidenceMiss } from "./risk/evidence";
import { mergeFrames } from "./risk/merge";
import { watchState } from "./risk/watch";
import { amountQuestion, chosenMedicines, isQuestionId, messageFrame, oneMedicinePerWord, optionsForFact, QUESTION_FACT, typedOption, type Answers, type DecideContext, type MedChoice } from "./risk/pathways";
import { decide, followUpFor, type Decision } from "./risk/table";
import { findPending, frameCodes, harnessHistory, latestPending, type HarnessRecord, type PathwayState, type PendingLookup } from "./risk/state";
import { askTurns } from "./turns";
import { renderText } from "./render";
import { scopeNowMs } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import type { SafetyEventRow } from "@/lib/store/types";
import { medsOnDayAt, prescribingLines } from "@/lib/meds/on-day";
import { zhGenericName } from "@/lib/meds/zh-names";
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
  selfHarmCue,
  signalFamily,
  targetDrugs,
  type Classification,
  type ClassifyContext,
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
import { detectTopics, facetsOf, findReading, isQuestion, refersToMedicine, sameFacet } from "./topics";
import type { AskResult, AskStreamEvent, Attribution, BlockedSentence, Candidate, Gloss, Locale, Route, Sentence, SentenceVerdict } from "./types";
import { originOf, relevanceReasons, sourceWords, verifySentences } from "./verify";
import { zhFromSlots } from "./zh";

/** How many of his newest safety records are read for the harness (the watch state's week, risk/watch.ts, with room). */
const WATCH_RECORDS = 500;

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
  /**
   * His answer to the follow-up question of an earlier answer (harness, 2026-10-16; lib/safety/risk/types.ts FollowUp): the
   * pending pathway it names continues from there. `text` is then the chosen option's words.
   */
  reply?: FollowUpReply;
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
  /**
   * The guided harness (2026-10-16): the risk screen (default risk/screen.ts screenRisk: one model call over his message and
   * his last turns). A seam for tests, which hand it frames; never called offline, without his consent, at the spend cap or
   * over the question limit.
   */
  screenRisk?: (input: RiskScreenInput, llm: LlmClient, opts: { signal?: AbortSignal; timeoutMs?: number }) => Promise<ScreenResult>;
  /**
   * The harness: whether his family is told of a self-harm answer of his (lib/care/told.ts: an account with at least one active
   * care link), so the answer may say "I've let your family know". Default: his active care links (family-link.ts). Tests
   * pass their own.
   */
  hasFamily?: (session: SessionRow) => Promise<boolean>;
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
 * budget's 5.5 s less those 1566 ms). The compose calls recorded on 10-09 with the main model of that day (75 of them):
 * median 1.0 s, nine in ten under 1.4 s, the slowest 3.0 s. Hunyuan's times are not measured yet (16 October).
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

/** How far a route is a crisis (the rules' order: self-harm, then an emergency). */
const crisisRank = (r: Route | undefined | null) => (r === "self_harm" ? 2 : r === "emergency" ? 1 : 0);

/**
 * The rules on every reading of his words (the harness, 2026-10-16; risk/normalize.ts): his words as typed decide, unless
 * a normalised reading is a crisis they are not ("k i l l myself", "i wanna kil myslef", 「我想自殺」), which then counts
 * (signal "normalized"). Never lowers: a reading that is less of a crisis is ignored.
 */
export function rulesOnVariants(text: string, variants: readonly string[], ctx: ClassifyContext): Classification | null {
  let ruled = classifyRules(text, ctx);
  for (const v of variants) {
    if (v === text) continue;
    const c = classifyRules(v, ctx);
    if (c && crisisRank(c.route) > crisisRank(ruled?.route)) ruled = { ...c, signals: [...c.signals, "normalized"] };
  }
  return ruled;
}

/** The emergency kind a level-1 row's source names (referrals.json B1 rows), for the 995 template's referral and his family's notice. */
const B1_SIGNAL: Record<string, string> = {
  "B1-01": "chest",
  "B1-02": "breathing",
  "B1-03": "stroke",
  "B1-04": "collapse",
  "B1-05": "allergy",
  "B1-07": "bleeding",
  "B1-10": "high_bp_symptom",
  "B1-12": "overdose",
};

/** The emergency signals a level-1 decision stands for (classify.ts's signal names, so the emergency answer is composed as the rules' would be). */
export function levelOneSignals(d: Pick<Decision, "medicalRow" | "facts">): string[] {
  const kind = B1_SIGNAL[d.medicalRow.source];
  const out = kind ? [kind] : [];
  if (d.medicalRow.pathway === "reading_high") out.push("above_doctor_threshold");
  if (d.medicalRow.pathway === "extra_dose" || kind === "overdose") {
    if (d.facts["extra_dose.who"] === "child" || d.facts["extra_dose.who"] === "unsure") out.push("child", "third_person");
    else if (d.facts["extra_dose.who"] === "other") out.push("third_person");
  } else if (d.facts.about === "other" || d.facts.about === "child") {
    out.push("third_person");
  }
  return out;
}

/**
 * A reply's classification (the harness): the route its decision calls for (the ladder's helplines, 995 now), else the route
 * the pathway's first answer went out on (a sign kept for his doctor stays the emergency route it was: the floor). No rule
 * and no model reads the button's words.
 */
export function replyClassification(d: Decision, st: Pick<PathwayState, "origin">): Classification {
  const o = st.origin;
  const ladderUp = d.ladder === "thoughts" || d.ladder === "danger";
  const route: Route = ladderUp ? "self_harm" : d.level === 1 ? "emergency" : o.route;
  const signals = ladderUp
    ? ["self_harm", "harness"]
    : d.level === 1
      ? ["harness", ...levelOneSignals(d), ...o.signals.filter((sg) => sg === "third_person" || sg === "child")]
      : o.signals;
  return { route, reason: "harness:reply", signals: [...new Set(signals)], topics: o.topics, drugs: o.drugs, reading: null, questionFor: "doctor", injection: false, conflict: false };
}

const NOT_YET = Symbol("not yet");
/**
 * Whether a promise that never rejects has settled already (never waits: a settled promise is first in the race, so its
 * reaction runs before the already-resolved marker's).
 */
async function settledNow(p: Promise<unknown>): Promise<boolean> {
  return (await Promise.race([p, Promise.resolve(NOT_YET)])) !== NOT_YET;
}

/** classify.ts signal names -> the risk frame's symptom kinds (for telling a crisis rule's sign from a cue word's). */
const SIGNAL_KIND: Record<string, string> = {
  chest: "chest",
  stroke: "stroke",
  breathing: "breathing",
  collapse: "consciousness",
  confusion: "consciousness",
  allergy: "allergy",
  bleeding: "bleeding",
  high_bp_symptom: "headache",
};
/**
 * A very high reading in his words (B1-10; round 2, 10-16): 180 or more on top or 110 or more below (topics.ts findReading),
 * or said in words beside a blood-pressure word ("two hundred", 两百多, 一百八十几), which findReading does not read
 */
const VERY_HIGH_WORDS: RegExp[] = [
  /\b(?:blood pressure|bp|pressure|reading|systolic|top number)\b[^.?!]{0,25}\b(?:two hundred|one (?:hundred )?(?:and )?(?:eighty|ninety))\b|\b(?:two hundred|one (?:hundred )?(?:and )?(?:eighty|ninety))\b[^.?!]{0,25}\b(?:blood pressure|bp|pressure|reading)\b/i,
  /(?:血压|血壓|上压|上壓|高压|高壓)[^，。？！,?!]{0,8}(?:两百|兩百|二百|一百八|一百九)/,
];
export function veryHighReading(text: string): boolean {
  const r = findReading(text);
  if (r && (r.systolic >= 180 || (r.diastolic !== null && r.diastolic >= 110))) return true;
  return VERY_HIGH_WORDS.some((re) => re.test(text));
}
/** B1-10's signs no frame kind holds: trouble seeing, confusion (the coordinator's list, round 2; weakness is a stroke sign). */
const READING_SIGN_WORDS: RegExp[] = [
  /\b(?:blurr\w*|vision|can'?t see|cannot see|seeing double|double vision|confus\w*)\b/i,
  /看不清|看唔清|视力模糊|視力模糊|眼花|重影|糊涂|糊塗/,
];

/**
 * A symptom said to have come since a new or changed medicine (round 2, 10-16: "Since I started the new pill I've had a dry
 * cough", 「换药以后晚上睡不好」 and the Tamil "since I started the new medicine, my head spins" were notes): with a symptom
 * in the frame, the side-effect pathway. Never on its own: the first live run filed the reading of the hero question as a
 * symptom with his medicine, and those words are not in it.
 */
const SINCE_MEDICINE_WORDS: RegExp[] = [
  /\b(?:since|after|ever since)\b[^.?!]{0,30}\b(?:pills?|tablets?|medicines?|medications?|meds|dose)\b|\b(?:new|changed|switched)\s+(?:pills?|tablets?|medicines?|medication|meds)\b/i,
  /换药|換藥|换了(?:新)?药|換了(?:新)?藥|新药|新藥|(?:吃|服)(?:了)?[^，。？！,?!]{0,8}(?:药|藥)[^，。？！,?!]{0,3}(?:以后|之后|以後|之後|后|後)/,
  /\bubat baru\b|\bsejak\s+(?:makan|ambil|mula)\s+ubat\b/i,
  /புதிய மருந்து|மருந்து[^.?!]{0,30}(?:பிறகு|முதல்|ஆரம்பித்த)/u,
];

/**
 * A dose taken by mistake, in his words (the extra-dose pathway then does not ask whether it was on purpose). Only words that
 * say it was a mistake: "not sure", "I think I took it twice", 好像, 不记得 say he does not know what he took, not why (the
 * recordings of 10-16: "I think I took my pill twice today, not sure" must be asked)
 */
const ACCIDENTAL = /\bby (?:mistake|accident)\b|\baccident(?:al)?ly\b|\bwrongly\b|\bdidn'?t mean\b|\bforgot (?:i|that i)(?:'d| had)?(?: already)?\b|\bconfused\b|不小心|不留神|搞错|搞錯|弄错|弄錯|糊里糊涂|糊裡糊塗|忘了(?:已经)?吃过|唔小心|\btak sengaja\b/i;

/** The harness's medicine pathways and the topics under which Ripple's own answer is never shown (pipeline.ts harnessHoldsGeneral). */
const MEDICINE_PATHWAYS: string[] = ["missed_dose", "extra_dose", "looks_different", "side_effect", "stop_change"];
const NO_GENERAL_TOPICS = ["missed", "dose_change", "stopping", "combination"];

/** A medicine, a dose or taking one, in his words (the missed-dose pathway's topic needs it). */
const MEDICINE_OR_DOSE = /\b(?:pills?|tablets?|medicines?|medications?|meds|doses?|capsules?|take|took|taken|taking|amlodipine|losartan|ibuprofen)\b|药|藥|吃|服|\bubat\b|மருந்து/i;

/** An amount in a line (a number of tablets, or a strength), for an answer that shows none (Decision.noAmounts). */
const AMOUNT_WORDS: RegExp[] = [
  /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|half)\s*(?:x\s*)?(?:tablets?|tabs?|pills?|capsules?)\b|\b\d+(?:\.\d+)?\s*(?:mg|milligrams?)\b/i,
  /[\d一二两三四五六七八九十百半]+\s*(?:粒|片|颗|顆|毫克)/,
];

/** The urgent kinds with no question of their own: a cue word alone never makes them 995 now (DecideContext.cueOnly). */
const CUE_DEMOTED_KINDS = ["stroke", "consciousness", "allergy", "bleeding", "headache"];

const LADDER_ORDER: Record<LadderStep, number> = { none: 0, possible: 1, thoughts: 2, danger: 3 };

/** A decision above what was decided before (a higher ladder step, or a more urgent level). */
export function raisesOver(d: { level: MedicalLevel; ladder: LadderStep }, before: { level: MedicalLevel; ladder: LadderStep }): boolean {
  return LADDER_ORDER[d.ladder] > LADDER_ORDER[before.ladder] || d.level < before.level;
}

/** His turns of today as the risk screen reads them (oldest first, the last 10): his words, and what Ripple showed him. */
export function screenTurns(turns: readonly AskTurnLike[], locale: Locale): RiskScreenInput["turns"] {
  const out: RiskScreenInput["turns"] = [];
  for (const t of turns) {
    out.push({ role: "patient", text: t.text });
    if (t.answer) {
      const followUp = (t.answer as { followUp?: FollowUp }).followUp;
      const shown = renderText(t.answer, t.answer.locale ?? locale);
      const asked = followUp ? (locale === "zh-Hans" ? followUp.zh : followUp.en) : "";
      out.push({ role: "ripple", text: [shown, asked].filter(Boolean).join("\n") });
    }
  }
  return out.slice(-10);
}
type AskTurnLike = { text: string; answer: (Pick<AskResult, "sentences" | "gloss"> & { locale?: Locale }) | null };

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
  // (his recent safety records come with the same round trip: a reply to a follow-up question is looked up among them, and
  // today's conversation tells the harness which pathways asked already; the harness, 2026-10-16)
  // (the app's clock when no test clock is given: the store stamps its records by the same one)
  const nowMs = scopeNowMs(session, deps.now ? deps.now() : appNowMs());
  // his turns of today and his watch state (risk/watch.ts), read beside them too: the risk screen needs both
  const turnsP: Promise<RiskScreenInput["turns"]> = askTurns(store, sid, day)
    .then((t) => screenTurns(t, locale))
    .catch(() => []);
  // (one read of his safety records serves both: the watch state reads them through this store, risk/watch.ts)
  const recentP: Promise<SafetyEventRow[]> = store.listSafetyEvents(sid, { limit: WATCH_RECORDS }).catch((): SafetyEventRow[] => []);
  const watchStore = new Proxy(store, { get: (target, key, receiver) => (key === "listSafetyEvents" ? () => recentP : Reflect.get(target, key, receiver)) });
  const watchP: Promise<{ on: boolean; since?: string; reason?: string }> = Promise.resolve()
    .then(() => watchState(watchStore, sid, nowMs))
    .catch(() => ({ on: false }));
  const [visitsAll, medsAll, recent] = await Promise.all([store.listVisits(sid), store.listMeds(sid), recentP]);
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
  // the harness (2026-10-16): the rules also read his words normalised (risk/normalize.ts: spaced letters, digits for letters,
  // misspelled crisis phrases, traditional characters); a crisis found on any reading counts, and only ever raises
  const variants = normalizedVariants(text);
  /**
   * A reply to an earlier follow-up question (the harness): a tap that names a follow-up still waiting (not older than 30
   * minutes, not answered since: risk/state.ts findPending), or typed words that are one of the waiting question's buttons
   * ("yes", 「没有」, "not sure": risk/pathways.ts typedOption). The pathway then continues from his answers; the rules never
   * read a button's words. An unknown or stale follow-up id: `text` is read as a new message.
   */
  let reply: { lookup: Extract<PendingLookup, { ok: true }>; optionIds: string[]; typed: boolean } | null = null;
  let replyRefused: string | null = null;
  if (input.reply) {
    const found = findPending(recent, input.reply.followUpId, nowMs);
    if (found.ok) reply = { lookup: found, optionIds: input.reply.optionIds, typed: false };
    else replyRefused = found.why;
  } else {
    const waiting = latestPending(recent, nowMs);
    const ids = waiting?.ok ? typedOption(waiting.record.followUp, text) : null;
    if (waiting?.ok && ids) reply = { lookup: waiting, optionIds: ids, typed: true };
  }
  const ruled = reply ? null : rulesOnVariants(text, variants, ctx);
  // his medicines on the day as the harness names them, his turns of today, his watch state: read side by side, now
  const medChoices: MedChoice[] = ctx.meds
    .filter((m) => !!m.drug_id || !!m.label?.drug)
    .map((m) => ({ id: m.id, name: medName(m), nameZh: zhGenericName(m.drug_id), drugId: m.drug_id }));
  /** The harness's decision for this answer (risk/table.ts), once it is made: at once for a reply, after the frame otherwise. */
  let decision: Decision | null = null;
  let frameSource: FrameSource = "rules";
  let harnessFrame: Frame | null = null;
  let evidenceMisses: EvidenceMiss[] = [];
  let screenResult: ScreenResult | null = null;
  /** the risk screen's frame after the evidence check (risk/evidence.ts), before it is merged onto the rules' */
  let modelFrame: Frame | null = null;
  let watch: { on: boolean; since?: string; reason?: string } = { on: false };
  let decideCtx: DecideContext | null = null;
  let decideAnswers: Answers = {};
  let continuing: PathwayState | null = null;
  if (reply) {
    // a reply continues its pathway from the frame and the context it was asked with, plus his answer (risk/state.ts)
    const st = reply.lookup.record.state;
    continuing = st;
    watch = await watchP;
    decideAnswers = { ...st.answers, [st.questionId]: reply.optionIds };
    harnessFrame = st.frame;
    frameSource = st.frameSource;
    decideCtx = {
      watch: st.context.watch || watch.on,
      frameSource: st.frameSource,
      rules: { route: st.origin.rulesRoute, reason: st.origin.reason, signals: st.origin.signals, topics: st.origin.topics },
      readingAboveLine: st.context.readingAboveLine,
      meds: medChoices,
      fits: st.context.fits,
      asksAmount: st.context.asksAmount,
      asksLargeAmount: st.context.asksLargeAmount,
      sideEffect: st.context.sideEffect,
      missedDose: st.context.missedDose,
      history: harnessHistory(recent, day, { continuing: st.pathway, answering: reply.lookup.record.followUp.id }),
      cueOnly: st.context.cueOnly ?? [],
      accidental: st.context.accidental ?? false,
      continuing: st.pathway,
      ignored: null,
    };
    decision = decide(st.frame, decideAnswers, decideCtx, st.values);
  }
  // Cost guard (fix round 2: the hourly limit used to come before any crisis check but the rules', so "I have written
  // letters to my children and arranged everything." over the limit got HTTP 429 and no 995). Over the limit, a
  // statement and any input near crisis words (crisisCue) are still answered, by the rules alone with no model call
  // (offline composer, no checker), the latter with the fixed safety line; only other questions are refused (429).
  // 10-14: one tablet too many (rule:extra_dose_taken) was an emergency, never limited; it is fixed lines with no model
  // call, so it is still answered over the limit.
  let costLimited: CostLimitError | null = null;
  try {
    // (a reply to a follow-up question is fixed lines and code, never refused: the pathway it continues may be a crisis)
    await guard?.admit(sid, { exempt: !!reply || (!!ruled && CRISIS_ROUTES.includes(ruled.route)) });
  } catch (e) {
    if (!(e instanceof CostLimitError) || (!reply && !(ruled?.route === "log_only" || crisisCue(text)) && ruled?.reason !== EXTRA_DOSE_TAKEN)) throw e;
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
  // ---- the harness (2026-10-16; see the header): the risk screen starts now, alongside classification and generation. It
  // reads his message with his last turns of today and his watch state (risk/screen.ts) and replaces the single-message
  // crisis screen. Not for a reply to a follow-up question (code continues the pathway), chit-chat or a question about Ripple
  // itself (their rules found no medicine, symptom or crisis word), and never with no model allowed for him (the mock)
  let screenInput: RiskScreenInput | null = null;
  // (a crisis the rules found is admitted whatever his limits, but over a limit or at the spend cap no model reads or words it:
  // the same check the crisis wording makes, made once here for both)
  let crisisModelBlocked: string | undefined;
  if (!reply && ruled && CRISIS_ROUTES.includes(ruled.route) && guard && llm.provider !== "mock") {
    if (await guard.overLimit?.(sid)) crisisModelBlocked = "rate_limited";
    else if (await guard.spendCapped?.()) crisisModelBlocked = "spend_cap";
  }
  const riskP: Promise<ScreenResult> | null =
    !reply && !crisisModelBlocked && llm.provider !== "mock" && !(ruled && (ruled.route === "cant_help" || ruled.reason === ABOUT_RIPPLE))
      ? (async () => {
          try {
            const [turns, watch] = await Promise.all([turnsP, watchP]);
            const input: RiskScreenInput = { message: text, turns, meds: medChoices.map(({ id, name }) => ({ id, name })), watch: watch.on, locale };
            screenInput = input;
            return await (deps.screenRisk ?? screenRiskModel)(input, llm, { signal: modelSignal(), timeoutMs: RISK_SCREEN_TIMEOUT_MS });
          } catch {
            return { frame: null, provider: llm.provider, model: llm.model, ms: 0, tokens: 0, error: "error" };
          }
        })()
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
  const fromList = ruled || reply ? null : await ownListRule();
  let cls: Classification;
  if (reply && decision && continuing) {
    cls = replyClassification(decision, continuing);
  } else if (ruled) {
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

  /**
   * The harness (2026-10-16; see the header). The frame of his message: the risk screen's (its quotes checked
   * asymmetrically: risk/evidence.ts) merged onto the rules' (risk/rules-floor.ts), or the rules' alone when the screen did
   * not run, failed, or did not answer within its own time (RISK_SCREEN_TIMEOUT_MS, inside the answer's deadline). It
   * replaces the single-message crisis screen; the crisis screen's record (crisisScreen) now says what the risk screen did,
   * so screenGap and the rules-only cue words work as before when no model read his words.
   */
  let rFrame: Frame | null = null;
  const rulesFrameNow = async (): Promise<Frame> => {
    if (!rFrame) rFrame = rulesFrame(text, { meds: medChoices.map(({ id, name }) => ({ id, name })), turns: await turnsP });
    return rFrame;
  };
  let riskSettled = false;
  /** Wait for the risk screen (no longer than its own time) and settle the frame. */
  const settleRisk = async (): Promise<void> => {
    if (reply || riskSettled) return;
    riskSettled = true;
    const rules = await rulesFrameNow();
    let res: ScreenResult | null = null;
    if (riskP) {
      try {
        res = await riskP;
      } catch {
        res = { frame: null, provider: llm.provider, model: llm.model, ms: 0, tokens: 0, error: "error" };
      }
    }
    screenResult = res;
    if (res) {
      llmTokens += res.tokens;
      llmCalls++;
      guard?.addTokens(sid, res.tokens);
      const failed = res.frame ? null : (res.error ?? "error");
      crisisScreen = { route: null, reason: `risk_screen:${res.provider}`, error: failed, errorCode: failed, raisedFrom: null, awaited: true };
      if (failed) console.warn(`[safety] risk screen unavailable (${failed}); the rules' frame for this answer`);
    }
    if (res?.frame && screenInput) {
      const checked = checkEvidence(res.frame, screenInput);
      evidenceMisses = checked.misses;
      modelFrame = checked.frame;
      frameSource = "model+rules";
    } else {
      modelFrame = null;
      frameSource = "rules";
    }
    harnessFrame = mergedFrame(rules);
  };
  /**
   * The rules' frame as a floor, merged with the model's. One adjustment first: a wish to die that only the rules' frame calls
   * "active" while classify.ts's own self-harm rules (with their reviewed exceptions: "doesn't want to live in a nursing
   * home", "with my son") did not route it there is a cue, not a statement: "unclear", so the ladder asks him (the confirm
   * question, the helplines visible) instead of answering as if he had said it. And one medicine per word he said (risk/
   * pathways.ts oneMedicinePerWord: 降压药 is one medicine he did not name, not both of his blood-pressure medicines), before
   * the frame is decided on or stored
   */
  const mergedFrame = (rules: Frame): Frame => {
    const floor: Frame =
      rules.selfHarm.ideation === "active" && rulesRouteNow() !== "self_harm" ? { ...rules, selfHarm: { ...rules.selfHarm, ideation: "unclear" } } : rules;
    return oneMedicinePerWord(modelFrame ? mergeFrames(floor, modelFrame) : floor);
  };
  /**
   * The urgent signs only cue words saw (risk/pathways.ts DecideContext.cueOnly): in the rules' frame, but neither among the
   * crisis rules' signals nor in the model's frame
   */
  const cueOnlyKinds = (frame: Frame): string[] => {
    const ruleKinds = new Set((ruled?.signals ?? []).map((sg) => SIGNAL_KIND[sg]).filter(Boolean));
    // (round 2: with no model frame, a kind the rules' frame says is happening now stands: "Since lunch my right side is
    // very heavy" is 995 now offline, "my arm went funny" is the safety line. A model that read his words and named no
    // such sign has the last word: a tingly face is not 995 now)
    const saysNow = (k: string) => !modelFrame && frame.symptoms.some((sy) => sy.kind === k && sy.now === "yes");
    return [...new Set(frame.symptoms.map((sy) => sy.kind))].filter(
      (k) => CUE_DEMOTED_KINDS.includes(k) && !ruleKinds.has(k) && !(modelFrame?.symptoms.some((sy) => sy.kind === k) ?? false) && !saysNow(k),
    );
  };
  /** The rules' frame now, for an answer the rules already made a crisis (995 and the helplines never wait for a model). */
  const provisionalRisk = async (): Promise<void> => {
    if (reply || harnessFrame) return;
    harnessFrame = mergedFrame(await rulesFrameNow());
    frameSource = "rules";
  };
  /** The rules' own route: what they found (on any reading of his words), or what crisis words raised with no model. */
  const rulesRouteNow = (): Route | null => (rulesOnlyCue ? cls.route : (ruled?.route ?? null));
  /** Decide with the frame as it stands (risk/table.ts). */
  const decideNow = async (): Promise<Decision | null> => {
    if (reply) return decision;
    // (the floor is read again now: the rules-only cue words may have raised the route since the frame settled)
    const frame = mergedFrame(await rulesFrameNow());
    harnessFrame = frame;
    watch = await watchP;
    const reading = findReading(text);
    const asked = amountQuestion(variants, isQuestion(text) || /[?？]/.test(text));
    const named = targetDrugs(text, ctx);
    // a side effect he describes: his words name the symptom (SYMPTOM_WORDS), the frame files it as one of the everyday kinds
    // and names a medicine. (The first live run, 10-16: the screen filed the reading in 「今天 150/95，我能不能多吃一粒？」 as a
    // symptom "other" with his medicine, and the hero question got the side-effect lines and question)
    const mild = SYMPTOM_WORDS.test(text) && frame.symptoms.some((sy) => ["dizziness", "swelling", "headache"].includes(sy.kind));
    // (or any everyday symptom, a cough, poor sleep, his head spinning, said to have come since a new or changed medicine)
    const since = SINCE_MEDICINE_WORDS.some((re) => re.test(text)) && frame.symptoms.some((sy) => ["dizziness", "swelling", "headache", "other"].includes(sy.kind));
    decideCtx = {
      watch: watch.on,
      frameSource,
      rules: {
        route: rulesRouteNow(),
        reason: ruled?.reason ?? null,
        signals: ruled?.signals ?? [],
        topics: ruled?.topics ?? cls.topics,
        // (round 2, 10-16: the rules' own answer is the fixed "call 995 now": a crisis rule fired on his words, not cue words
        // alone, and its sign is not one kept for his doctor, or it is an overdose. The table says level 1 then (row
        // rules-995-now), so the record says what his screen shows; the harness never lowers the rules' 995)
        now995:
          (ruled?.route === "emergency" && (ruled.signals.includes("overdose") || signalFamily(ruled.signals, text) === null)) ||
          (!!rulesOnlyCue && cls.route === "emergency" && cls.signals.includes("overdose")),
        selfHarmCue: selfHarmCueOnly,
      },
      readingAboveLine:
        (ruled?.signals ?? []).includes("above_doctor_threshold") || (!!reading && ctx.doctorThresholdSystolic !== null && reading.systolic > ctx.doctorThresholdSystolic),
      // (a reading he only supposes, "if it is two hundred", is a question about it, not one he has)
      readingVeryHigh: frame.when !== "hypothetical" && veryHighReading(text),
      readingSignWords: READING_SIGN_WORDS.some((re) => re.test(text)),
      meds: medChoices,
      fits: ctx.meds.filter((m) => m.drug_id && named.includes(m.drug_id)).map((m) => m.id),
      due: ctx.meds.filter((m) => isDue(m, day)).map((m) => m.id),
      asksAmount: asked.any,
      asksLargeAmount: asked.large,
      sideEffect:
        SIDE_EFFECT_ASK.test(text) ||
        (cls.topics.includes("side_effects") && SYMPTOM_WORDS.test(text)) ||
        ((mild && frame.medicines.length > 0) || since) && frame.when !== "hypothetical",
      // (round 2: the topic table's "missed" is any "forget" or "miss"; for the pathway it needs a medicine, a dose or taking
      // it in his words, as "Siao liao, I forget where I put my spectacles" shows. rules-floor.ts missedDoseQuote reads the
      // missed dose itself)
      missedDose: (cls.topics.includes("missed") && MEDICINE_OR_DOSE.test(text)) || !!missedDoseQuote(text),
      history: harnessHistory(recent, day),
      cueOnly: cueOnlyKinds(frame),
      accidental: ACCIDENTAL.test(text),
      continuing: null,
      // (round 2: the question his last answer left waiting, which this message does not answer as a tap; typed words that
      // answer it make this a reply below, typedFill)
      ignored: (() => {
        const waiting = latestPending(recent, nowMs);
        return waiting?.ok ? { pathway: waiting.record.state.pathway, question: waiting.record.followUp.templateId } : null;
      })(),
    };
    decideAnswers = {};
    decision = decide(frame, {}, decideCtx);
    return decision;
  };
  /**
   * Typed or spoken words that answer the question still waiting (risk/pathways.ts optionsForFact): this message's frame fills
   * that question's fact, and the rules did not make the words a crisis of their own (the floor). The pathway then continues
   * as for a tap, with the waiting frame raised by this one (risk/merge.ts: the higher wins).
   */
  const typedFill = (): boolean => {
    if (reply || !harnessFrame || !decideCtx || crisisRank(cls.route) > 0) return false;
    const waiting = latestPending(recent, nowMs);
    if (!waiting?.ok) return false;
    const st = waiting.record.state;
    const q = waiting.record.followUp.templateId;
    if (!isQuestionId(q)) return false;
    const merged = mergeFrames(st.frame, harnessFrame);
    const probe = decide(merged, st.answers, { ...decideCtx, continuing: st.pathway }, st.values);
    const ids = optionsForFact(q, probe.facts[QUESTION_FACT[q]]);
    if (!ids) return false;
    reply = { lookup: waiting, optionIds: ids, typed: true };
    continuing = st;
    decideAnswers = { ...st.answers, [q]: ids };
    harnessFrame = merged;
    decideCtx = {
      ...decideCtx,
      rules: { route: st.origin.rulesRoute, reason: st.origin.reason, signals: st.origin.signals, topics: st.origin.topics },
      readingAboveLine: st.context.readingAboveLine,
      fits: st.context.fits,
      watch: st.context.watch || watch.on,
      history: harnessHistory(recent, day, { continuing: st.pathway, answering: waiting.record.followUp.id }),
      cueOnly: st.context.cueOnly ?? [],
      accidental: st.context.accidental ?? false,
      continuing: st.pathway,
      ignored: null,
    };
    decision = decide(merged, decideAnswers, decideCtx, st.values);
    cls = replyClassification(decision, st);
    return true;
  };
  /** Who raised the route, and from what (the record and the backstage). */
  let harnessRaise: { from: Route; row: string } | null = null;
  /**
   * The decision's route (never lower than the rules' or the classification's): the ladder's thoughts or danger -> the
   * self-harm route (the helplines); a level-1 row -> the emergency route (995 now), also for a sign the rules kept for his
   * doctor (the conditional answer becomes 995 now: the owner's 10-14 rule depends on "now" and "how long", the table's
   * chest rows); a statement whose pathway is at level 2 or 3 -> the route of that pathway's answer ("Noted." alone is below
   * level 3: the research report). An emergency answer keeps its route when the ladder is up too (its 995 line stays first;
   * the helplines are added: applyDecision). True when the answer must be composed again.
   */
  const applyRaise = (): boolean => {
    const raised = raiseFor();
    // (the backstage reads who raised the route from the crisis screen's record: it says so for the harness too)
    if (raised && harnessRaise && crisisScreen) crisisScreen = { ...crisisScreen, route: cls.route === "self_harm" || cls.route === "emergency" ? cls.route : null, raisedFrom: harnessRaise.from };
    return raised;
  };
  const raiseFor = (): boolean => {
    const d = decision;
    if (!d || reply) return false;
    const ladderUp = d.ladder === "thoughts" || d.ladder === "danger";
    // (round 2: someone else's self-harm signal he reports, row self-harm-someone-else: the self-harm answer about someone
    // else, as the rules give it; his own ladder stays at none, so no watch state for him and no notice to his family)
    if (d.ladderRow?.show.includes("self_harm_995_other") && crisisRank(cls.route) === 0) {
      harnessRaise = { from: cls.route, row: d.ladderRow.id };
      cls = { ...cls, route: "self_harm", reason: `harness:${d.ladderRow.id}`, signals: ["self_harm", "harness", "third_person"], questionFor: "doctor", injection: false, conflict: false };
      return true;
    }
    if (ladderUp && cls.route !== "self_harm" && cls.route !== "emergency") {
      harnessRaise = { from: cls.route, row: d.ladderRow?.id ?? "" };
      cls = {
        ...cls,
        route: "self_harm",
        reason: `harness:${d.ladderRow?.id}`,
        signals: ["self_harm", "harness", ...cls.signals.filter((sg) => sg !== "third_person")],
        questionFor: "doctor",
        injection: false,
        conflict: false,
      };
      return true;
    }
    if (d.level === 1 && crisisRank(cls.route) === 0) {
      harnessRaise = { from: cls.route, row: d.medicalRow.id };
      cls = {
        ...cls,
        route: "emergency",
        reason: `harness:${d.medicalRow.id}`,
        signals: ["harness", ...levelOneSignals(d), ...cls.signals.filter((sg) => sg !== "overdose")],
        questionFor: "doctor",
        injection: false,
        conflict: false,
      };
      return true;
    }
    if (d.level === 1 && cls.route === "emergency" && !cls.signals.includes("overdose") && signalFamily(cls.signals, text)) {
      harnessRaise = { from: cls.route, row: d.medicalRow.id };
      const more = d.medicalRow.pathway === "reading_high" ? ["high_bp_symptom"] : [];
      cls = { ...cls, signals: [...new Set([...cls.signals, ...more, "harness"])] };
      return true;
    }
    if (cls.route === "log_only" && !ladderUp && d.level >= 2 && d.level <= 3) {
      const from = cls.route;
      const reroute = (route: Route, reason: string, more: Partial<Classification>): boolean => {
        harnessRaise = { from, row: d.medicalRow.id };
        cls = { ...cls, route, reason, questionFor: "doctor", injection: false, conflict: false, ...more, signals: [...(more.signals ?? cls.signals), "harness"] };
        return true;
      };
      switch (d.pathway) {
        case "extra_dose":
          return reroute("refuse_route", EXTRA_DOSE_TAKEN, { topics: [...new Set([...cls.topics, "dose_change"])], signals: ["extra_dose_taken"] });
        case "stop_change":
          return reroute("refuse_route", "harness:stop_change", { topics: [...new Set([...cls.topics, "stopping"])], signals: ["stopping"] });
        case "side_effect":
          return reroute("explain", "harness:side_effect", { topics: [...new Set([...cls.topics, "side_effects"])], signals: ["explain"] });
        case "looks_different":
          return reroute("uncertain", "harness:looks_different", { topics: [], drugs: cls.drugs, signals: ["looks_different"], questionFor: "pharmacist" });
        case "chest":
          return reroute("emergency", "harness:chest", { signals: ["chest", ...cls.signals.filter((sg) => sg === "third_person")] });
        default:
          return false;
      }
    }
    return false;
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
  /**
   * Round 2 (10-16, the eval line's offline run: "Wah today so hot, die liao", 「熱到死」 and "Today is my late husband's
   * birthday" reached "thoughts" and told his family): cue words alone never reach "thoughts", never tell his family and
   * never make a sign 995 now by themselves. Self-harm cue words in a statement keep its route and give the ladder's
   * "possible" step (DecideContext.rules.selfHarmCue, row self-harm-cue: the safety line, the helplines, the confirm
   * question); about someone else, the answer for them (row self-harm-someone-else). A body sign the cue words name is in
   * the rules' frame too (rules-floor.ts reads the same words): its pathway asks its question (chest pain, breathlessness),
   * and a stroke sign, a collapse or bleeding is 995 now when the frame says it is happening now (DecideContext.cueOnly).
   * Only the word "overdose" still raises the route itself: an overdose said is one taken (B1-12), and it has no question
   * before its 995 line.
   */
  let selfHarmCueOnly = false;
  const applyRulesOnlyCue = (): boolean => {
    // (never on a reply: a button's words, "Chest pain, or short of breath", are his answer, not a new message)
    if (reply || SCREEN_SKIP.includes(cls.route)) return false;
    const gap = screenGap();
    if (!gap) return false;
    if (cls.route === "log_only" && selfHarmCue(text)) selfHarmCueOnly = true;
    const kinds = emergencyCue(text).filter((k) => k === "overdose");
    if (kinds.length === 0) return false;
    rulesOnlyCue = { from: cls.route, kinds, gap };
    const someoneElse = aboutSomeoneElse(text) ? ["third_person"] : [];
    cls = { ...cls, route: "emergency", reason: "rule:emergency_cue", signals: ["emergency_cue", ...kinds, ...someoneElse, ...cls.signals], questionFor: "doctor", injection: false, conflict: false };
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
        ? `; risk screen unavailable (${crisisScreen.errorCode}), the rules' frame only`
        : harnessRaise
          ? `; raised from ${harnessRaise.from} by the harness (${harnessRaise.row})`
          : "";
    const cueNote = rulesOnlyCue ? `; raised from ${rulesOnlyCue.from} by crisis words, no crisis screen (${rulesOnlyCue.gap})` : "";
    // (the harness's decision as codes: level, ladder step, the table rows, where the frame came from; never a word of the
    // model's or of his)
    const harness = decision
      ? { level: decision.level, ladder: decision.ladder, rows: decision.rows, frameSource, raisedFrom: harnessRaise?.from ?? null, reply: reply ? (reply.typed ? "typed" : "tap") : null }
      : null;
    const harnessNote = decision ? `; harness level ${decision.level}, ladder ${decision.ladder} (${decision.rows.join(", ")}; ${frameSource})` : "";
    pub(sid, "ask.route", `Route: ${cls.route} (${cls.reason}${note}${cueNote}${harnessNote})`, {
      route: cls.route,
      reason: `${cls.reason}${note}${cueNote}`,
      signals: cls.signals,
      topics: cls.topics,
      drugs: cls.drugs,
      crisisScreen,
      rulesOnlyCue,
      harness,
    });
  };

  // no model reads his words at all (offline mock, the question limit, no consent, the spend cap): the rules are the only
  // screen from the start
  if (!riskP) applyRulesOnlyCue();
  /**
   * The harness: whether his family is told, so the answer may say so (an account with an active care link: lib/care/told.ts),
   * for his own answer on the ladder (thoughts, danger), and on a reply only when it raises what was decided before (his
   * family heard about the first answer already)
   */
  let tellLine = false;
  const prepareTell = async (): Promise<void> => {
    const d = decision;
    tellLine = false;
    if (!d || !(d.ladder === "thoughts" || d.ladder === "danger")) return;
    if (session.kind !== "account" || !session.owner_user_id || (input.role && input.role !== "patient") || cls.signals.includes("third_person")) return;
    if (continuing && !raisesOver(d, continuing.decided)) return;
    try {
      tellLine = await (deps.hasFamily ?? (async (s: SessionRow) => (await hisCareLinks(store, s)).length > 0))(session);
    } catch {
      tellLine = false;
    }
  };
  /**
   * An answer already a crisis (the rules' emergency or self-harm route, or the model's classification) never waits for the
   * risk screen before its lines: it is composed from the rules' frame and its 995 and helpline lines go out at once. The
   * screen's frame comes in beside the crisis wording (below): it settles the record and the follow-up question, and it can
   * only raise (a sign kept for his doctor becomes 995 now; the self-harm answer's 995 line becomes 995 now at danger)
   */
  const crisisAlready = !reply && (cls.route === "self_harm" || cls.route === "emergency");
  // an answer with a model call of its own composes alongside the screen; any other waits for the screen first
  // (a statement's note is written only when it is not a crisis; one tablet too many and Ripple's words about itself are fixed
  // lines, no generator; a reply to a follow-up question is fixed lines)
  const generates =
    !reply &&
    (cls.route === "explain" ||
      cls.route === "uncertain" ||
      (cls.route === "refuse_route" && !cls.injection && cls.reason !== EXTRA_DOSE_TAKEN) ||
      (cls.route === "logistics" && !cls.topics.includes("recording") && !cls.topics.includes("refill") && cls.reason !== ABOUT_RIPPLE));
  if (!generates) {
    if (crisisAlready) await provisionalRisk();
    else await settleRisk();
    applyRulesOnlyCue();
    await decideNow();
    if (!typedFill()) applyRaise();
    await prepareTell();
    publishRoute();
  }

  // the harness, for an answer with a model call of its own: a first decision from the rules' frame now (the screen's frame
  // settles it after composing). A side effect he describes brings his sources' side-effect lines with it, as a question
  // with the words "side effect" does (「吃了药以后头有点晕，正常吗」: the leaflet's line, his doctor's words about it, the question for
  // his doctor)
  if (generates) {
    await decideNow();
    if (decision?.pathway === "side_effect" && !cls.topics.includes("side_effects")) cls = { ...cls, topics: [...cls.topics, "side_effects"] };
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
  /**
   * The recordings of 10-16 (C3, a red line: under "I forgot this morning's pill, it's 9pm now, should I take it?" Ripple's
   * own answer told him to take the one he forgot now, beside the missed-dose question and the leaflet's line). Ripple's own
   * answer never stands beside the harness's medicine guidance: an answer that asks a follow-up question, or whose decision
   * is a medicine pathway's row (a missed dose, one tablet too many, a medicine that looks different, a side effect, stopping
   * or changing one), or whose topics are a missed dose, a dose, stopping or combining his medicines. It is not even asked
   * for when the decision so far says so, and it is never shown or streamed when the final one does.
   */
  const harnessHoldsGeneral = (): boolean =>
    cls.topics.some((t) => NO_GENERAL_TOPICS.includes(t)) || (!!decision && (!!decision.ask || MEDICINE_PATHWAYS.includes(decision.medicalRow.pathway)));
  const generalP: Promise<GeneralOutcome> | null =
    // (never under the harness's pharmacist referral for a medicine that looks different: that answer is the referral)
    !offlineWhy && !cls.injection && generalRoute(cls.route) && cls.reason !== "harness:looks_different" && !harnessHoldsGeneral()
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
    keptLine = { sourceId: c.sourceId, en, zh, day, date: when.date };
    return { speechAct: "logistics", sourceId: c.sourceId, span: en, slots: {}, en, zh, templateId: SIGNAL_RECORDED.id, cite: c.cite };
  };
  /** The "kept for your doctor" line as it was shown (the harness keeps it with a waiting question: a reply shows it again). */
  let keptLine: PathwayState["kept"] | null = continuing?.kept ?? null;

  /**
   * One fixed line a decision-table row shows (kb/pathways.json `show`), as a sentence of this answer, or null when it does
   * not apply here: Care Corner only in the Mandarin UI; "I've let your family know" only when his family is told
   * (prepareTell); the plain 995 line cites the row's own B1 source (else the referral for the answer's signals); the
   * self-harm 995 line speaks of "them" for someone else's crisis; "kept for your doctor" only as it was shown.
   */
  const harnessLine = (id: string, d: Decision): Sentence | null => {
    if (id === SIGNAL_RECORDED.id) {
      if (!keptLine) return null;
      const k = keptLine;
      const c: Candidate = { sourceId: k.sourceId, kind: "log", span: k.en, spanZh: k.zh, topics: ["signal"], cite: { day: k.day, date: k.date } };
      byId.set(c.sourceId, c);
      return { speechAct: "logistics", sourceId: c.sourceId, span: k.en, slots: {}, en: k.en, zh: k.zh, templateId: SIGNAL_RECORDED.id, cite: c.cite };
    }
    if (!(id in TEMPLATES)) return null;
    const tid = id as TemplateId;
    if (tid === "self_harm_care_corner" && locale !== "zh-Hans") return null;
    if (tid === "self_harm_family_told" && !tellLine) return null;
    if (tid === "emergency_995") return tpl("emergency_995", /^B1-\d+$/.test(d.medicalRow.source) ? d.medicalRow.source : emergencyReferralFor(cls.signals));
    if (tid === "self_harm_995" && cls.signals.includes("third_person")) return tpl("self_harm_995_other", TEMPLATES.self_harm_995_other.referralId);
    return tpl(tid, TEMPLATES[tid].referralId);
  };
  /** The lines of a list of row line ids (harnessLine), in order, each once. */
  const harnessLines = (ids: readonly string[], d: Decision): Sentence[] => {
    const out: Sentence[] = [];
    for (const id of ids) {
      const line = harnessLine(id, d);
      if (line && !out.some((o) => o.templateId === line.templateId)) out.push(line);
    }
    return out;
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
    // the harness: a reply to a follow-up question is the decision's own lines (kb/pathways.json `show`), nothing composed
    // from his sources and no question added: 995 now (with his doctor's warning line for his own chest pain, stroke sign or
    // reading, as the emergency answer has it), the helplines, a level's fixed lines, the leaflet's missed-dose line for the
    // medicine he picked, or "Noted." when the row adds nothing
    if (reply && decision) {
      const d = decision;
      const lines = harnessLines(d.show, d);
      const someoneElse = cls.signals.includes("third_person");
      if (d.level === 1 && !someoneElse && warn && clinicianAttribution(warn.speaker) && (d.pathway === "chest" || d.pathway === "reading_high" || d.medicalRow.id === "stroke-now")) {
        const w = warningLine(session, warn, locale);
        byId.set(w.candidate.sourceId, w.candidate);
        lines.splice(Math.min(1, lines.length), 0, w.sentence);
      }
      if (d.pathway === "missed_dose" && continuing) {
        const picked = chosenMedicines(reply.optionIds, continuing.values)
          .map((id) => ctx.meds.find((m) => m.id === id)?.drug_id)
          .filter((x): x is string => !!x);
        for (const c of cands.list) {
          if (c.kind === "patient_text" && c.topics?.includes("missed") && (c.drugs ?? []).some((dg) => picked.includes(dg))) lines.push(fromCandidate(c));
        }
      }
      content = lines.length ? lines : [tpl("noted")];
      return;
    }
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
        // the harness's ladder at thoughts or danger: its lines (the helplines as before, then "I'm here", his family told, his
        // doctor; at danger 995 first without a condition); the rules' self-harm answer is the first lines of the thoughts row,
        // so nothing it showed is ever dropped
        content =
          decision && (decision.ladder === "thoughts" || decision.ladder === "danger")
            ? harnessLines(decision.show, decision)
            : selfHarmTemplateIds(locale, cls.signals.includes("third_person")).map((id) => tpl(id, TEMPLATES[id].referralId));
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
        // (the harness: a level-1 decision makes the sign kept for his doctor 995 now: chest pain still there for minutes, a
        // stroke sign not over, a reading above his doctor's line with a red flag)
        // (round 2, 10-16: a level-1 row that also keeps the sign for his doctor, a stroke sign that has passed: its own lines
        // in its order, the 995-now line first, then the note with its time, then his doctor's warning line)
        const keepsAt1 = decision?.level === 1 && decision.medicalRow.show.includes(SIGNAL_RECORDED.id);
        const family = cls.signals.includes("overdose") || (decision?.level === 1 && !keepsAt1) ? null : signalFamily(cls.signals, text);
        const kept = family ? await keepSignal(family) : null;
        if (decision && keepsAt1 && kept) {
          content = harnessLines(decision.medicalRow.show, decision);
          if (warn && clinicianAttribution(warn.speaker)) {
            const w = warningLine(session, warn, locale);
            byId.set(w.candidate.sourceId, w.candidate);
            content.push(w.sentence);
          }
        } else if (family && kept) {
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
          const readingAlone = decision?.level !== 1 && cls.signals.includes("above_doctor_threshold") && cls.signals.every((sg) => READING_ONLY_SIGNALS.includes(sg));
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
        if (cls.reason === "harness:looks_different") {
          // the harness (level 2; ISMP): a medicine that looks different from before, said as a statement. Check with the
          // pharmacist before taking them, and the question goes on his pharmacist's list; nothing composed from his sources
          // (the leaflet's words about the medicine are not about this tablet's look)
          content = [tpl("looks_different_pharmacist")];
          tail = [tpl("added_for_pharmacist")];
          question = { for: "pharmacist", origin: "own" };
          break;
        }
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

  /**
   * The harness's decision on a composed answer that is not a reply (the route itself was raised by applyRaise):
   *   - ladder "possible": the fixed safety line and the helplines before anything else, and the confirm question after the
   *     answer; for a lethality question, saved-up tablets or any amount with the watch state on (decision.noAmounts) the
   *     composed lines go entirely (no label, no dose line, no number of tablets, no referral) and nothing goes on his list;
   *   - an emergency answer with the ladder at thoughts or danger: the ladder's lines after its 995 line;
   *   - level 2 or 3 below a crisis: the row's lines the answer does not carry yet. A line with 995 in it stands first for
   *     chest pain, breathing and a reading (a body sign), else last among the answer's own lines; a referral line ("I've
   *     added this ...") at the end; and the row's question for his doctor or pharmacist when the answer adds none of its own.
   * Level 4 adds nothing: the ordinary answer stands.
   */
  const applyDecision = () => {
    const d = decision;
    if (!d || reply) return;
    const has = (id: string) => [...content, ...tail].some((s) => s.templateId === id);
    // no amount on his screen (decision.noAmounts, round 2: whatever the route). A lethality question, saved-up tablets, or
    // any amount asked with the watch state on: nothing composed stays (no label, no dose line, no number of tablets, no
    // referral, nothing on his list). Anything else on the ladder (a large amount asked with no model to read it, low mood,
    // cue words): the composed answer stays without its label lines and any line with an amount in it (the doctor's dose
    // line among them). A crisis answer's fixed lines carry no amount
    let cleared = false;
    if (d.noAmounts && crisisRank(route) === 0) {
      const lethal = ["yes", "unclear"];
      const aboutAmount =
        lethal.includes(String(d.facts["selfHarm.lethalityQuestion"])) || lethal.includes(String(d.facts["selfHarm.means"])) || (d.facts.watch === true && d.facts["asks.amount"] === true);
      if (aboutAmount) {
        cleared = true;
        content = [];
        tail = [];
        question = null;
        refusedRequest = undefined;
        answeredBefore = null;
        ledBy = null;
      } else {
        const amountLine = (s: Sentence) => byId.get(s.sourceId)?.kind === "label" || AMOUNT_WORDS.some((re) => re.test(s.en) || (!!s.zh && re.test(s.zh)));
        content = content.filter((s) => !amountLine(s));
        tail = tail.filter((s) => !amountLine(s));
      }
    }
    if (d.ladder === "possible") {
      const lines = harnessLines(d.ladderRow?.show ?? [], d);
      const ids = new Set(lines.map((s) => s.templateId));
      content = [...lines, ...content.filter((s) => !ids.has(s.templateId))];
      tail = tail.filter((s) => !ids.has(s.templateId));
      safetyLine = { reason: "harness_possible", helplines: true };
    }
    if (route === "emergency" && (d.ladder === "thoughts" || d.ladder === "danger")) {
      for (const line of harnessLines(d.ladderRow?.show ?? [], d)) {
        if (line.templateId === "self_harm_danger_995" && content.some((s) => s.templateId === "emergency_995" || s.templateId === "emergency_overdose")) continue;
        if (!has(line.templateId ?? "")) content.push(line);
      }
    }
    if (crisisRank(route) === 0 && (d.level === 2 || d.level === 3) && d.ladder !== "thoughts" && d.ladder !== "danger" && !cleared) {
      const body = d.pathway === "chest" || d.pathway === "breathing" || d.pathway === "reading_high";
      // (a sign that has passed, a row of no pathway of its own that names a symptom: collapse-passed. Its lines are the
      // answer, in their order, before the note: "see a doctor today", then the 995 signs)
      const passed = d.medicalRow.pathway === "general" && Object.keys(d.medicalRow.when).some((k) => k.startsWith("symptoms."));
      if (passed) {
        const lines = harnessLines(d.medicalRow.show.filter((id) => id !== SIGNAL_RECORDED.id && !has(id)), d);
        content = [...lines, ...content];
      }
      for (const id of passed ? [] : d.medicalRow.show) {
        if (id === SIGNAL_RECORDED.id || has(id)) continue;
        // (the dose-change referral belongs to a refused request; on any other route it would say a question was refused)
        if (id === "refer_doctor" && route !== "refuse_route") continue;
        const line = harnessLine(id, d);
        if (!line) continue;
        if (line.en.includes("995")) {
          if (body) content.unshift(line);
          else content.push(line);
        } else {
          tail.push(line);
        }
      }
      if (d.question) question ??= { for: d.question, origin: "own" };
    }
  };

  await compose();
  if (generates) {
    // the screen ran alongside the generator; a crisis (the harness's decision, or crisis words with no model) drops the
    // composed answer for the crisis templates, and a statement's pathway, or typed words that answer the waiting question,
    // compose it again
    await settleRisk();
    const cue = applyRulesOnlyCue();
    await decideNow();
    const raised = typedFill() || applyRaise();
    await prepareTell();
    if (raised || cue) await compose();
    publishRoute();
  }
  applyDecision();
  // The demo's check drill (AskDeps.plant): the one sentence no source says joins the composed answer here, whoever
  // composed it, citing the answer's first source (else the first candidate) the way a careless model would. From here on
  // it is a sentence like any other: enriched as a model's wording, then the three checks. Only an answer made from his
  // sources gets it: a crisis answer, a note, chit-chat, a refused instruction, the dietitian referral, one tablet too many
  // and the app's own answers about sharing, refills and itself are fixed sentences and stay as they are.
  let planted = false;
  const composes =
    !reply &&
    cls.reason !== "harness:looks_different" &&
    !(decision?.noAmounts && decision.ladder !== "none") &&
    (route === "explain" ||
    route === "uncertain" ||
    (route === "refuse_route" && !cls.injection && !cls.signals.includes("special_diet") && cls.reason !== EXTRA_DOSE_TAKEN) ||
      (route === "logistics" && !cls.topics.includes("recording") && !cls.topics.includes("refill") && cls.reason !== ABOUT_RIPPLE));
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
  if (sink && generalP && !generalWords.released && !reply) {
    const helplines = [...content, ...tail].some((s) => HELPLINE_IDS.includes(s.templateId ?? ""));
    const offlineQuotes = llm.provider === "mock" && content.some((s) => s.origin !== "template" && !s.templateId);
    if (!CRISIS_ROUTES.includes(route) && generalRoute(route) && !helplines && !offlineQuotes && !harnessHoldsGeneral()) {
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
    // (a reply to a follow-up question is the decision's fixed lines: never with Ripple's own general words)
    if (out.answer && (crisisNow || !generalRoute(route) || !!reply)) {
      generalRecord = { ...out.record, shown: false, why: "gate" };
    } else if (out.answer && harnessHoldsGeneral()) {
      generalRecord = { ...out.record, shown: false, why: "harness" };
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
  /**
   * The harness, after a crisis answer's lines went out: the lines it raises to, or null when the screen's frame raises
   * nothing. A sign kept for his doctor whose decision is now level 1: the plain 995 line on the row's own B1 source, then his
   * doctor's warning line for his own chest pain, stroke sign or reading (the emergency answer's order). The self-harm answer
   * at danger: 995 now without a condition in place of its conditional 995 line. Fixed lines only (the words a model gave the
   * lines before are dropped with them), each through the three checks.
   */
  const raiseCrisisLate = async (before: Decision | null): Promise<Sentence[] | null> => {
    const d = decision;
    if (!d) return null;
    let lines: Sentence[] | null = null;
    if (route === "emergency" && d.level === 1 && before && before.level !== 1 && shown.some((s) => s.templateId === SIGNAL_RECORDED.id)) {
      lines = [harnessLine("emergency_995", d)!];
      if (warn && clinicianAttribution(warn.speaker) && !cls.signals.includes("third_person")) {
        const w = warningLine(session, warn, locale);
        byId.set(w.candidate.sourceId, w.candidate);
        lines.push(w.sentence);
      }
    } else if (route === "self_harm" && d.ladder === "danger" && before?.ladder !== "danger") {
      const at = shown.findIndex((s) => s.templateId === "self_harm_995");
      if (at >= 0) lines = [...shown.slice(0, at), tpl("self_harm_danger_995", TEMPLATES.self_harm_danger_995.referralId), ...shown.slice(at + 1)];
    }
    if (!lines) return null;
    const { verdicts: checked } = await verifySentences(lines, { candidates: byId, checker: null, checkerReason: null });
    return checked.map((v) => v.sentence);
  };
  let fixedShown = shown;
  let crisisWords: CrisisWordsRecord | null = null;
  if (route === "emergency" || route === "self_harm") {
    // (a crisis the rules found is admitted whatever his limits: answered always, but over a limit or at the spend cap no
    // model words it)
    const crisisOffline: string | undefined = offlineWhy ?? crisisModelBlocked;
    // (the harness: when the screen's frame may still raise this answer, a sign kept for his doctor or the self-harm answer
    // below danger, it is waited for beside the wording, never longer than its own time)
    const frameMayRaise =
      crisisAlready &&
      !!riskP &&
      !!decision &&
      (route === "emergency" ? decision.level !== 1 && shown.some((s) => s.templateId === SIGNAL_RECORDED.id) : decision.ladder !== "danger");
    const [v] = await Promise.all([
      voiceCrisis({ route, locale, message: text, shown, someoneElse: cls.signals.includes("third_person"), llm, offline: crisisOffline, signal: answerDeadline }),
      frameMayRaise ? riskP : null,
    ]);
    shown = v.sentences;
    crisisWords = v.record;
    // SSE: the fixed lines went out above; the person's words passed their checks and stand where they stood
    if (v.record.voiced) emit({ type: "replace", sentences: shown, route });
    llmCalls += v.record.calls;
    llmTokens += v.record.tokens;
    guard?.addTokens(sid, v.record.tokens);
  }
  // ---- the harness: an answer already a crisis (the rules' 995 now, an overdose, the helplines; or the model's
  // classification) went out without waiting for the risk screen (crisisAlready). If the screen's frame came in meanwhile (it
  // started with the answer and ran beside the crisis wording), it settles the decision for the record and the follow-up
  // question, and it only ever raises: at danger the self-harm 995 line becomes 995 now (a replacement of the sentences says
  // so). If not, the rules' frame stands for this answer and the screen's tokens are counted when it ends, as the crisis
  // screen's were
  if (crisisAlready && riskP) {
    if (await settledNow(riskP)) {
      const before = decision;
      await settleRisk();
      await decideNow();
      const raised = await raiseCrisisLate(before);
      if (raised) {
        shown = raised;
        fixedShown = raised;
        emit({ type: "replace", sentences: shown, route });
      }
    } else {
      crisisScreen = { route: null, reason: "not awaited: already a crisis", error: null, errorCode: null, raisedFrom: null, awaited: false };
      // the call was made (and is billed): it counts as a call here; its tokens reach the cost guard when it ends
      llmCalls++;
      void riskP.then((sc) => {
        void guard?.addTokens(sid, sc.tokens);
        void guard?.settle?.();
      });
    }
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

  // ---- the harness's record (risk/state.ts): output.risk, the summary in codes (the watch state reads it), and
  // output.harness, the follow-up question this answer asks and what a reply needs to continue it. His family is told (below)
  // on his own 995 answer and on the ladder's thoughts or danger, never on "possible"; on a reply only when it raises what
  // was decided when the question was asked
  const eventId = `safety-${crypto.randomUUID()}`;
  const alarmBase = familyAlarm({ route, signals: cls.signals, role: input.role, sentences: shown });
  const alarm = alarmBase && continuing && decision && !raisesOver(decision, continuing.decided) ? null : alarmBase;
  const familyTold = !!alarm && session.kind === "account" && !!session.owner_user_id;
  let followUp: FollowUp | null = null;
  let harnessRecord: HarnessRecord | null = null;
  let riskSummary: RiskSummary | undefined;
  if (decision) {
    const made = decision.ask
      ? followUpFor(decision, { id: `${eventId}:${decision.ask.pathway}:${decision.ask.step}`, meds: medChoices, fits: decideCtx?.fits ?? continuing?.context.fits ?? [] })
      : null;
    const frameNow = messageFrame(harnessFrame ?? (await rulesFrameNow()));
    let state: PathwayState | null = null;
    if (made) {
      followUp = made.followUp;
      const sameSequence = !!continuing && continuing.pathway === made.followUp.pathway;
      const reading = findReading(text);
      state = {
        pathway: made.followUp.pathway,
        questionId: made.followUp.templateId,
        answers: sameSequence ? decideAnswers : {},
        values: made.values,
        frame: frameCodes(frameNow),
        frameSource,
        originEventId: continuing?.originEventId ?? eventId,
        origin: continuing?.origin ?? { rulesRoute: rulesRouteNow(), route, reason: cls.reason, signals: cls.signals, topics: cls.topics, drugs: cls.drugs },
        context: continuing?.context ?? {
          readingAboveLine: decideCtx?.readingAboveLine ?? (!!reading && ctx.doctorThresholdSystolic !== null && reading.systolic > ctx.doctorThresholdSystolic),
          fits: decideCtx?.fits ?? [],
          asksAmount: decideCtx?.asksAmount ?? false,
          asksLargeAmount: decideCtx?.asksLargeAmount ?? false,
          sideEffect: decideCtx?.sideEffect ?? false,
          missedDose: decideCtx?.missedDose ?? false,
          watch: watch.on,
          cueOnly: decideCtx?.cueOnly ?? [],
          accidental: decideCtx?.accidental ?? false,
        },
        decided: { level: decision.level, ladder: decision.ladder },
        ...(keptLine ? { kept: keptLine } : {}),
      };
    }
    // (set inside settleRisk: read through a cast, as TypeScript does not follow assignments made in a closure)
    const sr = screenResult as ScreenResult | null;
    harnessRecord = {
      v: 1,
      day,
      followUp,
      replied: reply ? { followUpId: reply.lookup.record.followUp.id, optionIds: reply.optionIds, typed: reply.typed } : null,
      state,
    };
    riskSummary = {
      level: decision.level,
      ladder: decision.ladder,
      rows: decision.rows,
      frameSource,
      ...(sr ? { screen: { provider: sr.provider, model: sr.model, ms: sr.ms, ...(sr.error ? { error: sr.error } : {}) } } : {}),
      frame: frameCodes(frameNow),
      ...(evidenceMisses.length ? { evidenceMisses: evidenceMisses.map((m) => ({ field: m.field, effect: m.effect })) } : {}),
      watch: { on: watch.on, ...(watch.since ? { since: watch.since } : {}), ...(watch.reason ? { reason: watch.reason } : {}) },
      ...(familyTold ? { familyTold: true } : {}),
      ...(followUp ? { followUp: { pathway: followUp.pathway, step: followUp.step } } : {}),
    };
  }

  const event = await store.addSafetyEvent(sid, {
    id: eventId,
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
      // the harness (2026-10-16; risk/state.ts): the decision in codes (the watch state reads it) and the pathway state a
      // reply continues
      ...(riskSummary ? { risk: riskSummary } : {}),
      ...(harnessRecord ? { harness: harnessRecord } : {}),
      ...(replyRefused ? { replyRefused } : {}),
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
  if (alarm && session.kind === "account" && session.owner_user_id) {
    void (deps.tellFamily ?? tellFamily)({ store: deps.store, scope: { ...session, story_day: day }, eventId: event.id, kind: alarm }).catch(() => undefined);
  }

  const count = (arr: { ran: boolean; pass: boolean | null }[]) => `${arr.filter((x) => x.pass === true).length}/${arr.filter((x) => x.ran).length} passed`;
  pub(sid, "verify.layer1", `Layer 1 (slots): ${count(l1)}`, { sentences: l1 });
  pub(sid, "verify.layer2", `Layer 2 (directives): ${count(l2)}`, { sentences: l2 });
  const l3Needed = l3.filter((x) => x.ran && (x as { needed?: boolean }).needed).length;
  // the checker is hy4-preview next to the main hy3: the same vendor, a different model (10-16), so the
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
    // the harness's decision in codes (the backstage): level, ladder step, rows, where the frame came from, the question asked
    ...(riskSummary
      ? { risk: { level: riskSummary.level, ladder: riskSummary.ladder, rows: riskSummary.rows, frameSource: riskSummary.frameSource, followUp: riskSummary.followUp ?? null, familyTold: !!riskSummary.familyTold } }
      : {}),
  });
  // SSE: the follow-up question goes last, after every line of the answer (995 and the helplines before any question)
  if (followUp) emit({ type: "followup", followUp });

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
    ...(followUp ? { followUp } : {}),
    ...(riskSummary ? { risk: riskSummary } : {}),
  };
}
