/**
 * Speech provider interface (docs/plan/spec.md section 4). Implementations: `mock` (replays
 * web/fixtures/visits/<visit>.utterances.json), `whisper` (M14: the local Whisper service in
 * services/whisper, at WHISPER_URL; see lib/asr/whisper.ts for what it falls back to), `tencent` (Tencent Cloud speech
 * recognition, recording file recognition: lib/asr/tencent.ts, the owner's decision of 2026-10-14) and `trtc` (a stub
 * that is no longer used for transcription: TRTC is read-aloud only).
 *
 * Client-safe: types only.
 */

export type SpeechLang = "zh-en-mixed" | "en";

export interface FileJobInput {
  /** signed read link of the whole-visit WAV, or "fixture:<visitId>" when there is no recording (replay) */
  url: string;
  /** number of people in the room (diarisation hint) */
  speakers?: number;
  lang: SpeechLang;
  /** extension (mock only): which replay file stands in for the recording */
  fixture?: string;
  /** developer tool (SPEECH_PROVIDER=devfake): the fixture the x-ripple-devfake-fixture header names */
  devfakeFixture?: string;
  // ---- extensions for whisper (server-side only; never serialised)
  /** the recording's bytes (16 kHz mono 16-bit WAV), read from the blob store by the route */
  audio?: Uint8Array;
  /**
   * C2 track R: a long recording in several files (lib/visit/recording.ts), in order, instead of `audio`. The job reads
   * and sends them one after another (a part is about 37 MB: never all in memory) and its transcript's times run over
   * the whole visit: each part's times are moved by the length of the parts before it. `ms`: the part's length as the
   * visit row has it (null: taken from the file). `load`: its bytes, null when the file is not in storage.
   */
  audioParts?: { ms: number | null; load(): Promise<Uint8Array | null> }[];
  /** the live lines already transcribed by Whisper on this visit: the fallback when the service fails now */
  liveUtterances?: FileJobUtterance[];
  /** the screen showed the replay while recording: the record follows the replay (ASR_REPLAY_FALLBACK on only) */
  preferFixture?: boolean;
  /**
   * the visit was recorded (not a sample replay): without `audio` the record is the live Whisper lines or the job
   * fails, never the replay file's script
   */
  recorded?: boolean;
  /** why a recorded visit has no audio here: no_audio (default) | too_large | upload_failed | skipped */
  missingAudio?: string;
  /** called once when the job falls back (to publish asr.fallback) */
  onFallback?: (fallback: SpeechFallback) => void;
}

/** Why and to what a whisper job or the live captions fell back. */
export interface SpeechFallback {
  /**
   * unreachable | timeout | stalled | http_<status> | unauthorized | loading | engine_error | stuck | busy |
   * bad_response | job_failed | transcription_failed | not_configured:<why> | too_large | no_audio |
   * upload_failed | skipped | cancelled | live_fallback | job_lost (the service restarted and forgot the job) |
   * rejected_<status>[_<code>] (the service refused the request: 400, 415, 422)
   */
  reason: string;
  /** what was used instead: the live Whisper lines, the replay file, or nothing (the job failed) */
  used: "live" | "fixture" | "none";
  /** the service went away mid-job: how long the job waited for it to come back before giving up (ms) */
  waitedMs?: number;
}

/** How sure the recogniser was of a sentence (Whisper's avg_logprob / no_speech_prob bands). */
export type AsrConfidence = "high" | "medium" | "low";

export interface FileJobUtterance {
  tStartMs: number;
  tEndMs: number;
  speaker: number | null;
  text: string;
  // ---- extensions (mock fills them from the replay file; TRTC leaves them undefined)
  id?: string;
  lang?: string;
  /** whisper: the least confident segment of the sentence (not stored yet: see PROGRESS, M14 fixer round 1) */
  confidence?: AsrConfidence;
}

export interface FileJobResult {
  status: "pending" | "done" | "failed";
  utterances?: FileJobUtterance[];
  // ---- extensions
  /** "fixture" = the mock replayed a script file instead of transcribing audio; "audio" = real ASR */
  source?: "fixture" | "audio";
  error?: string;
  /** whisper: the job fell back (service down or failed) */
  fallback?: SpeechFallback;
  /** whisper: the model that made the transcript */
  model?: string;
  /**
   * whisper, while pending: the service accepted the recording and then went away (restart, crash, wedged worker);
   * the job waits for it to answer healthy again and then sends the recording again (lib/asr/whisper.ts). Absent
   * while the job runs normally.
   */
  awaiting_transcript?: { reason: string; since_ms: number; attempt: number };
  /** whisper, done: the transcript was made again after the service came back (why, and how long it waited) */
  redone?: { attempts: number; reasons: string[]; waited_ms: number };
}

export interface SpeechProvider {
  readonly name: "mock" | "trtc" | "whisper" | "tencent" | "devfake";
  /** Short-lived credential for the browser's realtime connection (keys never reach the browser). */
  realtimeToken(): Promise<{ token: string; expiresAt: number }>;
  createFileJob(input: FileJobInput): Promise<{ jobId: string }>;
  getFileJob(jobId: string): Promise<FileJobResult>;
}

export type SpeechErrorCode = "not_configured" | "not_found" | "invalid" | "unavailable";

export class SpeechError extends Error {
  readonly code: SpeechErrorCode;
  constructor(code: SpeechErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SpeechError";
    this.code = code;
  }

  /** Recognised across bundle copies of this module by name and code (C2, as StoreError; see WhisperUnavailable). */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const e = value as { name?: unknown; code?: unknown };
    return e.name === "SpeechError" && typeof e.code === "string";
  }
}

/** One line of a replay file (fields per spec section 4). */
export interface FixtureUtterance {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster: number | null;
  lang: string;
  text: string;
}

/** One step of a realtime replay: a growing caption (partial) or the finished sentence (final). */
export interface ReplayStep {
  /** replay-clock milliseconds from the start of the recording */
  atMs: number;
  kind: "partial" | "final";
  utterance: FixtureUtterance;
  /** caption text so far (the whole sentence for a final) */
  text: string;
}
