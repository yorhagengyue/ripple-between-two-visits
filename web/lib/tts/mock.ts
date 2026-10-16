/**
 * TTS_PROVIDER=mock: a playable placeholder, no network, no keys. Every character of the text becomes a short soft
 * tone (pitch from the character code), spaces and punctuation become short pauses, so the audio is as long as the
 * text and the same text always gives the same bytes. 16 kHz mono 16-bit WAV, between 1.5 and 30 seconds. It is
 * not speech; the read-aloud button says "test voice" while this provider is in use.
 */
import { encodeWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { TTS_MAX_CHARS, TtsError, type TtsAudio, type TtsProvider, type TtsRequest } from "./types";

const TONE_MS = 70;
const GAP_MS = 25;
const PAUSE_MS = 140;
const MIN_MS = 1500;
const MAX_MS = 30_000;
const AMPLITUDE = 0.12;

const isPause = (ch: string) => /[\s\p{P}]/u.test(ch);

export function mockWav(text: string): { audio: Uint8Array; durationMs: number } {
  const rate = TARGET_SAMPLE_RATE;
  const segs: { freq: number | null; ms: number }[] = [];
  for (const ch of Array.from(text)) {
    if (isPause(ch)) segs.push({ freq: null, ms: PAUSE_MS });
    else {
      segs.push({ freq: 260 + ((ch.codePointAt(0) ?? 0) % 9) * 35, ms: TONE_MS });
      segs.push({ freq: null, ms: GAP_MS });
    }
  }
  let total = segs.reduce((a, s) => a + s.ms, 0);
  if (total < MIN_MS) {
    segs.push({ freq: null, ms: MIN_MS - total });
    total = MIN_MS;
  }
  const totalMs = Math.min(total, MAX_MS);
  const samples = new Float32Array(Math.round((totalMs / 1000) * rate));
  let at = 0;
  for (const s of segs) {
    const n = Math.round((s.ms / 1000) * rate);
    if (s.freq !== null) {
      const fade = Math.min(n / 2, Math.round(0.01 * rate));
      for (let i = 0; i < n && at + i < samples.length; i++) {
        const env = Math.min(1, i / fade, (n - i) / fade);
        samples[at + i] = AMPLITUDE * env * Math.sin((2 * Math.PI * s.freq * i) / rate);
      }
    }
    at += n;
    if (at >= samples.length) break;
  }
  return { audio: encodeWav(samples, rate), durationMs: totalMs };
}

export function createMockTts(): TtsProvider {
  return {
    name: "mock",
    // always answers (placeholder tones, not a voice: lib/tts/index.ts realVoiceReady() is false for it)
    ready: true,
    async synthesize(req: TtsRequest): Promise<TtsAudio> {
      if (!req.text.trim()) throw new TtsError("empty_text", "nothing to read");
      if (req.text.length > TTS_MAX_CHARS) throw new TtsError("too_long", `more than ${TTS_MAX_CHARS} characters`);
      const { audio, durationMs } = mockWav(req.text);
      return { audio, mime: "audio/wav", provider: "mock", durationMs, synthetic: true };
    },
  };
}
