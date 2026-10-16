/**
 * Which text-to-speech provider this process uses (names only are ever printed, never values).
 *   TTS_PROVIDER = mock (default) | trtc
 *   - trtc is chosen once TRTC_SDK_APP_ID is set (the TRTC application exists); without it TTS_PROVIDER=trtc falls back
 *     to mock with a warning, so the app runs with no keys at all.
 *   - chosen is not yet able to speak: the request is signed with a Tencent Cloud API key pair (TENCENT_SECRET_ID,
 *     TENCENT_SECRET_KEY), not with TRTC_SDK_SECRET_KEY. While those are missing the provider is trtc and not ready:
 *     no read-aloud button anywhere, and a warning names the missing variables (lib/tts/trtc.ts has the whole list).
 *
 * Whether a read-aloud button may be drawn is decided here, in one place, for every such button in the app (the demo's
 * explain card, an account's medicine card, the consent and recovery-code screens): a button is drawn only when the
 * provider can actually speak, never one that would answer 503.
 *   ttsReady()            the chosen provider answers with audio as it stands (its own `ready`): the mock always (its
 *                         placeholder tones), trtc when it is fully configured and the service has not refused that
 *                         configuration in the last ten minutes (lib/tts/trtc.ts)
 *   realVoiceReady()      ... and it is a voice, not the mock's tones
 *   readAloudOffered(who) "account": a real voice only (real-app 2.17, 6.10: 「TTS_PROVIDER=mock 时，账号上不显示『读给我听』
 *                         （占位声音对老人没有用）」); "demo": whatever answers, the mock's labelled test voice included
 *                         (「演示照旧」)
 * All three are cheap (the env and the provider's `ready`, no network): a page asks on every render.
 * Server-only.
 */
import { createMockTts } from "./mock";
import { createTrtcTts, trtcTtsConfig } from "./trtc";
import type { TtsProvider, TtsProviderName } from "./types";

type Env = Record<string, string | undefined>;

export function ttsProviderName(env: Env = process.env): TtsProviderName {
  const raw = (env.TTS_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "trtc") {
    if ((env.TRTC_SDK_APP_ID ?? "").trim()) return "trtc";
    console.warn("[tts] TTS_PROVIDER=trtc but TRTC_SDK_APP_ID is not set; using the mock voice");
    return "mock";
  }
  if (raw !== "" && raw !== "mock") console.warn(`[tts] unknown TTS_PROVIDER=${raw}; using the mock voice`);
  return "mock";
}

/** Said once per process and per set of problems, not on every render. */
const warnedIncomplete = new Set<string>();

export function getTtsProvider(env: Env = process.env): TtsProvider {
  if (ttsProviderName(env) !== "trtc") return createMockTts();
  const cfg = trtcTtsConfig(env);
  if (!cfg.ok) {
    const what = cfg.problems.join("; ");
    if (!warnedIncomplete.has(what)) {
      warnedIncomplete.add(what);
      console.warn(`[tts] TTS_PROVIDER=trtc cannot speak, read-aloud is off: ${what}`);
    }
  }
  return createTrtcTts(env);
}

type Readiness = Pick<TtsProvider, "name" | "ready">;

/** The chosen provider answers a request with audio as it stands now (the mock's placeholder tones count). */
export function ttsReady(env: Env = process.env, provider: Readiness = getTtsProvider(env)): boolean {
  return provider.ready === true;
}

/** There is a real voice that can speak now: not the mock, and not a provider that is chosen but cannot speak. */
export function realVoiceReady(env: Env = process.env, provider: Readiness = getTtsProvider(env)): boolean {
  return provider.ready === true && provider.name !== "mock";
}

/** Whose page asks: an account's (his own phone) or the demo's (the judges' walk-through). */
export type ReadAloudAudience = "account" | "demo";

/** The one rule for drawing a read-aloud button (see the header). `provider`: tests; default the chosen one. */
export function readAloudOffered(who: ReadAloudAudience, env: Env = process.env, provider: Readiness = getTtsProvider(env)): boolean {
  return who === "account" ? realVoiceReady(env, provider) : ttsReady(env, provider);
}

export * from "./types";
