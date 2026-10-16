/**
 * Track H's scheduled jobs through the foundation's runner (lib/jobs; docs/plan/real-app.md 3.11 保留期限 and 定时任务;
 * journey 15):
 *   privacy.retention (hourly)   recordings and safety events (tests/unit/privacy/retention.test.ts), and here: a
 *                                scope's event history older than 7 days goes (an account's, never a demo session's),
 *                                invitations past their date are marked expired, every consent text gets its row
 *   privacy.nightly              03:00 Singapore time, once a day, across a restart and between two instances (its last
 *                                run is read from ops_run); an example account idle for 30 days of real time is deleted
 *                                the way his own 「删除账号」 deletes (a filming account never), judge sandboxes past their
 *                                time go, and the orphan sweep runs
 * Both are registered by lib/jobs/index.ts; a pass leaves one ops_run row of counts each, never an id.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getBus } from "@/lib/bus";
import { registeredJobs, runDueJobs } from "@/lib/jobs";
import { NIGHTLY_JOB, NIGHTLY_JOB_DEF, ORPHANS_JOB, nightlyDue } from "@/lib/jobs/orphans";
import { BUS_EVENT_KEEP_MS, RETENTION_JOB } from "@/lib/jobs/retention";
import { lastGoodRun, registerJob, unregisterJob, type JobDefinition } from "@/lib/jobs/runner";
import { ALL_CONSENT_TEXTS } from "@/lib/privacy/consents";
import { MemoryStore } from "@/lib/store/memory";

const DAY = 86_400_000;
let dir: string;
const before = process.env.BLOB_LOCAL_DIR;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-jobs-"));
  process.env.BLOB_LOCAL_DIR = dir;
});
afterAll(async () => {
  if (before === undefined) delete process.env.BLOB_LOCAL_DIR;
  else process.env.BLOB_LOCAL_DIR = before;
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
});

async function exampleAccount(store: MemoryStore, lastSeen: string, opts: { filming?: boolean } = {}) {
  const uid = randomUUID();
  await store.createAccount({ user_id: uid, login_kind: "username", username: `ex${uid.slice(0, 8)}` });
  await store.createAccountScope({ user_id: uid, d0: "2026-08-29", example_data: true });
  await store.updateAccount(uid, { last_seen_at: lastSeen });
  if (opts.filming) await store.setFilmingAccount(uid, true);
  return uid;
}

describe("privacy jobs", () => {
  it("lib/jobs registers privacy.retention and privacy.nightly (the old name privacy.orphans is the same job)", () => {
    expect(registeredJobs()).toEqual(expect.arrayContaining([RETENTION_JOB, NIGHTLY_JOB]));
    expect(NIGHTLY_JOB).toBe("privacy.nightly");
    expect(ORPHANS_JOB).toBe(NIGHTLY_JOB);
    expect(registeredJobs()).not.toContain("privacy.orphans");
  });

  it("the nightly pass: the idle example account goes (storage first, zero rows), the fresh one and the filming one stay; an expired sandbox goes; counts only", async () => {
    let now = new Date("2026-10-01T00:00:00.000Z");
    const store = new MemoryStore({ now: () => now });
    const idle = await exampleAccount(store, new Date(Date.now() - 45 * DAY).toISOString());
    const fresh = await exampleAccount(store, new Date(Date.now() - 2 * DAY).toISOString());
    const filming = await exampleAccount(store, new Date(Date.now() - 300 * DAY).toISOString(), { filming: true });
    const sandbox = await store.createSession({ ttl_hours: 48 });
    const crew = await store.createSession({ ttl_hours: null });
    now = new Date("2026-10-04T00:00:00.000Z"); // three days on: the sandbox's 48 hours have passed

    const reports = await runDueJobs({ store, force: true, names: [RETENTION_JOB, NIGHTLY_JOB] });
    const retention = reports.find((r) => r.job === RETENTION_JOB)!;
    // the hourly job no longer deletes accounts: that is the nightly job's (it ran first here: jobs run in name order,
    // so the hourly pass saw the two accounts that are left)
    expect(retention).toMatchObject({ outcome: "ran", counts: { scopes: 2, scope_failed: 0 } });
    expect(retention.counts).not.toHaveProperty("idle_examples");
    const nightly = reports.find((r) => r.job === NIGHTLY_JOB)!;
    expect(nightly).toMatchObject({ outcome: "ran", counts: { idle_examples: 1, idle_failed: 0, sandboxes: 1, sandboxes_failed: 0, folders_failed: 0 } });
    expect(await store.getAccount(idle)).toBeNull();
    expect(await store.getSession(idle)).toBeNull();
    expect(await store.countAccountRows(idle)).toEqual({});
    expect(await store.getAccount(fresh)).not.toBeNull();
    expect(await store.getAccount(filming)).not.toBeNull();
    expect(await store.getSession(sandbox.id)).toBeNull();
    expect(await store.getSession(crew.id)).not.toBeNull();
    const runs = await store.listOpsRuns();
    expect(runs.map((r) => r.job)).toEqual(expect.arrayContaining([RETENTION_JOB, NIGHTLY_JOB, "delete_account"]));
    expect(runs.find((r) => r.job === "delete_account")?.counts).toMatchObject({ idle_example: 1, leftover: 0 });
    for (const id of [idle, sandbox.id]) expect(JSON.stringify(runs)).not.toContain(id);
  });

  it("the hourly pass: event history older than 7 days goes for an account (not for a demo session), expired invitations are marked, consent texts are published", async () => {
    const store = new MemoryStore();
    const uid = randomUUID();
    await store.createAccount({ user_id: uid, login_kind: "username", username: `ev${uid.slice(0, 8)}` });
    await store.createAccountScope({ user_id: uid, d0: "2026-08-29" });
    const demo = await store.createSession();
    // an invitation whose 7 days ran out yesterday, and one still open
    const invite = async (expires: string) => {
      const r = await store.createInvite({ patient_id: uid, invite_token_hash: createHash("sha256").update(randomBytes(16)).digest("hex"), invite_expires_at: expires });
      if (!r.ok) throw new Error(r.code);
      return r.link.id;
    };
    const old = await invite(new Date(Date.now() - DAY).toISOString());
    const open = await invite(new Date(Date.now() + 5 * DAY).toISOString());

    // events carry the machine's time: three made eight days ago, one now, on his channel; old ones on the demo's too
    const bus = getBus();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 8 * DAY });
    for (let i = 0; i < 3; i++) bus.publish(uid, "dose.logged", "an old event", { n: i });
    bus.publish(demo.id, "dose.logged", "the demo's old event", {});
    vi.useRealTimers();
    bus.publish(uid, "dose.logged", "today's event", {});
    expect(bus.recent(uid)).toHaveLength(4);

    const [report] = await runDueJobs({ store, force: true, names: [RETENTION_JOB] });
    expect(report).toMatchObject({ outcome: "ran", counts: { scopes: 1, events: 3, invites_expired: 1, consent_texts: ALL_CONSENT_TEXTS.length, consent_texts_failed: 0, scope_failed: 0 } });
    expect(bus.recent(uid).map((e) => e.say)).toEqual(["today's event"]);
    expect(bus.recent(demo.id)).toHaveLength(1); // jobs only touch account scopes
    expect((await store.getCareLink(old))?.status).toBe("expired");
    expect((await store.getCareLink(open))?.status).toBe("invited");
    for (const t of ALL_CONSENT_TEXTS) expect(await store.getConsentText(t.kind, t.version, t.locale)).toMatchObject({ sha256: t.sha256 });
    expect(BUS_EVENT_KEEP_MS).toBe(7 * DAY);
    // a second pass finds nothing more
    const [again] = await runDueJobs({ store, force: true, names: [RETENTION_JOB] });
    expect(again.counts).toMatchObject({ events: 0, invites_expired: 0 });
    bus.clearHistory(uid);
    bus.clearHistory(demo.id);
  });
});

describe("the nightly schedule: 03:00 Singapore time, once a day", () => {
  const sg = (iso: string) => Date.parse(`${iso}+08:00`);

  it("nightlyDue: not before 03:00; due when it has not run on that Singapore date; not again that day; due the next day at 03:00", () => {
    expect(nightlyDue({ nowMs: sg("2026-10-10T02:59:00"), lastRunMs: null })).toBe(false);
    expect(nightlyDue({ nowMs: sg("2026-10-10T03:00:00"), lastRunMs: null })).toBe(true);
    expect(nightlyDue({ nowMs: sg("2026-10-10T03:00:00"), lastRunMs: sg("2026-10-09T03:00:10") })).toBe(true);
    expect(nightlyDue({ nowMs: sg("2026-10-10T03:01:00"), lastRunMs: sg("2026-10-10T03:00:10") })).toBe(false);
    expect(nightlyDue({ nowMs: sg("2026-10-10T23:59:00"), lastRunMs: sg("2026-10-10T03:00:10") })).toBe(false);
    expect(nightlyDue({ nowMs: sg("2026-10-11T00:30:00"), lastRunMs: sg("2026-10-10T03:00:10") })).toBe(false);
    expect(nightlyDue({ nowMs: sg("2026-10-11T03:00:00"), lastRunMs: sg("2026-10-10T03:00:10") })).toBe(true);
    // a server that was down at 03:00 catches up when it is back
    expect(nightlyDue({ nowMs: sg("2026-10-10T14:20:00"), lastRunMs: sg("2026-10-09T03:00:10") })).toBe(true);
    // 03:00 in Singapore is 19:00 UTC the day before: the date is Singapore's, not UTC's
    expect(nightlyDue({ nowMs: Date.parse("2026-10-09T19:00:00.000Z"), lastRunMs: Date.parse("2026-10-08T19:00:05.000Z") })).toBe(true);
    expect(nightlyDue({ nowMs: Date.parse("2026-10-09T18:59:00.000Z"), lastRunMs: Date.parse("2026-10-08T19:00:05.000Z") })).toBe(false);
    // the developer test clock moved back to an earlier day: due again
    expect(nightlyDue({ nowMs: sg("2026-10-10T09:00:00"), lastRunMs: sg("2026-12-01T03:00:10") })).toBe(true);
    expect(NIGHTLY_JOB_DEF.due).toBe(nightlyDue);
  });

  it("through the runner: one run a day at 03:00, not again after a restart or on a second instance; a failed run is tried again an hour later", async () => {
    const store = new MemoryStore();
    const name = `t-nightly-${randomUUID().slice(0, 8)}`;
    let runs = 0;
    let fail = false;
    const def: JobDefinition = {
      name,
      everyMs: 60 * 60_000,
      due: nightlyDue,
      run: async () => {
        runs += 1;
        if (fail) throw new Error("storage down");
        return { swept: 1 };
      },
    };
    registerJob(def);
    const pass = async (iso: string) => (await runDueJobs({ store, names: [name], nowMs: sg(iso) }))[0].outcome;
    try {
      expect(await pass("2026-10-10T02:30:00")).toBe("skipped_not_due");
      expect(await pass("2026-10-10T03:00:00")).toBe("ran");
      expect(await pass("2026-10-10T03:01:00")).toBe("skipped_not_due");
      expect(await pass("2026-10-10T15:00:00")).toBe("skipped_not_due");
      expect(runs).toBe(1);
      expect(await lastGoodRun(store, name)).toBe(sg("2026-10-10T03:00:00"));

      // a restart (or a second instance): the process remembers nothing, ops_run does
      unregisterJob(name);
      registerJob(def);
      expect(await pass("2026-10-10T15:05:00")).toBe("skipped_not_due");
      expect(await pass("2026-10-11T02:59:00")).toBe("skipped_not_due");
      expect(runs).toBe(1);

      // the next night it fails: tried again an hour later, not every minute; the failed row is not a run
      fail = true;
      expect(await pass("2026-10-11T03:00:00")).toBe("failed");
      expect(await pass("2026-10-11T03:01:00")).toBe("skipped_not_due");
      expect(await pass("2026-10-11T03:59:00")).toBe("skipped_not_due");
      expect(await lastGoodRun(store, name)).toBe(sg("2026-10-10T03:00:00"));
      fail = false;
      expect(await pass("2026-10-11T04:00:00")).toBe("ran");
      expect(await pass("2026-10-11T05:30:00")).toBe("skipped_not_due");
      expect(runs).toBe(3);

      // a forced pass (POST /api/dev/tick) runs it at any hour
      expect((await runDueJobs({ store, names: [name], force: true, nowMs: sg("2026-10-11T12:00:00") }))[0].outcome).toBe("ran");
      const rows = await store.listOpsRuns(name);
      expect(rows.map((r) => r.counts)).toEqual([{ swept: 1 }, { failed: 1 }, { swept: 1 }, { swept: 1 }]);
    } finally {
      unregisterJob(name);
    }
  });
});
