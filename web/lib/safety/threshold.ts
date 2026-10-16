/**
 * THE RULE for the doctor's blood pressure numbers (C2 track S, round 2; real-app 2.9 lines 177-180, 6.5 line 1164, 6.7
 * line 1185, and the two must-fix rows 1632 and 1657). One reader for each kind, lib/visit/doctor-numbers.ts:
 *
 *   A. Where safety depends on the line: the latest warning line said at a visit that happened, reviewed or not
 *      (doctorNumbers().emergency, here warningLineOf / warningLineFor). An unreviewed line is never dropped: it is shown
 *      labelled as inferred (推断：医生 / 好像是医生说的), never as 医生说; a line he marked "not right" in the review stays on
 *      this path too (row 1657), labelled the same way, and the brief says he marked it. The three places:
 *        - the blood pressure page, next to a reading above it: the doctor's words, then 995 if he feels very unwell
 *          (relayDoctorThreshold)
 *        - an ask that names such a reading: the same two lines in the same order, with the sentence that says the reading
 *          is kept for his doctor between them; an ask that names one of the line's symptoms (chest pain, a stroke sign):
 *          that sentence, the doctor's words, then 995 if it gets bad (pipeline.ts, warningLine; 10-14, the owner's decision)
 *        - the brief for the doctor: every reading above it on a line of its own, under the same sentence with the same
 *          label (lib/summary/account-brief.ts `above`)
 *      They read the same line through this module, so the page, the answer and the brief cannot disagree, before or
 *      after he reviews the visit.
 *   B. Where a number is only compared or counted: the target he confirmed, and nothing before he confirmed one
 *      (doctorNumbers().target): the comparison line of the blood pressure page and "N not below" in the brief
 *      (line 177: 没有确认过就只记录，不比较). An unreviewed target is not a safety matter, and counting readings against a
 *      number nobody confirmed would be the app's own judgement.
 *   Nothing here or there judges a reading (no high, normal or dangerous), and no other number is ever a line.
 *
 * The doctor's own warning line next to a reading he records (C2: track S provides it, track B's blood pressure page
 * calls it; real-app 2.9, e2e-chains.md 16.1, overnight-loop 10-09 「他记的血压超过医生说过的警示线时，马上转述医生那句原话，
 * 挂日期和录音时间点，加 995」). Server-only.
 *
 * relayDoctorThreshold(store, scope, reading) answers, for a reading he has just recorded:
 *   - null when no visit has given a warning number yet, or the reading is not above it;
 *   - otherwise two lines, in the order the screen shows them (the first and the last /api/ask gives for 「我刚量了
 *     185/112」). 10-14, the owner's decision: a number above the doctor's own line is not chest pain or a stroke sign, and
 *     the 995 sentence came too early there, so his doctor's words and their recording come first:
 *       1. the doctor's own words, whole and word for word, with the visit date, the time point in the recording and the
 *          clip (cite.clipUrl; cite.standInVoice + clipLabel 代录音 for a stand-in voice), attributed "doctor", with
 *          cite.roleState "confirmed" (医生说) or "inferred" (推断：医生) as he left it in the visit review. On the
 *          Chinese page, with his consent to AI processing, the line carries its checked Chinese translation
 *          (Sentence.translation, lib/translate/shown.ts) for the page to show under the English words;
 *       2. after them the fixed template signal_995_unwell, cited to referrals.json B1-01: 995 or the nearest A&E if he feels
 *          very unwell (10-14, the owner's second decision that day: no longer the unconditional "Call 995 now"; the
 *          reading is a sign for his doctor, listed by lib/daily/signals.ts from the reading itself).
 * Which warning line: lib/visit/doctor-numbers.ts (track F) `emergency`: the latest one said at a visit that happened by
 * the story moment, also when he has not reviewed it yet or said it was "not right" (real-app 12: the emergency path keeps
 * it; `disputed` is passed on). The comparison uses the doctor's own number only (the upper number, strictly above:
 * "above 180 on top"); no other number, and nothing here judges the reading (no high, normal or dangerous: readings are
 * never judged). Both lines go through the safety layer's checks (verify.ts, layers 1 and 2) before they are returned; a
 * line that fails is a bug, logged, and the answer is then null.
 *
 * warningLine(): the same doctor line as a Sentence and its Candidate, for /api/ask's emergency answer (pipeline.ts), so
 * the ask and the blood pressure page always quote the same sentence with the same label.
 */
