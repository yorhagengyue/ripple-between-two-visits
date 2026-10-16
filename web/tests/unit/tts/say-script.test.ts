/**
 * scripts/tts/say.ts, the owner's first real sentence: it stops with a clear sentence when the real provider is not
 * configured (and sends nothing), and with a stand-in for the service it writes a playable WAV and prints no key.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTrtcTtsHealth, trtcUnits } from "@/lib/tts/trtc";
import { encodeWav, parseWav } from "@/lib/visit/wav";
import { say } from "../../../scripts/tts/say";

const ENV = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TENCENT_SECRET_ID: "test-secret-id", TENCENT_SECRET_KEY: "test-secret-key" };
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-t-say-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  resetTrtcTtsHealth();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function run(args: string[], env: Record<string, string | undefined>, answer?: (body: { Text: string; Language: string }) => Response) {
  const out: string[] = [];
  const err: string[] = [];
  const sent: { Text: string; Language: string }[] = [];
  const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { Text: string; Language: string };
    sent.push(body);
    if (answer) return answer(body);
    return Response.json({ Response: { Audio: Buffer.from(encodeWav(new Int16Array(12_000).fill(300), 24_000)).toString("base64"), RequestId: "req-1" } });
  }) as typeof fetch;
  return say(args, { env, fetch: fake, out: (l) => out.push(l), err: (l) => err.push(l) }).then((code) => ({ code, out, err, sent }));
}

describe("not configured: a clear sentence, nothing sent, nothing written", () => {
  it("the mock, or no provider at all", async () => {
    for (const env of [{}, { TTS_PROVIDER: "mock" }, { ...ENV, TTS_PROVIDER: "" }]) {
      const r = await run(["--out", dir], env);
      expect(r.code).toBe(1);
      expect(r.err[0]).toMatch(/^Nothing was sent\. TTS_PROVIDER is ("mock"|not set): this script speaks only through the real voice\.$/);
      expect(r.err.join("\n")).toContain("TRTC_SDK_APP_ID, TENCENT_SECRET_ID, TENCENT_SECRET_KEY");
      expect(r.sent).toHaveLength(0);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("trtc with a value missing: each missing variable by name, and which key pair is meant", async () => {
    const r = await run(["--out", dir], { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TRTC_SDK_SECRET_KEY: "an-sdk-secret" });
    expect(r.code).toBe(1);
    expect(r.err.slice(0, 3)).toEqual(["Nothing was sent. TTS_PROVIDER=trtc is not configured:", "  - TENCENT_SECRET_ID is not set", "  - TENCENT_SECRET_KEY is not set"]);
    expect(r.err.join("\n")).toContain("the application's SDKSecretKey (TRTC_SDK_SECRET_KEY) is not used for speech");
    expect(r.err.join("\n")).not.toContain("an-sdk-secret");
    expect(r.sent).toHaveLength(0);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("configured, with a stand-in for the service", () => {
  it("one Mandarin sentence: a WAV file under the folder asked for, the settings by name, never a key", async () => {
    const r = await run(["--out", dir], ENV);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].Language).toBe("zh");
    const files = readdirSync(dir).filter((f) => /^say-zh-\d{8}-\d{6}\.wav$/.test(f));
    expect(files).toHaveLength(1);
    expect(parseWav(new Uint8Array(readFileSync(path.join(dir, files[0]))))).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationMs: 500 });
    const printed = r.out.join("\n");
    expect(printed).toContain("provider: trtc  host: trtc.intl.tencentcloudapi.com  region: ap-singapore  voice: v-female-R2s4N9qJ  speed: 0.9  sample rate: 24000");
    expect(printed).toContain(`written to ${path.join(dir, files[0])}`);
    expect(printed).toContain("It is Mandarin (not Cantonese)");
    for (const secret of ["test-secret-id", "test-secret-key", "160001234"]) expect(printed).not.toContain(secret);
  });

  it("--en uses the English voice's language; --long is several requests, the English line among them", async () => {
    const en = await run(["--en", "--out", dir], ENV);
    expect([en.code, en.sent.map((s) => s.Language)]).toEqual([0, ["en"]]);
    const long = await run(["--long", "--out", dir], ENV);
    expect(long.code).toBe(0);
    expect(long.sent.length).toBeGreaterThanOrEqual(3);
    expect(long.sent.map((s) => s.Language)).toContain("en");
    for (const s of long.sent) expect(trtcUnits(s.Text)).toBeLessThanOrEqual(255);
    expect(readdirSync(dir).filter((f) => f.startsWith("say-long-"))).toHaveLength(1);
  });

  it("the service refuses: the vendor's code and RequestId, what to look at first, no file", async () => {
    const before = readdirSync(dir).length;
    const r = await run(["--out", dir], ENV, () => Response.json({ Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "m" }, RequestId: "req-9" } }));
    expect(r.code).toBe(1);
    expect(r.err[0]).toBe("No audio: not_configured. Tencent TextToSpeech answered AuthFailure.SignatureFailure (RequestId req-9)");
    expect(r.err[1]).toContain("a cloud API key pair (Access Keys), not the application's SDKSecretKey");
    expect(readdirSync(dir)).toHaveLength(before);
  });
});
