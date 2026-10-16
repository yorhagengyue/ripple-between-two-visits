/**
 * What the patient actually sees for an AskResult, as plain lines. Used by the eval and the tests so that
 * "the output contains X" means the same thing everywhere. A sentence shows its Mandarin in the zh-Hans UI when
 * it has one (template, patient_text restatement); otherwise the original words (English doctor quotes stay
 * English, as the plan says). Ripple's own explanation of the quotes (gloss.ts), when the answer has one, stands where
 * the screen shows it (after the last quote, before the fixed referral line), followed by the line that says whose words
 * they are (gloss-note.ts).
 */
import { GENERAL_NOTE, GLOSS_NOTE } from "./gloss-note";
import type { AskResult, Gloss, Locale, Sentence } from "./types";

export function sentenceText(s: Sentence, locale: Locale): string {
  return locale === "zh-Hans" && s.zh ? s.zh : s.en;
}

/** Ripple's explanation as lines: its sentences as written, then the quiet line under them (in the UI's language). */
export function glossLines(gloss: Gloss, locale: Locale): string[] {
  if (gloss.sentences.length === 0) return [];
  const note = gloss.kind === "general" ? GENERAL_NOTE : GLOSS_NOTE;
  return [...gloss.sentences.map((s) => s.text), locale === "zh-Hans" ? note.zh : note.en];
}

export function renderLines(result: Pick<AskResult, "sentences" | "gloss">, locale: Locale): string[] {
  const lines = result.sentences.map((s) => sentenceText(s, locale));
  if (result.gloss) lines.splice(Math.max(0, Math.min(result.gloss.at, lines.length)), 0, ...glossLines(result.gloss, locale));
  return lines;
}

export function renderText(result: Pick<AskResult, "sentences" | "gloss">, locale: Locale): string {
  return renderLines(result, locale).join("\n");
}

/** Every string that could reach a screen in either language (for the do-not-display scan). */
export function allOutputText(result: Pick<AskResult, "sentences" | "fixedText" | "fixedTextZh" | "gloss">): string {
  return [
    ...result.sentences.flatMap((s) => [s.en, s.zh ?? "", s.translation?.text ?? ""]),
    ...(result.gloss?.sentences.map((s) => s.text) ?? []),
    result.fixedText ?? "",
    result.fixedTextZh ?? "",
  ].join("\n");
}

/** Does a sentence cite this source? "visit:v3" matches visit:v3:v3-u08; "hh-amlodipine" matches hh-amlodipine:amlodipine.missed. */
export function citesSource(sourceId: string, expected: string): boolean {
  return sourceId === expected || sourceId.startsWith(`${expected}:`);
}
