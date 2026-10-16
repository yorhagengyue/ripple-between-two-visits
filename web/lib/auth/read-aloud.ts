/**
 * 「读给我听」 on the account screens (docs/plan/real-app.md 2.0, 2.17, 6.10; track A). Server-only.
 *
 *   accountReadAloudAvailable()   false while the text-to-speech provider is the mock: its placeholder tones are no use
 *                                 to an old man, so the pages leave the button out and the route answers 404.
 *                                 C2 track F, round three: also false while a real provider is chosen but cannot speak
 *                                 (TTS_PROVIDER=trtc with a setting missing or refused: lib/tts/trtc.ts). The rule lives in one
 *                                 place, lib/tts/index.ts readAloudOffered("account"), for every button in the app.
 *   readAccountScreenAloud(...)   one part of one screen's sentences, read by the provider. The text is built here from
 *                                 the same function the screen renders (lib/auth/read-aloud-text.ts): the browser names
 *                                 a screen, a language and a part number, never any words of its own.
 */
import { createHash } from "node:crypto";
import type { ConsentLocale } from "@/lib/privacy/consent-texts";
import { getTtsProvider, readAloudOffered, type TtsAudio, type TtsProvider } from "@/lib/tts";
import { readAloudParts, type ReadAloudScreen } from "./read-aloud-text";

type Env = Record<string, string | undefined>;

/** Is there a real voice that can speak now (lib/tts readAloudOffered: not the mock, not a provider that cannot speak)? */
export function accountReadAloudAvailable(env: Env = process.env): boolean {
  return readAloudOffered("account", env);
}

export interface AccountReadAloud {
  /** exactly what was sent to the provider */
  text: string;
  sha256: string;
  /** this part's number (from 0) and how many the screen has */
  part: number;
  parts: number;
  audio: TtsAudio;
}

/** One part of a screen read aloud; null when the screen has no such part. Throws the provider's TtsError. */
export async function readAccountScreenAloud(screen: ReadAloudScreen, locale: ConsentLocale, part: number, provider: TtsProvider = getTtsProvider()): Promise<AccountReadAloud | null> {
  const parts = readAloudParts(screen, locale);
  if (!Number.isInteger(part) || part < 0 || part >= parts.length) return null;
  const text = parts[part];
  const audio = await provider.synthesize({ text, lang: locale });
  return { text, sha256: createHash("sha256").update(text, "utf8").digest("hex"), part, parts: parts.length, audio };
}
