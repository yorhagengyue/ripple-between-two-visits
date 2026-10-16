/**
 * M14 whisper provider without a GPU: configuration, the HTTP client's failure modes (unreachable, timeout,
 * wrong token, busy, loading, garbage), segments -> utterances, and the whole-visit job with its fallbacks
 * (live Whisper lines, then the replay file, else failed) and the asr.fallback hook.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  getSpeechProvider,
  getWhisperProvider,
  SpeechError,
  speechProviderName,
  utterancesFromSegments,
  WhisperClient,
  whisperConfig,
  WhisperSpeechProvider,
  WhisperUnavailable,
  replayFallbackAllowed,
  worstConfidence,
  type FileJobResult,
  type SpeechFallback,
} from "@/lib/asr";
import { encodeWav } from "@/lib/visit/wav";
import { fakeConfig, fakeWhisper, TEST_TOKEN } from "./fake-whisper";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  (globalThis as { __rippleSpeech?: Map<string, unknown> }).__rippleSpeech?.delete("whisper");
});

const wav = (ms = 1000) => encodeWav(new Float32Array(Math.round(ms * 16)).fill(0.01));

async function waitJob(p: WhisperSpeechProvider, jobId: string, timeoutMs = 3000): Promise<FileJobResult> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await p.getFileJob(jobId);
    if (r.status !== "pending") return r;
    if (Date.now() > end) throw new Error("job still pending");
    await new Promise((res) => setTimeout(res, 10));
  }
}

describe("selection and configuration", () => {
  it("SPEECH_PROVIDER=whisper selects the whisper provider; mock stays the default", () => {
    expect(speechProviderName({ SPEECH_PROVIDER: "Whisper" })).toBe("whisper");
    expect(speechProviderName({})).toBe("mock");
    expect(() => speechProviderName({ SPEECH_PROVIDER: "openai-whisper" })).toThrow(SpeechError);
    const p = getSpeechProvider({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "http://127.0.0.1:7810", WHISPER_TOKEN: TEST_TOKEN });
    expect(p).toBeInstanceOf(WhisperSpeechProvider);
    expect(p.name).toBe("whisper");
    expect(getWhisperProvider({})).toBeNull();
  });

  it("validates the URL and the token, and never needs a token value to be printed", () => {
    expect(whisperConfig({}).problem).toBe("no_url");
    expect(whisperConfig({ WHISPER_URL: "ftp://x" }).problem).toBe("bad_url");
    expect(whisperConfig({ WHISPER_URL: "http://user:pw@x:1" }).problem).toBe("bad_url");
    expect(whisperConfig({ WHISPER_URL: "http://x:1" }).problem).toBe("no_token");
    expect(whisperConfig({ WHISPER_URL: "http://x:1", WHISPER_TOKEN: "short" }).problem).toBe("short_token");
    const ok = whisperConfig({ WHISPER_URL: "http://127.0.0.1:7810/", WHISPER_TOKEN: TEST_TOKEN, WHISPER_CHUNK_TIMEOUT_MS: "-5" });
    expect(ok.problem).toBeNull();
    expect(ok.url).toBe("http://127.0.0.1:7810");
    expect(ok.chunkTimeoutMs).toBe(2500); // an invalid number falls back to the default
    expect(ok.finalTimeoutMs).toBe(5000);
    expect(ok.busyFallbackMs).toBe(8000);
    expect(ok.jobStallMs).toBe(20_000);
    // past the service's own 90 s worker_stuck and 120 s exit (services/whisper config.py)
    expect(ok.jobStallGiveUpMs).toBe(180_000);
    // never shorter than the stall check itself
    expect(whisperConfig({ WHISPER_JOB_STALL_MS: "30000", WHISPER_JOB_STALL_GIVEUP_MS: "1000" }).jobStallGiveUpMs).toBe(30_000);
    expect(ok.maxFileBytes).toBe(64 * 1_048_576);
    expect(whisperConfig({ WHISPER_URL: "http://x:1", WHISPER_TOKEN: TEST_TOKEN, WHISPER_HOTWORDS: "a\u0000b" }).hotwords).toBeNull();
  });
});

describe("ASR_REPLAY_FALLBACK", () => {
  it("is on unless switched off (real mode must switch it off)", () => {
    expect(replayFallbackAllowed({})).toBe(true);
    expect(replayFallbackAllowed({ ASR_REPLAY_FALLBACK: "on" })).toBe(true);
    for (const off of ["off", "0", "false", "No"]) expect(replayFallbackAllowed({ ASR_REPLAY_FALLBACK: off })).toBe(false);
  });
});

describe("WhisperClient", () => {
  it("sends the bearer token and the WAV; parses the answer", async () => {
    const fake = fakeWhisper();
    const c = new WhisperClient(fakeConfig({ WHISPER_HOTWORDS: "Dr Lim" }), fake.fetch);
    const r = await c.chunk(wav(), { kind: "chunk", langHint: "en" });
    expect(r).toMatchObject({ text: "At home, we want it below 135 over 85.", lang: "en", model: "large-v3-turbo", modelMs: 140 });
    expect(fake.calls[0]).toMatchObject({ method: "POST", path: "/v1/chunk", auth: `Bearer ${TEST_TOKEN}`, query: { lang_hint: "en", hotwords: "Dr Lim" } });
    expect(fake.calls[0].bytes).toBe(wav().length);
    // health is public: no token sent
    const h = await c.health();
    expect(h).toMatchObject({ ready: true, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, gpu: "Fake GPU" });
    expect(fake.calls[1].auth).toBeNull();
  });

  it.each([
    ["down", "unreachable"],
    ["timeout", "timeout"],
    ["unauthorized", "unauthorized"],
    ["busy", "busy"],
    ["loading", "loading"],
    ["server_error", "http_500_internal_error"],
    ["garbage", "bad_response"],
  ] as const)("%s -> WhisperUnavailable(%s)", async (mode, reason) => {
    const fake = fakeWhisper();
    fake.mode = mode;
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    const err = await c.chunk(wav(), { kind: "final" }).catch((e) => e);
    expect(err).toBeInstanceOf(WhisperUnavailable);
    expect(err.reason).toBe(reason);
  });

  it("is not configured without a token: no request leaves", async () => {
    const fake = fakeWhisper();
    const c = new WhisperClient(whisperConfig({ WHISPER_URL: "http://whisper.test:1" }), fake.fetch);
    await expect(c.chunk(wav(), { kind: "chunk" })).rejects.toMatchObject({ reason: "not_configured:no_token" });
    expect(fake.calls).toEqual([]);
  });

  it("health with the token says whether the service takes it; without, it sends none", async () => {
    const fake = fakeWhisper();
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    expect((await c.health({ auth: true })).tokenOk).toBe(true);
    expect(fake.calls[0].auth).toBe(`Bearer ${TEST_TOKEN}`);
    fake.mode = "unauthorized";
    expect((await c.health({ auth: true })).tokenOk).toBe(false);
    expect((await c.health()).tokenOk).toBeNull();
    fake.mode = "stuck";
    expect(await c.health()).toMatchObject({ ready: true, healthy: false, status: "stuck" });
  });

  it("busy carries the service's Retry-After; 413 is too_large", async () => {
    const fake = fakeWhisper();
    fake.mode = "busy";
    fake.retryAfterS = 2;
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    const err = await c.chunk(wav(), { kind: "chunk" }).catch((e) => e);
    expect(err).toMatchObject({ reason: "busy", retryAfterMs: 2000, busy: true, misconfigured: false });
    fake.mode = "too_large";
    expect(await c.submitFile(wav()).catch((e) => e)).toMatchObject({ reason: "too_large" });
    expect(new WhisperUnavailable("unauthorized").misconfigured).toBe(true);
    expect(new WhisperUnavailable("not_configured:no_token").misconfigured).toBe(true);
  });

  it("a whole line gets a timeout that grows with its length, between the chunk and the final timeout", () => {
    const c = new WhisperClient(fakeConfig({ WHISPER_CHUNK_TIMEOUT_MS: "2500", WHISPER_FINAL_TIMEOUT_MS: "5000" }));
    const bytes = (s: number) => 44 + s * 32_000;
    expect(c.finalTimeoutFor(bytes(2.5))).toBe(2500);
    expect(c.finalTimeoutFor(bytes(10))).toBe(3200);
    expect(c.finalTimeoutFor(bytes(25))).toBe(5000);
  });

  it("the upload timeout grows with the recording", () => {
    const c = new WhisperClient(fakeConfig({ WHISPER_UPLOAD_TIMEOUT_MS: "10000", WHISPER_UPLOAD_MS_PER_MB: "1000" }));
    expect(c.uploadTimeoutFor(1000)).toBe(11_000);
    expect(c.uploadTimeoutFor(5 * 1_048_576)).toBe(15_000);
    expect(c.uploadTimeoutFor(64 * 1_048_576)).toBe(74_000);
  });

  it("a timeout really aborts the request", async () => {
    const fake = fakeWhisper();
    fake.mode = "timeout";
    const c = new WhisperClient(fakeConfig({ WHISPER_CHUNK_TIMEOUT_MS: "200" }), fake.fetch);
    const t0 = Date.now();
    await expect(c.chunk(wav(), { kind: "chunk" })).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe("confidence", () => {
  it("an utterance carries its least confident segment; unknown does not count", () => {
    expect(worstConfidence([{ confidence: "high" }, { confidence: "low" }, { confidence: "medium" }])).toBe("low");
    expect(worstConfidence([{ confidence: "high" }, { confidence: "unknown" }, {}])).toBe("high");
    expect(worstConfidence([{}])).toBeNull();
    const u = utterancesFromSegments([
      { start_ms: 0, end_ms: 900, text: "Take five milligrams.", lang: "en", region: 0, confidence: "high" },
      { start_ms: 1000, end_ms: 1900, text: "Once a day.", lang: "en", region: 0, confidence: "low" },
      { start_ms: 3000, end_ms: 3900, text: "OK.", lang: "en", region: 1 },
    ]);
    expect(u[0].confidence).toBe("low");
    expect("confidence" in u[1]).toBe(false);
  });
});

describe("utterancesFromSegments", () => {
  it("joins the segments of one region; Mandarin without spaces; speaker always null", () => {
    const u = utterancesFromSegments([
      { start_ms: 0, end_ms: 900, text: "This tablet works quietly.", lang: "en", region: 0 },
      { start_ms: 1300, end_ms: 4000, text: "You won't feel it.", lang: "en", region: 0 },
      { start_ms: 4700, end_ms: 6000, text: "手腕的不太准。", lang: "zh", region: 1 },
      { start_ms: 6100, end_ms: 7000, text: "买一个绑手臂的，", lang: "zh", region: 1 },
      { start_ms: 7000, end_ms: 7600, text: "upper arm 的。", lang: "zh", region: 1 },
    ]);
    expect(u).toEqual([
      { tStartMs: 0, tEndMs: 4000, speaker: null, text: "This tablet works quietly. You won't feel it.", lang: "en" },
      { tStartMs: 4700, tEndMs: 7600, speaker: null, text: "手腕的不太准。买一个绑手臂的，upper arm 的。", lang: "zh" },
    ]);
  });

  it("without regions a pause of the line gap starts a new utterance; empty text is dropped", () => {
    const u = utterancesFromSegments(
      [
        { start_ms: 0, end_ms: 1000, text: "One.", lang: "en" },
        { start_ms: 1400, end_ms: 2000, text: "Two.", lang: "en" },
        { start_ms: 2600, end_ms: 3000, text: "Three.", lang: "en" },
        { start_ms: 3100, end_ms: 3200, text: "  ", lang: "en" },
      ],
      550,
    );
    expect(u.map((x) => x.text)).toEqual(["One. Two.", "Three."]);
  });
});

describe("WhisperSpeechProvider", () => {
  it("realtimeToken checks the service: ready -> a placeholder token, otherwise SpeechError(unavailable)", async () => {
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    expect((await p.realtimeToken()).token).toMatch(/^whisper-chunks-/);
    for (const [mode, reason] of [
      ["down", "unreachable"],
      ["loading", "loading"],
      ["timeout", "timeout"],
      // a wrong token is found before the visit, not two chunks into it
      ["unauthorized", "unauthorized"],
      // the live worker hangs while the models are loaded
      ["stuck", "stuck"],
    ] as const) {
      fake.mode = mode;
      await expect(p.realtimeToken()).rejects.toMatchObject({ code: "unavailable", message: reason });
    }
    expect(fake.calls.filter((c) => c.path === "/health").every((c) => c.auth === `Bearer ${TEST_TOKEN}`)).toBe(true);
    const unconfigured = new WhisperSpeechProvider({ config: whisperConfig({ WHISPER_URL: "http://whisper.test:1" }), fetch: fake.fetch });
    await expect(unconfigured.realtimeToken()).rejects.toMatchObject({ message: "not_configured:no_token" });
  });

  it("transcribes the recording with the file model, then deletes the job on the service", async () => {
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(5000), onFallback: (f) => fallbacks.push(f) });
    expect((await p.getFileJob(jobId)).status).toBe("pending");
    const r = await waitJob(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", model: "large-v3" });
    expect(r.utterances!.map((x) => x.text)).toEqual([
      "Doctor, can I record? My daughter wants me to use this app.",
      "Sure, no problem.",
      "医生，我家里那个机器是绑手腕的，可以用吗？",
    ]);
    expect(r.utterances!.every((x) => x.speaker === null)).toBe(true);
    expect(r.utterances![2].lang).toBe("zh");
    expect(fallbacks).toEqual([]);
    await new Promise((res) => setTimeout(res, 20));
    expect(fake.deleted).toHaveLength(1);
  });

  it("a replay (no recording) is the replay file, not a fallback", async () => {
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    process.env.MOCK_ASR_JOB_MS = "0";
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "fixture:v1", fixture: "v1", lang: "zh-en-mixed", onFallback: (f) => fallbacks.push(f) });
    const r = await waitJob(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "fixture" });
    expect(r.utterances!.length).toBe(12);
    expect(fake.calls).toEqual([]);
    expect(fallbacks).toEqual([]);
  });

  const live = [
    { id: "v1-wabc-1", tStartMs: 1400, tEndMs: 6200, speaker: null, text: "Doctor, can I record my daughter wants me to use this app", lang: "en" },
  ];

  it.each(["down", "timeout", "unauthorized", "job_failed", "server_error"] as const)(
    "service %s: keeps the live Whisper lines and reports the fallback once",
    async (mode) => {
      const fake = fakeWhisper();
      fake.mode = mode;
      const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
      const fallbacks: SpeechFallback[] = [];
      const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), fixture: "v1", liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
      const r = await waitJob(p, jobId, 8000);
      expect(r).toMatchObject({ status: "done", source: "audio", utterances: live, fallback: { used: "live" } });
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0].used).toBe("live");
      expect(fallbacks[0].reason).toBe(
        { down: "unreachable", timeout: "timeout", unauthorized: "unauthorized", job_failed: "transcription_failed", server_error: "http_500_internal_error" }[mode],
      );
    },
    15_000,
  );

  it("a recording without live lines never becomes the replay file's script: the job fails", async () => {
    process.env.MOCK_ASR_JOB_MS = "0";
    const fake = fakeWhisper();
    fake.mode = "down";
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const a = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), fixture: "v2", recorded: true, onFallback: (f) => fallbacks.push(f) })).jobId, 5000);
    expect(a).toMatchObject({ status: "failed", error: "whisper_unavailable:unreachable", fallback: { reason: "unreachable", used: "none" } });
    expect(a.utterances).toBeUndefined();
    expect(fallbacks).toEqual([{ reason: "unreachable", used: "none" }]);
    // the health check comes first: a dead service is known without uploading the recording
    expect(fake.calls.map((c) => c.path)).toEqual(["/health"]);
  }, 15_000);

  it("a recorded visit whose recording did not arrive keeps its live lines (no_audio), else fails; never the script", async () => {
    process.env.MOCK_ASR_JOB_MS = "0";
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const a = await waitJob(p, (await p.createFileJob({ url: "fixture:v1", fixture: "v1", lang: "zh-en-mixed", recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) })).jobId);
    expect(a).toMatchObject({ status: "done", source: "audio", utterances: live, fallback: { reason: "no_audio", used: "live" } });
    const b = await waitJob(p, (await p.createFileJob({ url: "fixture:v1", fixture: "v1", lang: "zh-en-mixed", recorded: true, missingAudio: "upload_failed", onFallback: (f) => fallbacks.push(f) })).jobId);
    expect(b).toMatchObject({ status: "failed", fallback: { reason: "upload_failed", used: "none" } });
    expect(fallbacks).toEqual([
      { reason: "no_audio", used: "live" },
      { reason: "upload_failed", used: "none" },
    ]);
    expect(fake.calls).toEqual([]);
    // the replay stood in on screen while recording: the record follows it (ASR_REPLAY_FALLBACK on)
    const c = await waitJob(p, (await p.createFileJob({ url: "fixture:v1", fixture: "v1", lang: "zh-en-mixed", recorded: true, preferFixture: true })).jobId);
    expect(c).toMatchObject({ status: "done", source: "fixture", fallback: { reason: "no_audio", used: "fixture" } });
    // ... but never with ASR_REPLAY_FALLBACK off
    const off = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch, env: { ASR_REPLAY_FALLBACK: "off" } });
    const d = await waitJob(off, (await off.createFileJob({ url: "fixture:v1", fixture: "v1", lang: "zh-en-mixed", recorded: true, preferFixture: true })).jobId);
    expect(d).toMatchObject({ status: "failed", fallback: { used: "none" } });
  });

  it("a recording larger than the service takes is not sent (too_large): the live lines", async () => {
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_MAX_FILE_MB: "1" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const big = encodeWav(new Float32Array(16_000 * 40)); // 40 s, 1.28 MB
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: big, recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) })).jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", fallback: { reason: "too_large", used: "live" } });
    expect(fake.calls).toEqual([]);
    // the service's own 413 (its limit lower than the web app's) is the same fallback, without a retry
    const fake2 = fakeWhisper();
    fake2.modeFor.file = "too_large";
    const p2 = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake2.fetch });
    const r2 = await waitJob(p2, (await p2.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId);
    expect(r2.fallback).toEqual({ reason: "too_large", used: "live" });
    expect(fake2.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
  });

  it("a stuck or wrongly configured service is found by the health check before the upload", async () => {
    for (const [mode, reason] of [["stuck", "stuck"], ["unauthorized", "unauthorized"], ["loading", "loading"]] as const) {
      const fake = fakeWhisper();
      fake.mode = mode;
      const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
      const t0 = Date.now();
      const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId);
      expect(r.fallback).toEqual({ reason, used: "live" });
      expect(fake.calls.filter((c) => c.path === "/v1/file")).toEqual([]);
      expect(Date.now() - t0).toBeLessThan(1000);
    }
  });

  it("a running job whose progress stops moving while the service keeps saying it is healthy: stalled after the give-up time, before the deadline", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_JOB_STALL_MS: "200", WHISPER_JOB_STALL_GIVEUP_MS: "300", WHISPER_JOB_DEADLINE_MS: "60000" }), fetch: fake.fetch });
    const t0 = Date.now();
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId, 5000);
    expect(r.fallback).toEqual({ reason: "stalled", used: "live" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    expect(Date.now() - t0).toBeLessThan(3000);
    // between the stall check and the give-up it asked the service (healthy), and did not send the recording again
    expect(fake.calls.filter((c) => c.path === "/health").length).toBeGreaterThanOrEqual(2);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
    await new Promise((res) => setTimeout(res, 20));
    expect(fake.deleted).toHaveLength(1); // the stuck job is removed from the service
    // progress that keeps moving is not a stall
    const moving = fakeWhisper();
    moving.runningPolls = 30;
    moving.progressMoves = true;
    const p2 = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_JOB_STALL_MS: "200", WHISPER_JOB_STALL_GIVEUP_MS: "200", WHISPER_JOB_DEADLINE_MS: "60000" }), fetch: moving.fetch });
    const r2 = await waitJob(p2, (await p2.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true })).jobId, 5000);
    expect(r2).toMatchObject({ status: "done", source: "audio" });
  });

  it("cancelling (he keeps the live captions) stops the job at once with the live lines", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000;
    fake.progressMoves = true;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_POLL_MS: "200" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
    await new Promise((res) => setTimeout(res, 100));
    const t0 = Date.now();
    expect(await p.cancelFileJob(jobId)).toBe(true);
    const r = await waitJob(p, jobId, 2000);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r).toMatchObject({ status: "done", source: "audio", utterances: live, fallback: { reason: "cancelled", used: "live" } });
    expect(fallbacks).toEqual([{ reason: "cancelled", used: "live" }]);
    expect(await p.cancelFileJob(jobId)).toBe(false); // already finished
    await expect(p.cancelFileJob("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("ASR_REPLAY_FALLBACK=off: a visit that fell back while recording is still transcribed from its recording", async () => {
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch, env: { ASR_REPLAY_FALLBACK: "off" } });
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), fixture: "v1", preferFixture: true, recorded: true })).jobId);
    expect(r).toMatchObject({ status: "done", source: "audio" });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
  });

  it("a visit that fell back while recording keeps the replay for its record, without calling the service", async () => {
    process.env.MOCK_ASR_JOB_MS = "0";
    const fake = fakeWhisper();
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), fixture: "v1", preferFixture: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
    const r = await waitJob(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "fixture", fallback: { reason: "live_fallback", used: "fixture" } });
    expect(fake.calls).toEqual([]);
    expect(fallbacks).toHaveLength(1);
  });

  it("gives up after the deadline and falls back; the job is deleted on the service", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_JOB_DEADLINE_MS: "1000" }), fetch: fake.fetch });
    const t0 = Date.now();
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(200), liveUtterances: live })).jobId, 5000);
    expect(r.fallback).toEqual({ reason: "timeout", used: "live" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    // round 2: a job the web app gave up on does not keep the GPU busy (nor the recording) on the service
    await new Promise((res) => setTimeout(res, 20));
    expect(fake.deleted).toEqual(["job00000001"]);
  });

  it("cancelling also deletes the job on the service", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000;
    fake.progressMoves = true;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_POLL_MS: "50" }), fetch: fake.fetch });
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live });
    for (let i = 0; i < 100 && !fake.calls.some((c) => c.path.startsWith("/v1/jobs/")); i++) await new Promise((res) => setTimeout(res, 10));
    await p.cancelFileJob(jobId);
    await waitJob(p, jobId, 2000);
    await new Promise((res) => setTimeout(res, 20));
    expect(fake.deleted).toEqual(["job00000001"]);
  });

  it("the service's file worker is stuck: refused at upload (503 stuck) or failed while queued (worker_stuck) -> reason stuck, the live lines", async () => {
    // a wedged worker is announced by /health too; here only the file endpoints say so (it was found between the
    // health check and the upload, or while the job waited)
    for (const [where, mode] of [["file", "stuck_503"], ["job", "worker_stuck"]] as const) {
      const fake = fakeWhisper();
      fake.modeFor[where] = mode;
      const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
      const fallbacks: SpeechFallback[] = [];
      const t0 = Date.now();
      const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) })).jobId);
      expect(r).toMatchObject({ status: "done", utterances: live, fallback: { reason: "stuck", used: "live" } });
      expect(fallbacks.map(({ reason, used }) => ({ reason, used }))).toEqual([{ reason: "stuck", used: "live" }]);
      // a stuck upload is refused before the service has the recording: no retry. A job the service accepted and
      // then found its worker wedged is sent once more when /health says healthy (here at once), then given up.
      expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(where === "file" ? 1 : 2);
      // no waiting for the deadline
      expect(Date.now() - t0).toBeLessThan(1000);
      // without live lines: failed, said as stuck
      const p2 = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
      const r2 = await waitJob(p2, (await p2.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true })).jobId);
      expect(r2).toMatchObject({ status: "failed", error: "whisper_unavailable:stuck", fallback: { reason: "stuck", used: "none" } });
    }
  });

  it("a busy service gets one retry for the upload", async () => {
    const fake = fakeWhisper();
    fake.modeFor.file = "busy";
    const p = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch });
    setTimeout(() => {
      fake.modeFor.file = undefined;
    }, 300);
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav() })).jobId, 5000);
    expect(r).toMatchObject({ status: "done", source: "audio" });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(2);
  });

  it("deadline grows with the recording: max(setting, 2 x length)", () => {
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_JOB_DEADLINE_MS: "120000" }) });
    expect(p.deadlineMs(wav(1000))).toBe(120_000);
    expect(p.deadlineMs(encodeWav(new Float32Array(16_000 * 600)))).toBe(1_200_000);
  });

  it("an unknown job id is not_found", async () => {
    const p = new WhisperSpeechProvider({ config: fakeConfig() });
    await expect(p.getFileJob("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a refused request is a client error, not a failure of the service (B3)", () => {
  it.each([
    ["rejected", 415, "rejected_415_wav_16k_mono_pcm16_required"],
    ["too_short", 422, "rejected_422_too_short"],
    ["too_large", 413, "too_large"],
  ] as const)("%s -> status %i, reason %s, clientError", async (mode, status, reason) => {
    const fake = fakeWhisper();
    fake.mode = mode;
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    const err = (await c.chunk(wav(), { kind: "final" }).catch((e) => e)) as WhisperUnavailable;
    expect(err).toBeInstanceOf(WhisperUnavailable);
    expect(err).toMatchObject({ reason, status, clientError: true, busy: false, misconfigured: false });
  });

  it("the service being unwell is never a client error; a poll's 404 is job_lost", async () => {
    for (const s of [401, 403, 404, 408, 429, 500, 503, 504]) expect(new WhisperUnavailable("x", s).clientError).toBe(false);
    expect(new WhisperUnavailable("too_large").clientError).toBe(false); // the web app's own size check: no status
    const fake = fakeWhisper();
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    expect(await c.job("job99999999").catch((e) => e)).toMatchObject({ reason: "job_lost", status: 404 });
  });

  it("an unsafe error code from the service never reaches a reason string", async () => {
    const c = new WhisperClient(fakeConfig(), (async () => new Response(JSON.stringify({ error: "x y<script>" }), { status: 500 })) as typeof fetch);
    expect(await c.chunk(wav(), { kind: "chunk" }).catch((e) => e)).toMatchObject({ reason: "http_500" });
  });

  it("a recording the service refuses (415) is not sent again and not waited for: the live lines", async () => {
    const fake = fakeWhisper();
    fake.modeFor.file = "rejected";
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const live = [{ id: "v1-wabc-1", tStartMs: 1400, tEndMs: 6200, speaker: null, text: "Doctor, can I record", lang: "en" }];
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) })).jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", utterances: live, fallback: { reason: "rejected_415_wav_16k_mono_pcm16_required", used: "live" } });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
    expect(fallbacks).toHaveLength(1);
  });

  it("submitFile can skip the service's built-in hotwords (default_hotwords=0)", async () => {
    const fake = fakeWhisper();
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    await c.submitFile(wav(), undefined, { defaultHotwords: false });
    await c.submitFile(wav());
    expect(fake.calls.map((x) => x.query.default_hotwords)).toEqual(["0", undefined]);
  });
});

describe("word timestamps of the whole-recording path (B3 fix round 1)", () => {
  it("a finished job keeps each segment's words (the service sends them: word_timestamps=True); malformed words are dropped, not guessed", async () => {
    const fake = fakeWhisper();
    fake.fileSegments = [
      {
        start_ms: 1000,
        end_ms: 2600,
        text: "Yeah, sure. And take it.",
        lang: "en",
        region: 0,
        words: [
          { start_ms: 1000, end_ms: 1300, word: " Yeah,", prob: 0.9 },
          { start_ms: 1300, end_ms: 1600, word: " sure.", prob: 0.8 },
          { start_ms: 1900, end_ms: 2100, word: " And", prob: 0.7 },
          { start_ms: 2100, end_ms: 2300, word: " take", prob: 0.95 },
          { start_ms: 2300, end_ms: 2600, word: " it.", prob: 0.9 },
        ],
      },
      { start_ms: 3000, end_ms: 3500, text: "Bad words.", lang: "en", region: 1, words: [{ start_ms: 3000, end_ms: 3200, word: 7, prob: 1 }] },
      { start_ms: 4000, end_ms: 4500, text: "No words.", lang: "en", region: 2 },
    ] as unknown as typeof fake.fileSegments; // the second one's words are malformed on purpose
    const c = new WhisperClient(fakeConfig(), fake.fetch);
    const t = await c.transcribeFile(wav(), { deadlineMs: 5000 });
    expect(t.segments[0].words!.map((w) => w.word)).toEqual([" Yeah,", " sure.", " And", " take", " it."]);
    expect(t.segments[0].words![2]).toEqual({ start_ms: 1900, end_ms: 2100, word: " And", prob: 0.7 });
    expect(t.segments[1].words).toBeUndefined();
    expect(t.segments[2].words).toBeUndefined();
    // the visit record is built from the segments' text, unchanged
    expect(utterancesFromSegments(t.segments).map((u) => u.text)).toEqual(["Yeah, sure. And take it.", "Bad words.", "No words."]);
  });
});
