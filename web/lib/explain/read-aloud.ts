/**
 * Read the explain card aloud (task M5 item 3). The text handed to text-to-speech is built here, on the server,
 * from the same card the page renders (buildExplainCard), so it is exactly the card's sentences in screen order and
 * nothing else: no title, no source labels, no added words. The browser cannot send its own text. Server-only.
 */
import { createHash } from "node:crypto";
import type { Locale } from "@/lib/i18n";
import { StoreError, type Store } from "@/lib/store/types";
import { getTtsProvider, type TtsAudio, type TtsProvider } from "@/lib/tts";
import { buildExplainCard } from "./card";
import { ExplainError } from "./understanding";

export interface ReadAloudResult {
  /** exactly what was sent to the provider */
  text: string;
  sha256: string;
  audio: TtsAudio;
}

export function textSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function readExplainCardAloud(
  store: Store,
  sessionId: string,
  medId: string,
  locale: Locale,
  provider: TtsProvider = getTtsProvider(),
): Promise<ReadAloudResult> {
  const session = await store.getSession(sessionId);
  if (!session) throw new StoreError("session_not_found", `No session ${sessionId}`);
  const med = await store.getMed(sessionId, medId);
  if (!med) throw new ExplainError("med_not_found", `no medicine ${medId}`);
  const card = await buildExplainCard(store, sessionId, med, { day: session.story_day, locale });
  if (!card) throw new ExplainError("not_yet", "the explain card is not there yet on this story day");
  const text = card.speechText;
  const audio = await provider.synthesize({ text, lang: locale });
  return { text, sha256: textSha256(text), audio };
}
