/**
 * The doctor's line sentence by sentence (owner, 10-14: asked 「我能不能多吃」, the answer is the doctor's order and the app
 * plays the few seconds of his recording that say it, not his whole line). Pure; server and client safe (no node:fs).
 *
 * The index, web/fixtures/visits/clips/sentences.json (scripts/asr/clip-sentences.ts measured it with ffmpeg's silencedetect):
 * for each stand-in clip (the example's synthetic voices, web/fixtures/visits/clips/<utterance>.wav) whose line has two or
 * more sentences, each sentence in order with where it starts and ends in the clip, in ms (about 120 ms of the pause on
 * either side, never into a word). A clip whose pauses did not split cleanly is not in it, and nor is a real recording: for
 * now only the stand-in clips are cut. Sentences are the safety layer's (lib/safety/text.ts sentenceSpans), compared by
 * their verbatim key (quoteKey).
 *
 *   sentenceRange / sentenceOf   which sentence(s) of a clip a quoted span is
 *   sentenceClipUrl              the clip URL that plays only those: &s=k, or &s=k-m for consecutive sentences
 *   sentenceCut                  where &s= is in the clip (GET /api/visits/[id]/clip slices it: lib/visit/wav.ts sliceWav)
 *   narrowQuote                  the sentences of a doctor's line that an answer to a dose question quotes
 *   quotedLine / cutTranslation  the whole line such a quote was cut from, and its checked translation cut the same way
 */
import index from "@/fixtures/visits/clips/sentences.json";
import { matchWholeSentences, quoteKey, sentenceRunOf, sentenceSpans, type SentenceSpan } from "@/lib/safety/text";
import { findReading } from "@/lib/safety/topics";
import type { Citation, Locale } from "@/lib/safety/types";
import { sameFacts } from "@/lib/translate/facts";

export interface ClipSentence {
  /** the sentence as the line writes it */
  text: string;
  /** where it is in the clip (ms), the margins included */
  startMs: number;
  endMs: number;
}

/** Sentences `from` to `to` (both included, counted from 0) of a line. */
export interface SentenceRun {
  from: number;
  to: number;
}

const INDEX: Readonly<Record<string, readonly ClipSentence[]>> = index;

/** The sentences of a stand-in clip with where each is, or null when the index has no entry for it. */
export function clipSentences(clipId: string): readonly ClipSentence[] | null {
  return Object.prototype.hasOwnProperty.call(INDEX, clipId) ? INDEX[clipId] : null;
}

/** The clip id of a stand-in clip path ("visits/clips/v2-u08.wav" -> "v2-u08"), or null for any other path. */
export function standInClipId(clipPath: string | null | undefined): string | null {
  const m = clipPath ? /^visits\/clips\/([a-z0-9]+-u\d{2,3})\.wav$/.exec(clipPath) : null;
  return m ? m[1] : null;
}

/** The sentence pieces of a text that hold words (a piece that is only a mark is not a sentence). */
const piecesOf = (text: string): SentenceSpan[] => sentenceSpans(text).filter((p) => quoteKey(p.text));

/** Where the run of keys `want` starts in `keys`, or -1. */
function runAt(keys: string[], want: string[]): number {
  for (let i = 0; i + want.length <= keys.length; i++) if (want.every((k, j) => keys[i + j] === k)) return i;
  return -1;
}

/**
 * Which sentences of a stand-in clip a quoted span is (consecutive, by their verbatim key), or null: the clip has no
 * sentence index, the span is the whole utterance, or it is not whole sentences of it.
 */
export function sentenceRange(clipId: string, span: string): SentenceRun | null {
  const all = clipSentences(clipId);
  if (!all) return null;
  const want = piecesOf(span).map((p) => quoteKey(p.text));
  if (want.length === 0 || want.length >= all.length) return null;
  const from = runAt(
    all.map((s) => quoteKey(s.text)),
    want,
  );
  return from < 0 ? null : { from, to: from + want.length - 1 };
}

/** Which one sentence of a stand-in clip the quoted span is, or null (the whole utterance, more than one sentence, none). */
export function sentenceOf(clipId: string, span: string): number | null {
  const run = sentenceRange(clipId, span);
  return run && run.from === run.to ? run.from : null;
}

/** The &s= value of a run: "k" for one sentence, "k-m" for consecutive ones. */
export function sentenceParam(run: SentenceRun): string {
  return run.from === run.to ? String(run.from) : `${run.from}-${run.to}`;
}

