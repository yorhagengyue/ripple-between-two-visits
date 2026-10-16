/**
 * Is a label reading trustworthy enough to show him for confirmation? (M3 reading, 10-09 DeepSeek fixer.)
 *
 * deepseek-flash, given a rotated and blurred photo, invented a whole label (a foreign address, a patient and a
 * doctor that are not on it, a date two years off, "Blossom Family Clinic (Petitional)") and reported nothing as
 * unsure. Everything here is deterministic; it runs after lib/meds/parse-label.ts turned the transcription into
 * fields and before the fields are signed into the read token:
 *
 *   two reads        (model path only) the transcription and the independent field read (lib/vision FIELDS_SYSTEM)
 *                    must agree. Medicine line or directions both read but different -> the photo is unreadable
 *                    (retake). Directions the field read could not read -> left empty. A date or clinic the two
 *                    reads do not agree on -> left empty.
 *   plausibility     a dispensing date more than DATE_FUTURE_SLACK_DAYS after today or more than DATE_MAX_AGE_DAYS
 *                    before it -> left empty; a clinic that is almost, but not exactly, a clinic he has visited
 *                    ("(Petitional)" for "(fictional)") is a misread -> left empty.
 *
 * A field left empty is simply not offered for confirmation; nothing is ever replaced by a guess. Each decision is
 * returned as a warning code (no label text) for the event log and the response. His field-by-field confirmation
 * stays the last gate: two reads can still agree on the same invention.
 */
import { canonicalClinic, parseLabelDate } from "@/lib/meds/parse-label";
import type { LabelFields } from "@/lib/meds/types";
import { normalizeForCompare } from "@/lib/safety/text";
import type { SecondRead } from "./index";

export const DATE_FUTURE_SLACK_DAYS = 3;
export const DATE_MAX_AGE_DAYS = 400;
/** Normalised similarity above which a clinic name that is not exactly a known clinic counts as a misread of it. */
export const CLINIC_NEAR_MISS = 0.75;

export type LabelWarning =
  | "second_read_unavailable"
  | "medicine_unconfirmed"
  | "directions_unconfirmed"
  | "date_unconfirmed"
  | "clinic_unconfirmed"
  | "date_in_future"
  | "date_too_old"
  | "clinic_near_known";

export interface LabelAssessment {
  fields: LabelFields;
  warnings: LabelWarning[];
  /** the whole reading is unreliable: ask for a new photo (null = usable) */
  reject: "reads_disagree" | null;
}

export interface AssessOptions {
  /** today's ISO date (the story date in the demo) */
  today: string;
  /** clinics he has visited (visit.place) */
  knownClinics?: string[];
}

/** Same text after normalising case, spacing and punctuation, or one contained in the other (most of it). */
export function sameReading(a: string, b: string): boolean {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length >= 0.6 * long.length;
}

/** A printed date in either label order (01/09/2026, 1.9.26) or ISO; null when it is not a date. */
export function readDate(text: string | null): string | null {
  if (!text) return null;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return parseLabelDate(iso[3], iso[2], iso[1]);
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
  return dmy ? parseLabelDate(dmy[1], dmy[2], dmy[3]) : null;
}

const DAY_MS = 86_400_000;
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);

/** Levenshtein similarity of two normalised strings (1 = identical). */
export function similarity(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x.length && !y.length) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/** Check one reading (see the header). `second` undefined = cassette mode (no second read exists). */
export function assessLabelReading(input: LabelFields, second: SecondRead | null | undefined, opts: AssessOptions): LabelAssessment {
  const fields: LabelFields = { ...input, slots: input.slots ? { ...input.slots } : null };
  const warnings: LabelWarning[] = [];
  const warn = (w: LabelWarning) => {
    if (!warnings.includes(w)) warnings.push(w);
  };

  if (second === null) warn("second_read_unavailable");
  if (second) {
    if (fields.drug_text && second.medicine && !sameReading(fields.drug_text, second.medicine)) return { fields: input, warnings: [...warnings], reject: "reads_disagree" };
    if (fields.directions && second.directions && !sameReading(fields.directions, second.directions)) return { fields: input, warnings: [...warnings], reject: "reads_disagree" };
    if (fields.drug_text && !second.medicine) warn("medicine_unconfirmed");
    if (fields.directions && !second.directions) {
      // the dose line is the one the safety layer quotes as "the label": never on one read alone
      fields.directions = null;
      fields.slots = null;
      warn("directions_unconfirmed");
    }
    if (fields.dispensed && readDate(second.date) !== fields.dispensed) {
      fields.dispensed = null;
      warn("date_unconfirmed");
    }
    if (fields.clinic && !(second.clinic && sameReading(canonicalClinic(second.clinic, opts.knownClinics), fields.clinic))) {
      fields.clinic = null;
      warn("clinic_unconfirmed");
    }
  }

  if (fields.dispensed) {
    const age = daysBetween(fields.dispensed, opts.today);
    if (age < -DATE_FUTURE_SLACK_DAYS) {
      fields.dispensed = null;
      warn("date_in_future");
    } else if (age > DATE_MAX_AGE_DAYS) {
      fields.dispensed = null;
      warn("date_too_old");
    }
  }
  if (fields.clinic && opts.knownClinics?.length) {
    const exact = opts.knownClinics.some((k) => normalizeForCompare(k) === normalizeForCompare(fields.clinic!));
    if (!exact && opts.knownClinics.some((k) => similarity(k, fields.clinic!) >= CLINIC_NEAR_MISS)) {
      fields.clinic = null;
      warn("clinic_near_known");
    }
  }
  return { fields, warnings, reject: null };
}
