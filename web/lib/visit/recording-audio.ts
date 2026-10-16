/**
 * Reading a visit's recording from storage as one recording, whether it is one file or several (C2 track R). Server-only.
 * The files are 16 kHz mono 16-bit WAV; a time is milliseconds from the start of the visit, across every file.
 *
 * A part is about 37 MB, so the parts are read one at a time and at most two are held (a sentence that crosses a cut
 * needs the end of one and the start of the next). The readers go through the visit in order (the transcript's lines by
 * time), so each part is read once.
 */
import type { BlobStore } from "@/lib/blob";
import type { VisitRow } from "@/lib/store/types";
import { recordingFiles, type RecordingFile } from "./recording";
import { concatInt16, encodeWav, parseWav, pcmRange, sliceWav, TARGET_SAMPLE_RATE } from "./wav";

export interface OpenRecording {
  /** the recording's files in order */
  files: RecordingFile[];
  /** one file's bytes (null: it is not in storage) */
  load(index: number): Promise<Uint8Array | null>;
  /** [startMs, endMs) of the whole recording as a WAV of its own; null when the range holds no audio */
  clip(startMs: number, endMs: number): Promise<Uint8Array | null>;
}

/**
 * The visit's whole recording, or null when the server does not hold one (none, or parts still arriving). `first`:
 * the first file's bytes when the caller has read them already.
 */
export function openRecording(blob: BlobStore, visit: Pick<VisitRow, "audio_path" | "audio_parts">, opts: { first?: Uint8Array } = {}): OpenRecording | null {
  const files = recordingFiles(visit);
  if (!files.length) return null;
  const held = new Map<number, Uint8Array | null>();
  if (opts.first) held.set(0, opts.first);
  const load = async (index: number): Promise<Uint8Array | null> => {
    if (index < 0 || index >= files.length) return null;
    if (held.has(index)) return held.get(index) ?? null;
    const bytes = (await blob.getObject("audio", files[index].path))?.bytes ?? null;
    // keep the newest two: the one being read and the one before it
    for (const k of [...held.keys()]) if (k < index - 1) held.delete(k);
    held.set(index, bytes);
    return bytes;
  };
  const single = files.length === 1;
  return {
    files,
    load,
    async clip(startMs, endMs) {
      if (!(endMs > startMs)) return null;
      if (single) {
        const bytes = await load(0);
        return bytes ? sliceWav(bytes, startMs, endMs) : null;
      }
      const runs: Int16Array[] = [];
      let rate = TARGET_SAMPLE_RATE;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const from = Math.max(0, startMs - f.startMs);
        const to = Math.min(f.ms ?? Number.POSITIVE_INFINITY, endMs - f.startMs);
        if (to <= from) continue;
        const bytes = await load(i);
        const range = bytes ? pcmRange(bytes, from, to) : null;
        if (!range) continue;
        rate = range.sampleRate;
        runs.push(range.samples);
      }
      return runs.length ? encodeWav(concatInt16(runs), rate) : null;
    },
  };
}

/** The loaders a speech job reads the recording's files through, in order (lib/asr/types.ts FileJobInput.audioParts). */
export function partLoaders(recording: OpenRecording): { ms: number | null; load(): Promise<Uint8Array | null> }[] {
  return recording.files.map((f, i) => ({ ms: f.ms, load: () => recording.load(i) }));
}

/**
 * What the server found in a file the phone says is a part of a recording: its audio's length, or why it is not one.
 * A part is a 16 kHz mono 16-bit PCM WAV with at least one sample (the format the phone records; the transcription
 * service and the clip cutter read nothing else).
 */
export function measurePart(bytes: Uint8Array): { ok: true; ms: number } | { ok: false; why: "not_wav" | "wrong_format" | "empty" } {
  const info = parseWav(bytes);
  if (!info) return { ok: false, why: "not_wav" };
  if (info.sampleRate !== TARGET_SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) return { ok: false, why: "wrong_format" };
  if (info.dataLength < 2) return { ok: false, why: "empty" };
  return { ok: true, ms: info.durationMs };
}
