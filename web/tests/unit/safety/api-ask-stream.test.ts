/**
 * POST /api/ask and /api/explain as Server-Sent Events (owner 10-15: 「需要非常完整的 SSE 的输出，无论是哪个端，子女和老人，我都
 * 需要 SSE」), offline: the events come in the order the answer is made, the last one carries exactly the answer the plain
 * request gives, a 995 or helpline line goes out before anything else of the answer and before any model call, Ripple's own
 * words stream only on an answer that takes them and are taken back when the guard refuses them, and every refusal (429)
 * is still the plain answer it was.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ask/route";
import { createMockLlm, setMockGeneral, MOCK_GENERAL } from "@/lib/llm/mock";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { ask } from "@/lib/safety/pipeline";
import { storeCostGuard } from "@/lib/safety/cost-guard";
import type { AskResult, AskStreamEvent } from "@/lib/safety/types";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { createSseParser, type SseFrame } from "@/lib/sse/frames";
import { getMemoryStore } from "@/lib/store/memory";

const SSE = "text/event-stream";

function post(url: string, body: unknown, opts: { cookie?: string; accept?: string } = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.accept ? { accept: opts.accept } : {}) },
  });
}

/** The frames of a streamed response, each with its parsed data and when it arrived (ms after the first read). */
async function frames(res: Response): Promise<{ event: string; data: Record<string, unknown> & AskResult; at: number }[]> {
  const out: { event: string; data: never; at: number }[] = [];
  const t0 = performance.now();
  const parser = createSseParser((f: SseFrame) => out.push({ event: f.event, data: JSON.parse(f.data) as never, at: performance.now() - t0 }));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) parser.push(decoder.decode(value, { stream: true }));
    if (done) break;
  }
  parser.end();
  return out;
}

async function freshSession() {
  return getMemoryStore().createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
}

/** The parts of an answer that are the same for the same question on two fresh sessions (ids, times and timings aside). */
function stable(r: AskResult, sessionId: string) {
  const parts = {
    route: r.route,
    sentences: r.sentences,
    gloss: r.gloss ?? null,
    locale: r.locale,
    routeReason: r.routeReason,
    routeChangedFrom: r.routeChangedFrom ?? null,
    blocked: r.blocked,
    llm: r.llm,
    question: !!r.addedQuestionId,
    questionReused: r.questionReused ?? false,
    fixedText: r.fixedText ?? null,
  };
  // (a clip's address names the session it is played in)
  // (and a note kept for his doctor has an id of its own)
  return JSON.parse(JSON.stringify(parts).split(sessionId).join("<session>").replace(/note-[0-9a-f-]{36}/g, "note-<id>")) as typeof parts;
}

beforeEach(() => {
  vi.stubEnv("MOCK_STREAM_DELAY_MS", "5");
});
afterEach(() => {
  setMockGeneral(null);
  vi.unstubAllEnvs();
});

