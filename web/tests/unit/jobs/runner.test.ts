/**
 * The scheduled jobs' runner (lib/jobs/runner.ts; C2 F1 item H): a registry, one lease per job so two server instances
 * never run it at once, one ops_run row of counts per run, a failure reported without stopping the pass, and each
 * account scope handed to a job with a store bound to it.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { forEachAccountScope, NOOP_JOB, registeredJobs, registerJob, runDueJobs, unregisterJob, type JobDefinition } from "@/lib/jobs/runner";
import { getMemoryStore } from "@/lib/store/memory";
import { ScopeViolation } from "@/lib/subject";

const store = getMemoryStore();
const added: string[] = [];
function job(def: Partial<JobDefinition> & { name: string }): JobDefinition {
  const full: JobDefinition = { everyMs: 60_000, run: async () => ({ done: 1 }), ...def };
  registerJob(full);
  added.push(full.name);
  return full;
}

afterEach(() => {
  for (const n of added.splice(0)) unregisterJob(n);
  vi.restoreAllMocks();
});

describe("the registry", () => {
  it("the runner's own no-op job is registered; names are lower case words", () => {
    expect(registeredJobs()).toContain(NOOP_JOB.name);
    expect(() => registerJob({ name: "Bad Name", everyMs: 1, run: async () => {} })).toThrow();
    expect(() => registerJob({ name: "x", everyMs: 1, run: async () => {} })).toThrow();
  });
});

describe("a pass", () => {
  it("a forced pass runs the job, holds its lease while it runs and leaves one ops_run row of counts", async () => {
    let leasedDuringRun: boolean | null = null;
    job({
      name: "t-lease",
      run: async () => {
        leasedDuringRun = !(await store.acquireJobLease("job:t-lease", "someone-else", 60));
        return { touched: 3 };
      },
    });
    const before = (await store.listOpsRuns("t-lease")).length;
    const reports = await runDueJobs({ store, force: true, names: ["t-lease"] });
    expect(reports).toEqual([{ job: "t-lease", outcome: "ran", counts: { touched: 3 } }]);
    expect(leasedDuringRun).toBe(true);
    const runs = await store.listOpsRuns("t-lease");
    expect(runs.length).toBe(before + 1);
    expect(runs.at(-1)).toMatchObject({ job: "t-lease", counts: { touched: 3 } });
    // released afterwards
    expect(await store.acquireJobLease("job:t-lease", "someone-else", 60)).toBe(true);
    await store.releaseJobLease("job:t-lease", "someone-else");
  });

  it("not forced: a job that ran less than everyMs ago waits", async () => {
    const run = vi.fn(async () => ({}));
    job({ name: "t-due", everyMs: 60_000, run });
    const t0 = Date.now();
    await runDueJobs({ store, force: true, names: ["t-due"], nowMs: t0 });
    expect((await runDueJobs({ store, names: ["t-due"], nowMs: t0 + 30_000 }))[0].outcome).toBe("skipped_not_due");
    expect((await runDueJobs({ store, names: ["t-due"], nowMs: t0 + 61_000 }))[0].outcome).toBe("ran");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("two runners never run the same job at once: the second one skips it", async () => {
    const run = vi.fn(async () => ({}));
    job({ name: "t-held", run });
    expect(await store.acquireJobLease("job:t-held", "other-instance", 60)).toBe(true);
    expect(await runDueJobs({ store, force: true, names: ["t-held"] })).toEqual([{ job: "t-held", outcome: "skipped_leased", counts: {} }]);
    expect(run).not.toHaveBeenCalled();
    await store.releaseJobLease("job:t-held", "other-instance");
    expect((await runDueJobs({ store, force: true, names: ["t-held"] }))[0].outcome).toBe("ran");
  });

  it("a failing job is reported and counted as failed, its lease released, and the pass goes on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    job({
      name: "t-fail-a",
      run: async () => {
        throw new Error("boom");
      },
    });
    job({ name: "t-fail-b", run: async () => ({ ok: 1 }) });
    const reports = await runDueJobs({ store, force: true, names: ["t-fail-a", "t-fail-b"] });
    expect(reports).toEqual([
      { job: "t-fail-a", outcome: "failed", counts: { failed: 1 }, error: "boom" },
      { job: "t-fail-b", outcome: "ran", counts: { ok: 1 } },
    ]);
    expect((await store.listOpsRuns("t-fail-a")).at(-1)?.counts).toEqual({ failed: 1 });
    expect(await store.acquireJobLease("job:t-fail-a", "someone-else", 60)).toBe(true);
    await store.releaseJobLease("job:t-fail-a", "someone-else");
  });

  it("names picks the jobs", async () => {
    job({ name: "t-pick-a" });
    job({ name: "t-pick-b" });
    const reports = await runDueJobs({ store, force: true, names: ["t-pick-b"] });
    expect(reports.map((r) => r.job)).toEqual(["t-pick-b"]);
  });
});

describe("forEachAccountScope", () => {
  it("hands a job every account scope, never a demo session, each with a store bound to that scope alone", async () => {
    const demo = await store.createSession({ ttl_hours: 1 });
    const auth = getAuthProvider();
    const a = await createAccountWithSpace(store, auth, { login: `j${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const b = await createAccountWithSpace(store, auth, { login: `j${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const seen: string[] = [];
    let crossed = 0;
    const n = await forEachAccountScope(store, async (subject) => {
      expect(subject).toMatchObject({ kind: "account", relation: "system", userId: null });
      seen.push(subject.scope.id);
      const other = subject.scope.id === a.userId ? b.userId : a.userId;
      try {
        await subject.store.listDoses(other);
      } catch (err) {
        if (err instanceof ScopeViolation) crossed += 1;
      }
    });
    expect(seen).toContain(a.userId);
    expect(seen).toContain(b.userId);
    expect(seen).not.toContain(demo.id);
    expect(n).toBe(seen.length);
    expect(crossed).toBe(seen.length);
  });
});
