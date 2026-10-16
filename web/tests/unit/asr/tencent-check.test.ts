/**
 * scripts/asr/tencent-check.ts, the check to run once the owner's key pair exists, against the fake Tencent ASR: without the
 * pair it sends nothing and exits 2 saying which variable is missing; with it, the free health check, one fixture clip
 * through the app's own client (its text and its milliseconds), the whole-visit path with --whole; a refusal exits 1 with
 * what to look at. Never a key in what it prints.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check } from "@/scripts/asr/tencent-check";
import { FAKE_SECRET_ID, FAKE_SECRET_KEY, fakeTencent } from "./fake-tencent";

const WEB = fileURLToPath(new URL("../../../", import.meta.url));
const KEYS = { TENCENT_SECRET_ID: FAKE_SECRET_ID, TENCENT_SECRET_KEY: FAKE_SECRET_KEY };

async function run(args: string[], env: Record<string, string>, fake = fakeTencent()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await check(args, { env, fetch: fake.fetch, out: (l) => out.push(l), err: (l) => err.push(l), webDir: WEB });
  return { code, out: out.join("\n"), err: err.join("\n"), fake };
}

describe("scripts/asr/tencent-check.ts", () => {
  it("without the key pair: nothing sent, exit 2, which variable", async () => {
    const r = await run([], {});
    expect(r.code).toBe(2);
    expect(r.err).toContain("Nothing was sent: TENCENT_SECRET_ID and TENCENT_SECRET_KEY are not set.");
    expect(r.fake.calls).toHaveLength(0);
    expect((await run([], { TENCENT_SECRET_ID: FAKE_SECRET_ID })).err).toContain("TENCENT_SECRET_KEY is not set");
  });

  it("with it: the free check, one clip's text and time, and the whole-visit path; never a key", async () => {
    const fake = fakeTencent();
    fake.sentencesFor = () => [{ text: "Please don't change the dose yourself.", startMs: 0, endMs: 2940 }];
    const r = await run(["--whole"], KEYS, fake);
    expect(r.code).toBe(0);
    expect(r.out).toContain("provider: tencent  host: asr.ap-singapore.tencentcloudapi.com  region: ap-singapore  engine: 16k_zh_en");
    expect(r.out).toContain("health check (DescribeTaskStatus for a task that does not exist; nothing billed): ok");
    expect(r.out).toContain("clip: v2-u08.wav");
    expect(r.out).toMatch(/live line: \d+ ms from sending to text/);
    expect(r.out).toContain("text: Please don't change the dose yourself.");
    expect(r.out).toMatch(/whole-visit path: \d+ ms, 1 line\(s\), model tencent:16k_zh_en/);
    expect(`${r.out}\n${r.err}`).not.toContain(FAKE_SECRET_KEY);
    expect(`${r.out}\n${r.err}`).not.toContain(FAKE_SECRET_ID);
    expect(fake.calls.map((c) => c.action)[0]).toBe("DescribeTaskStatus");
    expect(fake.calls.filter((c) => c.action === "CreateRecTask")).toHaveLength(2);
  });

  it("--engine for one run; --health only the free check; a refusal exits 1 with what to look at", async () => {
    const fake = fakeTencent();
    expect((await run(["--engine", "16k_zh_large"], KEYS, fake)).out).toContain("engine: 16k_zh_large");
    expect(fake.calls.find((c) => c.action === "CreateRecTask")?.body.EngineModelType).toBe("16k_zh_large");
    const health = await run(["--health"], KEYS);
    expect([health.code, health.fake.calls.length]).toEqual([0, 1]);
    const off = fakeTencent();
    off.errorFor.CreateRecTask = "FailedOperation.UserNotRegistered";
    const r = await run([], KEYS, off);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No text: not_configured:service_not_enabled");
    expect(r.err).toContain("Recording file recognition is not opened on this account");
    const wrong = await run([], { ...KEYS, TENCENT_SECRET_KEY: "not the key" });
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("Check TENCENT_SECRET_ID and TENCENT_SECRET_KEY");
    expect(`${wrong.out}\n${wrong.err}`).not.toContain("not the key");
  });

  it("a clip that is not a 16 kHz mono WAV is not sent", async () => {
    const r = await run(["--clip", path.join(WEB, "package.json")], KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toContain("is not a 16 kHz mono 16-bit WAV");
  });
});
