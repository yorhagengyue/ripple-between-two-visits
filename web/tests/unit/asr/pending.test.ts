/**
 * lib/asr/pending.ts (C2 track F; real-app 2.14, 6.8, 8.7 「单元 asr/pending」): once the transcription service answers,
 * a visit waiting for its transcript is sent once, only once; while it is down nothing is sent; the finished job makes
 * the visit's record and tells him 「看诊记录好了」, once per visit; a failed one waits again and is tried again, at most
 * MAX_TRANSCRIPT_SENDS times in all; a visit left "transcribing" by a restart is recovered. Without Whisper nothing
 * happens (never the script).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as openedPost } from "@/app/api/push/opened/route";
import { GET as pushGet } from "@/app/api/push/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { fixtureUtterances, type FileJobInput, type FileJobResult } from "@/lib/asr";
import { DEFAULT_JOB_BUDGET_MS, pendingTranscriptPass, STALE_AFTER_MS, type PendingDeps, type PendingSpeech } from "@/lib/asr/pending";
import { forgetVisitJobs, rememberVisitJob, visitJob } from "@/lib/asr/visit-jobs";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import type { Notice } from "@/lib/jobs/notify";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { setAiConsent } from "@/lib/privacy/ai";
import { VISIT_READY_WORDS } from "@/lib/push/copy";
import { lockScreenProblems, payloadFromNotice } from "@/lib/push/payload";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, startVisit } from "@/lib/visit/pipeline";
import { notifyVisitReady, VISIT_READY } from "@/lib/visit/ready-notice";
import { rememberJob } from "@/lib/visit/state";
import { MAX_TRANSCRIPT_SENDS, TRANSCRIPT_TRY, transcriptTries } from "@/lib/visit/transcript-tries";
import { buildVisitView } from "@/lib/visit/view";
import { encodeWav } from "@/lib/visit/wav";
import { newSession } from "../visit/helpers";

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-pending-"));
  blob = createLocalBlobStore({ dir });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => setTestClock(null));

class FakeWhisper implements PendingSpeech {
  readonly name = "whisper";
  up = false;
  sent: FileJobInput[] = [];
  cancelled: string[] = [];
  results = new Map<string, FileJobResult>();
  async probe() {
    return this.up ? null : "unreachable";
  }
  async createFileJob(input: FileJobInput) {
    this.sent.push(input);
    const jobId = `fake-${randomUUID()}`;
    this.results.set(jobId, { status: "pending" });
    return { jobId };
  }
  async getFileJob(jobId: string) {
    return this.results.get(jobId) ?? { status: "failed" as const, error: "job_lost" };
  }
  async cancelFileJob(jobId: string) {
    this.cancelled.push(jobId);
    this.results.set(jobId, { status: "failed", error: "whisper_unavailable:cancelled" });
    return true;
  }
  finish(jobId: string, ok: boolean) {
    const lines = fixtureUtterances("v1")!;
    this.results.set(
      jobId,
      ok ? { status: "done", source: "audio", utterances: lines.map((u) => ({ tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: null, text: u.text })) } : { status: "failed", error: "whisper_unavailable:timeout" },
    );
  }
  /** finish every job still pending */
  finishAll(ok: boolean) {
    for (const [id, r] of this.results) if (r.status === "pending") this.finish(id, ok);
  }
}

interface Waiting {
  account: TestAccount;
  scope: SessionRow;
  visitId: string;
}

