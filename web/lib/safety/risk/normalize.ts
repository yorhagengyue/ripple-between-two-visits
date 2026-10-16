/**
 * His words, normalised for the crisis rules (the guided safety harness, step 1; risk/types.ts). The owner's probe of 10-16
 * (D:/ripple-c2/audit/safety-harness-1016/findings.md) found that "i wanna kil myslef" and "k i l l myself" passed every
 * rule: the rules are regular expressions over the words as typed, and an older person on a phone types with gaps, digits
 * for letters, a letter missing, a letter held down, or traditional characters. Woebot's published detector covered "about
 * 10 misspellings and 5 slang terms" next to its ~200 phrases for the same reason (the research report, crisis detection).
 *
 * normalizeForRules(text) makes ONE extra reading of the text; normalizedVariants(text) is [the text as typed, that reading]
 * and the rules run on both. Since the crisis rules only ever RAISE a risk, a reading that is slightly wrong costs at most a
 * question to him, and the original stays in the list, so nothing a rule found before is lost. What it does, in order:
 *
 *   1. NFKC (full-width letters and digits become plain ones; the full-width Chinese marks ，！？：；（） stay, since the
 *      Chinese rules end their windows at them) and the invisible format characters out (text.ts
 *      stripInvisible: "ki​ll" with a zero-width space reads as "kill");
 *   2. traditional characters of the Chinese crisis words to simplified, character by character (T2S below: 殺 -> 杀,
 *      藥 -> 药, 夠 -> 够 ...), so the simplified rules read 「我想自殺」 and 「把藥都留著沒吃」 too. The map holds only the
 *      characters the crisis and medicine rules use; a character outside it stays as typed;
 *   3. letters typed one by one with a single space, dot, dash, underscore or asterisk between them are joined when they
 *      form a word: "k i l l myself" -> "kill myself", "s.u.i.c.i.d.e" -> "suicide", "k-i-l-l-m-y-s-e-l-f" -> "kill myself"
 *      (split back into the crisis lexicon's words when it can be). Three single characters at least, two of them letters;
 *      a run that is not a crisis word and is shorter than four letters ("U S A", "a.m.") stays as it was, and a run of
 *      digits ("1 2 3") never has two letters, so a count or a date is never joined;
 *   4. digits and symbols used as letters (0 o, 1 i or l, 3 e, 4 a, 5 s, 7 t, $ s, @ a, ! i or l) are read as letters only
 *      inside a Latin word, and only when the word they then make is in the crisis lexicon ("k1ll", "su1cide", "d1e",
 *      "0verdose", "$uicide", "myse1f"). So a reading (150/95), a strength (5mg), a time (9pm, 12:30), a test name (HbA1c)
 *      or a model name (hy3) is never changed: none of them makes a lexicon word;
 *   5. a letter held down ("dieeee", "killll", "sooo") is cut to two, then to one when that makes a lexicon word
 *      ("dieeee" -> "die", "killll" -> "kill"); only Latin letters, never digits;
 *   6. misspellings of the crisis lexicon, by edit distance (optimal string alignment, so a swapped pair of letters is one
 *      edit), but ONLY inside a known crisis phrase with its neighbours ("kil myslef" -> "kill myself", "suicde",
 *      "overdoes" -> "overdose", "want to dei" -> "want to die"). Each misspelled word must start with the same letter as
 *      the lexicon word, be within one edit (two for words of six letters or more), and must not itself be a real word
 *      near a crisis word (NOT_A_TYPO: "dye", "will", "kit", "kid", "pill" ...), so "I want to dye my hair" and "I will
 *      myself" stay as they are; a single word is fixed alone only when it is long and a crisis word by itself (suicide,
 *      suicidal, overdose);
 *   7. the Singlish sentence particles lah, leh, lor, liao, ah, sia, meh are taken out where they stand as words ("die lah"
 *      -> "die"). ("liao" is part of one rule in classify.ts, "dun wan to live liao"; that rule still reads the original,
 *      which stays in normalizedVariants.)
 *
 * It never changes a number, a medicine's name or a reading: digits are only ever read as letters inside a word that then
 * spells a crisis-lexicon word, no medicine name is in the lexicon, and the edit-distance fix touches only words inside a
 * crisis phrase. Pure, no I/O.
 */
import { stripInvisible } from "../text";

/**
 * Traditional characters of the crisis and medicine words the rules use (classify.ts SELF_HARM / EMERGENCY, rules-floor.ts),
 * with their simplified forms. One character each; context-free on purpose (著 -> 着 is wrong in 著名, harmless here: the
 * rules only look for crisis words, and the original stays in normalizedVariants).
 */
