/**
 * The guided safety harness (owner 2026-10-16: 「伤害性的言论检索仅仅靠文字匹配是远远不够的……995、药、其他询问都应该有工程化的
 * 引导的 harness，而不是直接匹配一下就开始回答」; the research report D:/ripple-c2/audit/safety-harness-1016/ and its priority
 * table, which the owner said to build in order). This file is the contract the engine, the screens and the eval share.
 *
 * The shape of one answer:
 *   1. his words are normalised (spaced letters, digits for letters, misspellings of the crisis words) and the rules run on
 *      both forms: the rules are the FLOOR, they can raise a risk and never lower one;
 *   2. the risk screen (one model, a deliberately sensitive prompt: "when unsure and it could be serious, raise it") reads
 *      his message WITH the last ~10 turns of his conversation and his watch state, and fills a Frame: who, what, which
 *      medicine, how much, when, symptoms (still happening now? how long?), the self-harm dimensions, what is missing; every
 *      field quotes his words as evidence;
 *   3. the evidence is checked ASYMMETRICALLY: a field that would LOWER the risk must quote his words exactly or it counts as
 *      unknown; a field that would RAISE it and cannot be checked becomes "possible" (asked about), never dropped;
 *   4. code decides with the decision table (kb/pathways.json): every row has a level, the fixed lines it shows, its source
 *      and its review state. The model never decides a level;
 *   5. when the table needs a fact nobody said, the answer carries ONE scripted follow-up question (FollowUp) with buttons;
 *      995 and the helplines, when they may apply, are shown above it first; no answer, "not sure" or "prefer not to say"
 *      counts as the more dangerous side; a pathway asks at most three questions;
 *   6. the self-harm ladder sits beside the medical levels: possible -> a confirm question; thoughts, no immediate danger ->
 *      SOS 1767 / CareText / mindline 1771, his family told (owner 10-16: 「也通知女儿」), and Ripple keeps inviting him to
 *      talk; immediate danger (thoughts + a plan + the means + within 24 hours, or he says so) -> 995 as well;
 *   7. a watch state follows him across turns and days (derived from his own recent safety records): with it, any question
 *      about how much medicine is too much goes up the ladder, not to the doctor's question list;
 *   8. with no model (offline, the spend cap, no AI consent, a timeout) the pathways still run: they are code and buttons.
 */
import type { Locale } from "../types";

/** The medical levels of the decision table. */
export type MedicalLevel =
  /** call 995 now (or the nearest A&E); his family is told */
  | 1
  /** today: his pharmacist or doctor today, with the signs that mean 995 instead */
  | 2
  /** kept for his doctor, with the signs that mean 995 */
  | 3
  /** an ordinary answer from his sources */
  | 4;

/** The self-harm ladder (beside the medical levels; the higher of the two decides what is shown first). */
export type LadderStep =
  /** nothing points to self-harm */
  | "none"
  /** something may: ask him (the confirm question), helplines visible */
  | "possible"
  /** thoughts of dying or self-harm, no immediate danger: helplines, family told, keep talking */
  | "thoughts"
  /** immediate danger: 995 and the helplines, family told */
  | "danger";

export type Tri = "yes" | "no" | "unclear";

/** Words of his the model quotes for a field (checked against his message and the turns it was shown). */
export interface Evidence {
  quote: string;
  /** which text it is from: "message" (this message) or "turn:<n>" (n turns back, 1 = the one before) */
  from: string;
}

export interface FrameSymptom {
  kind: "chest" | "stroke" | "breathing" | "bleeding" | "allergy" | "consciousness" | "headache" | "dizziness" | "swelling" | "other";
  /** still happening now */
  now: Tri;
  /** how long it has gone on, minutes, when he said */
  minutes: number | null;
  /** worst ever, crushing, very bad, getting worse */
  severe: Tri;
  sudden: Tri;
  evidence: Evidence[];
}

/** What the risk screen understood of one message in its conversation. Every field is a fact he said, or unknown. */
export interface Frame {
  /** whose situation it is */
  about: "self" | "other_adult" | "child" | "unclear";
  acts: ("question" | "symptom" | "event" | "change_request" | "emotion" | "other")[];
  /** his medicines it is about: an id from his list, "unknown" (a medicine not on it) or "unspecified" */
  medicines: { ref: string; evidence: Evidence[] }[];
  /** an amount relative to his label */
  amount: { relation: "extra_one" | "extra_more" | "double" | "all" | "far_beyond" | "unknown" | "none"; evidence: Evidence[] };
  /** when what he describes happened */
  when: "now" | "today" | "past" | "hypothetical" | "unclear";
  symptoms: FrameSymptom[];
  /** a medicine's look changed (colour, shape, marking): a possible dispensing error */
  looksDifferent: Tri;
  /** stopping or changing a medicine: asked, done already, or suggested by someone else */
  stopOrChange: "asked" | "done" | "suggested_by_other" | "none";
  selfHarm: {
    /** active (wants to die / end it), passive (would not mind not waking up, joining the dead), none, unclear */
    ideation: "active" | "passive" | "none" | "unclear";
    plan: Tri;
    /** has the means at hand, stockpiling included */
    means: Tri;
    /** within the next 24 hours */
    soon: Tri;
    /** asks how much medicine would kill, is too much at once, the most in one go */
    lethalityQuestion: Tri;
    evidence: Evidence[];
  };
  /** low mood, hopelessness, being a burden, loneliness: the watch state's first sign */
  distress: Tri;
  /** the facts the table needs that he has not said ("medicine", "amount", "now", "symptoms" ...) */
  missing: string[];
}

