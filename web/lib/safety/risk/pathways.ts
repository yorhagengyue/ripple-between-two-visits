/**
 * The guided pathways' facts and questions (the harness, 2026-10-16; the contract is ./types.ts, the decision table
 * web/kb/pathways.json, the reading of it ./table.ts). Pure: no store, no model, no clock.
 *
 * What a decision-table row reads is a flat map of FACTS, derived here from three things:
 *   - the frame (what the risk screen, or the rules alone, understood of his message in its conversation: ./types.ts Frame);
 *   - the answers he gave to this pathway's follow-up questions so far (a tap on a button, or his typed words when they
 *     answered the question: pipeline.ts);
 *   - the context the pipeline knows for sure (his medicines on the day, which of them fit the message, the rules' route,
 *     a reading above his doctor's own line, the watch state, whether the frame came from a model).
 * A fact a question can settle is "unknown" while nobody said it, and then becomes what he answered. "Not sure", "I'd rather
 * not say" and an empty answer are "unsure", which the table puts with the more dangerous values (Infermedica: "don't
 * know" is not "no"; STCC: when unsure, the higher disposition). A pathway asks at most three questions in a conversation
 * (today's) and is never asked again once he has answered it (PathwayHistory.answered): from then on a fact it could have
 * asked is "unsure". A question he was asked and never answered (he typed something else) may be asked again while the
 * pathway has questions left; a medical fact counts as "unsure" only once nothing may be asked any more. An unanswered chest
 * question never turns a later question about his appointment into a 995 answer: the facts matter only when his new message
 * brings that pathway up again. What the question he left waiting does carry to his next message (round 2, 10-16: a
 * question ignored is no answer, and no answer is the careful side) is that pathway's 995 signs (DecideContext.ignored: the
 * rows `*-question-ignored`, kept for his doctor, no question), and for a self-harm question the same question once more
 * with the helplines above it.
 *
 * The self-harm questions follow the same rule (a question he left unanswered is asked again while there are asks left; it
 * counts as "unsure" only when it may not be asked any more and his new message brings self-harm up), with one difference:
 * after he has answered the confirm question in this conversation, a new lethality question shows the safety line and the
 * helplines again without asking again (the possible row), and his "No" itself is never carried to a new message (a later
 * question about a lethal amount is a red flag whatever came before: the research report). A repeated signal after an
 * unanswered question still climbs: the first answer at "possible" turned the watch state on (risk/watch.ts), and with it
 * a lethality question or saved-up tablets are "thoughts".
 *
 * The option ids are the ones in templates.ts FOLLOW_UPS; a medicines question's options are `med:<n>` (his medicines in
 * the order of `meds`), and the pending state keeps which medicine each one was (FollowUpValues), so a reply never trusts
 * an id it did not hand out.
 */
import { FOLLOW_UPS, type FollowUpTemplateId } from "../templates";
import type { Route } from "../types";
import type { FollowUp, FollowUpOption, Frame, FrameSource, FrameSymptom, PathwayId } from "./types";

/** A fact's value (risk/types.ts PathwayRow.when compares with these). */
export type FactValue = string | number | boolean;
export type Facts = Record<string, FactValue>;

/** One of his medicines on the day, as the which-medicine questions name it. */
export interface MedChoice {
  /** his medication row id (the Frame's medicine refs use the same ids) */
  id: string;
  /** the name he knows it by (lib/session/today.ts medName: his list's English name, else the label's) */
  name: string;
  /**
   * the name his Mandarin medicine list and card show for it (lib/meds/zh-names.ts: the Chinese generic name, from the
   * kb's own aliases); null or absent: the name above, as his list shows it then
   */
  nameZh?: string | null;
  /** kb/drugs.json id, when identified */
  drugId?: string | null;
}

/** The knowledge base's blood-pressure medicines (kb/drugs.json: amlodipine and losartan bring blood pressure down). */
export const BP_DRUG_IDS = ["amlodipine", "losartan"];

/** What happened earlier in this conversation (today's safety records, risk/state.ts harnessHistory). */
export interface PathwayHistory {
  /** pathways he answered a question of earlier today, other than the one this answer continues */
  answered: PathwayId[];
  /** questions (FOLLOW_UPS ids) asked earlier today that he never answered */
  unanswered: string[];
  /** how many questions each pathway asked today (answered or not) */
  asks?: Partial<Record<PathwayId, number>>;
}