const T2S_PAIRS =
  "殺杀輕轻結结傷伤藥药會会幾几顆颗夠够攢攒儲储樓楼著着沒没這这麼么過过頭头臉脸邊边氣气說说話话講讲腳脚動动無无擔担負负囑嘱後后準准備备農农蟲虫劑剂鬆松煩烦塊块歲岁點点時时號号個个禮礼週周間间從从陽阳戶户覺觉義义遺遗寫写撐撑壓压悶闷緊紧嚴严厲厉暈晕嘔呕噁恶惡恶腫肿癢痒劇剧樣样顏颜換换開开媽妈爺爷兒儿孫孙親亲喚唤聽听塗涂認认識识嚇吓讓让醫医師师還还數数紅红藍蓝綠绿圓圆長长變变別别們们嗎吗見见電电腦脑機机給给帶带錯错對对體体臟脏歡欢愛爱憂忧鬱郁絕绝單单贅赘擾扰錢钱夢梦隨随種种類类廠厂狀状現现經经麵面喪丧嚨咙熱热餓饿";
const T2S = new Map<string, string>();
for (let i = 0; i + 1 < T2S_PAIRS.length; i += 2) T2S.set(T2S_PAIRS[i], T2S_PAIRS[i + 1]);

/**
 * The crisis lexicon: the words a spaced, digit-for-letter or held-down spelling is read into (steps 3 to 5) and the
 * words the crisis phrases are made of. No medicine name is in it.
 */
const LEXICON = new Set([
  "kill", "kills", "killing", "killed", "myself", "me", "my", "self", "die", "dying", "died", "dead", "death",
  "suicide", "suicidal", "overdose", "overdosed", "overdosing", "end", "ending", "life", "live", "living", "alive",
  "hurt", "harm", "cut", "hang", "jump", "pills", "pill", "tablets", "tablet", "want", "wanna", "to", "sleep", "forever",
  "wake", "never", "burden", "better", "off", "without", "it", "all", "dont", "don't", "not", "no", "reason", "worth",
  "enough", "stop", "heart", "take", "i", "im", "going", "gonna", "poison", "unalive",
]);

/**
 * Crisis phrases the edit-distance fix (step 6) may complete. Every word of a phrase is compared with his words in the same
 * order; short glue words (to, my, it, all, off, no) must match exactly. The phrases are the self-harm rules' own words
 * (classify.ts SELF_HARM: "kill(ing) myself", "end my life", "want to die", "hurt / harm myself", "better off dead", "no
 * reason to live", "not worth living", "end it all", "never wake up"; "sleeping pills" for the cue words), plus the three
 * long words that are crisis words alone.
 */
const PHRASES: string[][] = [
  ["kill", "myself"],
  ["killing", "myself"],
  ["hurt", "myself"],
  ["harm", "myself"],
  ["hurting", "myself"],
  ["harming", "myself"],
  ["end", "my", "life"],
  ["take", "my", "life"],
  ["want", "to", "die"],
  ["wanna", "die"],
  ["better", "off", "dead"],
  ["no", "reason", "to", "live"],
  // round 2 (10-16): "dont want to liv anymor", "want to liv", "wanna liv"
  ["dont", "want", "to", "live"],
  ["want", "to", "live"],
  ["wanna", "live"],
  ["live", "anymore"],
  ["not", "worth", "living"],
  ["end", "it", "all"],
  ["never", "wake", "up"],
  ["sleeping", "pills"],
  ["suicide"],
  ["suicidal"],
  ["overdose"],
  ["overdosed"],
  ["overdosing"],
];

/** Real words that sit within an edit of a crisis word: never "corrected" into one (step 6). */
const NOT_A_TYPO = new Set([
  "dye", "dyes", "will", "fill", "till", "bill", "hill", "mill", "pill", "sill", "ill", "kit", "kid", "kin", "kiss", "kilt",
  "kiln", "did", "dig", "dim", "din", "tie", "lie", "pie", "due", "doe", "dine", "dice", "dime", "dive", "diet", "love",
  "line", "like", "wine", "mine", "wife", "lift", "wait", "went", "wont", "wand", "wane", "hard", "head", "hunt", "hut",
  "hart", "farm", "warm", "hare", "deed", "deaf", "deal", "dear", "read", "need", "seed", "and", "add", "odd", "steep",
  "sweep", "slip", "sleepy", "weak", "make", "lake", "bake", "fake", "take", "tale", "hell", "help", "held", "wake", "woke",
  "word", "work", "worm", "north", "life", "live", "lives", "lived", "liver", "self", "shelf", "itself", "himself", "herself",
  "yourself", "better", "batter", "bitter", "butter", "letter", "off", "of", "on", "one", "in", "is", "it", "at", "to", "too",
  "two", "do", "go", "so", "no", "not", "now", "nor", "my", "me", "by", "up", "us", "all", "ill", "end", "and", "ending",
  "reason", "season", "risen", "dead", "deaf", "bead", "lead", "mead", "suicide", "overdose", "kill", "die",
]);

