/**
 * awaiting_transcript (B3, PROGRESS 10-09 Whisper reliability round 3, problem 2): the Whisper service accepted the
 * whole recording and then went away (a restart by its supervisor, a crash, a wedged worker). The job waits for
 * /health to answer healthy again (bounded by WHISPER_REDO_WAIT_MS), sends the recording once more and the record is
 * the large-v3 transcript, not the live captions. Cancelling ("Keep the live captions") ends the wait at once; a
 * wrong token ends it at once; a service that stays away falls back as before and says how long it waited.
 */
import { describe, expect, it } from "vitest";
import { whisperConfig, WhisperSpeechProvider, type FileJobResult, type SpeechFallback } from "@/lib/asr";
import { isRestartShaped, WhisperUnavailable } from "@/lib/asr/whisper";
import { encodeWav } from "@/lib/visit/wav";
import { fakeConfig, fakeWhisper } from "./fake-whisper";

const wav = (ms = 1000) => encodeWav(new Float32Array(Math.round(ms * 16)).fill(0.01));
const live = [{ id: "v1-wabc-1", tStartMs: 1400, tEndMs: 6200, speaker: null, text: "Doctor, can I record my daughter wants me to use this app", lang: "en" }];
const formal = ["Doctor, can I record? My daughter wants me to use this app.", "Sure, no problem.", "医生，我家里那个机器是绑手腕的，可以用吗？"];

async function waitJob(p: WhisperSpeechProvider, jobId: string, timeoutMs = 4000): Promise<FileJobResult> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await p.getFileJob(jobId);
    if (r.status !== "pending") return r;
    if (Date.now() > end) throw new Error("job still pending");
    await new Promise((res) => setTimeout(res, 5));
  }
}

/** poll the job until it is not pending; also collect every awaiting_transcript seen on the way */
async function watch(p: WhisperSpeechProvider, jobId: string, timeoutMs = 8000) {
  const seen: NonNullable<FileJobResult["awaiting_transcript"]>[] = [];
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await p.getFileJob(jobId);
    if (r.awaiting_transcript) seen.push(r.awaiting_transcript);
    if (r.status !== "pending") return { r, seen };
    if (Date.now() > end) throw new Error("job still pending");
    await new Promise((res) => setTimeout(res, 5));
  }
}

describe("which failures are a restart (and so worth waiting for)", () => {
  it("restart-shaped: refused, hung, lost job, loading, load error, wedged worker, 5xx", () => {
    for (const r of ["unreachable", "timeout", "job_lost", "loading", "engine_error", "stuck", "http_500", "http_502_bad_gateway"]) {
      expect(isRestartShaped(new WhisperUnavailable(r)), r).toBe(true);
    }
  });

  it("not: stalled, cancelled, a wrong token, a refused or too large recording, a garbled answer", () => {
    for (const r of ["stalled", "cancelled", "unauthorized", "not_configured:no_token", "too_large", "bad_response", "transcription_failed", "busy"]) {
      expect(isRestartShaped(new WhisperUnavailable(r)), r).toBe(false);
    }
    expect(isRestartShaped(new WhisperUnavailable("rejected_415_x", 415))).toBe(false);
    expect(isRestartShaped(new Error("unreachable"))).toBe(false);
  });
});

