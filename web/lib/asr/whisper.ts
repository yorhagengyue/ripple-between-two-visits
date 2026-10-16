/**
 * SPEECH_PROVIDER=whisper (task M14): the local Whisper service in services/whisper (FastAPI, port 7810).
 *
 *   - Live captions do not use realtimeToken(): the browser cuts the microphone into 2-3 s WAV chunks at
 *     pauses and posts them to /api/asr/chunk, which calls WhisperClient.chunk() (large-v3-turbo). A line
 *     (a stretch of speech closed by a pause of WHISPER_LINE_GAP_MS) is transcribed once more as a whole and
 *     becomes one utterance. realtimeToken() only checks that the service is ready, healthy and takes this
 *     app's token (probe()).
 *   - The whole-visit transcript: createFileJob() posts the recording's bytes to /v1/file (large-v3, VAD,
 *     word timestamps, hotwords), polls /v1/jobs/<id>, then deletes the job on the service (the transcript
 *     lives in the visit, not on the GPU box).
 *   - No diarisation: every utterance has speaker = null. Roles are inferred from what is said and confirmed
 *     by him in the after-visit review.
 *
 * Fallbacks of the whole-visit job (input.onFallback() is called once so the route can publish asr.fallback):
 *   - the screen showed the replay while recording (preferFixture, only with ASR_REPLAY_FALLBACK on): the
 *     replay file, without calling the service;
 *   - otherwise, when the service cannot make the transcript (unreachable, timeout, stalled, wrong token,
 *     loading, stuck, 5xx, the recording too large, the recording missing, he chose not to wait): the live
 *     Whisper lines already stored for this visit (real recognition of this recording), else the job fails.
 *     A recorded visit never becomes the replay file's script: that would store another doctor's words as
 *     this patient's doctor's words.
 *   - a replay (no recording): the replay file, which is not a fallback.
 * Before any of these: when the service had accepted the recording and then went away (connection refused or hung
 * polls, job_lost after its restart, loading, a wedged worker, 5xx), the job is "awaiting_transcript": it waits up
 * to WHISPER_REDO_WAIT_MS for /health to answer healthy and sends the recording again (WHISPER_REDO_ATTEMPTS
 * times), so a restart in the middle still ends in the large-v3 transcript. Cancelling ends the wait at once.
 * A running job without progress (WHISPER_JOB_STALL_MS) asks /health instead of giving up: the service declares a
 * wedged worker itself (worker_stuck at WHISPER_FILE_STALL_S) and restarts (exit 6), and that restart is waited for
 * too; the job gives up as "stalled" only when the service keeps saying it is healthy (WHISPER_JOB_STALL_GIVEUP_MS).
 *
 * The service refusing a request (400, 413, 415, 422) is a client error, not a failure of the service: the live
 * route does not count it nor fall back, and the job does not wait for a restart (WhisperUnavailable.clientError).
 *
 * The bearer token (WHISPER_TOKEN) is sent only to WHISPER_URL and never logged. Logs carry no transcript
 * text. Server-only.
 */
import { randomUUID } from "node:crypto";
import { MockSpeechProvider } from "./mock";
import { DEFAULT_LIVE_TUNING, type LiveTuning } from "./segmenter";
import {
  SpeechError,
  type AsrConfidence,
  type FileJobInput,
  type FileJobResult,
  type FileJobUtterance,
  type SpeechFallback,
  type SpeechProvider,
} from "./types";

// ------------------------------------------------------------------ config

export interface WhisperConfig {
  url: string | null;
  token: string | null;
  /** why the provider cannot call the service (null = configured) */
  problem: "no_url" | "bad_url" | "no_token" | "short_token" | null;
  healthTimeoutMs: number;
  chunkTimeoutMs: number;
  finalTimeoutMs: number;
  /** sending the whole recording: this base plus uploadMsPerMb for every MB */
  uploadTimeoutMs: number;
  uploadMsPerMb: number;
  pollTimeoutMs: number;
  pollEveryMs: number;
  /** a file job gives up after max(this, 2 x the recording's length) */
  jobDeadlineMs: number;
  /**
   * A running file job whose progress has not moved for this long is suspect: the job asks /health. When the
   * service says it is stuck (or loading, or failed to load), the job is restart-shaped (awaiting_transcript); while
   * it says it is healthy the job keeps waiting, because the service itself declares a wedged worker
   * (WHISPER_FILE_STALL_S, 90 s on a GPU: the job answers failed / worker_stuck) and restarts (exit code 6 after
   * WHISPER_EXIT_WHEN_STUCK_S, 120 s). Giving up at 20 s used to fall back before that restart could be waited for.
   */
  jobStallMs: number;
  /**
   * ... and gives up ("stalled", not restart-shaped) when the progress has not moved for this long while the service
   * keeps saying it is healthy (it does not notice its own wedged worker). Never shorter than jobStallMs. Default
   * 180 s: past the service's 90 s detection and 120 s exit.
   */
  jobStallGiveUpMs: number;
  /** the service answering "busy" for this long without one success: the live captions fall back */
  busyFallbackMs: number;
  /** the service's WHISPER_MAX_FILE_MB: a larger recording is not sent (it would be refused with 413) */
  maxFileBytes: number;
  /** pause that ends a line (shared with the service's WHISPER_LINE_GAP_MS) */
  lineGapMs: number;
  /** extra hotwords sent with every request (the service adds its own defaults) */
  hotwords: string | null;
  /**
   * The service accepted the recording and then went away (restart, crash, wedged worker): how long the job waits
   * for it to answer healthy again before it gives up and falls back (WHISPER_REDO_WAIT_MS, default 120 s, which
   * covers the supervisor's 2/5/10/30/60 s backoff plus the ~7 s model load; 0 = never wait).
   */
  redoWaitMs: number;
  /** how many times a job sends the recording again after such a restart (WHISPER_REDO_ATTEMPTS, default 1) */
  redoAttempts: number;
  /** how often the waiting job asks /health (WHISPER_REDO_POLL_MS) */
  redoPollMs: number;
}

function envMs(env: Record<string, string | undefined>, name: string, fallback: number, lo: number, hi: number): number {
  const raw = Number(env[name]);
  return Number.isFinite(raw) && raw >= lo && raw <= hi ? Math.round(raw) : fallback;
}

export const MIN_WHISPER_TOKEN = 32;
const MB = 1_048_576;

