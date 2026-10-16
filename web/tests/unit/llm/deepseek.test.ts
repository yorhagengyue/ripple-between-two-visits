/**
 * DeepSeek as the main model and the layer-3 checker (overnight plan item 2), with no network: provider
 * selection, the request body (non-thinking mode, JSON mode, images), usage and price, the US$ spend ledger and
 * cap, timeouts, retries with backoff, the concurrency queue, clear errors, and recording -> offline replay.
 */
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPayload,
  checkerConfig,
  createChecker,
  createCompatClient,
  createMainLlm,
  LlmError,
  llmStatus,
  mainModel,
  mainProviderKind,
  withRecording,
} from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import { acquireSlot, backoffMs, parseUsage, slotStatus, type CompatConfig } from "@/lib/llm/openai";
import { costUsd, estimateUsd, priceFor, SpendLedger, spendLogPath, TRUNCATED_LINE_USD } from "@/lib/llm/spend";

const KEY = "sk-deepseek-test-not-real";
const DS = { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: KEY };

function dsCfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "deepseek",
    vendor: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: KEY,
    model: "deepseek-flash",
    maxTokensField: "max_tokens",
    jsonMode: true,
    extraBody: { thinking: { type: "disabled" } },
    timeoutMs: 200,
    maxAttempts: 2,
    ledger: null,
    ...over,
  };
}

function reply(content: string, usage: Record<string, unknown> = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }, finish = "stop"): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage }), { status: 200 });
}

/** A fetch that never answers until its signal aborts (a stalled request). */
const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_res, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
  });

describe("provider selection", () => {
  it("LLM_PROVIDER=deepseek uses deepseek-flash with the key; without the key it stays offline", () => {
    expect(mainProviderKind(DS)).toBe("deepseek");
    expect(mainModel(DS)).toBe("deepseek-flash");
    expect(createMainLlm(DS)).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
    expect(createMainLlm({ ...DS, LLM_MODEL: "deepseek-v4-flash" }).model).toBe("deepseek-v4-flash");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mainProviderKind({ LLM_PROVIDER: "deepseek" })).toBe("mock");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a DeepSeek key alone never turns the real model on (tests and e2e must not spend)", () => {
    expect(mainProviderKind({ DEEPSEEK_API_KEY: KEY })).toBe("mock");
    expect(mainProviderKind({ LLM_PROVIDER: "mock", DEEPSEEK_API_KEY: KEY })).toBe("mock");
    expect(createMainLlm({ DEEPSEEK_API_KEY: KEY }).provider).toBe("mock");
  });

  it("replay of DeepSeek runs: provider and default model follow REPLAY_PROVIDER", () => {
    const env = { LLM_PROVIDER: "replay", REPLAY_PROVIDER: "deepseek" };
    expect(createMainLlm(env)).toMatchObject({ provider: "replay:deepseek", model: "deepseek-flash" });
  });

  it("the checker: deepseek-v4-pro on the same key, same vendor reported, one attempt, short timeout, non-thinking", () => {
    const res = checkerConfig({ ...DS, CHECKER_PROVIDER: "deepseek" });
    expect(res.reason).toBeNull();
    expect(res.independence).toBe("same_vendor");
    expect(res.config).toMatchObject({
      name: "deepseek",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 10_000,
      maxAttempts: 1,
      extraBody: { thinking: { type: "disabled" } },
    });
    expect(checkerConfig({ ...DS, CHECKER_PROVIDER: "deepseek", CHECKER_TIMEOUT_MS: "4000", CHECKER_MAX_ATTEMPTS: "2" }).config).toMatchObject({ timeoutMs: 4000, maxAttempts: 2 });
    // a separate checker key wins over the shared one
    expect(checkerConfig({ ...DS, CHECKER_PROVIDER: "deepseek", CHECKER_API_KEY: "sk-other" }).config?.apiKey).toBe("sk-other");
  });

  it("the main model cannot check itself, and OpenAI still cannot check its own stand-in", () => {
    expect(checkerConfig({ ...DS, CHECKER_PROVIDER: "deepseek", CHECKER_MODEL: "deepseek-flash" }).reason).toMatch(/not be the main model/);
    expect(checkerConfig({ CHECKER_PROVIDER: "deepseek" }).reason).toMatch(/DEEPSEEK_API_KEY not set/);
    expect(checkerConfig({ CHECKER_PROVIDER: "openai", CHECKER_API_KEY: KEY, CHECKER_MODEL: "x" }).reason).toMatch(/different vendor/);
    // another vendor checking DeepSeek is fully independent
    expect(checkerConfig({ ...DS, CHECKER_PROVIDER: "gemini", CHECKER_API_KEY: KEY, CHECKER_MODEL: "g" }).independence).toBe("other_vendor");
  });

  it("CHECKER_PROVIDER=replay answers layer 3 from cassettes", () => {
    const c = createChecker({ LLM_PROVIDER: "replay", REPLAY_PROVIDER: "deepseek", CHECKER_PROVIDER: "replay" });
    expect(c.client).toMatchObject({ provider: "replay:deepseek", model: "deepseek-v4-pro" });
    expect(c.independence).toBe("same_vendor");
  });

  it("prints names and set / not set, never a key", () => {
    const s = JSON.stringify(llmStatus({ ...DS, CHECKER_PROVIDER: "deepseek", VITEST: "true" }));
    expect(s).not.toContain(KEY);
    expect(s).toContain('"deepseekKey":"set"');
    expect(s).toContain('"checkerIndependence":"same_vendor"');
    expect(s).toContain('"checkerModel":"deepseek-v4-pro"');
  });
});

