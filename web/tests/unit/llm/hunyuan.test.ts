/**
 * Tencent Cloud Hunyuan on TokenHub as the main model and the layer-3 checker (the owner, 10-16: 「模型本身用混元。把 DeepSeek
 * 直接去掉。」; lib/llm/hunyuan.ts), with no network: provider selection and the retired deepseek value, the key and the base
 * URL (TokenHub's hosts only), the request (thinking off, JSON mode, max_tokens, images as data URLs, the key only in the
 * header), the vendor's content-safety stop and an error inside a stream, usage and price (yuan from TokenHub's price page),
 * the US$ ledger and cap, timeouts, retries, clear errors, the concurrency queue, and recording -> offline replay.
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
  createVisionLlm,
  hunyuanSettings,
  LlmError,
  llmStatus,
  mainModel,
  mainProviderKind,
  mainVendor,
  visionModel,
  withRecording,
} from "@/lib/llm";
import { tokenhubBaseUrl } from "@/lib/llm/hunyuan";
import { visionMode } from "@/lib/vision";
import { parseModelJson } from "@/lib/llm/json";
import { acquireSlot, backoffMs, parseUsage, slotStatus, upstreamError, type CompatConfig } from "@/lib/llm/openai";
import { costUsd, estimateUsd, priceFor, SpendLedger } from "@/lib/llm/spend";

const KEY = "sk-tokenhub-test-not-real";
const HY = { LLM_PROVIDER: "hunyuan", HUNYUAN_API_KEY: KEY };
const BASE = "https://tokenhub-intl.tencentcloudmaas.com/v1";

function hyCfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "hunyuan",
    vendor: "tencent",
    baseUrl: BASE,
    apiKey: KEY,
    model: "hy3",
    maxTokensField: "max_tokens",
    jsonMode: false,
    extraBody: { thinking: { type: "disabled" } },
    timeoutMs: 200,
    maxAttempts: 2,
    ledger: null,
    ...over,
  };
}

function reply(content: string, usage: Record<string, unknown> = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }, finish = "stop"): Response {
  return new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }], usage }), { status: 200 });
}

/** A streamed answer: one `data:` line per chunk, then [DONE]. */
function stream(chunks: unknown[]): Response {
  const body = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const piece = (content: string, finish: string | null = null, extra: Record<string, unknown> = {}) => ({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content, ...extra }, finish_reason: finish }] });

/** A fetch that never answers until its signal aborts (a stalled request). */
const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_res, reject) => {
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
  });