/** Optimal string alignment distance (Levenshtein plus one swap of two neighbouring letters as one edit). */
export function osaDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

const LEET: Record<string, string[]> = { "0": ["o"], "1": ["i", "l"], "3": ["e"], "4": ["a"], "5": ["s"], "7": ["t"], $: ["s"], "@": ["a"], "!": ["i", "l"] };
const isLatin = (c: string) => /[A-Za-z]/.test(c);

/** Every reading of a token with its digits and symbols as letters (at most 32), lower case. */
function leetReadings(token: string): string[] {
  let out = [""];
  for (const ch of token.toLowerCase()) {
    const opts = LEET[ch] ?? [ch];
    out = out.flatMap((p) => opts.map((o) => p + o));
    if (out.length > 32) out = out.slice(0, 32);
  }
  return out;
}

const letterCount = (s: string) => [...s].filter(isLatin).length;
const hasLeet = (s: string) => /[0-9$@!]/.test(s);

/** Step 4: a Latin token with digits or symbols that spells a lexicon word read as letters, or null. */
function leetWord(token: string): string | null {
  if (!hasLeet(token) || letterCount(token) < 2) return null;
  return leetReadings(token).find((r) => LEXICON.has(r)) ?? null;
}

/** Step 5: runs of three or more of one letter cut to two, or to one when that spells a lexicon word. */
function collapseHeld(token: string): string | null {
  if (!/([A-Za-z])\1\1/.test(token)) return null;
  const two = token.replace(/([A-Za-z])\1{2,}/g, "$1$1");
  if (LEXICON.has(two.toLowerCase())) return two.toLowerCase();
  // each held run at one letter instead of two, in turn
  const runs = [...token.matchAll(/([A-Za-z])\1{2,}/g)].length;
  for (let mask = 1; mask < 1 << Math.min(runs, 4); mask++) {
    let k = 0;
    const cand = token.replace(/([A-Za-z])\1{2,}/g, (_m, c: string) => ((mask >> k++) & 1 ? c : c + c));
    if (LEXICON.has(cand.toLowerCase())) return cand.toLowerCase();
  }
  return two;
}

/** Split a joined run of letters into lexicon words ("killmyself" -> "kill myself"), or null. */
function segment(s: string): string | null {
  const n = s.length;
  const best: (string[] | null)[] = Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 10); j < i; j++) {
      const w = s.slice(j, i);
      if (best[j] && LEXICON.has(w) && (w.length > 1 || w === "i")) {
        const cand = [...best[j]!, w];
        if (!best[i] || cand.length < best[i]!.length) best[i] = cand;
      }
    }
  }
  return best[n] ? best[n]!.join(" ") : null;
}

/** Step 3: single characters typed apart, joined when they form a word. */
const SPACED = /(?<![\p{L}\p{N}])[A-Za-z0-9$@!](?:[ .\-_*][A-Za-z0-9$@!]){2,}(?![\p{L}\p{N}])/gu;
function joinSpaced(text: string): string {
  return text.replace(SPACED, (run) => {
    const chars = run.replace(/[ .\-_*]/g, "");
    if (letterCount(chars) < 2) return run;
    if (hasLeet(chars)) {
      const word = leetReadings(chars).find((r) => LEXICON.has(r) || segment(r));
      return word ? (LEXICON.has(word) ? word : segment(word)!) : run;
    }
    const lower = chars.toLowerCase();
    if (LEXICON.has(lower)) return lower;
    const split = segment(lower);
    if (split) return split;
    return chars.length >= 4 ? lower : run;
  });
}

/** Steps 4 and 5 on every Latin token. */
function fixTokens(text: string): string {
  // ("!" only between letters: "k!ll" is a word, "help!" is a word and a mark)
  return text.replace(/[A-Za-z0-9$@]+(?:!+[A-Za-z0-9$@]+)*/g, (tok) => {
    if (!/[A-Za-z]/.test(tok)) return tok;
    const leet = leetWord(tok);
    if (leet) return leet;
    const held = collapseHeld(tok);
    return held ?? tok;
  });
}