/** Where a frame came from: the screen model, the rules (offline / no model / timeout), or both. */
export type FrameSource = "model" | "rules" | "model+rules";

/**
 * The guided pathways. Each asks at most three fixed questions, red flags first, and stops at the first answer that settles
 * the level (a "yes" to a danger question, or "not sure" there).
 */
export type PathwayId =
  /** chest pain or pressure: still now? how long? sweat / breathless / spreading? */
  | "chest"
  /** breathing trouble: now? at rest? lips blue? */
  | "breathing"
  /** a reading above his doctor's line: a severe or sudden symptom with it? */
  | "reading_high"
  /** more of a medicine than the label: which, how many, who, a symptom now, on purpose? */
  | "extra_dose"
  /** a missed dose: which medicine, when it was due */
  | "missed_dose"
  /** a medicine looks different: which one, then the pharmacist before he takes it */
  | "looks_different"
  /** a possible side effect: which medicine, since when, a red flag with it? */
  | "side_effect"
  /** stopping or changing a medicine (his idea or someone else's): stopped already? since when? */
  | "stop_change"
  /** the self-harm ladder's confirm and danger questions */
  | "self_harm_check";

export interface FollowUpOption {
  id: string;
  en: string;
  zh: string;
  /** how the button is drawn: danger (the 995 side), neutral, or the calm side */
  tone?: "danger" | "neutral" | "calm";
}

/**
 * One scripted follow-up question on an answer (the screen draws it under the answer's lines, 995 and the helplines above
 * it when they may apply). The reply is a new POST /api/ask whose `reply` names this id and the chosen option ids, and whose
 * `text` is the chosen option's words (so his conversation shows his tap as his words). Typed or spoken words instead of a
 * tap are read as a new message; when they answer the question the engine takes them as the reply, otherwise the question's
 * fact stays unknown (the more dangerous side).
 */
export interface FollowUp {
  /** opaque: names the pending pathway state (the asking safety record and the step); the reply must carry it */
  id: string;
  pathway: PathwayId;
  /** 1-based step, and the most this pathway asks */
  step: number;
  of: number;
  /** the fixed question (templates.ts), both languages */
  templateId: string;
  en: string;
  zh: string;
  /** 2 to 5 options; one of them is always "not sure" or "prefer not to say" */
  options: FollowUpOption[];
  /** more than one option may be chosen (a short list of signs) */
  multi?: boolean;
}

/** His answer to a follow-up (AskInput.reply, the body's `reply`). */
export interface FollowUpReply {
  followUpId: string;
  optionIds: string[];
}

/** What the harness decided for one answer (AskResult.risk: the backstage and the eval read it; never his screen). */
export interface RiskSummary {
  level: MedicalLevel;
  ladder: LadderStep;
  /** the decision table row ids that fired, in order */
  rows: string[];
  /** where the frame came from, and why the model's was not used when it was not */
  frameSource: FrameSource;
  screen?: { provider: string; model: string; ms: number; error?: string };
  /** the frame's codes only (no free text of the model's), for the record */
  frame?: Frame;
  /** fields whose evidence did not check: dropped to unknown (lowering) or kept as possible (raising) */
  evidenceMisses?: { field: string; effect: "to_unknown" | "to_possible" }[];
  /** the watch state as it stood for this answer */
  watch: { on: boolean; since?: string; reason?: string };
  /** his family was told (lib/care/told.ts) */
  familyTold?: boolean;
  /** a follow-up was asked (its pathway and step) */
  followUp?: { pathway: PathwayId; step: number };
}

/**
 * One row of the decision table (web/kb/pathways.json). `when` is a conjunction over frame fields and follow-up answers
 * (paths like "symptoms.chest.now", "selfHarm.lethalityQuestion", "reply.extra_dose.who"); a value list means any of them.
 * The first row (in file order) whose `when` holds decides; rows are ordered most dangerous first.
 */
export interface PathwayRow {
  id: string;
  pathway: PathwayId | "general";
  when: Record<string, string | number | boolean | (string | number | boolean)[]>;
  level?: MedicalLevel;
  ladder?: LadderStep;
  /** fixed template ids shown, in order */
  show: string[];
  /** the next follow-up question's template id, when the row asks instead of deciding */
  ask?: string;
  /** a question goes on his list, and for whom */
  question?: "doctor" | "pharmacist";
  notifyFamily?: boolean;
  /** where the row comes from (a referrals.json id, a public page) */
  source: string;
  /** "pending_clinician" until a pharmacist or doctor has signed the row */
  review: "pending_clinician" | "signed";
  note?: string;
}

export interface RiskScreenInput {
  message: string;
  /** his last turns of the conversation, oldest first: his words and what Ripple showed him (text only) */
  turns: { role: "patient" | "ripple"; text: string }[];
  /** his medicines (id, the name he would use, how it looks when known) */
  meds: { id: string; name: string; looks?: string }[];
  watch: boolean;
  locale: Locale;
}
