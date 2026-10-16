/**
 * The microphone of 问一句 (C2 track S; real-app 2.10 「没有 Whisper 时，不显示麦克风按钮」): it exists only with a configured
 * Whisper (askVoiceAvailable); a recording becomes the words of his question and nothing else (transcribeQuestion); the
 * route refuses whom POST /api/ask refuses, keeps nothing and never logs what he said (transcribeRoute, POST
 * /api/ask/transcribe); and without the service the screen draws nothing of the microphone at all.
 *
 * No network: the Whisper client is a stand-in, and the environment is handed to the route (process.env is only stubbed
 * for the history route's one field, and put back after each test).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as historyGet } from "@/app/api/ask/history/route";
import * as transcribeRouteFile from "@/app/api/ask/transcribe/route";
import { AskSection } from "@/components/today/AskSection";
import { MIN_WHISPER_TOKEN, WhisperUnavailable, type WhisperChunkResult } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import {
  askVoiceAvailable,
  MAX_QUESTION_BYTES,
  MAX_QUESTION_CHARS,
  MAX_QUESTION_MS,
  MIN_QUESTION_MS,
  questionText,
  transcribeQuestion,
  transcribeRoute,
  VOICE_PER_HOUR,
  voiceOverLimit,
  type VoiceDeps,
} from "@/lib/safety/voice";
import { MEMBER_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";
import { getMemoryStore } from "@/lib/store/memory";
import { uiCopy } from "@/lib/ui/copy";
import { encodeWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";

const store = getMemoryStore();
const HERO = "今天 150/95，我能不能多吃一粒？";
const WHISPER_ENV = { SPEECH_PROVIDER: "whisper", WHISPER_URL: "http://127.0.0.1:7810", WHISPER_TOKEN: "t".repeat(MIN_WHISPER_TOKEN) };

/** A stand-in for the Whisper client: answers `says` (or throws it) and remembers how it was called. */
function fakeClient(says: string | Error = HERO) {
  const calls: { bytes: number; opts: { kind: string; langHint?: string | null } }[] = [];
  const client: NonNullable<VoiceDeps["client"]> = {
    async chunk(wav, opts) {
      calls.push({ bytes: wav.byteLength, opts });
      if (says instanceof Error) throw says;
      const result: WhisperChunkResult = { text: says, lang: "zh", segments: [], durationMs: 0, model: "fake", modelMs: 0, roundTripMs: 0, confidence: "high" };
      return result;
    },
  };
  return { client, calls };
}

/** `ms` of silence as the browser recorder makes it: 16 kHz mono 16-bit PCM. */
const wav = (ms: number, rate = TARGET_SAMPLE_RATE) => encodeWav(new Int16Array(Math.round((ms / 1000) * rate)), rate);

function post(p: string, body: Uint8Array | string, opts: { token?: string; cookies?: Record<string, string>; type?: string } = {}): NextRequest {
  const jar = { ...(opts.cookies ?? {}), ...(opts.token ? { rp_at: opts.token } : {}) };
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = { "content-type": opts.type ?? "audio/wav" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers, body: body as unknown as BodyInit });
}

const demo = () => store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
/** Everything the route wrote to the console in this test, as one string. */
const logged = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]);

describe("askVoiceAvailable: a microphone only with a configured Whisper", () => {
  it("never for mock (the default), devfake, trtc or an unknown provider", () => {
    expect(askVoiceAvailable({})).toBe(false);
    expect(askVoiceAvailable({ SPEECH_PROVIDER: "mock" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, SPEECH_PROVIDER: "mock" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, SPEECH_PROVIDER: "devfake" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, SPEECH_PROVIDER: "trtc" })).toBe(false);
    // speechProviderName throws for a name it does not know: still "no microphone", never an error on the page
    expect(askVoiceAvailable({ ...WHISPER_ENV, SPEECH_PROVIDER: "siri" })).toBe(false);
  });

  it("not for whisper with a half-set configuration", () => {
    expect(askVoiceAvailable({ SPEECH_PROVIDER: "whisper" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, WHISPER_URL: "" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, WHISPER_URL: "ftp://127.0.0.1" })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, WHISPER_TOKEN: undefined })).toBe(false);
    expect(askVoiceAvailable({ ...WHISPER_ENV, WHISPER_TOKEN: "t".repeat(MIN_WHISPER_TOKEN - 1) })).toBe(false);
  });

  it("for whisper with its URL and a long enough token", () => {
    expect(askVoiceAvailable(WHISPER_ENV)).toBe(true);
    expect(askVoiceAvailable({ ...WHISPER_ENV, SPEECH_PROVIDER: " Whisper " })).toBe(true);
  });
});

