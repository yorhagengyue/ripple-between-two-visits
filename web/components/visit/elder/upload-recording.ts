/**
 * Sending a visit's recording from the phone to the server (C2 track R; lib/visit/parts.ts has the numbers and why).
 * Pure but for what it is handed: the recording (./recording-store.ts keptSource) and the four calls it makes (the
 * page gives the real ones, a test gives its own). It never deletes on its own word: the phone's copy of a part is
 * dropped with the path the server answered for that part, and not before.
 *
 *   one file    A recording that fits in one part (20 minutes of audio; with a remainder under a second, a little
 *               more) goes exactly as it always has: one upload link, one PUT, and the path is handed to
 *               POST /api/asr/jobs by the page. Nothing is asked of the parts route, no list is made.
 *   in parts    A longer one goes as consecutive files, in order. Before anything is sent the server is asked what it
 *               has (GET /api/visits/[id]/parts) and the upload goes on after it: from the first sample the server
 *               does not have, never from the start. Each part: read from the phone, uploaded through its own link,
 *               registered (POST .../parts, where the server reads and measures the file); only when the server's
 *               answer lists it under the path just uploaded is the phone's copy of that stretch dropped, and only
 *               then is the next part read. Any failure stops there and says so; trying again asks the server anew.
 *
 * Where the next part starts is the audio the server has, counted in samples (its parts' measured lengths), not a part
 * number: a cut made with another part length (a test's small one, a future change) is carried on correctly.
 */
import { SAMPLES_PER_MS, tailMsFor } from "@/lib/visit/parts";
import { encodeWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import type { KeptSource } from "./recording-store";

export interface ServerPart {
  seq: number;
  path: string;
  ms: number;
}

/** The server's side, as the page calls it. Each call rejects (or answers what it answers) when it fails. */
export interface UploadApi {
  /** POST /api/upload-url { kind: "recording", visit_id }: where to send one file */
  link(visitId: string): Promise<{ url: string; method: string; headers: Record<string, string>; path: string }>;
  /** the bytes to that link; true when the storage took them */
  put(link: { url: string; method: string; headers: Record<string, string> }, file: Blob): Promise<boolean>;
  /** GET /api/visits/[id]/parts: what the server has; `path` is the whole recording's when it is complete */
  parts(visitId: string): Promise<{ parts: ServerPart[]; complete: boolean; path?: string | null }>;
  /** POST /api/visits/[id]/parts { seq, path }: the server's list after it took the part */
  register(visitId: string, seq: number, path: string): Promise<{ parts: ServerPart[] }>;
}

export type UploadResult =
  /** the whole recording is on the server. `parts`: how many files it is (null: one file, handed over by its path as before) */
  | { ok: true; path: string; parts: number | null }
  /**
   * it is not. `why`: the storage did not take a file (upload), or the server did not answer or did not confirm
   * (server): the phone still has everything the server lacks, and trying again goes on from there. empty: there is
   * no audio at all in this phone's copy (nothing was recorded). gone: the server lacks audio this phone no longer
   * has, so nothing here can finish it (a part is only dropped once the server confirmed it, so this means the
   * server's list was changed under the phone).
   */
  | { ok: false; why: "upload" | "server" | "empty" | "gone" };

export interface UploadProgress {
  /** audio the server has confirmed, ms */
  sentMs: number;
  /** the whole recording, ms */
  totalMs: number;
}

const wavBlob = (samples: Int16Array): Blob => new Blob([encodeWav(samples, TARGET_SAMPLE_RATE).buffer as ArrayBuffer], { type: "audio/wav" });

/** Less than a millisecond of audio is the rounding of a measured length, not something to send. */
const NOTHING = SAMPLES_PER_MS;

export async function uploadRecording(opts: {
  visitId: string;
  source: KeptSource;
  /** the part length to cut with (lib/visit/parts.ts PART_MS; a test's small one) */
  partMs: number;
  api: UploadApi;
  /** told at the start of an upload in parts and after every confirmed part */
  onProgress?: (p: UploadProgress) => void;
}): Promise<UploadResult> {
  const { visitId, source, partMs, api } = opts;
  const partSamples = partMs * SAMPLES_PER_MS;
  const most = partSamples + tailMsFor(partMs) * SAMPLES_PER_MS;

  async function send(samples: Int16Array): Promise<string | null> {
    try {
      const link = await api.link(visitId);
      return (await api.put(link, wavBlob(samples))) ? link.path : null;
    } catch {
      return null;
    }
  }

  // ---- one file, as before: the copy is whole on this phone and fits in one part
  let first: Int16Array | null = null;
  if (source.startSample === 0 && source.totalMs <= partMs + tailMsFor(partMs) + 1000) {
    // the count kept beside the recording is close, not exact: the samples decide (one more than a file may hold)
    first = await source.read(0, most + 1);
    if (first.length <= most) {
      if (first.length === 0) return { ok: false, why: "empty" };
      const path = await send(first);
      return path ? { ok: true, path, parts: null } : { ok: false, why: "upload" };
    }
  }

  // ---- in parts: after what the server already has
  let have: ServerPart[];
  try {
    const state = await api.parts(visitId);
    have = state.parts;
    // the server holds the whole recording already (an earlier try finished the upload and stopped after it)
    if (state.complete) {
      const path = state.path ?? have[0]?.path ?? null;
      return path ? { ok: true, path, parts: have.length > 0 ? have.length : null } : { ok: false, why: "server" };
    }
  } catch {
    return { ok: false, why: "server" };
  }
  let offset = Math.round(have.reduce((ms, p) => ms + p.ms, 0) * SAMPLES_PER_MS);
  // a last part's measured length is rounded down to the millisecond: the phone's own count is the exact one
  if (source.startSample > offset && source.startSample - offset < NOTHING) offset = source.startSample;
  // the server lacks audio this phone already dropped: nothing here can send it
  if (offset < source.startSample) return { ok: false, why: "gone" };
  // what the server has, the phone no longer needs (a drop that did not happen after an earlier confirmation)
  if (have.length > 0) await source.dropBefore(offset, { serverPartPath: have[have.length - 1].path });
  const totalMs = Math.max(source.totalMs, offset / SAMPLES_PER_MS);
  opts.onProgress?.({ sentMs: offset / SAMPLES_PER_MS, totalMs });

  for (;;) {
    const ahead = first && offset === 0 ? first : await source.read(offset, most + 1);
    first = null;
    if (ahead.length < NOTHING) break;
    // more than a last part may hold came back (the read asks for one sample past that): one whole part now, and more
    // after it; else this is the last part and takes everything that is left (lib/visit/parts.ts nextPartSamples)
    const part = ahead.length > most ? ahead.subarray(0, partSamples) : ahead;
    const path = await send(part);
    if (!path) return { ok: false, why: "upload" };
    let listed: ServerPart[];
    try {
      listed = (await api.register(visitId, have.length, path)).parts;
    } catch {
      return { ok: false, why: "server" };
    }
    // confirmed means: the server's list has this part, under the path just uploaded
    const mine = listed[have.length];
    if (!mine || mine.path !== path) return { ok: false, why: "server" };
    have = listed;
    offset += part.length;
    await source.dropBefore(offset, { serverPartPath: mine.path });
    opts.onProgress?.({ sentMs: offset / SAMPLES_PER_MS, totalMs: Math.max(totalMs, offset / SAMPLES_PER_MS) });
  }
  if (have.length === 0) return { ok: false, why: "empty" };
  return { ok: true, path: have[0].path, parts: have.length };
}
