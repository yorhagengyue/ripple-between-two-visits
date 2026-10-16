/**
 * 问一句 by voice (C2 track S; real-app 2.10 「没有 Whisper 时，不显示麦克风按钮」). Server-only.
 *
 * The ask screens have a microphone only when this app can turn speech into words: SPEECH_PROVIDER=whisper with the service
 * configured, or (10-15, the global ask button: hold it and speak) SPEECH_PROVIDER=tencent with its key pair
 * (askVoiceAvailable). Never for mock, devfake or trtc: there is nothing honest to hear him with, so
 * no button is drawn at all and typing is the way to ask.
 *
 * What it does is small on purpose: one short recording of his question becomes the words of his question, shown for him
 * to check (components/today/AskMic.tsx). Nothing is asked yet. Only when he taps 「问这句」 do the words go to
 * POST /api/ask, the very request a typed question makes (classify, sources, generate, the three checks, his hourly and
 * daily limits). Nothing here answers, rewords or adds to what he said: no clinical sentence is made in this file.
 *
 * Where his voice goes: to the speech recognition the deployment uses (Tencent Cloud in Singapore, lib/asr/tencent.ts, as a
 * visit's lines do; or this app's own Whisper service, WHISPER_URL, lib/asr/whisper.ts) and nowhere else. No language
 * model (DeepSeek) hears it, so it does not wait on his ai_processing consent, the same as a visit recording. The audio
 * is not kept: no file, no store row, no bus event, and no log line carries what he said (reasons only).
 *
 * transcribeRoute is POST /api/ask/transcribe (app/api/ask/transcribe/route.ts exports only POST over it, as a Next.js
 * route file may; the unit test hands it a stand-in client and an environment).
 */
import type { NextRequest } from "next/server";
import { speechProviderName, TencentAsrClient, tencentAsrConfig, WhisperClient, WhisperUnavailable, whisperConfig, type AsrConfidence } from "@/lib/asr";
import { denyFamily } from "@/lib/family/role";
import { localMoment, usageBucket, usagePerson } from "@/lib/llm/person-spend";
import type { SessionRow } from "@/lib/store/types";
import { requireSubject } from "@/lib/subject";
import { usageStore, type UsageStore } from "@/lib/subject/usage";
import { parseWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";

type Env = Record<string, string | undefined>;

/** A spoken question is at most 30 s (what the service takes as one piece) ... */
export const MAX_QUESTION_MS = 30_000;
/** ... and at least 0.3 s: a shorter recording is a slip of the finger, not a question. */
export const MIN_QUESTION_MS = 300;
/** 30 s of 16 kHz mono 16-bit audio is 960 000 bytes; 1 MiB leaves room for the header. */
export const MAX_QUESTION_BYTES = 1_048_576;
/** The ask field's own limit (components/today/AskSection.tsx maxLength): the heard words never exceed what he could type. */
export const MAX_QUESTION_CHARS = 500;

const WAV_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
const NO_STORE = "private, no-store";

/**
 * Spoken questions a person may send for transcription in one clock hour of his own: twice the hourly ask limit's default
 * (a question is often said again before it is asked), counted in the store like the asks themselves (cost-guard.ts), so
 * a restart does not reset it and nobody can keep the speech service busy.
 */
export const VOICE_PER_HOUR = 120;

export interface VoiceDeps {
  /** tests: the store the hourly count lives in (default: the usage counters' own, lib/subject/usage.ts) */
  usage?: Pick<UsageStore, "rateHit">;
  /** tests: a stand-in for the Whisper client (default: a client for WHISPER_URL) */
  client?: Pick<WhisperClient, "chunk">;
  /** tests: where SPEECH_PROVIDER and WHISPER_* are read from (default process.env) */
  env?: Env;
}

/** What Whisper heard of one question. `text` is "" when nothing was heard. */
export interface HeardQuestion {
  text: string;
  lang: string | null;
  /** the least confident segment, null when the service does not say */
  confidence: AsrConfidence | null;
}

/**
 * The microphone may be drawn: the speech provider is whisper and its URL and token are set. Every other provider, a
 * half-set configuration and an unknown SPEECH_PROVIDER are all "no microphone". It does not call the service: one that
 * is down shows when he speaks (「现在转不成文字，先打字问。」), not as a slower page.
 */
export function askVoiceAvailable(env: Env = process.env): boolean {
  try {
    const name = speechProviderName(env);
    if (name === "whisper") return whisperConfig(env).problem === null;
    if (name === "tencent") return tencentAsrConfig(env).problem === null;
    return false;
  } catch {
    return false;
  }
}

/** Whisper's text as one line of a question: whitespace collapsed, trimmed, at most MAX_QUESTION_CHARS (never half a surrogate pair). */
export function questionText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_QUESTION_CHARS) return text;
  let cut = text.slice(0, MAX_QUESTION_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * One recorded question (a 16 kHz mono 16-bit PCM WAV) -> his words. One call to the service, as a whole line
 * (kind "final"). Keeps nothing and logs nothing. Throws WhisperUnavailable when the service does not answer usefully.
 */
export async function transcribeQuestion(wav: Uint8Array, deps: VoiceDeps = {}): Promise<HeardQuestion> {
  const env = deps.env ?? process.env;
  // the same one-line call either way (TencentAsrClient.chunk is WhisperClient.chunk's shape)
  const client = deps.client ?? (speechProviderName(env) === "tencent" ? new TencentAsrClient(tencentAsrConfig(env)) : new WhisperClient(whisperConfig(env)));
  const heard = await client.chunk(wav, { kind: "final" });
  return { text: questionText(heard.text), lang: heard.lang, confidence: heard.confidence };
}

/**
 * Count one spoken question for this person in his clock hour. Seconds until the next full hour when he is over the
 * limit, else null. A counter that cannot be reached never stops him (it is logged by the store's own error path).
 */
export async function voiceOverLimit(scope: Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind" | "owner_user_id" | "tz" | "filming" | "clock_offset_ms">>, deps: VoiceDeps = {}): Promise<number | null> {
  try {
    const person = usagePerson(scope);
    const m = localMoment(person);
    const hit = await (deps.usage ?? usageStore()).rateHit(usageBucket("ask:v", person, `${m.date}T${m.hour}`, deps.env ?? process.env), 3600, VOICE_PER_HOUR);
    return hit.allowed ? null : m.toNextHourS;
  } catch {
    return null;
  }
}

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": NO_STORE, ...headers } });
}