describe("transcribeQuestion: his recording becomes the words of his question", () => {
  it("one call for the whole line (kind final), the text trimmed and on one line", async () => {
    const { client, calls } = fakeClient(`  今天 150/95，\n我能不能多吃一粒？ \t`);
    const audio = wav(1500);
    const heard = await transcribeQuestion(audio, { client });
    expect(heard).toEqual({ text: "今天 150/95， 我能不能多吃一粒？", lang: "zh", confidence: "high" });
    expect(calls).toEqual([{ bytes: audio.byteLength, opts: { kind: "final" } }]);
  });

  it("is never longer than the ask field takes (500 characters), and never ends in half a character", async () => {
    expect(MAX_QUESTION_CHARS).toBe(500);
    const long = await transcribeQuestion(wav(1000), { client: fakeClient("问".repeat(700)).client });
    expect(long.text).toBe("问".repeat(500));
    // an emoji is two UTF-16 units: one that straddles the limit is dropped whole
    expect(questionText(`${"a".repeat(499)}😀 and more`)).toBe("a".repeat(499));
    expect(questionText("a b".padEnd(499, "c") + " tail")).toHaveLength(499);
  });

  it("nothing heard is an empty text", async () => {
    expect((await transcribeQuestion(wav(1000), { client: fakeClient(" \n ").client })).text).toBe("");
  });
});

