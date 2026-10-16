/**
 * The hard rule of web-app.md section 8: a sentence about medicine never shows as "Doctor said" from
 * inference alone. It needs either his confirmation in the after-visit review, or a match with a confirmed
 * medicine label. This module decides (1) whether a sentence is about medicine and (2) whether it matches
 * a confirmed label, using kb/glossary.json through the safety layer's slot extractor.
 *
 * Server-only (the kb loader reads JSON through the bundler; fine in route handlers and server components).
 */
import { mentionedDrugIds } from "@/lib/kb/match";
import { extractSlots, type Slots } from "@/lib/safety/slots";
import type { MedicationRow } from "@/lib/store/types";

const MED_WORDS_EN = /\b(?:dose|doses|dosage|medicine|medicines|medication|medications|meds|pill|pills|tablet|tablets|capsules?|painkillers?|milligrams?|mg)\b/i;
// 药 but not 药剂师 (pharmacist) or 药房 (pharmacy); 止痛 (painkiller); 剂量 (dose)
const MED_WORDS_ZH = /药(?!剂师|房|店)|剂量|止痛|粒|毫克|胶囊/;

/** A sentence about medicine: a drug name or alias, a dose unit, or a medicine word. */
export function isMedicationText(text: string): boolean {
  if (mentionedDrugIds(text).length > 0) return true;
  return MED_WORDS_EN.test(text) || MED_WORDS_ZH.test(text);
}

function subset(a: string[], b: string[]): boolean {
  return a.every((x) => b.includes(x));
}

const LABEL_OK = new Set(["label_confirmed", "pharmacist_checked"]);

export interface LabelMatchOptions {
  /** labels dispensed after this date (YYYY-MM-DD) do not count yet */
  notAfter?: string;
  /** labels dispensed on or after this date do not count yet (during the visit itself) */
  before?: string;
}

/**
 * The confirmed label this sentence agrees with, or null. Agreeing means: the sentence names a drug, that
 * drug is the label's drug, and every unit, number, frequency and time the sentence says is also on the
 * label (glossary-normalised). "Amlodipine, 5 milligrams, one tablet every morning." agrees with
 * "AMLODIPINE 5MG TABLET / Take ONE tablet every MORNING"; "... 饭前饭后都可以" does not (not on the label).
 */
export function matchingLabel(text: string, meds: MedicationRow[], opts: LabelMatchOptions = {}): MedicationRow | null {
  const s: Slots = extractSlots(text);
  if (s.drugs.length === 0) return null;
  for (const m of meds) {
    if (!m.label || !LABEL_OK.has(m.status) || !m.drug_id) continue;
    const dispensed = m.label.dispensed ?? null;
    if (dispensed && opts.notAfter && dispensed > opts.notAfter) continue;
    if (dispensed && opts.before && dispensed >= opts.before) continue;
    if (!s.drugs.includes(m.drug_id)) continue;
    const l = extractSlots(`${m.label.text}\n${m.label.directions ?? ""}\n${m.label.strength ?? ""}`);
    if (!subset(s.drugs, l.drugs)) continue;
    if (!subset(s.units, l.units) || !subset(s.numbers, l.numbers) || !subset(s.times, l.times) || !subset(s.frequencies, l.frequencies)) continue;
    return m;
  }
  return null;
}
