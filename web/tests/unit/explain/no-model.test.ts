/**
 * M5: no model translates clinical content. With every LLM provider made to throw (main model, checker, mock), the
 * Mandarin explain card renders exactly the same as without, and read-aloud gets the same text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";

afterEach(() => {
  vi.doUnmock("@/lib/llm");
  vi.doUnmock("@/lib/llm/mock");
  vi.doUnmock("@/lib/llm/openai");
  vi.resetModules();
});

describe("explain card without any model", () => {
  it("renders the zh (and en) card identically when the LLM provider throws on any call", async () => {
    const store = getMemoryStore(); // globalThis: the same store across module reloads
    const s = await store.createSession({ story_day: 29, ttl_hours: 1 });
    const med = (await store.getMed(s.id, "med-amlodipine"))!;

    const real = await import("@/lib/explain/card");
    const baseZh = await real.buildExplainCard(store, s.id, med, { day: 29, locale: "zh-Hans" });
    const baseEn = await real.buildExplainCard(store, s.id, med, { day: 29, locale: "en" });
    expect(baseZh).not.toBeNull();

    let calls = 0;
    const throwing: LlmClient = {
      provider: "throwing",
      model: "throwing",
      async chat() {
        calls++;
        throw new Error("no model may be called to build the explain card");
      },
    } as LlmClient;
    vi.resetModules();
    vi.doMock("@/lib/llm", async (orig) => ({
      ...(await orig<typeof import("@/lib/llm")>()),
      createMainLlm: () => throwing,
      createChecker: () => ({ client: throwing, reason: null }),
      createMockLlm: () => throwing,
    }));
    vi.doMock("@/lib/llm/mock", async (orig) => ({ ...(await orig<typeof import("@/lib/llm/mock")>()), createMockLlm: () => throwing }));
    vi.doMock("@/lib/llm/openai", async (orig) => ({ ...(await orig<typeof import("@/lib/llm/openai")>()), createCompatClient: () => throwing }));

    const mocked = await import("@/lib/explain/card");
    expect(mocked).not.toBe(real); // a fresh module graph with the throwing providers
    const zh = await mocked.buildExplainCard(store, s.id, med, { day: 29, locale: "zh-Hans" }, { checker: throwing });
    const en = await mocked.buildExplainCard(store, s.id, med, { day: 29, locale: "en" }, { checker: throwing });
    expect(zh).toEqual(baseZh);
    expect(en).toEqual(baseEn);
    expect(calls).toBe(0);

    const { readExplainCardAloud } = await import("@/lib/explain/read-aloud");
    const { createMockTts } = await import("@/lib/tts/mock");
    const out = await readExplainCardAloud(store, s.id, "med-amlodipine", "zh-Hans", createMockTts());
    expect(out.text).toBe(baseZh!.speechText);
    expect(calls).toBe(0);
  });
});