describe("request body", () => {
  it("non-thinking mode, max_tokens, JSON mode, no stream, images as data URLs", () => {
    const body = buildPayload(dsCfg(), { system: "s", user: "u", json: true, maxTokens: 120, temperature: 0, images: [{ mime: "image/png", base64: "AAAA" }] });
    expect(body).toMatchObject({
      model: "deepseek-flash",
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
    });
    expect((body.messages as { content: unknown }[])[1].content).toEqual([
      { type: "text", text: "u" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("LLM_THINKING=enabled turns thinking on and raises the completion budget it needs", () => {
    const cfg = createMainLlm({ ...DS, LLM_THINKING: "enabled" });
    expect(cfg.provider).toBe("deepseek");
    const res = checkerConfig({ ...DS, CHECKER_PROVIDER: "deepseek", CHECKER_THINKING: "enabled" }).config!;
    expect(res.extraBody).toEqual({ thinking: { type: "enabled" } });
    expect(buildPayload(res, { system: "s", user: "u", maxTokens: 120 }).max_tokens).toBe(4096);
  });

  it("posts to {base}/chat/completions with the key only in the header", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = createCompatClient(dsCfg(), async (url, init) => {
      seen.push({ url, init });
      return reply('{"ok":true}');
    });
    await client.chat({ system: "s", user: "patient words 你好", json: true });
    expect(seen[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(seen[0].init.body)).not.toContain(KEY);
  });
});

describe("usage and price", () => {
  it("reads DeepSeek's cache split and reasoning tokens", () => {
    const u = parseUsage({
      usage: { prompt_tokens: 900, completion_tokens: 50, total_tokens: 950, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 300, completion_tokens_details: { reasoning_tokens: 0 } },
    });
    expect(u).toEqual({ promptTokens: 900, cacheHitTokens: 600, cacheMissTokens: 300, completionTokens: 50, reasoningTokens: 0, total: 950 });
    // OpenAI's shape: cached tokens under prompt_tokens_details
    expect(parseUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } })).toMatchObject({ cacheHitTokens: 4, cacheMissTokens: 6, total: 12 });
  });

  it("prices at the peak cache-miss rates (an upper bound) and estimates before the call", () => {
    expect(priceFor("deepseek-flash")).toMatchObject({ inputPerM: 0.3, outputPerM: 1.2 });
    expect(priceFor("deepseek-v4-pro")).toMatchObject({ inputPerM: 1.32, outputPerM: 3.96 });
    expect(costUsd("deepseek-flash", { promptTokens: 1000, completionTokens: 200 })).toBeCloseTo(0.00054, 10);
    expect(costUsd("deepseek-v4-pro", { promptTokens: 1000, completionTokens: 100 })).toBeCloseTo(0.001716, 10);
    // an unknown model is charged at a conservative default, never zero
    expect(costUsd("some-new-model", { promptTokens: 1000, completionTokens: 0 })).toBeGreaterThan(0);
    expect(priceFor("deepseek-flash", { LLM_PRICES_JSON: '{"deepseek-flash":{"input":1,"output":2}}' })).toMatchObject({ inputPerM: 1, outputPerM: 2 });
    // 300 bytes of text = 100 tokens, plus max_tokens of output
    expect(estimateUsd("deepseek-flash", { text: "x".repeat(300), maxTokens: 100 })).toBeCloseTo((100 * 0.3 + 100 * 1.2) / 1e6, 12);
  });

  it("returns usage, US$, attempts and finish reason on every call", async () => {
    const client = createCompatClient(dsCfg(), async () => reply('{"a":1}'));
    const res = await client.chat({ system: "s", user: "u" });
    expect(res).toMatchObject({ content: '{"a":1}', tokens: 1200, provider: "deepseek", model: "deepseek-flash", attempts: 1, finishReason: "stop" });
    expect(res.usd).toBeCloseTo(0.00054, 10);
  });
});

describe("spend ledger and cap", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-spend-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes one line per call with counts and US$ only: no prompt, no answer, no key", async () => {
    const file = path.join(dir, "ledger.jsonl");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    const client = createCompatClient(dsCfg({ ledger }), async () => reply('{"sentences":["Take ONE tablet every MORNING"]}'));
    await client.chat({ system: "system prompt", user: "今天 150/95，我能不能多吃一粒？", purpose: "compose" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const e = JSON.parse(lines[0]);
    expect(e).toMatchObject({ provider: "deepseek", model: "deepseek-flash", purpose: "compose", ok: true, error: null, prompt_tokens: 1000, completion_tokens: 200 });
    expect(e.usd).toBeCloseTo(0.00054, 6);
    const raw = readFileSync(file, "utf8");
    for (const banned of ["150/95", "多吃", "Take ONE", "system prompt", KEY]) expect(raw).not.toContain(banned);
  });

  it("refuses a call that would pass the cap before anything is sent (402 budget)", async () => {
    const file = path.join(dir, "ledger.jsonl");
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), usd: 4.9999 }) + "\n");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    let sent = 0;
    const client = createCompatClient(dsCfg({ ledger }), async () => {
      sent++;
      return reply("{}");
    });
    const err = await client.chat({ system: "s", user: "u".repeat(3000), maxTokens: 900 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "budget", status: 402 });
    expect(sent).toBe(0);
    expect(err.message).toMatch(/cap US\$5/);
  });

  it("is shared between processes through the file, and only counts the window", () => {
    const file = path.join(dir, "ledger.jsonl");
    let now = Date.parse("2026-10-09T12:00:00Z");
    const a = new SpendLedger({ file, capUsd: 1, windowMs: 3_600_000, now: () => now });
    const b = new SpendLedger({ file, capUsd: 1, windowMs: 3_600_000, now: () => now });
    const entry = (usd: number, at = new Date(now).toISOString()) => ({
      at,
      provider: "deepseek",
      model: "deepseek-flash",
      purpose: "compose" as const,
      ok: true,
      error: null,
      attempts: 1,
      latency_ms: 10,
      prompt_tokens: 1,
      cache_hit_tokens: 0,
      cache_miss_tokens: 1,
      completion_tokens: 1,
      reasoning_tokens: 0,
      usd,
      estimated: false,
    });
    a.record(entry(0.4));
    expect(b.spentUsd()).toBeCloseTo(0.4, 9); // another process sees it
    b.record(entry(0.5));
    expect(a.spentUsd()).toBeCloseTo(0.9, 9);
    expect(() => a.reserve(0.2)).toThrow(/spend cap reached/);
    const release = a.reserve(0.05);
    expect(() => b.reserve(0.0)).not.toThrow();
    expect(a.summary()).toMatchObject({ inFlightUsd: 0.05, calls: 2 });
    release();
    // an hour later both lines are out of the window
    now += 3_600_001;
    expect(a.spentUsd()).toBe(0);
    // a half-written last line counts as TRUNCATED_LINE_USD until its newline arrives (fix round 3: it counted as 0)
    appendFileSync(file, JSON.stringify(entry(0.1)) + "\n" + '{"at":"2026-');
    expect(a.spentUsd()).toBeCloseTo(0.1 + TRUNCATED_LINE_USD, 9);
    // a damaged line fails closed (fix round 2: it used to be skipped, i.e. counted as US$0)
    appendFileSync(file, '01"}\nnot json\n');
    expect(() => a.spentUsd()).toThrow(/corrupt_line/);
    // deleting the file resets the budget
    rmSync(file);
    expect(a.spentUsd()).toBe(0);
  });

  it("under vitest the ledger stays in memory, also with LLM_SPEND_LOG exported (fix round 2); a test may opt in", () => {
    expect(spendLogPath({ VITEST: "true" })).toBeNull();
    expect(spendLogPath({ VITEST: "true", LLM_SPEND_LOG: path.join(dir, "x.jsonl") })).toBeNull();
    expect(spendLogPath({ VITEST: "true", LLM_SPEND_LOG: path.join(dir, "x.jsonl"), LLM_SPEND_LOG_IN_TESTS: "1" })).toBe(path.join(dir, "x.jsonl"));
    expect(spendLogPath({})).toMatch(/[\\/]\.data[\\/]llm-spend\.jsonl$/);
  });

  it("charges a timed-out attempt at its estimate (the vendor may still bill it)", async () => {
    const ledger = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    const client = createCompatClient(dsCfg({ ledger, maxAttempts: 1, timeoutMs: 20 }), hanging);
    await expect(client.chat({ system: "s", user: "u", maxTokens: 100 })).rejects.toMatchObject({ code: "timeout" });
    expect(ledger.spentUsd()).toBeGreaterThan(0);
  });
});