import type { SessionRow, Store } from "@/lib/store/types";
import { doctorNumbers, type DoctorNumber, type DoctorNumbers } from "@/lib/visit/doctor-numbers";
import { clipFor, clipUrlFor, locateLine, referralCandidate, templateCandidate } from "./candidates";
import { clinicianAttribution, type StoryMoment } from "./line-state";
import { emergencyReferralFor, SIGNAL_995, TEMPLATES } from "./templates";
import type { Candidate, Citation, Locale, Sentence } from "./types";
import { zhLookup } from "@/lib/translate/shown";
import { verifySentences } from "./verify";

export interface ThresholdReading {
  systolic: number;
  diastolic?: number | null;
}

export interface ThresholdRelay {
  reading: { systolic: number; diastolic: number | null };
  /** the doctor's warning number the reading is above, and how the line stands in his review */
  threshold: { systolic: number; visitId: string; visitDate: string; state: "confirmed" | "inferred"; disputed: boolean };
  /** the fixed template after the doctor's words: 995 when he feels very unwell (signal_995_unwell; 10-14) */
  template: Sentence;
  /** the doctor's own words */
  doctorLine: Sentence;
  /** [doctorLine, template]: the order to show them in (10-14: the doctor's words first, the 995 sentence after them) */
  lines: Sentence[];
}

const STAND_IN_DIR = "visits/clips/";

/** Rule A's line out of numbers already read: the warning line for every place where safety depends on it. */
export function warningLineOf(numbers: Pick<DoctorNumbers, "emergency">): DoctorNumber | null {
  return numbers.emergency;
}

/** Rule A's line, read from the scope (`at`: the story moment; a visit the clock has not reached does not count). */
export async function warningLineFor(store: Store, scopeId: string, at?: StoryMoment): Promise<DoctorNumber | null> {
  return warningLineOf(await doctorNumbers(store, scopeId, at));
}

/** How rule A's line stands in his review: he confirmed it, he has not reviewed it yet, or he marked it "not right". */
export function reviewOf(line: Pick<DoctorNumber, "state" | "disputed">): "confirmed" | "inferred" | "disputed" {
  return line.disputed ? "disputed" : line.state === "confirmed" ? "confirmed" : "inferred";
}

/** The doctor's warning line as /api/ask cites it: the Candidate (for the checks) and the Sentence (for the screen). */
export function warningLine(scope: Pick<SessionRow, "id" | "kind">, line: DoctorNumber, locale: Locale): { candidate: Candidate; sentence: Sentence } {
  // the transcript line when this scope holds one; the demo seed's visit that was never replayed: the replay fixture's
  // line with the same words (its time point and stand-in clip), as candidates.ts does for R1-R4
  const found = line.utteranceId ? null : locateLine(line.visitId, line.text, []);
  const utteranceId = line.utteranceId ?? found?.utteranceId;
  const tStartMs = line.tStartMs ?? found?.tStartMs;
  const clipPath = line.clipPath ?? (line.utteranceId ? clipFor(line.utteranceId) : found?.clipPath) ?? undefined;
  const standIn = clipPath ? clipPath.includes(STAND_IN_DIR) : undefined;
  const cite: Citation = {
    visitId: line.visitId,
    day: line.visitDay,
    date: line.visitDate,
    ...(line.requiredLine ? { requiredLine: line.requiredLine } : {}),
    ...(utteranceId ? { utteranceId } : {}),
    ...(tStartMs !== undefined && tStartMs !== null ? { tStartMs } : {}),
    ...(clipPath ? { clipPath, standInVoice: standIn } : {}),
    ...(clipPath && utteranceId ? { clipUrl: clipUrlFor(scope, line.visitId, utteranceId) } : {}),
    ...(standIn ? { clipLabel: locale === "zh-Hans" ? "代录音" : "stand-in recording" } : {}),
    role: line.speaker === "doctor" || line.speaker === "dispenser" || line.speaker === "pharmacist" ? line.speaker : "unknown",
    roleState: line.state,
  };
  const attribution = clinicianAttribution(line.speaker);
  const candidate: Candidate = {
    sourceId: `visit:${line.visitId}:${line.requiredLine ?? line.itemId}`,
    kind: "visit",
    span: line.text,
    attribution,
    topics: ["threshold"],
    instruction: true,
    cite,
  };
  const sentence: Sentence = {
    speechAct: "restate",
    sourceId: candidate.sourceId,
    span: line.text,
    slots: {},
    en: line.text,
    attribution,
    origin: "span",
    cite,
  };
  return { candidate, sentence };
}

