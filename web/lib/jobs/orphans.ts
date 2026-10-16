/**
 * Track H's nightly job (C2; docs/plan/real-app.md 3.11 定时任务 「每天新加坡 03:00：孤儿文件、不活跃的示例账号、演示沙盒」):
 * privacy.nightly. Server-only. Registered with the runner when this module loads; ./retention.ts imports it, so
 * lib/jobs/index.ts needs one line.
 *
 * When: the first pass at or after 03:00 Singapore time on a day it has not run yet. "Has run" is read from ops_run (the
 * runner's `due`, lib/jobs/runner.ts), so a restart does not run it again and two instances run it once. A server that
 * was down at 03:00 runs it when it is back. POST /api/dev/tick forces it at any hour (tests, journeys).
 *
 * One pass, in this order:
 *   1. example accounts nobody used for 30 days (real time; never a filming account): deleted the way his own 「删除账号」
 *      deletes (lib/privacy/delete.ts), storage first
 *   2. judge sandboxes past their 48 hours: their rows go (store.deleteExpiredSandboxes; never a filming session, never
 *      an account)
 *   3. orphan files (lib/privacy/sweep.ts, through the BlobStore listing: the same pass on the local driver and on
 *      Supabase Storage): files in a folder no live scope owns (a deleted account, an expired sandbox), and files inside
 *      a live account's folder that no row points at (track C's example reseed and clear, a label photo never
 *      confirmed, a reminder she uploaded and never saved), older than two days. Live prefixes come from
 *      lib/blob/prefix.ts, the uploads' own rule.
 * ops_run gets counts only; the log line is whitelisted (lib/log.ts).
 */
import { getAuthProvider } from "@/lib/auth";
import { getBlobStore } from "@/lib/blob";
import { log } from "@/lib/log";
import { deleteAccountEverywhere } from "@/lib/privacy/delete";
import { idleExampleAccounts } from "@/lib/privacy/retention";
import { sweepOrphans } from "@/lib/privacy/sweep";
import { localDate, localParts } from "@/lib/time/clock";
import { realNowMs } from "@/lib/time/now";
import { registerJob, type JobDefinition } from "./runner";

export const NIGHTLY_JOB = "privacy.nightly";
/** the job's old name (it swept orphan files only); kept as an alias for callers that import it */
export const ORPHANS_JOB = NIGHTLY_JOB;
/** where and when the nightly pass runs (real-app 3.11: 每天新加坡 03:00) */
export const NIGHTLY_TZ = "Asia/Singapore";
export const NIGHTLY_HOUR = 3;
/** a failed pass is tried again no sooner than this */
export const NIGHTLY_RETRY_MS = 60 * 60_000;

/** Due at or after 03:00 Singapore time on a Singapore date it has not (successfully) run on. */
export function nightlyDue(when: { nowMs: number; lastRunMs: number | null }): boolean {
  if (Number(localParts(when.nowMs, NIGHTLY_TZ).time.slice(0, 2)) < NIGHTLY_HOUR) return false;
  // "a different date", not "an earlier one": after the developer test clock is moved back, the job is due again
  return when.lastRunMs === null || localDate(when.lastRunMs, NIGHTLY_TZ) !== localDate(when.nowMs, NIGHTLY_TZ);
}

export const NIGHTLY_JOB_DEF: JobDefinition = {
  name: NIGHTLY_JOB,
  everyMs: NIGHTLY_RETRY_MS,
  leaseS: 1800,
  due: nightlyDue,
  async run(ctx) {
    const blob = getBlobStore();
    const auth = getAuthProvider();
    const total = { idle_examples: 0, idle_failed: 0, sandboxes: 0, sandboxes_failed: 0 };
    // 1. idle example accounts (sign-ins are stamped with the machine's clock, so they are measured on it)
    for (const userId of await idleExampleAccounts(ctx.store, auth, realNowMs())) {
      const r = await deleteAccountEverywhere({ store: ctx.store, auth, blob }, userId, { reason: "example_idle" }).catch(() => null);
      if (r?.ok) total.idle_examples += 1;
      else total.idle_failed += 1;
    }
    // 2. judge sandboxes past their time
    try {
      total.sandboxes = await ctx.store.deleteExpiredSandboxes();
    } catch {
      total.sandboxes_failed = 1;
    }
    // 3. orphan files; file times are the machine's, so the grace period is measured on the machine's clock
    const sweep = await sweepOrphans(ctx.store, blob, { realNowMs: realNowMs() });
    const counts = { ...total, ...sweep };
    log("info", "job.ran", { job: NIGHTLY_JOB, counts });
    return counts;
  },
};
/** the same definition under its old name */
export const ORPHANS_JOB_DEF = NIGHTLY_JOB_DEF;

registerJob(NIGHTLY_JOB_DEF);
