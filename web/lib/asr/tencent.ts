/**
 * SPEECH_PROVIDER=tencent: Tencent Cloud speech recognition (the owner's decision of 2026-10-14; the hackathon is Tencent
 * Cloud's). Server-only.
 *
 * What it calls. One-sentence recognition (SentenceRecognition) is not opened on the account (every host and region
 * answered FailedOperation.UserNotRegistered, biz ASR_OneSentence, 10-14), so both the live lines and the whole visit use
 * recording file recognition, which is (pages read 2026-10-14: CreateRecTask
 * https://www.tencentcloud.com/document/product/1118/66925, DescribeTaskStatus
 * https://www.tencentcloud.com/document/product/1118/66924, endpoints https://www.tencentcloud.com/document/api/1118/66917):
 *
 *   POST https://asr.<region>.tencentcloudapi.com/   X-TC-Version 2019-06-14, X-TC-Region <region>, signed with Signature
 *   v3 (lib/tts/tc3.ts, service "asr")
 *   CreateRecTask       { EngineModelType, ChannelNum: 1, ResTextFormat: 2, SourceType: 1, Data: <base64 WAV>, DataLen }
 *                       -> { Response: { Data: { TaskId } } }; Data is at most 5 MB of base64
 *   DescribeTaskStatus  { TaskId } -> { Response: { Data: { Status: 0 waiting | 1 doing | 2 success | 3 failed, Result,
 *                       ResultDetail: [{ FinalSentence, StartMs, EndMs, ... }], AudioDuration, ErrorMsg } } }
 *   an error            { Response: { Error: { Code, Message }, RequestId } } with HTTP 200
 *
 * Checked with the owner's key on 2026-10-14, host asr.ap-singapore.tencentcloudapi.com, region ap-singapore: an 8 s
 * English clip and a 14 s Mandarin one came back word for word in 1.9 to 2.6 s each (polling every 500 ms), with
 * 16k_zh_large, 16k_zh-PY, 16k_zh_en and 16k_en all accepted; DescribeTaskStatus for a task that does not exist answers
 * FailedOperation.NoSuchTask with a good key pair and AuthFailure.SignatureFailure with a wrong one.
 *
 * Engine. One engine for every visit, TENCENT_ASR_ENGINE, default 16k_zh_en (Mandarin and English mixed), so a Singapore
 * visit where the doctor speaks English and he answers in Mandarin (or switches within a sentence) needs no choice of
 * language. His account's language is the language of his screens, not of his doctor, so it does not pick the engine.
 * Chosen on the evening of 2026-10-14 with a 58 s test conversation (a doctor in English, the patient in Mandarin), all
 * four engines with the hot words below: 16k_zh_en wrote every line right ("142 over 88", "amlodipine", "ibuprofen",
 * "paracetamol", the Mandarin word for word); 16k_zh-PY wrote "m lotipine" for amlodipine; 16k_en dropped the Mandarin;
 * the large model 16k_zh_large wrote "one hundred and forty eighty", "mlo de pan", "ibu profen" and "parasatamal",
 * which the summary's guards then rightly refused to read as a number or a medicine. A single line took 1.3 to 3.9 s
 * with 16k_zh_en and 1.8 to 2.0 s with 16k_zh-PY. The others stay settings. Only 16 kHz engines are accepted: the phone
 * records 16 kHz mono.
 *
 * Hot words (TENCENT_ASR_HOTWORDS, CreateRecTask's HotwordList): the names of the medicines Ripple knows (kb/drugs.json:
 * each one's name and its English and Chinese aliases), so the recogniser writes the name the doctor says instead of a
 * word that sounds like it. A hot word only makes a name likelier where the audio fits it; it adds no word to a line.
 *
 * Live lines (POST /api/asr/chunk, kind=final): each line the phone closes at a pause (at most TENCENT_ASR_MAX_LINE_MS)
 * is one recognition task, polled every TENCENT_ASR_POLL_MS until done or TENCENT_ASR_LINE_TIMEOUT_MS. Every task is
 * paid for by its audio, so there are no 2-3 s partial captions (`partials` is false: the page does not send them and
 * the route ignores one that comes): the caption appears when the line is done, about 2-3 s after he stops.
 *
 * The whole visit (createFileJob): the recording is read from storage, cut into pieces of at most TENCENT_ASR_PIECE_MS
 * (100 s: 3.2 MB of audio, 4.3 MB of base64) at the quietest stretch of the last 10 s before each limit, and the pieces
 * are recognised three at a time; their sentences become lines exactly as Whisper's segments do (a pause of
 * lineGapMs ends a line, utterancesFromSegments) and the pieces are joined on the recording's clock (joinPartUtterances:
 * a sentence a cut went through is one line again). A long recording in several files goes file by file. Why pieces and
 * not the other way the API offers (SourceType 0, a link Tencent downloads the recording from): it works with every
 * storage this app runs on (a link to the local store of a development machine cannot be fetched from outside), no link
 * to his recording sits in a third party's task list, and it does not depend on Tencent reaching our storage.
 *
 * Speakers (scene 1 of the owner's video, 10-15). Each piece is sent with SpeakerDiarization = 1 (TENCENT_ASR_DIARIZE,
 * on unless "0"): the service numbers the voices of the piece and each sentence of ResultDetail carries its SpeakerId
 * (the API page https://cloud.tencent.com/document/api/1093/37823, updated 2026-09-09, lists 16k_zh_en among the engines
 * that separate speakers, with ChannelNum 1; SpeakerNumber is not honoured by 16k engines, so it is not sent). Checked on
 * 2026-10-15 with a 90 s test conversation of three voices: one task, 6.7 s, the sentences of the three voices numbered
 * 0, 1 and 2, two short sentences of 25 given the wrong number. A sentence of another speaker is a line of its own
 * (utterancesFromSegments). The numbers mean something within one piece only: a recording of one piece keeps them
 * (FileJobUtterance.speaker), one of several pieces gets null everywhere and the live voices decide (lib/visit/
 * pipeline.ts finalizeVisit, lib/visit/speakers.ts). A piece the service refuses with the flag (an engine without
 * speaker separation answers InvalidParameter) is sent once more without it.
 * When a piece cannot be recognised the job falls back exactly as Whisper's does: the live lines already stored for
 * this visit (real recognition of this recording), else the job fails and the saved recording waits for its text; a
 * recorded visit never becomes the replay file's script.
 *
 * Errors, as the routes already read them (WhisperUnavailable, its reason vocabulary: lib/asr/whisper.ts):
 *   AuthFailure.*, UnauthorizedOperation.*                       unauthorized             (waiting will not fix it)
 *   FailedOperation.UserNotRegistered                            not_configured:service_not_enabled
 *   FailedOperation.ServiceIsolate                               not_configured:service_isolated (overdue payment)
 *   FailedOperation.UserHasNoAmount / UserHasNoFreeAmount        not_configured:no_balance
 *   RequestLimitExceeded.* / LimitExceeded.*                     busy (429, retry after 1 s)
 *   InvalidParameter*, MissingParameter, UnknownParameter ...    rejected_400_<code> (this request is wrong)
 *   FailedOperation.ErrorRecognize, a task that failed           rejected_422_<why> (the same audio fails again)
 *   FailedOperation.NoSuchTask                                   job_lost
 *   InternalError.*, any other code                              http_503_<code>
 *   no answer in time / no connection / garbled                  timeout / unreachable / bad_response
 *
 * Health without recognising anything (nothing is billed): DescribeTaskStatus for task 1. NoSuchTask means the key pair,
 * the region and the service answer (`probe`). A good answer is kept 60 s, a bad one 10 s.
 *
 * Credentials: TENCENT_SECRET_ID and TENCENT_SECRET_KEY, the same Tencent Cloud API key pair as read-aloud (lib/tts/
 * trtc.ts). Read on the server only, sent only to the *.tencentcloudapi.com host they sign for, never logged. Nothing
 * here logs or returns the audio, the text or a vendor message: an error carries the vendor's code and RequestId only.
 */