describe("provider selection", () => {
  it("LLM_PROVIDER=hunyuan uses hy3 on TokenHub's international Singapore site with the key; without the key it stays offline", () => {
    expect(mainProviderKind(HY)).toBe("hunyuan");
    expect(mainModel(HY)).toBe("hy3");
    expect(mainVendor(HY)).toBe("tencent");
    expect(createMainLlm(HY)).toMatchObject({ provider: "hunyuan", model: "hy3" });
    expect(createMainLlm({ ...HY, HUNYUAN_MODEL: "hy4-preview" }).model).toBe("hy4-preview");
    expect(createMainLlm({ ...HY, HUNYUAN_MODEL: "hy4-preview", LLM_MODEL: "hy3" }).model).toBe("hy3");
    expect(hunyuanSettings(HY)).toMatchObject({ baseUrl: BASE, site: "singapore", problem: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mainProviderKind({ LLM_PROVIDER: "hunyuan" })).toBe("mock");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("only TokenHub's own https hosts get the key: the other sites and the backups are accepted, anything else is not", () => {
    expect(hunyuanSettings({ ...HY, HUNYUAN_BASE_URL: "https://tokenhub-intl.tencentcloudmaas.tech/v1/" })).toMatchObject({ baseUrl: "https://tokenhub-intl.tencentcloudmaas.tech/v1", site: "singapore", problem: null });
    expect(hunyuanSettings({ ...HY, HUNYUAN_BASE_URL: "https://tokenhub.tencentcloudmaas.com/v1" }).site).toBe("guangzhou");
    expect(hunyuanSettings({ ...HY, HUNYUAN_BASE_URL: "https://tokenhub-us.tencentcloudmaas.com/v1" }).site).toBe("siliconvalley");
    expect(hunyuanSettings({ ...HY, HUNYUAN_BASE_URL: "https://tokenhub.tencentmaas.com/v1" }).problem).toBeNull();
    for (const bad of ["http://tokenhub-intl.tencentcloudmaas.com/v1", "https://tokenhub-intl.tencentcloudmaas.com.evil.example/v1", "https://evil.example/v1", "https://user:pw@tokenhub-intl.tencentcloudmaas.com/v1", "not a url"]) {
      expect(tokenhubBaseUrl(bad), bad).toBeNull();
      expect(hunyuanSettings({ ...HY, HUNYUAN_BASE_URL: bad }).problem, bad).toBe("bad_base_url");
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mainProviderKind({ ...HY, HUNYUAN_BASE_URL: "https://evil.example/v1" })).toBe("mock");
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", HUNYUAN_BASE_URL: "https://evil.example/v1" }).config).toBeNull();
    warn.mockRestore();
  });

  it("a key alone never turns the real model on (tests and e2e must not spend)", () => {
    expect(mainProviderKind({ HUNYUAN_API_KEY: KEY })).toBe("mock");
    expect(mainProviderKind({ LLM_PROVIDER: "mock", HUNYUAN_API_KEY: KEY })).toBe("mock");
    expect(createMainLlm({ HUNYUAN_API_KEY: KEY }).provider).toBe("mock");
  });

  it("deepseek is retired: refused with a warning, never called", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mainProviderKind({ LLM_PROVIDER: "deepseek", RIPPLE_DEEPSEEK_API_KEY: "sk-x" })).toBe("mock");
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "deepseek" }).reason).toMatch(/retired/);
    warn.mockRestore();
  });

  it("the offline mock stands in for Hunyuan: its model and vendor are Hunyuan's", () => {
    expect(mainModel({})).toBe("hy3");
    expect(mainVendor({})).toBe("tencent");
  });

  it("replay of Hunyuan runs: provider and default model follow REPLAY_PROVIDER", () => {
    expect(createMainLlm({ LLM_PROVIDER: "replay", REPLAY_PROVIDER: "hunyuan" })).toMatchObject({ provider: "replay:hunyuan", model: "hy3" });
  });

  it("the checker: hy4-preview on the same key, same vendor reported, one attempt, short timeout, thinking off, its own queue", () => {
    const res = checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan" });
    expect(res.reason).toBeNull();
    expect(res.independence).toBe("same_vendor");
    expect(res.config).toMatchObject({ name: "hunyuan", vendor: "tencent", model: "hy4-preview", baseUrl: BASE, timeoutMs: 10_000, totalTimeoutMs: 10_000, maxAttempts: 1, slotKey: "hunyuan:checker", extraBody: { thinking: { type: "disabled" } } });
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", CHECKER_TIMEOUT_MS: "4000", CHECKER_MAX_ATTEMPTS: "2" }).config).toMatchObject({ timeoutMs: 4000, maxAttempts: 2 });
    // a separate checker key wins over the shared one; the checker follows HUNYUAN_BASE_URL
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", CHECKER_API_KEY: "sk-other" }).config?.apiKey).toBe("sk-other");
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", HUNYUAN_BASE_URL: "https://tokenhub.tencentcloudmaas.com/v1" }).config?.baseUrl).toBe("https://tokenhub.tencentcloudmaas.com/v1");
    // HUNYUAN_THINKING=enabled turns it on for both; CHECKER_THINKING wins for the checker
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", HUNYUAN_THINKING: "enabled" }).config?.extraBody).toEqual({ thinking: { type: "enabled" } });
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", HUNYUAN_THINKING: "enabled", CHECKER_THINKING: "disabled" }).config?.extraBody).toEqual({ thinking: { type: "disabled" } });
  });

  it("the main model cannot check itself (fail closed); no key, no checker; OpenAI as the main model cannot check itself", () => {
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", CHECKER_MODEL: "hy3" }).reason).toMatch(/not be the main model/);
    expect(checkerConfig({ CHECKER_PROVIDER: "hunyuan" }).reason).toMatch(/HUNYUAN_API_KEY not set/);
    expect(checkerConfig({ OPENAI_API_KEY: "sk-o", CHECKER_PROVIDER: "openai", CHECKER_API_KEY: "sk-o", CHECKER_MODEL: "x" }).reason).toMatch(/different vendor/);
    // another vendor checking Hunyuan is fully independent
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "gemini", CHECKER_API_KEY: "sk-g", CHECKER_MODEL: "g" }).independence).toBe("other_vendor");
  });

  it("CHECKER_PROVIDER=replay answers layer 3 from Hunyuan cassettes by default", () => {
    const c = createChecker({ LLM_PROVIDER: "replay", REPLAY_PROVIDER: "hunyuan", CHECKER_PROVIDER: "replay" });
    expect(c.client).toMatchObject({ provider: "replay:hunyuan", model: "hy4-preview" });
    expect(c.independence).toBe("same_vendor");
  });

  it("label photos: no Hunyuan model reads images on the account, so none is called unless LLM_VISION_MODEL names one", () => {
    expect(visionModel(HY)).toBeNull();
    expect(createVisionLlm(HY).provider).toBe("mock");
    expect(visionMode(HY)).toBe("cassette");
    expect(createVisionLlm({ ...HY, LLM_VISION_MODEL: "some-hunyuan-vision" })).toMatchObject({ provider: "hunyuan", model: "some-hunyuan-vision" });
    expect(visionMode({ ...HY, LLM_VISION_MODEL: "some-hunyuan-vision" })).toBe("model");
    expect(createVisionLlm({}).provider).toBe("mock");
  });

  it("prints names and the site, never a key", () => {
    const s = JSON.stringify(llmStatus({ ...HY, CHECKER_PROVIDER: "hunyuan", VITEST: "true" }));
    expect(s).not.toContain(KEY);
    expect(s).toContain('"hunyuanKey":"set"');
    expect(s).toContain('"hunyuanSite":"singapore"');
    expect(s).toContain('"checkerIndependence":"same_vendor"');
    expect(s).toContain('"checkerModel":"hy4-preview"');
    expect(s).toContain('"visionModel":null');
  });
});

