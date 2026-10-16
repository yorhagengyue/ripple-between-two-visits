/**
 * The first of the two checks on a translation (lib/translate; C2 architecture review 「医生的英文原话」, overnight-loop 10-09:
 * 「数字、药名、单位、频次必须和原话一一对上（确定性检查）」). Deterministic, pure, server and client safe.
 *
 * Both texts are reduced to the safety layer's clinical slots (lib/safety/slots.ts, the bilingual glossary kb/glossary.json):
 * medicine names, dose units, how often, when, and numbers. Every category must hold exactly the same ids on both sides:
 * nothing missing, nothing added ("Please don't change the dose yourself." must not come back with 两粒 in it). On top:
 *   - a negation in the source must survive (don't / not / never ... -> 不 / 没 / 别 / 勿 ..., and 不 / 没 ... -> no / not
 *     ...): the doctor's "Please don't change the dose yourself." never comes back as an instruction to change it;
 *   - the translation is in the target language (Chinese characters for en>zh-Hans, none for zh-Hans>en), not empty and
 *     not padded (at most four times the source's length, plus a little).
 * Fails closed: anything it cannot match is a failure, and the caller shows the original words and the recording alone.
 */
import { extractSlots, SLOT_CATEGORIES, type SlotCategory, type Slots } from "@/lib/safety/slots";
import { hasHan } from "@/lib/safety/text";
import type { TranslationDirection } from "@/lib/store/types";

export interface FactCheck {
  pass: boolean;
  /** codes: drugs_missing, numbers_added, negation_dropped, wrong_language, empty, too_long ... */
  reasons: string[];
  /** slot ids in the source that the translation lacks, and the other way round */
  missing: Partial<Record<SlotCategory, string[]>>;
  added: Partial<Record<SlotCategory, string[]>>;
}

const NEGATION_EN = /\b(?:not|no|never|none|nothing|nobody|nor|without|cannot)\b|n['’]t\b/i;
const NEGATION_ZH = /[不没沒别別勿无無未莫甭]/;

/** The text says no, not, never ... (English) or 不, 没, 别 ... (Chinese). */
export function hasNegation(text: string): boolean {
  return hasHan(text) ? NEGATION_ZH.test(text) || NEGATION_EN.test(text) : NEGATION_EN.test(text);
}

function diff(a: Slots, b: Slots): Partial<Record<SlotCategory, string[]>> {
  const out: Partial<Record<SlotCategory, string[]>> = {};
  for (const c of SLOT_CATEGORIES) {
    const gone = a[c].filter((v) => !b[c].includes(v));
    if (gone.length) out[c] = gone;
  }
  return out;
}

/** The deterministic check of `translation` against `source` (see the header). */
export function sameFacts(source: string, translation: string, direction: TranslationDirection): FactCheck {
  const reasons: string[] = [];
  const src = source.normalize("NFC").trim();
  const dst = translation.normalize("NFC").trim();
  if (!dst) return { pass: false, reasons: ["empty"], missing: {}, added: {} };
  if (direction === "en>zh-Hans" ? !hasHan(dst) : hasHan(dst)) reasons.push("wrong_language");
  if ([...dst].length > 4 * [...src].length + 20) reasons.push("too_long");
  const a = extractSlots(src);
  const b = extractSlots(dst);
  const missing = diff(a, b);
  const added = diff(b, a);
  for (const c of Object.keys(missing)) reasons.push(`${c}_missing`);
  for (const c of Object.keys(added)) reasons.push(`${c}_added`);
  if (hasNegation(src) && !hasNegation(dst)) reasons.push("negation_dropped");
  return { pass: reasons.length === 0, reasons, missing, added };
}
