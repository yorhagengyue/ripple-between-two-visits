/**
 * A visit's recording as the server holds it: one file, or the parts of a long one in order (C2 track R;
 * supabase/migrations/0017_r_visit_audio_parts.sql). Pure and client-safe. Everything that needs the audio, or needs to
 * know which files are the visit's, reads the row through here, so a recording in parts is one recording everywhere:
 * the transcript (app/api/asr/jobs, lib/asr/pending.ts), the sentence clips (lib/visit/pipeline.ts finalizeVisit),
 * listening (app/api/me/export/recording), his export, retention and the orphan sweep (lib/privacy).
 *
 *   audio_path   "the server holds the whole recording": null while parts are still arriving, the first part's path
 *                once the last one is there (app/api/asr/jobs). A recording in one file has only this.
 *   audio_parts  the parts registered so far, in order, each with its measured length.
 */
import type { VisitAudioPart, VisitRow } from "@/lib/store/types";

type Recorded = Pick<VisitRow, "audio_path" | "audio_parts">;

/** One file of the whole recording, with where its audio starts in the visit. */
export interface RecordingFile {
  path: string;
  /** null: a recording in one file, whose length is in the file itself */
  ms: number | null;
  /** milliseconds of the visit before this file (0 for the first) */
  startMs: number;
}

const isPart = (p: unknown): p is VisitAudioPart => {
  if (typeof p !== "object" || p === null) return false;
  const part = p as Partial<VisitAudioPart>;
  return typeof part.path === "string" && part.path !== "" && typeof part.ms === "number" && Number.isFinite(part.ms) && part.ms >= 0;
};

/** The parts registered on the visit so far, in order, complete or not ([] for a recording in one file, or none). */
export function registeredParts(visit: Recorded): VisitAudioPart[] {
  return Array.isArray(visit.audio_parts) ? visit.audio_parts.filter(isPart).map((p) => ({ path: p.path, ms: p.ms })) : [];
}

/**
 * The parts of a complete recording in several files, or null: the recording is one file, is not complete yet, or is
 * not there. Complete means audio_path names the first part.
 */
export function completeParts(visit: Recorded): VisitAudioPart[] | null {
  const parts = registeredParts(visit);
  return visit.audio_path && parts.length > 0 && parts[0].path === visit.audio_path ? parts : null;
}

/** The whole recording, file by file in order; [] while the server does not hold it (no recording, or parts still arriving). */
export function recordingFiles(visit: Recorded): RecordingFile[] {
  if (!visit.audio_path) return [];
  const parts = completeParts(visit);
  if (!parts) return [{ path: visit.audio_path, ms: null, startMs: 0 }];
  let startMs = 0;
  return parts.map((p) => {
    const file = { path: p.path, ms: p.ms, startMs };
    startMs += p.ms;
    return file;
  });
}

/** The recording's length when the row knows it (a recording in parts), else null (one file: ask the file). */
export function recordingMs(visit: Recorded): number | null {
  const parts = completeParts(visit);
  return parts ? parts.reduce((ms, p) => ms + p.ms, 0) : null;
}

/**
 * Every audio file the row points at, once each: the recording's path and every registered part, complete or not. A
 * part is the visit's from the moment it is registered: the orphan sweep never takes it while the visit lives, his
 * export lists it, and retention removes it with the rest.
 */
export function visitAudioPaths(visit: Recorded): string[] {
  const out: string[] = [];
  if (visit.audio_path) out.push(visit.audio_path);
  for (const p of registeredParts(visit)) if (!out.includes(p.path)) out.push(p.path);
  return out;
}
