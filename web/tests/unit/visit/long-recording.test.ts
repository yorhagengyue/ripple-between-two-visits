/**
 * A long visit's recording on the server (C2 track R; lib/visit/parts.ts, lib/visit/recording.ts,
 * app/api/visits/[id]/parts, app/api/asr/jobs, lib/asr/whisper.ts, lib/visit/pipeline.ts finalizeVisit, lib/asr/pending.ts,
 * app/api/me/export/recording), on the memory store, the local blob driver in a temporary folder and the fake Whisper
 * service. The parts here are two seconds long: the server measures what it is given, so nothing needs 37 MB.
 *
 *   - the parts are registered one at a time, in order, each read and measured by the server; a part asked again is the
 *     same answer, a part out of order or a second file for a part that is there is refused; a file that is not his
 *     recording, not there, or not a 16 kHz mono WAV is refused
 *   - the list is the recording only once the phone says it is whole and the server has that many; until then a
 *     request without it is a visit with no recording
 *   - one visit is one job: the service gets each part once, the transcript's times run over the whole visit, and a
 *     sentence the cut went through is one line again, with a clip cut from both files
 *   - a visit in one file is exactly as before: no list on its row
 *   - the service down at the end: the visit waits, and the scheduled pass sends every part in one submission
 *   - 「听录音」 goes through every part, and nothing past the last
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as asrJobGET } from "@/app/api/asr/jobs/[id]/route";
import { POST as asrJobsPOST } from "@/app/api/asr/jobs/route";
import { GET as listenGET } from "@/app/api/me/export/recording/route";
import { POST as finalizePOST } from "@/app/api/visits/[id]/finalize/route";
import { GET as partsGET, POST as partsPOST } from "@/app/api/visits/[id]/parts/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { WhisperSpeechProvider } from "@/lib/asr";
import { pendingTranscriptPass } from "@/lib/asr/pending";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, getBlobStore } from "@/lib/blob";
import { getMemoryStore } from "@/lib/store/memory";
import { MAX_PARTS } from "@/lib/visit/parts";
import { TRANSCRIPT_TRY } from "@/lib/visit/transcript-tries";
import type { VisitView } from "@/lib/visit/types";
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { fakeConfig, fakeWhisper, type FakeWhisper } from "../asr/fake-whisper";

const BASE = "http://localhost:3200";
const saved = { ...process.env };
const store = getMemoryStore();
let dir: string;
let fake: FakeWhisper;
let provider: WhisperSpeechProvider;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-r-long-"));
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
  return createAccountWithSpace(store, getAuthProvider(), { login: `r${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
}

function req(method: string, url: string, a: TestAccount, body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${url}`, {
    method,
    headers: { cookie: `rp_at=${a.tokens.access_token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function startRecording(a: TestAccount): Promise<string> {
  const res = await visitsPOST(req("POST", "/api/visits", a, { mode: "record", consent: { given: true }, place: "clinic" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { view: VisitView }).view.visit.id;
}

async function prefixOf(a: TestAccount): Promise<string> {
  return blobPrefix((await store.getSession(a.userId))!);
}

/** `ms` of audio whose every sample is `value` (so a clip shows which file each of its samples came from). */
const tone = (ms: number, value: number) => encodeWav(new Int16Array(ms * 16).fill(value));

/** A file in his visit's folder, as the phone's upload leaves it. */
async function put(a: TestAccount, visitId: string, bytes: Uint8Array, name = `recording-${randomUUID()}.wav`): Promise<string> {
  const p = `${await prefixOf(a)}/visits/${visitId}/${name}`;
  await getBlobStore().putObject("audio", p, bytes, "audio/wav");
  return p;
}

async function register(a: TestAccount, visitId: string, seq: number, p: string): Promise<{ status: number; body: { parts?: { seq: number; path: string; ms: number }[]; complete?: boolean; error?: string; have?: number } }> {
  const res = await partsPOST(req("POST", `/api/visits/${visitId}/parts`, a, { seq, path: p }), params(visitId));
  return { status: res.status, body: (await res.json()) as never };
}