import { getKb } from "@/lib/kb/load";
import { randomUUID } from "node:crypto";
import { TC3_CONTENT_TYPE, tc3Sign } from "@/lib/tts/tc3";
import { encodeWav, parseWav, pcmRange, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { MockSpeechProvider } from "./mock";
import { DEFAULT_LIVE_TUNING, liveTuning, type LiveTuning } from "./segmenter";
import { SpeechError, type FileJobInput, type FileJobResult, type FileJobUtterance, type SpeechFallback, type SpeechProvider } from "./types";
import { joinPartUtterances, joinTexts, replayFallbackAllowed, utterancesFromSegments, WhisperUnavailable, type WhisperChunkResult, type WhisperSegment } from "./whisper";

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export const TENCENT_ASR_VERSION = "2019-06-14";
/** The product's domain prefix, the <service> of the signature's credential scope. */
export const TENCENT_ASR_SERVICE = "asr";
export const TENCENT_ASR_CREATE = "CreateRecTask";
export const TENCENT_ASR_STATUS = "DescribeTaskStatus";
/** CreateRecTask's Data: at most 5 MB of base64 (the API page). */
export const TENCENT_ASR_MAX_DATA_BYTES = 5 * 1024 * 1024;
/**
 * The medicines Ripple knows as hot words (see the header): "name|11,...", at most 128 words of at most 30 characters
 * each (the API page), names with a space or a symbol the API does not take left out. Weight 11 is the one checked on
 * 2026-10-14.
 */
export const TENCENT_ASR_HOTWORDS: string = (() => {
  const words: string[] = [];
  for (const d of getKb().drugs)
    for (const name of [d.display_name, ...d.aliases]) {
      const w = name.trim().toLowerCase();
      if (!w || w.length > 30 || !/^[a-z\u3400-\u9fff-]+$/.test(w) || words.includes(w)) continue;
      words.push(w);
    }
  return words.slice(0, 128).map((w) => `${w}|11`).join(",");
})();

/** Engines this account accepted on 2026-10-14 (one short clip each). Any other 16 kHz engine name may be set. */
export const TENCENT_ASR_ENGINES_CHECKED = ["16k_zh_large", "16k_zh-PY", "16k_zh_en", "16k_en"] as const;

export const TENCENT_ASR_DEFAULTS = {
  region: "ap-singapore",
  engine: "16k_zh_en",
  /** how often a task is asked whether it is done */
  pollMs: 500,
  /** one HTTP request */
  requestTimeoutMs: 5000,
  /** one live line, from sending it to its text (the page gives a line 15 s before it tries again) */
  lineTimeoutMs: 10_000,
  /** a piece of the whole visit: 100 s of audio is 3.2 MB, 4.3 MB of base64, under the 5 MB the API takes */
  pieceMs: 100_000,
  /** one piece, from sending it to its text */
  pieceTimeoutMs: 60_000,
  /** pieces of one recording at the same time (CreateRecTask allows 20 requests a second) */
  concurrency: 3,
  /** "busy" answers for this long without one success: the live captions stop */
  busyFallbackMs: 8000,
  /** a pause this long ends a line (the same unit as Whisper's live lines) */
  lineGapMs: DEFAULT_LIVE_TUNING.lineGapMs,
  /** a line longer than this is closed and the speech goes on in the next one: a caption at least every 15 s */
  maxLineMs: 15_000,
  /** a line's request waiting this long makes the page say the captions are late (a line takes 2-3 s) */
  captionDelayMs: 6000,
  /** the whole visit's pieces ask the service to separate speakers (scene 1, 10-15; see the header) */
  diarize: true,
} as const;

export type TencentAsrProblem = "no_keys" | "no_secret_id" | "no_secret_key" | "bad_region" | "bad_engine" | "bad_endpoint";

export interface TencentAsrConfig {
  secretId: string | null;
  secretKey: string | null;
  region: string;
  engine: string;
  /** the host name requests go to and are signed for */
  endpoint: string;
  /** why the provider cannot call the service (null = configured); names a variable's problem, never a value */
  problem: TencentAsrProblem | null;
  pollMs: number;
  requestTimeoutMs: number;
  lineTimeoutMs: number;
  pieceMs: number;
  pieceTimeoutMs: number;
  concurrency: number;
  busyFallbackMs: number;
  lineGapMs: number;
  maxLineMs: number;
  /** the whole visit's pieces are sent with SpeakerDiarization = 1 (TENCENT_ASR_DIARIZE: "0" turns it off) */
  diarize: boolean;
}

function envMs(env: Env, name: string, fallback: number, lo: number, hi: number): number {
  const raw = Number(env[name]);
  return env[name] !== undefined && env[name] !== "" && Number.isFinite(raw) && raw >= lo && raw <= hi ? Math.round(raw) : fallback;
}

const REGION = /^[a-z]{2}-[a-z]+(-\d+)?$/;
/** 16 kHz engines only: the phone records 16 kHz mono (8k engines are for telephone audio). */
const ENGINE = /^16k_[A-Za-z0-9_-]{1,32}$/;
/** Only Tencent's own ASR hosts: a typing mistake must not send a signed request and his recording somewhere else. */
const ENDPOINT = /^asr(\.[a-z0-9-]+)*\.tencentcloudapi\.com$/;

export function tencentAsrConfig(env: Env = process.env): TencentAsrConfig {
  const val = (name: string) => (env[name] ?? "").trim();
  const secretId = val("TENCENT_SECRET_ID") || null;
  const secretKey = val("TENCENT_SECRET_KEY") || null;
  const region = val("TENCENT_ASR_REGION") || TENCENT_ASR_DEFAULTS.region;
  const engine = val("TENCENT_ASR_ENGINE") || TENCENT_ASR_DEFAULTS.engine;
  const endpoint = val("TENCENT_ASR_ENDPOINT").toLowerCase() || (REGION.test(region) ? `asr.${region}.tencentcloudapi.com` : "asr.tencentcloudapi.com");
  let problem: TencentAsrProblem | null = null;
  if (!secretId && !secretKey) problem = "no_keys";
  else if (!secretId) problem = "no_secret_id";
  else if (!secretKey) problem = "no_secret_key";
  else if (!REGION.test(region)) problem = "bad_region";
  else if (!ENGINE.test(engine)) problem = "bad_engine";
  else if (!ENDPOINT.test(endpoint)) problem = "bad_endpoint";
  return {
    secretId,
    secretKey,
    region,
    engine,
    endpoint,
    problem,
    pollMs: envMs(env, "TENCENT_ASR_POLL_MS", TENCENT_ASR_DEFAULTS.pollMs, 100, 10_000),
    requestTimeoutMs: TENCENT_ASR_DEFAULTS.requestTimeoutMs,
    lineTimeoutMs: envMs(env, "TENCENT_ASR_LINE_TIMEOUT_MS", TENCENT_ASR_DEFAULTS.lineTimeoutMs, 1000, 14_000),
    pieceMs: TENCENT_ASR_DEFAULTS.pieceMs,
    pieceTimeoutMs: envMs(env, "TENCENT_ASR_PIECE_TIMEOUT_MS", TENCENT_ASR_DEFAULTS.pieceTimeoutMs, 5000, 600_000),
    concurrency: TENCENT_ASR_DEFAULTS.concurrency,
    busyFallbackMs: TENCENT_ASR_DEFAULTS.busyFallbackMs,
    lineGapMs: TENCENT_ASR_DEFAULTS.lineGapMs,
    maxLineMs: envMs(env, "TENCENT_ASR_MAX_LINE_MS", TENCENT_ASR_DEFAULTS.maxLineMs, 3000, 25_000),
    diarize: val("TENCENT_ASR_DIARIZE") === "0" ? false : TENCENT_ASR_DEFAULTS.diarize,
  };
}

/** The live segmentation handed to the page with SPEECH_PROVIDER=tencent (lib/asr/segmenter.ts): whole lines only. */
export function tencentLiveTuning(config: Pick<TencentAsrConfig, "lineGapMs" | "maxLineMs">): LiveTuning {
  return liveTuning({ ...DEFAULT_LIVE_TUNING, lineGapMs: config.lineGapMs, maxLineMs: config.maxLineMs });
}

// ------------------------------------------------------------------ what the service says

/** A vendor code as it may appear in a reason (letters, digits and underscores, at most 64). */
function codeTail(code: string): string {
  return code.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 64);
}

