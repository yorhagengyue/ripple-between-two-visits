/**
 * POST /api/ask and GET /api/ask/history on the real app (C2 track S): who asks is the subject's (never the body's), his
 * AI consent decides whether a model may see the ask, every ask and answer is kept as today's two chat rows, and nothing
 * names his scope. The demo's member rows still label the asker.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as historyGet } from "@/app/api/ask/history/route";
import { POST as askPost } from "@/app/api/ask/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { MEMBER_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";
import { askCopy } from "@/components/daily/ask-copy";
import { NO_AI_SENTENCE } from "@/lib/safety/no-ai";
import type { AskResult } from "@/lib/safety/types";
import type { AskTurn } from "@/lib/safety/turns";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const HERO = "今天 150/95，我能不能多吃一粒？";

function req(p: string, opts: { token?: string; body?: unknown; cookies?: Record<string, string> } = {}): NextRequest {
  const jar = { ...(opts.cookies ?? {}), ...(opts.token ? { rp_at: opts.token } : {}) };
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const makeAccount = (space: "blank" | "example" | "none", consents?: ("terms_privacy" | "ai_processing" | "example_data")[]): Promise<TestAccount> =>
  createAccountWithSpace(store, getAuthProvider(), { login: `ask${randomUUID().slice(0, 10)}`, password: "a long test password", space, ...(consents ? { consents } : {}) });

describe("an account asks as himself", () => {
  it("the hero question: 200, the answer, two chat rows, history the same after a refresh, his id nowhere", async () => {
    const him = await makeAccount("example");
    const t = him.tokens.access_token;
    const res = await askPost(req("/api/ask", { token: t, body: { text: HERO, locale: "zh-Hans", role: "family" } }));
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).not.toContain(him.userId);
    const body = JSON.parse(text) as AskResult;
    expect(body).toMatchObject({ route: "refuse_route", addedQuestionId: "q-extra-tablet", questionReused: true });
    // the body's role is ignored: the safety record says he asked (his words count on his question list)
    const events = await store.listSafetyEvents(him.userId);
    expect((events.at(-1)!.output as { askedBy: string }).askedBy).toBe("patient");
    const rows = await store.listChatMessages(him.userId);
    expect(rows.map((r) => r.role)).toEqual(["patient", "ripple"]);
    expect(rows[1].safety_event_id).toBe(rows[0].safety_event_id);

    const h = await historyGet(req("/api/ask/history", { token: t }));
    const htext = await h.text();
    expect(h.status, htext).toBe(200);
    expect(htext).not.toContain(him.userId);
    const history = JSON.parse(htext) as { day: number; date: string; turns: AskTurn[] };
    expect(history.day).toBe(42);
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0]).toMatchObject({ text: HERO, answer: { route: "refuse_route", addedQuestionId: "q-extra-tablet", locale: "zh-Hans" } });
    expect(history.turns[0].answer!.sentences.map((s) => s.sourceId)).toEqual(body.sentences.map((s) => s.sourceId));
    expect(history.turns[0].answer).not.toHaveProperty("events");
    // another day: nothing; a day that has not come: refused
    expect(((await (await historyGet(req("/api/ask/history?day=41", { token: t }))).json()) as { turns: unknown[] }).turns).toEqual([]);
    expect((await historyGet(req("/api/ask/history?day=99", { token: t }))).status).toBe(400);
    expect((await historyGet(req("/api/ask/history?day=x", { token: t }))).status).toBe(400);
  });

  it("without consent to AI processing: rules only, said in the answer", async () => {
    const him = await makeAccount("blank", ["terms_privacy"]);
    const res = await askPost(req("/api/ask", { token: him.tokens.access_token, body: { text: "我可以去游泳吗？", locale: "zh-Hans" } }));
    const body = (await res.json()) as AskResult;
    expect(body).toMatchObject({ route: "uncertain", noAiConsent: true, llm: { provider: "mock", calls: 0 } });
    expect(body.sentences.map((s) => s.templateId)).toEqual(["no_ai_consent"]);
    // C2 round 2 (real-app 2.10 line 189): one sentence, the design's, in the template, as the screen's line and as the footer
    expect(NO_AI_SENTENCE.zh).toBe("你没有同意用 AI，这里只能帮你记下来、转给医生。");
    expect(body.sentences[0].zh).toBe(`${NO_AI_SENTENCE.zh}我已把它加入问题单。`);
    expect(askCopy("zh-Hans").noAi).toBe(NO_AI_SENTENCE.zh);
    expect(askCopy("en").noAi).toBe(NO_AI_SENTENCE.en);
    // the history route tells the ask screens his consent is off (Today's section says the sentence too); on again: true
    const off = (await (await historyGet(req("/api/ask/history", { token: him.tokens.access_token }))).json()) as { ai: boolean };
    expect(off.ai).toBe(false);
    const on = await makeAccount("blank");
    expect(((await (await historyGet(req("/api/ask/history", { token: on.tokens.access_token }))).json()) as { ai: boolean }).ai).toBe(true);
    // the demo's synthetic story is always allowed
    const demo = await store.createSession({ ttl_hours: 1 });
    expect(((await (await historyGet(req(`/api/ask/history?session=${demo.id}`))).json()) as { ai: boolean }).ai).toBe(true);
  });

  it("two accounts never see each other's turns", async () => {
    const a = await makeAccount("blank");
    const b = await makeAccount("blank");
    await askPost(req("/api/ask", { token: a.tokens.access_token, body: { text: "我今天好累", locale: "zh-Hans" } }));
    const hb = (await (await historyGet(req("/api/ask/history", { token: b.tokens.access_token }))).json()) as { turns: unknown[] };
    expect(hb.turns).toEqual([]);
    const ha = (await (await historyGet(req("/api/ask/history", { token: a.tokens.access_token }))).json()) as { turns: AskTurn[] };
    expect(ha.turns.map((x) => x.text)).toEqual(["我今天好累"]);
  });

  it("her account cannot ask in his name or read his conversation (her link is not accepted here)", async () => {
    const dad = await makeAccount("example");
    const her = await makeAccount("none");
    const hash = `h-${randomUUID()}`;
    const inv = await store.createInvite({ patient_id: dad.userId, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true });
    const linkId = inv.ok ? inv.link.id : "";
    await store.acceptInvite(hash, her.userId, "Wei Ling");
    await store.confirmLink(linkId, dad.userId, true);
    const before = await store.listChatMessages(dad.userId);
    const r = await askPost(req(`/api/ask?link=${linkId}`, { token: her.tokens.access_token, body: { text: HERO } }));
    expect(r.status).not.toBe(200);
    const h = await historyGet(req(`/api/ask/history?link=${linkId}`, { token: her.tokens.access_token }));
    expect(h.status).not.toBe(200);
    expect(await store.listChatMessages(dad.userId)).toEqual(before);
    expect((await store.listQuestions(dad.userId)).some((q) => q.text === HERO)).toBe(false);
  });
});

describe("the demo: the device's member row labels the asker, the body never does", () => {
  it("a backstage device is labelled backstage; his phone (and a plain call) is him", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const desk = await store.addMember(s.id, { role: "backstage" });
    await askPost(req("/api/ask", { cookies: { [SESSION_COOKIE]: s.id, [MEMBER_COOKIE]: desk.id }, body: { text: "What is amlodipine for?", role: "patient" } }));
    const phone = await store.addMember(s.id, { role: "patient" });
    await askPost(req("/api/ask", { cookies: { [SESSION_COOKIE]: s.id, [MEMBER_COOKIE]: phone.id }, body: { text: "我今天好累", role: "backstage" } }));
    const askedBy = (await store.listSafetyEvents(s.id)).map((e) => (e.output as { askedBy: string }).askedBy);
    expect(askedBy).toEqual(["backstage", "patient"]);
    const h = (await (await historyGet(req("/api/ask/history", { cookies: { [SESSION_COOKIE]: s.id, [MEMBER_COOKIE]: phone.id } }))).json()) as { day: number; turns: AskTurn[] };
    expect(h.day).toBe(29);
    expect(h.turns.map((x) => x.text)).toEqual(["What is amlodipine for?", "我今天好累"]);
  });

  it("Wei Ling's phone is refused before anything is written", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    await store.addMember(s.id, { role: "patient" });
    const her = await store.addMember(s.id, { role: "family" });
    const cookies = { [SESSION_COOKIE]: s.id, [MEMBER_COOKIE]: her.id };
    expect((await askPost(req("/api/ask", { cookies, body: { text: HERO } }))).status).toBe(403);
    expect((await historyGet(req("/api/ask/history", { cookies }))).status).toBe(403);
    expect(await store.listChatMessages(s.id)).toEqual([]);
  });
});