/** Three parts of a 5.1 s visit: 2 s, 2.2 s, 0.9 s (each its own size); the samples say which part they are from. */
const PARTS = [
  { ms: 2000, value: 1000 },
  { ms: 2200, value: 2000 },
  { ms: 900, value: 3000 },
];

async function threeParts(a: TestAccount, visitId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [seq, p] of PARTS.entries()) {
    const file = await put(a, visitId, tone(p.ms, p.value));
    expect((await register(a, visitId, seq, file)).status).toBe(200);
    paths.push(file);
  }
  return paths;
}

/**
 * What the service hears in each part. The second line of part 0 runs to the part's end and goes on in part 1. The
 * last line of part 1 ends 0.6 s before the cut and part 2's first line starts 0.1 s after it: a pause longer than the
 * line gap, so those stay two lines.
 */
function hearParts(): void {
  // by the file's size, not by the order the service gets them in: the pass also sends other tests' waiting visits
  fake.fileSegmentsFor = (_n, bytes) =>
    [
      [
        { start_ms: 300, end_ms: 900, text: "Doctor, can I record?", lang: "en", region: 0 },
        { start_ms: 1500, end_ms: 2000, text: "At home, we want it below", lang: "en", region: 1 },
      ],
      [
        { start_ms: 0, end_ms: 700, text: "135 over 85.", lang: "en", region: 0 },
        { start_ms: 900, end_ms: 1400, text: "Sure, no problem.", lang: "en", region: 1 },
      ],
      [{ start_ms: 100, end_ms: 800, text: "Come back in six weeks.", lang: "en", region: 0 }],
    ][PARTS.findIndex((p) => 44 + p.ms * 32 === bytes)] ?? [];
}

async function settle(a: TestAccount, jobId: string, visitId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 400; i++) {
    const st = (await (await asrJobGET(req("GET", `/api/asr/jobs/${jobId}?visit_id=${visitId}`, a), params(jobId))).json()) as Record<string, unknown>;
    if (st.status !== "pending") return st;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("the job is still pending");
}

