/**
 * Word error rate on real conversations (the whole-recording WER of a public mock-consultation set, B3), with the
 * normalisations reported separately so nobody mistakes a writing convention for a recognition error:
 *
 *   raw      lib/asr/wer.ts tokensEn as is: lower case, "&" read as "and", punctuation is a word break. A human
 *            transcript that writes "twenty second" against Whisper's "22nd", or keeps "um" and "uh" that Whisper
 *            leaves out, counts every difference.
 *   numbers  raw, plus every written number spelled out the way it is said (digitsToWords): "22nd" -> twenty
 *            second, "1990" -> nineteen ninety, "10:30" -> ten thirty, "2.5" -> two point five, "50%" -> fifty
 *            percent, "£20" -> twenty pounds. Applied to both sides (references in words are unchanged).
 *   full     numbers, plus hesitation sounds dropped on both sides (FILLERS: um, uh, er, erm, hmm, mm, mmm, mhm)
 *            and "okay" written "ok". Nothing else: no synonym lists, no British / American spelling map.
 *
 * Pure; no I/O. alignWords keeps the alignment so the most frequent substitutions can be reported.
 */
import { editCounts, errorRate, tokensEn, type EditCounts } from "./wer";

export type Normalisation = "raw" | "numbers" | "full";
export const NORMALISATIONS: Normalisation[] = ["raw", "numbers", "full"];

/** Hesitation sounds that a verbatim human transcript keeps and Whisper usually leaves out. */
export const FILLERS: ReadonlySet<string> = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hmm", "hm", "mm", "mmm", "mhm"]);

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_WORD: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

/** 0 <= n < 1e12, as words ("one hundred and five" is said in British English: the "and" is kept). */
export function cardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${cardinal(n % 100)}` : ""}`;
  for (const [size, name] of [
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ] as const) {
    if (n >= size) {
      const rest = n % size;
      return `${cardinal(Math.floor(n / size))} ${name}${rest ? (rest < 100 ? ` and ${cardinal(rest)}` : ` ${cardinal(rest)}`) : ""}`;
    }
  }
  return String(n);
}

/** "twenty two" -> "twenty second", "one hundred" -> "one hundredth". */
export function ordinal(n: number): string {
  const words = cardinal(n).split(" ");
  const last = words.pop()!;
  const ord = ORDINAL_WORD[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ord].join(" ");
}

