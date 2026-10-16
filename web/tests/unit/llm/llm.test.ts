import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPayload,
  cassetteKey,
  checkerConfig,
  createCompatClient,
  createMainLlm,
  createMockLlm,
  createReplayClient,
  fallbackConfig,
  LlmError,
  llmStatus,
  mainProviderKind,
  setMockInjection,
  withRecording,
  type LlmClient,
} from "@/lib/llm";
import type { CompatConfig } from "@/lib/llm/openai";
import type { ComposePayload } from "@/lib/llm/protocol";

const KEY = "sk-test-not-a-real-key";

function cfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "openai",
    vendor: "openai",
    baseUrl: "https://example.invalid/v1",
    apiKey: KEY,
    model: "gpt-5.4-mini",
    maxTokensField: "max_completion_tokens",
    jsonMode: true,
    timeoutMs: 1000,
    maxAttempts: 2,
    ...over,
  };
}

function okResponse(content: string, tokens = 12): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: tokens } }), { status: 200 });
}

describe("provider selection", () => {
  it("defaults to the offline mock without keys; stub is an alias", () => {
    expect(mainProviderKind({})).toBe("mock");
    expect(mainProviderKind({ LLM_PROVIDER: "stub" })).toBe("mock");
    expect(mainProviderKind({ LLM_PROVIDER: "mock", OPENAI_API_KEY: KEY })).toBe("mock");
    expect(mainProviderKind({ LLM_PROVIDER: "openai" })).toBe("mock"); // no key -> still runs offline
    expect(mainProviderKind({ OPENAI_API_KEY: KEY })).toBe("openai");
    expect(mainProviderKind({ LLM_PROVIDER: "replay" })).toBe("replay");
    expect(createMainLlm({}).provider).toBe("mock");
    expect(createMainLlm({ LLM_PROVIDER: "replay" }).provider).toBe("replay:openai");
  });

  it("has no checker unless a different vendor is fully configured (fail closed)", () => {
    expect(checkerConfig({}).config).toBeNull();
    expect(checkerConfig({ CHECKER_PROVIDER: "anthropic", CHECKER_API_KEY: KEY }).reason).toBe("CHECKER_MODEL not set");
    // OpenAI as the main model cannot be its own checker (the offline mock stands in for Hunyuan since 10-16)
    expect(checkerConfig({ OPENAI_API_KEY: KEY, CHECKER_PROVIDER: "openai", CHECKER_API_KEY: KEY, CHECKER_MODEL: "x" }).reason).toMatch(/different vendor/);
    expect(checkerConfig({ CHECKER_PROVIDER: "compatible", CHECKER_API_KEY: KEY, CHECKER_MODEL: "x" }).reason).toBe("CHECKER_BASE_URL not set");
    expect(checkerConfig({ CHECKER_PROVIDER: "nope", CHECKER_API_KEY: KEY, CHECKER_MODEL: "x" }).config).toBeNull();
    const ok = checkerConfig({ CHECKER_PROVIDER: "gemini", CHECKER_API_KEY: KEY, CHECKER_MODEL: "some-model" });
    expect(ok.config).toMatchObject({ name: "gemini", vendor: "google", model: "some-model" });
    expect(checkerConfig({ CHECKER_PROVIDER: "mock" }).mock).toBe(true);
  });

  it("prints configuration without values", () => {
    const s = JSON.stringify(llmStatus({ OPENAI_API_KEY: KEY, CHECKER_PROVIDER: "anthropic", CHECKER_API_KEY: KEY }));
    expect(s).not.toContain(KEY);
    expect(s).toContain('"openaiKey":"set"');
  });

  it("builds a failover target only when it is complete", () => {
    expect(fallbackConfig({ LLM_FALLBACK_PROVIDER: "gemini" })).toBeNull();
    expect(fallbackConfig({ LLM_FALLBACK_PROVIDER: "gemini", LLM_FALLBACK_API_KEY: KEY, LLM_FALLBACK_MODEL: "m" })).toMatchObject({ name: "gemini" });
  });
});

describe("OpenAI-compatible client (ported from ripple-core, no network in tests)", () => {
  it("sends GPT-5 token field, JSON mode and images as data-URL parts", () => {
    const body = buildPayload(cfg(), {
      system: "s",
      user: "u",
      json: true,
      maxTokens: 50,
      images: [{ mime: "image/png", base64: "AAAA" }],
    });
    expect(body.max_completion_tokens).toBe(50);
    expect(body.response_format).toEqual({ type: "json_object" });
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[1].content).toEqual([
      { type: "text", text: "u" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    expect(buildPayload(cfg({ maxTokensField: "max_tokens", jsonMode: false }), { system: "s", user: "u", json: true, maxTokens: 9 })).toMatchObject({ max_tokens: 9 });
  });

  it("retries a retryable status, then succeeds; the key goes only in the header", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(init);
      return calls.length === 1 ? new Response("busy", { status: 503 }) : okResponse('{"a":1}');
    };
    const res = await createCompatClient(cfg(), fetchImpl).chat({ system: "s", user: "u" });
    expect(res).toMatchObject({ content: '{"a":1}', tokens: 12, attempts: 2, provider: "openai" });
    expect((calls[0].headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(calls[0].body)).not.toContain(KEY);
  });

  it("fails fast on a 4xx and never puts the key in the error", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return new Response("bad request", { status: 400 });
    };
    const err = await createCompatClient(cfg(), fetchImpl)
      .chat({ system: "s", user: "u" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(n).toBe(1);
    expect(String(err.message)).not.toContain(KEY);
  });

  it("fails over once when the primary is down", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return url.includes("primary") ? new Response("down", { status: 502 }) : okResponse("fallback answer");
    };
    const client = createCompatClient(
      cfg({ baseUrl: "https://primary.invalid/v1", maxAttempts: 1, fallback: cfg({ name: "gemini", vendor: "google", baseUrl: "https://second.invalid/v1" }) }),
      fetchImpl,
    );
    const res = await client.chat({ system: "s", user: "u" });
    expect(res).toMatchObject({ content: "fallback answer", failedOver: true, provider: "gemini" });
    expect(urls).toEqual(["https://primary.invalid/v1/chat/completions", "https://second.invalid/v1/chat/completions"]);
  });

  it("refuses to call without a key", async () => {
    const err = await createCompatClient(cfg({ apiKey: "" }), async () => okResponse("x"))
      .chat({ system: "s", user: "u" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "not_configured" });
  });
});

