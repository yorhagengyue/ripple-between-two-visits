/**
 * ask()'s total time budget (10-09 DeepSeek fixer, advisory of the round-1 check: with DeepSeek degraded one answer
 * could take 30-100 s). Every model call of an answer shares ASK_DEADLINE_MS; past it the call stops (no retry, no
 * failover), and a layer-3 check still running is blocked. Crisis answers make no model call.
 * Fix round of 10-11: a generation the deadline stopped is composed by the offline composer from the same sources (the
 * leaflet's line, the doctor's words), so he no longer reads "I won't guess" where his sources hold the answer
 * (tests/unit/safety/ask-any-provider.test.ts walks every way a generation can fail).
 */
import { describe, expect, it } from "vitest";
import { createCompatClient } from "@/lib/llm";
import type { CompatConfig } from "@/lib/llm/openai";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { CRISIS_WORDS_TIMEOUT_MS } from "@/lib/safety/crisis-words";
import { askDeadlineMs, layer3ReserveMs, ask } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { getMemoryStore } from "@/lib/store/memory";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

/** A model that never answers until its signal aborts (DeepSeek degraded). */
function hangingLlm(calls: ChatOpts[] = []): LlmClient {
  return {
    provider: "hanging",
    model: "slow",
    async chat(opts) {
      calls.push(opts);
      await new Promise<void>((_resolve, reject) => {
        if (!opts.signal) return; // never resolves: the test would time out, which is the bug this guards against
        opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("hanging: stopped at the caller's deadline"), { code: "deadline" })));
      });
      return { content: "{}", tokens: 0 };
    },
  };
}

async function askWith(text: string, llm: LlmClient, opts: { day?: number; time?: string; deadlineMs?: number; checker?: LlmClient | null } = {}) {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: opts.day ?? 29, story_time: opts.time, ttl_hours: 1 });
  const before = (await store.listQuestions(s.id)).length;
  const t0 = Date.now();
  const res = await ask(
    { sessionId: s.id, text, role: "patient" },
    { store, llm, checker: opts.checker ?? null, checkerReason: "test", publish: () => {}, costGuard: null, deadlineMs: opts.deadlineMs ?? 600 },
  );
  return { res, ms: Date.now() - t0, questionsAdded: (await store.listQuestions(s.id)).length - before };
}

describe("ASK_DEADLINE_MS", () => {
  it("defaults to 8 s and keeps a third (at most 2.5 s) for layer 3", () => {
    expect(askDeadlineMs({})).toBe(8000);
    expect(askDeadlineMs({ ASK_DEADLINE_MS: "5000" })).toBe(5000);
    expect(askDeadlineMs({ ASK_DEADLINE_MS: "nope" })).toBe(8000);
    expect(layer3ReserveMs(8000)).toBe(2500);
    expect(layer3ReserveMs(600)).toBe(200);
  });
});

