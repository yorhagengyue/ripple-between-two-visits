/**
 * Word error rate for the M14 measurements (and the PriMock57 check later). Pure, client-safe.
 *
 * English: lower case, "&" read as "and", every character other than a-z 0-9 and the apostrophe is a word
 * break; numbers are not spelled out ("135/85" vs "135 over 85" counts as an error, honestly).
 * Mandarin: character error rate: every Han character is a token, a run of Latin letters or digits inside
 * the Mandarin is one token, punctuation is dropped. The service already writes Simplified Chinese.
 *
 * services/whisper/bench/wer.py implements the same rules for the direct service benchmark.
 */

export function tokensEn(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export function tokensZh(text: string): string[] {
  const out: string[] = [];
  const re = /(\p{Script=Han})|([a-z0-9']+)/gu;
  for (const m of text.toLowerCase().matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

export interface EditCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
  refTokens: number;
}

/** Levenshtein alignment counts (reference -> hypothesis). */
export function editCounts(ref: string[], hyp: string[]): EditCounts {
  const n = ref.length;
  const m = hyp.length;
  // dp over two rows, with backpointers kept as counts
  type Cell = { cost: number; s: number; d: number; i: number };
  let prev: Cell[] = Array.from({ length: m + 1 }, (_, j) => ({ cost: j, s: 0, d: 0, i: j }));
  for (let a = 1; a <= n; a++) {
    const cur: Cell[] = [{ cost: a, s: 0, d: a, i: 0 }];
    for (let b = 1; b <= m; b++) {
      const same = ref[a - 1] === hyp[b - 1];
      const diag = prev[b - 1];
      const up = prev[b];
      const left = cur[b - 1];
      const cSub = diag.cost + (same ? 0 : 1);
      const cDel = up.cost + 1;
      const cIns = left.cost + 1;
      if (cSub <= cDel && cSub <= cIns) cur.push({ cost: cSub, s: diag.s + (same ? 0 : 1), d: diag.d, i: diag.i });
      else if (cDel <= cIns) cur.push({ cost: cDel, s: up.s, d: up.d + 1, i: up.i });
      else cur.push({ cost: cIns, s: left.s, d: left.d, i: left.i + 1 });
    }
    prev = cur;
  }
  const last = prev[m];
  return { substitutions: last.s, deletions: last.d, insertions: last.i, refTokens: n };
}

export function errorRate(c: EditCounts): number {
  return c.refTokens ? (c.substitutions + c.deletions + c.insertions) / c.refTokens : 0;
}

export type RefLang = "en" | "zh";

/** "en", "en-SG" -> en; anything with zh (zh, zh-en mixed) -> zh. */
export function refLang(lang: string): RefLang {
  return /^zh/i.test(lang) ? "zh" : "en";
}

export interface TimedText {
  t_start_ms: number;
  t_end_ms: number;
  text: string;
}

export interface RefLine extends TimedText {
  id: string;
  lang: string;
}

export interface LangScore extends EditCounts {
  rate: number;
  lines: number;
}

/**
 * Score a transcript against the script, per language. Each hypothesis line goes to the script line it
 * overlaps most in time (the language of that line decides where it counts); the reference and the
 * hypothesis of each language are then compared as one sequence in time order.
 */
export function scoreByLanguage(ref: RefLine[], hyp: TimedText[]): Record<RefLang, LangScore> & { perLine: { id: string; lang: RefLang; hyp: string; rate: number }[] } {
  const assigned = new Map<string, TimedText[]>();
  for (const h of hyp) {
    let best: RefLine | null = null;
    let bestOverlap = 0;
    for (const r of ref) {
      const ov = Math.min(h.t_end_ms, r.t_end_ms) - Math.max(h.t_start_ms, r.t_start_ms);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = r;
      }
    }
    if (!best) {
      // no overlap at all: the nearest line by midpoint
      const mid = (h.t_start_ms + h.t_end_ms) / 2;
      best = ref.reduce((a, r) => (Math.abs((r.t_start_ms + r.t_end_ms) / 2 - mid) < Math.abs((a.t_start_ms + a.t_end_ms) / 2 - mid) ? r : a), ref[0]);
    }
    if (best) assigned.set(best.id, [...(assigned.get(best.id) ?? []), h]);
  }
  const tok = (lang: RefLang, s: string) => (lang === "zh" ? tokensZh(s) : tokensEn(s));
  const seq: Record<RefLang, { ref: string[]; hyp: string[]; lines: number }> = { en: { ref: [], hyp: [], lines: 0 }, zh: { ref: [], hyp: [], lines: 0 } };
  const perLine: { id: string; lang: RefLang; hyp: string; rate: number }[] = [];
  for (const r of ref) {
    const lang = refLang(r.lang);
    const hs = (assigned.get(r.id) ?? []).sort((a, b) => a.t_start_ms - b.t_start_ms).map((h) => h.text);
    const hypText = hs.join(" ");
    const rt = tok(lang, r.text);
    const ht = tok(lang, hypText);
    seq[lang].ref.push(...rt);
    seq[lang].hyp.push(...ht);
    seq[lang].lines += 1;
    perLine.push({ id: r.id, lang, hyp: hypText, rate: errorRate(editCounts(rt, ht)) });
  }
  const score = (lang: RefLang): LangScore => {
    const c = editCounts(seq[lang].ref, seq[lang].hyp);
    return { ...c, rate: errorRate(c), lines: seq[lang].lines };
  };
  return { en: score("en"), zh: score("zh"), perLine };
}

/** p-th percentile (0-100) by linear interpolation; NaN for an empty list. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