export function whisperConfig(env: Record<string, string | undefined> = process.env): WhisperConfig {
  const rawUrl = (env.WHISPER_URL ?? "").trim();
  const token = (env.WHISPER_TOKEN ?? "").trim() || null;
  let url: string | null = null;
  let problem: WhisperConfig["problem"] = null;
  if (!rawUrl) problem = "no_url";
  else {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
      if (u.username || u.password || u.search || u.hash) throw new Error("extra parts");
      url = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      problem = "bad_url";
    }
  }
  if (!problem && !token) problem = "no_token";
  if (!problem && token && token.length < MIN_WHISPER_TOKEN) problem = "short_token";
  const hotwords = (env.WHISPER_HOTWORDS ?? "").trim();
  const jobStallMs = envMs(env, "WHISPER_JOB_STALL_MS", 20_000, 200, 600_000);
  return {
    url,
    token,
    problem,
    healthTimeoutMs: envMs(env, "WHISPER_HEALTH_TIMEOUT_MS", 1500, 100, 30_000),
    // the model answers a 2-3 s chunk in about 0.2-0.35 s and a whole line in about 0.4 s on the RTX 5080
    chunkTimeoutMs: envMs(env, "WHISPER_CHUNK_TIMEOUT_MS", 2500, 200, 60_000),
    finalTimeoutMs: envMs(env, "WHISPER_FINAL_TIMEOUT_MS", 5000, 500, 120_000),
    uploadTimeoutMs: envMs(env, "WHISPER_UPLOAD_TIMEOUT_MS", 10_000, 1000, 600_000),
    uploadMsPerMb: envMs(env, "WHISPER_UPLOAD_MS_PER_MB", 1000, 0, 60_000),
    pollTimeoutMs: envMs(env, "WHISPER_POLL_TIMEOUT_MS", 5000, 200, 60_000),
    pollEveryMs: envMs(env, "WHISPER_POLL_MS", 500, 20, 10_000),
    jobDeadlineMs: envMs(env, "WHISPER_JOB_DEADLINE_MS", 120_000, 1000, 3_600_000),
    jobStallMs,
    jobStallGiveUpMs: Math.max(jobStallMs, envMs(env, "WHISPER_JOB_STALL_GIVEUP_MS", 180_000, 200, 3_600_000)),
    busyFallbackMs: envMs(env, "WHISPER_BUSY_FALLBACK_MS", 8000, 0, 120_000),
    maxFileBytes: envMs(env, "WHISPER_MAX_FILE_MB", 64, 1, 1024) * MB,
    lineGapMs: envMs(env, "WHISPER_LINE_GAP_MS", DEFAULT_LIVE_TUNING.lineGapMs, 200, 3000),
    hotwords: hotwords && hotwords.length <= 400 && !/[\u0000-\u001f\u007f]/.test(hotwords) ? hotwords : null,
    redoWaitMs: envMs(env, "WHISPER_REDO_WAIT_MS", 120_000, 0, 3_600_000),
    redoAttempts: envMs(env, "WHISPER_REDO_ATTEMPTS", 1, 0, 5),
    redoPollMs: envMs(env, "WHISPER_REDO_POLL_MS", 2000, 20, 60_000),
  };
}

/**
 * ASR_REPLAY_FALLBACK (on | off, default on): may a failing Whisper service hand the visit screen and its record
 * to the sample visit's replay file? On today (demo sessions: the replay is Mr Tan's own scripted visit). Real
 * mode (plan item 7) must run with it off: then the live captions stop, the recording goes on, and the record
 * comes from the recording or the live Whisper lines, never from a script.
 */
export function replayFallbackAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.ASR_REPLAY_FALLBACK ?? "").trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

/**
 * Live segmentation handed to the browser (lib/asr/segmenter.ts). WHISPER_LINE_GAP_MS is shared with the
 * service (its file mode splits lines at the same pause), so live lines and the formal transcript line up.
 */
export function liveTuningFromEnv(env: Record<string, string | undefined> = process.env): Partial<LiveTuning> {
  return {
    lineGapMs: envMs(env, "WHISPER_LINE_GAP_MS", DEFAULT_LIVE_TUNING.lineGapMs, 200, 3000),
    chunkGapMs: envMs(env, "WHISPER_CHUNK_GAP_MS", DEFAULT_LIVE_TUNING.chunkGapMs, 100, 1000),
    maxChunkMs: envMs(env, "WHISPER_MAX_CHUNK_MS", DEFAULT_LIVE_TUNING.maxChunkMs, 1000, 10_000),
  };
}

// ------------------------------------------------------------------ HTTP client

/** The service did not answer usefully. `reason` is short and safe to show backstage. */
export class WhisperUnavailable extends Error {
  constructor(
    readonly reason: string,
    readonly status: number | null = null,
    /** for busy: how long the service asked to wait (Retry-After), ms */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`whisper unavailable: ${reason}`);
    this.name = "WhisperUnavailable";
  }

  /**
   * A production build puts lib/asr into several bundles (the routes' chunks, and instrumentation's for the scheduled
   * jobs, lib/asr/pending.ts), while the provider lives on globalThis: an error thrown by its client can come from
   * another copy of this class. `instanceof` recognises any error with this name and a string reason (C2, as StoreError).
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const e = value as { name?: unknown; reason?: unknown };
    return e.name === "WhisperUnavailable" && typeof e.reason === "string";
  }
  /** the service is up but its live queue is full */
  get busy(): boolean {
    return this.reason === "busy";
  }
  /** a configuration problem (wrong or missing token, bad URL): waiting will not fix it */
  get misconfigured(): boolean {
    return this.reason === "unauthorized" || this.reason.startsWith("not_configured");
  }
  /**
   * The service refused the request itself (400 bad parameters, 413 too large or too long, 415 not a 16 kHz mono
   * 16-bit PCM WAV, 422 too short): the service is fine and sending the same bytes again fails the same way. Not a
   * failure of the service: no fallback, no failure count, no waiting for it to come back.
   */
  get clientError(): boolean {
    return this.status !== null && CLIENT_ERROR_STATUSES.has(this.status);
  }
}

/** Statuses of the service that mean "this request is wrong", not "the service is unwell". */
export const CLIENT_ERROR_STATUSES: ReadonlySet<number> = new Set([400, 413, 415, 422]);

/** The whole-recording job ran past its deadline (a slow or queued job: not a sign the service restarted). */
class JobDeadline extends WhisperUnavailable {
  constructor() {
    super("timeout");
  }

  /** Not the name rule of WhisperUnavailable (it would say every WhisperUnavailable is a deadline): the plain prototype test. */
  static [Symbol.hasInstance](value: unknown): boolean {
    return Function.prototype[Symbol.hasInstance].call(this, value);
  }
}