/** What one of the service's error codes means here: the reason the routes act on, and the status they read it by. */
export function tencentReason(code: string): { reason: string; status: number | null; retryAfterMs?: number } {
  if (/^(AuthFailure|UnauthorizedOperation)(\.|$)/.test(code) || code === "FailedOperation.CheckAuthInfoFailed") return { reason: "unauthorized", status: 401 };
  if (code === "FailedOperation.UserNotRegistered") return { reason: "not_configured:service_not_enabled", status: null };
  if (code === "FailedOperation.ServiceIsolate") return { reason: "not_configured:service_isolated", status: null };
  if (code === "FailedOperation.UserHasNoAmount" || code === "FailedOperation.UserHasNoFreeAmount") return { reason: "not_configured:no_balance", status: null };
  if (/^(UnsupportedRegion|InvalidAction|NoSuchVersion|NoSuchProduct|ActionOffline|UnsupportedOperation|IpInBlacklist|IpNotInWhitelist)(\.|$)/.test(code)) {
    return { reason: `not_configured:${codeTail(code)}`, status: null };
  }
  if (/^(RequestLimitExceeded|LimitExceeded)(\.|$)/.test(code)) return { reason: "busy", status: 429, retryAfterMs: 1000 };
  if (code === "FailedOperation.NoSuchTask") return { reason: "job_lost", status: 404 };
  if (/^(InvalidParameter|InvalidParameterValue|MissingParameter|UnknownParameter|RequestSizeLimitExceeded)(\.|$)/.test(code)) return { reason: `rejected_400_${codeTail(code)}`, status: 400 };
  if (code === "FailedOperation.ErrorRecognize") return { reason: "rejected_422_ErrorRecognize", status: 422 };
  return { reason: `http_503_${codeTail(code)}`, status: 503 };
}