describe("timeouts, retries, errors", () => {
  it("times out each attempt, retries once, then fails with a clear timeout error", async () => {
    let calls = 0;
    const client = createCompatClient(dsCfg({ timeoutMs: 30, maxAttempts: 2 }), (url, init) => {
      calls++;
      return hanging(url, init);
    });
    const t0 = Date.now();
    const err = await client.chat({ system: "s", user: "u" }).catch((e) => e);
    expect(err).toMatchObject({ code: "timeout", status: 504 });
    expect(err.message).toMatch(/timed out after 30 ms \(2 attempts\)/);
    expect(calls).toBe(2);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("a per-call timeout overrides the client's", async () => {
    const client = createCompatClient(dsCfg({ timeoutMs: 60_000, maxAttempts: 1 }), hanging);
    await expect(client.chat({ system: "s", user: "u", timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("retries 429 and 5xx with backoff, then answers", async () => {
    const statuses = [429, 503];
    const client = createCompatClient(dsCfg({ maxAttempts: 3 }), async () => {
      const s = statuses.shift();
      return s ? new Response("busy", { status: s }) : reply('{"ok":1}');
    });
    const res = await client.chat({ system: "s", user: "u" });
    expect(res).toMatchObject({ attempts: 3, content: '{"ok":1}' });
  });

  it("backoff grows exponentially with jitter, capped; Retry-After wins", () => {
    expect(backoffMs(1, null, () => 0)).toBe(400);
    expect(backoffMs(2, null, () => 0)).toBe(800);
    expect(backoffMs(9, null, () => 0)).toBe(4000);
    expect(backoffMs(1, null, () => 0.999)).toBe(649);
    expect(backoffMs(1, "2")).toBe(2000);
    expect(backoffMs(1, "60")).toBe(8000);
  });

  it("401, 402 and 400 fail at once with clear codes and no key", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [402, "insufficient_balance"],
      [400, "upstream"],
    ] as const) {
      let n = 0;
      const client = createCompatClient(dsCfg({ maxAttempts: 3 }), async () => {
        n++;
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status });
      });
      const err = await client.chat({ system: "s", user: "u" }).catch((e) => e);
      expect(err).toMatchObject({ code });
      expect(n).toBe(1);
      expect(String(err.message)).not.toContain(KEY);
    }
  });

  it("a 200 whose body is not JSON is a bad_response, not a crash", async () => {
    const client = createCompatClient(dsCfg(), async () => new Response("<html>gateway</html>", { status: 200 }));
    await expect(client.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "bad_response" });
  });

  it("a dropped connection is retried and reported as unreachable with no request text", async () => {
    const client = createCompatClient(dsCfg({ maxAttempts: 2 }), async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    const err = await client.chat({ system: "s", user: "secret patient words" }).catch((e) => e);
    expect(err).toMatchObject({ code: "unreachable" });
    expect(err.message).toContain("ECONNRESET");
    expect(err.message).not.toContain("secret patient words");
  });
});

describe("concurrency cap", () => {
  it("queues callers beyond the cap and lets them through in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const client = createCompatClient(dsCfg({ name: "deepseek-cap-test", maxConcurrency: 1, queueTimeoutMs: 2000 }), async () => {
      const i = ++n;
      order.push(`start ${i}`);
      if (i === 1) await gate;
      order.push(`end ${i}`);
      return reply("{}");
    });
    const a = client.chat({ system: "s", user: "1" });
    const b = client.chat({ system: "s", user: "2" });
    await new Promise((r) => setTimeout(r, 20));
    expect(slotStatus("deepseek-cap-test")).toEqual({ active: 1, waiting: 1 });
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(slotStatus("deepseek-cap-test")).toEqual({ active: 0, waiting: 0 });
  });

  it("a caller that waits too long gets busy (503), and the slot count stays right", async () => {
    const hold = await acquireSlot("deepseek-busy-test", 1, 1000);
    await expect(acquireSlot("deepseek-busy-test", 1, 20)).rejects.toMatchObject({ code: "busy", status: 503 });
    hold();
    const again = await acquireSlot("deepseek-busy-test", 1, 20);
    again();
    expect(slotStatus("deepseek-busy-test")).toEqual({ active: 0, waiting: 0 });
  });
});

