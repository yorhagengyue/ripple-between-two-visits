/**
 * TTS_PROVIDER=trtc: Tencent RTC (TRTC) speech synthesis, the standalone TextToSpeech API. Server-only.
 *
 * NOT VERIFIED AGAINST THE REAL SERVICE. There is no TRTC account or key on the machine this was written on (10-11):
 * everything below follows the vendor's published pages and is tested against a stand-in built from their examples
 * (tests/unit/tts/). The first real sentence is the owner's: scripts/tts/say.ts.
 *
 * What it calls (pages read 2026-10-11; the list with what each one gave is in progress/t.md):
 *   POST https://trtc.intl.tencentcloudapi.com/   X-TC-Action: TextToSpeech, X-TC-Version: 2019-07-22,
 *   X-TC-Region: ap-singapore (the only region the page lists), signed with Signature v3 (lib/tts/tc3.ts)
 *   body  { Text (length 1..255), Voice { VoiceId, Speed }, SdkAppId, AudioFormat { Format: "wav", SampleRate }, Language }
 *   200   { Response: { Audio: <base64>, RequestId, ... } }   or   { Response: { Error: { Code, Message }, RequestId } }
 *
 * Credentials. The request is signed with a Tencent Cloud API key pair, not with the application's SDKSecretKey (the
 * vendor's hackathon guide: "Use SDKAppID and the cloud API SecretId / SecretKey, rather than SDKSecretKey"):
 *   TRTC_SDK_APP_ID       the application's SDKAppID (a number; goes in the body as SdkAppId)
 *   TENCENT_SECRET_ID     the cloud API key pair from the TRTC console's account menu, "Access Keys"
 *   TENCENT_SECRET_KEY
 *   TRTC_SDK_SECRET_KEY   plays no part in speech synthesis
 * Optional: TRTC_TTS_VOICE_ZH, TRTC_TTS_VOICE_EN (voice ids), TRTC_TTS_SPEED (0.5..2, default 0.9: a little slower
 * than the service's 1.0, for an older listener), TRTC_TTS_SAMPLE_RATE (16000 | 24000), TRTC_TTS_TIMEOUT_MS,
 * TRTC_TTS_ENDPOINT (a trtc.*.tencentcloudapi.com host name: the mainland examples use trtc.tencentcloudapi.com),
 * TRTC_TTS_REGION. All are read on the server only and never reach a browser.
 *
 * One request holds at most 255 "characters", where the service counts a Chinese character as 2 (the vendor's
 * FlowTTS counting rules); a card is longer than that. So the text is cut at line ends, then sentence ends, then
 * clause marks (splitForTrtc), each piece is asked for on its own, and the answers are joined into one WAV with a
 * short pause between them. Every word of the text is in exactly one piece, in order; nothing is added. A card
 * in Mandarin quotes the doctor in English: each piece carries its own Language (zh when it has a Chinese character,
 * en otherwise), and one voice (the request's language's) reads them all.
 *
 * `ready` (lib/tts/index.ts ttsReady() reads it; every read-aloud button in the app is drawn from it), no network:
 *   1. the configuration is complete and well formed (trtcTtsConfig), and
 *   2. the service has not refused this configuration in the last ten minutes. A refusal is an answer that says the
 *      keys, the application, the voice or the region are wrong (CONFIG_REFUSALS): after one, `ready` is false and
 *      nothing is sent for TRTC_TTS_HOLD_MS; then one request is let through again. A timeout, a busy service or a
 *      bad network do not close it: that tap fails (503) and the next one tries again.
 *   Configured and never refused counts as ready: the only way to know more is to synthesise, which costs money, so
 *   the first real sentence (the owner's, with the script) is what stands behind it.
 *
 * Nothing here logs or returns the text, the keys or the vendor's message: an error carries the vendor's error code
 * and RequestId only.
 */
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { TC3_CONTENT_TYPE, tc3Sign } from "./tc3";
import { TTS_MAX_CHARS, TtsError, type TtsAudio, type TtsErrorCode, type TtsLang, type TtsProvider, type TtsRequest } from "./types";

type Env = Record<string, string | undefined>;

export const TRTC_TTS_ACTION = "TextToSpeech";
export const TRTC_TTS_VERSION = "2019-07-22";
/** The product's domain prefix, the <service> of the signature's credential scope. */
export const TRTC_TTS_SERVICE = "trtc";
/** The Text parameter's documented length range is [1, 255]. */
export const TRTC_TTS_MAX_UNITS = 255;
/** How long `ready` stays false after the service refused the configuration. */
export const TRTC_TTS_HOLD_MS = 10 * 60_000;
/** Silence put between two pieces' audio. */
export const TRTC_TTS_GAP_MS = 250;
/** Pieces asked for at the same time (the API's limit is 20 requests a second). */
const CONCURRENCY = 4;

