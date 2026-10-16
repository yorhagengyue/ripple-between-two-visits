/**
 * Label text -> fields (web-app.md section 8: 药名、规格、用法、配药日期、诊所). The text is what the vision step
 * transcribed (lib/vision), line by line; nothing here calls a model.
 *
 * Rules (each decides what reaches the patient, so they are deliberately narrow):
 * - Medicine line: the first line lib/kb's matcher recognises exactly or by alias, then by its fuzzy step; when
 *   none is recognised, the first line that looks like a product name (a strength, or a dosage-form word such
 *   as TABLET / 丸 / 片), else the first line that is not an address, a phone line or a prescriber's name (a photo
 *   of the clinic header alone has no medicine line: drug_text null). `drug_id` is the matcher's answer, null when
 *   not identified.
 * - Strength: "<number> <unit>" from the medicine line, unit lower case ("5MG" -> "5 mg").
 * - Directions: only for an identified medicine, and only a line whose glossary slots have a number, a unit and
 *   a time or a frequency ("Take ONE tablet every MORNING"). "Take with or after food." (no number) and
 *   "Qty: 35 tablets" (no time) are not directions. An unidentified box never gets directions, so its printed
 *   dosing can never become a "label" source that the safety layer would quote.
 * - Slots: quantity, unit, time, frequency from the directions. "every <one time of day>" is once_daily.
 * - Dispensed: the "Date:" (or "Dispensed:", 配药日期) on the label, Singapore order day/month/year -> ISO.
 * - Clinic: the first line naming a clinic, pharmacy or hospital. A clinic he has visited (visit.place) is
 *   written the way the visit record writes it; otherwise an all-capitals line becomes Title Case.
 * - Indication: the label's own "For: ..." line.
 */
import { matchDrug } from "@/lib/kb/match";
import { extractSlots } from "@/lib/safety/slots";
import { normalizeForCompare } from "@/lib/safety/text";
import type { LabelFields, LabelSlots } from "./types";

export interface ParseOptions {
  /** clinic names the app already knows (visit.place), used to spell the clinic the same way */
  knownClinics?: string[];
}

const FORM_WORD = /\b(tablets?|capsules?|caplets?|syrup|suspension|cream|ointment|drops|injection|inhaler|patch)\b|丸|片|胶囊|颗粒|口服液|冲剂|膏/i;
const STRENGTH = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|ml|iu)\b/i;
const SECTION_LINE = /^【|^\[|^(qty|quantity|patient|name|date|dispensed|exp|expiry|batch|lot|tel|for|indication)\b/i;
const CLINIC = /\b(clinic|medical (?:centre|center|clinic)|polyclinic|pharmacy|hospital|surgery|family practice|dispensary)\b|诊所|药房|医院|药局|综合诊所/i;
const DISCLAIMER = /\bsynthetic\b|\bdemo (?:label|pack)\b|not a real|合成演示|并非真实/i;
/** Address, contact and prescriber lines: never the medicine line. */
const ADDRESS =
  /\b(?:p\.?\s*o\.?\s*box|blk|block|road|rd|street|avenue|ave|lorong|jalan|drive|crescent|boulevard)\b|#\d{1,3}-\d{1,5}\b|\bsingapore\s*\d{6}\b|\b\d{6}\b|^\s*(?:tel|phone|fax|e-?mail|www)\b|^\s*(?:dr|doctor|prescriber|pharmacist)\b\.?\s/i;
const notMedicineLine = (l: string) => DISCLAIMER.test(l) || SECTION_LINE.test(l) || CLINIC.test(l) || ADDRESS.test(l);
const hasLetters = (l: string) => (l.replace(/\[\?\]/g, "").match(/\p{L}/gu) ?? []).length >= 3;
const DATE_ON_LINE = /(?:\bdate\b|\bdispensed(?: on)?\b|\bdisp\.? date\b|配药日期|日期)\s*[:：]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
const FOR_LINE = /^(?:for|indication|used for)\s*[:：]\s*(.+)$/i;
const ONCE_A_DAY_TIMES = new Set(["morning", "night", "evening", "after_breakfast"]);

const lines = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function findDrugLine(all: string[]): { line: string | null; drugId: string | null; how: LabelFields["match"] } {
  // exact or alias first, so a fuzzy hit on a later line never beats the printed name
  for (const line of all) {
    if (DISCLAIMER.test(line)) continue;
    const m = matchDrug(line, { maxDistance: 0 });
    if (m) return { line, drugId: m.drugId, how: m.how };
  }
  for (const line of all) {
    if (notMedicineLine(line)) continue;
    const m = matchDrug(line);
    if (m) return { line, drugId: m.drugId, how: m.how };
  }
  const productLike = all.find((l) => !notMedicineLine(l) && hasLetters(l) && (STRENGTH.test(l) || FORM_WORD.test(l)));
  const fallback = all.find((l) => !notMedicineLine(l) && hasLetters(l));
  return { line: productLike ?? fallback ?? null, drugId: null, how: null };
}

export function parseStrength(line: string | null): string | null {
  if (!line) return null;
  const m = STRENGTH.exec(line);
  if (!m) return null;
  const unit = m[2].toLowerCase() === "µg" ? "mcg" : m[2].toLowerCase();
  return `${Number(m[1])} ${unit}`;
}

/** Glossary slots of a directions line, one value each. */
export function labelSlots(directions: string): LabelSlots {
  const s = extractSlots(directions);
  const out: LabelSlots = {};
  if (s.numbers[0]) out.quantity = s.numbers[0];
  if (s.units[0]) out.unit = s.units[0];
  if (s.times[0]) out.time = s.times[0];
  const frequency =
    s.frequencies[0] ??
    (/\bevery\b|\beach\b|每天|每日/i.test(directions) && s.times.length === 1 && ONCE_A_DAY_TIMES.has(s.times[0]) ? "once_daily" : undefined);
  if (frequency) out.frequency = frequency;
  return out;
}

function isDirections(line: string): boolean {
  const s = extractSlots(line);
  return s.numbers.length > 0 && s.units.length > 0 && (s.times.length > 0 || s.frequencies.length > 0);
}

/** "01/09/2026" (day/month/year) -> "2026-09-01"; null when it is not a real date. */
export function parseLabelDate(d: string, m: string, y: string): string | null {
  const day = Number(d);
  const month = Number(m);
  let year = Number(y);
  if (y.length === 2) year += 2000;
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100)) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return check.getUTCDate() === day ? iso : null;
}