const S_PARAM = /([?&])s=[^&#]*/;

/**
 * A clip URL (GET /api/visits/<visit>/clip?u=<utterance>, lib/safety/candidates.ts clipUrlFor) that plays only sentence k,
 * or sentences k to m as one stretch: the same URL with &s=k or &s=k-m at its end (an s already there is replaced).
 */
export function sentenceClipUrl(clipUrl: string, run: SentenceRun | number): string {
  const value = sentenceParam(typeof run === "number" ? { from: run, to: run } : run);
  if (S_PARAM.test(clipUrl)) return clipUrl.replace(S_PARAM, `$1s=${value}`);
  const hash = clipUrl.indexOf("#");
  const head = hash < 0 ? clipUrl : clipUrl.slice(0, hash);
  const tail = hash < 0 ? "" : clipUrl.slice(hash);
  return `${head}${head.includes("?") ? "&" : "?"}s=${value}${tail}`;
}

/** The run an &s= value names in a line of `count` sentences ("0", "1-2"), or null: any other value, or past the end. */
export function parseSentenceParam(s: string, count: number): SentenceRun | null {
  const m = /^(0|[1-9]\d{0,2})(?:-(0|[1-9]\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  return from <= to && to < count ? { from, to } : null;
}

/** Where the sentences an &s= value names are in a stand-in clip (ms), or null: no index entry, or no such sentences. */
export function sentenceCut(clipId: string, s: string): { startMs: number; endMs: number } | null {
  const all = clipSentences(clipId);
  const run = all ? parseSentenceParam(s, all.length) : null;
  return all && run ? { startMs: all[run.from].startMs, endMs: all[run.to].endMs } : null;
}

// ---------------------------------------------------------------- which sentences an answer quotes

/**
 * What a dose question asks, for narrowQuote: the dose alone (「我能不能多吃」, 「我多吃了一粒怎么办」), or the dose when his
 * readings are high (「读数高的时候可以多吃一粒吗」, 「今天 150/95，我能不能多吃一粒？」).
 */
export type QuoteTopic = "dose" | "dose_high_readings";

/** Words of a question about his readings being high (with a reading typed in it: lib/safety/topics.ts findReading). */
const HIGH_READING_WORDS =
  /\bhigh(?:er)?\b|\breadings?\b|\belevated\b|\bspik(?:e|es|ed|ing)\b|\b(?:go|goes|went|gone|going|shoots?|shot)\s+up\b|读数|讀數|偏高|升高|超过|超過|上压|上壓|(?:很|太|好|有点|有點|比较|比較|还是|還是|又|都)高|高(?:了|的时候|的時候|时|時|的话|的話|过|過)|(?:血压|血壓)[^。？！?!，,]{0,3}高/i;

/** A question about his readings being high: a reading typed in it, or words for high readings. */
export function aboutHighReadings(question: string): boolean {
  return findReading(question) !== null || HIGH_READING_WORDS.test(question);
}

/**
 * The QuoteTopic of an ask whose topics include dose_change (classify.ts rule:dose_change and rule:extra_dose_taken), or
 * null for any other ask (its quotes stay whole).
 */
export function doseQuoteTopic(topics: readonly string[], question: string): QuoteTopic | null {
  if (!topics.includes("dose_change")) return null;
  return aboutHighReadings(question) ? "dose_high_readings" : "dose";
}

/** A sentence that says not to change the dose ("Please don't change the dose yourself."). */
const DOSE_REFUSAL = /\b(?:don't|do not|never|not|no)\b[^.?!;]{0,40}\b(?:dose|extra (?:tablets?|pills?)|more (?:tablets?|pills?)|another (?:tablet|pill))\b|\bdose yourself\b/i;
/** A sentence about high readings ("If your readings are high, write them down and tell me at your next visit."). */
const READINGS_SENTENCE = /\breadings?\b|\bhigh\b|\bmeasure\b|\bblood pressure\b|\babove\s+\d/i;

function bearsOn(sentence: string, topic: QuoteTopic): boolean {
  const s = sentence.replace(/[‘’ʼ]/g, "'");
  return DOSE_REFUSAL.test(s) || (topic === "dose_high_readings" && READINGS_SENTENCE.test(s));
}

/** A quote of a doctor's line: a candidate (span, cite) or a sentence made from one (also en, translation). */
interface LineQuote {
  span: string;
  en?: string;
  cite?: Citation;
  translation?: { lang: Locale; text: string };
}

/**
 * The quote of a doctor's line narrowed to the sentences that bear on a dose question (owner, 10-14): the sentence that
 * says not to change the dose, and for a question about high readings also the sentence about high readings (R4, v2-u08:
 * "Please don't change the dose yourself." alone for 「我能不能多吃」; both, so the whole line, for 「读数高的时候可以多吃一粒吗」).
 * Only the sentences change, never the line: the span is exactly those sentences of the line as written (the doctor's own
 * words, never reworded), the source id and the citation stay the line's, its clip URL gets &s=k (&s=k-m for consecutive
 * sentences), and a translation it carries is cut the same way (cutTranslation). The quote comes back as it was when:
 *   - topic is null (not a dose question), or the line's clip has no sentence index (a real recording, a one-sentence
 *     line, a clip that did not split cleanly), or the line is not the clip's own words sentence for sentence;
 *   - no sentence bears on the question, or they all do (the whole line);
 *   - the sentences would not stand alone in the line (text.ts matchWholeSentences: never after one that leaves them
 *     hanging, never before one that limits them, no boundary that turns a refusal round).
 */
export function narrowQuote<Q extends LineQuote>(quote: Q, topic: QuoteTopic | null): Q {
  if (!topic || !quote.cite) return quote;
  const clip = standInClipId(quote.cite.clipPath);
  const index = clip ? clipSentences(clip) : null;
  if (!index) return quote;
  const line = quote.span;
  if (quote.en !== undefined && quote.en.trim() !== line.trim()) return quote;
  const pieces = piecesOf(line);
  if (pieces.length !== index.length || pieces.some((p, i) => quoteKey(p.text) !== quoteKey(index[i].text))) return quote;
  const keep = pieces.map((p) => bearsOn(p.text, topic));
  const from = keep.indexOf(true);
  const to = keep.lastIndexOf(true);
  if (from < 0 || (from === 0 && to === pieces.length - 1)) return quote;
  const span = line.slice(pieces[from].start, pieces[to].end);
  if (matchWholeSentences(line, span) !== span) return quote;
  const { clipUrl } = quote.cite;
  return {
    ...quote,
    span,
    ...(quote.en !== undefined ? { en: span } : {}),
    ...(quote.translation ? { translation: { ...quote.translation, text: cutTranslation(line, span, quote.translation.text) ?? quote.translation.text } } : {}),
    cite: { ...quote.cite, ...(clipUrl ? { clipUrl: sentenceClipUrl(clipUrl, { from, to }) } : {}) },
  };
}

/**
 * The whole line a narrowed quote was cut from, for its translation: the line as the candidate list holds it (the list
 * keeps every line whole; only the answer's own copy is narrowed) when the quote is some of its sentences, else the
 * quote's own words.
 */
export function quotedLine(quote: { sourceId: string; en: string }, lines: readonly { sourceId: string; span: string }[]): string {
  const whole = lines.find((c) => c.sourceId === quote.sourceId)?.span.trim();
  return whole && whole !== quote.en.trim() && sentenceRunOf(whole, quote.en) ? whole : quote.en;
}

/**
 * The translation of some sentences of a line, from the line's translation `zh`: when the translation splits into as many
 * sentences as the line (at 。！？, lib/safety/text.ts sentenceSpans), the same sentences of it; otherwise, or when the cut
 * would not pass the deterministic check of lib/translate (facts.ts sameFacts: the same numbers, medicine names, units,
 * times, a negation kept), the whole line's translation. null when there is no translation.
 */
export function cutTranslation(line: string, part: string, zh: string | null | undefined): string | null {
  if (!zh) return null;
  const keys = piecesOf(line).map((p) => quoteKey(p.text));
  const want = piecesOf(part).map((p) => quoteKey(p.text));
  if (want.length === 0 || want.length >= keys.length) return zh;
  const from = runAt(keys, want);
  const zhPieces = piecesOf(zh);
  if (from < 0 || zhPieces.length !== keys.length) return zh;
  const cut = zh.slice(zhPieces[from].start, zhPieces[from + want.length - 1].end);
  return sameFacts(part, cut, "en>zh-Hans").pass ? cut : zh;
}
