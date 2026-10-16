/**
 * The long press's sheet as Server-Sent Events (owner 10-15: 「需要非常完整的 SSE 的输出」): POST /api/explain with Accept:
 * text/event-stream, through the real route and the real OpenAI-compatible client, Hunyuan (TokenHub) answered by a fake fetch that
 * streams. What Ripple looked at goes out first, the sentence word by word, then the answer, which is exactly the JSON the
 * plain request gives; words the model abstains on or the guards drop are taken back; offline it is the one final event.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as explainPOST } from "@/app/api/explain/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import type { HoldRead } from "@/lib/explain/subjects";
import { createSseParser } from "@/lib/sse/frames";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
let him: TestAccount;

beforeAll(async () => {
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `x${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example", locale: "zh-Hans" });
  await store.addConsentRecord({ user_id: him.userId, scope_id: him.userId, kind: "ai_processing", decision: "granted", method: "test" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function hold(subject: { type: string; ref: string }, accept?: string): NextRequest {
  return new NextRequest("http://localhost/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `rp_at=${him.tokens.access_token}`, ...(accept ? { accept } : {}) },
    body: JSON.stringify({ subject_type: subject.type, subject_ref: subject.ref, locale: "zh-Hans" }),
  });
}

async function events(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  const parser = createSseParser((f) => out.push({ event: f.event, data: JSON.parse(f.data) as Record<string, unknown> }));
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

/** Hunyuan on TokenHub, faked: the reply's JSON streamed in pieces of a few characters, then the usage chunk. */
function liveModel(reply: Record<string, unknown>) {
  vi.stubEnv("LLM_PROVIDER", "hunyuan");
  vi.stubEnv("HUNYUAN_API_KEY", "sk-test-not-real");
  const content = JSON.stringify(reply);
  const pieces = content.match(/[\s\S]{1,5}/g) ?? [];
  const calls: { stream: unknown }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { stream?: unknown };
    calls.push({ stream: body.stream });
    const frames = [
      ...pieces.map((p) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 } })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return calls;
}

describe("POST /api/explain with Accept: text/event-stream", () => {
  it("what Ripple looked at first, then the sentence word by word, then the answer the plain request gives", async () => {
    const sentence = "这是你的降压药，药品标签写着每天一次。";
    const calls = liveModel({ verdict: sentence, abstain: false });
    const got = await events(await explainPOST(hold({ type: "med", ref: "med-amlodipine" }, "text/event-stream")));
    expect(calls).toEqual([{ stream: true }]);
    const names = got.map((e) => e.event);
    expect(names[0]).toBe("read");
    expect(got[0].data).toMatchObject({ waiting: true, verdictBy: "records" });
    expect(names[1]).toBe("stage");
    const deltas = got.filter((e) => e.event === "delta").map((e) => e.data.text as string);
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.join("")).toBe(sentence);
    expect(names.at(-1)).toBe("final");
    expect(names).not.toContain("retract");
    const final = got.at(-1)!.data as unknown as HoldRead;
    expect(final).toMatchObject({ verdict: sentence, verdictBy: "model", abstain: false });
    expect(final.waiting).toBeUndefined();
    // the plain request (the verdict is kept for the same evidence: no second model call) gives the same body
    const plain = (await (await explainPOST(hold({ type: "med", ref: "med-amlodipine" }))).json()) as HoldRead;
    expect(final).toEqual(plain);
    expect(calls).toHaveLength(1);
  });

  it("words the guards drop are streamed and then taken back: the sentence built from his records stands", async () => {
    liveModel({ verdict: "你可以停药两天，再看看血压。", abstain: false });
    const got = await events(await explainPOST(hold({ type: "visit", ref: "v2" }, "text/event-stream")));
    const names = got.map((e) => e.event);
    expect(names.filter((n) => n === "delta").length).toBeGreaterThan(0);
    const retract = names.indexOf("retract");
    expect(retract).toBeGreaterThan(names.lastIndexOf("delta"));
    expect(got[retract].data).toEqual({ why: "guard" });
    const final = got.at(-1)!.data as unknown as HoldRead;
    expect(final).toMatchObject({ verdictBy: "records", verdictWhy: "guard" });
    expect(final.verdict).not.toContain("停药");
  });

  it("a model that abstains: its words go, the records' sentence stays", async () => {
    liveModel({ verdict: "记录里没有写，可以问医生。", abstain: true });
    const got = await events(await explainPOST(hold({ type: "bp_week", ref: "" }, "text/event-stream")));
    const names = got.map((e) => e.event);
    expect(names).toContain("retract");
    expect((got.at(-1)!.data as unknown as HoldRead).verdictWhy).toBe("model_abstained");
  });

  it("offline (no model): one final event, the same body as the plain request", async () => {
    vi.stubEnv("LLM_PROVIDER", "mock");
    const got = await events(await explainPOST(hold({ type: "next_visit", ref: "" }, "text/event-stream")));
    expect(got.map((e) => e.event)).toEqual(["final"]);
    const plain = await (await explainPOST(hold({ type: "next_visit", ref: "" }))).json();
    expect(got[0].data).toEqual(plain);
  });

  it("a thing that is not there is the plain 404, never a stream", async () => {
    const res = await explainPOST(hold({ type: "med", ref: "med-nothing-like-this" }, "text/event-stream"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});
