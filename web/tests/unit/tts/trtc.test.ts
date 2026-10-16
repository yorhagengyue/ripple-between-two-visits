/**
 * TTS_PROVIDER=trtc (lib/tts/trtc.ts) against a stand-in for Tencent's TextToSpeech, built from the request and answer
 * examples on the API page (https://trtc.io/document/80010, read 2026-10-11). No test here reaches a network, and none
 * of this shows that the real service accepts these requests: there are no keys to try it with.
 *
 *   the page's Input Example    POST / Host: trtc.intl.tencentcloudapi.com, X-TC-Action: TextToSpeech,
 *                               { "Text": "hello", "Voice": { "VoiceId": "v-female-R2s4N9qJ" }, "SdkAppId": 160001234, ... }
 *   the page's Output Example   { "Response": { "Alignments": [...], "Audio": "base64audio", "RequestId": "9b9b5959-..." } }
 *   an error (common format)    { "Response": { "Error": { "Code": "...", "Message": "..." }, "RequestId": "..." } }
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { READ_ALOUD_SCREENS, readAloudParts } from "@/lib/auth/read-aloud-text";
import { tc3Sign } from "@/lib/tts/tc3";
import {
  classifyTrtcError,
  createTrtcTts,
  resetTrtcTtsHealth,
  splitForTrtc,
  TRTC_TTS_DEFAULTS,
  TRTC_TTS_GAP_MS,
  TRTC_TTS_HOLD_MS,
  TRTC_TTS_MAX_UNITS,
  trtcTtsConfig,
  TrtcTtsError,
  trtcUnits,
} from "@/lib/tts/trtc";
import { TTS_MAX_CHARS, TtsError } from "@/lib/tts/types";
import { encodeWav, parseWav } from "@/lib/visit/wav";

/** Made-up values: the application id is the one in the page's example. */
const ENV = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TENCENT_SECRET_ID: "test-secret-id", TENCENT_SECRET_KEY: "test-secret-key" };
/** 2026-10-11 23:59:30 UTC: already the 12th in Singapore, and the signature's date must still be the 11th. */
const NOW = Date.UTC(2026, 9, 11, 23, 59, 30);
const REQUEST_ID = "9b9b5959-8d17-46f2-a216-8a0ce219f92f";
const RATE = 24_000;

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  json: { Text: string; Voice: { VoiceId: string; Speed: number }; SdkAppId: number; AudioFormat: { Format: string; SampleRate: number }; Language: string };
  signal: AbortSignal | null;
}
type Answer = (sent: Sent, index: number) => Response | Promise<Response>;

const tone = (ms: number, value = 1000, rate = RATE): Int16Array => new Int16Array(Math.round((ms / 1000) * rate)).fill(value);
const wavBase64 = (samples: Int16Array, rate = RATE): string => Buffer.from(encodeWav(samples, rate)).toString("base64");
/** The page's Output Example, with a real WAV where it prints "base64audio". */
const spoken = (audio: string = wavBase64(tone(760))): Response =>
  Response.json({ Response: { Alignments: [{ TextBegin: 0, TextEnd: 2, TimeBeginMs: 0, TimeEndMs: 760 }], Audio: audio, RequestId: REQUEST_ID } });
const refused = (code: string, message = "a vendor message that must not travel"): Response => Response.json({ Response: { Error: { Code: code, Message: message }, RequestId: REQUEST_ID } });

function tencent(answer: Answer = () => spoken()) {
  const sent: Sent[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = String(init?.body ?? "");
    const s: Sent = { url: String(input), method: init?.method ?? "GET", headers, body, json: JSON.parse(body) as Sent["json"], signal: init?.signal ?? null };
    sent.push(s);
    return answer(s, sent.length - 1);
  }) as typeof fetch;
  return { fetch: fake, sent };
}