export const TRTC_TTS_DEFAULTS = {
  endpoint: "trtc.intl.tencentcloudapi.com",
  region: "ap-singapore",
  /** "Gentle Lady", listed under Chinese on the built-in voice page; also the id in the API page's own example */
  voiceZh: "v-female-R2s4N9qJ",
  /** "Articulate Narrator - Female", listed under English (US) */
  voiceEn: "v-female-p9Xy7Q1L",
  speed: 0.9,
  /** the service's own default */
  sampleRate: 24_000,
  /** for one whole read-aloud, all its pieces together */
  timeoutMs: 30_000,
} as const;

/** The variables without which nothing can be sent. */
export const TRTC_TTS_REQUIRED_ENV = ["TRTC_SDK_APP_ID", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"] as const;

export interface TrtcTtsConfig {
  sdkAppId: number;
  secretId: string;
  secretKey: string;
  endpoint: string;
  region: string;
  voice: Record<TtsLang, string>;
  speed: number;
  sampleRate: number;
  timeoutMs: number;
}

/** `problems` name variables and what is wrong with them, never a value. */
export type TrtcTtsConfigResult = { ok: true; config: TrtcTtsConfig } | { ok: false; problems: string[] };

export function trtcTtsConfig(env: Env = process.env): TrtcTtsConfigResult {
  const val = (name: string) => (env[name] ?? "").trim();
  const problems: string[] = [];
  for (const name of TRTC_TTS_REQUIRED_ENV) if (!val(name)) problems.push(`${name} is not set`);

  const appId = val("TRTC_SDK_APP_ID");
  if (appId && !(/^\d{1,15}$/.test(appId) && Number(appId) > 0)) problems.push("TRTC_SDK_APP_ID is not a whole number");

  const endpoint = val("TRTC_TTS_ENDPOINT").toLowerCase() || TRTC_TTS_DEFAULTS.endpoint;
  // only Tencent's own API hosts: a typing mistake must not send a signed request and his text somewhere else
  if (!/^trtc(\.[a-z0-9-]+)*\.tencentcloudapi\.com$/.test(endpoint)) problems.push("TRTC_TTS_ENDPOINT is not a trtc.*.tencentcloudapi.com host name");

  const region = val("TRTC_TTS_REGION") || TRTC_TTS_DEFAULTS.region;
  if (!/^[a-z]{2}-[a-z]+(-\d+)?$/.test(region)) problems.push("TRTC_TTS_REGION is not a region name like ap-singapore");

  const voice = { "zh-Hans": val("TRTC_TTS_VOICE_ZH") || TRTC_TTS_DEFAULTS.voiceZh, en: val("TRTC_TTS_VOICE_EN") || TRTC_TTS_DEFAULTS.voiceEn };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(voice["zh-Hans"])) problems.push("TRTC_TTS_VOICE_ZH is not a voice id");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(voice.en)) problems.push("TRTC_TTS_VOICE_EN is not a voice id");

  const number = (name: string, fallback: number) => (val(name) ? Number(val(name)) : fallback);
  const speed = number("TRTC_TTS_SPEED", TRTC_TTS_DEFAULTS.speed);
  if (!(speed >= 0.5 && speed <= 2)) problems.push("TRTC_TTS_SPEED is not between 0.5 and 2");
  const sampleRate = number("TRTC_TTS_SAMPLE_RATE", TRTC_TTS_DEFAULTS.sampleRate);
  if (sampleRate !== 16_000 && sampleRate !== 24_000) problems.push("TRTC_TTS_SAMPLE_RATE is not 16000 or 24000");
  const timeoutMs = number("TRTC_TTS_TIMEOUT_MS", TRTC_TTS_DEFAULTS.timeoutMs);
  if (!(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000)) problems.push("TRTC_TTS_TIMEOUT_MS is not a number of milliseconds up to 120000");

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    config: { sdkAppId: Number(appId), secretId: val("TENCENT_SECRET_ID"), secretKey: val("TENCENT_SECRET_KEY"), endpoint, region, voice, speed, sampleRate, timeoutMs },
  };
}

// ---------------------------------------------------------------------------------------------- cutting the text

export interface TrtcPiece {
  text: string;
  /** the request's Language: ISO 639-1, of the values the API page lists */
  language: "zh" | "en";
}

const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z]/;

/**
 * A text's length as the service counts it, or more, never less: a Chinese character counts 2 and everything else 1
 * in the vendor's rules; here every character outside ASCII counts 2, so a piece that fits here fits there.
 */
