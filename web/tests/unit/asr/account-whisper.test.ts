/**
 * Whisper on an account's visit (C2 track F; real-app 2.13, 2.14), against the fake Whisper service: his sign-in names
 * the scope (no ?session=, as the account page's live client sends it), the realtime token says whisper, chunks grow a
 * caption and a final stores the line in his own scope; the service failing mid-visit stops the captions with no
 * replay (never the script); 「录完了」 gives the recording's transcript from the service and the review; with the
 * service down at the end the saved recording waits for its text (awaiting_transcript) and lib/asr/pending.ts sends it
 * once the service answers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as chunkPOST } from "@/app/api/asr/chunk/route";
import { GET as asrJobGET } from "@/app/api/asr/jobs/[id]/route";
import { POST as asrJobsPOST } from "@/app/api/asr/jobs/route";
import { POST as tokenPOST } from "@/app/api/asr/realtime-token/route";
import { POST as finalizePOST } from "@/app/api/visits/[id]/finalize/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { WhisperSpeechProvider } from "@/lib/asr";
import { pendingTranscriptPass } from "@/lib/asr/pending";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, getBlobStore } from "@/lib/blob";
import { getMemoryStore } from "@/lib/store/memory";
import type { VisitView } from "@/lib/visit/types";
import { encodeWav } from "@/lib/visit/wav";
import { fakeConfig, fakeWhisper, type FakeWhisper } from "./fake-whisper";

const BASE = "http://localhost:3200";
const saved = { ...process.env };
const store = getMemoryStore();
let dir: string;
let fake: FakeWhisper;
let provider: WhisperSpeechProvider;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-whisper-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  process.env.MOCK_ASR_JOB_MS = "0";
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.SPEECH_PROVIDER = "whisper";
  fake = fakeWhisper();
  provider = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
  const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
  g.__rippleSpeech ??= new Map();
  g.__rippleSpeech.set("whisper", provider);
});
afterEach(() => {
  delete process.env.SPEECH_PROVIDER;
  (globalThis as unknown as { __rippleSpeech?: Map<string, unknown> }).__rippleSpeech?.delete("whisper");
});

async function him(): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
}

function req(method: string, url: string, a: TestAccount, body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${url}`, {
    method,
    headers: { cookie: `rp_at=${a.tokens.access_token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** a piece of audio as the live client sends it: no session in the query, his cookie */
function chunkReq(a: TestAccount, visitId: string, opts: { kind: "chunk" | "final"; line: string; offset?: number; seq?: number }): NextRequest {
  const q = new URLSearchParams({ visit_id: visitId, kind: opts.kind, line: opts.line, offset_ms: String(opts.offset ?? 1000), seq: String(opts.seq ?? 1) });
  return new NextRequest(`${BASE}/api/asr/chunk?${q}`, {
    method: "POST",
    headers: { "content-type": "audio/wav", cookie: `rp_at=${a.tokens.access_token}` },
    body: encodeWav(new Float32Array(16_000 * 2).fill(0.02)).buffer as ArrayBuffer,
  });
}

