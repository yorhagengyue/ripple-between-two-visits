/**
 * Text-to-speech (task M5 item 3, spec section 2 POST /api/tts). Types only.
 */
export type TtsLang = "zh-Hans" | "en";

export interface TtsRequest {
  /** exactly what is read; the provider adds nothing and drops nothing */
  text: string;
  lang: TtsLang;
}

export interface TtsAudio {
  audio: Uint8Array;
  mime: "audio/wav";
  provider: TtsProviderName;
  durationMs: number;
  /** a placeholder voice, not speech (mock) */
  synthetic: boolean;
}

export type TtsProviderName = "mock" | "trtc";

export interface TtsProvider {
  name: TtsProviderName;
  /**
   * This provider answers a request with audio as it stands now (wired and configured). Known without a network
   * call: lib/tts/index.ts ttsReady() reads it, and every read-aloud button in the app is drawn from that one rule.
   * false: synthesize() throws not_configured (TTS_PROVIDER=trtc while a variable is missing or malformed, or for ten
   * minutes after the service refused the configuration: lib/tts/trtc.ts).
   */
  ready: boolean;
  synthesize(req: TtsRequest): Promise<TtsAudio>;
}

export type TtsErrorCode = "not_configured" | "empty_text" | "too_long" | "provider_failed";

export class TtsError extends Error {
  constructor(
    readonly code: TtsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

/** Longest text one request may read (an explain card is a few hundred characters). */
export const TTS_MAX_CHARS = 2000;