export interface DecideContext {
  watch: boolean;
  frameSource: FrameSource;
  /**
   * the rules' classification (classify.ts): the floor. `now995`: the rules' own answer is the fixed "call 995 now" sentence
   * (a crisis rule fired and its sign is not one kept for his doctor: classify.ts signalFamily; an overdose): the table's
   * level is then 1 whatever the frame says (row rules-995-now), so the record says what his screen shows. `selfHarmCue`:
   * self-harm cue words in a statement no crisis screen vouched for, and nothing else (no SELF_HARM rule, no frame field):
   * the confirm question, never "thoughts" by themselves (row self-harm-cue)
   */
  rules: { route: Route | null; reason?: string | null; signals: string[]; topics: string[]; now995?: boolean; selfHarmCue?: boolean };
  /** a reading in this message above his doctor's own warning line (classify.ts signal above_doctor_threshold) */
  readingAboveLine: boolean;
  /**
   * a reading of 180 or more on top or 110 or more below, also in words ("two hundred", 两百多): B1-10's very high blood
   * pressure, a reading the pathway asks about even above no line of his doctor's
   */
  readingVeryHigh?: boolean;
  /** his words name one of B1-10's signs no frame kind holds: trouble seeing, confusion, weakness (pipeline.ts) */
  readingSignWords?: boolean;
  /** his words say a dose was taken by mistake ("by mistake", "forgot I had taken it", 不小心, 糊里糊涂): pipeline.ts */
  accidental?: boolean;
  /** the question his last answer left waiting, which this message did not answer (risk/state.ts latestPending) */
  ignored?: { pathway: PathwayId; question: string } | null;
  /** his medicines on the day, named */
  meds: MedChoice[];
  /** which of `meds` fit this message (the medicine named, or his prescriptions for "my pill"): ids */
  fits: string[];
  /**
   * his prescriptions due on the day (ids): a dose he missed is one of these when he names none ("早上忘了吃": with one
   * prescription, which one is not asked)
   */
  due?: string[];
  /** he asks how many or how much of a medicine (any amount) */
  asksAmount: boolean;
  /** he asks about the most, too many, too much or all at once (a large amount) */
  asksLargeAmount: boolean;
  /** he describes a symptom as something his medicine may cause (pipeline.ts) */
  sideEffect: boolean;
  /** he asks about or reports a missed dose */
  missedDose: boolean;
  history?: PathwayHistory;
  /**
   * Urgent signs only cue words saw (classify.ts emergencyCue, read into the rules' frame), neither a crisis rule nor the
   * model's frame: frame kinds (stroke, consciousness, allergy, bleeding, headache). They do not fire a level-1 row of their
   * own: with no model the rules-only cue words raise the route as before (pipeline.ts applyRulesOnlyCue), with a model that
   * did not see them the fixed safety line stays under the answer (a tingly face is not 995 now)
   */
  cueOnly?: string[];
  /** the pathway this answer continues (a reply to its question), when it does */
  continuing?: PathwayId | null;
}

/** His answers so far in the pathway this answer continues: question id -> the option ids he chose. */
export type Answers = Record<string, string[]>;

/** Which medicine each medicines-question option stands for (kept with the pending question). */
export type FollowUpValues = Record<string, string>;

// ---------------------------------------------------------------- the questions

/** The fact each question settles. */
export const QUESTION_FACT: Record<FollowUpTemplateId, string> = {
  chest_now: "symptoms.chest.now",
  chest_long: "symptoms.chest.long",
  chest_with: "symptoms.chest.redFlag",
  breathing_rest: "symptoms.breathing.atRest",
  breathing_blue: "symptoms.breathing.blue",
  reading_redflags: "reading.redFlag",
  extra_who: "extra_dose.who",
  extra_symptoms: "extra_dose.symptoms",
  extra_amount: "extra_dose.amount",
  extra_which: "extra_dose.several",
  extra_purpose: "extra_dose.onPurpose",
  missed_which: "missed_dose.medicine",
  looks_which: "looks_different.medicine",
  side_redflags: "side_effect.redFlag",
  side_which: "side_effect.medicine",
  side_since: "side_effect.since",
  stop_already: "stop_change.stopped",
  stop_since: "stop_change.since",
  self_harm_confirm: "selfHarm.confirm",
  self_harm_danger: "selfHarm.danger",
};

/** Each pathway's questions in the order they may be asked (red flags first). */
export const PATHWAY_QUESTIONS: Record<PathwayId, FollowUpTemplateId[]> = {
  chest: ["chest_now", "chest_long", "chest_with"],
  breathing: ["breathing_rest", "breathing_blue"],
  reading_high: ["reading_redflags"],
  extra_dose: ["extra_who", "extra_symptoms", "extra_amount", "extra_which", "extra_purpose"],
  missed_dose: ["missed_which"],
  looks_different: ["looks_which"],
  side_effect: ["side_redflags", "side_which", "side_since"],
  stop_change: ["stop_already", "stop_since"],
  self_harm_check: ["self_harm_confirm", "self_harm_danger"],
};

/** The most questions one pathway asks in a conversation. */
export const MAX_QUESTIONS = 3;

export const isQuestionId = (id: string): id is FollowUpTemplateId => Object.prototype.hasOwnProperty.call(FOLLOW_UPS, id);

/** The pathway a question belongs to. */
export const pathwayOfQuestion = (id: FollowUpTemplateId): PathwayId => FOLLOW_UPS[id].pathway;

/**
 * What one answer to a question means for its fact (the more dangerous side for "not sure", "rather not say", nothing
 * chosen, and for a multi-select that names a sign and "none" together).
 */