describe("request body", () => {
  it("thinking off, max_tokens, no JSON mode (it garbled hy3's replies; the prompt asks for JSON), no stream, images as data URLs", () => {
    const body = buildPayload(hyCfg(), { system: "s", user: "u", json: true, maxTokens: 120, temperature: 0, images: [{ mime: "image/png", base64: "AAAA" }] });
    expect(body).toMatchObject({ model: "hy3", temperature: 0, max_tokens: 120, thinking: { type: "disabled" }, stream: false });
    expect(body).not.toHaveProperty("response_format");
    expect(checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan" }).config?.jsonMode).toBe(false);
    expect((body.messages as { content: unknown }[])[1].content).toEqual([
      { type: "text", text: "u" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("LLM_THINKING=enabled turns thinking on and raises the completion budget it needs", () => {
    const res = checkerConfig({ ...HY, CHECKER_PROVIDER: "hunyuan", CHECKER_THINKING: "enabled" }).config!;
    expect(res.extraBody).toEqual({ thinking: { type: "enabled" } });
    expect(buildPayload(res, { system: "s", user: "u", maxTokens: 120 }).max_tokens).toBe(4096);
  });

  it("the vision client sends no thinking field", async () => {
    const seen: string[] = [];
    // createVisionLlm builds its own client; its config is the same as the main one less the thinking field
    const client = createCompatClient(hyCfg({ model: "hy-vision-2.0-instruct", extraBody: undefined }), async (_u, init) => {
      seen.push(String(init.body));
      return reply("white");
    });
    await client.chat({ system: "s", user: "u", images: [{ mime: "image/png", base64: "AAAA" }] });
    expect(JSON.parse(seen[0])).not.toHaveProperty("thinking");
  });

  it("posts to {base}/chat/completions with the key only in the header", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = createCompatClient(hyCfg(), async (url, init) => {
      seen.push({ url, init });
      return reply('{"ok":true}');
    });
    await client.chat({ system: "s", user: "patient words 你好", json: true });
    expect(seen[0].url).toBe("https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(seen[0].init.body)).not.toContain(KEY);
  });
});

describe("content safety and errors inside a stream", () => {
  it("finish_reason content_filter is a failed call (451), billed, never an answer", async () => {
    const ledger = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    const client = createCompatClient(hyCfg({ ledger }), async () => reply("", undefined, "content_filter"));
    await expect(client.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "upstream", status: 451 });
    expect(ledger.spentUsd()).toBeGreaterThan(0);
  });

  it("a refusal in message.refusal is a failed call too", async () => {
    const client = createCompatClient(hyCfg(), async () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "I can't help" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    await expect(client.chat({ system: "s", user: "u" })).rejects.toMatchObject({ status: 451 });
  });

  it("HTTP 451 (TokenHub 451001, content filtered) fails at once, without retry or failover", async () => {
    let n = 0;
    const client = createCompatClient(hyCfg({ maxAttempts: 3 }), async () => {
      n++;
      return new Response(JSON.stringify({ error: { code: "451001", message: "x", type: "content_filter" } }), { status: 451 });
    });
    await expect(client.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "upstream", status: 451 });
    expect(n).toBe(1);
    expect(upstreamError({ name: "hunyuan" }, 451).message).toBe("hunyuan 451: the vendor's content safety filtered the request or the reply");
    // (E2, 10-16: a 429 that survived the retries says it was the rate limit; the harness records it apart from a timeout)
    expect((upstreamError({ name: "hunyuan" }, 429) as { rateLimited?: boolean }).rateLimited).toBe(true);
    expect((upstreamError({ name: "hunyuan" }, 500) as { rateLimited?: boolean }).rateLimited).toBeUndefined();
  });

  it("streams the pieces; reasoning_content is never a piece of the answer", async () => {
    const got: string[] = [];
    const client = createCompatClient(hyCfg(), async () =>
      stream([piece("", null, { reasoning_content: "thinking about the patient" }), piece('{"answer":"Take it '), piece('daily"}', "stop"), { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7, total_tokens: 57 } }]),
    );
    const res = await client.chat({ system: "s", user: "u", onDelta: (t) => got.push(t) });
    expect(got.join("")).toBe('{"answer":"Take it daily"}');
    expect(res).toMatchObject({ content: '{"answer":"Take it daily"}', streamed: true, tokens: 57, finishReason: "stop" });
  });

  it("an error frame inside the stream breaks the call off (never read as a shorter answer); after words went out, no retry", async () => {
    let n = 0;
    const client = createCompatClient(hyCfg({ maxAttempts: 3 }), async () => {
      n++;
      return stream([piece("Take "), { error: { code: "502001", message: "upstream" } }]);
    });
    await expect(client.chat({ system: "s", user: "u", onDelta: () => {} })).rejects.toMatchObject({ code: "unreachable", emitted: true });
    expect(n).toBe(1);
  });

  it("a content_filter stop at the end of a stream fails with emitted (no retry, no failover)", async () => {
    const client = createCompatClient(hyCfg(), async () => stream([piece("Some words "), piece("", "content_filter")]));
    await expect(client.chat({ system: "s", user: "u", onDelta: () => {} })).rejects.toMatchObject({ code: "upstream", status: 451, emitted: true });
  });
});

describe("usage and price", () => {
  it("reads the cached-token split and reasoning tokens", () => {
    const u = parseUsage({ usage: { prompt_tokens: 900, completion_tokens: 50, total_tokens: 950, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens_details: { reasoning_tokens: 0 } } });
    expect(u).toEqual({ promptTokens: 900, cacheHitTokens: 600, cacheMissTokens: 300, completionTokens: 50, reasoningTokens: 0, total: 950 });
  });

  it("prices from the international TokenHub price page in US$ (input at the uncached rate, an upper bound)", () => {
    expect(priceFor("hy3")).toMatchObject({ inputPerM: 0.132, outputPerM: 0.528 });
    expect(priceFor("hy4-preview")).toMatchObject({ inputPerM: 0.834, outputPerM: 2.501 });
    expect(priceFor("hy3-preview").source).toMatch(/not listed on the page/);
    expect(priceFor("hy3").source).toMatch(/tencentcloud\.com\/document\/product\/1300\/78937/);
    expect(costUsd("hy3", { promptTokens: 1000, completionTokens: 200 })).toBeCloseTo((1000 * 0.132 + 200 * 0.528) / 1e6, 12);
    // an unknown model is charged at a conservative default, never zero
    expect(costUsd("some-new-model", { promptTokens: 1000, completionTokens: 0 })).toBeGreaterThan(0);
    expect(priceFor("hy3", { LLM_PRICES_JSON: '{"hy3":{"input":1,"output":2}}' })).toMatchObject({ inputPerM: 1, outputPerM: 2 });
    // 300 bytes of text = 100 tokens, plus max_tokens of output
    expect(estimateUsd("hy3", { text: "x".repeat(300), maxTokens: 100 })).toBeCloseTo((100 * 0.132 + 100 * 0.528) / 1e6, 12);
  });

  it("returns usage, US$, attempts and finish reason on every call", async () => {
    const client = createCompatClient(hyCfg(), async () => reply('{"a":1}'));
    const res = await client.chat({ system: "s", user: "u" });
    expect(res).toMatchObject({ content: '{"a":1}', tokens: 1200, provider: "hunyuan", model: "hy3", attempts: 1, finishReason: "stop" });
    expect(res.usd).toBeCloseTo((1000 * 0.132 + 200 * 0.528) / 1e6, 12);
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
    const client = createCompatClient(hyCfg({ ledger }), async () => reply('{"sentences":["Take ONE tablet every MORNING"]}'));
    await client.chat({ system: "system prompt", user: "今天 150/95，我能不能多吃一粒？", purpose: "compose" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ provider: "hunyuan", model: "hy3", purpose: "compose", ok: true, error: null, prompt_tokens: 1000, completion_tokens: 200 });
    const raw = readFileSync(file, "utf8");
    for (const banned of ["150/95", "多吃", "Take ONE", "system prompt", KEY]) expect(raw).not.toContain(banned);
  });

  it("refuses a call that would pass the cap before anything is sent (402 budget)", async () => {
    const file = path.join(dir, "ledger.jsonl");
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), usd: 4.9999 }) + "\n");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    let sent = 0;
    const client = createCompatClient(hyCfg({ ledger, model: "hy4-preview" }), async () => {
      sent++;
      return reply("{}");
    });
    const err = await client.chat({ system: "s", user: "u".repeat(3000), maxTokens: 900 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "budget", status: 402 });
    expect(sent).toBe(0);
  });

  it("charges a timed-out attempt at its estimate (the vendor may still bill it)", async () => {
    const ledger = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    const client = createCompatClient(hyCfg({ ledger, maxAttempts: 1, timeoutMs: 20 }), hanging);
    await expect(client.chat({ system: "s", user: "u", maxTokens: 100 })).rejects.toMatchObject({ code: "timeout" });
    expect(ledger.spentUsd()).toBeGreaterThan(0);
  });
});

