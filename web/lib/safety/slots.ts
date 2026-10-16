/**
 * Clinical slots (spec section 5 step 4, web-app.md 6.3 layer 1). A sentence and the span it cites are both
 * reduced to ids from the closed bilingual vocabulary in web/kb/glossary.json (drug, unit, frequency, time,
 * number), so an English label line and a Mandarin template sentence can be compared id by id.
 *
 * Tokenising rules (kept deliberately small; documented because they decide what gets blocked):
 * - Digits always count as numbers ("150/95" -> 150 and 95, "5MG" -> 5, "9151 1767" -> 9151 and 1767).
 * - Number words (one, two, a, half; 一, 两, 半 ...) count only when a quantity word follows: an English
 *   unit or "dose"/"doses" with at most one word in between ("ONE tablet", "a forgotten dose"), or a
 *   Chinese unit / 份 right after the numeral ("一粒", "两份"). Otherwise every English "a" and every
 *   "一起" would turn into a phantom 1.
 * - Label shorthand that is also an English word (ON, OM, OD, BD, BID, TDS, TID, PRN) counts only in
 *   upper case, so "on top" is not "at night".
 * - Phrases are matched longest first and consume their text ("every morning" is one time slot).
 * No fuzzy matching: a word that is not in the glossary simply produces no slot.
 */
import { getKb } from "@/lib/kb/load";
import { escapeRegExp, hasHan } from "./text";

export type SlotCategory = "drugs" | "units" | "frequencies" | "times" | "numbers";
export const SLOT_CATEGORIES: SlotCategory[] = ["drugs", "units", "frequencies", "times", "numbers"];

export type Slots = Record<SlotCategory, string[]>;

export const emptySlots = (): Slots => ({ drugs: [], units: [], frequencies: [], times: [], numbers: [] });

const UPPERCASE_ONLY = new Set(["om", "on", "od", "bd", "bid", "tds", "tid", "prn"]);
const EXTRA_QUANTITY_WORDS_EN = ["dose", "doses"];
const EXTRA_QUANTITY_WORDS_ZH = ["份"];

interface PhraseEntry {
  category: "drugs" | "frequencies" | "times";
  id: string;
  alias: string;
  re?: RegExp; // Latin aliases
}

interface Vocab {
  phrases: PhraseEntry[];
  unitsLatin: { id: string; alias: string }[];
  unitsHan: { id: string; alias: string }[];
  numberWordsLatin: Map<string, string>; // single word -> value
  numberPhrasesLatin: { value: string; words: string[] }[]; // "one hundred"
  numeralsHan: { value: string; alias: string }[]; // longest first
  quantityWordsLatin: Set<string>;
  quantityWordsHan: string[];
}

let vocab: Vocab | null = null;

