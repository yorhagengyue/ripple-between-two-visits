/**
 * SPEECH_PROVIDER=tencent (lib/asr/tencent.ts) against a fake Tencent Cloud ASR (./fake-tencent.ts): the configuration and
 * its problems, the signed request and its shape (CreateRecTask, DescribeTaskStatus, version 2019-06-14, region
 * ap-singapore, engine 16k_zh_en), the answers read (ResultDetail, else the timed Result lines), the 5 MB Data limit,
 * every error code mapped to the reasons the routes act on, the free health check, the cut into pieces at pauses, and
 * the whole-visit job (pieces three at a time on the recording's clock, one more try after a short failure, the live
 * lines when the service cannot make it, his cancelling).
 */
import { describe, expect, it } from "vitest";
import {
  asLiveTranscriber,
  getLiveTranscriber,
  getSpeechProvider,
  livePartials,
  speechProviderName,
  TencentSpeechProvider,
  WhisperUnavailable,
  type FileJobInput,
  type FileJobResult,
} from "@/lib/asr";
import { lineLang, pieceSpans, sentencesOf, TENCENT_ASR_DEFAULTS, TENCENT_ASR_MAX_DATA_BYTES, TencentAsrClient, tencentAsrConfig, tencentReason, type TencentAsrConfig } from "@/lib/asr/tencent";
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { FAKE_SECRET_ID, FAKE_SECRET_KEY, fakeConfig, fakeTencent, type FakeTencent } from "./fake-tencent";

const instant = async () => {};

/** `totalMs` of 16 kHz audio: a 300 Hz tone where someone speaks, a faint hiss elsewhere. */
function speechWav(totalMs: number, speech: [number, number][]): Uint8Array {
  const n = Math.round((totalMs * 16_000) / 1000);
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const ms = (i / 16_000) * 1000;
    const loud = speech.some(([a, b]) => ms >= a && ms < b);
    samples[i] = loud ? Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / 16_000)) : ((i * 7919) % 41) - 20;
  }
  return encodeWav(samples);
}

function client(fake: FakeTencent, config: TencentAsrConfig = fakeConfig()) {
  return new TencentAsrClient(config, { fetch: fake.fetch, sleep: instant });
}

function provider(fake: FakeTencent, config: TencentAsrConfig = fakeConfig()) {
  return new TencentSpeechProvider({ config, fetch: fake.fetch, sleep: instant });
}

async function settle(p: TencentSpeechProvider, jobId: string): Promise<FileJobResult> {
  for (let i = 0; i < 500; i++) {
    const r = await p.getFileJob(jobId);
    if (r.status !== "pending") return r;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("the job is still pending");
}

describe("the configuration", () => {
  it("defaults to Singapore and the large Mandarin-English engine, and names a problem, never a value", () => {
    const c = tencentAsrConfig({ TENCENT_SECRET_ID: "id", TENCENT_SECRET_KEY: "key" });
    expect(c).toMatchObject({ region: "ap-singapore", engine: "16k_zh_en", endpoint: "asr.ap-singapore.tencentcloudapi.com", problem: null });
    expect(TENCENT_ASR_DEFAULTS).toMatchObject({ region: "ap-singapore", engine: "16k_zh_en", pieceMs: 100_000, concurrency: 3 });
    expect(tencentAsrConfig({}).problem).toBe("no_keys");
    expect(tencentAsrConfig({ TENCENT_SECRET_KEY: "key" }).problem).toBe("no_secret_id");
    expect(tencentAsrConfig({ TENCENT_SECRET_ID: "id" }).problem).toBe("no_secret_key");
    const keys = { TENCENT_SECRET_ID: "id", TENCENT_SECRET_KEY: "key" };
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_REGION: "Singapore" }).problem).toBe("bad_region");
    // the phone records 16 kHz mono: an 8 kHz (telephone) engine is refused
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_ENGINE: "8k_zh" }).problem).toBe("bad_engine");
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_ENGINE: "16k_zh-PY" })).toMatchObject({ engine: "16k_zh-PY", problem: null });
    // a signed request and his recording go only to Tencent's own ASR hosts
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_ENDPOINT: "asr.evil.example.com" }).problem).toBe("bad_endpoint");
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_ENDPOINT: "ASR.tencentcloudapi.com" })).toMatchObject({ endpoint: "asr.tencentcloudapi.com", problem: null });
    expect(tencentAsrConfig({ ...keys, TENCENT_ASR_REGION: "ap-hongkong" }).endpoint).toBe("asr.ap-hongkong.tencentcloudapi.com");
  });

  it("SPEECH_PROVIDER=tencent picks it; it is a live transcriber with whole lines only", () => {
    expect(speechProviderName({ SPEECH_PROVIDER: "Tencent" })).toBe("tencent");
    const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
    g.__rippleSpeech?.delete("tencent");
    try {
      const p = getSpeechProvider({ SPEECH_PROVIDER: "tencent", TENCENT_SECRET_ID: "id", TENCENT_SECRET_KEY: "key" });
      expect(p).toBeInstanceOf(TencentSpeechProvider);
      expect(p.name).toBe("tencent");
      const live = getLiveTranscriber({ SPEECH_PROVIDER: "tencent" });
      expect(live).toBe(p);
      expect(livePartials(live!)).toBe(false);
    } finally {
      g.__rippleSpeech?.delete("tencent");
    }
    // a provider made by another bundle's copy of the class is recognised by its name and its client
    const foreign = { name: "tencent", client: {}, createFileJob: () => undefined };
    expect(foreign instanceof TencentSpeechProvider).toBe(true);
    expect({ name: "whisper", client: {}, createFileJob: () => undefined } instanceof TencentSpeechProvider).toBe(false);
    expect(asLiveTranscriber(getSpeechProvider({}))).toBeNull();
  });
});