export function answerValue(questionId: FollowUpTemplateId, optionIds: readonly string[], values: FollowUpValues = {}): string {
  const chosen = optionIds.filter((o) => o.length > 0);
  const unsure = chosen.length === 0 || chosen.includes("unsure") || chosen.includes("rather_not");
  const q = FOLLOW_UPS[questionId];
  const valid = chosen.filter((o) => q.options.some((x) => x.id === o) || (q.medicines && o in values));
  if (valid.length === 0) return "unsure";
  switch (questionId) {
    case "chest_now":
      return pick(valid, { yes: "yes", gone: "no" }, unsure);
    case "chest_long":
      return valid.includes("over5") || valid.includes("comes_goes") ? "yes" : unsure ? "unsure" : valid.includes("under5") ? "no" : "unsure";
    case "breathing_rest":
    case "breathing_blue":
    case "stop_already":
      return pick(valid, { yes: "yes", no: "no", not_yet: "no" }, unsure);
    case "self_harm_confirm":
    case "self_harm_danger":
      return pick(valid, { yes: "yes", no: "no" }, unsure);
    case "extra_purpose":
      return pick(valid, { purpose: "yes", mistake: "no" }, unsure);
    case "chest_with":
    case "reading_redflags":
    case "extra_symptoms":
    case "side_redflags":
      // any sign chosen is yes, whatever else was chosen with it; "none" alone is no
      if (valid.some((o) => o !== "none" && o !== "unsure")) return "yes";
      return unsure ? "unsure" : valid.includes("none") ? "no" : "unsure";
    case "extra_who":
      if (valid.includes("child")) return "child";
      return unsure ? "unsure" : valid.includes("other") ? "other" : valid.includes("me") ? "self" : "unsure";
    case "extra_amount":
      return valid.includes("more") ? "more" : unsure ? "unsure" : valid.includes("one") ? "one" : "unsure";
    case "extra_which": {
      const meds = new Set(valid.filter((o) => o in values).map((o) => values[o]));
      if (meds.size >= 2) return "yes";
      return unsure ? "unsure" : meds.size === 1 ? "no" : "unsure";
    }
    case "missed_which":
    case "looks_which":
    case "side_which":
      return unsure ? "unsure" : valid.some((o) => o in values) ? "known" : "unsure";
    case "side_since":
      return pick(valid, { since_start: "start", since_change: "change" }, unsure);
    case "stop_since":
      return pick(valid, { today: "today", days: "days", longer: "longer" }, unsure);
  }
}

function pick(valid: readonly string[], map: Record<string, string>, unsure: boolean): string {
  if (unsure) return "unsure";
  for (const o of valid) if (map[o]) return map[o];
  return "unsure";
}

/** The medicines he chose in a medicines question (his medication row ids), or []. */
export function chosenMedicines(optionIds: readonly string[], values: FollowUpValues): string[] {
  return [...new Set(optionIds.filter((o) => o in values).map((o) => values[o]))];
}

/**
 * The follow-up question for an ask (templates.ts FOLLOW_UPS), with his medicines as buttons for a medicines question:
 * `med:<n>` per medicine (the fitting ones first, at most four, so with "Not sure" it stays within five buttons), then the
 * fixed ones. The id is the pending state's (pipeline.ts: `<safety event id>:<pathway>:<step>`).
 */
export function buildFollowUp(
  questionId: FollowUpTemplateId,
  opts: { id: string; step: number; of: number; meds: readonly MedChoice[]; fits?: readonly string[] },
): { followUp: FollowUp; values: FollowUpValues } {
  const q = FOLLOW_UPS[questionId];
  const values: FollowUpValues = {};
  let options: FollowUpOption[] = [...q.options];
  if (q.medicines) {
    const fits = new Set(opts.fits ?? []);
    const ordered = [...opts.meds.filter((m) => fits.has(m.id)), ...opts.meds.filter((m) => !fits.has(m.id))].slice(0, 4);
    // (each button in the answer's language: the Chinese generic name his Mandarin list shows, else the English one)
    const medOptions = ordered.map((m, i): FollowUpOption => {
      const id = `med:${i}`;
      values[id] = m.id;
      return { id, en: m.name, zh: m.nameZh || m.name, tone: "neutral" };
    });
    options = [...medOptions, ...q.options];
  }
  return {
    followUp: {
      id: opts.id,
      pathway: q.pathway,
      step: opts.step,
      of: Math.max(opts.step, opts.of),
      templateId: q.id,
      en: q.en,
      zh: q.zh,
      options,
      ...(q.multi ? { multi: true } : {}),
    },
    values,
  };
}

// ---------------------------------------------------------------- the facts

const symptomsOf = (frame: Frame, kind: FrameSymptom["kind"]) => frame.symptoms.filter((s) => s.kind === kind);

/** "now" of a set of symptoms of one kind: yes if any is now, no if every one is over, else unknown. */
function nowOf(list: FrameSymptom[]): "yes" | "no" | "unknown" {
  if (list.some((s) => s.now === "yes")) return "yes";
  if (list.length > 0 && list.every((s) => s.now === "no")) return "no";
  return "unknown";
}

/** The medicines the frame names that are his (ids of `meds`). */
function knownRefs(frame: Frame, meds: readonly MedChoice[]): string[] {
  const ids = new Set(meds.map((m) => m.id));
  return [...new Set(frame.medicines.map((m) => m.ref).filter((r) => ids.has(r)))];
}

/** A medicine he cannot name, or one not on his list, is in the frame. */
const unnamedRef = (frame: Frame) => frame.medicines.some((m) => m.ref === "unknown");