function latinRegex(alias: string): RegExp {
  const body = alias
    .split(/\s+/)
    .map((w) => escapeRegExp(w))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

function getVocab(): Vocab {
  if (vocab) return vocab;
  const g = getKb().glossary;
  const phrases: PhraseEntry[] = [];
  for (const category of ["drugs", "frequencies", "times"] as const) {
    for (const [id, aliases] of Object.entries(g[category])) {
      for (const raw of aliases) {
        const alias = raw.toLowerCase();
        phrases.push({ category, id, alias, re: hasHan(alias) ? undefined : latinRegex(alias) });
      }
    }
  }
  phrases.sort((a, b) => b.alias.length - a.alias.length);

  const unitsLatin: Vocab["unitsLatin"] = [];
  const unitsHan: Vocab["unitsHan"] = [];
  for (const [id, aliases] of Object.entries(g.units)) {
    for (const raw of aliases) {
      const alias = raw.toLowerCase();
      (hasHan(alias) ? unitsHan : unitsLatin).push({ id, alias });
    }
  }
  unitsHan.sort((a, b) => b.alias.length - a.alias.length);

  const numberWordsLatin = new Map<string, string>();
  const numberPhrasesLatin: Vocab["numberPhrasesLatin"] = [];
  const numeralsHan: Vocab["numeralsHan"] = [];
  for (const [value, aliases] of Object.entries(g.numbers)) {
    for (const raw of aliases) {
      const alias = raw.toLowerCase();
      if (/^\d+(\.\d+)?$/.test(alias)) continue; // digits are handled directly
      if (hasHan(alias)) numeralsHan.push({ value, alias });
      else if (alias.includes(" ")) numberPhrasesLatin.push({ value, words: alias.split(/\s+/) });
      else numberWordsLatin.set(alias, value);
    }
  }
  numeralsHan.sort((a, b) => b.alias.length - a.alias.length);

  const quantityWordsLatin = new Set<string>([...unitsLatin.map((u) => u.alias), ...EXTRA_QUANTITY_WORDS_EN]);
  const quantityWordsHan = [...unitsHan.map((u) => u.alias), ...EXTRA_QUANTITY_WORDS_ZH].sort((a, b) => b.length - a.length);

  vocab = {
    phrases,
    unitsLatin,
    unitsHan,
    numberWordsLatin,
    numberPhrasesLatin,
    numeralsHan,
    quantityWordsLatin,
    quantityWordsHan,
  };
  return vocab;
}

function add(set: Map<SlotCategory, Set<string>>, category: SlotCategory, value: string) {
  set.get(category)!.add(value);
}

/** Canonical number string: "05" -> "5", "0.50" -> "0.5". */
export function canonicalNumber(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

/** Extract glossary slots from any text (English, Mandarin, or mixed). */
export function extractSlots(input: string): Slots {
  const v = getVocab();
  const original = input.normalize("NFKC");
  const lower = original.toLowerCase();
  const found = new Map<SlotCategory, Set<string>>(SLOT_CATEGORIES.map((c) => [c, new Set<string>()]));

  // 1. phrases (drugs, frequencies, times), longest first, consuming their text
  const consumed: boolean[] = new Array(lower.length).fill(false);
  const free = (s: number, e: number) => {
    for (let i = s; i < e; i++) if (consumed[i]) return false;
    return true;
  };
  const take = (s: number, e: number) => {
    for (let i = s; i < e; i++) consumed[i] = true;
  };
  for (const p of v.phrases) {
    if (p.re) {
      p.re.lastIndex = 0;
      for (const m of lower.matchAll(p.re)) {
        const s = m.index!;
        const e = s + m[0].length;
        if (!free(s, e)) continue;
        if (UPPERCASE_ONLY.has(p.alias) && original.slice(s, e) !== original.slice(s, e).toUpperCase()) continue;
        take(s, e);
        add(found, p.category, p.id);
      }
    } else {
      let from = 0;
      for (;;) {
        const s = lower.indexOf(p.alias, from);
        if (s < 0) break;
        from = s + 1;
        const e = s + p.alias.length;
        if (!free(s, e)) continue;
        take(s, e);
        add(found, p.category, p.id);
      }
    }
  }

  // 2. units (not consuming: a unit can also be the quantity word after a number)
  for (const u of v.unitsLatin) {
    // a unit may follow digits directly ("5MG"), so only letters before it break the match
    const re = new RegExp(`(?<!\\p{L})${escapeRegExp(u.alias)}(?![\\p{L}\\p{N}])`, "giu");
    if (re.test(lower)) add(found, "units", u.id);
  }
  for (const u of v.unitsHan) if (lower.includes(u.alias)) add(found, "units", u.id);

  // 3a. digits
  for (const m of lower.matchAll(/\d+(?:\.\d+)?/g)) add(found, "numbers", canonicalNumber(m[0]));

  // 3b. English number words before a quantity word (at most one word in between)
  const tokens = [...lower.matchAll(/[\p{Script=Latin}]+(?:'[\p{Script=Latin}]+)?/gu)].map((m) => m[0]);
  for (let i = 0; i < tokens.length; i++) {
    let value: string | undefined;
    let width = 1;
    for (const ph of v.numberPhrasesLatin) {
      if (ph.words.every((w, k) => tokens[i + k] === w)) {
        value = ph.value;
        width = ph.words.length;
        break;
      }
    }
    value ??= v.numberWordsLatin.get(tokens[i]);
    if (value === undefined) continue;
    const next1 = tokens[i + width];
    const next2 = tokens[i + width + 1];
    if ((next1 && v.quantityWordsLatin.has(next1)) || (next2 && v.quantityWordsLatin.has(next2))) {
      add(found, "numbers", value);
    }
  }

  // 3c. Chinese numerals right before a Chinese unit or 份 (半粒 / 半片 carry their own unit)
  for (let i = 0; i < lower.length; i++) {
    const hit = v.numeralsHan.find((n) => lower.startsWith(n.alias, i));
    if (!hit) continue;
    const after = i + hit.alias.length;
    const selfContained = v.quantityWordsHan.some((q) => hit.alias.endsWith(q));
    if (selfContained || v.quantityWordsHan.some((q) => lower.startsWith(q, after))) add(found, "numbers", hit.value);
    i = after - 1;
  }

  const out = emptySlots();
  for (const c of SLOT_CATEGORIES) out[c] = [...found.get(c)!].sort();
  return out;
}

/** Merge several slot sets (a span cited in two languages, for example). */
export function mergeSlots(...sets: Slots[]): Slots {
  const out = emptySlots();
  for (const c of SLOT_CATEGORIES) out[c] = [...new Set(sets.flatMap((s) => s[c]))].sort();
  return out;
}

export interface SlotMismatch {
  category: SlotCategory;
  value: string;
}

/** Slots present in `sentence` but missing from `span`. Empty = the sentence adds nothing clinical. */
export function missingSlots(sentence: Slots, span: Slots): SlotMismatch[] {
  const out: SlotMismatch[] = [];
  for (const c of SLOT_CATEGORIES) for (const value of sentence[c]) if (!span[c].includes(value)) out.push({ category: c, value });
  return out;
}

/**
 * Normalise one declared slot value (what a model put in Sentence.slots) to a glossary id.
 * Returns null when the value maps to nothing in the closed vocabulary.
 */
export function normalizeDeclared(category: SlotCategory, raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (category === "numbers") {
    if (/^\d+(\.\d+)?$/.test(value)) return canonicalNumber(value);
    const g = getKb().glossary.numbers;
    for (const [id, aliases] of Object.entries(g)) if (aliases.some((a) => a.toLowerCase() === value)) return id;
    return null;
  }
  const table = getKb().glossary[category];
  for (const [id, aliases] of Object.entries(table)) {
    if (id.toLowerCase() === value || aliases.some((a) => a.toLowerCase() === value)) return id;
  }
  return null;
}
