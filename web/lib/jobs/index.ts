/**
 * The app's scheduled jobs (C2). Importing this module registers every job with the runner (lib/jobs/runner.ts); the
 * server does it once at start-up (instrumentation.ts), so POST /api/dev/tick and the JOBS=1 loop see them all.
 *
 *   track B   daily.doses, daily.bp (lib/jobs/daily.ts)
 *   track F   asr.pending (lib/asr/pending.ts)
 *   track H   privacy.retention (lib/jobs/retention.ts, hourly), privacy.nightly (lib/jobs/orphans.ts, 03:00 Singapore)
 * Other tracks add their job modules here, one import line each (only add).
 *
 * startJobLoop(): with JOBS=1 (the integration build and the real server only; never in a track's worktree) one pass
 * of the due jobs every JOBS_EVERY_MS (default 60 s), each job under its lease, so two servers never run it at once.
 * Runs in the Node.js runtime only.
 */
import "./daily";
// track F: visits waiting for their transcript, sent once Whisper answers (asr.pending)
import "@/lib/asr/pending";
// C2 track I (only add): web push sends the jobs' notices (lib/push/register.ts registers the sender)
import "@/lib/push/register";
// track H: recordings past 90 days, safety events, event history, expired invitations (privacy.retention); idle
// example accounts, expired sandboxes, orphan files (privacy.nightly)
import "./retention";
import { runDueJobs } from "./runner";

export { runDueJobs, registeredJobs } from "./runner";

type GlobalWithLoop = typeof globalThis & { __rippleJobLoop?: ReturnType<typeof setInterval> | null };

/** Start the JOBS=1 loop once per process (a second call does nothing). Returns whether a loop is running. */
export function startJobLoop(env: Record<string, string | undefined> = process.env): boolean {
  const g = globalThis as GlobalWithLoop;
  if ((env.JOBS ?? "").trim() !== "1") return false;
  if (g.__rippleJobLoop) return true;
  const every = Number(env.JOBS_EVERY_MS);
  const ms = Number.isFinite(every) && every >= 5_000 ? every : 60_000;
  let running = false;
  const tick = async () => {
    if (running) return; // a slow pass is never overlapped by the next one
    running = true;
    try {
      await runDueJobs();
    } catch (err) {
      console.warn(`[jobs] pass failed: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    } finally {
      running = false;
    }
  };
  g.__rippleJobLoop = setInterval(() => void tick(), ms);
  g.__rippleJobLoop.unref?.();
  console.log(`[jobs] loop on: every ${Math.round(ms / 1000)} s`);
  return true;
}
