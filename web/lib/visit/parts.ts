/**
 * A long visit's recording goes to the server in parts (C2 track R). Client-safe and pure: the numbers, and how a
 * recording is cut. The phone cuts (components/visit/elder/upload-recording.ts); the server measures every part it is
 * given and never trusts a length the phone states (app/api/visits/[id]/parts).
 *
 * Why parts: the phone records 16 kHz mono 16-bit WAV, 32,000 bytes a second (about 1.9 MB a minute), and the audio
 * bucket takes at most 50 MiB in one file (lib/blob/types.ts BUCKET_CONFIG; the hosted storage's free plan has the
 * same ceiling). One file therefore ends at about 27 minutes of audio, and a visit can be longer.
 *
 * The part length is 20 minutes of audio: 38,400,044 bytes, 36.6 MiB.
 *   - It is 73% of the bucket's 50 MiB, and under the Whisper service's own intake limit (WHISPER_MAX_FILE_MB, 64 by
 *     default; it must stay at 37 or more). PCM has no variable bit rate, so the size is exact and the margin is not
 *     there for variance: it is there so that neither limit is ever close.
 *   - Almost every real visit is shorter than 20 minutes and stays what it is today: one file, the same path, the same
 *     rows. Only a longer one is cut.
 *   - A part that fails to upload is sent again alone: at most 38 MB, never the whole visit.
 *   - Fewer parts mean fewer cuts through a sentence (the transcript joins the two halves again, lib/asr/whisper.ts
 *     joinPartUtterances).
 * A recording that is longer than one part by less than a second is not cut for that second: the last part takes it.
 */
import { TARGET_SAMPLE_RATE } from "./wav";

/** bytes of audio in one millisecond of 16 kHz mono 16-bit PCM */
export const BYTES_PER_MS = (TARGET_SAMPLE_RATE * 2) / 1000;
/** samples in one millisecond */
export const SAMPLES_PER_MS = TARGET_SAMPLE_RATE / 1000;

/** One part: 20 minutes of audio. */
export const PART_MS = 20 * 60_000;
/** A remainder shorter than this stays with the part before it (no part of a fraction of a second). */
export const PART_TAIL_MS = 1_000;
/** The most parts the server keeps for one visit (16 x 20 minutes: far past anything the phone records). */
export const MAX_PARTS = 16;
/**
 * The phone ends a recording itself after this many full parts: 3 hours at 20 minutes. No visit is that long; a
 * recording left running by accident is, and it would fill the phone. He is told before it happens (recordingLimit).
 */
export const PHONE_MAX_PARTS = 9;
/** How long before the end he is told (never more than half a part, so a test's tiny parts still get a notice). */
export const LIMIT_NOTICE_MS = 10 * 60_000;

/**
 * Developer tools only (components/visit/elder/pages.tsx): the request header in which a test names a small part length
 * in milliseconds, so that a recording of a few seconds is uploaded in parts. Read by his visit page alone, and only
 * while the developer tools are on; the server's own checks do not depend on it.
 */
export const PART_HEADER = "x-ripple-part-ms";

/** A WAV file's size for this much audio. */
export function wavBytes(ms: number): number {
  return 44 + Math.round(ms * BYTES_PER_MS);
}

/** The part length to cut with: the given one when it is a whole number of milliseconds within reason, else 20 minutes. */
export function partMsOr(given: number | null | undefined): number {
  return typeof given === "number" && Number.isInteger(given) && given >= 200 && given <= PART_MS ? given : PART_MS;
}

/** The remainder that stays with the last part, for this part length (a second; a quarter of a tiny test part). */
export function tailMsFor(partMs: number): number {
  return Math.min(PART_TAIL_MS, Math.floor(partMs / 4));
}

/**
 * How many samples the next file takes when `remaining` samples are still to send: all of them when they fit in one
 * part (plus the tail), else exactly one part.
 */
export function nextPartSamples(remaining: number, partMs: number): number {
  const part = partMs * SAMPLES_PER_MS;
  const tail = tailMsFor(partMs) * SAMPLES_PER_MS;
  if (remaining <= 0) return 0;
  return remaining <= part + tail ? remaining : part;
}

/** The lengths, in samples, of the files a recording of `total` samples is sent as (one entry: one file, as before). */
export function planParts(total: number, partMs: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(total));
  while (left > 0) {
    const n = nextPartSamples(left, partMs);
    out.push(n);
    left -= n;
  }
  return out;
}

export interface RecordingLimit {
  /** ok: go on. soon: he is told now, the recording goes on. stop: the recording ends itself now and is saved. */
  state: "ok" | "soon" | "stop";
  /** the longest recording, ms */
  maxMs: number;
  /** what is left of it, ms (0 at the end) */
  leftMs: number;
}

/** Where a recording of `recordedMs` stands against the longest the phone records. */
export function recordingLimit(recordedMs: number, partMs: number = PART_MS): RecordingLimit {
  const maxMs = PHONE_MAX_PARTS * partMs;
  const leftMs = Math.max(0, maxMs - recordedMs);
  const notice = Math.min(LIMIT_NOTICE_MS, Math.floor(partMs / 2));
  return { state: leftMs <= 0 ? "stop" : leftMs <= notice ? "soon" : "ok", maxMs, leftMs };
}

/** Bytes the phone needs to keep one minute of recording (16-bit samples at 16 kHz, with room for the store's own overhead). */
export const PHONE_BYTES_PER_MINUTE = 2_200_000;

/** Minutes of recording this much free room on the phone holds (whole minutes, never negative). */
export function minutesOfRoom(freeBytes: number): number {
  return Number.isFinite(freeBytes) ? Math.max(0, Math.floor(freeBytes / PHONE_BYTES_PER_MINUTE)) : 0;
}