export function trtcUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  return n;
}

/** Where a text that is too long may be cut, best first; the mark stays with the words before it. */
const CUTS: RegExp[] = [
  /(?<=[。！？!?；;])|(?<=\.)(?=\s)/u, // sentence ends (a full stop only before a space: "2.5 mg" stays whole)
  /(?<=[，、,：:])/u, // clause marks
  /(?<=\s)/u, // spaces
];

function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (cur && trtcUnits(cur + ch) > max) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** `text` as parts of at most `max` units each; joined back they are `text` exactly. */
function cut(text: string, max: number, level = 0): string[] {
  if (trtcUnits(text) <= max) return [text];
  if (level >= CUTS.length) return hardCut(text, max);
  const out: string[] = [];
  let cur = "";
  for (const part of text.split(CUTS[level]).filter((p) => p !== "")) {
    if (trtcUnits(cur + part) <= max) {
      cur += part;
      continue;
    }
    if (cur) out.push(cur);
    cur = "";
    if (trtcUnits(part) <= max) cur = part;
    else {
      const finer = cut(part, max, level + 1);
      out.push(...finer.slice(0, -1));
      cur = finer[finer.length - 1];
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** A line that ends its own sentence: the next line may follow it in the same request. */
const ENDS_SENTENCE = /[。！？!?；;.…：:]["'”’」』）)\]]*$/u;

/**
 * The pieces a text is asked for in, in order. Lines are kept whole where they fit. A line shares a request with the
 * one before it (a space between them: no line break is sent) when both are in the same language, they fit together,
 * and the line before ends with a sentence mark; a heading without one stays on its own, so the pause after it is the
 * pause between two requests. A piece with a Chinese character is zh, one with Latin letters and none is en, one with
 * neither (numbers alone) goes with the piece before it, else the one after it, else the request's language.
 */
export function splitForTrtc(text: string, fallback: TrtcPiece["language"], max: number = TRTC_TTS_MAX_UNITS): TrtcPiece[] {
  const raw: { text: string; language: TrtcPiece["language"] | null; newLine: boolean }[] = [];
  for (const line of text.split(/\n+/)) {
    let first = true;
    for (const part of cut(line.trim(), max)) {
      if (!part.trim()) continue;
      raw.push({ text: part.trim().replace(/\s+/g, " "), language: HAN.test(part) ? "zh" : LATIN.test(part) ? "en" : null, newLine: first });
      first = false;
    }
  }
  const out: TrtcPiece[] = [];
  let last: TrtcPiece["language"] | null = null;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const language: TrtcPiece["language"] = item.language ?? last ?? raw.slice(i + 1).find((r) => r.language)?.language ?? fallback;
    last = language;
    const prev = out[out.length - 1];
    // only whole lines are joined (a space is put where the line break was, never inside a line)
    if (prev && item.newLine && prev.language === language && ENDS_SENTENCE.test(prev.text) && trtcUnits(prev.text) + 1 + trtcUnits(item.text) <= max) prev.text = `${prev.text} ${item.text}`;
    else out.push({ text: item.text, language });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- what the service says

/**
 * Answers that say this configuration cannot speak (the keys, the application, the voice, the region), whatever the
 * text: they close `ready` for TRTC_TTS_HOLD_MS. From the API page's own error list and the common error codes page.
 */
export const CONFIG_REFUSALS: readonly (string | RegExp)[] = [
  /^AuthFailure(\.|$)/, // SignatureFailure, SecretIdNotFound, InvalidSecretId, SignatureExpire (the clock), UnauthorizedOperation, ...
  /^UnauthorizedOperation(\.|$)/,
  "MissingParameter.APIKey",
  "UnsupportedOperation.NotAllowed", // "usage not permitted; contact technical support"
  "FailedOperation.NotAbility", // the capability has not been unlocked
  "InvalidParameter.VoiceId",
  "InvalidParameter.Speed",
  "InvalidParameter.Pitch",
  "InvalidParameter.Volume",
  "InvalidParameter.SampleRate",
  "UnsupportedRegion",
  "InvalidAction",
  "NoSuchVersion",
  "NoSuchProduct",
  "ActionOffline",
  "IpInBlacklist",
  "IpNotInWhitelist",
];

/** Answers about this one text's length. */
const TEXT_REFUSALS: readonly string[] = ["InvalidParameter.TextLength", "RequestSizeLimitExceeded"];

/** Which of the route's kinds a vendor error code is, and whether it closes `ready`. */
export function classifyTrtcError(code: string): { kind: TtsErrorCode; closes: boolean } {
  if (CONFIG_REFUSALS.some((r) => (typeof r === "string" ? r === code : r.test(code)))) return { kind: "not_configured", closes: true };
  if (TEXT_REFUSALS.includes(code)) return { kind: "too_long", closes: false };
  // RequestLimitExceeded*, LimitExceeded, ResourceInsufficient, InternalError, ServiceUnavailable, anything new
  return { kind: "provider_failed", closes: false };
}

/** A TtsError that also says what the service answered (its code and RequestId; never its message, never the text). */
export class TrtcTtsError extends TtsError {
  constructor(
    code: TtsErrorCode,
    message: string,
    readonly vendorCode: string | null = null,
    readonly requestId: string | null = null,
    /** the answer says the configuration cannot speak */
    readonly closes: boolean = false,
  ) {
    super(code, message);
    this.name = "TrtcTtsError";
  }
}

interface Health {
  /** `ready` is false and nothing is sent before this time (ms) */
  closedUntil: number;
  /** the vendor code that closed it */
  code: string | null;
}
type GlobalWithHealth = typeof globalThis & { __rippleTrtcTtsHealth?: Health };

/** One per process: pages, routes and the start-up code are separate bundles, and a provider is made per call. */
function health(): Health {
  const g = globalThis as GlobalWithHealth;
  return (g.__rippleTrtcTtsHealth ??= { closedUntil: 0, code: null });
}

/** Tests: forget a refusal. */
export function resetTrtcTtsHealth(): void {
  (globalThis as GlobalWithHealth).__rippleTrtcTtsHealth = { closedUntil: 0, code: null };
}

export interface TrtcTtsDeps {
  fetch?: typeof fetch;
  /** the real clock in ms (the signature's timestamp must be the true time: never the app's test clock) */
  now?: () => number;
}

interface PieceAudio {
  samples: Int16Array;
  sampleRate: number;
}

function decodeAudio(base64: string, requestId: string | null): PieceAudio {
  const bad = (what: string) => new TrtcTtsError("provider_failed", `Tencent TextToSpeech answered audio that cannot be used: ${what}`, null, requestId);
  const compact = base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw bad("not base64");
  const bytes = new Uint8Array(Buffer.from(compact, "base64"));
  const info = parseWav(bytes);
  if (!info) throw bad("not a PCM WAV file");
  if (info.channels !== 1 || info.bitsPerSample !== 16 || !(info.sampleRate > 0)) throw bad(`${info.channels} channel(s), ${info.bitsPerSample} bits`);
  const pcm = bytes.slice(info.dataOffset, info.dataOffset + info.dataLength - (info.dataLength % 2));
  if (pcm.byteLength < 2) throw bad("no samples");
  return { samples: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), sampleRate: info.sampleRate };
}

export function createTrtcTts(env: Env = process.env, deps: TrtcTtsDeps = {}): TtsProvider {
  const cfg = trtcTtsConfig(env);
  const now = deps.now ?? Date.now;
  const send = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function one(config: TrtcTtsConfig, piece: TrtcPiece, voiceId: string, signal: AbortSignal): Promise<PieceAudio> {
    // serialised once: the bytes signed are the bytes sent
    const payload = JSON.stringify({
      Text: piece.text,
      Voice: { VoiceId: voiceId, Speed: config.speed },
      SdkAppId: config.sdkAppId,
      AudioFormat: { Format: "wav", SampleRate: config.sampleRate },
      Language: piece.language,
    });
    const timestamp = Math.floor(now() / 1000);
    const signed = tc3Sign({ secretId: config.secretId, secretKey: config.secretKey, service: TRTC_TTS_SERVICE, host: config.endpoint, payload, timestamp });
    let status: number;
    let body: string;
    try {
      const res = await send(`https://${config.endpoint}/`, {
        method: "POST",
        headers: {
          Authorization: signed.authorization,
          "Content-Type": TC3_CONTENT_TYPE,
          "X-TC-Action": TRTC_TTS_ACTION,
          "X-TC-Version": TRTC_TTS_VERSION,
          "X-TC-Region": config.region,
          "X-TC-Timestamp": String(timestamp),
        },
        body: payload,
        signal,
        cache: "no-store",
      });
      status = res.status;
      body = await res.text();
    } catch {
      // the cause is dropped on purpose: a fetch error can carry the request
      throw new TrtcTtsError("provider_failed", "Tencent TextToSpeech could not be reached");
    }
    let response: { Error?: { Code?: unknown }; Audio?: unknown; RequestId?: unknown } | null = null;
    try {
      const parsed = JSON.parse(body) as { Response?: unknown } | null;
      if (parsed && typeof parsed.Response === "object" && parsed.Response !== null) response = parsed.Response;
    } catch {
      response = null;
    }
    if (!response) throw new TrtcTtsError("provider_failed", `Tencent TextToSpeech answered HTTP ${status} without a Response`);
    const requestId = typeof response.RequestId === "string" && /^[\w-]{1,80}$/.test(response.RequestId) ? response.RequestId : null;
    if (response.Error) {
      const vendorCode = typeof response.Error.Code === "string" && /^[\w.]{1,80}$/.test(response.Error.Code) ? response.Error.Code : "an error without a code";
      const { kind, closes } = classifyTrtcError(vendorCode);
      throw new TrtcTtsError(kind, `Tencent TextToSpeech answered ${vendorCode} (RequestId ${requestId ?? "none"})`, vendorCode, requestId, closes);
    }
    if (status < 200 || status > 299) throw new TrtcTtsError("provider_failed", `Tencent TextToSpeech answered HTTP ${status}`, null, requestId);
    if (typeof response.Audio !== "string" || !response.Audio) throw new TrtcTtsError("provider_failed", `Tencent TextToSpeech answered without Audio (RequestId ${requestId ?? "none"})`, null, requestId);
    return decodeAudio(response.Audio, requestId);
  }

  return {
    name: "trtc",
    get ready(): boolean {
      return cfg.ok && now() >= health().closedUntil;
    },
    async synthesize(req: TtsRequest): Promise<TtsAudio> {
      if (!req.text.trim()) throw new TtsError("empty_text", "nothing to read");
      if (req.text.length > TTS_MAX_CHARS) throw new TtsError("too_long", `more than ${TTS_MAX_CHARS} characters`);
      if (!cfg.ok) throw new TtsError("not_configured", `TRTC text-to-speech is not configured: ${cfg.problems.join("; ")}`);
      const config = cfg.config;
      const state = health();
      if (now() < state.closedUntil) {
        throw new TrtcTtsError("not_configured", `Tencent refused this configuration (${state.code ?? "unknown"}); it is tried again after ${new Date(state.closedUntil).toISOString()}`, state.code, null, true);
      }

      const pieces = splitForTrtc(req.text, req.lang === "en" ? "en" : "zh");
      const voiceId = config.voice[req.lang] ?? config.voice["zh-Hans"];
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);
      const parts: PieceAudio[] = new Array<PieceAudio>(pieces.length);
      let next = 0;
      let failure: unknown = null;
      const worker = async (): Promise<void> => {
        while (failure === null && next < pieces.length) {
          const i = next++;
          try {
            parts[i] = await one(config, pieces[i], voiceId, controller.signal);
          } catch (err) {
            // the first failure ends the whole read-aloud: never some of the sentences
            if (failure === null) failure = err;
            controller.abort();
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pieces.length) }, worker));
      } finally {
        clearTimeout(timer);
      }

      if (failure !== null) {
        const err: TtsError = timedOut
          ? new TrtcTtsError("provider_failed", `Tencent TextToSpeech did not answer within ${config.timeoutMs} ms`)
          : failure instanceof TtsError
            ? failure
            : new TrtcTtsError("provider_failed", "Tencent TextToSpeech failed");
        if (err instanceof TrtcTtsError && err.closes) {
          state.closedUntil = now() + TRTC_TTS_HOLD_MS;
          state.code = err.vendorCode;
          console.warn(`[tts] trtc: ${err.message}. Read-aloud is off for ${TRTC_TTS_HOLD_MS / 60_000} minutes; check the variables named in lib/tts/trtc.ts.`);
        } else console.warn(`[tts] trtc: ${err.message}`);
        throw err;
      }

      const sampleRate = parts[0].sampleRate;
      if (parts.some((p) => p.sampleRate !== sampleRate)) {
        const err = new TrtcTtsError("provider_failed", "Tencent TextToSpeech answered pieces at different sample rates");
        console.warn(`[tts] trtc: ${err.message}`);
        throw err;
      }
      const gap = Math.round((TRTC_TTS_GAP_MS / 1000) * sampleRate);
      const total = parts.reduce((n, p) => n + p.samples.length, 0) + gap * (parts.length - 1);
      const samples = new Int16Array(total);
      let at = 0;
      parts.forEach((p, i) => {
        if (i > 0) at += gap;
        samples.set(p.samples, at);
        at += p.samples.length;
      });
      state.closedUntil = 0;
      state.code = null;
      return { audio: encodeWav(samples, sampleRate), mime: "audio/wav", provider: "trtc", durationMs: Math.round((total / sampleRate) * 1000), synthetic: false };
    },
  };
}