const samplesOf = (wav: Uint8Array): Int16Array => {
  const info = parseWav(wav)!;
  const pcm = wav.slice(info.dataOffset, info.dataOffset + info.dataLength);
  return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
};
const squeeze = (s: string) => s.replace(/\s+/g, "");
const failure = async (p: Promise<unknown>): Promise<TtsError> => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TtsError);
  return err as TtsError;
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  resetTrtcTtsHealth();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("what has to be set", () => {
  it("the application id and a cloud API key pair; the application's SDKSecretKey is not one of them", () => {
    expect(trtcTtsConfig({})).toEqual({ ok: false, problems: ["TRTC_SDK_APP_ID is not set", "TENCENT_SECRET_ID is not set", "TENCENT_SECRET_KEY is not set"] });
    // the pair the plan first named: an application, and no key that can sign a request
    expect(trtcTtsConfig({ TRTC_SDK_APP_ID: "160001234", TRTC_SDK_SECRET_KEY: "an-sdk-secret" })).toEqual({ ok: false, problems: ["TENCENT_SECRET_ID is not set", "TENCENT_SECRET_KEY is not set"] });
    const cfg = trtcTtsConfig(ENV);
    expect(cfg).toEqual({
      ok: true,
      config: {
        sdkAppId: 160001234,
        secretId: "test-secret-id",
        secretKey: "test-secret-key",
        endpoint: "trtc.intl.tencentcloudapi.com",
        region: "ap-singapore",
        voice: { "zh-Hans": "v-female-R2s4N9qJ", en: "v-female-p9Xy7Q1L" },
        speed: 0.9,
        sampleRate: 24000,
        timeoutMs: 30000,
      },
    });
    expect(TRTC_TTS_DEFAULTS.endpoint).toBe("trtc.intl.tencentcloudapi.com");
  });

  it("a value that cannot be right is named, and its value is never repeated", () => {
    const bad = (extra: Record<string, string>) => {
      const cfg = trtcTtsConfig({ ...ENV, ...extra });
      expect(cfg.ok).toBe(false);
      const problems = cfg.ok ? [] : cfg.problems;
      for (const v of Object.values(extra)) if (v.length > 3) expect(problems.join(" ")).not.toContain(v);
      return problems;
    };
    expect(bad({ TRTC_SDK_APP_ID: "my-app" })).toEqual(["TRTC_SDK_APP_ID is not a whole number"]);
    expect(bad({ TRTC_SDK_APP_ID: "0" })).toEqual(["TRTC_SDK_APP_ID is not a whole number"]);
    // only Tencent's API hosts: a signed request and his text go nowhere else
    for (const host of ["evil.example.com", "trtc.intl.tencentcloudapi.com.evil.example", "https://trtc.intl.tencentcloudapi.com", "cvm.tencentcloudapi.com", "trtc.tencentcloudapi.com/path"]) {
      expect(bad({ TRTC_TTS_ENDPOINT: host }), host).toEqual(["TRTC_TTS_ENDPOINT is not a trtc.*.tencentcloudapi.com host name"]);
    }
    expect(bad({ TRTC_TTS_REGION: "Singapore!" })).toEqual(["TRTC_TTS_REGION is not a region name like ap-singapore"]);
    expect(bad({ TRTC_TTS_VOICE_ZH: "a voice with spaces" })).toEqual(["TRTC_TTS_VOICE_ZH is not a voice id"]);
    expect(bad({ TRTC_TTS_SPEED: "3" })).toEqual(["TRTC_TTS_SPEED is not between 0.5 and 2"]);
    expect(bad({ TRTC_TTS_SPEED: "slow" })).toEqual(["TRTC_TTS_SPEED is not between 0.5 and 2"]);
    expect(bad({ TRTC_TTS_SAMPLE_RATE: "44100" })).toEqual(["TRTC_TTS_SAMPLE_RATE is not 16000 or 24000"]);
    expect(bad({ TRTC_TTS_TIMEOUT_MS: "0" })).toEqual(["TRTC_TTS_TIMEOUT_MS is not a number of milliseconds up to 120000"]);
  });

  it("the documented alternatives are accepted: the mainland host, 16 kHz, another voice, another speed", () => {
    const cfg = trtcTtsConfig({ ...ENV, TRTC_TTS_ENDPOINT: "trtc.tencentcloudapi.com", TRTC_TTS_REGION: "ap-beijing", TRTC_TTS_SAMPLE_RATE: "16000", TRTC_TTS_VOICE_ZH: "male-kefu-xiaoxu", TRTC_TTS_SPEED: "0.8" });
    expect(cfg.ok && [cfg.config.endpoint, cfg.config.region, cfg.config.sampleRate, cfg.config.voice["zh-Hans"], cfg.config.speed]).toEqual(["trtc.tencentcloudapi.com", "ap-beijing", 16000, "male-kefu-xiaoxu", 0.8]);
  });

  it("not configured: not ready, and a call is refused before anything is sent, naming variables only", async () => {
    const fake = tencent();
    for (const env of [{}, { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TRTC_SDK_SECRET_KEY: "an-sdk-secret" }, { ...ENV, TENCENT_SECRET_KEY: "  " }, { ...ENV, TRTC_TTS_ENDPOINT: "evil.example.com" }]) {
      const voice = createTrtcTts(env, { fetch: fake.fetch, now: () => NOW });
      expect(voice.name).toBe("trtc");
      expect(voice.ready).toBe(false);
      const err = await failure(voice.synthesize({ text: "你好", lang: "zh-Hans" }));
      expect(err.code).toBe("not_configured");
      expect(err.message).not.toContain("an-sdk-secret");
      expect(err.message).not.toContain("test-secret");
    }
    expect(fake.sent).toHaveLength(0);
  });
});

