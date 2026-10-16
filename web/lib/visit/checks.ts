/**
 * Yellow "Check" cards (v3 design): what he says does not match his own records, or he is vague and
 * Ripple has the detail. Ripple only checks him against his own records; it never judges the doctor and
 * never judges a reading.
 *
 *   bp     he gives a number (or "okay") when asked about home readings -> count and average of his home
 *          readings since the last clinic visit. A comparison line only when the doctor said a number
 *          (R1 exists in the session, said before this visit): that line is R1 and nothing else. Without
 *          R1 the card shows only the average and the count. Never 140, never 130, never his own number.
 *   med    "the small white one" -> the name on his confirmed label (verbatim) and his morning check-ins
 *   note   he says "don't think so" to a symptom question -> his own note that mentions it, verbatim
 *   unknown_med  he asks about a medicine nobody can identify -> lib/safety's fixed sentence
 *
 * Pure. All numbers are counts and averages of his records; every sentence shown is his, the label's,
 * the doctor's (R1) or lib/safety's.
 */
import type { BpReadingRow, DoseLogRow, MedicationRow, NoteRow, UtteranceRole, VisitItemRow } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { isClinician } from "./roles";
import { looksLikeQuestion } from "./text";
import type { BpCheck, MedCheck, NoteCheck, RoleDisplay, TargetRef } from "./types";

export interface CheckLine {
  id: string;
  text: string;
  role: UtteranceRole;
}

// ---------------------------------------------------------------- triggers

const BP_TOPIC = /\bblood pressure\b|\breadings?\b|\bBP\b/i;
const BP_TOPIC_ZH = /血压|读数/;
const HOME_NUMBER = /\b(?:around|about|maybe|roughly)?\s*(9\d|1\d\d|2[0-2]\d)\b|(?:大概|差不多|大约)?\s*(9\d|1\d\d|2[0-2]\d)\s*(?:左右)?/i;
const VAGUE_OK = /\b(?:okay|ok|fine|good|not bad|normal)\b|还好|不错|还可以|差不多/i;

/** Previous clinician line within two lines. */
function askedBefore(lines: CheckLine[], i: number): CheckLine | null {
  for (let j = i - 1; j >= Math.max(0, i - 2); j--) if (isClinician(lines[j].role)) return lines[j];
  return null;
}

/** The phrase to underline in his line ("Around 130"), or null when this line does not trigger a BP check. */
export function bpTrigger(lines: CheckLine[], i: number): string | null {
  const l = lines[i];
  if (l.role !== "patient") return null;
  const q = askedBefore(lines, i);
  if (!q || !(BP_TOPIC.test(q.text) || BP_TOPIC_ZH.test(q.text))) return null;
  const num = HOME_NUMBER.exec(l.text);
  if (num && /\d/.test(num[0])) return num[0].trim();
  if (looksLikeQuestion(q.text) && VAGUE_OK.test(l.text)) return VAGUE_OK.exec(l.text)![0];
  return null;
}

const VAGUE_MED = [
  /\bthe (?:small|little|white|round|yellow|pink|blue|big)(?: (?:small|little|white|round|yellow|pink|blue))* (?:one|pill|tablet)\b/i,
  /\bforget the name\b|\bdon'?t know the name\b|\bdon'?t remember the name\b/i,
  /那颗|那粒|白色的小药|小白药|不记得名字|忘了名字|名字忘了/,
];

export function medTrigger(lines: CheckLine[], i: number): string | null {
  const l = lines[i];
  if (l.role !== "patient") return null;
  for (const re of VAGUE_MED) {
    const m = re.exec(l.text);
    if (m) return m[0];
  }
  return null;
}

export const SYMPTOMS: Record<string, RegExp[]> = {
  ankle: [/\bankles?\b/i, /脚踝|脚眼/],
  swelling: [/\bswell(?:ing|en)?\b|\bswollen\b|\bpuffy\b/i, /肿/],
  dizzy: [/\bdizz(?:y|iness)\b/i, /头晕/],
  headache: [/\bheadaches?\b/i, /头痛|头疼/],
  tired: [/\btired\b|\bfatigue\b/i, /累|疲劳/],
  cough: [/\bcough(?:ing)?\b/i, /咳/],
};

function symptomsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const [k, res] of Object.entries(SYMPTOMS)) if (res.some((re) => re.test(text))) out.add(k);
  return out;
}

const DENIAL = /\bdon'?t think so\b|\bnot really\b|\bno\b|\bnope\b|\bnot that i know\b|没有|好像没|不觉得|应该没/i;

/** Symptom words the clinician asked about, when he answers "don't think so". */
export function noteTrigger(lines: CheckLine[], i: number): { phrase: string; symptoms: Set<string> } | null {
  const l = lines[i];
  if (l.role !== "patient") return null;
  const q = askedBefore(lines, i);
  if (!q || !looksLikeQuestion(q.text)) return null;
  const symptoms = symptomsOf(q.text);
  if (symptoms.size === 0) return null;
  const d = DENIAL.exec(l.text);
  if (!d) return null;
  return { phrase: l.text.trim(), symptoms };
}

