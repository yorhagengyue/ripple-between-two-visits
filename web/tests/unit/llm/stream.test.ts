/**
 * The model client's streaming call (ChatOpts.onDelta, owner 10-15 SSE), with no network: the OpenAI-compatible client
 * asks DeepSeek for `stream: true` and reads its event stream piece by piece; the result, the price and the ledger are what
 * a plain call gives; a stream cut after its first piece is never tried again; the mock streams its canned words in
 * pieces; a vendor that answers in one piece still reaches the caller.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPayload, createCompatClient, createMockLlm } from "@/lib/llm";
import { MOCK_GENERAL } from "@/lib/llm/mock";
import type { CompatConfig } from "@/lib/llm/openai";
import { costUsd, SpendLedger } from "@/lib/llm/spend";

function cfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "deepseek",
    vendor: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test-not-real",
    model: "deepseek-flash",
    maxTokensField: "max_tokens",
    jsonMode: true,
    extraBody: { thinking: { type: "disabled" } },
    timeoutMs: 2000,
    maxAttempts: 2,
    ledger: null,
    ...over,
  };
}

const USAGE = { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 900 };

/** DeepSeek's stream: one chunk per piece, the usage chunk, [DONE]; the bytes cut at odd places. */
function sseBody(pieces: string[], opts: { usage?: boolean; breakAfter?: number } = {}): ReadableStream<Uint8Array> {
  const frames = pieces.map((p) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`);
  frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }] })}\n\n`);
  if (opts.usage !== false) frames.push(`data: ${JSON.stringify({ choices: [], usage: USAGE })}\n\n`);
  frames.push("data: [DONE]\n\n");
  const text = ": keep-alive\n\n" + frames.join("");
  const bytes = new TextEncoder().encode(text);
  let sent = 0;
  let frame = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.breakAfter !== undefined && frame > opts.breakAfter) {
        controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
        return;
      }
      if (sent >= bytes.length) return controller.close();
      // 7 bytes at a time: frames, words and even characters are cut in the middle
      const next = bytes.slice(sent, sent + 7);
      sent += next.length;
      frame = text.slice(0, sent).split("\n\n").length - 2;
      controller.enqueue(next);
    },
  });
}

const streamed = (body: ReadableStream<Uint8Array>) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the request", () => {
  it("a plain call is as it was (stream: false); a streamed one asks for the usage in the last chunk", () => {
    const plain = buildPayload(cfg(), { system: "s", user: "u" });
    expect(plain.stream).toBe(false);
    expect(plain).not.toHaveProperty("stream_options");
    const s = buildPayload(cfg(), { system: "s", user: "u", onDelta: () => {} });
    expect(s).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
});

describe("streaming from an OpenAI-compatible vendor", () => {
  it("gives each piece as it comes and resolves with the whole reply, priced from the last chunk's usage", async () => {
    const ledger = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    const record = vi.spyOn(ledger, "record");
    const pieces = ['{"answer": "口腔', "溃疡时先别吃", '太辣。", "ask": "none"}'];
    let body: unknown = null;
    const client = createCompatClient(cfg({ ledger }), async (_url, init) => {
      body = JSON.parse(String(init.body));
      return streamed(sseBody(pieces));
    });
    const got: string[] = [];
    const res = await client.chat({ system: "s", user: "u", json: true, maxTokens: 400, onDelta: (t) => got.push(t) });
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(got).toEqual(pieces);
    expect(res.content).toBe(pieces.join(""));
    expect(res).toMatchObject({ streamed: true, finishReason: "stop", tokens: 960 });
    const usd = costUsd("deepseek-flash", { promptTokens: 900, completionTokens: 60 });
    expect(res.usd).toBeCloseTo(usd, 10);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ ok: true, prompt_tokens: 900, completion_tokens: 60, estimated: false });
  });

  it("a stream that ends without the usage chunk is charged its estimate", async () => {
    const ledger = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    const record = vi.spyOn(ledger, "record");
    const client = createCompatClient(cfg({ ledger }), async () => streamed(sseBody(["hello"], { usage: false })));
    const res = await client.chat({ system: "s", user: "u", maxTokens: 100, onDelta: () => {} });
    expect(res.content).toBe("hello");
    expect(res.usd).toBeGreaterThan(0);
    expect(record.mock.calls[0][0]).toMatchObject({ ok: true, estimated: true });
    expect(ledger.spentUsd()).toBeGreaterThan(0);
  });

  it("a stream cut after its first piece fails at once: no second attempt, no failover", async () => {
    let calls = 0;
    let fallbackCalls = 0;
    const fallback = cfg({ name: "openai", baseUrl: "https://fallback.invalid", apiKey: "sk-fb" });
    const client = createCompatClient(cfg({ fallback }), async (url) => {
      if (url.startsWith("https://fallback.invalid")) fallbackCalls++;
      else calls++;
      return streamed(sseBody(["one ", "two ", "three"], { breakAfter: 1 }));
    });
    const got: string[] = [];
    const err = await client.chat({ system: "s", user: "u", onDelta: (t) => got.push(t) }).catch((e) => e);
    expect(err).toMatchObject({ emitted: true });
    expect(got.length).toBeGreaterThan(0);
    expect(calls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  it("a failure before the first piece is retried as before, and the retry streams", async () => {
    let calls = 0;
    const client = createCompatClient(cfg(), async () => {
      calls++;
      return calls === 1 ? new Response("busy", { status: 503 }) : streamed(sseBody(["ok"]));
    });
    const got: string[] = [];
    const res = await client.chat({ system: "s", user: "u", onDelta: (t) => got.push(t) });
    expect(calls).toBe(2);
    expect(got).toEqual(["ok"]);
    expect(res.content).toBe("ok");
  });

  it("a vendor that answers a streamed request in one plain body: the caller gets the words once", async () => {
    const client = createCompatClient(cfg(), async () => new Response(JSON.stringify({ choices: [{ message: { content: "whole" }, finish_reason: "stop" }], usage: USAGE }), { status: 200 }));
    const got: string[] = [];
    const res = await client.chat({ system: "s", user: "u", onDelta: (t) => got.push(t) });
    expect(got).toEqual(["whole"]);
    expect(res).toMatchObject({ content: "whole", streamed: true });
  });
});

describe("the offline mock", () => {
  it("streams its canned general answer in small pieces, and answers at once without onDelta", async () => {
    vi.stubEnv("MOCK_STREAM_DELAY_MS", "0");
    const mock = createMockLlm();
    const user = JSON.stringify({ task: "general", locale: "zh-Hans", question: "口腔溃疡能吃辣吗", medicines: [], sources: [] });
    const got: string[] = [];
    const res = await mock.chat({ system: "s", user, onDelta: (t) => got.push(t) });
    expect(got.length).toBeGreaterThan(5);
    expect(got.join("")).toBe(res.content);
    expect(JSON.parse(res.content)).toEqual(MOCK_GENERAL.zh);
    expect(res.streamed).toBe(true);
    const plain = await mock.chat({ system: "s", user });
    expect(plain.content).toBe(res.content);
    expect(plain.streamed).toBeUndefined();
  });
});