/** Glue words of a phrase: matched exactly. "2" is read as "to" inside a phrase ("want 2 die"). */
const GLUE = new Set(["to", "my", "it", "all", "off", "no", "up", "me"]);
const SYNONYM: Record<string, string> = { "2": "to", u: "you" };

function wordMatches(token: string, target: string): number | null {
  const t = token.toLowerCase();
  if (t === target) return 0;
  if (SYNONYM[t] === target) return 0;
  if (GLUE.has(target)) return null;
  // a real word near a crisis word, or another word of the lexicon spelled right ("suicidal" is not a typo of "suicide")
  if (NOT_A_TYPO.has(t) || LEXICON.has(t)) return null;
  const readings = hasLeet(t) ? leetReadings(t) : [t];
  let best: number | null = null;
  for (const r of readings) {
    if (r[0] !== target[0]) continue;
    const limit = target.length >= 6 ? 2 : 1;
    const d = osaDistance(r, target);
    if (d <= limit && (best === null || d < best)) best = d;
  }
  return best;
}

/** Step 6: misspelled crisis phrases completed, word by word, only where the whole phrase is there. */
function fixPhrases(text: string): string {
  const re = /[A-Za-z0-9$@!']+/g;
  const toks: { s: string; i: number; e: number }[] = [];
  for (const m of text.matchAll(re)) toks.push({ s: m[0], i: m.index!, e: m.index! + m[0].length });
  const edits: { i: number; e: number; s: string }[] = [];
  const used = new Set<number>();
  for (let k = 0; k < toks.length; k++) {
    if (used.has(k)) continue;
    for (const ph of PHRASES) {
      if (k + ph.length > toks.length) continue;
      if (ph.length === 1 && ph[0].length < 7) continue;
      let total = 0;
      let ok = true;
      for (let w = 0; w < ph.length; w++) {
        // the words of a phrase stand next to each other, a space or two apart, no sentence mark between them
        if (w > 0 && !/^[\s]{1,2}$/.test(text.slice(toks[k + w - 1].e, toks[k + w].i))) {
          ok = false;
          break;
        }
        const d = wordMatches(toks[k + w].s, ph[w]);
        if (d === null) {
          ok = false;
          break;
        }
        total += d;
      }
      if (!ok || total === 0 || total > 3) continue;
      for (let w = 0; w < ph.length; w++) {
        if (toks[k + w].s.toLowerCase() !== ph[w]) edits.push({ i: toks[k + w].i, e: toks[k + w].e, s: ph[w] });
        used.add(k + w);
      }
      break;
    }
  }
  let out = text;
  for (const ed of edits.sort((a, b) => b.i - a.i)) out = out.slice(0, ed.i) + ed.s + out.slice(ed.e);
  return out;
}

/** Step 7: Singlish sentence particles standing as words. */
const PARTICLES = /(?<![\p{L}\p{N}'’-])(?:lah|leh|lor|liao|ah|sia|meh)(?![\p{L}\p{N}'’-])/giu;

/** His words read for the rules (see the header). Pure; returns the text unchanged when there is nothing to read. */
export function normalizeForRules(text: string): string {
  // (NFKC around the full-width Chinese marks, which stay as typed: the Chinese rules stop their windows at 「，」「？」)
  let t = stripInvisible(text.replace(/[^，！？：；（）]+/g, (s) => s.normalize("NFKC")));
  t = [...t].map((c) => T2S.get(c) ?? c).join("");
  // (round 2, 10-16: Chinese characters typed apart, 「想 自 杀」「我 想 死」: the spaces between two of them go)
  t = t.replace(/(?<=\p{Script=Han})[ 　]+(?=\p{Script=Han})/gu, "");
  t = joinSpaced(t);
  t = fixTokens(t);
  t = t.replace(/\bmy\s+self\b/gi, "myself");
  t = fixPhrases(t);
  t = t.replace(PARTICLES, " ");
  // tidy the gaps the steps left (never inside a number: "150 / 95" keeps its spaces as typed when nothing was taken out)
  return t.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?;:，。！？；：])/g, "$1").trim();
}

/** The text as typed, then its normalised reading when that differs: the rules run on each and the results are joined. */
export function normalizedVariants(text: string): string[] {
  const norm = normalizeForRules(text);
  return norm === text ? [text] : [text, norm];
}