describe("awaiting_transcript: the service restarts in the middle of the whole-recording job", () => {
  it("refused connections, then loading, then healthy: the recording is sent again and the record is the formal transcript", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 3, loading: 4 };
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "40", WHISPER_REDO_WAIT_MS: "5000" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
    const { r, seen } = await watch(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", model: "large-v3", redone: { attempts: 1, reasons: ["unreachable"] } });
    expect(r.fallback).toBeUndefined();
    expect(r.awaiting_transcript).toBeUndefined();
    expect(r.utterances!.map((u) => u.text)).toEqual(formal);
    expect(r.redone!.waited_ms).toBeGreaterThan(0);
    expect(fallbacks).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatchObject({ reason: "unreachable", attempt: 1 });
    expect(typeof seen[0].since_ms).toBe("number");
    expect(fake.restarts).toBe(1);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(2);
    // between the two uploads the waiting job asked /health, not /v1/file
    const firstUpload = fake.calls.findIndex((c) => c.path === "/v1/file");
    const secondUpload = fake.calls.findIndex((c, i) => i > firstUpload && c.path === "/v1/file");
    expect(fake.calls.slice(firstUpload + 1, secondUpload).some((c) => c.path === "/health")).toBe(true);
  });

  it("the service comes back at once without the job (404 job_not_found): job_lost, sent again", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20" }), fetch: fake.fetch });
    const { r } = await watch(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", redone: { attempts: 1, reasons: ["job_lost"] } });
    expect(r.utterances!.map((u) => u.text)).toEqual(formal);
  });

  it("still loading when the poll comes (503 loading): waits for healthy, then sends again", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 0, loading: 3 };
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20" }), fetch: fake.fetch });
    const { r } = await watch(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true })).jobId);
    expect(r).toMatchObject({ status: "done", redone: { reasons: ["loading"] } });
  });

  it("the service stays away longer than WHISPER_REDO_WAIT_MS: the live lines, and the fallback says how long it waited", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 1_000_000, loading: 0 };
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "30", WHISPER_REDO_WAIT_MS: "300" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const t0 = Date.now();
    const { r, seen } = await watch(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) })).jobId);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    expect(r).toMatchObject({ status: "done", source: "audio", utterances: live, fallback: { reason: "unreachable", used: "live" } });
    expect(r.fallback!.waitedMs).toBeGreaterThanOrEqual(290);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].waitedMs).toBe(r.fallback!.waitedMs);
    expect(seen.length).toBeGreaterThan(0);
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
    // without live lines: failed (the jobs route then says deferred: the recording is saved)
    const fake2 = fakeWhisper();
    fake2.restartAfterPolls = 1;
    fake2.runningPolls = 2;
    fake2.restartPlan = { down: 1_000_000, loading: 0 };
    const p2 = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "30", WHISPER_REDO_WAIT_MS: "200" }), fetch: fake2.fetch });
    const { r: r2 } = await watch(p2, (await p2.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true })).jobId);
    expect(r2).toMatchObject({ status: "failed", error: "whisper_unavailable:unreachable", fallback: { reason: "unreachable", used: "none" } });
  });

  it("Keep the live captions (cancel) ends the wait at once", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 1_000_000, loading: 0 };
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "500", WHISPER_REDO_WAIT_MS: "60000" }), fetch: fake.fetch });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
    for (let i = 0; i < 400 && !(await p.getFileJob(jobId)).awaiting_transcript; i++) await new Promise((res) => setTimeout(res, 5));
    expect((await p.getFileJob(jobId)).awaiting_transcript).toMatchObject({ reason: "unreachable" });
    const t0 = Date.now();
    expect(await p.cancelFileJob(jobId)).toBe(true);
    const r = await waitJob(p, jobId, 2000);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(r).toMatchObject({ status: "done", utterances: live, fallback: { reason: "cancelled", used: "live" } });
    expect(fallbacks.map((f) => f.reason)).toEqual(["cancelled"]);
  });

  it("a wrong token found while waiting ends the wait at once (waiting will not fix it)", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    fake.restartPlan = { down: 3, loading: 1_000_000 };
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20", WHISPER_REDO_WAIT_MS: "60000" }), fetch: fake.fetch });
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live });
    for (let i = 0; i < 400 && !(await p.getFileJob(jobId)).awaiting_transcript; i++) await new Promise((res) => setTimeout(res, 2));
    expect((await p.getFileJob(jobId)).awaiting_transcript).toBeTruthy();
    // the service is back, but with another token
    fake.mode = "unauthorized";
    fake.endRestart();
    const t0 = Date.now();
    const r = await waitJob(p, jobId, 2000);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r).toMatchObject({ status: "done", utterances: live, fallback: { reason: "unauthorized", used: "live" } });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
  });

  it("only one redo by default; WHISPER_REDO_ATTEMPTS=0 or WHISPER_REDO_WAIT_MS=0 never waits", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 2;
    fake.restartAfterPolls = 1;
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20" }), fetch: fake.fetch });
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live });
    // arm a second restart once the first one happened: the second attempt dies the same way and is given up
    for (let i = 0; i < 400 && fake.restarts < 1; i++) await new Promise((res) => setTimeout(res, 2));
    fake.restartAfterPolls = 1;
    const r = await waitJob(p, jobId, 4000);
    expect(r).toMatchObject({ status: "done", utterances: live, fallback: { reason: "job_lost", used: "live" } });
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(2);
    for (const off of [{ WHISPER_REDO_ATTEMPTS: "0" }, { WHISPER_REDO_WAIT_MS: "0" }]) {
      const f = fakeWhisper();
      f.runningPolls = 2;
      f.restartAfterPolls = 1;
      const q = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20", ...off }), fetch: f.fetch });
      const rr = await waitJob(q, (await q.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId, 3000);
      expect(rr).toMatchObject({ fallback: { reason: "job_lost", used: "live" } });
      expect(f.calls.filter((c) => c.path === "/v1/file")).toHaveLength(1);
      expect(q.budgetMs(wav())).toBe(q.deadlineMs(wav()));
    }
  });

  it("a job the service never accepted (down at End) is not waited for: the existing fallback at once", async () => {
    const fake = fakeWhisper();
    fake.mode = "down";
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_REDO_POLL_MS: "20" }), fetch: fake.fetch });
    const t0 = Date.now();
    const r = await waitJob(p, (await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live })).jobId);
    expect(r.fallback).toEqual({ reason: "unreachable", used: "live" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a wedged RUNNING worker (the service's own watchdog restart, exit code 6): no progress, then worker_stuck, then the restart; the recording is sent again", async () => {
    // B3 reliability round 1, problem 1: the web job used to give up after WHISPER_JOB_STALL_MS (20 s) of frozen
    // progress, long before the service declares the worker stuck (90 s) and exits for its supervisor (120 s)
    const fake = fakeWhisper();
    fake.wedgeAfterPolls = 25; // ~0.5 s of frozen progress at 20 ms polls: longer than the 200 ms stall check
    fake.wedgePlan = { stuckHealth: 3, down: 2, loading: 2 };
    const p = new WhisperSpeechProvider({
      config: fakeConfig({ WHISPER_JOB_STALL_MS: "200", WHISPER_JOB_STALL_GIVEUP_MS: "60000", WHISPER_JOB_DEADLINE_MS: "60000", WHISPER_REDO_POLL_MS: "30", WHISPER_REDO_WAIT_MS: "5000" }),
      fetch: fake.fetch,
    });
    const fallbacks: SpeechFallback[] = [];
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live, onFallback: (f) => fallbacks.push(f) });
    const { r, seen } = await watch(p, jobId);
    expect(r).toMatchObject({ status: "done", source: "audio", model: "large-v3", redone: { attempts: 1, reasons: ["stuck"] } });
    expect(r.fallback).toBeUndefined();
    expect(r.utterances!.map((u) => u.text)).toEqual(formal);
    expect(fallbacks).toEqual([]);
    expect(seen[0]).toMatchObject({ reason: "stuck", attempt: 1 });
    expect(fake.restarts).toBe(1);
    const uploads = fake.calls.map((c, i) => (c.path === "/v1/file" ? i : -1)).filter((i) => i >= 0);
    expect(uploads).toHaveLength(2);
    // while the progress was frozen it asked /health (healthy: keep waiting) instead of giving up
    const firstJobPolls = fake.calls.slice(uploads[0], uploads[1]);
    const stuckAt = firstJobPolls.findIndex((c) => c.path.startsWith("/v1/jobs/"));
    expect(stuckAt).toBeGreaterThanOrEqual(0);
    expect(firstJobPolls.filter((c) => c.path.startsWith("/v1/jobs/") && c.method === "GET").length).toBe(25);
    expect(firstJobPolls.some((c) => c.path === "/health")).toBe(true);
  });

  it("frozen progress and /health already says stuck (both workers wedged): waits for the restart at once and sends again", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000; // running, frozen at 0 of 3
    const p = new WhisperSpeechProvider({
      config: fakeConfig({ WHISPER_JOB_STALL_MS: "200", WHISPER_JOB_STALL_GIVEUP_MS: "60000", WHISPER_JOB_DEADLINE_MS: "60000", WHISPER_REDO_POLL_MS: "20", WHISPER_REDO_WAIT_MS: "5000" }),
      fetch: fake.fetch,
    });
    const { jobId } = await p.createFileJob({ url: "signed", lang: "zh-en-mixed", audio: wav(), recorded: true, liveUtterances: live });
    // the first upload went in; now the service reports itself stuck
    for (let i = 0; i < 400 && !fake.calls.some((c) => c.path === "/v1/file"); i++) await new Promise((res) => setTimeout(res, 2));
    fake.modeFor.health = "stuck";
    for (let i = 0; i < 800 && !(await p.getFileJob(jobId)).awaiting_transcript; i++) await new Promise((res) => setTimeout(res, 5));
    expect((await p.getFileJob(jobId)).awaiting_transcript).toMatchObject({ reason: "stuck", attempt: 1 });
    // restarted: healthy again, and the next job runs normally
    fake.runningPolls = 1;
    fake.modeFor.health = undefined;
    const r = await waitJob(p, jobId, 4000);
    expect(r).toMatchObject({ status: "done", source: "audio", redone: { attempts: 1, reasons: ["stuck"] } });
    expect(r.fallback).toBeUndefined();
    expect(fake.calls.filter((c) => c.path === "/v1/file")).toHaveLength(2);
  });

  it("the client without onStall (the demo, the WER script) keeps the old meaning: stalled once the progress has not moved for stallMs", async () => {
    const fake = fakeWhisper();
    fake.runningPolls = 1_000_000;
    const client = new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch }).client;
    const t0 = Date.now();
    await expect(client.transcribeFile(wav(), { deadlineMs: 60_000, stallMs: 200, pollEveryMs: 20 })).rejects.toMatchObject({ reason: "stalled" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(fake.calls.filter((c) => c.path === "/health")).toHaveLength(0);
    // with onStall: null keeps waiting until stallGiveUpMs, a reason ends it with that reason
    let asked = 0;
    await expect(
      client.transcribeFile(wav(), { deadlineMs: 60_000, stallMs: 200, stallGiveUpMs: 400, pollEveryMs: 20, onStall: async () => (++asked, null) }),
    ).rejects.toMatchObject({ reason: "stalled" });
    expect(asked).toBeGreaterThan(1);
    await expect(client.transcribeFile(wav(), { deadlineMs: 60_000, stallMs: 200, stallGiveUpMs: 10_000, pollEveryMs: 20, onStall: async () => "stuck" })).rejects.toMatchObject({ reason: "stuck" });
  });

  it("the page's budget covers the wait and the second attempt", () => {
    const p = new WhisperSpeechProvider({ config: fakeConfig({ WHISPER_JOB_DEADLINE_MS: "120000" }) });
    expect(p.config).toMatchObject({ redoWaitMs: 120_000, redoAttempts: 1, redoPollMs: 2000 });
    expect(p.budgetMs(wav(1000))).toBe(120_000 * 2 + 120_000);
    const long = encodeWav(new Float32Array(16_000 * 600));
    expect(p.budgetMs(long)).toBe(1_200_000 * 2 + 120_000);
    expect(whisperConfig({ WHISPER_REDO_WAIT_MS: "99999999" }).redoWaitMs).toBe(120_000); // out of range: the default
  });
});