async function waitingVisit(): Promise<Waiting> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `pd${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  const scope = a.scope!;
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const audioPath = `${blobPrefix(scope)}/visits/${visit.id}/recording-${randomUUID().slice(0, 8)}.wav`;
  await blob.putObject("audio", audioPath, encodeWav(new Float32Array(16_000 * 2), 16_000), "audio/wav");
  await store.updateVisit(scope.id, visit.id, { status: "awaiting_transcript", audio_path: audioPath });
  return { account: a, scope, visitId: visit.id };
}

/** One pass with the notices collected (the memory store is shared by this file's tests: notices of other visits too). */
function collector(whisper: FakeWhisper, extra: Partial<PendingDeps> = {}) {
  const notices: Notice[] = [];
  const pass = () =>
    pendingTranscriptPass(store, {
      speech: whisper,
      blob,
      send: async (n) => {
        notices.push(n);
        return { sent: 1 };
      },
      ...extra,
    });
  return { notices, pass, of: (visitId: string) => notices.filter((n) => n.url.includes(visitId)) };
}

const statusOf = async (w: Waiting) => (await store.getVisit(w.scope.id, w.visitId))?.status;
/** the visit.transcribed events of his scope (real-app 6.13: the transcript arrived after the visit) */
const transcribed = (w: Waiting) => getBus().recent(w.scope.id).filter((e) => e.type === "visit.transcribed");
const readyRows = async (w: Waiting) => (await store.listDeliveries(w.scope.id)).filter((d) => d.kind === VISIT_READY && d.ref === w.visitId);

function req(pathname: string, method: string, a: TestAccount, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { cookie: `rp_at=${a.tokens.access_token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("visits waiting for their transcript", () => {
  it("nothing without Whisper", async () => {
    const w = await waitingVisit();
    const counts = await pendingTranscriptPass(store, { speech: null, blob });
    expect(counts.sent).toBe(0);
    expect(await statusOf(w)).toBe("awaiting_transcript");
  });

  it("down: nothing is sent; up: sent once, only once; done: the record; failed: waiting again", async () => {
    const whisper = new FakeWhisper();
    const { pass } = collector(whisper);
    const w = await waitingVisit();
    let counts = await pass();
    expect(counts).toMatchObject({ sent: 0, unavailable: 1 });
    expect(whisper.sent).toHaveLength(0);
    // the service being down is not an attempt
    expect(transcriptTries(await store.listDeliveries(w.scope.id), w.visitId)).toBe(0);

    whisper.up = true;
    counts = await pass();
    // (the memory store is shared by this file's tests: other waiting visits are sent too)
    expect(counts.sent).toBeGreaterThanOrEqual(1);
    expect(whisper.sent.every((i) => i.recorded === true && i.audio instanceof Uint8Array)).toBe(true);
    expect(await statusOf(w)).toBe("transcribing");
    const before = whisper.sent.length;
    await pass();
    expect(whisper.sent.length).toBe(before); // never twice while its job is pending

    // the service fails the job: it waits again, and is sent again on a later pass
    whisper.finishAll(false);
    await pass();
    expect(await statusOf(w)).toBe("awaiting_transcript");

    await pass();
    expect(await statusOf(w)).toBe("transcribing");
    whisper.finishAll(true);
    await pass();
    expect(await statusOf(w)).toBe("review");
    expect((await store.listUtterances(w.scope.id, w.visitId)).filter((u) => u.lang !== "x-superseded")).toHaveLength(12);
    expect(transcriptTries(await store.listDeliveries(w.scope.id), w.visitId)).toBe(2);
  });
});

describe("「看诊记录好了」: the notice when a waiting visit has its record", () => {
  it("sent once, right after the record is made: a delivery row for the visit, lock-screen words with nothing clinical, the tap lands on its review", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper, { locale: async () => "zh-Hans" });
    const w = await waitingVisit();
    await c.pass();
    expect(await statusOf(w)).toBe("transcribing");
    expect(c.of(w.visitId)).toHaveLength(0); // nothing while the job runs
    whisper.finishAll(true);
    // the record is made two days after the visit: the delivery is of the day it is sent
    setTestClock({ at: "2026-10-14T07:10:00+08:00", frozen: true });
    const counts = await c.pass();
    expect(counts.finished).toBeGreaterThanOrEqual(1);
    expect(counts.notified).toBeGreaterThanOrEqual(1);
    expect(await statusOf(w)).toBe("review");

    const scopeNow = (await store.getSession(w.scope.id))!;
    const rows = await readyRows(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "visit_ready", ref: w.visitId, slot: "visit", day: scopeNow.story_day, opened_at: null });
    const mine = c.of(w.visitId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "visit_ready",
      to: { role: "patient", userId: w.account.userId },
      title: "就诊记录已生成",
      body: "请打开 Ripple 确认。",
      url: `/p/visit/${w.visitId}/review`,
      tag: `visit-ready-${w.visitId}`,
      deliveryId: rows[0].id,
      scopeId: w.scope.id,
      locale: "zh-Hans",
    });
    // what the phone receives: the words as they are (they pass the lock-screen rule), the path, the delivery id; no scope id
    const built = payloadFromNotice(mine[0], { medicineNames: ["amlodipine"] });
    expect(built.replaced).toBe(false);
    expect(built.payload).toMatchObject({ kind: "visit_ready", title: "就诊记录已生成", body: "请打开 Ripple 确认。", url: `/p/visit/${w.visitId}/review`, delivery: rows[0].id, renotify: false });
    expect(JSON.stringify(built.payload)).not.toContain(w.scope.id);
    // nothing of the visit is in the words: not a line of it, no number
    const lines = (await store.listUtterances(w.scope.id, w.visitId)).map((u) => u.text);
    for (const l of lines) expect(`${mine[0].title}${mine[0].body}`).not.toContain(l);
    expect(/\d/.test(`${mine[0].title}${mine[0].body}`)).toBe(false);
  });

  it("not again on a later pass, nor when asked again; in English for an account in English", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper, { locale: async () => "en" });
    const w = await waitingVisit();
    await c.pass();
    whisper.finishAll(true);
    await c.pass();
    expect(c.of(w.visitId)).toHaveLength(1);
    expect(c.of(w.visitId)[0]).toMatchObject({ title: "Your visit record is ready", body: "Open Ripple to check it.", locale: "en" });
    // the event visit.transcribed: published with the record, once, with the visit's id and nothing of what was said
    expect(transcribed(w).map((e) => e.data)).toEqual([{ visit_id: w.visitId }]);
    await c.pass();
    await c.pass();
    expect(c.of(w.visitId)).toHaveLength(1);
    expect(await readyRows(w)).toHaveLength(1);
    expect(transcribed(w)).toHaveLength(1);
    // asked again on a later day (a different delivery day): still the one row, nothing sent
    setTestClock({ at: new Date(Date.now() + 3 * 86_400_000).toISOString(), frozen: true });
    const scopeLater = (await store.getSession(w.scope.id))!;
    const again = await notifyVisitReady(store, scopeLater, { id: w.visitId }, { send: async () => ({ sent: 1 }) });
    expect(again).toEqual({ recorded: false, sent: 0 });
    expect(await readyRows(w)).toHaveLength(1);
  });

  it("nothing when the job failed and the visit went back to waiting", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const w = await waitingVisit();
    await c.pass();
    whisper.finishAll(false);
    const counts = await c.pass();
    expect(counts.failed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(w)).toBe("awaiting_transcript");
    expect(c.of(w.visitId)).toHaveLength(0);
    expect(await readyRows(w)).toHaveLength(0);
  });

  it("never for a demo session or a judge sandbox", async () => {
    const demo = await newSession();
    let sent = 0;
    const out = await notifyVisitReady(store, demo, { id: "v1" }, { send: async () => ({ sent: ++sent }) });
    expect(out).toEqual({ recorded: false, sent: 0 });
    expect(sent).toBe(0);
    expect(await store.listDeliveries(demo.id)).toEqual([]);
  });

  it("the tap marks it opened (POST /api/push/opened), and it is listed with his recent reminders", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const w = await waitingVisit();
    await c.pass();
    whisper.finishAll(true);
    await c.pass();
    const [row] = await readyRows(w);
    setTestClock({ at: "2026-10-12T09:41:00+08:00", frozen: true });
    const res = await openedPost(req("/api/push/opened", "POST", w.account, { delivery: row.id }));
    expect(await res.json()).toEqual({ recorded: true, opened_at: "2026-10-12T01:41:00.000Z" });
    const recent = ((await (await pushGet(req("/api/push", "GET", w.account))).json()) as { recent: { kind: string; opened_at: string | null }[] }).recent;
    expect(recent).toContainEqual(expect.objectContaining({ kind: "visit_ready", slot: "visit", opened_at: "2026-10-12T01:41:00.000Z" }));
  });

  it("the words are fixed sentences that pass the lock-screen rule in both languages", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const w = VISIT_READY_WORDS[locale];
      expect(lockScreenProblems(w.title, ["amlodipine", "losartan"])).toEqual([]);
      expect(lockScreenProblems(w.body, ["amlodipine", "losartan"])).toEqual([]);
    }
  });
});

