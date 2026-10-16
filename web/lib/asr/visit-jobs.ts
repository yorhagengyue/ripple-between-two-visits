/**
 * Which whole-visit transcript job belongs to which visit (server-only, process memory like the jobs themselves;
 * item 10 of the plan moves both to the database).
 *
 * A page that reopens a visit still "transcribing" asks for its job: when this process has it, the page waits for
 * it again; when it does not (the web server restarted, so the job is gone), the visit goes back to "recording" so
 * "End visit" works again with the recording saved on the visit, instead of a dead end. "End visit" tapped again while
 * the job is still pending gets the same job back (POST /api/asr/jobs), never a second job for the same recording.
 */

interface Entry {
  jobId: string;
  at: number;
  /** when the page stops waiting for it (POST /api/asr/jobs wait_ms after it was created) */
  until: number;
}

const g = globalThis as unknown as { __rippleVisitJobs?: Map<string, Entry> };

function index(): Map<string, Entry> {
  g.__rippleVisitJobs ??= new Map();
  // keep the map small: forget entries older than a day
  const cutoff = Date.now() - 86_400_000;
  for (const [k, e] of g.__rippleVisitJobs) if (e.at < cutoff) g.__rippleVisitJobs.delete(k);
  return g.__rippleVisitJobs;
}

const key = (sessionId: string, visitId: string) => `${sessionId}|${visitId}`;

export function rememberVisitJob(sessionId: string, visitId: string, jobId: string, waitMs = 0): void {
  const at = Date.now();
  index().set(key(sessionId, visitId), { jobId, at, until: at + Math.max(0, waitMs) });
}

export function visitJob(sessionId: string, visitId: string): string | null {
  return index().get(key(sessionId, visitId))?.jobId ?? null;
}

/** How long the page was told to wait for this visit's job from now (0 when that time has passed or no job). */
export function visitJobWaitLeft(sessionId: string, visitId: string): number {
  const e = index().get(key(sessionId, visitId));
  return e ? Math.max(0, e.until - Date.now()) : 0;
}

/**
 * How long past the time it was given this visit's job is (ms; negative while it still has time, null when this
 * process has no job for the visit). lib/asr/pending.ts uses it to tell a job that is far past anything a job can take.
 */
export function visitJobOverdueMs(sessionId: string, visitId: string, nowMs: number = Date.now()): number | null {
  const e = index().get(key(sessionId, visitId));
  return e ? nowMs - e.until : null;
}

/** Forget one visit's job (it was stopped, or it is being sent again). */
export function forgetVisitJob(sessionId: string, visitId: string): void {
  g.__rippleVisitJobs?.delete(key(sessionId, visitId));
}

/** Tests: forget everything (a web server restart). */
export function forgetVisitJobs(): void {
  g.__rippleVisitJobs?.clear();
}