describe("registering the parts of a long recording", () => {
  it("one at a time, in order, each measured by the server; the recording is not there until the list is closed", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    expect(await (await partsGET(req("GET", `/api/visits/${visitId}/parts`, a), params(visitId))).json()).toEqual({ parts: [], complete: false, path: null });

    const first = await put(a, visitId, tone(2000, 1000));
    const one = await register(a, visitId, 0, first);
    expect(one).toEqual({ status: 200, body: { parts: [{ seq: 0, path: first, ms: 2000 }], complete: false } });
    // the answer did not arrive and the phone asks again: the same answer, and still one part
    expect(await register(a, visitId, 0, first)).toEqual(one);
    const row = (await store.getVisit(a.userId, visitId))!;
    expect(row.audio_parts).toEqual([{ path: first, ms: 2000 }]);
    // parts still arriving: the server does not hold the recording yet
    expect(row.audio_path).toBeNull();
    expect(row.status).toBe("recording");

    const second = await put(a, visitId, tone(900, 2000));
    expect((await register(a, visitId, 1, second)).body.parts).toEqual([
      { seq: 0, path: first, ms: 2000 },
      { seq: 1, path: second, ms: 900 },
    ]);
    expect(await (await partsGET(req("GET", `/api/visits/${visitId}/parts`, a), params(visitId))).json()).toMatchObject({ parts: [{ seq: 0 }, { seq: 1 }], complete: false });
  });

  it("out of order, a second file for a part that is there, the same file twice: refused, with what the server has", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const first = await put(a, visitId, tone(2000, 1000));
    const other = await put(a, visitId, tone(2000, 2000));
    // the first part is not there yet
    expect(await register(a, visitId, 1, other)).toEqual({ status: 409, body: { error: "out_of_order", have: 0 } });
    expect((await register(a, visitId, 0, first)).status).toBe(200);
    // a confirmed part is never replaced (the phone may have dropped its copy of it)
    expect(await register(a, visitId, 0, other)).toEqual({ status: 409, body: { error: "part_exists", have: 1 } });
    expect(await register(a, visitId, 2, other)).toEqual({ status: 409, body: { error: "out_of_order", have: 1 } });
    expect(await register(a, visitId, 1, first)).toEqual({ status: 409, body: { error: "part_exists", have: 1 } });
    expect((await store.getVisit(a.userId, visitId))!.audio_parts).toEqual([{ path: first, ms: 2000 }]);
  });

  it("only his own recording file of this visit, in storage, a 16 kHz mono 16-bit WAV with audio in it", async () => {
    const a = await him();
    const b = await him();
    const visitId = await startRecording(a);
    const otherVisit = await startRecording(a);
    const prefix = await prefixOf(a);
    // another visit's file, another account's file, a sentence clip, a name that is not a recording, a path that climbs
    const elsewhere = await put(a, otherVisit, tone(500, 1));
    const theirs = await put(b, await startRecording(b), tone(500, 1));
    const clip = await put(a, visitId, tone(500, 1), "segments/u1.wav");
    const named = await put(a, visitId, tone(500, 1), "other.wav");
    for (const p of [elsewhere, theirs, clip, named, `${prefix}/visits/${visitId}/../${otherVisit}/recording-x.wav`]) {
      expect(await register(a, visitId, 0, p), p).toEqual({ status: 400, body: { error: "invalid_audio_path" } });
    }
    // never uploaded
    expect((await register(a, visitId, 0, `${prefix}/visits/${visitId}/recording-missing.wav`)).status).toBe(404);
    // a WAV, but not what the phone records: 48 kHz; and one with no audio
    const fast = await put(a, visitId, encodeWav(new Int16Array(4800), 48_000));
    expect(await register(a, visitId, 0, fast)).toMatchObject({ status: 415, body: { error: "wrong_format" } });
    const empty = await put(a, visitId, encodeWav(new Int16Array(0)));
    expect(await register(a, visitId, 0, empty)).toMatchObject({ status: 415, body: { error: "empty" } });
    expect("audio_parts" in (await store.getVisit(a.userId, visitId))!).toBe(false);
    // someone else's sign-in does not reach his visit at all
    const mine = await put(a, visitId, tone(500, 1));
    expect((await partsPOST(req("POST", `/api/visits/${visitId}/parts`, b, { seq: 0, path: mine }), params(visitId))).status).toBe(404);
    expect((await partsGET(req("GET", `/api/visits/${visitId}/parts`, b), params(visitId))).status).toBe(404);
  });

  it("no more parts than a visit may have; none on a planned visit or one he confirmed", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const prefix = await prefixOf(a);
    // the list is full (written directly: nothing here uploads sixteen files)
    const full = Array.from({ length: MAX_PARTS }, (_, i) => ({ path: `${prefix}/visits/${visitId}/recording-full-${i}.wav`, ms: 2000 }));
    await store.updateVisit(a.userId, visitId, { audio_parts: full });
    const extra = await put(a, visitId, tone(500, 1));
    expect((await register(a, visitId, MAX_PARTS, extra)).status).toBe(413);

    await store.upsertVisit(a.userId, { id: "visit-planned", kind: "clinic", place: "Clinic", day: 5, status: "planned" });
    await store.upsertVisit(a.userId, { id: "visit-done", kind: "clinic", place: "Clinic", day: 0, status: "confirmed" });
    for (const id of ["visit-planned", "visit-done"]) {
      const p = await put(a, id, tone(500, 1));
      expect(await register(a, id, 0, p), id).toMatchObject({ status: 409, body: { error: "not_recorded" } });
    }
  });
});

