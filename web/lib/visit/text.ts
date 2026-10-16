/**
 * Small text helpers for the visit heuristics (role inference, extraction, question matching).
 * Pure functions; safe for client and server.
 */

import { sameQuote } from "@/lib/safety/text";

export const hasHan = (s: string): boolean => /\p{Script=Han}/u.test(s);

/**
 * NFKC, lower case, straight quotes, punctuation and whitespace removed (same idea as lib/safety/text
 * normalizeForCompare). A loose key for alignment and similarity (fallback.ts bigrams), never the verbatim test.
 */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

/**
 * Same words, ignoring case, punctuation and spacing. Loose: "Please don't. Change the dose ..." has the same words
 * as R4, so this is for alignment (script lines already said, stand-in clips, role cues), NOT for deciding that a
 * transcript line is the doctor's R line: that is sameSentence.
 */
export function sameWords(a: string, b: string): boolean {
  const na = norm(a);
  return na.length > 0 && na === norm(b);
}

/**
 * The verbatim test for R1-R4 (extract.ts): the same sentences, piece by piece, ignoring only case, whitespace,
 * quote style and the mark that ends each sentence (lib/safety/text sameQuote). A transcript line whose sentence
 * boundary moved ("Please don't. Change the dose yourself. If ...", a pause Whisper read as a full stop) is not R4:
 * it is extracted like any other line and waits for his confirmation, and is never relayed as the doctor's R line.
 */
export function sameSentence(a: string, b: string): boolean {
  return sameQuote(a, b);
}

export function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

/** A question by form: question mark, "or not", or a Mandarin question particle at the end. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return /[?？]\s*$/.test(t) || /[?？]/.test(t) || /\bor not\b/i.test(t) || /[吗呢][。！!]?\s*$/.test(t);
}

/** Teach-back: he repeats what he understood and asks for a yes ("..., right?", "……，对吗？"). */
export function isTeachBack(text: string): boolean {
  return /(?:对吗|对不对|是不是这样)[？?]?\s*$/.test(text.trim()) || /,\s*(?:right|correct)\s*\?\s*$/i.test(text.trim());
}

/** Asking to record (consent request). */
export function isConsentRequest(text: string): boolean {
  return /\b(?:can|may|could) i record\b|\bok(?:ay)? (?:if|to) (?:i )?record\b|\brecord this\b/i.test(text) || /录音吗|可以录音|可不可以录音|能不能录音/.test(text);
}

/** A short yes (consent given, teach-back confirmed). */
export function isAffirmative(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:sure|ok|okay|yes|yeah|yup|of course|no problem|go ahead|can)\b/i.test(t) ||
    /^(?:可以|好|好的|行|没问题|对|是的|是)[，,。.！!]?/.test(t)
  );
}

/** "Anything else you want to ask?" and the like: the doctor invites questions. */
export function isQuestionInvite(text: string): boolean {
  return /\banything else\b|\bany (?:other |more )?questions?\b|\bwhat else\b/i.test(text) || /还有什么(?:要|想)?问|还有别的|还有其他问题/.test(text);
}

/** "Come back in about a week", "see me in six weeks", 复诊. */
const FOLLOW_UP_EN = /\bcome back\b|\bsee (?:me|you) (?:again )?in\b|\bnext appointment\b/i;
const FOLLOW_UP_ZH = /复诊|下次再来|回来复查|再来看/;

export function isFollowUpCue(text: string): boolean {
  return FOLLOW_UP_EN.test(text) || FOLLOW_UP_ZH.test(text);
}

/** Where the follow-up words start in the text (-1 when there are none). */
export function followUpIndex(text: string): number {
  const a = FOLLOW_UP_EN.exec(text)?.index ?? -1;
  const b = FOLLOW_UP_ZH.exec(text)?.index ?? -1;
  return a < 0 ? b : b < 0 ? a : Math.min(a, b);
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/**
 * "in about a week" -> 7, "in five weeks" -> 35, "in two weeks" -> 14, "一周后" -> 7. Null when the text
 * has no "in N days/weeks" phrase. Used only to print an approximate calendar date next to the doctor's words.
 */
export function daysFromNow(text: string): { days: number; approx: boolean; phrase: string } | null {
  const en = /\bin\s+(about\s+|around\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(day|days|week|weeks|month|months)\b/i.exec(text);
  if (en) {
    const n = /^\d+$/.test(en[2]) ? Number(en[2]) : NUMBER_WORDS[en[2].toLowerCase()];
    const unit = en[3].toLowerCase();
    const mult = unit.startsWith("day") ? 1 : unit.startsWith("week") ? 7 : 30;
    return { days: n * mult, approx: !!en[1] || mult === 30, phrase: en[0] };
  }
  const zh = /(大概|大约|差不多)?([一两二三四五六七八九十\d]+)\s*(天|周|个星期|星期|个月)后/.exec(text);
  if (zh) {
    const n = /^\d+$/.test(zh[2]) ? Number(zh[2]) : NUMBER_WORDS[zh[2]] ?? null;
    if (n === null) return null;
    const mult = zh[3] === "天" ? 1 : zh[3] === "个月" ? 30 : 7;
    return { days: n * mult, approx: !!zh[1] || mult === 30, phrase: zh[0] };
  }
  return null;
}

/** ISO date + n days. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "0:49", "1:05:03" from milliseconds. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