describe("the request", () => {
  it("is the API page's example: the host, the action, the version, the region, the body", async () => {
    const fake = tencent();
    await createTrtcTts({ ...ENV, TRTC_TTS_VOICE_EN: "v-female-R2s4N9qJ" }, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "hello", lang: "en" });
    expect(fake.sent).toHaveLength(1);
    const s = fake.sent[0];
    expect([s.url, s.method]).toEqual(["https://trtc.intl.tencentcloudapi.com/", "POST"]);
    expect(s.headers["x-tc-action"]).toBe("TextToSpeech");
    expect(s.headers["x-tc-version"]).toBe("2019-07-22");
    expect(s.headers["x-tc-region"]).toBe("ap-singapore");
    expect(s.headers["content-type"]).toBe("application/json; charset=utf-8");
    // the page's example body, plus the format asked for, the speed and the language
    expect(s.json).toEqual({ Text: "hello", Voice: { VoiceId: "v-female-R2s4N9qJ", Speed: 0.9 }, SdkAppId: 160001234, AudioFormat: { Format: "wav", SampleRate: 24000 }, Language: "en" });
    expect(typeof s.json.SdkAppId).toBe("number");
  });

  it("is signed for the true second and the UTC date, over exactly the bytes sent", async () => {
    const fake = tencent();
    await createTrtcTts({ ...ENV, TRTC_TTS_VOICE_EN: "v-female-R2s4N9qJ" }, { fetch: fake.fetch, now: () => NOW + 999 }).synthesize({ text: "hello", lang: "en" });
    const s = fake.sent[0];
    expect(s.body).toBe('{"Text":"hello","Voice":{"VoiceId":"v-female-R2s4N9qJ","Speed":0.9},"SdkAppId":160001234,"AudioFormat":{"Format":"wav","SampleRate":24000},"Language":"en"}');
    expect(s.headers["x-tc-timestamp"]).toBe("1791763170");
    // worked out apart from lib/tts/tc3.ts (a few lines of node:crypto following the page's four steps)
    expect(s.headers.authorization).toBe(
      "TC3-HMAC-SHA256 Credential=test-secret-id/2026-10-11/trtc/tc3_request, SignedHeaders=content-type;host, Signature=cc8da5b86621bfe8efbbaedec580e2d9b808c8d805889cb64740a3ccc68879f3",
    );
    // and it is the signature of what was sent, to the host it was sent to
    expect(s.headers.authorization).toBe(tc3Sign({ secretId: "test-secret-id", secretKey: "test-secret-key", service: "trtc", host: new URL(s.url).hostname, payload: s.body, timestamp: 1791763170 }).authorization);
  });

  it("the key travels nowhere: not in the address, a header or the body; the SDKSecretKey is not used at all", async () => {
    const fake = tencent();
    await createTrtcTts({ ...ENV, TRTC_SDK_SECRET_KEY: "an-sdk-secret" }, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "你好", lang: "zh-Hans" });
    const without = tencent();
    await createTrtcTts(ENV, { fetch: without.fetch, now: () => NOW }).synthesize({ text: "你好", lang: "zh-Hans" });
    const all = JSON.stringify(fake.sent.map((s) => [s.url, s.headers, s.body]));
    expect(all).not.toContain("test-secret-key");
    expect(all).not.toContain("an-sdk-secret");
    expect(fake.sent[0].headers.authorization).toBe(without.sent[0].headers.authorization);
    expect(Object.keys(fake.sent[0].headers).sort()).toEqual(["authorization", "content-type", "x-tc-action", "x-tc-region", "x-tc-timestamp", "x-tc-version"]);
  });

  it("Mandarin: the Chinese voice and Language zh; English: the English voice and en; the overrides are used", async () => {
    const fake = tencent();
    const voice = createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW });
    await voice.synthesize({ text: "今天天气很好。", lang: "zh-Hans" });
    await voice.synthesize({ text: "The weather is fine today.", lang: "en" });
    expect(fake.sent.map((s) => [s.json.Voice.VoiceId, s.json.Language])).toEqual([
      ["v-female-R2s4N9qJ", "zh"],
      ["v-female-p9Xy7Q1L", "en"],
    ]);
    const other = tencent();
    await createTrtcTts({ ...ENV, TRTC_TTS_VOICE_ZH: "male-kefu-xiaoxu", TRTC_TTS_SPEED: "0.75", TRTC_TTS_SAMPLE_RATE: "16000", TRTC_TTS_ENDPOINT: "trtc.tencentcloudapi.com", TRTC_TTS_REGION: "ap-beijing" }, { fetch: other.fetch, now: () => NOW }).synthesize({
      text: "今天天气很好。",
      lang: "zh-Hans",
    });
    expect(other.sent[0].url).toBe("https://trtc.tencentcloudapi.com/");
    expect(other.sent[0].headers["x-tc-region"]).toBe("ap-beijing");
    expect(other.sent[0].json).toMatchObject({ Voice: { VoiceId: "male-kefu-xiaoxu", Speed: 0.75 }, AudioFormat: { Format: "wav", SampleRate: 16000 } });
    expect(other.sent[0].headers.authorization).toContain("/trtc/tc3_request");
  });
});

