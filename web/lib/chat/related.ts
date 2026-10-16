/**
 * The doctor's own line under a note about the same symptom (journey 04; 老人端提示词 04.3: 9月30日他说「今天在大巴窑中心走了
 * 一圈，脚踝有点肿。」，Ripple 回「记下了。」，下面放 Dr Lim 9月1日 0:37 那句原话，再给一个「加进问题单」，他点了才加). Pure.
 *
 * The safety layer keeps such a sentence a note (log_only: it asks nothing and names no medicine). The chat screen then
 * looks for what his doctor said about the same thing, by rule, never by a model: his note and the doctor's line must
 * name the same symptom (the safety layer's own side-effect facets, lib/safety/topics.ts facetsOf: swelling, dizziness,
 * headache, rash, cough, flushing) AND the same part of the body (ankle and leg, face, hand, eye, head). A note that
 * names no part of the body gets nothing (too loose to put a doctor's words under it); a question the doctor asked
 * ("Any ankle swelling?") is not a line to quote. The line is shown whole, with its date, time point and clip; nothing
 * links his symptom to a cause, and the question goes on his list only if he taps.
 */
import { facetsOf } from "@/lib/safety/topics";
import type { SaidLine } from "./said";

const BODY: readonly { id: string; re: RegExp }[] = [
  { id: "ankle_leg", re: /\bankles?\b|\bfeet\b|\bfoot\b|\blegs?\b|脚踝|脚腕|脚|腿/i },
  { id: "face", re: /\bface\b|脸/i },
  { id: "hand", re: /\bhands?\b|\bfingers?\b|手/i },
  { id: "eye", re: /\beyes?\b|眼/i },
  { id: "head", re: /\bhead\b|头/i },
];

const bodyParts = (text: string) => BODY.filter((b) => b.re.test(text)).map((b) => b.id);
const isQuestion = (text: string) => /[?？]\s*$/.test(text.trim());

/** The newest doctor line about the same symptom and the same part of the body, or null. `lines`: newest first. */
export function relatedDoctorLine(note: string, lines: readonly SaidLine[]): SaidLine | null {
  const symptoms = facetsOf("side_effects", note);
  const parts = bodyParts(note);
  if (!symptoms.length || !parts.length) return null;
  for (const line of lines) {
    if (line.role !== "doctor" || isQuestion(line.text)) continue;
    const theirs = facetsOf("side_effects", line.text);
    if (!theirs.some((f) => symptoms.includes(f))) continue;
    if (!bodyParts(line.text).some((p) => parts.includes(p))) continue;
    return line;
  }
  return null;
}