describe("one visit, one job: the transcript and the clips of a recording in parts", () => {
  it("the phone says how many parts; with fewer on the server nothing starts and the answer says what is there", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const first = await put(a, visitId, tone(2000, 1000));
    await register(a, visitId, 0, first);
    const res = await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 3 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "parts_missing", have: 1 });
    expect(await store.getVisit(a.userId, visitId)).toMatchObject({ status: "recording", audio_path: null });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(0);
    // a path that is not the first part is not this recording
    const res2 = await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 1, audio_path: await put(a, visitId, tone(500, 1)) }));
    expect(res2.status).toBe(400);
  });

  it("the service gets each part once; the times run over the whole visit; the sentence the cut went through is one line with one clip", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const paths = await threeParts(a, visitId);
    hearParts();
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 3, audio_path: paths[0] }))).json()) as { job_id: string; status: string; wait_ms: number };
    expect(job.status).toBe("pending");
    // the list is closed: the visit has its whole recording, named by the first part
    expect(await store.getVisit(a.userId, visitId)).toMatchObject({ status: "transcribing", audio_path: paths[0], audio_parts: PARTS.map((p, i) => ({ path: paths[i], ms: p.ms })) });
    // nothing more is taken for it
    expect(await register(a, visitId, 3, await put(a, visitId, tone(500, 1)))).toMatchObject({ status: 409, body: { error: "recording_complete" } });
    expect(await (await partsGET(req("GET", `/api/visits/${visitId}/parts`, a), params(visitId))).json()).toMatchObject({ complete: true, path: paths[0] });

    const done = await settle(a, job.job_id, visitId);
    expect(done).toMatchObject({ status: "done", source: "audio" });
    expect((done.utterances as { tStartMs: number; tEndMs: number; text: string }[]).map((u) => [u.tStartMs, u.tEndMs, u.text])).toEqual([
      [300, 900, "Doctor, can I record?"],
      // 1500 of part 0 to 700 of part 1, which starts at 2000
      [1500, 2700, "At home, we want it below 135 over 85."],
      [2900, 3400, "Sure, no problem."],
      // part 2 starts at 4200
      [4300, 5000, "Come back in six weeks."],
    ]);
    // one piece of work: three files, each once, each its own size
    const files = fake.calls.filter((c) => c.path === "/v1/file");
    expect(files.map((c) => c.bytes)).toEqual(PARTS.map((p) => 44 + p.ms * 32));

    const fin = await finalizePOST(req("POST", `/api/visits/${visitId}/finalize`, a, { job_id: job.job_id }), params(visitId));
    expect(fin.status).toBe(200);
    const view = ((await fin.json()) as { view: VisitView }).view;
    expect(view.visit.status).toBe("review");
    expect(view.lines.map((l) => l.text)).toEqual(["Doctor, can I record?", "At home, we want it below 135 over 85.", "Sure, no problem.", "Come back in six weeks."]);

    // every line has its clip, cut from the right file; the line across the cut is cut from both and joined
    const lines = (await store.listUtterances(a.userId, visitId)).filter((u) => u.lang !== "x-superseded").sort((x, y) => x.t_start_ms - y.t_start_ms);
    expect(lines.map((u) => [u.t_start_ms, u.t_end_ms])).toEqual([
      [300, 900],
      [1500, 2700],
      [2900, 3400],
      [4300, 5000],
    ]);
    const samples = async (clipPath: string | null) => {
      const bytes = (await getBlobStore().getObject("audio", clipPath!))!.bytes;
      const info = parseWav(bytes)!;
      expect(info.sampleRate).toBe(16_000);
      return Array.from(new Int16Array(bytes.slice(info.dataOffset, info.dataOffset + info.dataLength).buffer));
    };
    expect(new Set(await samples(lines[0].clip_path))).toEqual(new Set([1000]));
    expect((await samples(lines[0].clip_path)).length).toBe(600 * 16);
    const across = await samples(lines[1].clip_path);
    expect(across.length).toBe(1200 * 16);
    // the last half second of part 0, then the first 0.7 s of part 1, nothing lost and nothing twice at the cut
    expect(new Set(across.slice(0, 500 * 16))).toEqual(new Set([1000]));
    expect(new Set(across.slice(500 * 16))).toEqual(new Set([2000]));
    expect(new Set(await samples(lines[2].clip_path))).toEqual(new Set([2000]));
    expect(new Set(await samples(lines[3].clip_path))).toEqual(new Set([3000]));
    expect((await samples(lines[3].clip_path)).length).toBe(700 * 16);
  });

  it("a part that is no longer in storage: the job fails, half a visit is never the record", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const paths = await threeParts(a, visitId);
    hearParts();
    await getBlobStore().removeObjects("audio", [paths[1]]);
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 3 }))).json()) as { job_id: string };
    const st = await settle(a, job.job_id, visitId);
    expect(st).toMatchObject({ status: "failed" });
    expect(String(st.error)).toContain("no_audio");
    expect((await store.listUtterances(a.userId, visitId)).filter((u) => u.lang !== "x-superseded")).toEqual([]);
  });

  it("a visit in one file is exactly as before: the same request, the same row, no list", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const p = await put(a, visitId, tone(3000, 500));
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: p }))).json()) as { job_id: string };
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "done", source: "audio" });
    const row = (await store.getVisit(a.userId, visitId))!;
    expect(row).toMatchObject({ status: "transcribing", audio_path: p });
    expect("audio_parts" in row).toBe(false);
    expect(fake.calls.filter((c) => c.path === "/v1/file").map((c) => c.bytes)).toEqual([44 + 3000 * 32]);
    await finalizePOST(req("POST", `/api/visits/${visitId}/finalize`, a, { job_id: job.job_id }), params(visitId));
    const lines = (await store.listUtterances(a.userId, visitId)).filter((u) => u.lang !== "x-superseded");
    expect(lines.length).toBeGreaterThan(0);
    // its clips are cut from the one file, as before
    expect(lines.filter((u) => u.clip_path).length).toBeGreaterThan(0);
    expect((await (await partsGET(req("GET", `/api/visits/${visitId}/parts`, a), params(visitId))).json()) as unknown).toEqual({ parts: [], complete: true, path: p });
  });

  it("parts still arriving are not a recording: without the phone's word the visit goes on as one with none", async () => {
    process.env.SPEECH_PROVIDER = "mock";
    const a = await him();
    const visitId = await startRecording(a);
    const first = await put(a, visitId, tone(2000, 1000));
    await register(a, visitId, 0, first);
    // ended from a phone that has no copy (no parts, no path): the recording was never whole
    const res = await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId }));
    expect(await res.json()).toEqual({ job_id: null, status: "awaiting_transcript", audio_saved: false });
    const row = (await store.getVisit(a.userId, visitId))!;
    expect(row).toMatchObject({ status: "awaiting_transcript", audio_path: null });
    // the part that did arrive is still the visit's (the sweep must not take it; retention removes it with the visit's folder)
    expect(row.audio_parts).toEqual([{ path: first, ms: 2000 }]);
  });

  it("a recording in one file handed over for a visit that lists parts of an upload nobody finished: the file is the recording, the list goes", async () => {
    process.env.SPEECH_PROVIDER = "mock";
    const a = await him();
    const visitId = await startRecording(a);
    await register(a, visitId, 0, await put(a, visitId, tone(2000, 1000)));
    const whole = await put(a, visitId, tone(1500, 7));
    const res = await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, audio_path: whole }));
    expect(await res.json()).toEqual({ job_id: null, status: "awaiting_transcript", audio_saved: true });
    const row = (await store.getVisit(a.userId, visitId))!;
    expect(row.audio_path).toBe(whole);
    expect("audio_parts" in row).toBe(false);
  });
});