/** The medicine a message is about: one known (named, or the only one that fits), or unknown. */
function medicineFact(frame: Frame, ctx: DecideContext, fits: readonly string[] = ctx.fits): "known" | "unknown" {
  const refs = knownRefs(frame, ctx.meds);
  if (refs.length === 1 && !unnamedRef(frame)) return "known";
  if (refs.length === 0 && !unnamedRef(frame) && fits.length === 1) return "known";
  return "unknown";
}

/**
 * The frame as far as this message decides its own ladder. A wish, a lethality question or low mood said in an earlier turn
 * (the frame carries it, quoted "turn:<n>": rules-floor.ts and the screen read his last turns) had its own answer then, and
 * now keeps the watch state on (risk/watch.ts), which is how it reaches this message ("any amount with the watch on"). So a
 * frame whose self-harm evidence is all from earlier turns reads here as no self-harm signal and no low mood. A frame with no
 * evidence at all (the evidence check dropped the quotes, or a stored frame: risk/state.ts frameCodes) is taken as this
 * message's: the careful side. The pipeline stores this form with a waiting question, so a reply decides as the question did.
 */
export function messageFrame(frame: Frame): Frame {
  const ev = frame.selfHarm.evidence;
  const onlyEarlier = ev.length > 0 && ev.every((e) => e.from !== "message");
  if (!onlyEarlier) return frame;
  return { ...frame, distress: "no", selfHarm: { ideation: "none", plan: "no", means: "no", soon: "no", lethalityQuestion: "no", evidence: [] } };
}

/**
 * One medicine per word he said. A word that names what a medicine is for (降压药, "my BP pills": rules-floor.ts CLASS_WORDS,
 * or a screen quoting those words) points at every medicine of his of that kind, and the frame lists each of them with the
 * same quote. That is one medicine he did not name, not two (round 2, 10-16: 「我今天早上不小心多吃了一粒降压药。」 read as
 * two medicines taken extra, the 995-now row, where the owner's 10-14 rule is "ask today" and which one is asked). His
 * medicines whose every quote is also another one's collapse into one "unspecified" medicine with those quotes, or into
 * nothing when a medicine he named by its own words is there (that is the one the word meant). A medicine named by its own
 * word stays, and a frame without quotes (a stored one: risk/state.ts frameCodes) is left as it is: the pipeline applies
 * this before a frame is stored.
 */
export function oneMedicinePerWord(frame: Frame): Frame {
  const his = (ref: string) => ref !== "unknown" && ref !== "unspecified";
  const key = (e: { quote: string; from: string }) => `${e.from} | ${e.quote}`;
  const uses = new Map<string, number>();
  for (const m of frame.medicines) if (his(m.ref)) for (const k of new Set(m.evidence.map(key))) uses.set(k, (uses.get(k) ?? 0) + 1);
  const unnamed = (m: Frame["medicines"][number]) => his(m.ref) && m.evidence.length > 0 && m.evidence.every((e) => (uses.get(key(e)) ?? 0) >= 2);
  if (!frame.medicines.some(unnamed)) return frame;
  const kept = frame.medicines.filter((m) => !unnamed(m));
  if (kept.some((m) => his(m.ref))) return { ...frame, medicines: kept };
  const evidence: Frame["medicines"][number]["evidence"] = [];
  for (const m of frame.medicines.filter(unnamed)) for (const e of m.evidence) if (!evidence.some((x) => key(x) === key(e))) evidence.push(e);
  const unspecified = kept.find((m) => m.ref === "unspecified");
  const rest = kept.filter((m) => m !== unspecified);
  return { ...frame, medicines: [...rest, { ref: "unspecified", evidence: [...(unspecified?.evidence ?? []), ...evidence.filter((e) => !unspecified?.evidence.some((x) => key(x) === key(e)))] }] };
}

const SELF_HARM_IDEATION = ["active", "passive", "unclear"];

/**
 * The facts of one message (see the header). `answers` are his answers in the pathway this answer continues; `values` the
 * medicines behind a medicines question's options.
 */