/**
 * Why a job that the service had accepted can be made again once the service answers healthy: the service went
 * away (connection refused or hung polls), came back without the job (job_lost: jobs live in its memory), is
 * loading after a restart, failed to load, has a wedged worker (stuck: it declared the worker wedged, failed the
 * job with worker_stuck or says so on /health, and restarts itself) or answered 5xx. Not here: stalled (no progress
 * for WHISPER_JOB_STALL_GIVEUP_MS while the service kept saying it is healthy: it will not restart, so a redo would
 * only queue behind the wedged job), cancelled, a wrong token, a refused or too large recording, a garbled answer,
 * the job's own deadline.
 */
export function isRestartShaped(err: unknown): err is WhisperUnavailable {
  if (!(err instanceof WhisperUnavailable) || err instanceof JobDeadline || err.clientError) return false;
  const r = err.reason;
  return ["unreachable", "timeout", "job_lost", "loading", "engine_error", "stuck"].includes(r) || /^http_5\d\d/.test(r);
}

export interface WhisperHealth {
  ready: boolean;
  /** ready and able to answer live chunks (false while stuck); null when the service does not say */
  healthy: boolean | null;
  /** only when asked with the token: whether the service accepts it */
  tokenOk: boolean | null;
  status: string;
  /** while status is "stuck": which worker (live, file) */
  stuckWorkers: string[];
  device: string | null;
  models: { live: string | null; file: string | null };
  gpu: string | null;
}

export interface WhisperSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  lang: string;
  confidence?: string;
  avg_logprob?: number | null;
  no_speech_prob?: number | null;
  /** file mode: the VAD region (a stretch of speech between pauses) this segment belongs to */
  region?: number;
  words?: { start_ms: number; end_ms: number; word: string; prob: number }[];
  /**
   * who said it, as the service's own speaker separation numbers the voices of one request (Tencent's SpeakerId with
   * SpeakerDiarization on, lib/asr/tencent.ts); absent when the service does not separate speakers
   */
  speaker?: number | null;
}

export interface WhisperChunkResult {
  text: string;
  lang: string | null;
  segments: WhisperSegment[];
  durationMs: number;
  model: string;
  /** model time on the GPU */
  modelMs: number;
  /** round trip seen from here */
  roundTripMs: number;
  /** the least confident segment (null when the service does not say) */
  confidence: AsrConfidence | null;
}

export interface WhisperJobStatus {
  status: "queued" | "running" | "done" | "failed";
  segments?: WhisperSegment[];
  error?: string;
  model?: string;
  meta?: Record<string, unknown>;
  progress?: { done: number; total: number };
}

type FetchLike = typeof fetch;

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * A segment's word timestamps (the whole-recording path sends them: word_timestamps=True). Kept only when every
 * entry is well formed (times, the word as Whisper wrote it, its probability); otherwise the segment has no words
 * and callers treat it as one block.
 */
function parseWords(raw: unknown): WhisperSegment["words"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: NonNullable<WhisperSegment["words"]> = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") return undefined;
    const o = w as Record<string, unknown>;
    if (!isNum(o.start_ms) || !isNum(o.end_ms) || typeof o.word !== "string") return undefined;
    const start = Math.max(0, Math.round(o.start_ms));
    out.push({ start_ms: start, end_ms: Math.max(start, Math.round(o.end_ms)), word: o.word, prob: isNum(o.prob) ? o.prob : 0 });
  }
  return out;
}

function parseSegments(raw: unknown): WhisperSegment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WhisperSegment[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    if (!isNum(o.start_ms) || !isNum(o.end_ms) || typeof o.text !== "string") return null;
    const words = parseWords(o.words);
    out.push({
      start_ms: Math.max(0, Math.round(o.start_ms)),
      end_ms: Math.max(0, Math.round(o.end_ms)),
      text: o.text,
      lang: typeof o.lang === "string" ? o.lang : "",
      confidence: typeof o.confidence === "string" ? o.confidence : undefined,
      avg_logprob: isNum(o.avg_logprob) ? o.avg_logprob : null,
      no_speech_prob: isNum(o.no_speech_prob) ? o.no_speech_prob : null,
      region: isNum(o.region) ? o.region : undefined,
      ...(words ? { words } : {}),
    });
  }
  return out;
}

const CONFIDENCE_RANK: Record<AsrConfidence, number> = { low: 0, medium: 1, high: 2 };

/** The least confident of the segments ("unknown" and missing values do not count); null when none says. */
export function worstConfidence(segments: Pick<WhisperSegment, "confidence">[]): AsrConfidence | null {
  let worst: AsrConfidence | null = null;
  for (const s of segments) {
    const c = s.confidence;
    if (c !== "low" && c !== "medium" && c !== "high") continue;
    if (worst === null || CONFIDENCE_RANK[c] < CONFIDENCE_RANK[worst]) worst = c;
  }
  return worst;
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 1000), 30_000) : null;
}

export class WhisperClient {
  constructor(
    readonly config: WhisperConfig,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
  ) {}

  private assertConfigured(): { url: string; token: string } {
    const { url, token, problem } = this.config;
    if (problem || !url || !token) throw new WhisperUnavailable(`not_configured:${problem ?? "unknown"}`);
    return { url, token };
  }

