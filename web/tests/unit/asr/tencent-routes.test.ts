/**
 * SPEECH_PROVIDER=tencent on an account's visit, against the fake Tencent ASR (./fake-tencent.ts): the realtime token
 * says tencent with whole lines only (partials false, a longer delay before "late"); a partial chunk is answered at once
 * and sent nowhere; a final is one recognition task and stores the line in his scope; one failed line is tried again
 * (the line opens again), a second failure in a row stops the captions with no replay; a refused key pair stops them at
 * once; 「录完了」 gives the recording's transcript from the pieces, and the review; the service down at the end leaves
 * the saved recording waiting, and lib/asr/pending.ts sends it once the service answers; cancelling keeps the live lines;
 * /api/asr/health and /api/health say tencent and what is missing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as chunkPOST } from "@/app/api/asr/chunk/route";
import { GET as asrHealthGET } from "@/app/api/asr/health/route";
import { DELETE as asrJobDELETE, GET as asrJobGET } from "@/app/api/asr/jobs/[id]/route";
import { POST as asrJobsPOST } from "@/app/api/asr/jobs/route";
import { POST as tokenPOST } from "@/app/api/asr/realtime-token/route";
import { POST as finalizePOST } from "@/app/api/visits/[id]/finalize/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { TencentSpeechProvider } from "@/lib/asr";
import { pendingTranscriptPass } from "@/lib/asr/pending";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, getBlobStore } from "@/lib/blob";
import { getBus, type BusEvent } from "@/lib/bus";
import { healthReport } from "@/lib/ops/health";
import { getMemoryStore } from "@/lib/store/memory";
import type { VisitView } from "@/lib/visit/types";
import { encodeWav } from "@/lib/visit/wav";
import { fakeConfig, fakeTencent, type FakeTencent } from "./fake-tencent";

const BASE = "http://localhost:3200";
const saved = { ...process.env };
const store = getMemoryStore();
let dir: string;
let fake: FakeTencent;
let provider: TencentSpeechProvider;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-tencent-routes-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  process.env.MOCK_ASR_JOB_MS = "0";
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.SPEECH_PROVIDER = "tencent";
  fake = fakeTencent();
  provider = new TencentSpeechProvider({ config: fakeConfig(), fetch: fake.fetch, sleep: async () => {} });
  const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
  g.__rippleSpeech ??= new Map();
  g.__rippleSpeech.set("tencent", provider);
});
afterEach(() => {
  delete process.env.SPEECH_PROVIDER;
  (globalThis as unknown as { __rippleSpeech?: Map<string, unknown> }).__rippleSpeech?.delete("tencent");
});

async function him(): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: `t${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
}

function req(method: string, url: string, a: TestAccount, body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${url}`, {
    method,
    headers: { cookie: `rp_at=${a.tokens.access_token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function chunkReq(a: TestAccount, visitId: string, opts: { kind: "chunk" | "final"; line: string; offset?: number }): NextRequest {
  const q = new URLSearchParams({ visit_id: visitId, kind: opts.kind, line: opts.line, offset_ms: String(opts.offset ?? 1000), seq: "1" });
  return new NextRequest(`${BASE}/api/asr/chunk?${q}`, {
    method: "POST",
    headers: { "content-type": "audio/wav", cookie: `rp_at=${a.tokens.access_token}` },
    body: encodeWav(new Float32Array(16_000 * 3).fill(0.02)).buffer as ArrayBuffer,
  });
}

async function startRecording(a: TestAccount): Promise<string> {
  const res = await visitsPOST(req("POST", "/api/visits", a, { mode: "record", consent: { given: true }, place: "clinic" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { view: VisitView }).view.visit.id;
}

async function upload(a: TestAccount, visitId: string, seconds = 3): Promise<string> {
  const scope = (await store.getSession(a.userId))!;
  const p = `${blobPrefix(scope)}/visits/${visitId}/recording-test.wav`;
  await getBlobStore().putObject("audio", p, encodeWav(new Float32Array(16_000 * seconds).fill(0.02)), "audio/wav");
  return p;
}

async function settle(a: TestAccount, jobId: string, visitId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 300; i++) {
    const st = (await (await asrJobGET(req("GET", `/api/asr/jobs/${jobId}?visit_id=${visitId}`, a), params(jobId))).json()) as Record<string, unknown>;
    if (st.status !== "pending") return st;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the job is still pending");
}

function events(sessionId: string, type: string): BusEvent[] {
  return getBus()
    .recent(sessionId)
    .filter((e) => e.type === type);
}

describe("live lines with Tencent", () => {
  it("the token says tencent, whole lines only; a partial chunk is sent nowhere; a final stores the line in his scope", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const tok = (await (await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }))).json()) as Record<string, unknown>;
    expect(tok).toMatchObject({ provider: "tencent", partials: false, delay_ms: 6000, replay: null, live: { lineGapMs: 550, maxLineMs: 15_000 } });
    // the check before it recognised nothing
    expect(fake.calls.map((c) => [c.action, c.body.TaskId])).toEqual([["DescribeTaskStatus", 1]]);

    const chunk = await chunkPOST(chunkReq(a, visitId, { kind: "chunk", line: `${visitId}-wt-1` }));
    expect(chunk.status).toBe(200);
    expect(await chunk.json()).toEqual({ kind: "chunk", line: `${visitId}-wt-1`, ignored: "no_partials" });
    expect(fake.calls.filter((c) => c.action === "CreateRecTask")).toHaveLength(0);

    const final = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1`, offset: 49_400 }));
    expect(final.status).toBe(200);
    const body = (await final.json()) as { utterances: { id: string; text: string; lang: string; t_start_ms: number }[]; model: string };
    expect(body.utterances.map((u) => [u.id, u.text, u.lang, u.t_start_ms])).toEqual([[`${visitId}-wt-1`, "Please don't change the dose yourself.", "en", 49_400]]);
    expect(body.model).toBe("tencent:16k_zh_en");
    expect((await store.listUtterances(a.userId, visitId)).map((u) => u.id)).toEqual([`${visitId}-wt-1`]);
    expect(fake.calls.filter((c) => c.action === "CreateRecTask")).toHaveLength(1);
  });

  it("one failed line is tried again (the line opens again); a second failure in a row stops the captions, with no replay", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }));
    fake.failCreates = { code: "InternalError", times: 1 };
    const first = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1` }));
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ error: "asr_unavailable", fallback: false, reason: "http_503_InternalError" });
    // the page sends the same line again: taken, stored
    const retry = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1` }));
    expect(retry.status).toBe(200);
    expect((await store.listUtterances(a.userId, visitId)).map((u) => u.id)).toEqual([`${visitId}-wt-1`]);

    fake.errorFor.CreateRecTask = "InternalError";
    expect((await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-2` }))).status).toBe(503);
    const second = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-3` }));
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({ fallback: true, replay: null });
    const fell = events(a.userId, "asr.fallback").filter((e) => (e.data as { visit_id?: string }).visit_id === visitId);
    expect(fell.map((e) => (e.data as { provider?: string; during?: string }).provider)).toEqual(["tencent"]);
    expect(fell[0].say).toContain("Tencent speech recognition did not answer");
    expect((await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-4` }))).status).toBe(409);
  });

  it("a key pair the service refuses stops the captions at once (waiting will not fix it)", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }));
    fake.errorFor.CreateRecTask = "AuthFailure.SecretIdNotFound";
    const res = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1` }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ fallback: true, reason: "unauthorized" });
  });

  it("the service not ready when he starts: no captions this time, the recording goes on", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    fake.errorFor.DescribeTaskStatus = "FailedOperation.UserNotRegistered";
    const tok = (await (await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }))).json()) as Record<string, unknown>;
    expect(tok).toMatchObject({ provider: "mock", fallback: { reason: "not_configured:service_not_enabled", replay: null } });
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("recording");
  });
});

describe("录完了 with Tencent", () => {
  it("the recording's transcript from the service, then the review; the page is given time for every piece", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const audioPath = await upload(a, visitId);
    fake.sentencesFor = () => [
      { text: "Doctor, can I record? My daughter wants me to use this app.", startMs: 100, endMs: 2000 },
      { text: "医生，我家里那个机器是绑手腕的，可以用吗？", startMs: 2800, endMs: 2950 },
    ];
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: audioPath }))).json()) as { job_id: string; wait_ms: number };
    expect(job.wait_ms).toBe(provider.budgetMs(encodeWav(new Float32Array(16_000 * 3))) + 30_000);
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "done", source: "audio", model: "tencent:16k_zh_en" });
    const fin = await finalizePOST(req("POST", `/api/visits/${visitId}/finalize`, a, { job_id: job.job_id }), params(visitId));
    expect(fin.status).toBe(200);
    const view = ((await fin.json()) as { view: VisitView }).view;
    expect(view.visit.status).toBe("review");
    expect(view.lines.map((l) => l.text)).toEqual(["Doctor, can I record? My daughter wants me to use this app.", "医生，我家里那个机器是绑手腕的，可以用吗？"]);
  });

  it("the service down at the end: the saved recording waits for its text; asr.pending sends it once the service answers", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const audioPath = await upload(a, visitId);
    fake.network = "down";
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: audioPath }))).json()) as { job_id: string };
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "failed", deferred: true, awaiting_transcript: true });
    expect(await store.getVisit(a.userId, visitId)).toMatchObject({ status: "awaiting_transcript", audio_path: audioPath });
    const fell = events(a.userId, "asr.fallback").filter((e) => (e.data as { during?: string }).during === "file");
    expect(fell.at(-1)?.data).toMatchObject({ provider: "tencent", reason: "unreachable", used: "none", audio_saved: true });

    expect((await pendingTranscriptPass(store, { speech: provider })).sent).toBe(0);
    fake.network = "up";
    // (the provider kept the failed check for 10 s: a fresh one now)
    const fresh = new TencentSpeechProvider({ config: fakeConfig(), fetch: fake.fetch, sleep: async () => {} });
    expect((await pendingTranscriptPass(store, { speech: fresh })).sent).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 100 && (await store.getVisit(a.userId, visitId))?.status === "transcribing"; i++) {
      await pendingTranscriptPass(store, { speech: fresh });
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("review");
  }, 20_000);

  it("he chooses not to wait: the job stops and the record keeps the live lines", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }));
    expect((await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1` }))).status).toBe(200);
    const audioPath = await upload(a, visitId);
    fake.network = "hang";
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: audioPath }))).json()) as { job_id: string };
    const del = await asrJobDELETE(req("DELETE", `/api/asr/jobs/${job.job_id}`, a), params(job.job_id));
    expect(await del.json()).toMatchObject({ cancelled: true });
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "done", fallback: { reason: "cancelled", used: "live" } });
  });
});

describe("health", () => {
  it("/api/asr/health says tencent and whether it answers; never a key", async () => {
    const res = await asrHealthGET(new NextRequest(`${BASE}/api/asr/health`));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ provider: "tencent", tencent: { configured: true, reachable: true, ready: true, healthy: true } });
    expect(JSON.stringify(body)).not.toMatch(/AKID|SecretKey/i);
    fake.errorFor.DescribeTaskStatus = "AuthFailure.SignatureFailure";
    const crewless = new TencentSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    (globalThis as unknown as { __rippleSpeech: Map<string, unknown> }).__rippleSpeech.set("tencent", crewless);
    expect(await (await asrHealthGET(new NextRequest(`${BASE}/api/asr/health`))).json()).toEqual({
      provider: "tencent",
      tencent: { configured: true, reachable: true, ready: false, healthy: false, reason: "unauthorized" },
    });
    const missing = new TencentSpeechProvider({ config: fakeConfig({ TENCENT_SECRET_KEY: "" }), fetch: fake.fetch });
    (globalThis as unknown as { __rippleSpeech: Map<string, unknown> }).__rippleSpeech.set("tencent", missing);
    expect(await (await asrHealthGET(new NextRequest(`${BASE}/api/asr/health`))).json()).toMatchObject({ tencent: { configured: false, reason: "not_configured:no_secret_key" } });
  });

  it("/api/health reports speech tencent and, with the keys missing, which", () => {
    expect(healthReport({ SPEECH_PROVIDER: "tencent" })).toMatchObject({ speech: "tencent", speech_problem: "no_keys" });
    expect(healthReport({ SPEECH_PROVIDER: "tencent", TENCENT_SECRET_ID: "AKIDx" })).toMatchObject({ speech: "tencent", speech_problem: "no_secret_key" });
    expect(healthReport({ SPEECH_PROVIDER: "tencent", TENCENT_SECRET_ID: "AKIDx", TENCENT_SECRET_KEY: "k" })).toMatchObject({ speech: "tencent", speech_problem: null });
    expect(healthReport({ SPEECH_PROVIDER: "tencent", TENCENT_SECRET_ID: "AKIDx", TENCENT_SECRET_KEY: "k", TENCENT_ASR_ENGINE: "8k_zh" }).speech_problem).toBe("bad_engine");
    expect(JSON.stringify(healthReport({ SPEECH_PROVIDER: "tencent", TENCENT_SECRET_ID: "AKIDsecretvalue", TENCENT_SECRET_KEY: "keyvalue" }))).not.toMatch(/AKIDsecretvalue|keyvalue/);
  });
});