describe("a long recording that waits for its text", () => {
  it("the service is down at the end: the visit waits with every part; the scheduled pass sends them in one submission", async () => {
    const a = await him();
    const visitId = await startRecording(a);
    const paths = await threeParts(a, visitId);
    hearParts();
    fake.mode = "down";
    const job = (await (await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 3 }))).json()) as { job_id: string };
    expect(await settle(a, job.job_id, visitId)).toMatchObject({ status: "failed", deferred: true, awaiting_transcript: true });
    expect(await store.getVisit(a.userId, visitId)).toMatchObject({ status: "awaiting_transcript", audio_path: paths[0] });

    fake.mode = "up";
    fake.calls.length = 0;
    expect((await pendingTranscriptPass(store, { speech: provider })).sent).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 200 && (await store.getVisit(a.userId, visitId))?.status === "transcribing"; i++) {
      await pendingTranscriptPass(store, { speech: provider });
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await store.getVisit(a.userId, visitId))?.status).toBe("review");
    // this visit's three files, each once, in order (the pass also sends other tests' waiting visits: other sizes)
    const sizes = PARTS.map((p) => 44 + p.ms * 32);
    expect(fake.calls.filter((c) => c.path === "/v1/file" && sizes.includes(c.bytes)).map((c) => c.bytes)).toEqual(sizes);
    // one submission of this visit, whatever the number of files (the existing rule: at most three in all)
    const tries = (await store.listDeliveries(a.userId)).filter((d) => d.kind === TRANSCRIPT_TRY && d.ref === visitId);
    expect(tries).toHaveLength(1);
    const lines = (await store.listUtterances(a.userId, visitId)).filter((u) => u.lang !== "x-superseded").sort((x, y) => x.t_start_ms - y.t_start_ms);
    expect(lines.map((u) => [u.t_start_ms, u.text])).toEqual([
      [300, "Doctor, can I record?"],
      [1500, "At home, we want it below 135 over 85."],
      [2900, "Sure, no problem."],
      [4300, "Come back in six weeks."],
    ]);
    expect(lines.every((u) => !!u.clip_path)).toBe(true);
  }, 30_000);

  it("the time a job is given covers every part", () => {
    const cfg = provider.config;
    const one = Math.max(cfg.jobDeadlineMs, 2 * 20 * 60_000);
    expect(provider.budgetMsForParts([20 * 60_000, 20 * 60_000, 60_000])).toBe(one + one + Math.max(cfg.jobDeadlineMs, 120_000) + (one + cfg.redoWaitMs) * (cfg.redoWaitMs > 0 ? cfg.redoAttempts : 0));
    expect(provider.budgetMsForParts([])).toBe((cfg.jobDeadlineMs + cfg.redoWaitMs) * (cfg.redoWaitMs > 0 ? cfg.redoAttempts : 0));
  });
});