/** A line's language as far as its letters say: zh when Chinese characters outnumber Latin words, else en. */
export function lineLang(text: string): "zh" | "en" | null {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]+/g) ?? []).length;
  if (han === 0 && latin === 0) return null;
  return han >= latin ? "zh" : "en";
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** "[0:3.050,0:7.250,0]  text" lines of Result (minutes:seconds, an hour in front past one, a speaker number after). */
const RESULT_LINE = /^\s*\[(?:(\d+):)?(\d+):(\d+(?:\.\d+)?),(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)(?:,\d+)?\]\s*(.*)$/;

function resultLines(result: string): WhisperSegment[] {
  const out: WhisperSegment[] = [];
  for (const raw of result.split(/\r?\n/)) {
    const m = RESULT_LINE.exec(raw);
    if (!m) continue;
    const ms = (h: string | undefined, min: string, s: string) => Math.round(((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000);
    const start = ms(m[1], m[2], m[3]);
    const text = m[7].trim();
    if (!text) continue;
    out.push({ start_ms: start, end_ms: Math.max(start, ms(m[4], m[5], m[6])), text, lang: lineLang(text) ?? "" });
  }
  return out;
}

/**
 * The sentences of a finished task: ResultDetail (ResTextFormat 2), else the timed lines of Result; null when neither
 * reads. `speakers`: the task was asked to separate speakers, so each sentence's SpeakerId is its speaker (without it
 * the service still answers SpeakerId 0 for every sentence, which says nothing).
 */
export function sentencesOf(data: Record<string, unknown>, opts: { speakers?: boolean } = {}): WhisperSegment[] | null {
  if (Array.isArray(data.ResultDetail)) {
    const out: WhisperSegment[] = [];
    for (const s of data.ResultDetail) {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      if (typeof o.FinalSentence !== "string" || !isNum(o.StartMs) || !isNum(o.EndMs)) return null;
      const text = o.FinalSentence.trim();
      if (!text) continue;
      const start = Math.max(0, Math.round(o.StartMs));
      // the speaker's number when the task separated speakers (SpeakerId); absent otherwise
      const speaker = opts.speakers && isNum(o.SpeakerId) && o.SpeakerId >= 0 ? Math.round(o.SpeakerId) : undefined;
      out.push({ start_ms: start, end_ms: Math.max(start, Math.round(o.EndMs)), text, lang: lineLang(text) ?? "", ...(speaker !== undefined ? { speaker } : {}) });
    }
    return out;
  }
  if (typeof data.Result === "string") return resultLines(data.Result);
  if (data.Result === null || data.Result === undefined) return [];
  return null;
}

// ------------------------------------------------------------------ the client

export interface TencentRecognition {
  taskId: number;
  /** in order, times from the start of the audio sent */
  sentences: WhisperSegment[];
  /** the sentences joined (no space next to a Chinese character) */
  text: string;
  /** the audio's length as the service measured it, null when it does not say */
  audioMs: number | null;
  /** from sending the audio to the answer */
  elapsedMs: number;
}

export interface TencentDeps {
  fetch?: FetchLike;
  /** the real clock in ms (a signature's timestamp must be the true time: never the app's test clock) */
  now?: () => number;
  /** waiting between polls (tests: at once) */
  sleep?: (ms: number, cancel?: AbortSignal) => Promise<void>;
}

/** Wait, but wake up at once when the work is cancelled. */
function sleep(ms: number, cancel?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (cancel?.aborted || ms <= 0) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      cancel?.removeEventListener("abort", done);
      resolve();
    }
    cancel?.addEventListener("abort", done, { once: true });
  });
}

/** A short failure that is worth one more try (a piece of the whole visit; a live line is tried again by the page). */
export function transientTencent(err: unknown): boolean {
  if (!(err instanceof WhisperUnavailable)) return false;
  return ["unreachable", "timeout", "busy", "bad_response"].includes(err.reason) || /^http_5\d\d/.test(err.reason);
}

export class TencentAsrClient {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly wait: (ms: number, cancel?: AbortSignal) => Promise<void>;

  constructor(
    readonly config: TencentAsrConfig,
    deps: TencentDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
    this.now = deps.now ?? Date.now;
    this.wait = deps.sleep ?? sleep;
  }

  private keys(): { secretId: string; secretKey: string } {
    const { secretId, secretKey, problem } = this.config;
    if (problem || !secretId || !secretKey) throw new WhisperUnavailable(`not_configured:${problem ?? "unknown"}`);
    return { secretId, secretKey };
  }