describe("a model that never answers", () => {
  it("an explain question is answered from his sources by the offline composer, within the budget", async () => {
    const calls: ChatOpts[] = [];
    const { res, ms, questionsAdded } = await askWith("What is amlodipine for?", hangingLlm(calls));
    expect(ms).toBeLessThan(1500);
    expect(calls.every((c) => !!c.signal)).toBe(true);
    expect(res.route).toBe("explain");
    expect(res.routeChangedFrom).toBeUndefined();
    expect(res.sentences.map((s) => s.sourceId)).toContain("hh-amlodipine:amlodipine.purpose");
    expect(res.sentences.map((s) => s.templateId)).not.toContain("uncertain_no_source");
    expect(questionsAdded).toBe(0);
    const output = res.events[0].output as { generationError: string; composedBy: string };
    expect(String(output.generationError)).toMatch(/generation_failed.*deadline/);
    expect(output.composedBy).toBe("rules_after_generation_failed");
  });

  it("a question his sources hold nothing for is still 'I won't guess' and a question", async () => {
    const { res, ms, questionsAdded } = await askWith("Can I go swimming?", hangingLlm());
    expect(ms).toBeLessThan(1500);
    expect(res.route).toBe("uncertain");
    expect(res.sentences.map((s) => s.templateId)).toContain("uncertain_no_source");
    expect(questionsAdded).toBe(1);
  });

  it("the hero question still relays R4 and the label word for word and reuses the question", async () => {
    const { res, ms } = await askWith("今天 150/95，我能不能多吃一粒？", hangingLlm(), { time: "20:15" });
    expect(ms).toBeLessThan(1500);
    expect(res.route).toBe("refuse_route");
    expect(res.sentences.find((s) => s.sourceId === "visit:v2:R4")?.en).toBe(R4);
    expect(res.sentences.find((s) => s.sourceId === "label:med-amlodipine")?.en).toBe("Take ONE tablet every MORNING");
    expect(res).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
  });

  it("a crisis waits for no model to be answered: only for the wording of its 995 line, at most CRISIS_WORDS_TIMEOUT_MS, then the fixed sentence stands", async () => {
    const calls: ChatOpts[] = [];
    const { res, ms } = await askWith("I have chest pain and my left arm feels heavy", hangingLlm(calls), { deadlineMs: 60_000 });
    // (owner 10-15: the one call is the wording, crisis-words.ts; no classification, no screen, no generation)
    expect(ms).toBeLessThan(CRISIS_WORDS_TIMEOUT_MS + 1000);
    expect(calls.map((c) => c.purpose)).toEqual(["crisis_words"]);
    expect(renderText(res, "en")).toContain("995");
    expect(res.sentences.some((s) => s.origin === "voiced")).toBe(false);
    expect((res.events[0].output as { crisisWords: { voiced: boolean; why: string } }).crisisWords).toMatchObject({ voiced: false, why: "time" });
  });

  it("the answer's own deadline cuts the wording too", async () => {
    const { res, ms } = await askWith("I have chest pain and my left arm feels heavy", hangingLlm(), { deadlineMs: 600 });
    expect(ms).toBeLessThan(1500);
    expect(renderText(res, "en")).toContain("995");
  });

  it("a statement's crisis screen stops at the budget and the note is kept", async () => {
    const { res, ms } = await askWith("I walked to the market this morning.", hangingLlm());
    expect(ms).toBeLessThan(1500);
    expect(res.route).toBe("log_only");
  });
});

describe("the real DeepSeek client under a deadline", () => {
  const cfg = (over: Partial<CompatConfig> = {}): CompatConfig => ({
    name: "deepseek",
    vendor: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test",
    model: "deepseek-flash",
    maxTokensField: "max_tokens",
    jsonMode: true,
    timeoutMs: 15_000,
    maxAttempts: 2,
    ledger: null,
    ...over,
  });
  const hangingFetch = (sent: { n: number }) => (_url: string, init: RequestInit) =>
    new Promise<Response>((_res, reject) => {
      sent.n++;
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

  it("15 s attempts x 2 with backoff are cut at the answer's deadline: one request each, no retry", async () => {
    const sent = { n: 0 };
    const llm = createCompatClient(cfg(), hangingFetch(sent));
    const t0 = Date.now();
    const { res } = await askWith("What is amlodipine for?", llm, { deadlineMs: 900 });
    expect(Date.now() - t0).toBeLessThan(2000);
    // the generation, the crisis screen (round 2: it runs alongside every live answer) and Ripple's own answer (owner
    // 10-15, general.ts), each sent once, never retried
    expect(sent.n).toBe(3);
    // (the offline composer then answers from his sources: the route stays)
    expect(res.route).toBe("explain");
    expect((res.events[0].output as { composedBy: string }).composedBy).toBe("rules_after_generation_failed");
  });

  it("a failover is never tried after the deadline", async () => {
    const sent = { n: 0 };
    const fallbackSent = { n: 0 };
    const llm = createCompatClient(cfg({ fallback: cfg({ name: "backup", vendor: "other", apiKey: "sk-other" }) }), (url, init) =>
      init.headers && JSON.stringify(init.headers).includes("sk-other") ? hangingFetch(fallbackSent)(url, init) : hangingFetch(sent)(url, init),
    );
    await expect(llm.chat({ system: "s", user: "u", signal: AbortSignal.timeout(100) })).rejects.toMatchObject({ code: "deadline" });
    expect(sent.n).toBe(1);
    expect(fallbackSent.n).toBe(0);
  });
});