describe("one recognition", () => {
  it("signs the request (TC3, service asr) and sends the WAV as CreateRecTask asks: 16 kHz engine, mono, base64 and its length", async () => {
    const fake = fakeTencent();
    const wav = speechWav(3000, [[200, 2800]]);
    const r = await client(fake).recognize(wav, { deadlineMs: 5000 });
    expect(r.text).toBe("Please don't change the dose yourself.");
    const [create, ...polls] = fake.calls;
    expect(create.action).toBe("CreateRecTask");
    expect(create.host).toBe("asr.ap-singapore.tencentcloudapi.com");
    expect(create.signatureOk).toBe(true);
    expect(create.headers).toMatchObject({ "x-tc-version": "2019-06-14", "x-tc-region": "ap-singapore", "content-type": "application/json; charset=utf-8" });
    expect(create.headers.authorization).toMatch(new RegExp(`^TC3-HMAC-SHA256 Credential=${FAKE_SECRET_ID}/\\d{4}-\\d{2}-\\d{2}/asr/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$`));
    expect(create.body).toMatchObject({ EngineModelType: "16k_zh_en", ChannelNum: 1, ResTextFormat: 2, SourceType: 1, DataLen: wav.byteLength });
    // the medicines Ripple knows, as hot words (10-14)
    expect(String(create.body.HotwordList).split(",")).toEqual(expect.arrayContaining(["amlodipine|11", "paracetamol|11", "ibuprofen|11", "氨氯地平|11"]));
    expect(Buffer.from(create.body.Data as string, "base64").equals(Buffer.from(wav))).toBe(true);
    expect(polls.map((c) => c.action)).toEqual(["DescribeTaskStatus", "DescribeTaskStatus"]);
    expect(polls.every((c) => c.body.TaskId === polls[0].body.TaskId && c.signatureOk)).toBe(true);
    // the secret key is only ever used to sign: it is in no request
    expect(JSON.stringify(fake.calls)).not.toContain(FAKE_SECRET_KEY);
  });

  it("the engine is the configured one", async () => {
    const fake = fakeTencent();
    await client(fake, fakeConfig({ TENCENT_ASR_ENGINE: "16k_zh_large" })).recognize(speechWav(1000, [[100, 900]]), { deadlineMs: 5000 });
    expect(fake.calls[0].body.EngineModelType).toBe("16k_zh_large");
  });

  it("reads the sentences of ResultDetail, or the timed lines of Result when there is no detail; a line's language from its letters", async () => {
    const fake = fakeTencent();
    fake.sentencesFor = () => [
      { text: "陈先生，这是 amlodipine，每天早上服用一粒。", startMs: 0, endMs: 7300 },
      { text: "Please don't change the dose yourself.", startMs: 7400, endMs: 9800 },
    ];
    const a = await client(fake).recognize(speechWav(10_000, [[0, 9800]]), { deadlineMs: 5000 });
    expect(a.sentences.map((s) => [s.start_ms, s.end_ms, s.lang])).toEqual([
      [0, 7300, "zh"],
      [7400, 9800, "en"],
    ]);
    expect(a.text).toBe("陈先生，这是 amlodipine，每天早上服用一粒。Please don't change the dose yourself.");
    fake.resultTextOnly = true;
    const b = await client(fake).recognize(speechWav(10_000, [[0, 9800]]), { deadlineMs: 5000 });
    expect(b.sentences.map((s) => [s.start_ms, s.end_ms, s.text])).toEqual(a.sentences.map((s) => [s.start_ms, s.end_ms, s.text]));
    // the real service's own line, with a speaker number after the times
    expect(sentencesOf({ Result: "[0:0.000,0:2.150,0]  Please don't change the dose yourself.\n[0:3.050,0:7.250,0]  If your readings are high, write them down.\n" })).toEqual([
      { start_ms: 0, end_ms: 2150, text: "Please don't change the dose yourself.", lang: "en" },
      { start_ms: 3050, end_ms: 7250, text: "If your readings are high, write them down.", lang: "en" },
    ]);
    expect(sentencesOf({ Result: "", ResultDetail: [] })).toEqual([]);
    expect(sentencesOf({ ResultDetail: [{ FinalSentence: 3 }] })).toBeNull();
    expect(lineLang("Doctor, 我膝盖痛")).toBe("zh");
    expect(lineLang("Amlodipine 5 mg")).toBe("en");
    expect(lineLang("…")).toBeNull();
  });

  it("a live line: the chunk answer the route reads (text, language, sentences, the engine as the model)", async () => {
    const fake = fakeTencent();
    const wav = speechWav(2500, [[100, 2300]]);
    const r = await client(fake).chunk(wav, { kind: "final", langHint: null });
    expect(r).toMatchObject({ text: "Please don't change the dose yourself.", lang: "en", model: "tencent:16k_zh_en", confidence: null });
    expect(r.durationMs).toBe(parseWav(wav)!.durationMs);
    expect(r.segments).toEqual([{ start_ms: 0, end_ms: 2150, text: "Please don't change the dose yourself.", lang: "en" }]);
  });

  it("more than 5 MB of base64 is refused here, as a client error, and nothing is sent", async () => {
    const fake = fakeTencent();
    const big = new Uint8Array(Math.ceil((TENCENT_ASR_MAX_DATA_BYTES * 3) / 4) + 16);
    const err = await client(fake).recognize(big, { deadlineMs: 5000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhisperUnavailable);
    expect((err as WhisperUnavailable).reason).toBe("too_large");
    expect((err as WhisperUnavailable).clientError).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("what the service says, as the routes read it", () => {
  it("maps every documented error code to a reason", () => {
    expect(tencentReason("AuthFailure.SignatureFailure")).toMatchObject({ reason: "unauthorized" });
    expect(tencentReason("AuthFailure.SecretIdNotFound")).toMatchObject({ reason: "unauthorized" });
    expect(tencentReason("FailedOperation.CheckAuthInfoFailed")).toMatchObject({ reason: "unauthorized" });
    expect(tencentReason("FailedOperation.UserNotRegistered")).toMatchObject({ reason: "not_configured:service_not_enabled" });
    expect(tencentReason("FailedOperation.ServiceIsolate")).toMatchObject({ reason: "not_configured:service_isolated" });
    expect(tencentReason("FailedOperation.UserHasNoFreeAmount")).toMatchObject({ reason: "not_configured:no_balance" });
    expect(tencentReason("UnsupportedRegion")).toMatchObject({ reason: "not_configured:UnsupportedRegion" });
    expect(tencentReason("RequestLimitExceeded.UinLimitExceeded")).toEqual({ reason: "busy", status: 429, retryAfterMs: 1000 });
    expect(tencentReason("InvalidParameterValue")).toEqual({ reason: "rejected_400_InvalidParameterValue", status: 400 });
    expect(tencentReason("MissingParameter")).toEqual({ reason: "rejected_400_MissingParameter", status: 400 });
    expect(tencentReason("FailedOperation.ErrorRecognize")).toEqual({ reason: "rejected_422_ErrorRecognize", status: 422 });
    expect(tencentReason("FailedOperation.NoSuchTask")).toMatchObject({ reason: "job_lost" });
    expect(tencentReason("InternalError.FailAccessDatabase")).toEqual({ reason: "http_503_InternalError_FailAccessDatabase", status: 503 });
  });

  it("the client throws them as WhisperUnavailable: misconfigured, busy, a client error, a failure of the service", async () => {
    const cases: [string, (e: WhisperUnavailable) => void][] = [
      ["AuthFailure.SignatureFailure", (e) => expect(e.misconfigured).toBe(true)],
      ["FailedOperation.UserNotRegistered", (e) => expect(e.misconfigured).toBe(true)],
      ["RequestLimitExceeded", (e) => expect([e.busy, e.retryAfterMs]).toEqual([true, 1000])],
      ["InvalidParameterValue", (e) => expect(e.clientError).toBe(true)],
      ["InternalError", (e) => expect([e.clientError, e.misconfigured, e.busy]).toEqual([false, false, false])],
    ];
    for (const [code, check] of cases) {
      const fake = fakeTencent();
      fake.errorFor.CreateRecTask = code;
      const err = (await client(fake).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 5000 }).catch((e: unknown) => e)) as WhisperUnavailable;
      expect(err, code).toBeInstanceOf(WhisperUnavailable);
      check(err);
      // the vendor's message is never part of what is thrown
      expect(err.message, code).not.toContain("fake message");
    }
    const fake = fakeTencent();
    fake.taskFails = true;
    const failed = (await client(fake).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 5000 }).catch((e: unknown) => e)) as WhisperUnavailable;
    expect([failed.reason, failed.clientError]).toEqual(["rejected_422_task_failed", true]);
  });

  it("no connection is unreachable; no answer in time is timeout; a wrong secret is unauthorized", async () => {
    const down = fakeTencent();
    down.network = "down";
    expect(((await client(down).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 5000 }).catch((e: unknown) => e)) as WhisperUnavailable).reason).toBe("unreachable");
    const hang = fakeTencent();
    hang.network = "hang";
    const quick = { ...fakeConfig(), requestTimeoutMs: 50 };
    expect(((await client(hang, quick).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 300 }).catch((e: unknown) => e)) as WhisperUnavailable).reason).toBe("timeout");
    const wrong = fakeTencent();
    const err = (await client(wrong, { ...fakeConfig(), secretKey: "not the secret" }).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 5000 }).catch((e: unknown) => e)) as WhisperUnavailable;
    expect(err.reason).toBe("unauthorized");
    // no keys: nothing is sent at all
    const none = fakeTencent();
    const missing = (await client(none, tencentAsrConfig({})).recognize(speechWav(1000, [[0, 900]]), { deadlineMs: 5000 }).catch((e: unknown) => e)) as WhisperUnavailable;
    expect([missing.reason, missing.misconfigured, none.calls.length]).toEqual(["not_configured:no_keys", true, 0]);
  });

  it("the health check recognises nothing: a task that does not exist means the keys and the service answer", async () => {
    const fake = fakeTencent();
    expect(await client(fake).check()).toBeNull();
    expect(fake.calls.map((c) => [c.action, c.body.TaskId])).toEqual([["DescribeTaskStatus", 1]]);
    const wrong = fakeTencent();
    expect(await client(wrong, { ...fakeConfig(), secretKey: "nope" }).check()).toBe("unauthorized");
    const off = fakeTencent();
    off.errorFor.DescribeTaskStatus = "FailedOperation.UserNotRegistered";
    expect(await client(off).check()).toBe("not_configured:service_not_enabled");
  });

  it("probe: a good answer is kept a minute, a timeout asks again now; no keys never asks", async () => {
    const fake = fakeTencent();
    const p = provider(fake);
    expect(await p.probe()).toBeNull();
    expect(await p.probe()).toBeNull();
    expect(fake.calls).toHaveLength(1);
    expect(await p.probe(1000)).toBeNull();
    expect(fake.calls).toHaveLength(2);
    const none = fakeTencent();
    expect(await provider(none, tencentAsrConfig({})).probe()).toBe("not_configured:no_keys");
    expect(none.calls).toHaveLength(0);
    await expect(provider(none, tencentAsrConfig({})).realtimeToken()).rejects.toMatchObject({ code: "unavailable", message: "not_configured:no_keys" });
    expect((await p.realtimeToken()).token).toMatch(/^tencent-lines-/);
  });
});