  /** One signed request. Throws WhisperUnavailable (see the header); returns the answer's Data. */
  async call(action: string, body: Record<string, unknown>, opts: { timeoutMs: number; cancel?: AbortSignal }): Promise<unknown> {
    const { secretId, secretKey } = this.keys();
    if (opts.cancel?.aborted) throw new WhisperUnavailable("cancelled");
    const host = this.config.endpoint;
    // serialised once: the bytes signed are the bytes sent
    const payload = JSON.stringify(body);
    const timestamp = Math.floor(this.now() / 1000);
    const signed = tc3Sign({ secretId, secretKey, service: TENCENT_ASR_SERVICE, host, payload, timestamp });
    const timeout = AbortSignal.timeout(Math.max(1, opts.timeoutMs));
    const signal = opts.cancel ? AbortSignal.any([timeout, opts.cancel]) : timeout;
    let status: number;
    let text: string;
    try {
      const res = await this.fetchImpl(`https://${host}/`, {
        method: "POST",
        headers: {
          Authorization: signed.authorization,
          "Content-Type": TC3_CONTENT_TYPE,
          "X-TC-Action": action,
          "X-TC-Version": TENCENT_ASR_VERSION,
          "X-TC-Region": this.config.region,
          "X-TC-Timestamp": String(timestamp),
        },
        body: payload,
        signal,
        cache: "no-store",
        redirect: "error",
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      // the cause is dropped on purpose: a fetch error can carry the request
      if (opts.cancel?.aborted) throw new WhisperUnavailable("cancelled");
      const name = (err as { name?: string })?.name;
      throw new WhisperUnavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
    }
    type Answer = { Error?: { Code?: unknown }; Data?: unknown; RequestId?: unknown };
    let response: Answer | null = null;
    try {
      const parsed = JSON.parse(text) as { Response?: unknown } | null;
      if (parsed && typeof parsed.Response === "object" && parsed.Response !== null) response = parsed.Response as Answer;
    } catch {
      response = null;
    }
    if (!response) throw new WhisperUnavailable(status >= 200 && status < 300 ? "bad_response" : `http_${status}`, status);
    if (response.Error) {
      const code = typeof response.Error.Code === "string" && /^[\w.]{1,80}$/.test(response.Error.Code) ? response.Error.Code : "UnknownError";
      const m = tencentReason(code);
      throw new WhisperUnavailable(m.reason, m.status, m.retryAfterMs ?? null);
    }
    if (status < 200 || status > 299) throw new WhisperUnavailable(`http_${status}`, status);
    return response.Data;
  }

  /** Send a 16 kHz mono WAV for recognition; its task id. `diarize`: the service separates the speakers (SpeakerId). */
  async createTask(wav: Uint8Array, opts: { timeoutMs?: number; cancel?: AbortSignal; diarize?: boolean } = {}): Promise<number> {
    const data = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength).toString("base64");
    // the API's own limit: refused here, before it is sent (a client error: the same audio fails again)
    if (data.length > TENCENT_ASR_MAX_DATA_BYTES) throw new WhisperUnavailable("too_large", 413);
    const out = await this.call(
      TENCENT_ASR_CREATE,
      {
        EngineModelType: this.config.engine,
        ChannelNum: 1,
        ResTextFormat: 2,
        SourceType: 1,
        Data: data,
        DataLen: wav.byteLength,
        HotwordList: TENCENT_ASR_HOTWORDS,
        ...(opts.diarize ? { SpeakerDiarization: 1 } : {}),
      },
      { timeoutMs: opts.timeoutMs ?? this.config.requestTimeoutMs, cancel: opts.cancel },
    );
    const taskId = (out as { TaskId?: unknown } | null)?.TaskId;
    if (typeof taskId !== "number" || !Number.isSafeInteger(taskId) || taskId <= 0) throw new WhisperUnavailable("bad_response");
    return taskId;
  }

  /** One look at a task: still running, or done with its sentences. A failed task throws rejected_422_task_failed. */
  async task(taskId: number, opts: { timeoutMs?: number; cancel?: AbortSignal; speakers?: boolean } = {}): Promise<{ done: false } | { done: true; sentences: WhisperSegment[]; audioMs: number | null }> {
    const out = await this.call(TENCENT_ASR_STATUS, { TaskId: taskId }, { timeoutMs: opts.timeoutMs ?? this.config.requestTimeoutMs, cancel: opts.cancel });
    const d = out && typeof out === "object" ? (out as Record<string, unknown>) : null;
    const status = d?.Status;
    if (!d || (status !== 0 && status !== 1 && status !== 2 && status !== 3)) throw new WhisperUnavailable("bad_response");
    if (status === 0 || status === 1) return { done: false };
    // the task failed (the service says why in ErrorMsg, which is not read: a code is enough, and words stay out of logs)
    if (status === 3) throw new WhisperUnavailable("rejected_422_task_failed", 422);
    const sentences = sentencesOf(d, { speakers: opts.speakers });
    if (!sentences) throw new WhisperUnavailable("bad_response");
    return { done: true, sentences: sentences.sort((a, b) => a.start_ms - b.start_ms), audioMs: isNum(d.AudioDuration) ? Math.round(d.AudioDuration * 1000) : null };
  }

  /**
   * One piece of audio from sending to its text: CreateRecTask, then DescribeTaskStatus every pollMs until it is done or
   * `deadlineMs` has passed (timeout). A poll that times out or cannot connect is not the end; three in a row are.
   */
  async recognize(wav: Uint8Array, opts: { deadlineMs: number; cancel?: AbortSignal; diarize?: boolean }): Promise<TencentRecognition> {
    const t0 = this.now();
    const deadline = t0 + opts.deadlineMs;
    const left = () => deadline - this.now();
    const within = () => Math.max(200, Math.min(this.config.requestTimeoutMs, left()));
    const taskId = await this.createTask(wav, { timeoutMs: within(), cancel: opts.cancel, diarize: opts.diarize });
    let failures = 0;
    for (;;) {
      await this.wait(Math.min(this.config.pollMs, Math.max(0, left())), opts.cancel);
      if (opts.cancel?.aborted) throw new WhisperUnavailable("cancelled");
      if (left() <= 0) throw new WhisperUnavailable("timeout");
      let st: Awaited<ReturnType<TencentAsrClient["task"]>>;
      try {
        st = await this.task(taskId, { timeoutMs: within(), cancel: opts.cancel, speakers: opts.diarize });
        failures = 0;
      } catch (err) {
        if (err instanceof WhisperUnavailable && ["timeout", "unreachable", "busy"].includes(err.reason) && ++failures < 3 && left() > 0) continue;
        throw err;
      }
      if (!st.done) continue;
      return { taskId, sentences: st.sentences, text: joinTexts(st.sentences.map((s) => s.text)), audioMs: st.audioMs, elapsedMs: this.now() - t0 };
    }
  }

  /**
   * One live line (16 kHz mono 16-bit WAV; the page closes a line at TENCENT_ASR_MAX_LINE_MS, 15 s by default, and the
   * route takes up to 30 s), for POST /api/asr/chunk. Only whole lines are recognised here:
   * the route answers a partial chunk itself without calling this (`partials` is false). One engine for every line, so
   * `langHint` is not needed.
   */
  async chunk(wav: Uint8Array, opts: { kind: "chunk" | "final"; langHint?: string | null }): Promise<WhisperChunkResult> {
    void opts;
    const t0 = this.now();
    const r = await this.recognize(wav, { deadlineMs: this.config.lineTimeoutMs });
    return {
      text: r.text,
      lang: lineLang(r.text),
      segments: r.sentences,
      durationMs: wavMs(wav),
      model: `tencent:${this.config.engine}`,
      modelMs: r.elapsedMs,
      roundTripMs: this.now() - t0,
      confidence: null,
    };
  }

  /**
   * Whether the key pair, the region and the service answer, without recognising anything: DescribeTaskStatus for task 1
   * answers NoSuchTask when they do (nothing is billed). null = they do; else the reason.
   */
  async check(timeoutMs: number = this.config.requestTimeoutMs): Promise<string | null> {
    try {
      await this.call(TENCENT_ASR_STATUS, { TaskId: 1 }, { timeoutMs });
      return null;
    } catch (err) {
      if (err instanceof WhisperUnavailable) return err.reason === "job_lost" ? null : err.reason;
      return "unreachable";
    }
  }
}

/** A 16 kHz mono 16-bit WAV's length in ms (its header's, else from its size). */
function wavMs(bytes: Uint8Array): number {
  const info = parseWav(bytes);
  return info ? info.durationMs : Math.max(0, Math.round(((bytes.length - 44) / 32_000) * 1000));
}

// ------------------------------------------------------------------ cutting a recording into pieces

const FRAME_MS = 20;

/** The middle of the longest quiet stretch in [fromMs, toMs) (the quietest frame when nothing is quiet), in ms. */
function quietestCut(samples: Int16Array, sampleRate: number, fromMs: number, toMs: number): number {
  const frame = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames: { ms: number; rms: number }[] = [];
  for (let ms = fromMs; ms + FRAME_MS <= toMs; ms += FRAME_MS) {
    const a = Math.round((ms * sampleRate) / 1000);
    let sum = 0;
    for (let k = a; k < a + frame && k < samples.length; k++) sum += samples[k] * samples[k];
    frames.push({ ms, rms: Math.sqrt(sum / frame) });
  }
  if (frames.length === 0) return toMs;
  // quiet: near the room's own level, the quietest frame of the window (at most three times it, or 50 above it on the
  // 16-bit scale, so a window of digital silence counts as quiet). The gaps between words reach it for a frame or two;
  // a pause between sentences stays there longest
  let floor = Infinity;
  for (const f of frames) if (f.rms < floor) floor = f.rms;
  const quiet = Math.max(floor * 3, floor + 50);
  let best = { at: -1, len: 0 };
  let run = -1;
  for (let i = 0; i <= frames.length; i++) {
    const q = i < frames.length && frames[i].rms <= quiet;
    if (q && run < 0) run = i;
    if (!q && run >= 0) {
      // the longest stretch; of two as long, the later one (a longer piece before it)
      if (i - run >= best.len) best = { at: run, len: i - run };
      run = -1;
    }
  }
  if (best.at < 0) {
    let low = frames[0];
    for (const f of frames) if (f.rms < low.rms) low = f;
    return low.ms + FRAME_MS / 2;
  }
  return frames[best.at].ms + Math.floor((best.len * FRAME_MS) / 2);
}

/**
 * Where a recording is cut into pieces of at most `maxMs` (ms on its own clock, in order, end to end): each cut at the
 * middle of the longest quiet stretch of the last `searchMs` before the limit (10 s, at most half a piece), so a cut
 * falls in a pause between words wherever the speech leaves one.
 */
export function pieceSpans(samples: Int16Array, sampleRate: number, opts: { maxMs: number; searchMs?: number }): { startMs: number; endMs: number }[] {
  const totalMs = Math.floor((samples.length / sampleRate) * 1000);
  const searchMs = Math.min(opts.searchMs ?? 10_000, Math.floor(opts.maxMs / 2));
  const spans: { startMs: number; endMs: number }[] = [];
  let start = 0;
  while (totalMs - start > opts.maxMs) {
    const cut = quietestCut(samples, sampleRate, start + opts.maxMs - searchMs, start + opts.maxMs);
    spans.push({ startMs: start, endMs: cut });
    start = cut;
  }
  if (totalMs > start || spans.length === 0) spans.push({ startMs: start, endMs: totalMs });
  return spans;
}

/** `fn` over `items`, at most `limit` at a time, in order; the first failure stops the rest (they are cancelled) and is thrown. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, signal: AbortSignal) => Promise<R>, cancel: AbortSignal): Promise<R[]> {
  const stop = new AbortController();
  const signal = AbortSignal.any([cancel, stop.signal]);
  const out = new Array<R>(items.length);
  let next = 0;
  let failure: { err: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], signal);
      } catch (err) {
        if (!failure) failure = { err };
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failure) throw (failure as { err: unknown }).err;
  return out;
}

// ------------------------------------------------------------------ the provider

interface TencentJob {
  state: "pending" | "done" | "failed";
  result: FileJobResult;
  createdAt: number;
  /** he chose not to wait (DELETE /api/asr/jobs/[id]): stops the pieces still being recognised */
  cancel: AbortController;
}