/**
 * The fixed template after the doctor's words, cited to its referral row. 10-14 (the owner's decision: the 995 sentence was
 * too absolute): the sentence for a reading above the doctor's line, 995 when he feels very unwell (signal_995_unwell, the
 * one an ask that names such a reading ends with: pipeline.ts); the reading is a sign for his doctor (lib/daily/signals.ts
 * lists it from the reading itself).
 */
function templateLine(referralId: string): { candidate: Candidate; sentence: Sentence } {
  const t = TEMPLATES[SIGNAL_995.reading];
  const candidate = referralCandidate(referralId) ?? templateCandidate(t);
  return {
    candidate,
    sentence: { speechAct: t.speechAct, sourceId: candidate.sourceId, span: candidate.span, slots: {}, en: t.en, zh: t.zh, origin: "template", templateId: t.id, cite: candidate.cite },
  };
}

/**
 * The doctor's warning line, then the 995 sentence for when he feels very unwell, when `reading` is above the doctor's own
 * warning number (see the header), else null. `at`: the story moment (default the scope's own: its story day and clock time).
 */
export async function relayDoctorThreshold(
  store: Store,
  scope: SessionRow,
  reading: ThresholdReading,
  opts: { locale?: Locale; at?: StoryMoment } = {},
): Promise<ThresholdRelay | null> {
  const systolic = Number(reading.systolic);
  if (!Number.isFinite(systolic)) return null;
  const at: StoryMoment = opts.at ?? { day: scope.story_day, time: scope.story_time ?? null };
  const line = await warningLineFor(store, scope.id, at);
  if (!line || !(systolic > line.systolic)) return null;
  const locale = opts.locale ?? "zh-Hans";
  const doctor = warningLine(scope, line, locale);
  const template = templateLine(emergencyReferralFor(["above_doctor_threshold"]));
  // the same checks as every answer line (layers 1 and 2: whole verbatim quote, numbers in the source, directive by the
  // doctor); a quote and a template never need the checker model
  const { verdicts } = await verifySentences([template.sentence, doctor.sentence], {
    candidates: new Map([
      [template.candidate.sourceId, template.candidate],
      [doctor.candidate.sourceId, doctor.candidate],
    ]),
    checker: null,
    checkerReason: "a quote and a template need no checker",
  });
  const failed = verdicts.filter((v) => !v.pass);
  if (failed.length) {
    console.error("[safety] the warning line relay failed a check", failed.map((v) => [v.sentence.sourceId, v.layer1.reasons, v.layer2?.reasons]));
    return null;
  }
  // C2 round 2: the checked Chinese of the doctor's English words, when there is one, under them (never in their place)
  const zh = (await zhLookup(store, scope, { locale }))(line.text);
  if (zh) doctor.sentence.translation = { lang: "zh-Hans", text: zh };
  const diastolic = reading.diastolic === undefined || reading.diastolic === null || !Number.isFinite(Number(reading.diastolic)) ? null : Number(reading.diastolic);
  return {
    reading: { systolic, diastolic },
    threshold: { systolic: line.systolic, visitId: line.visitId, visitDate: line.visitDate, state: line.state, disputed: line.disputed },
    template: template.sentence,
    doctorLine: doctor.sentence,
    lines: [doctor.sentence, template.sentence],
  };
}