export function deriveFacts(frame: Frame, answers: Answers, ctx: DecideContext, values: FollowUpValues = {}): Facts {
  const history: PathwayHistory = ctx.history ?? { answered: [], unanswered: [] };
  const answered = (q: FollowUpTemplateId): string | undefined => (answers[q] !== undefined ? answerValue(q, answers[q], values) : undefined);
  /** this pathway may ask no more: asked earlier in the conversation (not the one continued), or three answers already */
  const exhausted = (p: PathwayId) => !mayAskIn(p, answers, ctx);
  /**
   * A question's fact: his answer; else what the frame says; else "unsure" when the question went unanswered earlier, or
   * its pathway can ask no more (not for the self-harm questions: see the header); else "unknown".
   */
  const fact = (q: FollowUpTemplateId, fromFrame: string, unknown = "unknown"): string => {
    const a = answered(q);
    if (a !== undefined) return a;
    if (fromFrame !== unknown) return fromFrame;
    const p = pathwayOfQuestion(q);
    if (p !== "self_harm_check" && exhausted(p)) return "unsure";
    return unknown;
  };

  const rulesSignals = ctx.rules.signals;
  const about = (() => {
    const who = answered("extra_who");
    if (who === "child") return "child";
    if (who === "other") return "other";
    if (who === "self") return "self";
    if (rulesSignals.includes("child")) return "child";
    if (rulesSignals.includes("third_person")) return "other";
    return frame.about === "other_adult" ? "other" : frame.about;
  })();

  const facts: Facts = {
    about,
    watch: ctx.watch,
    degraded: ctx.frameSource === "rules",
    distress: frame.distress,
    "asks.amount": ctx.asksAmount,
    "asks.largeAmount": ctx.asksLargeAmount,
    "rules.route": ctx.rules.route ?? "none",
    "rules.now995": !!ctx.rules.now995,
    "rules.selfHarmCue": !!ctx.rules.selfHarmCue,
    ignored: ctx.ignored?.pathway ?? "none",
    "ignored.question": ctx.ignored?.question ?? "none",
  };

  // ---- the self-harm ladder: only what this message says (messageFrame)
  const sh = messageFrame(frame).selfHarm;
  const distressHere = messageFrame(frame).distress;
  facts.distress = distressHere;
  const triggered =
    ctx.rules.route === "self_harm" ||
    SELF_HARM_IDEATION.includes(sh.ideation) ||
    sh.lethalityQuestion !== "no" ||
    sh.means !== "no" ||
    (ctx.watch && ctx.asksAmount) ||
    (ctx.frameSource === "rules" && (distressHere !== "no" || ctx.asksLargeAmount)) ||
    !!ctx.rules.selfHarmCue ||
    ctx.ignored?.pathway === "self_harm_check" ||
    ctx.continuing === "self_harm_check";
  /**
   * A self-harm question's fact: his answer; "unsure" once the question went unanswered and may not be asked again (three
   * asks today) while this message brings self-harm up; else "unknown" (asked, or asked again, when a row asks it)
   */
  const shFact = (q: "self_harm_confirm" | "self_harm_danger"): string => {
    const a = answered(q);
    if (a !== undefined) return a;
    const spent = (history.asks?.self_harm_check ?? 0) >= MAX_QUESTIONS;
    return triggered && spent && history.unanswered.includes(q) && ctx.continuing !== "self_harm_check" ? "unsure" : "unknown";
  };
  Object.assign(facts, {
    "selfHarm.ideation": sh.ideation,
    "selfHarm.plan": sh.plan,
    "selfHarm.means": sh.means,
    "selfHarm.soon": sh.soon,
    "selfHarm.lethalityQuestion": sh.lethalityQuestion,
    "selfHarm.confirm": shFact("self_harm_confirm"),
    "selfHarm.danger": shFact("self_harm_danger"),
    "selfHarm.triggered": triggered,
    // (a self-harm signal in the frame, for whoever it is about: someone else's is answered for them, row
    // self-harm-someone-else. Not an "unclear" wish, which is a question to ask him about himself (「爸爸说不想活在养老院」 is
    // about a nursing home), and saved-up tablets only as "yes": a refill count is not a signal)
    "selfHarm.signal":
      sh.ideation === "active" ||
      sh.ideation === "passive" ||
      sh.means === "yes" ||
      sh.lethalityQuestion !== "no" ||
      sh.plan === "yes" ||
      !!ctx.rules.selfHarmCue ||
      ctx.rules.route === "self_harm",
  });

  // ---- chest
  const chest = symptomsOf(frame, "chest");
  const chestPresent = chest.length > 0 || (rulesSignals.includes("chest") && ctx.rules.route === "emergency") || ctx.continuing === "chest";
  const chestMinutes = chest.map((s) => s.minutes).filter((m): m is number => typeof m === "number");
  const chestRedFlag =
    chest.some((s) => s.severe === "yes") || symptomsOf(frame, "breathing").length > 0 || symptomsOf(frame, "consciousness").length > 0 ? "yes" : "unknown";
  Object.assign(facts, {
    "symptoms.chest": chestPresent,
    "symptoms.chest.now": fact("chest_now", nowOf(chest)),
    "symptoms.chest.long": fact("chest_long", chestMinutes.some((m) => m >= 5) ? "yes" : chestMinutes.length > 0 ? "no" : "unknown"),
    "symptoms.chest.redFlag": fact("chest_with", chestRedFlag),
  });

  // ---- a stroke sign (no question: time-critical)
  const cueOnly = new Set(ctx.cueOnly ?? []);
  const stroke = cueOnly.has("stroke") ? [] : symptomsOf(frame, "stroke");
  Object.assign(facts, {
    "symptoms.stroke": stroke.length > 0 || (rulesSignals.includes("stroke") && ctx.rules.route === "emergency"),
    "symptoms.stroke.now": nowOf(stroke),
  });

  // ---- the other emergencies the rules already send to 995 (classify.ts), so a phrasing only the screen understood is raised
  // the same way: collapse or unresponsive, a severe allergic swelling, bleeding, a sudden worst headache (no question)
  // (a sign only cue words saw still counts when it is over: no 995-now row reads it then, and a faint he has come round
  // from is "see a doctor today", row collapse-passed)
  for (const kind of ["consciousness", "allergy", "bleeding"] as const) {
    const all = symptomsOf(frame, kind);
    const list = cueOnly.has(kind) && !(all.length > 0 && all.every((x) => x.now === "no")) ? [] : all;
    facts[`symptoms.${kind}`] = list.length > 0;
    facts[`symptoms.${kind}.now`] = nowOf(list);
  }
  const headache = cueOnly.has("headache") ? [] : symptomsOf(frame, "headache");
  facts["symptoms.headache.worst"] = headache.some((s) => s.severe === "yes" && s.sudden === "yes" && s.now !== "no");

  // ---- breathing
  const breathing = symptomsOf(frame, "breathing");
  const breathingAtRest = breathing.some((s) => s.severe === "yes") ? "yes" : breathing.length > 0 && breathing.every((s) => s.now === "no") ? "no" : "unknown";
  Object.assign(facts, {
    "symptoms.breathing": breathing.length > 0 || ctx.continuing === "breathing",
    "symptoms.breathing.atRest": fact("breathing_rest", breathingAtRest),
    "symptoms.breathing.blue": fact("breathing_blue", "unknown"),
  });

  // ---- a reading above his doctor's line, or very high (B1-10: 180 or more on top, 110 or more below)
  // A red flag with it makes it 995 now (B1-10, MOH; round 2, 10-16, the coordinator's list): breathlessness, trouble
  // seeing, sickness or vomiting, confusion or drowsiness, a splitting headache, a stroke sign. Chest pain beside a reading
  // is the owner's 10-14 rule (kept for his doctor, 995 if it gets bad: the chest rows, which E1's floor makes 995 now with a
  // reading of 200 or more); a headache counts when it is severe (the floor reads 头痛得要裂开, "splitting")
  const veryHigh = !!ctx.readingVeryHigh;
  const notOver = (list: FrameSymptom[]) => list.some((s) => s.now !== "no");
  const readingRedFlag =
    rulesSignals.includes("high_bp_symptom") ||
    breathing.length > 0 ||
    stroke.length > 0 ||
    symptomsOf(frame, "consciousness").length > 0 ||
    symptomsOf(frame, "headache").some((s) => s.severe === "yes" && s.now !== "no") ||
    notOver(symptomsOf(frame, "other").filter(() => veryHigh)) ||
    (veryHigh && !!ctx.readingSignWords)
      ? "yes"
      : "unknown";
  Object.assign(facts, {
    "reading.aboveLine": ctx.readingAboveLine || veryHigh || ctx.continuing === "reading_high",
    "reading.redFlag": fact("reading_redflags", readingRedFlag),
  });

  // ---- more of a medicine than the label, already taken
  const taken = frame.when === "now" || frame.when === "today" || frame.when === "past";
  // (a frame's amount counts only as something that happened: an event, today or before; a question about taking two is
  // the dose question it is. The live screen, 10-16, gives amounts and times loosely)
  // (a child who swallowed any of his tablets is the pathway whatever the amount: row extra-dose-child, B1-12)
  const extraPresent =
    (frame.amount.relation !== "none" && taken && frame.acts.includes("event")) ||
    (about === "child" && taken && frame.acts.includes("event") && frame.medicines.length > 0) ||
    ctx.rules.reason === "rule:extra_dose_taken" ||
    (rulesSignals.includes("overdose") && ctx.rules.route === "emergency") ||
    ctx.continuing === "extra_dose";
  const relation = frame.amount.relation;
  const amountFromFrame = relation === "extra_one" || relation === "double" ? "one" : relation === "extra_more" || relation === "all" || relation === "far_beyond" ? "more" : "unknown";
  const whoFromFrame = about === "self" ? "self" : about === "child" ? "child" : about === "other" ? "other" : "unknown";
  const refs = knownRefs(frame, ctx.meds);
  const severalFromFrame = refs.length >= 2 ? "yes" : (refs.length === 1 && !unnamedRef(frame)) || (refs.length === 0 && !unnamedRef(frame) && ctx.fits.length === 1) ? "no" : "unknown";
  // taken on purpose: a self-harm signal says yes, his words saying it was a mistake say no (DecideContext.accidental), else
  // the question (the last of the pathway). A pathway that may ask no more never makes it "not sure": the limit is not
  // his answer
  const onPurpose = (() => {
    const a = answered("extra_purpose");
    if (a !== undefined) return a;
    if (sh.ideation === "active" || sh.ideation === "passive" || sh.plan === "yes") return "yes";
    if (ctx.accidental) return "no";
    return mayAskIn("extra_dose", answers, ctx) ? "unknown" : "no";
  })();
  Object.assign(facts, {
    extra_dose: extraPresent,
    "extra_dose.who": fact("extra_who", whoFromFrame),
    "extra_dose.amount": fact("extra_amount", amountFromFrame),
    "extra_dose.symptoms": fact("extra_symptoms", frame.symptoms.length > 0 ? "yes" : "unknown"),
    "extra_dose.several": fact("extra_which", severalFromFrame),
    "extra_dose.onPurpose": onPurpose,
  });

  // ---- a missed dose; a medicine that looks different; a possible side effect; stopping or changing a medicine
  const medicine = medicineFact(frame, ctx);
  // (only a look said to have changed: the live screen, 10-16, answered "unclear" for messages about nothing of the kind, and
  // the evidence check turns an unquoted "yes" into "unclear": neither is a pharmacist referral)
  const looksPresent = frame.looksDifferent === "yes" || ctx.continuing === "looks_different";
  const sideRedFlag = ["allergy", "consciousness", "breathing", "chest", "stroke"].some((k) => symptomsOf(frame, k as FrameSymptom["kind"]).length > 0) ? "yes" : "unknown";
  const stopPresent = frame.stopOrChange !== "none" || ctx.continuing === "stop_change";
  const stopped = frame.stopOrChange === "done" ? "yes" : frame.stopOrChange === "asked" ? "no" : "unknown";
  const stopRefs = refs.length ? refs : ctx.fits;
  const bpOf = (id: string) => {
    const m = ctx.meds.find((x) => x.id === id);
    return !!m?.drugId && BP_DRUG_IDS.includes(m.drugId);
  };
  const bpMedicine = stopRefs.some(bpOf) ? "yes" : stopRefs.length > 0 && !unnamedRef(frame) ? "no" : "unclear";
  Object.assign(facts, {
    missed_dose: ctx.missedDose || ctx.continuing === "missed_dose",
    "missed_dose.medicine": fact("missed_which", medicineFact(frame, ctx, ctx.fits.length ? ctx.fits : (ctx.due ?? []))),
    looks_different: looksPresent,
    "looks_different.medicine": fact("looks_which", medicine),
    side_effect: (ctx.sideEffect && !extraPresent) || ctx.continuing === "side_effect",
    "side_effect.redFlag": fact("side_redflags", sideRedFlag),
    "side_effect.medicine": fact("side_which", medicine),
    "side_effect.since": fact("side_since", "unknown"),
    stop_change: stopPresent,
    "stop_change.stopped": fact("stop_already", stopped),
    "stop_change.since": fact("stop_since", "unknown"),
    "stop_change.bpMedicine": bpMedicine,
  });
  return facts;
}