/** A four-digit year as it is said: 1990 nineteen ninety, 2005 two thousand and five, 2010 twenty ten, 1900 nineteen hundred. */
export function yearWords(n: number): string {
  if (n >= 2000 && n < 2010) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${cardinal(hi)} hundred`;
  return `${cardinal(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : cardinal(lo)}`;
}

/**
 * Written numbers in a text spelled out as said. Handles currency (£ $), percent, times (10:30), decimals (2.5),
 * ordinals (22nd), years (1100-2099 when four digits and no comma), thousands separators (1,500), ranges and
 * fractions (2-3, 1/2 as "two three", "one two": both sides are compared as words) and plain integers.
 */
export function digitsToWords(text: string): string {
  return text
    .replace(/£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g, (_, a: string, p?: string) => `${cardinal(Number(a.replace(/,/g, "")))} pounds${p && Number(p) ? ` ${cardinal(Number(p))}` : ""}`)
    .replace(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g, (_, a: string, p?: string) => `${cardinal(Number(a.replace(/,/g, "")))} dollars${p && Number(p) ? ` ${cardinal(Number(p))}` : ""}`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => `${cardinal(Number(h))}${Number(m) === 0 ? "" : ` ${Number(m) < 10 ? `oh ${ONES[Number(m)]}` : cardinal(Number(m))}`}`)
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, d: string) => ordinal(Number(d)))
    .replace(/\b(\d+)\.(\d+)\b/g, (_, a: string, b: string) => `${cardinal(Number(a))} point ${b.split("").map((x) => ONES[Number(x)]).join(" ")}`)
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, a: string) => cardinal(Number(a.replace(/,/g, ""))))
    .replace(/\b(1[1-9]\d\d|20\d\d)\b(?!%)/g, (_, y: string) => yearWords(Number(y)))
    .replace(/(\d+)\s?%/g, (_, d: string) => `${cardinal(Number(d))} percent`)
    .replace(/\b\d+\b/g, (d: string) => (d.length > 12 ? d.split("").map((x) => ONES[Number(x)]).join(" ") : cardinal(Number(d))));
}

/** Tokens of a text under a normalisation (see the header). */
export function wordsFor(text: string, how: Normalisation): string[] {
  const tokens = tokensEn(how === "raw" ? text : digitsToWords(text));
  if (how !== "full") return tokens;
  return tokens.filter((t) => !FILLERS.has(t)).map((t) => (t === "okay" ? "ok" : t));
}

export interface WerScore extends EditCounts {
  /** (substitutions + deletions + insertions) / reference words */
  wer: number;
  hypTokens: number;
}

export function scoreWords(ref: string[], hyp: string[]): WerScore {
  const c = editCounts(ref, hyp);
  return { ...c, wer: errorRate(c), hypTokens: hyp.length };
}

/** The whole reference against the whole hypothesis, once per normalisation. */
export function scoreAll(refText: string, hypText: string): Record<Normalisation, WerScore> {
  const out = {} as Record<Normalisation, WerScore>;
  for (const how of NORMALISATIONS) out[how] = scoreWords(wordsFor(refText, how), wordsFor(hypText, how));
  return out;
}

export type AlignOp = { op: "ok" | "sub"; ref: string; hyp: string } | { op: "del"; ref: string } | { op: "ins"; hyp: string };

/**
 * A minimum-edit alignment of two token lists (substitution, deletion, insertion all cost 1; ties prefer a match or
 * substitution, then a deletion), with the operations in order. O(n x m) time and memory: fine for a consultation
 * (a few thousand words each side), not for a book.
 */
export function alignWords(ref: string[], hyp: string[]): AlignOp[] {
  const n = ref.length;
  const m = hyp.length;
  const w = m + 1;
  const cost = new Uint32Array((n + 1) * w);
  for (let j = 0; j <= m; j++) cost[j] = j;
  for (let i = 1; i <= n; i++) {
    cost[i * w] = i;
    for (let j = 1; j <= m; j++) {
      const sub = cost[(i - 1) * w + j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const del = cost[(i - 1) * w + j] + 1;
      const ins = cost[i * w + j - 1] + 1;
      cost[i * w + j] = Math.min(sub, del, ins);
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = cost[i * w + j];
    if (i > 0 && j > 0 && here === cost[(i - 1) * w + j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push(ref[i - 1] === hyp[j - 1] ? { op: "ok", ref: ref[i - 1], hyp: hyp[j - 1] } : { op: "sub", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && here === cost[(i - 1) * w + j] + 1) {
      ops.push({ op: "del", ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ op: "ins", hyp: hyp[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

/** The most frequent errors of an alignment: "ref -> hyp" for substitutions, "-ref" deleted, "+hyp" inserted. */
export function topErrors(ops: AlignOp[], limit = 15): { error: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const o of ops) {
    const key = o.op === "sub" ? `${o.ref} -> ${o.hyp}` : o.op === "del" ? `-${o.ref}` : o.op === "ins" ? `+${o.hyp}` : null;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([error, count]) => ({ error, count }));
}

/** Pooled (word-weighted) and simple mean over several scores. */
export function averageScores(scores: WerScore[]): { pooled: WerScore; mean_wer: number } {
  const sum = (k: keyof EditCounts | "hypTokens") => scores.reduce((s, x) => s + x[k], 0);
  const pooled: WerScore = {
    substitutions: sum("substitutions"),
    deletions: sum("deletions"),
    insertions: sum("insertions"),
    refTokens: sum("refTokens"),
    hypTokens: sum("hypTokens"),
    wer: 0,
  };
  pooled.wer = errorRate(pooled);
  const meanWer = scores.length ? scores.reduce((s, x) => s + x.wer, 0) / scores.length : Number.NaN;
  return { pooled, mean_wer: meanWer };
}