describe("「听录音」 on a recording in parts", () => {
  it("every part has its own short link, in order; nothing past the last; a recording in one file has only the first", async () => {
    process.env.SPEECH_PROVIDER = "mock";
    const a = await him();
    const visitId = await startRecording(a);
    const paths = await threeParts(a, visitId);
    // while the parts are still arriving there is nothing to listen to
    expect((await listenGET(req("GET", `/api/me/export/recording?visit=${visitId}`, a))).status).toBe(404);
    await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: visitId, parts: 3 }));
    const where = async (q: string) => {
      const res = await listenGET(req("GET", `/api/me/export/recording?visit=${visitId}${q}`, a));
      return res.status === 302 ? decodeURIComponent(res.headers.get("location") ?? "") : res.status;
    };
    // the first part, with and without its number
    for (const q of ["", "&part=0"]) expect(String(await where(q))).toContain("/api/blob/read");
    const seen: string[] = [];
    for (const [i] of paths.entries()) {
      const res = await listenGET(req("GET", `/api/me/export/recording?visit=${visitId}&part=${i}`, a));
      expect(res.status).toBe(302);
      const got = await fetchLocal(res.headers.get("location")!);
      seen.push(String(new Int16Array(got.slice(44, 46).buffer)[0]));
    }
    // the three files, in the visit's order (their samples say which)
    expect(seen).toEqual(PARTS.map((p) => String(p.value)));
    expect(await where("&part=3")).toBe(404);
    expect(await where("&part=-1")).toBe(404);
    expect(await where("&part=x")).toBe(404);

    const single = await startRecording(a);
    const p = await put(a, single, tone(800, 9));
    await asrJobsPOST(req("POST", "/api/asr/jobs", a, { visit_id: single, audio_path: p }));
    expect((await listenGET(req("GET", `/api/me/export/recording?visit=${single}`, a))).status).toBe(302);
    expect((await listenGET(req("GET", `/api/me/export/recording?visit=${single}&part=1`, a))).status).toBe(404);
  });
});

/** The bytes behind a local signed read link (the local driver's own route). */
async function fetchLocal(location: string): Promise<Uint8Array> {
  const { GET } = await import("@/app/api/blob/read/route");
  const res = await GET(new NextRequest(location));
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}