describe("a good answer", () => {
  it("becomes the WAV the route returns: audio/wav, the provider's name, a real voice, the true length", async () => {
    const answer = tone(760, 1234);
    const fake = tencent(() => spoken(wavBase64(answer)));
    const out = await createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "你好", lang: "zh-Hans" });
    expect(out.mime).toBe("audio/wav");
    expect(out.provider).toBe("trtc");
    expect(out.synthetic).toBe(false);
    expect(out.durationMs).toBe(760);
    expect(Buffer.from(out.audio.slice(0, 4)).toString("latin1")).toBe("RIFF");
    expect(Buffer.from(out.audio.slice(8, 12)).toString("latin1")).toBe("WAVE");
    expect(parseWav(out.audio)).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationMs: 760, dataOffset: 44 });
    expect(samplesOf(out.audio)).toEqual(answer);
  });

  it("a WAV written by a streaming encoder (no sizes, an extra chunk before the data) is read to its end and rewritten whole", async () => {
    const plain = encodeWav(tone(100, 77, 16_000), 16_000);
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]); // "LIST", 4 bytes
    const streamed = new Uint8Array(plain.length + list.length);
    streamed.set(plain.slice(0, 36), 0);
    streamed.set(list, 36);
    streamed.set(plain.slice(36), 36 + list.length);
    new DataView(streamed.buffer).setUint32(4, 0xffffffff, true);
    new DataView(streamed.buffer).setUint32(36 + list.length + 4, 0xffffffff, true);
    const fake = tencent(() => spoken(Buffer.from(streamed).toString("base64")));
    const out = await createTrtcTts({ ...ENV, TRTC_TTS_SAMPLE_RATE: "16000" }, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "你好", lang: "zh-Hans" });
    expect(parseWav(out.audio)).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataLength: 3200 });
    expect(out.durationMs).toBe(100);
    expect(out.audio.byteLength).toBe(44 + 3200);
  });
});