const g = globalThis as unknown as { __rippleTencentJobs?: Map<string, TencentJob> };
function jobs(): Map<string, TencentJob> {
  g.__rippleTencentJobs ??= new Map();
  // keep the map small: forget jobs older than a day (the service keeps a task 24 hours)
  const cutoff = Date.now() - 86_400_000;
  for (const [id, j] of g.__rippleTencentJobs) if (j.createdAt < cutoff) g.__rippleTencentJobs.delete(id);
  return g.__rippleTencentJobs;
}

export class TencentSpeechProvider implements SpeechProvider {
  /**
   * The provider lives on globalThis (lib/asr/index.ts) and may have been made by another bundle's copy of this class
   * (the scheduled jobs run in instrumentation's bundle): `instanceof` recognises it by its name and its client.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const p = value as { name?: unknown; client?: unknown; createFileJob?: unknown };
    return p.name === "tencent" && typeof p.client === "object" && p.client !== null && typeof p.createFileJob === "function";
  }

  readonly name = "tencent" as const;
  /** live captions are whole lines only: every request is a paid recognition task (see the header) */
  readonly partials = false;
  readonly client: TencentAsrClient;
  private readonly mock: MockSpeechProvider;
  private readonly env: Env | undefined;
  private readonly wait: (ms: number, cancel?: AbortSignal) => Promise<void>;
  private checked: { at: number; reason: string | null } | null = null;