/** How many of a pathway's questions he has answered in this answer's sequence. */
export function answeredIn(pathway: PathwayId, answers: Answers): number {
  return PATHWAY_QUESTIONS[pathway].filter((q) => answers[q] !== undefined).length;
}

/**
 * Whether a pathway may still ask in this conversation: not answered earlier (unless this answer continues it), and fewer
 * than three questions asked today (a question he left unanswered counts as asked).
 */
export function mayAskIn(p: PathwayId, answers: Answers, ctx: Pick<DecideContext, "history" | "continuing">): boolean {
  const h = ctx.history;
  if (h?.answered.includes(p) && ctx.continuing !== p) return false;
  return Math.max(h?.asks?.[p] ?? 0, answeredIn(p, answers)) < MAX_QUESTIONS;
}

/** Whether this question may be asked now (mayAskIn, and the question itself not answered in this sequence). */
export function mayAsk(questionId: FollowUpTemplateId, answers: Answers, ctx: Pick<DecideContext, "history" | "continuing">): boolean {
  if (answers[questionId] !== undefined) return false;
  return mayAskIn(pathwayOfQuestion(questionId), answers, ctx);
}

/** The most questions this pathway may still come to: what it has asked plus the questions whose facts are unknown. */
export function questionsAhead(pathway: PathwayId, answers: Answers, facts: Facts): number {
  const done = answeredIn(pathway, answers);
  const open = PATHWAY_QUESTIONS[pathway].filter((q) => answers[q] === undefined && facts[QUESTION_FACT[q]] === "unknown").length;
  return Math.min(MAX_QUESTIONS, done + open);
}