describe("a text longer than one request holds", () => {
  it("the service's count, or more: the vendor's own examples", () => {
    // FlowTTS docs/char_count_rules.md: a Chinese character 2, anything else 1
    expect([trtcUnits("你好"), trtcUnits("Hello"), trtcUnits("你好World"), trtcUnits("Hello World"), trtcUnits("")]).toEqual([4, 5, 9, 11, 0]);
    // their count for this one is 10; full-width punctuation counts double here, never less than theirs
    expect(trtcUnits("你好，世界！")).toBeGreaterThanOrEqual(10);
    expect(TRTC_TTS_MAX_UNITS).toBe(255);
  });

  it("lines in the same language share a request while they fit (a space where the line break was); a change of language starts a new one", () => {
    expect(splitForTrtc("今天天气很好。\n我们去公园散步。", "zh")).toEqual([{ text: "今天天气很好。 我们去公园散步。", language: "zh" }]);
    // a Mandarin card quoting English: each piece says which it is (lib/explain/card.ts joins the card's lines with "\n")
    expect(splitForTrtc("医生是这样说的：\nPlease take a walk after dinner.\nAnd rest when you are tired.\n药袋上写着：\n每天一次。", "zh")).toEqual([
      { text: "医生是这样说的：", language: "zh" },
      { text: "Please take a walk after dinner. And rest when you are tired.", language: "en" },
      { text: "药袋上写着： 每天一次。", language: "zh" },
    ]);
    // a Chinese sentence with an English name in it is Chinese
    expect(splitForTrtc("这是 Amlodipine 的说明。", "zh")).toEqual([{ text: "这是 Amlodipine 的说明。", language: "zh" }]);
    // no line break or tab is ever sent: a line break is where requests may be cut, any other run of blanks is one space
    const blanks = splitForTrtc("第一行。\r\n第二行。\n\n\tThird   line,\twith a tab.\n", "zh");
    expect(blanks).toEqual([
      { text: "第一行。 第二行。", language: "zh" },
      { text: "Third line, with a tab.", language: "en" },
    ]);
    for (const p of blanks) expect(/[\n\r\t]/.test(p.text)).toBe(false);
  });

  it("a heading that does not end its own sentence is not run into the next line: it is its own request", () => {
    expect(splitForTrtc("使用条款和隐私\n第一段的第一句。\n第一段的第二句。", "zh")).toEqual([
      { text: "使用条款和隐私", language: "zh" },
      { text: "第一段的第一句。 第一段的第二句。", language: "zh" },
    ]);
    expect(splitForTrtc("Terms and privacy\nThe first sentence. (And a second one.)\nA third.", "en")).toEqual([
      { text: "Terms and privacy", language: "en" },
      { text: "The first sentence. (And a second one.) A third.", language: "en" },
    ]);
  });

  it("numbers alone go with what came before, else with what comes after, else with the request's language", () => {
    expect(splitForTrtc("今天的数字是：\n135 / 85\nThank you.", "zh")).toEqual([
      { text: "今天的数字是： 135 / 85", language: "zh" },
      { text: "Thank you.", language: "en" },
    ]);
    expect(splitForTrtc("135 / 85\nThank you.", "zh")).toEqual([
      { text: "135 / 85", language: "en" },
      { text: "Thank you.", language: "en" },
    ]);
    expect(splitForTrtc("135 / 85", "zh")).toEqual([{ text: "135 / 85", language: "zh" }]);
    expect(splitForTrtc("135 / 85", "en")).toEqual([{ text: "135 / 85", language: "en" }]);
  });

  it("a long paragraph is cut at sentence ends, then clause marks, then anywhere: every piece fits, nothing is lost or added", () => {
    const sentences = "今天天气很好，我们去公园散步。".repeat(40); // 600 characters, 1200 units
    const clauses = `${"我们先喝茶，再看报纸，".repeat(40)}然后回家。`;
    const unbroken = "好".repeat(400);
    const english = `${"Please take 2.5 cups of water with you, and rest when you are tired. ".repeat(12)}Thank you.`;
    for (const text of [sentences, clauses, unbroken, english, `${sentences}\n${english}\n${unbroken}`]) {
      const pieces = splitForTrtc(text, "zh");
      expect(pieces.length).toBeGreaterThan(1);
      for (const p of pieces) {
        expect(p.text.trim()).toBe(p.text);
        expect(p.text.length).toBeGreaterThan(0);
        expect(trtcUnits(p.text)).toBeLessThanOrEqual(255);
      }
      expect(squeeze(pieces.map((p) => p.text).join(""))).toBe(squeeze(text));
    }
    for (const p of splitForTrtc(sentences, "zh")) expect(p.text.endsWith("。")).toBe(true);
    for (const p of splitForTrtc(clauses, "zh")) expect(p.text).toMatch(/[，。]$/);
    // "2.5" is one number: a full stop ends a sentence only before a space
    for (const p of splitForTrtc(english, "en")) {
      expect(p.language).toBe("en");
      expect(p.text).not.toMatch(/\b2\.$/);
      expect(p.text).toMatch(/[.,]$/);
    }
    // 127 Chinese characters are 254 units: 400 of them need four requests
    expect(splitForTrtc(unbroken, "zh").map((p) => p.text.length)).toEqual([127, 127, 127, 19]);
  });

  it("every screen the app reads aloud before sign-in fits the same way, in both languages", () => {
    for (const screen of READ_ALOUD_SCREENS) {
      for (const locale of ["zh-Hans", "en"] as const) {
        for (const part of readAloudParts(screen, locale)) {
          const pieces = splitForTrtc(part, locale === "en" ? "en" : "zh");
          for (const p of pieces) expect(trtcUnits(p.text), `${screen} ${locale}`).toBeLessThanOrEqual(255);
          expect(squeeze(pieces.map((p) => p.text).join(""))).toBe(squeeze(part));
        }
      }
    }
  });

  it("each piece is asked for on its own and the answers are joined in the text's order, with a short pause between", async () => {
    const text = "医生是这样说的：\nPlease take a walk after dinner.\n药袋上写着：每天一次。";
    const pieces = splitForTrtc(text, "zh");
    expect(pieces).toHaveLength(3);
    // the first answer arrives last
    const fake = tencent(async (s) => {
      const i = pieces.findIndex((p) => p.text === s.json.Text);
      if (i === 0) await new Promise((r) => setTimeout(r, 30));
      return spoken(wavBase64(tone(100 * (i + 1), 1000 * (i + 1))));
    });
    const out = await createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text, lang: "zh-Hans" });
    expect(fake.sent.map((s) => [s.json.Text, s.json.Language, s.json.Voice.VoiceId])).toEqual([
      ["医生是这样说的：", "zh", "v-female-R2s4N9qJ"],
      ["Please take a walk after dinner.", "en", "v-female-R2s4N9qJ"],
      ["药袋上写着：每天一次。", "zh", "v-female-R2s4N9qJ"],
    ]);
    const gap = new Int16Array((TRTC_TTS_GAP_MS / 1000) * RATE);
    const expected = [tone(100, 1000), gap, tone(200, 2000), gap, tone(300, 3000)];
    expect(Array.from(samplesOf(out.audio))).toEqual(expected.flatMap((a) => Array.from(a)));
    expect(out.durationMs).toBe(100 + 200 + 300 + 2 * TRTC_TTS_GAP_MS);
    expect(parseWav(out.audio)?.durationMs).toBe(out.durationMs);
  });

  it("one piece that fails ends the whole read-aloud: never some of the sentences", async () => {
    const fake = tencent((s) => (s.json.Language === "en" ? refused("InternalError") : spoken()));
    const err = await failure(createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "医生是这样说的：\nPlease take a walk after dinner.\n药袋上写着：每天一次。", lang: "zh-Hans" }));
    expect(err.code).toBe("provider_failed");
  });

  it("the longest text the app allows is read, in many requests, four at a time at most", async () => {
    const text = "今天天气很好，我们去公园散步。".repeat(200).slice(0, TTS_MAX_CHARS);
    let open = 0;
    let most = 0;
    const fake = tencent(async () => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 2));
      open--;
      return spoken(wavBase64(tone(20)));
    });
    const out = await createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text, lang: "zh-Hans" });
    expect(fake.sent.length).toBeGreaterThanOrEqual(16);
    expect(most).toBeLessThanOrEqual(4);
    for (const s of fake.sent) expect(trtcUnits(s.json.Text)).toBeLessThanOrEqual(255);
    expect(squeeze(fake.sent.map((s) => s.json.Text).join(""))).toBe(squeeze(text));
    expect(out.durationMs).toBe(fake.sent.length * 20 + (fake.sent.length - 1) * TRTC_TTS_GAP_MS);
  });
});

