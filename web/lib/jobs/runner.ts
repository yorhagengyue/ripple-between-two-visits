/**
 * The scheduled jobs' runner (docs/plan/real-app.md 3.11 定时任务; C2 foundation). Server-only.
 *
 * Tracks register their jobs here (track B: reminders and "no reply"; I: push; H: retention, orphans; D: expired
 * invitations); this file only runs them:
 *
 *   registerJob({ name, everyMs, run })      once, at module load of the track's job file
 *   runDueJobs({ force? })                   one pass: each due job (or every job with force) runs when it gets its
 *                                            lease (job_lease, store.acquireJobLease): two server instances never run
 *                                            the same job at once. Each run leaves one ops_run row with counts only.
 *
 * Who calls runDueJobs: POST /api/dev/tick (developer tools: tests and journeys run one pass on demand), and later
 * the JOBS=1 loop in instrumentation.ts (track B). Jobs work on account scopes only; the demo settles on read as
 * before. forEachAccountScope hands a job each account scope with a store bound to it (system mode, lib/subject).
 *
 * lib/jobs is one of the places allowed to use the process-wide store (tests/unit/subject/store-allowlist.test.ts).
 */
import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import type { SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "@/lib/subject/resolve";
import type { Subject } from "@/lib/subject/types";
import { nowMs } from "@/lib/time/now";

export interface JobContext {
  /** the process-wide store (jobs walk every account scope; use forEachAccountScope for each one's own store) */
  store: Store;
  /** epoch ms of this pass (the app's clock: the developer test clock moves it) */
  nowMs: number;
  /** this runner's lease holder name */
  holder: string;
}

export interface JobDefinition {
  name: string;
  /** run at most this often (ms); a forced pass ignores it */
  everyMs: number;
  /** the lease's lifetime (s): longer than the job ever takes */
  leaseS?: number;
  /** counts for ops_run (never a scope id or any content) */
  run(ctx: JobContext): Promise<Record<string, number> | void>;
  /**
   * C2 track H (only add): the job's own schedule, instead of "everyMs after the last run in this process". Asked each
   * pass with the moment of its last successful run, which is read from ops_run, so it holds across a restart and
   * between two server instances (docs/plan/real-app.md 3.11 定时任务: 「每天新加坡 03:00」). A run that failed is not a
   * run: the job is tried again, no sooner than everyMs after the failed try. A forced pass ignores it.
   */
  due?(when: { nowMs: number; lastRunMs: number | null }): boolean;
}

export interface JobRunReport {
  job: string;
  outcome: "ran" | "skipped_not_due" | "skipped_leased" | "failed";
  counts: Record<string, number>;
  error?: string;
}

interface Registry {
  jobs: Map<string, JobDefinition>;
  lastRun: Map<string, number>;
  holder: string;
  /** C2 track H (only add): when a job with its own schedule was last tried here, successful or not */
  lastTry?: Map<string, number>;
}

/** C2 track H (only add): a job's failed run leaves exactly { failed: 1 } in ops_run (see runDueJobs below). */
const isFailedRun = (counts: Record<string, number> | null | undefined): boolean => !!counts && Object.keys(counts).length === 1 && counts.failed === 1;

/** C2 track H (only add): the moment of a job's last successful run as ops_run has it (any instance, any process), or null. */
export async function lastGoodRun(store: Pick<Store, "listOpsRuns">, job: string): Promise<number | null> {
  let last: number | null = null;
  for (const r of await store.listOpsRuns(job)) {
    if (isFailedRun(r.counts)) continue;
    const at = Date.parse(r.started_at);
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  }
  return last;
}

type GlobalWithJobs = typeof globalThis & { __rippleJobs?: Registry };

function registry(): Registry {
  const g = globalThis as GlobalWithJobs;
  g.__rippleJobs ??= { jobs: new Map(), lastRun: new Map(), holder: `runner-${randomUUID().slice(0, 8)}` };
  return g.__rippleJobs;
}

/** Register (or replace, on hot reload) a job. */
export function registerJob(def: JobDefinition): void {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(def.name)) throw new Error(`job name ${def.name}: lower case letters, digits, _ . -`);
  registry().jobs.set(def.name, def);
}