async function startRecording(a: TestAccount): Promise<string> {
  const res = await visitsPOST(req("POST", "/api/visits", a, { mode: "record", consent: { given: true }, place: "clinic" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { view: VisitView }).view.visit.id;
}

async function upload(a: TestAccount, visitId: string): Promise<string> {
  const scope = (await store.getSession(a.userId))!;
  const p = `${blobPrefix(scope)}/visits/${visitId}/recording-test.wav`;
  await getBlobStore().putObject("audio", p, encodeWav(new Float32Array(16_000 * 3).fill(0.02)), "audio/wav");
  return p;
}

async function settle(a: TestAccount, jobId: string, visitId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const st = (await (await asrJobGET(req("GET", `/api/asr/jobs/${jobId}?visit_id=${visitId}`, a), params(jobId))).json()) as Record<string, unknown>;
    if (st.status !== "pending") return st;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("the job is still pending");
}

describe("live captions on his visit", () => {
  it("the token says whisper; a chunk grows a caption, a final stores the line in his scope (no ?session=)", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const tok = (await (await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }))).json()) as { provider: string; live?: unknown; replay: unknown };
    expect(tok).toMatchObject({ provider: "whisper", replay: null });
    expect(tok.live).toBeTruthy();

    const chunk = await chunkPOST(chunkReq(a, visitId, { kind: "chunk", line: `${visitId}-wt-1`, seq: 1 }));
    expect(chunk.status).toBe(200);
    expect(await chunk.json()).toMatchObject({ kind: "chunk", text: "At home, we want it below 135 over 85." });

    const final = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-1`, offset: 49_400 }));
    expect(final.status).toBe(200);
    const body = (await final.json()) as { utterances: { id: string; text: string }[]; view: VisitView };
    expect(body.utterances.map((u) => [u.id, u.text])).toEqual([[`${visitId}-wt-1`, "At home, we want it below 135 over 85."]]);
    expect(body.view.lines.map((l) => l.id)).toEqual([`${visitId}-wt-1`]);
    const stored = await store.listUtterances(a.userId, visitId);
    expect(stored.map((u) => [u.id, u.t_start_ms >= 49_400])).toEqual([[`${visitId}-wt-1`, true]]);
    expect(fake.calls.filter((c) => c.path === "/v1/chunk")).toHaveLength(2);
  });

  it("the service stops answering mid-visit: the captions stop with no replay (never the script)", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }));
    fake.mode = "down";
    const res = await chunkPOST(chunkReq(a, visitId, { kind: "final", line: `${visitId}-wt-2` }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ fallback: true, replay: null });
    const again = await chunkPOST(chunkReq(a, visitId, { kind: "chunk", line: `${visitId}-wt-3` }));
    expect(again.status).toBe(409);
    expect(await store.listUtterances(a.userId, visitId)).toEqual([]);
  });

  it("Whisper not ready when he starts: no captions this time (the page says so), the recording goes on", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    fake.mode = "down";
    const tok = (await (await tokenPOST(req("POST", "/api/asr/realtime-token", a, { visit_id: visitId }))).json()) as { provider: string; fallback?: { replay: unknown } };
    expect(tok).toMatchObject({ provider: "mock", fallback: { replay: null } });
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("recording");
  });
});

describe("录完了 with Whisper", () => {
  it("the recording's transcript from the service, then the review", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const audioPath = await upload(a, visitId);
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: audioPath }))).json()) as { job_id: string };
    expect(job.job_id).toBeTruthy();
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "done", source: "audio" });
    const fin = await finalizePOST(req("POST", `/api/visits/${visitId}/finalize`, a, { job_id: job.job_id }), params(visitId));
    expect(fin.status).toBe(200);
    const view = ((await fin.json()) as { view: VisitView }).view;
    expect(view.visit.status).toBe("review");
    expect(view.lines.map((l) => l.text)).toEqual(["Doctor, can I record? My daughter wants me to use this app.", "Sure, no problem.", "医生，我家里那个机器是绑手腕的，可以用吗？"]);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
  });

  it("the service down at the end: the saved recording waits for its text; asr.pending sends it once the service answers", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const audioPath = await upload(a, visitId);
    fake.mode = "down";
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: audioPath }))).json()) as { job_id: string };
    const st = await settle(a, job.job_id, visitId);
    expect(st).toMatchObject({ status: "failed", deferred: true, awaiting_transcript: true });
    expect(await store.getVisit(a.userId, visitId)).toMatchObject({ status: "awaiting_transcript", audio_path: audioPath });

    // still down: nothing is sent
    expect((await pendingTranscriptPass(store, { speech: provider })).sent).toBe(0);
    fake.mode = "up";
    expect((await pendingTranscriptPass(store, { speech: provider })).sent).toBeGreaterThanOrEqual(1);
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("transcribing");
    for (let i = 0; i < 100 && (await store.getVisit(a.userId, visitId))?.status === "transcribing"; i++) {
      await pendingTranscriptPass(store, { speech: provider });
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("review");
    const lines = (await store.listUtterances(a.userId, visitId)).filter((u) => u.lang !== "x-superseded");
    expect(lines.map((u) => u.text)).toContain("Sure, no problem.");
  }, 20_000);

  it("a demo session keeps its rule: the failed job puts the visit back to recording (End visit again)", async () => {
    const s = await store.createSession({ story_day: 0, ttl_hours: 1 });
    const start = await visitsPOST(new NextRequest(`${BASE}/api/visits?session=${s.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "record", consent: { given: true } }) }));
    const visitId = ((await start.json()) as { view: VisitView }).view.visit.id;
    const p = `${blobPrefix(s)}/visits/${visitId}/recording-test.wav`;
    await getBlobStore().putObject("audio", p, encodeWav(new Float32Array(16_000 * 3).fill(0.02)), "audio/wav");
    fake.mode = "down";
    const jobRes = await asrJobsPOST(new NextRequest(`${BASE}/api/asr/jobs?session=${s.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visit_id: visitId, audio_path: p }) }));
    const jobId = ((await jobRes.json()) as { job_id: string }).job_id;
    let st: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      st = (await (await asrJobGET(new NextRequest(`${BASE}/api/asr/jobs/${jobId}?session=${s.id}`), params(jobId))).json()) as Record<string, unknown>;
      if (st.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(st).toMatchObject({ status: "failed", deferred: true });
    expect(st.awaiting_transcript).toBeUndefined();
    expect((await store.getVisit(s.id, visitId))?.status).toBe("recording");
  });
});