describe("refused before anything is sent", () => {
  it("nothing to read, and a text over the app's limit", async () => {
    const fake = tencent();
    const voice = createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW });
    for (const text of ["", "   ", "\n\n"]) expect((await failure(voice.synthesize({ text, lang: "zh-Hans" }))).code).toBe("empty_text");
    expect((await failure(voice.synthesize({ text: "好".repeat(TTS_MAX_CHARS + 1), lang: "zh-Hans" }))).code).toBe("too_long");
    expect(fake.sent).toHaveLength(0);
    expect(voice.ready).toBe(true);
  });
});

describe("what the service can answer instead of audio", () => {
  const CASES: [string, "not_configured" | "too_long" | "provider_failed", boolean][] = [
    // the API page's own list
    ["InvalidParameter.VoiceId", "not_configured", true],
    ["InvalidParameter.Speed", "not_configured", true],
    ["InvalidParameter.Pitch", "not_configured", true],
    ["InvalidParameter.Volume", "not_configured", true],
    ["InvalidParameter.SampleRate", "not_configured", true],
    ["MissingParameter.APIKey", "not_configured", true],
    ["UnsupportedOperation.NotAllowed", "not_configured", true],
    ["InvalidParameter.TextLength", "too_long", false],
    ["InvalidParameter.PronunciationDict", "provider_failed", false],
    ["UnsupportedOperation.InternalError", "provider_failed", false],
    // the common error codes: the keys
    ["AuthFailure.SignatureFailure", "not_configured", true],
    ["AuthFailure.SecretIdNotFound", "not_configured", true],
    ["AuthFailure.InvalidSecretId", "not_configured", true],
    ["AuthFailure.SignatureExpire", "not_configured", true],
    ["AuthFailure.UnauthorizedOperation", "not_configured", true],
    ["AuthFailure.UnRealNameAuthenticated", "not_configured", true],
    ["UnauthorizedOperation", "not_configured", true],
    ["FailedOperation.NotAbility", "not_configured", true],
    ["UnsupportedRegion", "not_configured", true],
    ["InvalidAction", "not_configured", true],
    ["NoSuchVersion", "not_configured", true],
    // the common error codes: this moment, not this configuration
    ["RequestLimitExceeded", "provider_failed", false],
    ["RequestLimitExceeded.UinLimitExceeded", "provider_failed", false],
    ["LimitExceeded", "provider_failed", false],
    ["ResourceInsufficient", "provider_failed", false],
    ["ResourceUnavailable", "provider_failed", false],
    ["InternalError", "provider_failed", false],
    ["ServiceUnavailable", "provider_failed", false],
    ["FailedOperation", "provider_failed", false],
    ["RequestSizeLimitExceeded", "too_long", false],
    ["SomethingNobodyHasSeenYet", "provider_failed", false],
  ];

  it.each(CASES)("%s is %s", async (code, kind, closes) => {
    expect(classifyTrtcError(code)).toEqual({ kind, closes });
    const fake = tencent(() => refused(code));
    const voice = createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW });
    const err = await failure(voice.synthesize({ text: "你好", lang: "zh-Hans" }));
    expect(err.code).toBe(kind);
    expect(err).toBeInstanceOf(TrtcTtsError);
    // the vendor's code and RequestId for the owner and for support; never the vendor's sentence
    expect(err.message).toContain(code);
    expect(err.message).toContain(REQUEST_ID);
    expect(err.message).not.toContain("a vendor message");
    expect((err as TrtcTtsError).vendorCode).toBe(code);
    expect((err as TrtcTtsError).requestId).toBe(REQUEST_ID);
    expect(voice.ready).toBe(!closes);
  });

  it("an error arrives with HTTP 200 or without: the body decides", async () => {
    const fake = tencent(() => Response.json({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "m" }, RequestId: REQUEST_ID } }, { status: 401 }));
    expect((await failure(createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "你好", lang: "zh-Hans" }))).code).toBe("not_configured");
  });

  it("anything that is not an answer is provider_failed, and does not close read-aloud", async () => {
    const stereo = encodeWav(tone(50));
    new DataView(stereo.buffer).setUint16(22, 2, true);
    const float = encodeWav(tone(50));
    new DataView(float.buffer).setUint16(20, 3, true);
    const answers: [string, Answer][] = [
      ["a gateway's HTML", () => new Response("<html>502 Bad Gateway</html>", { status: 502 })],
      ["JSON without a Response", () => Response.json({ ok: true })],
      ["HTTP 500 with an empty Response", () => Response.json({ Response: { RequestId: REQUEST_ID } }, { status: 500 })],
      ["no Audio", () => Response.json({ Response: { RequestId: REQUEST_ID } })],
      ["an empty Audio", () => spoken("")],
      // the page's Output Example as printed: a placeholder, not audio
      ["the page's own placeholder", () => spoken("base64audio")],
      ["not base64", () => spoken("@@@ not base64 @@@")],
      ["raw samples without a WAV header", () => spoken(Buffer.from(tone(50).buffer).toString("base64"))],
      ["two channels", () => spoken(Buffer.from(stereo).toString("base64"))],
      ["float samples", () => spoken(Buffer.from(float).toString("base64"))],
      ["a WAV with no samples", () => spoken(wavBase64(new Int16Array(0)))],
      [
        "the network",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ];
    for (const [what, answer] of answers) {
      const fake = tencent(answer);
      const voice = createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW });
      const err = await failure(voice.synthesize({ text: "你好", lang: "zh-Hans" }));
      expect(err.code, what).toBe("provider_failed");
      expect(voice.ready, what).toBe(true);
    }
  });

  it("pieces at different sample rates are not glued together", async () => {
    const fake = tencent((s) => spoken(wavBase64(tone(50), s.json.Language === "en" ? 16_000 : 24_000)));
    const err = await failure(createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).synthesize({ text: "你好。\nHello.", lang: "zh-Hans" }));
    expect(err.code).toBe("provider_failed");
  });

  it("no answer in time: the request is abandoned and it is provider_failed", async () => {
    let aborted = 0;
    const fake = tencent(
      (s) =>
        new Promise<Response>((_, reject) => {
          s.signal?.addEventListener("abort", () => {
            aborted++;
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    );
    const voice = createTrtcTts({ ...ENV, TRTC_TTS_TIMEOUT_MS: "40" }, { fetch: fake.fetch, now: () => NOW });
    const started = Date.now();
    const err = await failure(voice.synthesize({ text: "你好。\nHello.", lang: "zh-Hans" }));
    expect(err.code).toBe("provider_failed");
    expect(err.message).toContain("did not answer within 40 ms");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(2);
    // a slow moment is not a wrong configuration: the next tap tries again
    expect(voice.ready).toBe(true);
  });
});

describe("ready: configured, and not refused in the last ten minutes", () => {
  it("configured: ready before any request (nothing is spent to find out)", () => {
    const fake = tencent();
    expect(createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW }).ready).toBe(true);
    expect(fake.sent).toHaveLength(0);
  });

  it("a refusal of the configuration closes it for every provider object of the process; nothing is sent meanwhile; then one try", async () => {
    let t = NOW;
    let answer: Answer = () => refused("AuthFailure.SecretIdNotFound");
    const fake = tencent((s, i) => answer(s, i));
    const voice = () => createTrtcTts(ENV, { fetch: fake.fetch, now: () => t });
    expect((await failure(voice().synthesize({ text: "你好", lang: "zh-Hans" }))).code).toBe("not_configured");
    expect(fake.sent).toHaveLength(1);
    // a page asks a new provider object on every render (lib/tts getTtsProvider)
    expect(voice().ready).toBe(false);
    t += TRTC_TTS_HOLD_MS - 1;
    expect(voice().ready).toBe(false);
    const held = await failure(voice().synthesize({ text: "你好", lang: "zh-Hans" }));
    expect(held.code).toBe("not_configured");
    expect(held.message).toContain("AuthFailure.SecretIdNotFound");
    expect(fake.sent).toHaveLength(1);
    // ten minutes on: offered again, and the next request is really sent
    t += 1;
    expect(voice().ready).toBe(true);
    await failure(voice().synthesize({ text: "你好", lang: "zh-Hans" }));
    expect(fake.sent).toHaveLength(2);
    expect(voice().ready).toBe(false);
    // the owner fixed the key: after the hold a good answer opens it and it stays open
    t += TRTC_TTS_HOLD_MS;
    answer = () => spoken();
    await voice().synthesize({ text: "你好", lang: "zh-Hans" });
    expect(voice().ready).toBe(true);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("Read-aloud is off for 10 minutes"))).toHaveLength(2);
  });

  it("a busy or slow service does not close it", async () => {
    for (const code of ["RequestLimitExceeded", "InternalError", "InvalidParameter.TextLength"]) {
      const fake = tencent(() => refused(code));
      const voice = createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW });
      await failure(voice.synthesize({ text: "你好", lang: "zh-Hans" }));
      await failure(voice.synthesize({ text: "你好", lang: "zh-Hans" }));
      expect(voice.ready, code).toBe(true);
      expect(fake.sent, code).toHaveLength(2);
    }
  });
});