export function registeredJobs(): string[] {
  return [...registry().jobs.keys()].sort();
}

export function unregisterJob(name: string): void {
  registry().jobs.delete(name);
  registry().lastRun.delete(name);
  registry().lastTry?.delete(name);
}

export interface RunOptions {
  store?: Store;
  /** run every (selected) job now, due or not */
  force?: boolean;
  /** only these jobs */
  names?: string[];
  nowMs?: number;
  holder?: string;
}

/** One pass over the registered jobs. Never throws for a job's failure: it is reported and the pass goes on. */
export async function runDueJobs(opts: RunOptions = {}): Promise<JobRunReport[]> {
  const reg = registry();
  const store = opts.store ?? getStore();
  const now = opts.nowMs ?? nowMs();
  const holder = opts.holder ?? reg.holder;
  const reports: JobRunReport[] = [];
  for (const def of [...reg.jobs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (opts.names && !opts.names.includes(def.name)) continue;
    const last = reg.lastRun.get(def.name);
    if (!opts.force && def.due) {
      // C2 track H (only add): a job with its own schedule. This process's memory answers first; only when it says
      // "due" is ops_run asked, where a run by another instance or before a restart shows (and is then remembered).
      reg.lastTry ??= new Map();
      const tried = reg.lastTry.get(def.name);
      let due = !(tried !== undefined && now >= tried && now - tried < def.everyMs) && def.due({ nowMs: now, lastRunMs: last ?? null });
      if (due) {
        const stored = await lastGoodRun(store, def.name).catch(() => null);
        if (stored !== null && (last === undefined || stored > last)) {
          reg.lastRun.set(def.name, stored);
          due = def.due({ nowMs: now, lastRunMs: stored });
        }
      }
      if (!due) {
        reports.push({ job: def.name, outcome: "skipped_not_due", counts: {} });
        continue;
      }
      reg.lastTry.set(def.name, now);
    } else if (!opts.force && last !== undefined && now - last < def.everyMs) {
      reports.push({ job: def.name, outcome: "skipped_not_due", counts: {} });
      continue;
    }
    const lease = `job:${def.name}`;
    if (!(await store.acquireJobLease(lease, holder, def.leaseS ?? 120))) {
      reports.push({ job: def.name, outcome: "skipped_leased", counts: {} });
      continue;
    }
    const startedAt = new Date(now).toISOString();
    try {
      const counts = (await def.run({ store, nowMs: now, holder })) ?? {};
      reg.lastRun.set(def.name, now);
      await store.addOpsRun({ job: def.name, counts, started_at: startedAt, finished_at: new Date(nowMs()).toISOString() }).catch(() => {});
      reports.push({ job: def.name, outcome: "ran", counts });
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 160) : "error";
      console.warn(`[jobs] ${def.name} failed: ${error}`);
      await store.addOpsRun({ job: def.name, counts: { failed: 1 }, started_at: startedAt, finished_at: new Date(nowMs()).toISOString() }).catch(() => {});
      reports.push({ job: def.name, outcome: "failed", counts: { failed: 1 }, error });
    } finally {
      await store.releaseJobLease(lease, holder).catch(() => {});
    }
  }
  return reports;
}

/** Each account scope with a store bound to it (system mode): a job's way to touch one person's records at a time. */
export async function forEachAccountScope(store: Store, fn: (subject: Subject) => Promise<void>): Promise<number> {
  const scopes: SessionRow[] = await store.listAccountScopes();
  for (const scope of scopes) await fn(systemSubject(store, scope));
  return scopes.length;
}

/** The runner's own test job: proves the registry, the lease and ops_run end to end, and touches nothing. */
export const NOOP_JOB: JobDefinition = {
  name: "noop",
  everyMs: 60_000,
  async run() {
    return { ran: 1 };
  },
};

registerJob(NOOP_JOB);