/** Short typed answers that mean one of the fixed buttons ("yes", 「没有」, "not sure"), lowercased, marks dropped. */
const TYPED: Record<string, string[]> = {
  yes: ["yes", "yeah", "yep", "ya", "yah", "y", "ok yes", "yes lah", "是", "是的", "对", "對", "有", "有的", "还在", "還在", "还痛", "還痛"],
  no: ["no", "nope", "nah", "n", "no lah", "not really", "没有", "沒有", "没", "沒", "不是", "无", "無", "冇", "没有啊", "沒有啊"],
  unsure: ["not sure", "dont know", "don't know", "i dont know", "i don't know", "unsure", "dunno", "不确定", "不確定", "不知道", "不清楚", "唔知"],
  rather_not: ["i'd rather not say", "id rather not say", "rather not say", "rather not", "prefer not to say", "不想说", "不想說", "不要问", "不要問"],
};

/** Which option a typed yes / no / not sure stands for in a question (the multi-select sign lists read "no" as "none"). */
const TYPED_OPTION: Partial<Record<FollowUpTemplateId, Record<string, string>>> = {
  chest_now: { yes: "yes", no: "gone", unsure: "unsure" },
  chest_with: { no: "none", unsure: "unsure" },
  breathing_rest: { yes: "yes", no: "no", unsure: "unsure" },
  breathing_blue: { yes: "yes", no: "no", unsure: "unsure" },
  reading_redflags: { no: "none", unsure: "unsure" },
  extra_symptoms: { no: "none", unsure: "unsure" },
  side_redflags: { no: "none", unsure: "unsure" },
  stop_already: { yes: "yes", no: "not_yet", unsure: "unsure" },
  self_harm_confirm: { yes: "yes", no: "no", unsure: "rather_not", rather_not: "rather_not" },
  extra_purpose: { unsure: "rather_not", rather_not: "rather_not" },
  self_harm_danger: { yes: "yes", no: "no", unsure: "rather_not", rather_not: "rather_not" },
};

