/**
 * Is a label reading trustworthy enough to show him for confirmation? (M3 reading, 10-09 DeepSeek fixer.)
 *
 * deepseek-flash, given a rotated and blurred photo, invented a whole label (a foreign address, a patient and a
 * doctor that are not on it, a date two years off, "Blossom Family Clinic (Petitional)") and reported nothing as
 * unsure. Everything here is deterministic; it runs after lib/meds/parse-label.ts turned the transcription into
 * fields and before the fields are signed into the read token:
 *
 *   two reads        (the live readers) the transcription and the independent second read must agree: the model's
 *                    field read (lib/vision FIELDS_SYSTEM), or Tencent Cloud OCR's second engine's own reading of the
 *                    same printed lines (lib/vision secondReadFromOcr). Texts are compared after undoing the usual OCR
 *                    confusions inside numbers (fixOcrDigits: 5OOMG is 500MG), case, spacing and punctuation.
 *                    The model's second read (10-09 fixer): medicine line or directions both read but different -> the
 *                    photo is unreadable (retake).
 *                    OCR's second read (the owner's rule of 10-16: a disagreement makes THAT field unsure, unless it is
 *                    the medicine itself): the medicine line counts as the same when both name the same medicine to
 *                    the kb's matcher (its fuzzy step included: AMLODIPTNE is amlodipine) and is a retake only when
 *                    they name different medicines; a strength the second engine reads otherwise or not at all is left
 *                    empty; directions both read but different are left empty.
 *                    Either: directions the second read could not read -> left empty. A date or clinic the two reads
 *                    do not agree on -> left empty.
 *   plausibility     a dispensing date more than DATE_FUTURE_SLACK_DAYS after today or more than DATE_MAX_AGE_DAYS
 *                    before it -> left empty; a clinic that is almost, but not exactly, a clinic he has visited
 *                    ("(Petitional)" for "(fictional)") is a misread -> left empty.
 *
 * A field left empty is simply not offered for confirmation; nothing is ever replaced by a guess. Each decision is
 * returned as a warning code (no label text) for the event log and the response. His field-by-field confirmation
 * stays the last gate: two reads can still agree on the same invention.
 */
import { matchDrug } from "@/lib/kb/match";
import { canonicalClinic, parseLabelDate, parseStrength } from "@/lib/meds/parse-label";
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
  | "strength_unconfirmed"
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
  /** who made the second read: the model's field read (default) or Tencent Cloud OCR's second engine (see the header) */
  secondBy?: "model" | "ocr";
}

/**
 * Undo the usual OCR confusions inside numbers, for comparing reads (nothing shown is changed): in a run of digits and
 * look-alikes that has at least one real digit, O/o is 0 and I/l/| is 1 (5OOMG -> 500MG, O1/O9 -> 01/09); S between
 * two digits is 5; an S standing alone as the number before mg, mcg or ml is 5 (SMG, S MG -> 5MG, 5 MG: the owner's
 * decision of 10-16 for the printed film label, which the second engine reads "AMLODIPTNE SMG"), never an S inside a
 * word; a unit glued to the next word gets its space back (50MGTABLET -> 50MG TABLET).
 */
export function fixOcrDigits(text: string): string {
  return text
    .replace(/(?<=\d)[Ss](?=\d)/g, "5")
    .replace(/(?<![\p{L}\p{N}])[Ss](?=\s?(?:mg|mcg|ml)(?![\p{L}\p{N}]))/giu, "5")
    .replace(/[0-9OoIl|.]+/g, (run) => (/\d/.test(run) ? run.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : run))
    .replace(/(\d)\s*(mg|mcg|ml|g)(?=[A-Za-z]{3,})/gi, "$1$2 ");
}

/** The medicine a printed medicine line names to the kb's matcher, its strength set aside (a misread one too: "SMG"). */
function medicineOf(line: string): string | null {
  const name = fixOcrDigits(line).replace(/(?<![\p{L}])[\dOoSIl|.,]+\s*(?:mg|mcg|µg|ml|iu|g)\b/giu, " ");
  return matchDrug(name)?.drugId ?? null;
}

/** Both lines name the same medicine Ripple knows. */
export function sameMedicine(a: string, b: string): boolean {
  const x = medicineOf(a);
  return x !== null && x === medicineOf(b);
}

const strengthKey = (s: string | null) => (s ? s.replace(/\s+/g, "").toLowerCase() : null);

/** Same text after normalising case, spacing and punctuation, or one contained in the other (most of it). */
export function sameReading(a: string, b: string): boolean {
  const x = normalizeForCompare(fixOcrDigits(a));
  const y = normalizeForCompare(fixOcrDigits(b));
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

/** Check one reading (see the header). `second` undefined = cassette mode (no second read exists), null = it failed. */
export function assessLabelReading(input: LabelFields, second: SecondRead | null | undefined, opts: AssessOptions): LabelAssessment {
  const fields: LabelFields = { ...input, slots: input.slots ? { ...input.slots } : null };
  const warnings: LabelWarning[] = [];
  const warn = (w: LabelWarning) => {
    if (!warnings.includes(w)) warnings.push(w);
  };

  if (second === null) warn("second_read_unavailable");
  if (second) {
    const ocr = opts.secondBy === "ocr";
    if (fields.drug_text && second.medicine && !sameReading(fields.drug_text, second.medicine) && !(ocr && sameMedicine(fields.drug_text, second.medicine))) {
      return { fields: input, warnings: [...warnings], reject: "reads_disagree" };
    }
    if (fields.directions && second.directions && !sameReading(fields.directions, second.directions)) {
      if (!ocr) return { fields: input, warnings: [...warnings], reject: "reads_disagree" };
      // OCR: the dose line one engine reads otherwise is not taken from either: he types it
      fields.directions = null;
      fields.slots = null;
      warn("directions_unconfirmed");
    }
    if (fields.drug_text && !second.medicine) warn("medicine_unconfirmed");
    if (ocr && fields.strength && second.medicine && strengthKey(parseStrength(fixOcrDigits(second.medicine))) !== strengthKey(fields.strength)) {
      fields.strength = null;
      warn("strength_unconfirmed");
    }
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
