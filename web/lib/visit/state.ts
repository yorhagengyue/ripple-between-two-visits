/**
 * Per-visit live state that has no column in spec section 3 (kept in process memory on globalThis, like the
 * memory store and the bus): the realtime replay stream, the filming-only scripted-fallback switch, the
 * script lines already used by the fallback, the card ids already announced, and speech jobs.
 *
 * Conventions on stored rows (the Store has no delete for utterances or items):
 *   - an utterance replaced by the whole-visit transcript gets lang = SUPERSEDED_LANG and is hidden;
 *   - an item no longer produced by extraction gets slots.superseded = true and is hidden;
 *   - an item he marked "not right" gets slots.rejected = true.
 *
 * Server-only.
 */

import type { LiveSpeakers } from "./live-speakers";

export const SUPERSEDED_LANG = "x-superseded";

export interface StreamState {
  generation: number;
  state: "running" | "ended";
  fixture: string;
  speed: number;
  startedAt: number;
  source: "replay" | "live";
}

interface VisitLive {
  stream: StreamState | null;
  fallbackOn: boolean;
  usedScript: Set<string>;
  knownCards: Set<string>;
  /**
   * Who is speaking in this recording (lib/visit/live-speakers.ts, scene 1 of 10-15): the voices of its lines and the
   * votes of their words. null until a line with a voice print comes; a new recording starts without it.
   */
  speakers?: LiveSpeakers | null;
}

interface JobOwner {
  sessionId: string;
  visitId: string;
  provider: string;
  createdAt: number;
}

interface Registry {
  visits: Map<string, VisitLive>;
  jobs: Map<string, JobOwner>;
  generation: number;
}

const g = globalThis as unknown as { __rippleVisitLive?: Registry };

function registry(): Registry {
  g.__rippleVisitLive ??= { visits: new Map(), jobs: new Map(), generation: 0 };
  return g.__rippleVisitLive;
}

// C2 follow-up (track E, real-app 5.2 "one gate"): the per-session unlock of the scripted fallback and its counter of
// wrong keys lived here (fallbackUnlocked, keyFailures). They are gone: the switch asks lib/crew/gate.ts isCrew(req)
// and lib/visit/fallback.ts filmingSession, and wrong keys are counted once, in lib/session/crew-key.ts.

const key = (sessionId: string, visitId: string) => `${sessionId}|${visitId}`;

export function visitLive(sessionId: string, visitId: string): VisitLive {
  const r = registry();
  let v = r.visits.get(key(sessionId, visitId));
  if (!v) {
    v = { stream: null, fallbackOn: false, usedScript: new Set(), knownCards: new Set() };
    r.visits.set(key(sessionId, visitId), v);
  }
  return v;
}

/** A new stream for the visit; any earlier stream of the same visit stops at its next step. */
export function beginStream(sessionId: string, visitId: string, s: Omit<StreamState, "generation" | "state">): StreamState {
  const r = registry();
  const live = visitLive(sessionId, visitId);
  live.stream = { ...s, generation: ++r.generation, state: "running" };
  live.knownCards = new Set();
  live.usedScript = new Set();
  return live.stream;
}

export function isCurrentStream(sessionId: string, visitId: string, generation: number): boolean {
  return visitLive(sessionId, visitId).stream?.generation === generation;
}

export function stopStream(sessionId: string, visitId: string): void {
  const live = visitLive(sessionId, visitId);
  if (live.stream) live.stream = { ...live.stream, generation: ++registry().generation, state: "ended" };
}

/** Forget everything about a visit's live state (new recording, reset). */
export function clearVisitLive(sessionId: string, visitId: string): void {
  const live = visitLive(sessionId, visitId);
  if (live.stream) live.stream = { ...live.stream, generation: ++registry().generation, state: "ended" };
  live.stream = null;
  live.knownCards = new Set();
  live.usedScript = new Set();
  live.speakers = null;
}

export function rememberJob(jobId: string, owner: Omit<JobOwner, "createdAt">): void {
  const r = registry();
  r.jobs.set(jobId, { ...owner, createdAt: Date.now() });
  // keep the map small: drop jobs older than a day
  const cutoff = Date.now() - 86_400_000;
  for (const [id, j] of r.jobs) if (j.createdAt < cutoff) r.jobs.delete(id);
}

export function jobOwner(jobId: string): JobOwner | null {
  return registry().jobs.get(jobId) ?? null;
}
