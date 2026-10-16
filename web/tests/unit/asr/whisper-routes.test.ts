/**
 * M14 routes with SPEECH_PROVIDER=whisper against a fake Whisper service: health, the realtime token (ready /
 * fallback at the start), /api/asr/chunk (validation, captions, stored lines and cards, busy, mid-visit
 * fallback with asr.fallback once), the whole-visit job (service, fallback to the live lines or the replay)
 * and the replay route still working with whisper.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as chunkPOST } from "@/app/api/asr/chunk/route";
import { GET as healthGET } from "@/app/api/asr/health/route";
import { GET as asrJobsGET, POST as asrJobsPOST } from "@/app/api/asr/jobs/route";
import { DELETE as asrJobDELETE, GET as asrJobGET } from "@/app/api/asr/jobs/[id]/route";
import { POST as tokenPOST } from "@/app/api/asr/realtime-token/route";
import { POST as finalizePOST } from "@/app/api/visits/[id]/finalize/route";
import { POST as replayPOST } from "@/app/api/visits/[id]/replay/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { WhisperSpeechProvider } from "@/lib/asr";
import { forgetVisitJobs } from "@/lib/asr/visit-jobs";
import { whisperLive } from "@/lib/asr/whisper-live";
import { getBlobStore } from "@/lib/blob";
import { getBus, type BusEvent } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { renderEvent } from "@/components/backstage/sentences";
import type { VisitView } from "@/lib/visit/types";
import { encodeWav } from "@/lib/visit/wav";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import { newSession } from "../visit/helpers";
import { fakeConfig, fakeWhisper, type FakeWhisper } from "./fake-whisper";

const BASE = "http://localhost:3200";
const saved = { ...process.env };
let dir: string;
let fake: FakeWhisper;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-m14-routes-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  process.env.MOCK_ASR_JOB_MS = "0";
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
function useProvider(overrides: Record<string, string> = {}, env?: Record<string, string>) {
  const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
  g.__rippleSpeech ??= new Map();
  g.__rippleSpeech.set("whisper", new WhisperSpeechProvider({ config: fakeConfig(overrides), fetch: fake.fetch, env }));
}

beforeEach(() => {
  process.env.SPEECH_PROVIDER = "whisper";
  fake = fakeWhisper();
  useProvider();
});
afterEach(() => {
  delete process.env.SPEECH_PROVIDER;
  (globalThis as unknown as { __rippleSpeech?: Map<string, unknown> }).__rippleSpeech?.delete("whisper");
});

function jsonReq(method: string, url: string, sessionId: string | null, body?: unknown): NextRequest {
  const q = sessionId ? `${url.includes("?") ? "&" : "?"}session=${sessionId}` : "";
  return new NextRequest(`${BASE}${url}${q}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let lineSeq = 0;
function chunkReq(s: SessionRow, opts: { kind?: "chunk" | "final"; line?: string; visit?: string; offset?: number; seq?: number; body?: Uint8Array; type?: string; extra?: string } = {}): NextRequest {
  const visit = opts.visit ?? "v1";
  const line = opts.line ?? `${visit}-wtest-${++lineSeq}`;
  const q = new URLSearchParams({ session: s.id, visit_id: visit, kind: opts.kind ?? "chunk", line, offset_ms: String(opts.offset ?? 1000), seq: String(opts.seq ?? 1) });
  return new NextRequest(`${BASE}/api/asr/chunk?${q}${opts.extra ?? ""}`, {
    method: "POST",
    headers: { "content-type": opts.type ?? "audio/wav" },
    body: (opts.body ?? encodeWav(new Float32Array(16_000 * 2).fill(0.05))) as unknown as BodyInit,
  });
}

const events = (sid: string, type?: string): BusEvent[] => getBus().recent(sid).filter((e) => !type || e.type === type);

async function recording(day = 0): Promise<SessionRow> {
  const s = await newSession({ story_day: day });
  const res = await visitsPOST(jsonReq("POST", "/api/visits", s.id, { mode: "record", consent: { given: true } }));
  expect(res.status).toBe(200);
  return s;
}

describe("GET /api/asr/health", () => {
  const healthReq = (crew = false) => new NextRequest(`${BASE}/api/asr/health`, { headers: crew ? { "x-ripple-crew-key": DEV_ONLY_CREW_KEY } : {} });

  it("public: whether Whisper can be used, never the address, the token, the GPU or the models", async () => {
    const up = await (await healthGET(healthReq())).json();
    expect(up).toEqual({ provider: "whisper", whisper: { configured: true, reachable: true, ready: true, healthy: true } });
    fake.mode = "down";
    expect((await (await healthGET(healthReq())).json()).whisper).toMatchObject({ reachable: false, ready: false, healthy: false, reason: "unreachable" });
    delete process.env.SPEECH_PROVIDER;
    expect(await (await healthGET(healthReq())).json()).toEqual({ provider: "mock" });
  });

  it("crew: also the device, models, GPU and whether the token is taken", async () => {
    const body = await (await healthGET(healthReq(true))).json();
    expect(body.whisper).toMatchObject({ healthy: true, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, gpu: "Fake GPU", token: "ok" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("whisper.test");
    expect(text).not.toContain("tttttttt");
  });

  it("a wrong token and a stuck worker are reported as such", async () => {
    fake.mode = "unauthorized";
    expect((await (await healthGET(healthReq(true))).json()).whisper).toMatchObject({ reachable: true, healthy: false, reason: "unauthorized", token: "rejected" });
    fake.mode = "stuck";
    expect((await (await healthGET(healthReq())).json()).whisper).toMatchObject({ reachable: true, ready: true, healthy: false, reason: "stuck" });
  });
});

describe("POST /api/asr/realtime-token (whisper)", () => {
  it("service ready: provider whisper with the live tuning", async () => {
    const s = await recording();
    const body = await (await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }))).json();
    expect(body).toMatchObject({ provider: "whisper", live: { lineGapMs: 550, chunkGapMs: 240, maxChunkMs: 3000 }, replay: "v1" });
    expect(events(s.id, "asr.fallback")).toEqual([]);
  });

  it("a wrong token is found at the start and said as a configuration problem", async () => {
    fake.mode = "unauthorized";
    const s = await recording();
    const body = await (await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }))).json();
    expect(body).toMatchObject({ provider: "mock", fallback: { reason: "unauthorized", replay: "v1" } });
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(renderEvent(fb[0]).sentence).toMatch(/refused the web app \(a configuration problem, not a crash/);
    expect(renderEvent(fb[0]).sentence).not.toMatch(/stopped answering/);
  });

  it("ASR_REPLAY_FALLBACK=off: no replay is offered; the recording goes on without live captions", async () => {
    useProvider({}, { ASR_REPLAY_FALLBACK: "off" });
    const s = await recording();
    const ok = await (await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }))).json();
    expect(ok).toMatchObject({ provider: "whisper", replay: null });
    fake.mode = "down";
    const body = await (await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }))).json();
    expect(body).toMatchObject({ provider: "mock", fallback: { reason: "unreachable", replay: null } });
    expect(renderEvent(events(s.id, "asr.fallback")[0]).sentence).toMatch(/shows no replay: live captions stop, the recording goes on/);
  });

  it.each(["down", "loading", "timeout", "stuck"] as const)("service %s: provider mock, asr.fallback for the visit, the replay can start", async (mode) => {
    fake.mode = mode;
    const s = await recording();
    const res = await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ provider: "mock", token: expect.stringMatching(/^mock-/), fallback: { replay: "v1" } });
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ visit_id: "v1", during: "start", replay: "v1" });
    expect(renderEvent(fb[0]).sentence).toMatch(mode === "stuck" ? /Whisper service is stuck \(a transcription worker stopped answering; it restarts itself\), so the visit screen uses the recorded replay/ : /Whisper service did not answer, so the visit screen uses the recorded replay/);
    expect(renderEvent(fb[0]).badge).toBe("Replay fallback");
    // the replay route runs with SPEECH_PROVIDER=whisper (fallback and sample visits)
    const rep = await replayPOST(jsonReq("POST", "/api/visits/v1/replay", s.id, { speed: 20, source: "live" }), params("v1"));
    expect(rep.status).toBe(200);
    // chunks for this visit are refused from now on
    const later = await chunkPOST(chunkReq(s));
    expect(later.status).toBe(409);
    expect(await later.json()).toMatchObject({ error: "asr_fallback_active", fallback: true });
  });
});

describe("POST /api/asr/chunk", () => {
  it("validates: provider, query, line id, WAV only (never WebM), size, length, visit, status", async () => {
    const s = await recording();
    delete process.env.SPEECH_PROVIDER;
    expect((await chunkPOST(chunkReq(s))).status).toBe(409);
    process.env.SPEECH_PROVIDER = "whisper";
    expect((await chunkPOST(chunkReq(s, { extra: "&kind=bogus" }))).status).toBe(400);
    expect((await chunkPOST(chunkReq(s, { line: "v2-wtest-1" }))).status).toBe(400);
    const webm = await chunkPOST(chunkReq(s, { type: "audio/webm;codecs=opus" }));
    expect(webm.status).toBe(415);
    expect((await webm.json()).error).toBe("wav_required");
    expect((await chunkPOST(chunkReq(s, { body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]) }))).status).toBe(415);
    const cd = encodeWav(new Float32Array(44_100), 44_100);
    const r44 = await chunkPOST(chunkReq(s, { body: cd }));
    expect(r44.status).toBe(415);
    expect((await r44.json()).error).toBe("wav_16k_mono_pcm16_required");
    expect((await chunkPOST(chunkReq(s, { body: encodeWav(new Float32Array(16_000 * 33)) }))).status).toBe(413);
    expect((await chunkPOST(chunkReq(s, { body: encodeWav(new Float32Array(800)) }))).status).toBe(422);
    expect((await chunkPOST(chunkReq(s, { visit: "nope", line: "nope-wtest-1" }))).status).toBe(404);
    const done = await newSession({ story_day: 0 }); // v1 is confirmed in the seed, not recording
    expect((await chunkPOST(chunkReq(done))).status).toBe(409);
    // nothing reached the service
    expect(fake.calls.filter((c) => c.path === "/v1/chunk")).toEqual([]);
  });

  it("a chunk grows the caption on every device (asr.partial with the line so far)", async () => {
    const s = await recording();
    fake.chunkText = "At home,";
    const line = "v1-wabc-1";
    const a = await (await chunkPOST(chunkReq(s, { line, seq: 1, offset: 49_400 }))).json();
    expect(a).toMatchObject({ kind: "chunk", line, text: "At home,", chunk_text: "At home,", lang: "en", model: "large-v3-turbo" });
    fake.chunkText = "we want it below 135 over 85.";
    const b = await (await chunkPOST(chunkReq(s, { line, seq: 2, offset: 51_000 }))).json();
    expect(b.text).toBe("At home, we want it below 135 over 85.");
    const partials = events(s.id, "asr.partial");
    expect(partials).toHaveLength(2);
    expect(partials[1].data).toMatchObject({ visit_id: "v1", utterance: { id: line, t_start_ms: 49_400, speaker_cluster: null, text: "At home, we want it below 135 over 85." }, source: "whisper" });
    expect(fake.calls[0].query.lang_hint).toBeUndefined();
    expect(fake.calls[1].query.lang_hint).toBe("en"); // the line's language so far
  });

  it("a final stores one utterance (speaker unknown), extracts items, shows the card; late chunks are ignored", async () => {
    const s = await recording();
    fake.chunkText = "At home, we want it below 135 over 85.";
    const line = "v1-wabc-7";
    const res = await chunkPOST(chunkReq(s, { kind: "final", line, offset: 49_400 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { utterances: { id: string; speaker_cluster: number | null; t_start_ms: number; t_end_ms: number; text: string }[]; view: VisitView; new_cards: unknown[] };
    expect(body.utterances).toHaveLength(1);
    expect(body.utterances[0]).toMatchObject({ id: line, speaker_cluster: null, t_start_ms: 49_520, t_end_ms: 52_300, text: "At home, we want it below 135 over 85." });
    expect(body.view.lines.map((l) => l.id)).toContain(line);
    expect(body.view.cards.some((c) => c.anchor === line)).toBe(true); // R1, word for word: the target card
    expect(events(s.id, "asr.final")).toHaveLength(1);
    expect(events(s.id, "card.created").length).toBeGreaterThanOrEqual(1);
    // a retried final or a chunk arriving late for the same line changes nothing
    expect(await (await chunkPOST(chunkReq(s, { kind: "final", line }))).json()).toMatchObject({ ignored: "line_closed" });
    expect(await (await chunkPOST(chunkReq(s, { kind: "chunk", line, seq: 3 }))).json()).toMatchObject({ ignored: "line_closed" });
    expect((await getMemoryStore().listUtterances(s.id, "v1")).filter((u) => u.id === line)).toHaveLength(1);
  });

  it("an empty final (silence / filtered hallucination) stores nothing", async () => {
    const s = await recording();
    fake.chunkText = "";
    const body = await (await chunkPOST(chunkReq(s, { kind: "final" }))).json();
    expect(body).toMatchObject({ kind: "final", utterances: [], view: null });
    expect(events(s.id, "asr.final")).toEqual([]);
  });

  it("a short busy spell: 429 at once with retry_after_ms (one call to the service, no retries here); a final can be sent again", async () => {
    const s = await recording();
    fake.mode = "busy";
    fake.retryAfterS = 2;
    const chunk = await chunkPOST(chunkReq(s));
    expect(chunk.status).toBe(429);
    expect(chunk.headers.get("retry-after")).toBe("2");
    expect(await chunk.json()).toMatchObject({ error: "busy", retry_after_ms: 2000 });
    const line = "v1-wbusy-1";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line }))).status).toBe(429);
    expect(fake.calls.filter((c) => c.path === "/v1/chunk").length).toBe(2);
    fake.mode = "up";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line }))).status).toBe(200);
    expect(events(s.id, "asr.fallback")).toEqual([]);
    expect(whisperLive(s.id, "v1").busySince).toBeNull(); // a success ends the busy spell
  });

  it("busy for longer than WHISPER_BUSY_FALLBACK_MS: the live captions fall back (reason busy), asr.fallback once", async () => {
    useProvider({ WHISPER_BUSY_FALLBACK_MS: "150" });
    const s = await recording();
    fake.mode = "busy";
    expect((await chunkPOST(chunkReq(s))).status).toBe(429);
    await new Promise((r) => setTimeout(r, 200));
    const res = await chunkPOST(chunkReq(s, { kind: "final" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "asr_unavailable", reason: "busy", fallback: true, replay: "v1" });
    expect((await chunkPOST(chunkReq(s))).status).toBe(409);
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ reason: "busy", during: "live" });
    expect(renderEvent(fb[0]).sentence).toMatch(/stayed busy \(its live queue was full\)/);
  });

  it("a slow chunk on a working service is tolerated; a second failure in a row switches", async () => {
    const s = await recording();
    expect((await chunkPOST(chunkReq(s))).status).toBe(200);
    fake.modeFor.chunk = "timeout"; // the chunk hangs, /health answers
    const first = await chunkPOST(chunkReq(s));
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ error: "asr_unavailable", reason: "timeout", fallback: false });
    const second = await chunkPOST(chunkReq(s));
    expect(await second.json()).toMatchObject({ fallback: true, replay: "v1", reason: "timeout" });
    expect(events(s.id, "asr.fallback")).toHaveLength(1);
  });

  it("service dies mid-visit: the failed chunk plus a failed health check switch at once; asr.fallback once", async () => {
    const s = await recording();
    expect((await chunkPOST(chunkReq(s))).status).toBe(200);
    fake.mode = "down";
    const first = await chunkPOST(chunkReq(s));
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ error: "asr_unavailable", reason: "unreachable", fallback: true, replay: "v1" });
    const later = await chunkPOST(chunkReq(s));
    expect(later.status).toBe(409);
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ visit_id: "v1", reason: "unreachable", during: "live", replay: "v1" });
    expect(renderEvent(fb[0]).sentence).toMatch(/stopped answering during the visit/);
  });

  it("a hung service (chunks and health both time out) switches after one chunk", async () => {
    useProvider({ WHISPER_CHUNK_TIMEOUT_MS: "200", WHISPER_HEALTH_TIMEOUT_MS: "200" });
    const s = await recording();
    fake.mode = "timeout";
    const t0 = Date.now();
    const res = await chunkPOST(chunkReq(s));
    expect(await res.json()).toMatchObject({ fallback: true, reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a wrong token mid-visit (chunk 401) switches at once and is said as a configuration problem", async () => {
    const s = await recording();
    fake.mode = "unauthorized";
    const res = await chunkPOST(chunkReq(s));
    expect(await res.json()).toMatchObject({ fallback: true, reason: "unauthorized" });
    expect(renderEvent(events(s.id, "asr.fallback")[0]).sentence).toMatch(/configuration problem, not a crash/);
  });

  it.each(["timeout", "unauthorized", "server_error"] as const)("a final that fails (%s) switches at once", async (mode) => {
    const s = await recording();
    fake.mode = mode;
    const res = await chunkPOST(chunkReq(s, { kind: "final" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ fallback: true });
    expect(events(s.id, "asr.fallback")).toHaveLength(1);
  });

  it("a visit without a replay file says so in the fallback", async () => {
    const s = await recording(29); // no sample visit on day 29: a new visit row
    const visit = (await getMemoryStore().listVisits(s.id)).find((v) => v.day === 29)!;
    fake.mode = "down";
    const res = await chunkPOST(chunkReq(s, { kind: "final", visit: visit.id, line: `${visit.id}-wx-1` }));
    expect(await res.json()).toMatchObject({ fallback: true, replay: null });
    const fb = events(s.id, "asr.fallback");
    expect(renderEvent(fb[0]).sentence).toMatch(/shows no replay: live captions stop, the recording goes on/);
  });
});

describe("POST /api/asr/jobs (whisper)", () => {
  async function upload(s: SessionRow, visit = "v1"): Promise<string> {
    const p = `${s.id}/visits/${visit}/recording-test.wav`;
    await getBlobStore().putObject("audio", p, encodeWav(new Float32Array(16_000 * 3).fill(0.02)), "audio/wav");
    return p;
  }

  async function finish(s: SessionRow, jobId: string, visit = "v1") {
    for (let i = 0; i < 200; i++) {
      const st = await (await asrJobGET(jsonReq("GET", `/api/asr/jobs/${jobId}`, s.id), params(jobId))).json();
      if (st.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return finalizePOST(jsonReq("POST", `/api/visits/${visit}/finalize`, s.id, { job_id: jobId }), params(visit));
  }

  it("sends the recording to the service; the record has the service's lines, speaker unknown, clips cut", async () => {
    const s = await recording();
    const audioPath = await upload(s);
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    // deadline max(3 s, 2 x the 3 s recording) for the first attempt and for one redo after a restart, the 120 s wait
    // for the restarted service between them, + 30 s
    expect(job.wait_ms).toBe(6000 * 2 + 120_000 + 30_000);
    const fin = await finish(s, job.job_id);
    expect(fin.status).toBe(200);
    const view = (await fin.json()).view as VisitView;
    expect(view.lines.map((l) => l.text)).toEqual(["Doctor, can I record? My daughter wants me to use this app.", "Sure, no problem.", "医生，我家里那个机器是绑手腕的，可以用吗？"]);
    const stored = (await getMemoryStore().listUtterances(s.id, "v1")).filter((u) => u.lang !== "x-superseded");
    expect(stored.every((u) => u.speaker_cluster === null)).toBe(true);
    // the transcript came from the audio: per-sentence clips were cut from the recording
    expect(stored.filter((u) => u.clip_path?.startsWith(`${s.id}/visits/v1/segments/`)).length).toBeGreaterThanOrEqual(1);
    const upload_ = fake.calls.find((c) => c.path === "/v1/file")!;
    expect(upload_.bytes).toBe(44 + 16_000 * 3 * 2);
    expect(events(s.id, "asr.fallback")).toEqual([]);
  });

  it("service down at the end: the record keeps the live Whisper lines; asr.fallback during file", async () => {
    const s = await recording();
    fake.chunkText = "At home, we want it below 135 over 85.";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line: "v1-wlive-1", offset: 49_400 }))).status).toBe(200);
    const audioPath = await upload(s);
    fake.mode = "down";
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    const fin = await finish(s, job.job_id);
    expect(fin.status).toBe(200);
    const view = (await fin.json()).view as VisitView;
    expect(view.lines.map((l) => [l.id, l.text])).toEqual([["v1-wlive-1", "At home, we want it below 135 over 85."]]);
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ during: "file", used: "live", reason: "unreachable" });
    expect(renderEvent(fb[0]).sentence).toMatch(/keeps the live Whisper captions/);
  }, 15_000);

  it("a visit that fell back while recording keeps the replay for its record (no call to the service)", async () => {
    const s = await recording();
    fake.mode = "down";
    await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }));
    expect(whisperLive(s.id, "v1").fellBack).not.toBeNull();
    // the page plays the replay as the live screen
    expect((await replayPOST(jsonReq("POST", "/api/visits/v1/replay", s.id, { speed: 20, source: "live" }), params("v1"))).status).toBe(200);
    fake.mode = "up";
    const audioPath = await upload(s);
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    const fin = await finish(s, job.job_id);
    const view = (await fin.json()).view as VisitView;
    expect(view.lines).toHaveLength(12); // the D0 replay
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toEqual([]);
    expect(events(s.id, "asr.fallback")).toHaveLength(1); // only the one at the start
  });

  it("the second End visit after a failed upload: the live lines are kept (no_audio), never the script; asr.fallback", async () => {
    const s = await recording();
    fake.chunkText = "At home, we want it below 135 over 85.";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line: "v1-wlive-1", offset: 49_400 }))).status).toBe(200);
    // no audio_path: the upload did not happen
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(job.wait_ms).toBe(30_000);
    const fin = await finish(s, job.job_id);
    expect(fin.status).toBe(200);
    const view = (await fin.json()).view as VisitView;
    expect(view.lines.map((l) => l.id)).toEqual(["v1-wlive-1"]);
    expect(view.lines.some((l) => /^v1-u\d+$/.test(l.id))).toBe(false);
    const fb = events(s.id, "asr.fallback");
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ during: "file", used: "live", reason: "no_audio" });
    expect(renderEvent(fb[0]).sentence).toMatch(/did not reach the server, so the record keeps the live Whisper captions/);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toEqual([]);
  });

  it("a recorded visit with nothing to keep fails loudly, goes back to recording, and a retry with the recording works", async () => {
    const s = await recording();
    const failed = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs?audio_missing=upload_failed", s.id, { visit_id: "v1" }))).json();
    let st: { status: string; error?: string } = { status: "pending" };
    for (let i = 0; i < 100 && st.status === "pending"; i++) {
      st = await (await asrJobGET(jsonReq("GET", `/api/asr/jobs/${failed.job_id}`, s.id), params(failed.job_id))).json();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(st).toMatchObject({ status: "failed", error: "whisper_unavailable:upload_failed" });
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("recording");
    expect(events(s.id, "asr.fallback")[0].data).toMatchObject({ reason: "upload_failed", used: "none" });
    expect((await asrJobsPOST(jsonReq("POST", "/api/asr/jobs?audio_missing=bogus", s.id, { visit_id: "v1" }))).status).toBe(400);
    // the page kept the recording and sends it again
    const audioPath = await upload(s);
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    const fin = await finish(s, job.job_id);
    expect(fin.status).toBe(200);
    expect(((await fin.json()).view as VisitView).lines).toHaveLength(3);
  });

  it("a page reloaded after its upload: the recording saved on the visit is used", async () => {
    const s = await recording();
    const audioPath = await upload(s);
    fake.mode = "down";
    const first = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    for (let i = 0; i < 100; i++) {
      const st = await (await asrJobGET(jsonReq("GET", `/api/asr/jobs/${first.job_id}`, s.id), params(first.job_id))).json();
      if (st.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.audio_path).toBe(audioPath);
    fake.mode = "up";
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    const fin = await finish(s, job.job_id);
    expect(((await fin.json()).view as VisitView).lines.map((l) => l.text)).toContain("Sure, no problem.");
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
  });

  it("DELETE /api/asr/jobs/[id]: he keeps the live captions instead of waiting", async () => {
    const s = await recording();
    fake.chunkText = "At home, we want it below 135 over 85.";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line: "v1-wlive-2", offset: 49_400 }))).status).toBe(200);
    fake.runningPolls = 1_000_000;
    fake.progressMoves = true;
    const audioPath = await upload(s);
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    await new Promise((r) => setTimeout(r, 60));
    const del = await asrJobDELETE(jsonReq("DELETE", `/api/asr/jobs/${job.job_id}`, s.id), params(job.job_id));
    expect(await del.json()).toMatchObject({ cancelled: true });
    const fin = await finish(s, job.job_id);
    expect(((await fin.json()).view as VisitView).lines.map((l) => l.id)).toEqual(["v1-wlive-2"]);
    expect(events(s.id, "asr.fallback")[0].data).toMatchObject({ reason: "cancelled", used: "live" });
    // someone else's job: 404
    const other = await recording();
    expect((await asrJobDELETE(jsonReq("DELETE", `/api/asr/jobs/${job.job_id}`, other.id), params(job.job_id))).status).toBe(404);
  });

  it("a replay (no recording) never calls the service", async () => {
    const s = await newSession({ story_day: 0 });
    await visitsPOST(jsonReq("POST", "/api/visits", s.id, { mode: "replay", fixture: "v1" }));
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(job.wait_ms).toBe(120_000);
    const fin = await finish(s, job.job_id);
    expect(fin.status).toBe(200);
    expect(((await fin.json()).view as VisitView).lines).toHaveLength(12);
    expect(fake.calls).toEqual([]);
    expect(events(s.id, "asr.fallback")).toEqual([]);
  });
});

describe("round 2: the record when the service is down, a lost job, health for the crew", () => {
  async function upload(s: SessionRow, visit = "v1"): Promise<string> {
    const p = `${s.id}/visits/${visit}/recording-r2.wav`;
    await getBlobStore().putObject("audio", p, encodeWav(new Float32Array(16_000 * 3).fill(0.02)), "audio/wav");
    return p;
  }
  async function settle(s: SessionRow, jobId: string, query = "") {
    let st: Record<string, unknown> = { status: "pending" };
    for (let i = 0; i < 200 && st.status === "pending"; i++) {
      st = await (await asrJobGET(jsonReq("GET", `/api/asr/jobs/${jobId}${query}`, s.id), params(jobId))).json();
      if (st.status === "pending") await new Promise((r) => setTimeout(r, 10));
    }
    return st;
  }
  const fileFallbacks = (sid: string) => events(sid, "asr.fallback").filter((e) => (e.data as { during?: string }).during === "file");

  it("ASR_REPLAY_FALLBACK=off, service down all visit: the recording is saved, the job says deferred, asr.fallback once for the record; the record is made when the service is back", async () => {
    useProvider({}, { ASR_REPLAY_FALLBACK: "off" });
    fake.mode = "down";
    const s = await recording();
    await tokenPOST(jsonReq("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }));
    const audioPath = await upload(s);
    // he taps End visit three times while the service is down
    for (let i = 0; i < 3; i++) {
      const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", ...(i === 0 ? { audio_path: audioPath } : {}) }))).json();
      const st = await settle(s, job.job_id);
      expect(st).toMatchObject({ status: "failed", deferred: true, fallback: { reason: "unreachable", used: "none" } });
      expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("recording");
    }
    const file = fileFallbacks(s.id);
    expect(file).toHaveLength(1); // not one per tap
    expect(file[0].data).toMatchObject({ used: "none", audio_saved: true, replay: null });
    expect(renderEvent(file[0]).sentence).toMatch(/the recording is saved, and End visit again makes the record once the service answers/);
    expect(events(s.id, "asr.fallback")).toHaveLength(2); // the start, and the record once
    // the service is back: End visit again (the page does it by itself) makes the record from the saved recording
    fake.mode = "up";
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(await settle(s, job.job_id)).toMatchObject({ status: "done", source: "audio" });
    const fin = await finalizePOST(jsonReq("POST", "/api/visits/v1/finalize", s.id, { job_id: job.job_id }), params("v1"));
    expect(((await fin.json()).view as VisitView).lines.map((l) => l.text)).toContain("Sure, no problem.");
    expect(fileFallbacks(s.id)).toHaveLength(1);
  }, 20_000);

  it("a failed record is only deferred when the recording is saved and the service was the problem", async () => {
    const s = await recording();
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs?audio_missing=upload_failed", s.id, { visit_id: "v1" }))).json();
    const st = await settle(s, job.job_id);
    expect(st).toMatchObject({ status: "failed", error: "whisper_unavailable:upload_failed" });
    expect(st.deferred).toBeUndefined();
  });

  it("a job the server lost (it restarted): the visit goes back to recording so End visit works again", async () => {
    const s = await recording();
    const audioPath = await upload(s);
    fake.runningPolls = 1_000_000;
    fake.progressMoves = true;
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("transcribing");
    // a reopened page asks for the visit's job: still known here
    const known = await (await asrJobsGET(jsonReq("GET", "/api/asr/jobs?visit_id=v1", s.id))).json();
    expect(known).toMatchObject({ job_id: job.job_id, status: "pending", visit_status: "transcribing" });
    // the web server restarts: every job in process memory is gone
    await asrJobDELETE(jsonReq("DELETE", `/api/asr/jobs/${job.job_id}`, s.id), params(job.job_id));
    (globalThis as unknown as { __rippleWhisperJobs?: Map<string, unknown> }).__rippleWhisperJobs?.clear();
    (globalThis as unknown as { __rippleVisitLive?: { jobs: Map<string, unknown> } }).__rippleVisitLive?.jobs.clear();
    forgetVisitJobs();
    await getMemoryStore().updateVisit(s.id, "v1", { status: "transcribing" });
    // the old page polls without saying its visit: a plain 404, nothing changes
    const plain = await asrJobGET(jsonReq("GET", `/api/asr/jobs/${job.job_id}`, s.id), params(job.job_id));
    expect(plain.status).toBe(404);
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("transcribing");
    // the page polls with its visit: the visit goes back to recording, and the page creates the job again
    const lost = await asrJobGET(jsonReq("GET", `/api/asr/jobs/${job.job_id}?visit_id=v1`, s.id), params(job.job_id));
    expect(lost.status).toBe(404);
    expect(await lost.json()).toEqual({ error: "job_not_found", visit_reset: true });
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("recording");
    expect(events(s.id, "visit.changed").at(-1)!.data).toMatchObject({ visit: { status: "recording" } });
    // another session cannot reset this visit
    const other = await recording();
    await getMemoryStore().updateVisit(s.id, "v1", { status: "transcribing" });
    expect((await asrJobGET(jsonReq("GET", `/api/asr/jobs/${job.job_id}?visit_id=v1`, other.id), params(job.job_id))).status).toBe(404);
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("transcribing");
    // a reopened page of a visit stuck in "transcribing" with no job here: reset as well
    const reopened = await (await asrJobsGET(jsonReq("GET", "/api/asr/jobs?visit_id=v1", s.id))).json();
    expect(reopened).toEqual({ job_id: null, visit_reset: true, visit_status: "recording" });
    expect((await asrJobsGET(jsonReq("GET", "/api/asr/jobs", s.id))).status).toBe(400);
    expect((await asrJobsGET(jsonReq("GET", "/api/asr/jobs?visit_id=nope", s.id))).status).toBe(404);
    // End visit again: the recording saved on the visit is used
    fake.runningPolls = 1;
    const again = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(await settle(s, again.job_id, "?visit_id=v1")).toMatchObject({ status: "done", source: "audio" });
  }, 20_000);

  it("B3: the service restarts in the middle of the record: the job waits (awaiting_transcript), sends the recording again, and the record is the formal transcript; no asr.fallback", async () => {
    useProvider({ WHISPER_REDO_POLL_MS: "30" });
    const s = await recording();
    fake.chunkText = "At home, we want it below 135 over 85.";
    expect((await chunkPOST(chunkReq(s, { kind: "final", line: "v1-wlive-9", offset: 49_400 }))).status).toBe(200);
    const audioPath = await upload(s);
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 3, loading: 6 };
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    let st: Record<string, unknown> = { status: "pending" };
    let awaiting: unknown = null;
    for (let i = 0; i < 400 && st.status === "pending"; i++) {
      st = await (await asrJobGET(jsonReq("GET", `/api/asr/jobs/${job.job_id}?visit_id=v1`, s.id), params(job.job_id))).json();
      awaiting ??= st.awaiting_transcript ?? null;
      if (st.status === "pending") await new Promise((r) => setTimeout(r, 10));
    }
    // the page saw the waiting state while the service was away
    expect(awaiting).toMatchObject({ reason: "unreachable", attempt: 1 });
    expect(st).toMatchObject({ status: "done", source: "audio", redone: { attempts: 1 } });
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("transcribing");
    const fin = await finalizePOST(jsonReq("POST", "/api/visits/v1/finalize", s.id, { job_id: job.job_id }), params("v1"));
    const view = (await fin.json()).view as VisitView;
    expect(view.lines.map((l) => l.text)).toEqual(["Doctor, can I record? My daughter wants me to use this app.", "Sure, no problem.", "医生，我家里那个机器是绑手腕的，可以用吗？"]);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(2);
    expect(fileFallbacks(s.id)).toEqual([]);
  }, 20_000);

  it("B3 fix: End visit tapped again while the record is still being made returns the same job (never a second upload of the same recording)", async () => {
    const s = await recording();
    const audioPath = await upload(s);
    fake.runningPolls = 1_000_000;
    fake.progressMoves = true;
    const first = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    expect(first.reused).toBeUndefined();
    for (let i = 0; i < 200 && !fake.calls.some((c) => c.path === "/v1/file"); i++) await new Promise((r) => setTimeout(r, 5));
    // the page gave up waiting (its own cap) and he taps End visit again, with or without the recording
    for (const body of [{ visit_id: "v1" }, { visit_id: "v1", audio_path: audioPath }]) {
      const again = await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, body));
      expect(again.status).toBe(200);
      const b = await again.json();
      expect(b).toMatchObject({ job_id: first.job_id, status: "pending", reused: true });
      expect(b.wait_ms).toBeGreaterThan(0);
      expect(b.wait_ms).toBeLessThanOrEqual(first.wait_ms);
    }
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
    // another session's End for its own v1 is its own job
    const other = await recording();
    const theirs = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", other.id, { visit_id: "v1", audio_path: await upload(other) }))).json();
    expect(theirs.job_id).not.toBe(first.job_id);
    // once the first job is over, End visit again makes a new job (a retry after a failed record)
    await asrJobDELETE(jsonReq("DELETE", `/api/asr/jobs/${first.job_id}`, s.id), params(first.job_id));
    await asrJobDELETE(jsonReq("DELETE", `/api/asr/jobs/${theirs.job_id}`, other.id), params(theirs.job_id));
    expect((await settle(s, first.job_id)).status).not.toBe("pending");
    fake.runningPolls = 1;
    const retry = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(retry.job_id).not.toBe(first.job_id);
    expect(retry.reused).toBeUndefined();
    expect(await settle(s, retry.job_id)).toMatchObject({ status: "done", source: "audio" });
  }, 20_000);

  it("B3: a recording the service refuses (415) is not deferred (the same bytes would be refused again)", async () => {
    useProvider({}, { ASR_REPLAY_FALLBACK: "off" });
    fake.modeFor.file = "rejected";
    const s = await recording();
    const audioPath = await upload(s);
    const job = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: audioPath }))).json();
    const st = await settle(s, job.job_id);
    expect(st).toMatchObject({ status: "failed", fallback: { reason: "rejected_415_wav_16k_mono_pcm16_required", used: "none" } });
    expect(st.deferred).toBeUndefined();
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
    // the same failure from a service that was down IS deferred (the round-2 behaviour stays)
    fake.modeFor.file = undefined;
    fake.mode = "down";
    const again = await (await asrJobsPOST(jsonReq("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }))).json();
    expect(await settle(s, again.job_id)).toMatchObject({ status: "failed", deferred: true });
  }, 20_000);

  it("B3: the service refusing a live piece (415 / 422) is a client error: same status to the page, no failure count, no fallback", async () => {
    const s = await recording();
    for (const mode of ["rejected", "too_short"] as const) {
      fake.mode = mode;
      for (const kind of ["chunk", "final"] as const) {
        const res = await chunkPOST(chunkReq(s, { kind }));
        expect(res.status).toBe(mode === "rejected" ? 415 : 422);
        expect(await res.json()).toMatchObject({ error: "asr_rejected", fallback: false, reason: mode === "rejected" ? "rejected_415_wav_16k_mono_pcm16_required" : "rejected_422_too_short" });
        expect(whisperLive(s.id, "v1").failStreak).toBe(0);
      }
    }
    expect(events(s.id, "asr.fallback")).toEqual([]);
    expect(whisperLive(s.id, "v1").fellBack).toBeNull();
    // the visit's captions go on
    fake.mode = "up";
    expect((await chunkPOST(chunkReq(s))).status).toBe(200);
  });

  it("B3: a WAV whose format is not PCM is refused here (415), as the service would, before reaching it", async () => {
    const s = await recording();
    const adpcm = encodeWav(new Float32Array(16_000 * 2).fill(0.05));
    new DataView(adpcm.buffer).setUint16(20, 2, true); // format 2 (ADPCM), the rest 16 kHz mono 16-bit
    const res = await chunkPOST(chunkReq(s, { body: adpcm }));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "wav_16k_mono_pcm16_required" });
    expect(fake.calls.filter((c) => c.path === "/v1/chunk")).toEqual([]);
    expect(whisperLive(s.id, "v1").failStreak).toBe(0);
    expect(events(s.id, "asr.fallback")).toEqual([]);
  });

  it("crew health says whether a failing service may hand the screen to the replay, and which worker is stuck", async () => {
    const crew = () => new NextRequest(`${BASE}/api/asr/health`, { headers: { "x-ripple-crew-key": DEV_ONLY_CREW_KEY } });
    expect((await (await healthGET(crew())).json()).whisper).toMatchObject({ replay_fallback: true, stuck_workers: [] });
    useProvider({}, { ASR_REPLAY_FALLBACK: "off" });
    expect((await (await healthGET(crew())).json()).whisper).toMatchObject({ replay_fallback: false });
    fake.mode = "down";
    expect((await (await healthGET(crew())).json()).whisper).toMatchObject({ reachable: false, replay_fallback: false });
    // never on the public answer
    expect(JSON.stringify(await (await healthGET(new NextRequest(`${BASE}/api/asr/health`))).json())).not.toContain("replay_fallback");
  });
});
