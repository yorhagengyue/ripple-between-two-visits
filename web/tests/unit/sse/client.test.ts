/**
 * The screens' side of SSE (owner 10-15): lib/sse/client.ts reads the events of POST /api/ask and /api/explain as they come,
 * streamAsk (components/today/AskSection.tsx) turns them into what the screen draws while the answer is made and ends on
 * the same outcome the plain request gives, a stream that breaks off is asked once more without streaming, and the draft
 * card (AnswerCard with `draft`) is never "the answer".
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { draftAnswer, NO_PROGRESS, streamAsk, type AskProgress } from "@/components/today/AskSection";
import type { AskResult, Sentence } from "@/lib/safety/types";
import { postEventStream } from "@/lib/sse/client";
import { sseFrame } from "@/lib/sse/frames";

const QUOTE: Sentence = {
  speechAct: "restate",
  sourceId: "visit:v2:R4",
  span: "Please don't change the dose yourself.",
  slots: {},
  en: "Please don't change the dose yourself.",
  attribution: "doctor",
  origin: "span",
  cite: { date: "2026-09-01", roleState: "confirmed" },
};
const REFER: Sentence = { speechAct: "referral", sourceId: "tpl:uncertain_no_source", span: "x", slots: {}, en: "Nothing in your records answers this.", zh: "你的记录里没有能回答这个的。", origin: "template", templateId: "uncertain_no_source" };

const FINAL: AskResult = {
  route: "explain",
  sentences: [QUOTE],
  events: [],
  locale: "zh-Hans",
  blocked: [],
  routeReason: "model:mock",
  latencyMs: 10,
  llm: { provider: "mock", model: "m", tokens: 0, calls: 1 },
  gloss: { kind: "general", lang: "zh-Hans", sentences: [{ text: "一般来说，先吃清淡一些。", sourceIds: [] }], at: 1 },
};

/** A Response that streams these frames, a few bytes at a time; `cut` stops before the last frame without an end. */
function sseResponse(frames: string[], cut = false): Response {
  const bytes = new TextEncoder().encode((cut ? frames.slice(0, -1) : frames).join(""));
  let at = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (at >= bytes.length) {
          if (cut) c.error(new TypeError("network error"));
          else c.close();
          return;
        }
        c.enqueue(bytes.slice(at, at + 9));
        at += 9;
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

const ANSWER_FRAMES = [
  sseFrame("stage", { stage: "reading", locale: "zh-Hans" }),
  sseFrame("sentence", { index: 0, sentence: QUOTE, route: "uncertain" }),
  sseFrame("stage", { stage: "writing" }),
  sseFrame("delta", { text: "一般来说，" }),
  sseFrame("delta", { text: "先吃清淡一些。" }),
  sseFrame("final", FINAL),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postEventStream", () => {
  it("asks for the stream and hands each event over in order; a plain answer is handed back untouched", async () => {
    const seen: RequestInit[] = [];
    const events: string[] = [];
    const out = await postEventStream("/api/ask", { text: "q" }, {
      onEvent: (e) => events.push(e.event),
      fetchImpl: async (_u, init) => {
        seen.push(init!);
        return sseResponse(ANSWER_FRAMES);
      },
    });
    expect(new Headers(seen[0].headers).get("accept")).toBe("text/event-stream");
    expect(out).toMatchObject({ streamed: true, ended: true });
    expect(events).toEqual(["stage", "sentence", "stage", "delta", "delta", "final"]);
    const plain = await postEventStream("/api/ask", {}, { onEvent: () => {}, fetchImpl: async () => Response.json({ error: "rate_limited" }, { status: 429 }) });
    expect(plain.streamed).toBe(false);
    expect(plain.res.status).toBe(429);
  });
});

