/**
 * Drug-name matching (web-app.md section 7): normalise -> exact name or alias among the seven KB drugs
 * -> edit distance within a threshold -> otherwise unknown. RxNorm lookup comes later (M9).
 *
 * The fuzzy step is for label photos and typed names. The verifier never fuzzy-matches (glossary rule:
 * "no fuzzy matching inside the verifier"); it only uses exact glossary aliases.
 */
import { getKb } from "./load";

export interface DrugMatch {
  drugId: string;
  how: "exact" | "alias" | "fuzzy";
  /** the KB name or alias that matched */
  matched: string;
  distance: number;
}

export interface MatchOptions {
  /** Max edit distance for the fuzzy step. Default from KB_FUZZY_MAX_DISTANCE, else 2. 0 disables fuzzy. */
  maxDistance?: number;
  /** Fuzzy matches also need distance <= ratio * name length. Default 0.25. */
  maxRatio?: number;
}

/** Fuzzy threshold from the environment (KB_FUZZY_MAX_DISTANCE), default 2. */
export function defaultMaxDistance(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.KB_FUZZY_MAX_DISTANCE);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

const FORM_WORDS = /\b(tablets?|tabs?|capsules?|caps?|pills?|mg|milligrams?|mcg|ml|oral|film[- ]coated|sr|xr|er)\b/g;

/** Lower case, NFKC, drop strengths and dosage-form words, keep letters (Latin and CJK) and single spaces. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+(\.\d+)?(\s*(mg|mcg|ml|g)\b)?/g, " ")
    .replace(FORM_WORDS, " ")
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

interface NameEntry {
  drugId: string;
  name: string; // normalised
  primary: boolean;
}

let names: NameEntry[] | null = null;

/** Every KB name for the seven drugs: id, display name, drugs.json aliases, glossary aliases. */
function nameTable(): NameEntry[] {
  if (names) return names;
  const kb = getKb();
  const seen = new Set<string>();
  const out: NameEntry[] = [];
  const add = (drugId: string, raw: string, primary: boolean) => {
    const name = normalizeName(raw);
    if (!name || seen.has(`${drugId}|${name}`)) return;
    seen.add(`${drugId}|${name}`);
    out.push({ drugId, name, primary });
  };
  for (const d of kb.drugs) {
    add(d.id, d.id, true);
    add(d.id, d.display_name, true);
    for (const a of d.aliases) add(d.id, a, false);
  }
  for (const [id, aliases] of Object.entries(kb.glossary.drugs)) for (const a of aliases) add(id, a, false);
  names = out;
  return out;
}

const hasHan = (s: string) => /\p{Script=Han}/u.test(s);

/** Match one medicine name (from a label or typed by the user). null = not identified. */
export function matchDrug(raw: string, opts: MatchOptions = {}): DrugMatch | null {
  const q = normalizeName(raw);
  if (!q) return null;
  const table = nameTable();
  const exact = table.find((e) => e.name === q);
  if (exact) return { drugId: exact.drugId, how: exact.primary ? "exact" : "alias", matched: exact.name, distance: 0 };

  const maxDistance = opts.maxDistance ?? defaultMaxDistance();
  const maxRatio = opts.maxRatio ?? 0.25;
  if (maxDistance <= 0 || hasHan(q) || q.length < 5) return null;
  let best: DrugMatch | null = null;
  for (const e of table) {
    if (hasHan(e.name)) continue;
    const d = levenshtein(q, e.name);
    if (d <= maxDistance && d <= maxRatio * e.name.length && (!best || d < best.distance)) {
      best = { drugId: e.drugId, how: "fuzzy", matched: e.name, distance: d };
    }
  }
  return best;
}

export interface DrugMention {
  drugId: string;
  alias: string;
  index: number;
}

/**
 * Exact KB names and aliases mentioned anywhere in free text (no fuzzy step). Latin names need word
 * boundaries; Chinese names match as substrings. Longest alias wins when two overlap.
 */
export function findDrugMentions(text: string): DrugMention[] {
  const lower = text.normalize("NFKC").toLowerCase();
  const kb = getKb();
  const aliases: { drugId: string; alias: string }[] = [];
  for (const d of kb.drugs) for (const a of [d.id, d.display_name, ...d.aliases]) aliases.push({ drugId: d.id, alias: a.toLowerCase() });
  for (const [id, list] of Object.entries(kb.glossary.drugs)) for (const a of list) aliases.push({ drugId: id, alias: a.toLowerCase() });
  aliases.sort((a, b) => b.alias.length - a.alias.length);

  const taken: [number, number][] = [];
  const out: DrugMention[] = [];
  for (const { drugId, alias } of aliases) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(alias, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + alias.length;
      if (!hasHan(alias)) {
        const before = i > 0 ? lower[i - 1] : " ";
        const after = end < lower.length ? lower[end] : " ";
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      }
      if (taken.some(([s, e]) => i < e && end > s)) continue;
      taken.push([i, end]);
      out.push({ drugId, alias, index: i });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Distinct drug ids mentioned in the text, in order of first mention. */
export function mentionedDrugIds(text: string): string[] {
  return [...new Set(findDrugMentions(text).map((m) => m.drugId))];
}