describe("replay cassettes", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("keys cassettes by sha256(provider+model+system+user)", () => {
    const expected = createHash("sha256").update("openaigpt-5.4-minisysuser", "utf8").digest("hex");
    expect(cassetteKey("openai", "gpt-5.4-mini", { system: "sys", user: "user" })).toBe(expected);
    const withImage = cassetteKey("openai", "gpt-5.4-mini", { system: "sys", user: "user", images: [{ mime: "image/png", base64: "AAAA" }] });
    expect(withImage).not.toBe(expected);
  });

  it("records through withRecording, then replays the same request without a network", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "cassettes-"));
    const fake: LlmClient = { provider: "openai", model: "gpt-5.4-mini", chat: async () => ({ content: '{"route":"explain"}', tokens: 33 }) };
    await withRecording(fake, dir).chat({ system: "sys", user: "hello 你好" });
    const key = cassetteKey("openai", "gpt-5.4-mini", { system: "sys", user: "hello 你好" });
    const saved = JSON.parse(readFileSync(path.join(dir, `${key}.json`), "utf8"));
    expect(saved).toMatchObject({ request: { provider: "openai", user: "hello 你好" }, response: { content: '{"route":"explain"}', tokens: 33 } });
    expect(saved.recorded_at).toBeTruthy();

    const replay = createReplayClient({ provider: "openai", model: "gpt-5.4-mini", dir });
    await expect(replay.chat({ system: "sys", user: "hello 你好" })).resolves.toMatchObject({ content: '{"route":"explain"}', tokens: 33 });
    await expect(replay.chat({ system: "sys", user: "something else" })).rejects.toMatchObject({ code: "cassette_missing", status: 404 });
  });
});

describe("mock model", () => {
  const payload: ComposePayload = {
    task: "compose",
    route: "explain",
    locale: "en",
    input: "What is amlodipine for?",
    topics: ["purpose"],
    drugs: ["amlodipine"],
    maxSentences: 4,
    candidates: [
      { sourceId: "hh-amlodipine:amlodipine.purpose", kind: "patient_text", span: "evidence", topics: ["purpose"], drugs: ["amlodipine"], restatement: { en: "Amlodipine lowers blood pressure.", zh: "降血压" } },
      { sourceId: "hh-losartan:losartan.purpose", kind: "patient_text", span: "evidence", topics: ["purpose"], drugs: ["losartan"], restatement: { en: "Losartan lowers blood pressure.", zh: "x" } },
      { sourceId: "label:med-amlodipine", kind: "label", span: "Take ONE tablet every MORNING", topics: ["label"], drugs: ["amlodipine"], attribution: "label" },
    ],
  };

  afterEach(() => setMockInjection(null));

  it("composes only from candidates, word for word, for the asked drug and topic", async () => {
    const res = await createMockLlm().chat({ system: "", user: JSON.stringify(payload) });
    const { sentences } = JSON.parse(res.content);
    expect(sentences).toEqual([
      { speechAct: "restate", sourceId: "hh-amlodipine:amlodipine.purpose", span: "evidence", slots: {}, en: "Amlodipine lowers blood pressure." },
    ]);
    expect(res.tokens).toBe(0);
  });

  it("answers classify with uncertain and never confirms a paraphrase as checker", async () => {
    const llm = createMockLlm();
    expect(JSON.parse((await llm.chat({ system: "", user: JSON.stringify({ task: "classify", input: "x", routes: [] }) })).content).route).toBe("uncertain");
    expect(JSON.parse((await llm.chat({ system: "", user: JSON.stringify({ task: "support", span: "a", sentence: "b" }) })).content).supported).toBe(false);
  });

  it("has an injection hook for tests", async () => {
    const extra = { speechAct: "restate" as const, sourceId: "", span: "", slots: {}, en: "You can take an extra tablet when your reading is high." };
    const viaOption = await createMockLlm({ inject: () => [extra] }).chat({ system: "", user: JSON.stringify(payload) });
    expect(JSON.parse(viaOption.content).sentences.at(-1)).toEqual(extra);
    setMockInjection(() => [extra]);
    const viaGlobal = await createMockLlm().chat({ system: "", user: JSON.stringify(payload) });
    expect(JSON.parse(viaGlobal.content).sentences).toHaveLength(2);
  });
});
