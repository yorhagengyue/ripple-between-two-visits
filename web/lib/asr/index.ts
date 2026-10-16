/**
 * Speech entry point (server-only).
 *
 *   import { getSpeechProvider } from "@/lib/asr";
 *   const speech = getSpeechProvider();          // SPEECH_PROVIDER = mock (default) | whisper | tencent | trtc | devfake
 *
 * mock replays web/fixtures/visits/<visit>.utterances.json; whisper calls the local Whisper service at
 * WHISPER_URL (services/whisper): when it does not answer, the live captions fall back (to the replay only with
 * ASR_REPLAY_FALLBACK on) and the record keeps the visit's live Whisper lines, never a script (lib/asr/whisper.ts);
 * tencent is Tencent Cloud speech recognition (lib/asr/tencent.ts: recording file recognition for each live line and
 * for the whole recording, with the same fallbacks); trtc is a stub that throws not_configured. devfake is a developer
 * tool (lib/asr/devfake.ts): a test names the fixture a recorded visit is transcribed as; it refuses to exist unless the
 * developer tools are on.
 *
 * whisper and tencent are the two that transcribe on this server ("live transcribers", getLiveTranscriber): the page
 * sends its lines to /api/asr/chunk, the whole-visit job is made from the saved recording, and lib/asr/pending.ts sends
 * a recording that waits for its text. The routes treat them alike; what differs is said by `livePartials`.
 */
import { DevfakeSpeechProvider } from "./devfake";
import { MockSpeechProvider } from "./mock";
import { TrtcSpeechProvider } from "./trtc";
import { tencentAsrConfig, TencentSpeechProvider } from "./tencent";
import { SpeechError, type SpeechProvider } from "./types";
import { whisperConfig, WhisperSpeechProvider } from "./whisper";

export * from "./types";
export { MockSpeechProvider, replaySchedule, captionPrefix, FIRST_PARTIAL_MS, mockJobDelayMs } from "./mock";
export { TrtcSpeechProvider } from "./trtc";
export { TencentSpeechProvider, TencentAsrClient, tencentAsrConfig, TENCENT_ASR_DEFAULTS } from "./tencent";
export type { TencentAsrConfig, TencentAsrProblem } from "./tencent";
export {
  WhisperSpeechProvider,
  WhisperClient,
  WhisperUnavailable,
  whisperConfig,
  utterancesFromSegments,
  worstConfidence,
  replayFallbackAllowed,
  MIN_WHISPER_TOKEN,
} from "./whisper";
export type { WhisperConfig, WhisperHealth, WhisperSegment, WhisperChunkResult } from "./whisper";
export { fixtureUtterances, fixtureClipPath, fixtureClipFile, isStandInClip, REPLAY_VISITS, CLIP_DIR } from "./fixtures";

export { DevfakeSpeechProvider, DEVFAKE_HEADER, devfakeFixture } from "./devfake";

/** devfake: the developer tools' transcription stand-in (lib/asr/devfake.ts), refused unless they are on. */
export type SpeechProviderName = "mock" | "trtc" | "whisper" | "tencent" | "devfake";

export function speechProviderName(env: Record<string, string | undefined> = process.env): SpeechProviderName {
  const raw = (env.SPEECH_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "" || raw === "mock") return "mock";
  if (raw === "whisper") return "whisper";
  if (raw === "tencent") return "tencent";
  if (raw === "trtc") return "trtc";
  if (raw === "devfake") return "devfake";
  throw new SpeechError("invalid", `Unknown SPEECH_PROVIDER=${env.SPEECH_PROVIDER}; use mock, whisper, tencent or trtc (devfake: developer tools only)`);
}

const g = globalThis as unknown as { __rippleSpeech?: Map<SpeechProviderName, SpeechProvider> };

export function getSpeechProvider(env: Record<string, string | undefined> = process.env): SpeechProvider {
  const name = speechProviderName(env);
  g.__rippleSpeech ??= new Map();
  let provider = g.__rippleSpeech.get(name);
  if (!provider) {
    provider =
      name === "trtc"
        ? new TrtcSpeechProvider()
        : name === "whisper"
          ? new WhisperSpeechProvider({ config: whisperConfig(env) })
          : name === "tencent"
            ? new TencentSpeechProvider({ config: tencentAsrConfig(env) })
            : name === "devfake"
              ? new DevfakeSpeechProvider(env)
              : new MockSpeechProvider();
    g.__rippleSpeech.set(name, provider);
  }
  return provider;
}

/** The whisper provider when SPEECH_PROVIDER=whisper, else null. */
export function getWhisperProvider(env: Record<string, string | undefined> = process.env): WhisperSpeechProvider | null {
  const p = getSpeechProvider(env);
  return p instanceof WhisperSpeechProvider ? p : null;
}

/**
 * A provider that transcribes on this server: live lines through /api/asr/chunk and the whole visit from the saved
 * recording (whisper, tencent). Both answer the same calls (client.chunk, probe, replayFallback, the file job and its
 * budget, cancelFileJob) and fail with the same reasons (WhisperUnavailable), so the routes treat them alike.
 */
export type LiveTranscriber = WhisperSpeechProvider | TencentSpeechProvider;

/** The provider as a live transcriber, or null (mock, trtc, devfake). Recognised by name across bundles (Symbol.hasInstance). */
export function asLiveTranscriber(p: SpeechProvider): LiveTranscriber | null {
  if (p instanceof WhisperSpeechProvider) return p;
  if (p instanceof TencentSpeechProvider) return p;
  return null;
}

/** The live transcriber of this server (SPEECH_PROVIDER whisper or tencent), else null. */
export function getLiveTranscriber(env: Record<string, string | undefined> = process.env): LiveTranscriber | null {
  return asLiveTranscriber(getSpeechProvider(env));
}

/**
 * Whether the page sends 2-3 s partial chunks besides the whole lines: Whisper yes (its own GPU, no cost per request);
 * Tencent no (every request is a paid recognition task: the caption appears when the line is done).
 */
export function livePartials(p: LiveTranscriber): boolean {
  return p.name === "whisper";
}

/** The name a person reads for the live transcriber (logs and the backstage sentences). */
export function liveTranscriberLabel(p: Pick<LiveTranscriber, "name">): string {
  return p.name === "tencent" ? "Tencent speech recognition" : "Whisper";
}