  constructor(opts: { config?: TencentAsrConfig; env?: Env } & TencentDeps = {}) {
    this.client = new TencentAsrClient(opts.config ?? tencentAsrConfig(opts.env), opts);
    this.mock = new MockSpeechProvider();
    this.env = opts.env;
    this.wait = opts.sleep ?? sleep;
  }

  get config(): TencentAsrConfig {
    return this.client.config;
  }

  /** ASR_REPLAY_FALLBACK, read at call time (as Whisper's: lib/asr/whisper.ts replayFallbackAllowed). */
  get replayFallback(): boolean {
    return replayFallbackAllowed(this.env ?? process.env);
  }

  /** The segmentation the page uses with this provider. */
  liveTuning(): LiveTuning {
    return tencentLiveTuning(this.config);
  }

  /**
   * Is the service usable right now? null = yes; else why not: not_configured:* | unauthorized | busy | timeout |
   * unreachable | http_*. Kept 60 s when it is (10 s when it is not); a `timeoutMs` asks again now.
   */
  async probe(timeoutMs?: number): Promise<string | null> {
    if (this.config.problem) return `not_configured:${this.config.problem}`;
    const now = Date.now();
    if (timeoutMs === undefined && this.checked && now - this.checked.at < (this.checked.reason ? 10_000 : 60_000)) return this.checked.reason;
    const reason = await this.client.check(timeoutMs ?? this.config.requestTimeoutMs);
    this.checked = { at: Date.now(), reason };
    return reason;
  }

  /** The live path needs no browser credential (lines go through /api/asr/chunk with his sign-in): a check and a placeholder. */
  async realtimeToken(): Promise<{ token: string; expiresAt: number }> {
    const reason = await this.probe();
    if (reason) throw new SpeechError("unavailable", reason);
    return { token: `tencent-lines-${randomUUID()}`, expiresAt: Date.now() + 10 * 60_000 };
  }

  /** The pieces a recording of these lengths is cut into (at least one per file). */
  private pieces(lengthsMs: readonly number[]): number {
    return lengthsMs.reduce((n, ms) => n + Math.max(1, Math.ceil(Math.max(0, ms) / this.config.pieceMs)), 0);
  }

  /**
   * The longest a whole-visit job for this recording can stay pending: the pieces go three at a time, each with its
   * deadline and one more try. The page waits this long (plus a margin) before it gives up on the job.
   */
  budgetMs(audio: Uint8Array | null | undefined): number {
    return this.budgetMsForParts([audio ? wavMs(audio) : 0]);
  }

  /** The same for a recording in several files (their lengths in ms): the files go one after another. */
  budgetMsForParts(lengthsMs: readonly number[]): number {
    const rounds = lengthsMs.reduce((n, ms) => n + Math.ceil(this.pieces([ms]) / this.config.concurrency), 0);
    return Math.max(1, rounds) * (2 * this.config.pieceTimeoutMs + 1000) + 5000;
  }

  async createFileJob(input: FileJobInput): Promise<{ jobId: string }> {
    if (!input.url && !input.audio && !input.recorded) throw new SpeechError("invalid", "createFileJob needs a url or the audio");
    const jobId = `tencentjob-${randomUUID()}`;
    const job: TencentJob = { state: "pending", result: { status: "pending" }, createdAt: Date.now(), cancel: new AbortController() };
    jobs().set(jobId, job);
    void this.run(job, input).catch((err) => {
      job.state = "failed";
      job.result = { status: "failed", error: "internal_error" };
      console.warn(`[tencent-asr] file job crashed: ${(err as Error)?.name ?? "error"}`);
    });
    return { jobId };
  }

  async getFileJob(jobId: string): Promise<FileJobResult> {
    const job = jobs().get(jobId);
    if (!job) throw new SpeechError("not_found", `No speech job ${jobId}`);
    return structuredClone(job.result);
  }

  /** He chose not to wait: the pieces still being recognised stop, and the job finishes with the live lines (or fails). */
  async cancelFileJob(jobId: string): Promise<boolean> {
    const job = jobs().get(jobId);
    if (!job) throw new SpeechError("not_found", `No speech job ${jobId}`);
    if (job.state !== "pending") return false;
    job.cancel.abort();
    return true;
  }