describe("timeouts, retries, errors", () => {
  it("times out each attempt, retries once, then fails with a clear timeout error", async () => {
    let calls = 0;
    const client = createCompatClient(hyCfg({ timeoutMs: 30, maxAttempts: 2 }), (url, init) => {
      calls++;
      return hanging(url, init);
    });
    const err = await client.chat({ system: "s", user: "u" }).catch((e) => e);
    expect(err).toMatchObject({ code: "timeout", status: 504 });
    expect(err.message).toMatch(/timed out after 30 ms \(2 attempts\)/);
    expect(calls).toBe(2);
  });

  it("retries TokenHub's 429 (Retry-After) and 5xx, then answers", async () => {
    const answers = [new Response(JSON.stringify({ error: { code: 429001 } }), { status: 429, headers: { "retry-after": "0" } }), new Response("{}", { status: 503 })];
    const client = createCompatClient(hyCfg({ maxAttempts: 3 }), async () => answers.shift() ?? reply('{"ok":1}'));
    await expect(client.chat({ system: "s", user: "u" })).resolves.toMatchObject({ attempts: 3, content: '{"ok":1}' });
  });

  it("backoff grows exponentially with jitter, capped; Retry-After wins", () => {
    expect(backoffMs(1, null, () => 0)).toBe(400);
    expect(backoffMs(2, null, () => 0)).toBe(800);
    expect(backoffMs(9, null, () => 0)).toBe(4000);
    expect(backoffMs(1, "2")).toBe(2000);
  });

  it("TokenHub's 401 (bad key), 403 (no access to the model), 402 (arrears, free quota used up) and 400 (unknown model) fail at once with clear codes and no key", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [403, "auth"],
      [402, "insufficient_balance"],
      [400, "upstream"],
    ] as const) {
      let n = 0;
      const client = createCompatClient(hyCfg({ maxAttempts: 3 }), async () => {
        n++;
        return new Response(JSON.stringify({ error: { code: "x", message: `secret echo ${KEY}` } }), { status });
      });
      const err = await client.chat({ system: "s", user: "u" }).catch((e) => e);
      expect(err).toMatchObject({ code });
      expect(n).toBe(1);
      expect(String(err.message)).not.toContain(KEY);
    }
  });

  it("a 200 whose body is not JSON is a bad_response, not a crash", async () => {
    const client = createCompatClient(hyCfg(), async () => new Response("<html>gateway</html>", { status: 200 }));
    await expect(client.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("concurrency cap", () => {
  it("queues callers beyond the cap and lets them through in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const client = createCompatClient(hyCfg({ name: "hunyuan-cap-test", maxConcurrency: 1, queueTimeoutMs: 2000 }), async () => {
      const i = ++n;
      order.push(`start ${i}`);
      if (i === 1) await gate;
      order.push(`end ${i}`);
      return reply("{}");
    });
    const a = client.chat({ system: "s", user: "1" });
    const b = client.chat({ system: "s", user: "2" });
    await new Promise((r) => setTimeout(r, 20));
    expect(slotStatus("hunyuan-cap-test")).toEqual({ active: 1, waiting: 1 });
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("a caller that waits too long gets busy (503), and the slot count stays right", async () => {
    const hold = await acquireSlot("hunyuan-busy-test", 1, 1000);
    await expect(acquireSlot("hunyuan-busy-test", 1, 20)).rejects.toMatchObject({ code: "busy", status: 503 });
    hold();
    expect(slotStatus("hunyuan-busy-test")).toEqual({ active: 0, waiting: 0 });
  });
});

describe("recording and offline replay of Hunyuan calls", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-cassettes-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a recorded live call replays offline with the same answer; nothing secret is written", async () => {
    const live = withRecording(createCompatClient(hyCfg(), async () => reply('{"route":"explain","reason":"x"}')), dir);
    const opts = { system: "classify", user: '{"task":"classify","input":"what is it for"}', json: true };
    const first = await live.chat(opts);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const cassette = JSON.parse(readFileSync(path.join(dir, files[0]), "utf8"));
    expect(cassette.request).toMatchObject({ provider: "hunyuan", model: "hy3", user: opts.user });
    expect(JSON.stringify(cassette)).not.toContain(KEY);
    const replay = createMainLlm({ LLM_PROVIDER: "replay", REPLAY_PROVIDER: "hunyuan", CASSETTE_DIR: dir });
    await expect(replay.chat(opts)).resolves.toMatchObject({ content: first.content, provider: "replay:hunyuan", cassette: files[0] });
    await expect(replay.chat({ ...opts, user: "something else" })).rejects.toMatchObject({ code: "cassette_missing" });
  });

  it("LLM_RECORD=1 is on for both live clients and shows in the status", () => {
    const env = { ...HY, CHECKER_PROVIDER: "hunyuan", LLM_RECORD: "1", CASSETTE_DIR: dir, VITEST: "true" };
    expect(llmStatus(env).recording).toBe(true);
    expect(createMainLlm(env)).toMatchObject({ provider: "hunyuan", model: "hy3" });
    expect(createChecker(env).client).toMatchObject({ provider: "hunyuan", model: "hy4-preview" });
  });
});

describe("model JSON", () => {
  it("accepts strict JSON and one fenced block, nothing else", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseModelJson('Sure! {"a":1}')).toThrow();
    expect(() => parseModelJson("")).toThrow();
  });
});
