/**
 * SpeechProvider (spec section 4): mock replays web/fixtures/visits/<visit>.utterances.json; trtc is a stub that
 * throws "not configured". The realtime replay schedule puts the first caption 300 ms into every sentence
 * (target: 1.5 s) and the final at the sentence end; a speed factor divides the clock.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  captionPrefix,
  FIRST_PARTIAL_MS,
  fixtureUtterances,
  getSpeechProvider,
  MockSpeechProvider,
  REPLAY_VISITS,
  replaySchedule,
  SpeechError,
  speechProviderName,
  TrtcSpeechProvider,
} from "@/lib/asr";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("provider selection", () => {
  it("defaults to mock; trtc selects the stub; anything else is refused", () => {
    expect(speechProviderName({})).toBe("mock");
    expect(speechProviderName({ SPEECH_PROVIDER: "mock" })).toBe("mock");
    expect(speechProviderName({ SPEECH_PROVIDER: "TRTC" })).toBe("trtc");
    expect(() => speechProviderName({ SPEECH_PROVIDER: "tencent-asr" })).toThrow(SpeechError);
    expect(getSpeechProvider({}).name).toBe("mock");
    expect(getSpeechProvider({ SPEECH_PROVIDER: "trtc" })).toBeInstanceOf(TrtcSpeechProvider);
  });

  it("trtc throws not configured on every method, even with keys set", async () => {
    process.env.TRTC_SDK_APP_ID = "123";
    process.env.TRTC_SDK_SECRET_KEY = "not-a-real-key";
    const trtc = new TrtcSpeechProvider();
    for (const call of [() => trtc.realtimeToken(), () => trtc.createFileJob({ url: "x", lang: "en" }), () => trtc.getFileJob("j")]) {
      await expect(call()).rejects.toMatchObject({ code: "not_configured" });
    }
  });
});

describe("mock provider", () => {
  it("gives a fake realtime token", async () => {
    const t = await new MockSpeechProvider().realtimeToken();
    expect(t.token).toMatch(/^mock-/);
    expect(t.expiresAt).toBeGreaterThan(Date.now());
  });

  it("the file job returns exactly the replay file (time, speaker, text), pending first", async () => {
    let now = 1_000;
    process.env.MOCK_ASR_JOB_MS = "300";
    const mock = new MockSpeechProvider(() => now);
    const { jobId } = await mock.createFileJob({ url: "fixture:v2", speakers: 3, lang: "zh-en-mixed" });
    expect((await mock.getFileJob(jobId)).status).toBe("pending");
    now += 300;
    const job = await mock.getFileJob(jobId);
    expect(job.status).toBe("done");
    expect(job.source).toBe("fixture");
    const file = fixtureUtterances("v2")!;
    expect(job.utterances!.map((u) => [u.tStartMs, u.tEndMs, u.speaker, u.text])).toEqual(
      file.map((u) => [u.t_start_ms, u.t_end_ms, u.speaker_cluster, u.text]),
    );
    await expect(mock.getFileJob("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("a visit without a replay file gets an empty transcript", async () => {
    process.env.MOCK_ASR_JOB_MS = "0";
    const mock = new MockSpeechProvider();
    const { jobId } = await mock.createFileJob({ url: "/api/blob/read?token=x", lang: "en" });
    expect(await mock.getFileJob(jobId)).toMatchObject({ status: "done", utterances: [] });
  });

  it("the replay files are the four visits and keep their Chinese", () => {
    expect(REPLAY_VISITS.sort()).toEqual(["p1", "v1", "v2", "v3"]);
    expect(fixtureUtterances("v1")!.at(-1)!.text).toBe("手腕的不太准。买一个绑手臂的，upper arm 的。");
    expect(fixtureUtterances("nope")).toBeNull();
  });
});

describe("realtime replay schedule", () => {
  it("every sentence shows a caption 300 ms after it starts and is final when it ends", () => {
    for (const v of REPLAY_VISITS) {
      const lines = fixtureUtterances(v)!;
      const steps = replaySchedule(lines);
      for (const u of lines) {
        const mine = steps.filter((s) => s.utterance.id === u.id);
        const first = mine[0];
        expect(first.kind).toBe("partial");
        expect(first.atMs - u.t_start_ms).toBe(Math.min(FIRST_PARTIAL_MS, u.t_end_ms - u.t_start_ms));
        expect(first.atMs - u.t_start_ms).toBeLessThanOrEqual(1500);
        const final = mine.at(-1)!;
        expect(final).toMatchObject({ kind: "final", atMs: u.t_end_ms, text: u.text });
        expect(u.text.startsWith(first.text.replace(/…$/, "").slice(0, 2))).toBe(true);
      }
      // time-ordered
      for (let i = 1; i < steps.length; i++) expect(steps[i].atMs).toBeGreaterThanOrEqual(steps[i - 1].atMs);
    }
  });

  it("caption prefixes cut on words (English) and characters (Mandarin)", () => {
    expect(captionPrefix("At home, we want it below 135 over 85.", 0.25)).toBe("At home, we");
    expect(captionPrefix("医生，我家里那个机器是绑手腕的，可以用吗？", 0.25)).toBe("医生，我家里");
  });
});