  /** The replay file's transcript through the mock (a replay, or the screen showed the replay). */
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

  /**
   * One piece, with one more try after a short failure (busy, a dropped connection, a 5xx, no answer in time). With
   * speaker separation on, a piece the service refuses for a parameter (an engine that does not separate speakers) is
   * sent once more without it: the words matter more than who said them.
   */
  private async recognizePiece(wav: Uint8Array, signal: AbortSignal): Promise<TencentRecognition> {
    let diarize = this.config.diarize;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.recognize(wav, { deadlineMs: this.config.pieceTimeoutMs, cancel: signal, diarize });
      } catch (err) {
        if (signal.aborted) throw new WhisperUnavailable("cancelled");
        if (diarize && err instanceof WhisperUnavailable && /^rejected_400_/.test(err.reason)) {
          console.warn(`[tencent-asr] speaker separation refused (${err.reason}): the piece goes again without it`);
          diarize = false;
          continue;
        }
        if (attempt === 0 && transientTencent(err)) {
          await this.wait(1000, signal);
          continue;
        }
        throw err;
      }
    }
  }

  /** One file of the recording as lines on its own clock: cut into pieces, recognised three at a time, joined. `pieces`: how many. */
  private async transcribeFile(wav: Uint8Array, cancel: AbortSignal): Promise<{ utterances: FileJobUtterance[]; pieces: number }> {
    const info = parseWav(wav);
    if (!info || info.sampleRate !== TARGET_SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) throw new WhisperUnavailable("rejected_415_format", 415);
    const all = pcmRange(wav, 0, info.durationMs + 1);
    if (!all || all.samples.length === 0) return { utterances: [], pieces: 0 };
    const spans = pieceSpans(all.samples, all.sampleRate, { maxMs: this.config.pieceMs });
    const toSample = (ms: number) => Math.min(all.samples.length, Math.round((ms * all.sampleRate) / 1000));
    const parts = await mapLimit(
      spans,
      this.config.concurrency,
      async (span, signal) => {
        const piece = encodeWav(all.samples.subarray(toSample(span.startMs), toSample(span.endMs)), all.sampleRate);
        const r = await this.recognizePiece(piece, signal);
        return { startMs: span.startMs, utterances: utterancesFromSegments(r.sentences, this.config.lineGapMs) };
      },
      cancel,
    );
    const utterances = parts.length === 1 ? parts[0].utterances.map((u) => ({ ...u, tStartMs: u.tStartMs + parts[0].startMs, tEndMs: u.tEndMs + parts[0].startMs })) : joinPartUtterances(parts, this.config.lineGapMs);
    return { utterances, pieces: spans.length };
  }

  private async run(job: TencentJob, input: FileJobInput): Promise<void> {
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
    let reason: string;
    try {
      if (this.config.problem) throw new WhisperUnavailable(`not_configured:${this.config.problem}`);
      const files: { ms: number | null; load(): Promise<Uint8Array | null> }[] = parts ?? [{ ms: null, load: async () => input.audio ?? null }];
      const pieces: { startMs: number; utterances: FileJobUtterance[] }[] = [];
      let startMs = 0;
      let sent = 0;
      for (const file of files) {
        if (cancel.aborted) throw new WhisperUnavailable("cancelled");
        const wav = await file.load();
        // a part that is no longer in storage: the recording is not whole, and half a visit is never the record
        if (!wav) throw new WhisperUnavailable("no_audio");
        const done = await this.transcribeFile(wav, cancel);
        pieces.push({ startMs, utterances: done.utterances });
        sent += done.pieces;
        // the next file's times start where this one's audio ends
        startMs += file.ms ?? wavMs(wav);
      }
      const joined = pieces.length === 1 ? pieces[0].utterances : joinPartUtterances(pieces, this.config.lineGapMs);
      job.result = {
        status: "done",
        source: "audio",
        // the service's speaker numbers hold within one piece only: a recording of several pieces has none (see the header)
        utterances: sent > 1 ? joined.map((u) => ({ ...u, speaker: null })) : joined,
        model: `tencent:${this.config.engine}`,
      };
      job.state = "done";
      return;
    } catch (err) {
      reason = cancel.aborted ? "cancelled" : err instanceof WhisperUnavailable ? err.reason : "internal_error";
      if (!(err instanceof WhisperUnavailable)) console.warn(`[tencent-asr] file job failed: ${(err as Error)?.name ?? "error"}`);
    }
    console.warn(`[tencent-asr] the whole-visit transcript could not be made (${reason})`);
    await this.fallBack(job, input, reason, { fixture: false });
  }

  /**
   * opts.fixture: the screen showed the replay, so the record follows it (only with ASR_REPLAY_FALLBACK on). Otherwise the
   * live lines of this recording, else failed. Never the script for a recording.
   */
  private async fallBack(job: TencentJob, input: FileJobInput, reason: string, opts: { fixture: boolean }): Promise<void> {
    const live = (input.liveUtterances ?? []).filter((u) => u.text.trim());
    let fallback: SpeechFallback;
    const fixture = opts.fixture ? await this.fromFixture(input) : null;
    if (fixture && fixture.status === "done") {
      job.result = { ...fixture, fallback: (fallback = { reason, used: "fixture" }) };
    } else if (live.length) {
      job.result = { status: "done", source: "audio", utterances: live.map((u) => ({ ...u })), fallback: (fallback = { reason, used: "live" }) };
    } else {
      job.result = { status: "failed", error: `tencent_unavailable:${reason}`, fallback: (fallback = { reason, used: "none" }) };
    }
    job.state = job.result.status === "failed" ? "failed" : "done";
    try {
      input.onFallback?.(fallback);
    } catch {
      // publishing the event must not break the job
    }
  }
}