/**
 * Typed or spoken words that are one of the pending question's buttons: the button's own words in either language, or a
 * short yes / no / not sure (TYPED). Anything longer is read as a message (its frame may still answer the question:
 * optionsForFact). Returns the option ids, or null.
 */
export function typedOption(followUp: Pick<FollowUp, "templateId" | "options">, text: string): string[] | null {
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s.,!?。，！？、~～…'"“”]+/g, " ").trim();
  const t = norm(text);
  if (!t || t.length > 40) return null;
  const exact = followUp.options.find((o) => norm(o.en) === t || norm(o.zh) === t);
  if (exact) return [exact.id];
  if (!isQuestionId(followUp.templateId)) return null;
  const map = TYPED_OPTION[followUp.templateId];
  if (!map) return null;
  for (const [kind, words] of Object.entries(TYPED)) {
    if (words.some((w) => norm(w) === t) && map[kind]) return [map[kind]];
  }
  return null;
}

/**
 * The typed-words reply (pipeline.ts): his new message answers the pending question when the frame of it fills that
 * question's fact (a definite value: not unknown, not unsure). Returns the option ids that stand for that value, or null.
 */
export function optionsForFact(questionId: FollowUpTemplateId, value: FactValue): string[] | null {
  if (value === "unknown" || value === "unsure" || typeof value !== "string") return null;
  const table: Partial<Record<FollowUpTemplateId, Record<string, string[]>>> = {
    chest_now: { yes: ["yes"], no: ["gone"] },
    chest_long: { yes: ["over5"], no: ["under5"] },
    chest_with: { yes: ["sweat"], no: ["none"] },
    breathing_rest: { yes: ["yes"], no: ["no"] },
    reading_redflags: { yes: ["headache_vision"], no: ["none"] },
    extra_who: { self: ["me"], child: ["child"], other: ["other"] },
    extra_amount: { one: ["one"], more: ["more"] },
    extra_symptoms: { yes: ["dizzy_faint"] },
    side_redflags: { yes: ["swelling"] },
    stop_already: { yes: ["yes"], no: ["not_yet"] },
    self_harm_confirm: { yes: ["yes"] },
    extra_purpose: { yes: ["purpose"], no: ["mistake"] },
    self_harm_danger: { yes: ["yes"] },
  };
  return table[questionId]?.[value] ?? null;
}

/**
 * Whether his words ask about an amount of a medicine (pipeline.ts, on every reading of his words: normalize.ts):
 *   any    how many, how much, two tablets, double, half, 几粒, 多少, 两粒, 半粒 ... (with the watch state on, any of these is
 *          the confirm question first: the row self-harm-watch-amount);
 *   large  the most, the maximum, too many, too much, at once, in one go, all of them, a whole strip, 最多, 太多, 一次吃完,
 *          全部, 整瓶 (with no model to read his words, these alone are asked about: self-harm-degraded-amount).
 * An ordinary dose question ("can I take two?", 「能不能多吃一粒？」) is "any" but never "large".
 */
const AMOUNT_ANY: RegExp[] = [
  /\bhow\s+(?:many|much)\b|\b(?:two|2|three|3|several|a few|more|extra|double|half)\s+(?:of\s+(?:my|the|these|those|them)\s+)?(?:pills?|tablets?|capsules?|doses?|ones)\b|\bdouble\s+(?:the\s+|my\s+)?dose\b|\b(?:most|max(?:imum)?)\b[^.?!]{0,30}\b(?:pills?|tablets?|dose|amlodipine|losartan|take)\b/i,
  /几(?:粒|片|颗|顆)|多少(?:粒|片|颗|顆|药|藥)?|(?:两|兩|二|2|三|3|半)(?:粒|片|颗|顆)|多吃|双倍|雙倍|加倍|最多/,
];
const AMOUNT_LARGE: RegExp[] = [
  /\b(?:the\s+)?(?:most|max(?:imum)?|highest)\b[^.?!]{0,40}\b(?:at once|in one go|one go|at one time|together|in a day)?|\btoo\s+(?:many|much)\b|\b(?:at once|in one go|all at once|all together)\b|\ball\s+(?:of\s+)?(?:my|the|them|these|those)\s+(?:pills?|tablets?|medicines?)?|\b(?:whole|entire)\s+(?:strip|box|bottle|pack|packet)\b/i,
  /最多|太多|过量|過量|一次(?:性)?(?:吃|服|吞)(?:完|光|下)|全部(?:吃|服|吞)|整(?:瓶|盒|板|包)|一把/,
];

export function amountQuestion(variants: readonly string[], isQuestionText: boolean): { any: boolean; large: boolean } {
  if (!isQuestionText) return { any: false, large: false };
  const hit = (res: RegExp[]) => variants.some((v) => res.some((re) => re.test(v)));
  const large = hit(AMOUNT_LARGE);
  return { any: large || hit(AMOUNT_ANY), large };
}