describe("POST /api/ask/transcribe", () => {
  it("the route file exports only what a Next.js route file may", () => {
    expect(Object.keys(transcribeRouteFile).sort()).toEqual(["POST", "dynamic", "runtime"]);
    expect(transcribeRouteFile.runtime).toBe("nodejs");
    expect(transcribeRouteFile.dynamic).toBe("force-dynamic");
  });

  it("a demo session: 200 with his words; nothing is asked, kept or logged", async () => {
    const s = await demo();
    const { client, calls } = fakeClient();
    const audio = wav(1500);
    const res = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, audio), { client, env: WHISPER_ENV });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(res)).toEqual({ text: HERO, lang: "zh" });
    expect(calls).toEqual([{ bytes: audio.byteLength, opts: { kind: "final" } }]);
    // the words are only shown to him: no ask was made, no chat row, no safety record, no question
    expect(await store.listChatMessages(s.id)).toEqual([]);
    expect(await store.listSafetyEvents(s.id)).toEqual([]);
    expect((await store.listQuestions(s.id)).some((q) => q.text === HERO)).toBe(false);
    expect(logged()).not.toContain("150/95");
  });

  it("an account (his own sign-in): 200, and his id is nowhere in the answer", async () => {
    const him = await createAccountWithSpace(store, getAuthProvider(), { login: `mic${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const { client, calls } = fakeClient();
    const res = await transcribeRoute(post("/api/ask/transcribe", wav(2000), { token: him.tokens.access_token }), { client, env: WHISPER_ENV });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ text: HERO, lang: "zh" });
    expect(text).not.toContain(him.userId);
    expect(calls).toHaveLength(1);
    expect(await store.listChatMessages(him.userId)).toEqual([]);
  });

  it("more than 120 spoken questions in his clock hour: 429 too_many until the next full hour, counted per person in the store, and the service is not called", async () => {
    const s = await demo();
    const other = await demo();
    const { client, calls } = fakeClient();
    // a store of this test's own for the count, so the hour's allowance is used up without 120 recordings
    let hits = VOICE_PER_HOUR - 1;
    const buckets: string[] = [];
    const usage: NonNullable<VoiceDeps["usage"]> = {
      rateHit: async (bucket, _windowS, limit) => {
        buckets.push(bucket);
        hits++;
        return { count: hits, allowed: hits <= limit, reset_at: new Date(Date.now() + 60_000).toISOString() };
      },
    };
    const ok = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(1000)), { client, env: WHISPER_ENV, usage });
    expect(ok.status).toBe(200);
    const over = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(1000)), { client, env: WHISPER_ENV, usage });
    expect(over.status).toBe(429);
    const body = await json(over);
    expect(body).toMatchObject({ error: "too_many", limit: "voice_per_hour" });
    expect(Number(over.headers.get("retry-after"))).toBe(body.retryAfterSec);
    expect(body.retryAfterSec as number).toBeGreaterThan(0);
    expect(body.retryAfterSec as number).toBeLessThanOrEqual(3600);
    expect(calls, "the service is not asked over the limit").toHaveLength(1);
    // the bucket is his own (an HMAC, never the id) and names his clock hour
    expect(buckets[0]).toMatch(/^ask:v:[0-9a-f]{32}:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(buckets[0]).not.toContain(s.id);
    // by default it is counted in the process-wide store's buckets, per person: another person is not affected
    expect(await voiceOverLimit(other)).toBeNull();
    // a counter that cannot be reached never stops him
    expect(await voiceOverLimit(s, { usage: { rateHit: async () => Promise.reject(new Error("down")) } })).toBeNull();
  });

  it("nothing heard: 200 with an empty text", async () => {
    const s = await demo();
    const res = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(1000)), { client: fakeClient("  ").client, env: WHISPER_ENV });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ text: "", lang: "zh" });
  });

  it("the limits are the ends of what is taken: exactly 0.3 s and exactly 30 s pass", async () => {
    const s = await demo();
    for (const ms of [MIN_QUESTION_MS, MAX_QUESTION_MS]) {
      const res = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(ms)), { client: fakeClient().client, env: WHISPER_ENV });
      expect(res.status, `${ms} ms`).toBe(200);
    }
  });

  it("no transcription service: 409 no_speech_service, and the service is never called", async () => {
    const s = await demo();
    // the exported POST reads the real environment: the tests run the mock provider
    const viaFile = await transcribeRouteFile.POST(post(`/api/ask/transcribe?session=${s.id}`, wav(1500)));
    expect(viaFile.status).toBe(409);
    expect((await json(viaFile)).error).toBe("no_speech_service");
    expect(viaFile.headers.get("cache-control")).toBe("private, no-store");
    for (const env of [{}, { ...WHISPER_ENV, SPEECH_PROVIDER: "devfake" }, { ...WHISPER_ENV, SPEECH_PROVIDER: "trtc" }, { ...WHISPER_ENV, WHISPER_TOKEN: "short" }]) {
      const { client, calls } = fakeClient();
      const res = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(1500)), { client, env });
      expect(res.status).toBe(409);
      expect((await json(res)).error).toBe("no_speech_service");
      expect(calls).toEqual([]);
    }
  });

  it("only a 16 kHz mono 16-bit PCM WAV is taken: 415 for anything else", async () => {
    const s = await demo();
    const url = `/api/ask/transcribe?session=${s.id}`;
    const { client, calls } = fakeClient();
    const deps = { client, env: WHISPER_ENV };
    for (const type of ["application/json", "audio/webm", "application/octet-stream"]) {
      const res = await transcribeRoute(post(url, wav(1500), { type }), deps);
      expect([type, res.status, (await json(res)).error]).toEqual([type, 415, "wav_required"]);
    }
    const notWav = await transcribeRoute(post(url, "this is not audio at all, only some text that is long enough"), deps);
    expect([notWav.status, (await json(notWav)).error]).toEqual([415, "wav_16k_mono_pcm16_required"]);
    const eightK = await transcribeRoute(post(url, wav(1500, 8000)), deps);
    expect([eightK.status, (await json(eightK)).error]).toEqual([415, "wav_16k_mono_pcm16_required"]);
    expect(eightK.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([]);
  });

  it("too short 422, too long 413 too_long, too large 413 too_large", async () => {
    const s = await demo();
    const url = `/api/ask/transcribe?session=${s.id}`;
    const { client, calls } = fakeClient();
    const deps = { client, env: WHISPER_ENV };
    const short = await transcribeRoute(post(url, wav(MIN_QUESTION_MS - 100)), deps);
    expect([short.status, (await json(short)).error]).toEqual([422, "too_short"]);
    // 31 s of 16 kHz audio is 992 044 bytes: under the byte limit, over the 30 s
    const long = wav(31_000);
    expect(long.byteLength).toBeLessThan(MAX_QUESTION_BYTES);
    const tooLong = await transcribeRoute(post(url, long), deps);
    expect([tooLong.status, (await json(tooLong)).error]).toEqual([413, "too_long"]);
    // 33 s is 1 056 044 bytes: over the byte limit, refused before it is parsed
    const large = wav(33_000);
    expect(large.byteLength).toBeGreaterThan(MAX_QUESTION_BYTES);
    const tooLarge = await transcribeRoute(post(url, large), deps);
    expect([tooLarge.status, (await json(tooLarge)).error]).toEqual([413, "too_large"]);
    expect(calls).toEqual([]);
  });

  it("the service does not answer: 503 asr_unavailable with the reason; busy: 429 with when to try again", async () => {
    const s = await demo();
    const url = `/api/ask/transcribe?session=${s.id}`;
    const down = await transcribeRoute(post(url, wav(1500)), { client: fakeClient(new WhisperUnavailable("unreachable")).client, env: WHISPER_ENV });
    expect(down.status).toBe(503);
    expect(await json(down)).toEqual({ error: "asr_unavailable", reason: "unreachable" });
    expect(down.headers.get("cache-control")).toBe("private, no-store");
    const refused = await transcribeRoute(post(url, wav(1500)), { client: fakeClient(new WhisperUnavailable("unauthorized", 401)).client, env: WHISPER_ENV });
    expect([refused.status, await json(refused)]).toEqual([503, { error: "asr_unavailable", reason: "unauthorized" }]);

    const busy = await transcribeRoute(post(url, wav(1500)), { client: fakeClient(new WhisperUnavailable("busy", 503, 2000)).client, env: WHISPER_ENV });
    expect(busy.status).toBe(429);
    expect(await json(busy)).toEqual({ error: "busy", retry_after_ms: 2000 });
    expect(busy.headers.get("retry-after")).toBe("2");
    expect(busy.headers.get("cache-control")).toBe("private, no-store");
    const busyNoHint = await transcribeRoute(post(url, wav(1500)), { client: fakeClient(new WhisperUnavailable("busy", 503)).client, env: WHISPER_ENV });
    expect(await json(busyNoHint)).toEqual({ error: "busy", retry_after_ms: 1000 });
  });

  it("anything else that breaks: 500 internal_error, and the log has the error's name only", async () => {
    const s = await demo();
    const broke = new Error(`could not handle "${HERO}"`);
    const res = await transcribeRoute(post(`/api/ask/transcribe?session=${s.id}`, wav(1500)), { client: fakeClient(broke).client, env: WHISPER_ENV });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: "internal_error" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain("150/95");
  });

  it("who asks is the same gate as POST /api/ask: no identity and Wei Ling's phone are refused before the body is read", async () => {
    const { client, calls } = fakeClient();
    const deps = { client, env: WHISPER_ENV };
    const nobody = await transcribeRoute(post("/api/ask/transcribe", wav(1500)), deps);
    expect(nobody.status).toBeGreaterThanOrEqual(400);
    expect(nobody.status).toBeLessThan(500);
    expect(nobody.headers.get("cache-control")).toBe("private, no-store");
    const unknown = await transcribeRoute(post(`/api/ask/transcribe?session=${randomUUID()}`, wav(1500)), deps);
    expect(unknown.status).toBe(404);

    const s = await demo();
    await store.addMember(s.id, { role: "patient" });
    const her = await store.addMember(s.id, { role: "family" });
    const hers = await transcribeRoute(post("/api/ask/transcribe", wav(1500), { cookies: { [SESSION_COOKIE]: s.id, [MEMBER_COOKIE]: her.id } }), deps);
    expect(hers.status).toBe(403);
    expect((await json(hers)).error).toBe("patient_only");
    expect(hers.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([]);
  });
});

describe("GET /api/ask/history tells Today's section whether to draw the microphone", () => {
  it("voice is false with the mock provider and true with a configured Whisper", async () => {
    const s = await demo();
    const get = () => historyGet(new NextRequest(`http://localhost/api/ask/history?session=${s.id}`));
    expect((await json(await get())).voice).toBe(false);
    for (const [k, v] of Object.entries(WHISPER_ENV)) vi.stubEnv(k, v);
    expect((await json(await get())).voice).toBe(true);
    vi.stubEnv("WHISPER_TOKEN", "short");
    expect((await json(await get())).voice).toBe(false);
  });
});