/** Another helper's answer (who is asking, the family gate), with this route's cache rule on it. */
function sealed(res: Response): Response {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

/** The body, or null once it is larger than `limit` (the declared length first, then the bytes as they arrive). */
async function readCapped(req: NextRequest, limit: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * POST /api/ask/transcribe. Who asks is decided as POST /api/ask decides it (the subject; her account and her phone are
 * refused), before the body is read. The answers are listed in the route file. Every answer is `private, no-store`.
 */
export async function transcribeRoute(req: NextRequest, deps: VoiceDeps = {}): Promise<Response> {
  try {
    const found = await requireSubject(req);
    if (!found.ok) return sealed(found.res);
    const { subject, session } = found;
    if (subject.kind === "account" && subject.relation !== "self") {
      return answer(403, { error: "patient_only", detail: "Only he asks, from his own phone." });
    }
    const denied = await denyFamily(req, session);
    if (denied) return sealed(denied);

    if (!askVoiceAvailable(deps.env)) {
      return answer(409, { error: "no_speech_service", detail: "a spoken question is only taken with SPEECH_PROVIDER=whisper or tencent and the service configured" });
    }
    // his spoken questions this hour, counted per person in the store before the audio is read
    const waitS = await voiceOverLimit(session, deps);
    if (waitS !== null) return answer(429, { error: "too_many", limit: "voice_per_hour", retryAfterSec: waitS }, { "Retry-After": String(waitS) });
    const ctype = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!WAV_TYPES.has(ctype)) return answer(415, { error: "wav_required", detail: "Content-Type must be audio/wav (16 kHz mono 16-bit PCM)" });
    const bytes = await readCapped(req, MAX_QUESTION_BYTES);
    if (!bytes) return answer(413, { error: "too_large", detail: `a spoken question is at most ${MAX_QUESTION_BYTES} bytes` });
    const info = parseWav(bytes);
    if (!info) return answer(415, { error: "wav_16k_mono_pcm16_required", detail: "not a RIFF/WAVE PCM file" });
    if (info.sampleRate !== TARGET_SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) {
      return answer(415, { error: "wav_16k_mono_pcm16_required", detail: `got ${info.sampleRate} Hz, ${info.channels} channel(s), ${info.bitsPerSample}-bit` });
    }
    if (info.durationMs > MAX_QUESTION_MS) return answer(413, { error: "too_long", detail: "a spoken question is at most 30 s" });
    if (info.durationMs < MIN_QUESTION_MS) return answer(422, { error: "too_short", detail: "a spoken question is at least 0.3 s" });

    try {
      const heard = await transcribeQuestion(bytes, deps);
      return answer(200, { text: heard.text, lang: heard.lang });
    } catch (err) {
      if (!(err instanceof WhisperUnavailable)) throw err;
      if (err.busy) {
        const retryMs = Math.max(250, err.retryAfterMs ?? 1000);
        return answer(429, { error: "busy", retry_after_ms: retryMs }, { "Retry-After": String(Math.max(1, Math.ceil(retryMs / 1000))) });
      }
      // the reason only (unreachable, timeout, unauthorized ...): never what was said
      console.warn(`[api/ask/transcribe] the speech service did not make the words: ${err.reason}`);
      return answer(503, { error: "asr_unavailable", reason: err.reason });
    }
  } catch (err) {
    console.error(`[api/ask/transcribe] failed: ${(err as { name?: string } | null)?.name ?? "error"}`);
    return answer(500, { error: "internal_error" });
  }
}