describe("recording and offline replay of DeepSeek calls", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-cassettes-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a recorded live call replays offline with the same answer; nothing secret is written", async () => {
    const live = withRecording(createCompatClient(dsCfg(), async () => reply('{"route":"explain","reason":"x"}')), dir);
    const opts = { system: "classify", user: '{"task":"classify","input":"what is it for"}', json: true };
    const first = await live.chat(opts);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const cassette = JSON.parse(readFileSync(path.join(dir, files[0]), "utf8"));
    expect(cassette.request).toMatchObject({ provider: "deepseek", model: "deepseek-flash", user: opts.user });
    expect(cassette.response).toMatchObject({ content: first.content, usage: { promptTokens: 1000, completionTokens: 200 } });
    expect(JSON.stringify(cassette)).not.toContain(KEY);

    const replay = createMainLlm({ LLM_PROVIDER: "replay", REPLAY_PROVIDER: "deepseek", CASSETTE_DIR: dir });
    await expect(replay.chat(opts)).resolves.toMatchObject({ content: first.content, provider: "replay:deepseek", cassette: files[0] });
    await expect(replay.chat({ ...opts, user: "something else" })).rejects.toMatchObject({ code: "cassette_missing" });
  });

  it("LLM_RECORD=1 is on for both live clients and shows in the status", () => {
    const env = { ...DS, CHECKER_PROVIDER: "deepseek", LLM_RECORD: "1", CASSETTE_DIR: dir, VITEST: "true" };
    expect(llmStatus(env).recording).toBe(true);
    // the wrapped clients keep the live provider names, so the cassette keys match the replay's
    expect(createMainLlm(env)).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
    expect(createChecker(env).client).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(llmStatus({ ...DS, VITEST: "true" }).recording).toBe(false);
  });
});

describe("model JSON", () => {
  it("accepts strict JSON and one fenced block, nothing else", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson("```\n[1,2]\n```")).toEqual([1, 2]);
    expect(() => parseModelJson('Sure! {"a":1}')).toThrow();
    expect(() => parseModelJson("")).toThrow();
  });
});
