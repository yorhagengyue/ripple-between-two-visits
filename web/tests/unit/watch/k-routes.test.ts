/**
 * Track K's routes on the real app: his own subject only (a signed-in account's own space; nobody else's, no session id),
 * nothing in an answer names his scope or his user id, and each route does what its screen needs: GET/POST /api/watch,
 * GET/POST /api/prevent, GET /api/chat and POST /api/chat/question, GET /api/diet with POST /api/diet/check and /foods.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as chatGet } from "@/app/api/chat/route";
import { POST as chatQuestion } from "@/app/api/chat/question/route";
import { POST as askPost } from "@/app/api/ask/route";
import { GET as dietGet } from "@/app/api/diet/route";
import { POST as dietCheck } from "@/app/api/diet/check/route";
import { POST as dietFoods } from "@/app/api/diet/foods/route";
import { GET as preventGet, POST as preventPost } from "@/app/api/prevent/route";
import { POST as watchAnswer } from "@/app/api/watch/answer/route";
import { GET as watchGet } from "@/app/api/watch/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();

function req(p: string, opts: { token?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const makeAccount = (space: "blank" | "example" | "none"): Promise<TestAccount> =>
  createAccountWithSpace(store, getAuthProvider(), { login: `kr${randomUUID().slice(0, 10)}`, password: "a long test password", space });

async function json(res: Response, him: TestAccount, status = 200): Promise<Record<string, unknown>> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(text).not.toContain(him.userId);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("track K's routes", () => {
  it("nobody signed in: no answer about anyone", async () => {
    for (const r of [await watchGet(req("/api/watch")), await preventGet(req("/api/prevent")), await chatGet(req("/api/chat")), await dietGet(req("/api/diet"))]) {
      expect([400, 401]).toContain(r.status);
    }
    expect((await watchGet(req("/api/watch", { token: "not-a-token" }))).status).toBe(401);
  });

  it("a signed-in person with no space of their own (her account) reaches no one's data", async () => {
    const her = await makeAccount("none");
    for (const r of [await watchGet(req("/api/watch", { token: her.tokens.access_token })), await preventGet(req("/api/prevent", { token: her.tokens.access_token }))]) {
      expect(r.status).toBe(404);
    }
  });

  it("the watch: his card, 要 adds one question; a stale key is refused", async () => {
    const him = await makeAccount("example");
    const t = him.tokens.access_token;
    const view = await json(await watchGet(req("/api/watch?locale=zh-Hans", { token: t })), him);
    expect(view).toMatchObject({ has: true, example: true, card: { key: "rhr:above" } });
    const bad = await watchAnswer(req("/api/watch/answer", { token: t, body: { key: "steps:below", answer: "yes" } }));
    expect(bad.status).toBe(409);
    const ok = await json(await watchAnswer(req("/api/watch/answer?locale=zh-Hans", { token: t, body: { key: "rhr:above", answer: "yes" } })), him);
    expect(ok).toMatchObject({ answer: "yes", question: { outcome: "created" } });
    expect((await watchAnswer(req("/api/watch/answer", { token: t, body: { key: "rhr", answer: "yes" } }))).status).toBe(400);
  });

  it("prevention: the screen, 加进问题单 and 我做过了 / undo", async () => {
    const him = await makeAccount("example");
    const t = him.tokens.access_token;
    const view = await json(await preventGet(req("/api/prevent?locale=zh-Hans", { token: t })), him);
    expect((view.table as { id: string }[]).map((r) => r.id)).toContain("C2-03");
    expect(await json(await preventPost(req("/api/prevent", { token: t, body: { item: "C2-03", action: "ask" } })), him)).toMatchObject({ action: "ask", question: { outcome: "created" } });
    expect(await json(await preventPost(req("/api/prevent", { token: t, body: { item: "C1-06", action: "done" } })), him)).toMatchObject({ action: "done" });
    expect(await json(await preventPost(req("/api/prevent", { token: t, body: { item: "C1-06", action: "undo" } })), him)).toMatchObject({ action: "undo" });
    expect((await preventPost(req("/api/prevent", { token: t, body: { item: "C1-03", action: "done" } }))).status).toBe(409);
    expect((await preventPost(req("/api/prevent", { token: t, body: { item: "nope", action: "done" } }))).status).toBe(404);
  });

  it("the conversation: today's turns (from POST /api/ask), 加进问题单 on his own turn only", async () => {
    const him = await makeAccount("example");
    const t = him.tokens.access_token;
    expect((await askPost(req("/api/ask", { token: t, body: { text: "今天在大巴窑中心走了一圈，脚踝有点肿。", locale: "zh-Hans" } }))).status).toBe(200);
    const day = await json(await chatGet(req("/api/chat", { token: t })), him);
    const turns = day.turns as { id: string; related: { utteranceId: string } | null }[];
    expect(turns).toHaveLength(1);
    expect(turns[0].related?.utteranceId).toBe("v2-u07");
    expect(await json(await chatQuestion(req("/api/chat/question", { token: t, body: { turn: turns[0].id } })), him)).toMatchObject({ question: { outcome: "created" } });
    expect((await chatQuestion(req("/api/chat/question", { token: t, body: { turn: "nope" } }))).status).toBe(404);
    expect((await chatGet(req("/api/chat?day=999", { token: t }))).status).toBe(400);
  });

  it("the diet: the screen, today's answer, his hawker dishes", async () => {
    const him = await makeAccount("example");
    const t = him.tokens.access_token;
    const view = await json(await dietGet(req("/api/diet?locale=zh-Hans", { token: t })), him);
    expect(view).toMatchObject({ check: { item: "soup" } });
    expect(await json(await dietCheck(req("/api/diet/check", { token: t, body: { answer: "unsure" } })), him)).toEqual({ item: "soup", answer: "unsure" });
    expect((await dietCheck(req("/api/diet/check", { token: t, body: { answer: "maybe" } }))).status).toBe(400);
    expect(await json(await dietFoods(req("/api/diet/foods", { token: t, body: { foods: ["laksa", "unknown"] } })), him)).toEqual({ foods: ["laksa"] });
    const blank = await makeAccount("blank");
    expect((await dietCheck(req("/api/diet/check", { token: blank.tokens.access_token, body: { answer: "yes" } }))).status).toBe(409);
  });

  it("a demo session (his phone in a judge's sandbox): the diet screen has no picker; a pick and a watch answer are refused, never a 500", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const phone = await store.addMember(s.id, { role: "patient" });
    const demoReq = (p: string, body?: unknown) =>
      new NextRequest(`http://localhost${p}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie: `rp_session=${s.id}; rp_member=${phone.id}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const view = await dietGet(demoReq("/api/diet?locale=zh-Hans"));
    expect(view.status).toBe(200);
    expect(((await view.json()) as { foods: { canPick: boolean } }).foods.canPick).toBe(false);
    const foods = await dietFoods(demoReq("/api/diet/foods", { foods: ["laksa"] }));
    expect(foods.status, await foods.text()).toBe(404);
    const watch = await watchAnswer(demoReq("/api/watch/answer", { key: "rhr:above", answer: "yes" }));
    expect(watch.status, await watch.text()).toBe(409);
    expect([200, 409]).toContain((await dietCheck(demoReq("/api/diet/check", { answer: "yes" }))).status);
    expect((await store.getSession(s.id))?.settings ?? {}).not.toHaveProperty("diet_foods");
  });
});