describe("what is never written down", () => {
  it("the text, the keys and the vendor's message are in no log line and no error", async () => {
    const text = "这句话只读给他听 only-for-his-ears";
    const logs: unknown[][] = [];
    for (const level of ["log", "info", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
    const errors: TtsError[] = [];
    const answers: Answer[] = [
      () => refused("AuthFailure.SignatureFailure", `echo ${text} test-secret-key`),
      () => refused("InternalError", `echo ${text}`),
      () => new Response(`<html>${text}</html>`, { status: 500 }),
      () => spoken("base64audio"),
      () => {
        throw new TypeError(`fetch failed for ${text} with test-secret-key`);
      },
      () => spoken(),
    ];
    for (const answer of answers) {
      resetTrtcTtsHealth();
      const fake = tencent(answer);
      await createTrtcTts(ENV, { fetch: fake.fetch, now: () => NOW })
        .synthesize({ text, lang: "zh-Hans" })
        .catch((e: TtsError) => errors.push(e));
    }
    expect(errors).toHaveLength(5);
    const written = JSON.stringify([logs, warn.mock.calls, errors.map((e) => [e.message, String(e), e.stack, { ...e }, (e as { cause?: unknown }).cause ?? null])]);
    for (const secret of ["只读给他听", "only-for-his-ears", "test-secret-key", "test-secret-id", "echo"]) expect(written).not.toContain(secret);
    expect(warn.mock.calls.length).toBe(5);
  });
});
