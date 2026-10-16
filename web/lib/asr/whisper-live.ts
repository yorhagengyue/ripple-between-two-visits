/**
 * Per-visit state of the live Whisper captions (server-only, process memory like lib/visit/state.ts; item 10
 * of the plan moves it to the database for several instances):
 *   - whether the visit fell back to the replay (and why), so asr.fallback is published once per visit and
 *     later chunks are refused instead of hammering a dead service;
 *   - whether the full transcript already fell back once (asr.fallback during "file" is published once per
 *     visit, however often End visit is tapped while the service is down);
 *   - consecutive chunk failures (one slow chunk is not a fallback; two in a row are);
 *   - since when the service has answered "busy" without a success in between (a busy spell longer than
 *     WHISPER_BUSY_FALLBACK_MS is a fallback, not a silent loss of captions);
 *   - the text heard so far per live line (asr.partial carries the whole line so far to every device);
 *   - requests in flight per session (a client cannot queue unbounded work on the GPU).
 */

import { joinTexts } from "./whisper";

export interface LiveLine {
  parts: Map<number, string>;
  startMs: number;
  lang: string | null;
  closed: boolean;
  touchedAt: number;
}

export interface WhisperLive {
  fellBack: { reason: string; during: "start" | "live" | "file"; at: number } | null;
  /** the full transcript fell back (asr.fallback during "file" was published) */
  fileFellBack: { reason: string; at: number } | null;
  failStreak: number;
  /** wall time of the first "busy" answer since the last success (null = not busy) */
  busySince: number | null;
  okChunks: number;
  lines: Map<string, LiveLine>;
  lastLang: string | null;
}

interface Registry {
  visits: Map<string, WhisperLive>;
  inFlight: Map<string, number>;
}

const g = globalThis as unknown as { __rippleWhisperLive?: Registry };

function registry(): Registry {
  g.__rippleWhisperLive ??= { visits: new Map(), inFlight: new Map() };
  return g.__rippleWhisperLive;
}

const key = (sessionId: string, visitId: string) => `${sessionId}|${visitId}`;

export function whisperLive(sessionId: string, visitId: string): WhisperLive {
  const r = registry();
  let v = r.visits.get(key(sessionId, visitId));
  if (!v) {
    v = { fellBack: null, fileFellBack: null, failStreak: 0, busySince: null, okChunks: 0, lines: new Map(), lastLang: null };
    r.visits.set(key(sessionId, visitId), v);
  }
  return v;
}

/** A new recording of the visit starts clean. */
export function resetWhisperLive(sessionId: string, visitId: string): void {
  registry().visits.delete(key(sessionId, visitId));
}

/** Mark the visit as fallen back; true the first time (publish asr.fallback then), false after. */
export function markFallback(sessionId: string, visitId: string, reason: string, during: "start" | "live" | "file"): boolean {
  const v = whisperLive(sessionId, visitId);
  if (v.fellBack) return false;
  v.fellBack = { reason, during, at: Date.now() };
  return true;
}

/** The full transcript of this visit fell back; true the first time (publish asr.fallback during "file"), false after. */
export function markFileFallback(sessionId: string, visitId: string, reason: string): boolean {
  const v = whisperLive(sessionId, visitId);
  if (v.fileFellBack) return false;
  v.fileFellBack = { reason, at: Date.now() };
  return true;
}

/** The caption of a live line so far: its chunk texts in order. */
export function lineText(line: LiveLine): string {
  return joinTexts([...line.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t));
}

export function liveLine(state: WhisperLive, lineId: string, startMs: number): LiveLine {
  let line = state.lines.get(lineId);
  if (!line) {
    line = { parts: new Map(), startMs, lang: null, closed: false, touchedAt: Date.now() };
    state.lines.set(lineId, line);
    // keep the map small: forget lines untouched for 10 minutes
    const cutoff = Date.now() - 600_000;
    for (const [id, l] of state.lines) if (l.touchedAt < cutoff) state.lines.delete(id);
  }
  line.touchedAt = Date.now();
  return line;
}

export const MAX_IN_FLIGHT_PER_SESSION = 4;

/** Take a slot for a request of this session; false when it already has the maximum in flight. */
export function acquireSlot(sessionId: string): boolean {
  const r = registry();
  const n = r.inFlight.get(sessionId) ?? 0;
  if (n >= MAX_IN_FLIGHT_PER_SESSION) return false;
  r.inFlight.set(sessionId, n + 1);
  return true;
}

export function releaseSlot(sessionId: string): void {
  const r = registry();
  const n = (r.inFlight.get(sessionId) ?? 1) - 1;
  if (n <= 0) r.inFlight.delete(sessionId);
  else r.inFlight.set(sessionId, n);
}