describe("the whole visit, in pieces", () => {
  it("pieces of at most 100 s, each cut in the middle of a pause near its end, end to end", () => {
    const wav = speechWav(230_000, [
      [0, 93_000],
      [94_500, 185_000],
      [186_000, 230_000],
    ]);
    const info = parseWav(wav)!;
    const samples = new Int16Array(wav.buffer.slice(info.dataOffset, info.dataOffset + info.dataLength));
    const spans = pieceSpans(samples, 16_000, { maxMs: 100_000 });
    expect(spans).toHaveLength(3);
    expect(spans[0].startMs).toBe(0);
    expect(spans.at(-1)!.endMs).toBe(230_000);
    for (let i = 1; i < spans.length; i++) expect(spans[i].startMs).toBe(spans[i - 1].endMs);
    for (const s of spans) expect(s.endMs - s.startMs).toBeLessThanOrEqual(100_000);
    // the cuts fall in the two pauses, not inside the speech
    expect(spans[0].endMs).toBeGreaterThan(93_000);
    expect(spans[0].endMs).toBeLessThan(94_500);
    expect(spans[1].endMs).toBeGreaterThan(185_000);
    expect(spans[1].endMs).toBeLessThan(186_000);
    // a recording under the limit is one piece; nothing at all is one empty piece
    expect(pieceSpans(samples.subarray(0, 16_000 * 60), 16_000, { maxMs: 100_000 })).toEqual([{ startMs: 0, endMs: 60_000 }]);
    expect(pieceSpans(new Int16Array(0), 16_000, { maxMs: 100_000 })).toEqual([{ startMs: 0, endMs: 0 }]);
    // speech with no pause at all is still cut, at its quietest frame, and every piece fits
    const solid = new Int16Array(16_000 * 250).map((_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / 16_000)));
    for (const s of pieceSpans(solid, 16_000, { maxMs: 100_000 })) expect(s.endMs - s.startMs).toBeLessThanOrEqual(100_000);
  });

  it("a recording of 230 s: three pieces, at most three at a time, each under 5 MB, their lines on the recording's clock", async () => {
    const fake = fakeTencent();
    fake.sentencesFor = (_n, audioMs) => [
      { text: `First of ${Math.round(audioMs / 1000)} s.`, startMs: 1000, endMs: 3000 },
      { text: `Then of ${Math.round(audioMs / 1000)} s.`, startMs: 3200, endMs: 5000 },
      { text: `Later of ${Math.round(audioMs / 1000)} s.`, startMs: 20_000, endMs: 22_000 },
    ];
    const wav = speechWav(230_000, [
      [0, 93_000],
      [94_500, 185_000],
      [186_000, 230_000],
    ]);
    const p = provider(fake);
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav, recorded: true });
    const r = await settle(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", model: "tencent:16k_zh_en" });
    expect(r.fallback).toBeUndefined();
    const creates = fake.calls.filter((c) => c.action === "CreateRecTask");
    expect(creates).toHaveLength(3);
    for (const c of creates) expect((c.body.Data as string).length).toBeLessThanOrEqual(TENCENT_ASR_MAX_DATA_BYTES);
    expect(fake.maxRunning).toBeLessThanOrEqual(3);
    // two sentences 200 ms apart are one line (a pause of 550 ms ends a line); each piece's times move by where it starts
    const lines = r.utterances!.map((u) => [u.text, u.tStartMs, u.speaker]);
    const cut1 = r.utterances![2].tStartMs - 1000;
    const cut2 = r.utterances![4].tStartMs - 1000;
    expect(cut1).toBeGreaterThan(93_000);
    expect(cut1).toBeLessThan(94_500);
    expect(cut2).toBeGreaterThan(185_000);
    expect(cut2).toBeLessThan(186_000);
    expect(lines).toEqual([
      [`First of ${Math.round(cut1 / 1000)} s. Then of ${Math.round(cut1 / 1000)} s.`, 1000, null],
      [`Later of ${Math.round(cut1 / 1000)} s.`, 20_000, null],
      [`First of ${Math.round((cut2 - cut1) / 1000)} s. Then of ${Math.round((cut2 - cut1) / 1000)} s.`, cut1 + 1000, null],
      [`Later of ${Math.round((cut2 - cut1) / 1000)} s.`, cut1 + 20_000, null],
      [`First of ${Math.round((230_000 - cut2) / 1000)} s. Then of ${Math.round((230_000 - cut2) / 1000)} s.`, cut2 + 1000, null],
      [`Later of ${Math.round((230_000 - cut2) / 1000)} s.`, cut2 + 20_000, null],
    ]);
  });

  it("a recording in several files: file after file, the later file's times after the earlier one's audio", async () => {
    const fake = fakeTencent();
    fake.sentencesFor = () => [{ text: "One line.", startMs: 500, endMs: 1500 }];
    const a = speechWav(30_000, [[0, 30_000]]);
    const b = speechWav(20_000, [[0, 20_000]]);
    const p = provider(fake);
    const input: FileJobInput = { url: "signed", lang: "zh-en-mixed", recorded: true, audioParts: [{ ms: 30_000, load: async () => a }, { ms: 20_000, load: async () => b }] };
    const r = await settle(p, (await p.createFileJob(input)).jobId);
    expect(r.utterances!.map((u) => [u.tStartMs, u.tEndMs])).toEqual([
      [500, 1500],
      [30_500, 31_500],
    ]);
  });

  it("scene 1 (10-15): one piece keeps the service's speaker numbers and a sentence of another speaker is a line of its own; TENCENT_ASR_DIARIZE=0 asks for none", async () => {
    const three = () => [
      { text: "Good morning.", startMs: 500, endMs: 1500, speaker: 0 },
      { text: "Morning, doctor.", startMs: 1700, endMs: 2600, speaker: 1 },
      { text: "Please sit.", startMs: 2800, endMs: 3500, speaker: 0 },
    ];
    const fake = fakeTencent();
    fake.sentencesFor = three;
    const p = provider(fake);
    const r = await settle(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(5000, [[0, 4000]]), recorded: true })).jobId);
    const create = fake.calls.find((c) => c.action === "CreateRecTask")!;
    expect(create.body.SpeakerDiarization).toBe(1);
    expect(create.body).not.toHaveProperty("SpeakerNumber"); // 16k engines do not take it (the API page)
    expect(r.utterances!.map((u) => [u.text, u.speaker])).toEqual([
      ["Good morning.", 0],
      ["Morning, doctor.", 1],
      ["Please sit.", 0],
    ]);
    // switched off: not asked, and the SpeakerId 0 the service answers anyway is not read as a speaker
    const off = fakeTencent();
    off.sentencesFor = three;
    const q = provider(off, fakeConfig({ TENCENT_ASR_DIARIZE: "0" }));
    const r2 = await settle(q, (await q.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(5000, [[0, 4000]]), recorded: true })).jobId);
    expect(off.calls.find((c) => c.action === "CreateRecTask")!.body).not.toHaveProperty("SpeakerDiarization");
    expect(r2.utterances!.map((u) => [u.text, u.speaker])).toEqual([["Good morning. Morning, doctor. Please sit.", null]]);
    // a live line never asks for it (one line is one speaker)
    const live = fakeTencent();
    await client(live).chunk(speechWav(2500, [[100, 2300]]), { kind: "final", langHint: null });
    expect(live.calls.find((c) => c.action === "CreateRecTask")!.body).not.toHaveProperty("SpeakerDiarization");
  });

  it("a short failure of one piece is tried once more; a refusal is not (only once more without speaker separation), and the record keeps the live lines", async () => {
    const fake = fakeTencent();
    fake.failCreates = { code: "RequestLimitExceeded", times: 1 };
    const p = provider(fake);
    const ok = await settle(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(5000, [[0, 4000]]), recorded: true })).jobId);
    expect(ok.status).toBe("done");
    expect(fake.calls.filter((c) => c.action === "CreateRecTask")).toHaveLength(2);

    const refused = fakeTencent();
    refused.errorFor.CreateRecTask = "InvalidParameterValue";
    const q = provider(refused);
    const fellBack: string[] = [];
    const live = [{ id: "v-w1", tStartMs: 100, tEndMs: 900, speaker: null, text: "A live line." }];
    const r = await settle(q, (await q.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(5000, [[0, 4000]]), recorded: true, liveUtterances: live, onFallback: (f) => fellBack.push(`${f.reason}>${f.used}`) })).jobId);
    // scene 1 (10-15): the first request asks for speaker separation; refused for a parameter, the piece goes once more
    // without it (an engine that does not separate speakers), and a second refusal is the end
    const creates = refused.calls.filter((c) => c.action === "CreateRecTask");
    expect(creates).toHaveLength(2);
    expect(creates[0].body.SpeakerDiarization).toBe(1);
    expect(creates[1].body).not.toHaveProperty("SpeakerDiarization");
    expect(r).toMatchObject({ status: "done", source: "audio", fallback: { reason: "rejected_400_InvalidParameterValue", used: "live" } });
    expect(r.utterances!.map((u) => u.text)).toEqual(["A live line."]);
    expect(fellBack).toEqual(["rejected_400_InvalidParameterValue>live"]);
  });

  it("with no live lines the job fails and says why (the saved recording waits for its text); never the script", async () => {
    const fake = fakeTencent();
    fake.errorFor.CreateRecTask = "AuthFailure.SignatureFailure";
    const p = provider(fake);
    const r = await settle(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(3000, [[0, 2000]]), recorded: true, fixture: "v2" })).jobId);
    expect(r).toMatchObject({ status: "failed", error: "tencent_unavailable:unauthorized", fallback: { reason: "unauthorized", used: "none" } });
    // a recorded visit whose recording did not reach the server: the live lines or nothing, never the replay
    const q = provider(fakeTencent());
    const missing = await settle(q, (await q.createFileJob({ url: "x", lang: "zh-en-mixed", recorded: true, fixture: "v2", missingAudio: "upload_failed" })).jobId);
    expect(missing).toMatchObject({ status: "failed", fallback: { reason: "upload_failed", used: "none" } });
    // a sample replay (no recording) is the replay file, as with mock
    const replay = await settle(q, (await q.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" })).jobId);
    expect(replay).toMatchObject({ status: "done", source: "fixture" });
  });

  it("a file that is not 16 kHz mono 16-bit is refused, not sent", async () => {
    const fake = fakeTencent();
    const p = provider(fake);
    const r = await settle(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: encodeWav(new Int16Array(8000), 8000), recorded: true })).jobId);
    expect(r).toMatchObject({ status: "failed", fallback: { reason: "rejected_415_format" } });
    expect(fake.calls).toHaveLength(0);
  });

  it("he chooses not to wait: the pieces stop and the record keeps the live lines", async () => {
    const fake = fakeTencent();
    fake.network = "hang";
    const p = provider(fake);
    const live = [{ id: "v-w1", tStartMs: 100, tEndMs: 900, speaker: null, text: "A live line." }];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: speechWav(5000, [[0, 4000]]), recorded: true, liveUtterances: live });
    await new Promise((res) => setTimeout(res, 20));
    expect(await p.cancelFileJob(jobId)).toBe(true);
    const r = await settle(p, jobId);
    expect(r).toMatchObject({ status: "done", fallback: { reason: "cancelled", used: "live" } });
    expect(await p.cancelFileJob(jobId)).toBe(false);
  });

  it("the time the page waits covers every piece three at a time, with one more try each", () => {
    const p = provider(fakeTencent());
    const piece = 2 * TENCENT_ASR_DEFAULTS.pieceTimeoutMs + 1000;
    expect(p.budgetMs(null)).toBe(piece + 5000);
    expect(p.budgetMs(speechWav(250_000, [[0, 1]]))).toBe(piece + 5000);
    expect(p.budgetMsForParts([20 * 60_000, 5 * 60_000])).toBe((Math.ceil(12 / 3) + Math.ceil(3 / 3)) * piece + 5000);
  });
});