describe("POST /api/ask with Accept: text/event-stream", () => {
  it("tells the answer in order: reading first, then writing and Ripple's own words piece by piece, the final answer last", async () => {
    const s = await freshSession();
    const res = await POST(post("http://localhost/api/ask", { text: "我口腔溃疡，可以吃辣吗？", locale: "zh-Hans" }, { cookie: `${SESSION_COOKIE}=${s.id}`, accept: SSE }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const got = await frames(res);
    const names = got.map((f) => f.event);
    expect(names[0]).toBe("stage");
    expect(got[0].data).toMatchObject({ stage: "reading", locale: "zh-Hans" });
    expect(names.at(-1)).toBe("final");
    expect(names.filter((n) => n === "final")).toHaveLength(1);
    // Ripple's own words: "writing", then the words in several pieces, all before the final answer
    const writing = got.findIndex((f) => f.event === "stage" && f.data.stage === "writing");
    const deltas = got.filter((f) => f.event === "delta");
    expect(writing).toBeGreaterThan(0);
    expect(deltas.length).toBeGreaterThan(3);
    expect(got.indexOf(deltas[0])).toBeGreaterThan(writing);
    const words = deltas.map((d) => d.data.text as unknown as string).join("");
    expect(words).toBe(MOCK_GENERAL.zh.answer);
    // the final answer carries those words as Ripple's own answer, and nothing was taken back
    const final = got.at(-1)!.data;
    expect(final.gloss).toMatchObject({ kind: "general", sentences: [{ text: MOCK_GENERAL.zh.answer }] });
    expect(names).not.toContain("retract");
    expect(names).not.toContain("error");
  });

  it("the final event is the answer the plain request gives (the same question on two fresh sessions)", async () => {
    for (const text of ["今天 150/95，我能不能多吃一粒？", "我口腔溃疡，可以吃辣吗？", "我胸口很痛", "What is amlodipine for?"]) {
      const a = await freshSession();
      const b = await freshSession();
      const plain = (await (await POST(post("http://localhost/api/ask", { text }, { cookie: `${SESSION_COOKIE}=${a.id}` }))).json()) as AskResult;
      const res = await POST(post("http://localhost/api/ask", { text }, { cookie: `${SESSION_COOKIE}=${b.id}`, accept: SSE }));
      const got = await frames(res);
      const final = got.at(-1)!;
      expect(final.event, text).toBe("final");
      expect(stable(final.data, b.id), text).toEqual(stable(plain, a.id));
      // every key the plain body has, the final event has
      expect(Object.keys(final.data).sort(), text).toEqual(Object.keys(plain).sort());
      // the sentences told on the way are the answer's own, in its order
      const told = got.filter((f) => f.event === "sentence").map((f) => (f.data as unknown as { sentence: { sourceId: string } }).sentence.sourceId);
      expect(told, text).toEqual(final.data.sentences.map((x) => x.sourceId));
    }
  });

  it("an emergency: the 995 line is among the first events, before the final answer, and nothing streams as words", async () => {
    for (const [text, first] of [
      ["我胸口很痛", "signal_recorded"],
      ["My dad collapsed and won't wake up", "emergency_995"],
      ["I want to end my life", "self_harm_995"],
    ] as const) {
      const s = await freshSession();
      const got = await frames(await POST(post("http://localhost/api/ask", { text }, { cookie: `${SESSION_COOKIE}=${s.id}`, accept: SSE })));
      expect(got[0].event, text).toBe("stage");
      const sentences = got.filter((f) => f.event === "sentence").map((f) => (f.data as unknown as { sentence: { templateId?: string; en: string; zh?: string } }).sentence);
      expect(sentences[0].templateId, text).toBe(first);
      // 995 is said within the first three events (the stage, then the answer's first lines)
      const firstThree = JSON.stringify(got.slice(0, 4).map((f) => f.data));
      expect(firstThree, text).toContain("995");
      expect(got.some((f) => f.event === "delta" || f.event === "retract"), text).toBe(false);
      expect(got.at(-1)!.event, text).toBe("final");
    }
  });

  it("Ripple's own words that the guard refuses are streamed, then taken back; the final answer stands without them", async () => {
    // a canned answer that changes his medicine (general.ts guardGeneral: med_change)
    setMockGeneral({ answer: "你可以多吃一粒降压药，没关系。", ask: "none" });
    const s = await freshSession();
    const got = await frames(await POST(post("http://localhost/api/ask", { text: "我口腔溃疡，可以吃辣吗？", locale: "zh-Hans" }, { cookie: `${SESSION_COOKIE}=${s.id}`, accept: SSE })));
    const names = got.map((f) => f.event);
    const lastDelta = names.lastIndexOf("delta");
    const retract = names.indexOf("retract");
    expect(lastDelta).toBeGreaterThan(0);
    expect(retract).toBeGreaterThan(lastDelta);
    expect(got[retract].data).toMatchObject({ why: "guard" });
    const final = got.at(-1)!.data;
    expect(names.at(-1)).toBe("final");
    expect(final.gloss).toBeUndefined();
    expect(JSON.stringify(final.sentences)).not.toContain("多吃一粒");
    // what stands instead: the fixed sentence that says nothing of his answers it, told after the retraction
    const after = got.slice(retract).filter((f) => f.event === "sentence").map((f) => (f.data as unknown as { sentence: { templateId?: string } }).sentence.templateId);
    expect(after).toContain("uncertain_no_source");
  });

  it("a refusal is the plain answer it always was: 429 with its words and Retry-After, never a stream", async () => {
    const store = getMemoryStore();
    const s = await freshSession();
    const cap = storeCostGuard(store, s).limits.requestsPerHour;
    for (let i = 0; i < cap; i++) await storeCostGuard(store, s).admit(s.id);
    const res = await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "What is amlodipine for?" }, { accept: SSE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: "rate_limited", limit: "requests_per_hour" });
    // and a bad body or an unknown session too
    expect((await POST(post("http://localhost/api/ask?session=nope", { text: "hi" }, { accept: SSE }))).status).toBe(404);
    expect((await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "" }, { accept: SSE }))).status).toBe(400);
  });

  it("without the header nothing changed: one JSON answer", async () => {
    const s = await freshSession();
    const res = await POST(post("http://localhost/api/ask", { text: "What is amlodipine for?" }, { cookie: `${SESSION_COOKIE}=${s.id}`, accept: "*/*" }));
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect((await res.json()).route).toBe("explain");
  });
});

describe("the crisis wording never streams: the fixed lines go out first, then a replacement once it passed its checks", () => {
  it("emergency: 995 at once, the person's words replace it after their checks, the answer ends with them", async () => {
    const mock = createMockLlm();
    const asked: string[] = [];
    // a live-like model (not the mock: crisis-words.ts asks only a live one) that words the 995 line
    const live: LlmClient = {
      provider: "fake-live",
      model: "test",
      async chat(opts: ChatOpts) {
        const task = (JSON.parse(opts.user) as { task?: string }).task ?? "";
        asked.push(task);
        if (task === "crisis_words") return { content: JSON.stringify({ answer: "Please call 995 right now and stay with your dad." }), tokens: 10 };
        return mock.chat(opts);
      },
    };
    const store = getMemoryStore();
    const s = await freshSession();
    const events: { e: AskStreamEvent; asked: number }[] = [];
    const r = await ask(
      { sessionId: s.id, text: "My dad collapsed and won't wake up", role: "patient" },
      { store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: null, stream: (e) => events.push({ e, asked: asked.length }) },
    );
    const types = events.map((x) => x.e.type);
    expect(types).toEqual(["stage", "sentence", "replace"]);
    // the fixed 995 line went out before the model was asked for its words (the harness's risk screen, 10-16, starts with the
    // answer and is never waited for by a crisis's lines: it is the only call before them)
    const first = events[1];
    expect(first.e).toMatchObject({ type: "sentence", sentence: { templateId: "emergency_995" } });
    expect(asked.slice(0, first.asked)).toEqual(["risk_screen"]);
    expect(asked).toEqual(["risk_screen", "crisis_words"]);
    const replaced = events[2].e as Extract<AskStreamEvent, { type: "replace" }>;
    expect(replaced.sentences).toEqual(r.sentences);
    expect(r.sentences[0]).toMatchObject({ templateId: "emergency_995", origin: "voiced", en: "Please call 995 right now and stay with your dad." });
  });
});