  private async request(
    path: string,
    init: RequestInit & { timeoutMs: number; auth?: boolean; cancel?: AbortSignal },
  ): Promise<{ status: number; body: unknown; res: Response }> {
    const { url, token } = this.assertConfigured();
    const headers = new Headers(init.headers);
    if (init.auth !== false) headers.set("Authorization", `Bearer ${token}`);
    const { timeoutMs, cancel, ...rest } = init;
    delete (rest as { auth?: boolean }).auth;
    if (cancel?.aborted) throw new WhisperUnavailable("cancelled");
    const signal = cancel ? AbortSignal.any([AbortSignal.timeout(timeoutMs), cancel]) : AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${url}${path}`, { ...rest, headers, signal, cache: "no-store", redirect: "error" });
    } catch (err) {
      if (cancel?.aborted) throw new WhisperUnavailable("cancelled");
      const name = (err as { name?: string })?.name;
      throw new WhisperUnavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, res };
  }

  private static fail(status: number, body: unknown, res?: Response): never {
    const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    if (status === 401 || status === 403) throw new WhisperUnavailable("unauthorized", status);
    if (status === 503 && code === "busy") throw new WhisperUnavailable("busy", status, res ? retryAfterMs(res) : null);
    if (status === 503 && (code === "loading" || code === "engine_error" || code === "stuck")) throw new WhisperUnavailable(String(code), status);
    if (status === 504) throw new WhisperUnavailable("timeout", status);
    if (status === 413) throw new WhisperUnavailable("too_large", status);
    const tail = typeof code === "string" && /^[a-z0-9_]{1,64}$/i.test(code) ? `_${code}` : "";
    // a refused request: said as "rejected", never as "did not answer"
    if (CLIENT_ERROR_STATUSES.has(status)) throw new WhisperUnavailable(`rejected_${status}${tail}`, status);
    throw new WhisperUnavailable(`http_${status}${tail}`, status);
  }

  /**
   * GET /health. Public; with `auth` the token goes along and the answer says whether the service takes it
   * (tokenOk), so a wrong token shows before a visit, not two chunks into it.
   */
  async health(opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<WhisperHealth> {
    const { status, body, res } = await this.request("/health", {
      method: "GET",
      timeoutMs: opts.timeoutMs ?? this.config.healthTimeoutMs,
      auth: opts.auth === true,
    });
    if (status !== 200 || !body || typeof body !== "object") WhisperClient.fail(status, body, res);
    const b = body as Record<string, unknown>;
    const models = (b.models && typeof b.models === "object" ? b.models : {}) as Record<string, unknown>;
    return {
      ready: b.ready === true,
      healthy: typeof b.healthy === "boolean" ? b.healthy : null,
      tokenOk: typeof b.token_ok === "boolean" ? b.token_ok : null,
      status: typeof b.status === "string" ? b.status : "unknown",
      stuckWorkers: Array.isArray(b.stuck_workers) ? b.stuck_workers.filter((w): w is string => typeof w === "string") : [],
      device: typeof b.device === "string" ? b.device : null,
      models: { live: typeof models.live === "string" ? models.live : null, file: typeof models.file === "string" ? models.file : null },
      gpu: b.gpu && typeof b.gpu === "object" && typeof (b.gpu as { name?: unknown }).name === "string" ? (b.gpu as { name: string }).name : null,
    };
  }

  /** One live chunk or one whole line (16 kHz mono 16-bit WAV, at most 30 s). */
  async chunk(wav: Uint8Array, opts: { kind: "chunk" | "final"; langHint?: string | null }): Promise<WhisperChunkResult> {
    const params = new URLSearchParams();
    if (opts.langHint) params.set("lang_hint", opts.langHint);
    if (this.config.hotwords) params.set("hotwords", this.config.hotwords);
    const t0 = Date.now();
    const { status, body, res } = await this.request(`/v1/chunk${params.size ? `?${params}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav as unknown as BodyInit,
      timeoutMs: opts.kind === "final" ? this.finalTimeoutFor(wav.byteLength) : this.config.chunkTimeoutMs,
    });
    if (status !== 200) WhisperClient.fail(status, body, res);
    const b = (body ?? {}) as Record<string, unknown>;
    const segments = parseSegments(b.segments);
    if (typeof b.text !== "string" || !segments) throw new WhisperUnavailable("bad_response", status);
    return {
      text: b.text,
      lang: typeof b.lang === "string" ? b.lang : null,
      segments,
      durationMs: isNum(b.duration_ms) ? b.duration_ms : 0,
      model: typeof b.model === "string" ? b.model : "whisper",
      modelMs: isNum(b.elapsed_ms) ? b.elapsed_ms : 0,
      roundTripMs: Date.now() - t0,
      confidence: worstConfidence(segments),
    };
  }

  /**
   * A whole line: 2 s plus 120 ms per second of audio, at least the chunk timeout and at most
   * WHISPER_FINAL_TIMEOUT_MS (a 2-3 s line 2.5 s, a 25 s line 5 s; the model needs about 0.4 s for either).
   */
  finalTimeoutFor(bytes: number): number {
    const seconds = Math.max(0, (bytes - 44) / 32_000);
    return Math.min(this.config.finalTimeoutMs, Math.max(this.config.chunkTimeoutMs, Math.round(2000 + 120 * seconds)));
  }

  /** Upload timeout for a recording of this size: the base plus WHISPER_UPLOAD_MS_PER_MB per MB. */
  uploadTimeoutFor(bytes: number): number {
    return this.config.uploadTimeoutMs + Math.ceil(bytes / MB) * this.config.uploadMsPerMb;
  }

  /**
   * Send a whole recording. opts.defaultHotwords false asks the service to skip its built-in hotword lists (the
   * sample story's names: wrong for anyone else's recording, e.g. the real-recording demo's mock consultations).
   */
  async submitFile(
    wav: Uint8Array,
    cancel?: AbortSignal,
    opts: { defaultHotwords?: boolean } = {},
  ): Promise<{ jobId: string; etaMs: number; model: string | null }> {
    const params = new URLSearchParams();
    if (this.config.hotwords) params.set("hotwords", this.config.hotwords);
    if (opts.defaultHotwords === false) params.set("default_hotwords", "0");
    const { status, body, res } = await this.request(`/v1/file${params.size ? `?${params}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav as unknown as BodyInit,
      timeoutMs: this.uploadTimeoutFor(wav.byteLength),
      cancel,
    });
    if (status !== 202) WhisperClient.fail(status, body, res);
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.job_id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(b.job_id)) throw new WhisperUnavailable("bad_response", status);
    return { jobId: b.job_id, etaMs: isNum(b.eta_ms) ? b.eta_ms : 0, model: typeof b.model === "string" ? b.model : null };
  }

  async job(jobId: string, cancel?: AbortSignal): Promise<WhisperJobStatus> {
    const { status, body, res } = await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET", timeoutMs: this.config.pollTimeoutMs, cancel });
    // the service no longer knows the job: it restarted (jobs live in its memory) or forgot it after its TTL
    if (status === 404) throw new WhisperUnavailable("job_lost", status);
    if (status !== 200) WhisperClient.fail(status, body, res);
    const b = (body ?? {}) as Record<string, unknown>;
    const st = b.status;
    if (st !== "queued" && st !== "running" && st !== "done" && st !== "failed") throw new WhisperUnavailable("bad_response", status);
    const out: WhisperJobStatus = { status: st, model: typeof b.model === "string" ? b.model : undefined };
    const pr = b.progress && typeof b.progress === "object" ? (b.progress as Record<string, unknown>) : null;
    if (pr && isNum(pr.done) && isNum(pr.total)) out.progress = { done: pr.done, total: pr.total };
    if (st === "done") {
      const segments = parseSegments(b.segments);
      if (!segments) throw new WhisperUnavailable("bad_response", status);
      out.segments = segments;
      out.meta = b.meta && typeof b.meta === "object" ? (b.meta as Record<string, unknown>) : undefined;
    }
    if (st === "failed") out.error = typeof b.error === "string" ? b.error : "job_failed";
    return out;
  }

  /** Forget the job on the service (its transcript). Best effort. */
  async deleteJob(jobId: string): Promise<void> {
    try {
      await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", timeoutMs: this.config.pollTimeoutMs });
    } catch {
      // the service forgets finished jobs after its TTL anyway
    }
  }

  /** submitFile with one retry for a dropped connection or a full queue (a wrong token or a bad file will not get better). */
  async submitWithRetry(wav: Uint8Array, cancel?: AbortSignal, opts: { defaultHotwords?: boolean } = {}) {
    try {
      return await this.submitFile(wav, cancel, opts);
    } catch (err) {
      if (err instanceof WhisperUnavailable && (err.reason === "unreachable" || err.reason === "busy" || err.reason.startsWith("http_429"))) {
        await sleep(1000, cancel);
        if (cancel?.aborted) throw new WhisperUnavailable("cancelled");
        return this.submitFile(wav, cancel, opts);
      }
      throw err;
    }
  }

  /**
   * One whole recording through /v1/file (large-v3): send it, poll until done, delete the job on the service, and
   * return its segments (with their word timestamps when the service sends them). Throws WhisperUnavailable:
   *   - cancelled (opts.cancel), timeout (opts.deadlineMs passed: a JobDeadline), the job's own error (worker_stuck
   *     is said as stuck);
   *   - a running job whose progress did not move for opts.stallMs: without opts.onStall, stalled at once. With
   *     opts.onStall, it is asked (at most every opts.stallCheckEveryMs) what the service says: a reason ends the job
   *     with that reason (stuck, loading ...: restart-shaped), null keeps waiting; stalled only once the progress has
   *     not moved for opts.stallGiveUpMs;
   *   - from a poll: three timeouts or refused connections in a row, job_lost (404: the service restarted), loading,
   *     unauthorized, 5xx ... at once.
   * The job is deleted on the service whenever this gives up on it (it must not keep the GPU busy, nor hold the
   * recording). opts.onSubmitted fires once the service has accepted the recording.
   */
  async transcribeFile(
    wav: Uint8Array,
    opts: {
      cancel?: AbortSignal;
      deadlineMs: number;
      stallMs?: number;
      /** with onStall: give up (stalled) after this long without progress; default stallMs */
      stallGiveUpMs?: number;
      /** a running job has not moved for stallMs: null = keep waiting, a reason = end the job with that reason */
      onStall?: () => Promise<string | null>;
      stallCheckEveryMs?: number;
      pollEveryMs?: number;
      defaultHotwords?: boolean;
      onSubmitted?: (jobId: string) => void;
      onProgress?: (p: { status: WhisperJobStatus["status"]; done: number | null; total: number | null }) => void;
    },
  ): Promise<FileTranscript> {
    const { cancel } = opts;
    const pollEvery = opts.pollEveryMs ?? this.config.pollEveryMs;
    const stallMs = opts.stallMs ?? this.config.jobStallMs;
    const giveUpMs = opts.onStall ? Math.max(stallMs, opts.stallGiveUpMs ?? stallMs) : stallMs;
    const checkEvery = Math.max(pollEvery, opts.stallCheckEveryMs ?? 0);
    let lastCheck = 0;
    let jobId: string | null = null;
    let deleted = false;
    const forget = () => {
      if (jobId && !deleted) {
        deleted = true;
        void this.deleteJob(jobId);
      }
    };
    try {
      const submitted = await this.submitWithRetry(wav, cancel, { defaultHotwords: opts.defaultHotwords });
      jobId = submitted.jobId;
      opts.onSubmitted?.(submitted.jobId);
      const deadline = Date.now() + opts.deadlineMs;
      let failures = 0;
      let lastProgress = "";
      let lastMove = Date.now();
      for (;;) {
        if (cancel?.aborted) throw new WhisperUnavailable("cancelled");
        if (Date.now() > deadline) throw new JobDeadline();
        let st: WhisperJobStatus;
        try {
          st = await this.job(submitted.jobId, cancel);
          failures = 0;
        } catch (err) {
          // a poll that times out once is not the end; three in a row is
          if (err instanceof WhisperUnavailable && (err.reason === "timeout" || err.reason === "unreachable") && ++failures < 3) {
            await sleep(pollEvery, cancel);
            continue;
          }
          throw err;
        }
        opts.onProgress?.({ status: st.status, done: st.progress?.done ?? null, total: st.progress?.total ?? null });
        if (st.status === "done") {
          forget();
          return { jobId: submitted.jobId, segments: st.segments ?? [], model: st.model ?? submitted.model ?? null, meta: st.meta ?? null };
        }
        if (st.status === "failed") {
          forget();
          // worker_stuck: the service found its file worker wedged (it restarts itself); the job will not run
          throw new WhisperUnavailable(st.error === "worker_stuck" ? "stuck" : (st.error ?? "job_failed"));
        }
        // a running job whose progress does not move is suspect (a queued one waits its turn until the deadline)
        const progress = `${st.status}:${st.progress?.done ?? -1}/${st.progress?.total ?? -1}`;
        if (progress !== lastProgress) {
          lastProgress = progress;
          lastMove = Date.now();
        } else if (st.status === "running" && Date.now() - lastMove > stallMs) {
          if (Date.now() - lastMove > giveUpMs) throw new WhisperUnavailable("stalled");
          if (opts.onStall && Date.now() - lastCheck >= checkEvery) {
            lastCheck = Date.now();
            const verdict = await opts.onStall();
            if (cancel?.aborted) throw new WhisperUnavailable("cancelled");
            if (verdict) throw new WhisperUnavailable(verdict);
          }
        }
        await sleep(pollEvery, cancel);
      }
    } catch (err) {
      if (cancel?.aborted && !(err instanceof WhisperUnavailable && err.reason === "cancelled")) throw new WhisperUnavailable("cancelled");
      throw err;
    } finally {
      // given up (deadline, cancelled, stalled, polls failing): best effort, a dead service forgets it on restart
      forget();
    }
  }
}

/** A finished whole-recording transcript from the service. */
export interface FileTranscript {
  jobId: string;
  segments: WhisperSegment[];
  /** the model the service says made it (its WHISPER_FILE_MODEL), null when it does not say */
  model: string | null;
  meta: Record<string, unknown> | null;
}

// ------------------------------------------------------------------ segments -> utterances

/** Han characters and CJK / full-width punctuation: no space next to them when joining. */
const CJK = /[\p{Script=Han}　-〿＀-￯]/u;

export function joinTexts(texts: string[]): string {
  let out = "";
  for (const t of texts.map((x) => x.trim()).filter(Boolean)) {
    if (!out) out = t;
    else if (CJK.test(out.slice(-1)) || CJK.test(t[0])) out += t;
    else out += ` ${t}`;
  }
  return out;
}

/**
 * Whisper segments -> utterances: the segments of one VAD region (speech between two pauses of the line
 * gap) make one utterance, the same unit the live captions use. Without region numbers, a gap of at least
 * `gapMs` starts a new utterance. Language per utterance: the most frequent segment language. Confidence: the
 * least confident segment (a misheard number in one segment makes the whole sentence uncertain).
 */
export function utterancesFromSegments(segments: WhisperSegment[], gapMs = 550): FileJobUtterance[] {
  const sorted = segments.filter((s) => s.text.trim()).slice().sort((a, b) => a.start_ms - b.start_ms);
  const groups: WhisperSegment[][] = [];
  for (const s of sorted) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    // a sentence of another speaker (the service separated speakers) is a line of its own, however short the pause
    const sameSpeaker = (s.speaker ?? null) === (prev?.speaker ?? null);
    const same = prev && sameSpeaker && (s.region !== undefined && prev.region !== undefined ? s.region === prev.region : s.start_ms - prev.end_ms < gapMs);
    if (last && same) last.push(s);
    else groups.push([s]);
  }
  return groups.map((g) => {
    const counts = new Map<string, number>();
    for (const s of g) if (s.lang) counts.set(s.lang, (counts.get(s.lang) ?? 0) + s.text.length);
    const lang = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const confidence = worstConfidence(g);
    return {
      tStartMs: g[0].start_ms,
      tEndMs: Math.max(...g.map((s) => s.end_ms)),
      speaker: g[0].speaker ?? null,
      text: joinTexts(g.map((s) => s.text)),
      ...(lang ? { lang } : {}),
      ...(confidence ? { confidence } : {}),
    };
  });
}

/**
 * C2 track R: the transcript of a recording sent in several files, as one. Each part's utterances are moved by where
 * the part starts in the whole visit (`startMs`). A sentence the cut went through comes back as two halves, the first
 * ending near its part's end and the second starting at the next part's start: when the pause between them is shorter
 * than the line gap they are one utterance again, as utterancesFromSegments would have made it from one file (the same
 * rule it uses between segments without region numbers). Its language is the longer half's, its confidence the less
 * confident half's.
 */
export function joinPartUtterances(parts: { startMs: number; utterances: FileJobUtterance[] }[], gapMs = 550): FileJobUtterance[] {
  const out: FileJobUtterance[] = [];
  for (const part of parts) {
    const moved = part.utterances.map((u) => ({ ...u, tStartMs: u.tStartMs + part.startMs, tEndMs: u.tEndMs + part.startMs }));
    const prev = out.at(-1);
    const next = moved[0];
    // only across a cut: the last line of the parts so far and the first line of this one
    if (prev && next && next.tStartMs - prev.tEndMs < gapMs) {
      const lang = prev.text.length >= next.text.length ? (prev.lang ?? next.lang) : (next.lang ?? prev.lang);
      const confidence = worstConfidence([{ confidence: prev.confidence }, { confidence: next.confidence }]);
      const joined: FileJobUtterance = {
        tStartMs: prev.tStartMs,
        tEndMs: Math.max(prev.tEndMs, next.tEndMs),
        speaker: prev.speaker ?? next.speaker,
        text: joinTexts([prev.text, next.text]),
        ...(lang ? { lang } : {}),
        ...(confidence ? { confidence } : {}),
      };
      out[out.length - 1] = joined;
      out.push(...moved.slice(1));
    } else {
      out.push(...moved);
    }
  }
  return out;
}

// ------------------------------------------------------------------ provider

interface WhisperJob {
  state: "pending" | "done" | "failed";
  result: FileJobResult;
  createdAt: number;
  /** he chose not to wait (DELETE /api/asr/jobs/[id]): aborts the upload or the polling */
  cancel: AbortController;
}

const g = globalThis as unknown as { __rippleWhisperJobs?: Map<string, WhisperJob> };
function jobs(): Map<string, WhisperJob> {
  g.__rippleWhisperJobs ??= new Map();
  // keep the map small: forget jobs older than a day
  const cutoff = Date.now() - 86_400_000;
  for (const [id, j] of g.__rippleWhisperJobs) if (j.createdAt < cutoff) g.__rippleWhisperJobs.delete(id);
  return g.__rippleWhisperJobs;
}

/** Wait, but wake up at once when the job is cancelled. */
function sleep(ms: number, cancel?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (cancel?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      cancel?.removeEventListener("abort", done);
      resolve();
    }
    cancel?.addEventListener("abort", done, { once: true });
  });
}

/** Bytes of a 16 kHz mono 16-bit WAV -> length in ms (approximate; header ignored). */
function wavMs(bytes: Uint8Array): number {
  return Math.max(0, Math.round(((bytes.length - 44) / 32_000) * 1000));
}

export class WhisperSpeechProvider implements SpeechProvider {
  /**
   * The provider lives on globalThis (lib/asr/index.ts) and may have been made by another bundle's copy of this class
   * (the scheduled jobs run in instrumentation's bundle): `instanceof` recognises it by its name and its client (C2).
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const p = value as { name?: unknown; client?: unknown; createFileJob?: unknown };
    return p.name === "whisper" && typeof p.client === "object" && p.client !== null && typeof p.createFileJob === "function";
  }

  readonly name = "whisper" as const;
  readonly client: WhisperClient;
  private readonly mock: MockSpeechProvider;
  private readonly env: Record<string, string | undefined> | undefined;

  constructor(opts: { config?: WhisperConfig; fetch?: FetchLike; now?: () => number; env?: Record<string, string | undefined> } = {}) {
    this.client = new WhisperClient(opts.config ?? whisperConfig(), opts.fetch);
    this.mock = new MockSpeechProvider(opts.now);
    this.env = opts.env;
  }

  get config(): WhisperConfig {
    return this.client.config;
  }

  /** ASR_REPLAY_FALLBACK, read at call time (tests and the e2e server set it per run). */
  get replayFallback(): boolean {
    return replayFallbackAllowed(this.env ?? process.env);
  }

  /** How long a file job may take before it falls back: max(WHISPER_JOB_DEADLINE_MS, 2 x the recording). */
  deadlineMs(audio: Uint8Array | null | undefined): number {
    return Math.max(this.config.jobDeadlineMs, 2 * (audio ? wavMs(audio) : 0));
  }

  /**
   * The longest a file job can stay pending: its deadline once per attempt (the first and each redo after a
   * restart), plus the wait for the service to come back before each redo. The page waits this long (plus a margin)
   * before it gives up on the job.
   */
  budgetMs(audio: Uint8Array | null | undefined): number {
    const redos = this.config.redoWaitMs > 0 ? this.config.redoAttempts : 0;
    return this.deadlineMs(audio) * (redos + 1) + this.config.redoWaitMs * redos;
  }

  /**
   * C2 track R: the same for a recording in several files (their lengths in ms, in order). The files are sent one after
   * another, each with its own deadline; the redos after a restart are counted over the whole job, each one sending a
   * single file again (at most the longest).
   */
  budgetMsForParts(lengthsMs: readonly number[]): number {
    const redos = this.config.redoWaitMs > 0 ? this.config.redoAttempts : 0;
    const deadlines = lengthsMs.map((ms) => Math.max(this.config.jobDeadlineMs, 2 * Math.max(0, ms)));
    const longest = deadlines.length ? Math.max(...deadlines) : this.config.jobDeadlineMs;
    return deadlines.reduce((sum, d) => sum + d, 0) + (longest + this.config.redoWaitMs) * redos;
  }

  /**
   * Is the service usable right now? null = yes; otherwise why not: not_configured:* | unauthorized (the
   * service refuses this app's token) | loading | engine_error | stuck (its live worker hangs) | unreachable |
   * timeout | http_*.
   */
  async probe(timeoutMs?: number): Promise<string | null> {
    if (this.config.problem) return `not_configured:${this.config.problem}`;
    try {
      const h = await this.client.health({ auth: true, timeoutMs });
      if (h.tokenOk === false) return "unauthorized";
      if (!h.ready) return h.status === "error" ? "engine_error" : "loading";
      if (h.healthy === false) return h.status === "stuck" ? "stuck" : "unhealthy";
      return null;
    } catch (err) {
      return err instanceof WhisperUnavailable ? err.reason : "unreachable";
    }
  }

  /**
   * The live path does not need a browser credential (chunks go through /api/asr/chunk with the session):
   * this checks that the service is ready, healthy and takes the token, and returns a placeholder token.
   * Throws SpeechError("unavailable", reason).
   */
  async realtimeToken(): Promise<{ token: string; expiresAt: number }> {
    const reason = await this.probe();
    if (reason) throw new SpeechError("unavailable", reason);
    return { token: `whisper-chunks-${randomUUID()}`, expiresAt: Date.now() + 10 * 60_000 };
  }

  async createFileJob(input: FileJobInput): Promise<{ jobId: string }> {
    if (!input.url && !input.audio && !input.recorded) throw new SpeechError("invalid", "createFileJob needs a url or the audio");
    const jobId = `whisperjob-${randomUUID()}`;
    const job: WhisperJob = { state: "pending", result: { status: "pending" }, createdAt: Date.now(), cancel: new AbortController() };
    jobs().set(jobId, job);
    void this.run(job, input).catch((err) => {
      job.state = "failed";
      job.result = { status: "failed", error: "internal_error" };
      console.warn(`[whisper] file job crashed: ${(err as Error)?.name ?? "error"}`);
    });
    return { jobId };
  }

  async getFileJob(jobId: string): Promise<FileJobResult> {
    const job = jobs().get(jobId);
    if (!job) throw new SpeechError("not_found", `No speech job ${jobId}`);
    return structuredClone(job.result);
  }

  /**
   * He chose not to wait for the whole-recording transcript: stop sending or polling now; the job finishes with
   * the live Whisper lines (or fails when there are none), reason "cancelled". False when the job is already
   * finished.
   */
  async cancelFileJob(jobId: string): Promise<boolean> {
    const job = jobs().get(jobId);
    if (!job) throw new SpeechError("not_found", `No speech job ${jobId}`);
    if (job.state !== "pending") return false;
    job.cancel.abort();
    return true;
  }

  /** The replay file's transcript through the mock (no audio, or a fallback). */
  private async fromFixture(input: FileJobInput): Promise<FileJobResult | null> {
    const fixture = input.fixture ?? /^fixture:([A-Za-z0-9_-]+)$/.exec(input.url)?.[1];
    if (!fixture) return null;
    const { jobId } = await this.mock.createFileJob({ ...input, url: `fixture:${fixture}`, fixture, audio: undefined });
    for (let i = 0; i < 200; i++) {
      const r = await this.mock.getFileJob(jobId);
      if (r.status !== "pending") return r;
      await sleep(50);
    }
    return null;
  }

  private async run(job: WhisperJob, input: FileJobInput): Promise<void> {
    const cancel = job.cancel.signal;
    // C2 track R: a long recording comes as several files, read and sent one after another
    const parts = input.audioParts?.length ? input.audioParts : null;
    if (!input.audio && !parts) {
      // a recorded visit whose recording did not reach the server: never the script
      if (input.recorded) {
        await this.fallBack(job, input, input.missingAudio ?? "no_audio", { fixture: input.preferFixture === true && this.replayFallback });
        return;
      }
      // a replay (no recording): the replay file, as with mock; this is not a fallback
      const r = await this.fromFixture(input);
      job.result = r ?? { status: "done", source: "fixture", utterances: [] };
      job.state = job.result.status === "failed" ? "failed" : "done";
      return;
    }
    if (input.preferFixture && this.replayFallback) {
      await this.fallBack(job, input, "live_fallback", { fixture: true });
      return;
    }
    let reason = "unreachable";
    /** time spent waiting for a restarted service (awaiting_transcript), over all attempts */
    let waitedMs = 0;
    /** why each redo was needed */
    const redoReasons: string[] = [];
    const redoBudget = this.config.redoWaitMs > 0 ? this.config.redoAttempts : 0;
    /**
     * One file through the service. The service had the file and went away (a restart, a crash, a wedged worker): the
     * file is still here, so the job waits for the service to answer healthy and sends that file again. The redos are
     * counted over the whole job (a recording in several files does not get more of them).
     */
    const transcribe = async (wav: Uint8Array): Promise<FileTranscript> => {
      for (;;) {
        let accepted = false;
        try {
          return await this.client.transcribeFile(wav, {
            cancel,
            deadlineMs: this.deadlineMs(wav),
            stallMs: this.config.jobStallMs,
            stallGiveUpMs: this.config.jobStallGiveUpMs,
            // no progress for a while: what does the service say? stuck (it restarts itself) -> wait for it and send
            // again; healthy -> keep waiting (it declares a wedged worker itself, failing the job with worker_stuck)
            onStall: () => this.stallVerdict(),
            stallCheckEveryMs: this.config.redoPollMs,
            pollEveryMs: this.config.pollEveryMs,
            onSubmitted: () => {
              accepted = true;
            },
          });
        } catch (err) {
          if (cancel.aborted) throw new WhisperUnavailable("cancelled");
          // awaiting_transcript: the service had the recording and went away (a restart, a crash, a wedged worker).
          // The recording is still here: wait for the service to answer healthy, then send it again, so the record
          // is the whole-recording transcript and not the live captions. Bounded by WHISPER_REDO_WAIT_MS and
          // WHISPER_REDO_ATTEMPTS; "Keep the live captions" (cancel) ends the wait at once.
          if (!accepted || !isRestartShaped(err) || redoReasons.length >= redoBudget) throw err;
          redoReasons.push(err.reason);
          const since = Date.now();
          job.result = { status: "pending", awaiting_transcript: { reason: err.reason, since_ms: since, attempt: redoReasons.length } };
          console.warn(`[whisper] the service went away during a file job (${err.reason}): waiting up to ${this.config.redoWaitMs} ms to send the recording again`);
          try {
            await this.waitForService(cancel, err.reason);
          } finally {
            waitedMs += Date.now() - since;
          }
          job.result = { status: "pending" };
        }
      }
    };
    try {
      if (input.audio && !parts && input.audio.byteLength > this.config.maxFileBytes) throw new WhisperUnavailable("too_large");
      // a service that is down, hung, stuck or refuses the token is known in at most the health timeout,
      // instead of after a whole upload
      const problem = await this.probe();
      if (problem) throw new WhisperUnavailable(problem);
      const files: { ms: number | null; load(): Promise<Uint8Array | null> }[] = parts ?? [{ ms: null, load: async () => input.audio ?? null }];
      const pieces: { startMs: number; utterances: FileJobUtterance[] }[] = [];
      let startMs = 0;
      let model: string | undefined;
      for (const file of files) {
        const wav = await file.load();
        // a part that is no longer in storage: the recording is not whole, and half a visit is never the record
        if (!wav) throw new WhisperUnavailable("no_audio");
        // every part must fit the service's intake by itself (lib/visit/parts.ts: about 37 MB)
        if (wav.byteLength > this.config.maxFileBytes) throw new WhisperUnavailable("too_large");
        const t = await transcribe(wav);
        pieces.push({ startMs, utterances: utterancesFromSegments(t.segments, this.config.lineGapMs) });
        model = t.model ?? model;
        // the next part's times start where this one's audio ends
        startMs += file.ms ?? wavMs(wav);
      }
      job.result = {
        status: "done",
        source: "audio",
        utterances: pieces.length === 1 ? pieces[0].utterances : joinPartUtterances(pieces, this.config.lineGapMs),
        model,
        ...(redoReasons.length ? { redone: { attempts: redoReasons.length, reasons: [...redoReasons], waited_ms: waitedMs } } : {}),
      };
      job.state = "done";
      if (redoReasons.length) console.warn(`[whisper] file job made again after the service came back (${redoReasons.join(", ")}; waited ${waitedMs} ms)`);
      return;
    } catch (err) {
      reason = cancel.aborted ? "cancelled" : err instanceof WhisperUnavailable ? err.reason : "internal_error";
    }
    await this.fallBack(job, input, reason, { fixture: false, waitedMs });
  }

  /**
   * A running whole-recording job has made no progress for WHISPER_JOB_STALL_MS. "stuck" when /health says the
   * service is stuck (a wedged worker: it fails its jobs with worker_stuck and exits for its supervisor), "loading" or
   * "engine_error" when it is not ready (it restarted under us): all restart-shaped, so the job waits for it and sends
   * the recording again. null (keep waiting) when it says it is healthy, and when /health itself does not answer: the
   * job's own polls then find the service gone (three failures in a row: unreachable).
   */
  private async stallVerdict(): Promise<string | null> {
    const problem = await this.probe();
    if (problem === "stuck" || problem === "unhealthy") return "stuck";
    if (problem === "loading" || problem === "engine_error") return problem;
    return null;
  }

  /**
   * Wait until /health says the service is ready, healthy and takes the token. Throws WhisperUnavailable(reason)
   * when WHISPER_REDO_WAIT_MS passes first, at once on a wrong token or a broken configuration (waiting will not fix
   * those), and "cancelled" when he chose not to wait.
   */
  private async waitForService(cancel: AbortSignal, reason: string): Promise<void> {
    const until = Date.now() + this.config.redoWaitMs;
    for (;;) {
      if (cancel.aborted) throw new WhisperUnavailable("cancelled");
      const problem = await this.probe();
      if (cancel.aborted) throw new WhisperUnavailable("cancelled");
      if (problem === null) return;
      if (problem === "unauthorized" || problem.startsWith("not_configured")) throw new WhisperUnavailable(problem);
      const left = until - Date.now();
      if (left <= 0) throw new WhisperUnavailable(reason);
      await sleep(Math.min(this.config.redoPollMs, left), cancel);
    }
  }

  /**
   * opts.fixture: the screen showed the replay, so the record follows it (only with ASR_REPLAY_FALLBACK on).
   * Otherwise the live Whisper lines of this recording, else failed. Never the script for a recording.
   * opts.waitedMs: how long the job waited for a restarted service before giving up (said in the fallback).
   */
  private async fallBack(job: WhisperJob, input: FileJobInput, reason: string, opts: { fixture: boolean; waitedMs?: number }): Promise<void> {
    const live = (input.liveUtterances ?? []).filter((u) => u.text.trim());
    let fallback: SpeechFallback;
    const waited = opts.waitedMs && opts.waitedMs > 0 ? { waitedMs: opts.waitedMs } : {};
    const fixture = opts.fixture ? await this.fromFixture(input) : null;
    if (fixture && fixture.status === "done") {
      job.result = { ...fixture, fallback: (fallback = { reason, used: "fixture", ...waited }) };
    } else if (live.length) {
      job.result = { status: "done", source: "audio", utterances: live.map((u) => ({ ...u })), fallback: (fallback = { reason, used: "live", ...waited }) };
    } else {
      job.result = { status: "failed", error: `whisper_unavailable:${reason}`, fallback: (fallback = { reason, used: "none", ...waited }) };
    }
    job.state = job.result.status === "failed" ? "failed" : "done";
    try {
      input.onFallback?.(fallback);
    } catch {
      // publishing the event must not break the job
    }
  }
}