// ---------------------------------------------------------------- builders

/** R1 as the only comparison line: from the session's required line R1 when it was said before this visit. */
export function targetFromR1(
  r1: Pick<VisitItemRow, "text" | "slots" | "visit_id"> | null,
  visit: { id: string; date: string } | null,
  display: RoleDisplay,
  tStartMs: number | null,
): TargetRef | null {
  if (!r1 || !visit) return null;
  let systolic = Number(r1.slots?.systolic);
  let diastolic = Number(r1.slots?.diastolic);
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
    // the numbers the doctor said in the sentence itself
    const m = /(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i.exec(r1.text);
    if (!m) return null;
    systolic = Number(m[1]);
    diastolic = Number(m[2]);
  }
  return { systolic, diastolic, quote: r1.text, date: visit.date, visitId: visit.id, display, tStartMs };
}

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Home readings in (fromDay..toDay). With a target (R1): how many were not below it (systolic at or above
 * R1's first number, or diastolic at or above its second: "below 135 over 85" means both under). Without
 * R1: bars carry no comparison and notBelow is null. Null when there are no readings.
 */
export function buildBpCheck(readings: BpReadingRow[], fromDay: number, toDay: number, d0: string, target: TargetRef | null): BpCheck | null {
  const inWindow = readings.filter((r) => r.day >= fromDay && r.day <= toDay);
  const recorded = inWindow.filter((r) => r.state === "recorded" && r.systolic !== null && r.diastolic !== null);
  if (recorded.length === 0) return null;
  const bars = recorded.map((r) => ({
    systolic: r.systolic!,
    diastolic: r.diastolic!,
    day: r.day,
    notBelow: target ? r.systolic! >= target.systolic || r.diastolic! >= target.diastolic : null,
  }));
  return {
    check: "bp",
    fromDay,
    toDay,
    fromDate: storyDate(d0, fromDay),
    toDate: storyDate(d0, toDay),
    recorded: recorded.length,
    unconfirmed: inWindow.length - recorded.length,
    avgSystolic: avg(recorded.map((r) => r.systolic!)),
    avgDiastolic: avg(recorded.map((r) => r.diastolic!)),
    bars,
    target,
    notBelow: target ? bars.filter((b) => b.notBelow).length : null,
  };
}

export interface RoutineEntry {
  label: string;
  label_zh?: string;
  days: "daily" | string[];
}

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** His prescription medicines started before this visit, with their label line and his morning check-ins. */
export function buildMedCheck(
  meds: MedicationRow[],
  doses: DoseLogRow[],
  fromDay: number,
  toDay: number,
  d0: string,
  routine: RoutineEntry[],
  drugName: (id: string) => string,
): MedCheck | null {
  const current = meds.filter(
    (m) => m.origin === "prescription" && m.start_day !== null && m.start_day <= toDay && m.label && (m.status === "label_confirmed" || m.status === "pharmacist_checked"),
  );
  if (current.length === 0) return null;
  const ids = new Set(current.map((m) => m.id));
  const window = doses.filter((d) => ids.has(d.medication_id) && d.day >= fromDay && d.day <= toDay && d.slot === "morning");
  const missedRows = window.filter((d) => d.state === "missed");
  const missedDays = missedRows.map((d) => d.day);
  let match: MedCheck["routine"] = null;
  if (missedDays.length > 0) {
    const names = missedDays.map((day) => WEEKDAY_EN[weekdayIndex(d0, day)]);
    const r = routine.find((x) => Array.isArray(x.days) && names.every((n) => (x.days as string[]).includes(n)));
    if (r) match = { label: r.label, labelZh: r.label_zh ?? null, days: r.days as string[] };
  }
  return {
    check: "med",
    meds: current.map((m) => ({ id: m.id, labelLine: (m.label!.text.split("\n")[0] ?? "").trim(), drugName: m.drug_id ? drugName(m.drug_id) : m.id })),
    fromDate: storyDate(d0, fromDay),
    toDate: storyDate(d0, toDay),
    total: window.length,
    taken: window.filter((d) => d.state === "taken").length,
    missed: missedRows.length,
    unconfirmed: window.filter((d) => d.state === "unconfirmed").length,
    missedDays,
    routine: match,
  };
}

/** His newest note in the window that mentions one of the symptoms asked about. */
export function buildNoteCheck(notes: NoteRow[], fromDay: number, toDay: number, d0: string, symptoms: Set<string>): NoteCheck | null {
  const hits = notes.filter((n) => n.day >= fromDay && n.day <= toDay && [...symptomsOf(n.text)].some((s) => symptoms.has(s)));
  const note = hits.at(-1);
  if (!note) return null;
  return { check: "note", note: { id: note.id, text: note.text, day: note.day, date: storyDate(d0, note.day), source: note.source } };
}