describe("a visit left transcribing", () => {
  it("the server restarted (this process does not know its job): back to waiting and sent again in the same pass, one job only", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const w = await waitingVisit();
    await c.pass();
    expect(await statusOf(w)).toBe("transcribing");
    const first = visitJob(w.scope.id, w.visitId);
    // the web server restarts: the job map is gone, the visit is still "transcribing"
    forgetVisitJobs();
    const sentBefore = whisper.sent.length;
    const counts = await c.pass();
    expect(counts.recovered).toBeGreaterThanOrEqual(1);
    expect(await statusOf(w)).toBe("transcribing");
    const second = visitJob(w.scope.id, w.visitId);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    // this visit was sent exactly once more (other waiting visits of the shared store may be sent too)
    expect(whisper.sent.length).toBeGreaterThan(sentBefore);
    expect(transcriptTries(await store.listDeliveries(w.scope.id), w.visitId)).toBe(2);
    // and never again while that job is pending
    const mark = whisper.sent.length;
    await c.pass();
    expect(whisper.sent.length).toBe(mark);
    whisper.finishAll(true);
    await c.pass();
    expect(await statusOf(w)).toBe("review");
    expect(c.of(w.visitId)).toHaveLength(1);
  });

  it("without a saved recording it is left for his page to end again (nothing to send)", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `pd${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const visit = await startVisit(store, a.scope!, { mode: "record", consent: { given: true } });
    await store.updateVisit(a.scope!.id, visit.id, { status: "transcribing" });
    await c.pass();
    expect((await store.getVisit(a.scope!.id, visit.id))?.status).toBe("transcribing");
  });

  it("a job pending far past its time is stopped and the visit waits again; the next pass sends it, one job at a time", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const t0 = Date.now();
    const c = collector(whisper, { nowMs: t0 });
    const w = await waitingVisit();
    await c.pass();
    const jobId = visitJob(w.scope.id, w.visitId)!;
    // within its time (and a little past it): left alone
    await collector(whisper, { nowMs: t0 + DEFAULT_JOB_BUDGET_MS + STALE_AFTER_MS - 60_000 }).pass();
    expect(whisper.cancelled).not.toContain(jobId);
    expect(await statusOf(w)).toBe("transcribing");
    // far past it: stopped, waiting again, not sent in this same pass
    const late = collector(whisper, { nowMs: t0 + DEFAULT_JOB_BUDGET_MS + STALE_AFTER_MS + 60_000 });
    const counts = await late.pass();
    expect(counts.recovered).toBeGreaterThanOrEqual(1);
    expect(whisper.cancelled).toContain(jobId);
    expect(await statusOf(w)).toBe("awaiting_transcript");
    expect(visitJob(w.scope.id, w.visitId)).toBeNull();
    await late.pass();
    expect(await statusOf(w)).toBe("transcribing");
    expect(visitJob(w.scope.id, w.visitId)).not.toBe(jobId);
  });

  it("a finished job his open page is still waiting for is left to that page; once the page stopped waiting the pass makes the record and tells him", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const w = await waitingVisit();
    // his page sent the recording itself (POST /api/asr/jobs) and waits for the job
    const { jobId } = await whisper.createFileJob({ url: "x", recorded: true, lang: "zh-en-mixed" });
    rememberJob(jobId, { sessionId: w.scope.id, visitId: w.visitId, provider: "whisper" });
    rememberVisitJob(w.scope.id, w.visitId, jobId, 120_000);
    await store.updateVisit(w.scope.id, w.visitId, { status: "transcribing" });
    whisper.finish(jobId, true);
    await c.pass();
    expect(await statusOf(w)).toBe("transcribing"); // the page's to finish
    expect(c.of(w.visitId)).toHaveLength(0);
    expect(transcribed(w)).toHaveLength(0);
    // the page went away: its waiting time has passed
    rememberVisitJob(w.scope.id, w.visitId, jobId, 0);
    await c.pass();
    expect(await statusOf(w)).toBe("review");
    expect(c.of(w.visitId)).toHaveLength(1);
    expect(transcribed(w)).toHaveLength(1);
  });

  it("visit.transcribed is the late transcript only: a record his open page makes itself, and a job that failed, publish none", async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    // his page ends the visit and makes the record itself (POST /api/visits/[id]/finalize): visit.changed, never this event
    const live = await waitingVisit();
    await store.updateVisit(live.scope.id, live.visitId, { status: "transcribing" });
    const lines = fixtureUtterances("v1")!.map((u) => ({ tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: null, text: u.text }));
    await finalizeVisit(store, live.scope, live.visitId, { status: "done", source: "audio", utterances: lines });
    expect(await statusOf(live)).toBe("review");
    expect(transcribed(live)).toHaveLength(0);
    expect(getBus().recent(live.scope.id).some((e) => e.type === "visit.changed")).toBe(true);
    // a later pass does not say it for a record that is already made
    await c.pass();
    expect(transcribed(live)).toHaveLength(0);

    // a job the service failed: waiting again, nothing arrived
    const failed = await waitingVisit();
    await c.pass();
    whisper.finishAll(false);
    await c.pass();
    expect(await statusOf(failed)).toBe("awaiting_transcript");
    expect(transcribed(failed)).toHaveLength(0);
  });
});

describe("each visit is sent a bounded number of times", () => {
  it(`after ${MAX_TRANSCRIPT_SENDS} submissions that failed nothing more is sent: the visit keeps its recording and the review says the text could not be made`, async () => {
    const whisper = new FakeWhisper();
    whisper.up = true;
    const c = collector(whisper);
    const w = await waitingVisit();
    for (let i = 1; i <= MAX_TRANSCRIPT_SENDS; i++) {
      await c.pass(); // sent
      expect(await statusOf(w)).toBe("transcribing");
      expect(transcriptTries(await store.listDeliveries(w.scope.id), w.visitId)).toBe(i);
      whisper.finishAll(false);
      await c.pass(); // failed: waiting again
      expect(await statusOf(w)).toBe("awaiting_transcript");
    }
    const mark = whisper.sent.length;
    const counts = await c.pass();
    expect(counts.gave_up).toBeGreaterThanOrEqual(1);
    await c.pass();
    expect(whisper.sent.length).toBe(mark);
    const visit = (await store.getVisit(w.scope.id, w.visitId))!;
    expect(visit.status).toBe("awaiting_transcript");
    expect(visit.audio_path).toBeTruthy();
    expect(c.of(w.visitId)).toHaveLength(0);
    const tries = (await store.listDeliveries(w.scope.id)).filter((d) => d.kind === TRANSCRIPT_TRY && d.ref === w.visitId);
    expect(tries.map((d) => d.slot).sort()).toEqual(["1", "2", "3"]);
    // his review page: the text could not be made (the recording is still there)
    const view = await buildVisitView(store, w.scope.id, w.visitId);
    expect(view?.account?.transcript).toBe("failed");
    // a visit still within its attempts says "waiting"
    const fresh = await waitingVisit();
    expect((await buildVisitView(store, fresh.scope.id, fresh.visitId))?.account?.transcript).toBe("waiting");
  });
});

describe("his consent to AI processing in the pass", () => {
  function spyLlm(calls: ChatOpts[]): LlmClient {
    return {
      provider: "fake",
      model: "fake-extract",
      async chat(opts: ChatOpts) {
        calls.push(opts);
        return { content: JSON.stringify({ items: [] }), tokens: 1 };
      },
    } as unknown as LlmClient;
  }

  it("off: the record is made by the rules only, no model sees the transcript; on again under 「我」: the next record uses the model", async () => {
    // the memory store is shared by this file's tests: first finish every visit the earlier tests left waiting, so the
    // model calls counted below are this test's visits only
    const sweep = new FakeWhisper();
    sweep.up = true;
    for (let i = 0; i < 4; i++) {
      await collector(sweep).pass();
      sweep.finishAll(true);
    }
    await collector(sweep).pass();

    const whisper = new FakeWhisper();
    whisper.up = true;
    const calls: ChatOpts[] = [];
    const c = collector(whisper, { llm: spyLlm(calls) });

    const off = await waitingVisit();
    await setAiConsent({ store, texts: store }, { userId: off.account.userId, scopeId: off.scope.id, on: false, locale: "zh-Hans" });
    await c.pass();
    whisper.finishAll(true);
    await c.pass();
    expect(await statusOf(off)).toBe("review");
    expect(calls).toHaveLength(0);
    // the rules still found the doctor's lines
    expect((await store.listVisitItems(off.scope.id, { visit_id: off.visitId })).some((i) => i.type === "target")).toBe(true);
    expect(c.of(off.visitId)).toHaveLength(1); // he is still told

    // he turns it on again: the next visit's record is made with the model
    await setAiConsent({ store, texts: store }, { userId: off.account.userId, scopeId: off.scope.id, on: true, locale: "zh-Hans" });
    const audioPath = `${blobPrefix(off.scope)}/visits/second-${randomUUID().slice(0, 8)}.wav`;
    const second = await startVisit(store, off.scope, { mode: "record", consent: { given: true } });
    await blob.putObject("audio", audioPath, encodeWav(new Float32Array(16_000 * 2), 16_000), "audio/wav");
    await store.updateVisit(off.scope.id, second.id, { status: "awaiting_transcript", audio_path: audioPath });
    await c.pass();
    whisper.finishAll(true);
    await c.pass();
    expect((await store.getVisit(off.scope.id, second.id))?.status).toBe("review");
    expect(calls.length).toBeGreaterThan(0);
  });
});