const SMALL_WORDS = new Set(["of", "and", "the", "for", "at", "in", "on", "&"]);

function titleCase(line: string): string {
  return line
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => (/^\s+$/.test(w) || (i > 0 && SMALL_WORDS.has(w)) ? w : w.replace(/^(\(?)(\p{L})/u, (_, p: string, c: string) => p + c.toUpperCase())))
    .join("");
}

export function canonicalClinic(line: string, known: string[] = []): string {
  const plain = line.replace(/\s+/g, " ").trim();
  // OCR drops or adds a space next to a bracket ("CLINIC(FICTIONAL)"): the same letters are the same clinic
  const same = known.find((k) => k.replace(/\s+/g, " ").trim().toLowerCase() === plain.toLowerCase()) ?? known.find((k) => normalizeForCompare(k) === normalizeForCompare(plain));
  if (same) return same;
  const letters = plain.replace(/[^\p{L}]/gu, "");
  return letters && letters === letters.toUpperCase() && /[A-Z]/.test(letters) ? titleCase(plain) : plain;
}

export function parseLabelText(text: string, opts: ParseOptions = {}): LabelFields {
  const all = lines(text);
  const drug = findDrugLine(all);
  const identified = drug.drugId !== null;

  let directions: string | null = null;
  if (identified) directions = all.find((l) => l !== drug.line && !SECTION_LINE.test(l) && isDirections(l)) ?? null;

  let dispensed: string | null = null;
  for (const l of all) {
    const m = DATE_ON_LINE.exec(l);
    if (m && !/\bexp/i.test(l.slice(0, m.index + 4))) {
      dispensed = parseLabelDate(m[1], m[2], m[3]);
      if (dispensed) break;
    }
  }

  const clinicLine = all.find((l) => CLINIC.test(l) && !DISCLAIMER.test(l) && l !== drug.line) ?? null;
  const forLine = all.map((l) => FOR_LINE.exec(l)).find(Boolean);

  return {
    drug_text: drug.line,
    drug_id: drug.drugId,
    match: drug.how,
    strength: parseStrength(drug.line),
    directions,
    slots: directions ? labelSlots(directions) : null,
    dispensed,
    clinic: clinicLine ? canonicalClinic(clinicLine, opts.knownClinics) : null,
    indication: forLine ? forLine[1].trim() : null,
  };
}