describe("the ask screen draws the microphone only when told a transcription service is connected", () => {
  const screen = (props: { voice?: boolean; locale?: "zh-Hans" | "en" }) =>
    renderToStaticMarkup(createElement(AskSection, { locale: props.locale ?? "zh-Hans", mode: "screen", ...(props.voice === undefined ? {} : { voice: props.voice }) }));

  it("without it: the typing field, and nothing of the microphone (no hidden button)", () => {
    for (const html of [screen({}), screen({ voice: false })]) {
      expect(html).toContain('data-testid="ask-input"');
      expect(html).not.toContain("ask-mic");
      expect(html).not.toContain(uiCopy("zh-Hans").micIdle);
      expect(html).not.toContain('data-icon="mic"');
    }
  });

  it("with it: one worded microphone button under the field, idle, and nothing heard yet", () => {
    const html = screen({ voice: true });
    expect(html).toContain('data-testid="ask-mic-section"');
    expect(html).toMatch(/<button[^>]*data-testid="ask-mic"[^>]*>/);
    const button = /<button[^>]*data-testid="ask-mic"[^>]*>.*?<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('data-state="idle"');
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain('data-variant="secondary"');
    expect(button).toContain('data-icon="mic"');
    expect(button).toContain("按一下开始说");
    expect(button).toContain(uiCopy("zh-Hans").micIdle);
    expect(button).not.toContain("disabled");
    // the field comes first, the microphone under it
    expect(html.indexOf('data-testid="ask-input"')).toBeLessThan(html.indexOf('data-testid="ask-mic"'));
    // nothing is offered to be asked before he has spoken
    expect(html).not.toContain("ask-heard");
    expect(html).not.toContain(uiCopy("zh-Hans").heard);
    expect(screen({ voice: true, locale: "en" })).toContain(uiCopy("en").micIdle);
  });
});
