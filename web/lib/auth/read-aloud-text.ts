/**
 * The sentences of the account screens that have 「读给我听」 (docs/plan/real-app.md 2.0: the consent pages and the
 * recovery-code pages; track A). One function gives a screen's sentences in screen order: the screen renders exactly
 * these, and the server reads exactly these aloud (lib/auth/read-aloud.ts), so the voice can never say something the
 * screen does not show. Client-safe and pure.
 *
 *   terms_privacy        sign-up: the terms and privacy text as published (lib/privacy/consent-texts.ts)
 *   ai_processing        sign-up: the AI-processing text as published
 *   recovery_code        sign-up's last screen: what the recovery code is for
 *   recovery_code_new    「我 → 恢复码」 after a new code was made
 *   recovery_code_reset  /recover after the reset: the code he used is spent, here is the new one
 *
 * The code itself is never part of these: the server does not have it (only its hash), and it is not sent to a voice
 * service. He reads the code off the screen.
 */
import { currentConsentText, type ConsentLocale } from "@/lib/privacy/consent-texts";
import { accountCopy } from "./copy";

export const READ_ALOUD_SCREENS = ["terms_privacy", "ai_processing", "recovery_code", "recovery_code_new", "recovery_code_reset"] as const;
export type ReadAloudScreen = (typeof READ_ALOUD_SCREENS)[number];

/** A consent paragraph as it is said: the list mark 「· 」 is drawn, not read. */
const spoken = (paragraph: string): string => paragraph.replace(/^·\s*/, "");

/** The screen's sentences, in screen order. The first one is its headline. */
export function readAloudLines(screen: ReadAloudScreen, locale: ConsentLocale): string[] {
  const c = accountCopy(locale);
  switch (screen) {
    case "terms_privacy":
    case "ai_processing": {
      const t = currentConsentText(screen, locale);
      return [t.title, ...t.paragraphs];
    }
    case "recovery_code":
      return [c.codeTitle, c.codeWarning, c.codeLede, c.codeOnce, c.codeNoOther];
    case "recovery_code_new":
      return [c.codeTitle, c.codeWarning, c.codeLede, c.codeNoOther];
    case "recovery_code_reset":
      return [c.resetDoneTitle, c.resetDoneLede, c.codeWarning, c.codeNoOther];
  }
}

/** The longest text one request reads (well under lib/tts TTS_MAX_CHARS, so the voice starts soon). */
export const READ_ALOUD_PART_CHARS = 600;

/**
 * What is read, in parts: the screen's sentences in order, joined by line breaks, cut between sentences so that no
 * part is longer than READ_ALOUD_PART_CHARS (a single longer sentence is its own part).
 */
export function readAloudParts(screen: ReadAloudScreen, locale: ConsentLocale): string[] {
  const parts: string[] = [];
  let current = "";
  for (const line of readAloudLines(screen, locale).map(spoken)) {
    if (current && current.length + 1 + line.length > READ_ALOUD_PART_CHARS) {
      parts.push(current);
      current = line;
    } else current = current ? `${current}\n${line}` : line;
  }
  if (current) parts.push(current);
  return parts;
}