describe("streamAsk", () => {
  it("tells the screen what has come, step by step, and ends on the answer the final event carries", async () => {
    vi.stubGlobal("fetch", async () => sseResponse(ANSWER_FRAMES));
    const steps: AskProgress[] = [];
    const out = await streamAsk("口腔溃疡能吃辣吗？", "zh-Hans", (p) => steps.push(p));
    expect(steps.map((p) => p.stage)).toEqual(["reading", "reading", "writing", "writing", "writing"]);
    expect(steps.at(-1)).toMatchObject({ sentences: [QUOTE], words: "一般来说，先吃清淡一些。", writing: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.text).toBe("口腔溃疡能吃辣吗？");
    expect(out.turn.answer).toMatchObject({ route: "explain", sentences: [QUOTE], gloss: FINAL.gloss });
  });

  it("a retraction takes Ripple's words back off the screen", async () => {
    vi.stubGlobal("fetch", async () => sseResponse([ANSWER_FRAMES[0], ANSWER_FRAMES[2], ANSWER_FRAMES[3], sseFrame("retract", { why: "guard" }), sseFrame("sentence", { index: 0, sentence: REFER, route: "uncertain" }), sseFrame("final", { ...FINAL, sentences: [REFER], gloss: undefined })]));
    const steps: AskProgress[] = [];
    const out = await streamAsk("q", "zh-Hans", (p) => steps.push(p));
    const retracted = steps.findIndex((p, i) => i > 0 && steps[i - 1].words && !p.words);
    expect(retracted).toBeGreaterThan(0);
    expect(steps.at(-1)).toMatchObject({ words: "", writing: false, sentences: [REFER] });
    expect(out.ok && out.turn.answer?.gloss).toBeFalsy();
  });

  it("a stream that breaks off before its end is asked once more, plainly, so he still gets his answer", async () => {
    const calls: { accept: string | null }[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const accept = new Headers(init.headers).get("accept");
      calls.push({ accept });
      return accept === "text/event-stream" ? sseResponse(ANSWER_FRAMES, true) : Response.json(FINAL);
    });
    const out = await streamAsk("q", "zh-Hans", () => {});
    expect(calls.map((c) => c.accept)).toEqual(["text/event-stream", null]);
    expect(out.ok).toBe(true);
  });

  it("a refusal is the plain answer it always was (429 with its limit), and an error event says what failed", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "rate_limited", limit: "tokens_per_day", retryAt: "2026-10-16T00:00:00.000Z" }, { status: 429 }));
    expect(await streamAsk("q", "en", () => {})).toEqual({ ok: false, status: 429, code: "rate_limited", retryAt: "2026-10-16T00:00:00.000Z", limit: "tokens_per_day" });
    vi.stubGlobal("fetch", async () => sseResponse([ANSWER_FRAMES[0], sseFrame("error", { status: 500, error: "internal_error" })]));
    expect(await streamAsk("q", "en", () => {})).toEqual({ ok: false, status: 500, code: "internal_error", retryAt: null, limit: null });
  });
});

describe("the draft card", () => {
  it("draws what has come with the answer's own parts, Ripple's words with the caret, the stage line; never as the answer", () => {
    const p: AskProgress = { ...NO_PROGRESS, stage: "writing", sentences: [QUOTE, REFER], words: "一般来说，先吃", writing: true };
    const answer = draftAnswer(p, "zh-Hans");
    // Ripple's words stand after the last quote, before the fixed line
    expect(answer.gloss).toMatchObject({ kind: "general", at: 1, sentences: [{ text: "一般来说，先吃" }] });
    const out = renderToStaticMarkup(createElement(AnswerCard, { question: "口腔溃疡能吃辣吗？", answer, locale: "zh-Hans", draft: { line: "正在写……", writing: true, testId: "ask-pending" } }));
    expect(out).toContain('data-testid="ask-draft"');
    expect(out).toContain('data-complete="false"');
    expect(out).not.toContain('data-testid="ask-answer"');
    expect(out).not.toContain('data-testid="ask-turn"');
    expect(out).toContain('data-testid="answer-caret"');
    expect(out).toMatch(/data-testid="ask-pending"[^>]*>正在写……</);
    // the order: his question, the doctor's words, Ripple's words, the fixed line
    const order = ["口腔溃疡能吃辣吗？", "change the dose", "一般来说，先吃", "你的记录里没有能回答这个的。", "正在写……"].map((t) => out.indexOf(t));
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true);
    // no offer to put the question on his list while the answer is not there
    expect(out).not.toContain('data-testid="ask-offer"');
    // once the words are written, no caret
    const done = renderToStaticMarkup(createElement(AnswerCard, { question: "q", answer, locale: "zh-Hans", draft: { line: "x", writing: false } }));
    expect(done).not.toContain("answer-caret");
  });
});
