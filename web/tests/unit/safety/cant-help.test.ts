/**
 * cant_help (C2 track S, routed from track K's chat): chit-chat Ripple has nothing for (the weather, the lottery, the news,
 * a match, the markets, a joke) gets the fixed 「这个我帮不上，要我记下来吗？」 with no model call (no crisis screen either), no
 * question and nothing saved, also without AI consent; the turn is kept (pairTurns). Anything
 * with a topic, reading, medicine, symptom, feeling or crisis word in it goes the usual way.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as historyGet } from "@/app/api/ask/history/route";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as notePost } from "@/app/api/notes/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import type { LlmClient } from "@/lib/llm/types";
import { classifyRules, type ClassifyContext } from "@/lib/safety/classify";
import { CostGuard, CostLimitError } from "@/lib/safety/cost-guard";
import { offTopic } from "@/lib/safety/off-topic";
import { ask } from "@/lib/safety/pipeline";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskTurn } from "@/lib/safety/turns";
import { ROUTES, type AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const ctx: ClassifyContext = { doctorThresholdSystolic: 180, meds: [] };
const routeOf = (text: string) => classifyRules(text, ctx)?.route ?? null;

/** A live-looking model that counts every call (a crisis screen, a classification, a composition). */
function spyLlm(): LlmClient & { calls: number } {
  const spy: LlmClient & { calls: number } = {
    provider: "spy",
    model: "spy",
    calls: 0,
    async chat() {
      spy.calls++;
      return { content: '{"route":"none"}', tokens: 1 };
    },
  };
  return spy;
}

describe("the rule", () => {
  const chitChat: [string, string][] = [
    ["今天天气怎么样？", "weather"],
    ["明天会不会下雨", "weather"],
    ["Will it rain tomorrow?", "weather"],
    ["How's the weather today?", "weather"],
    ["Hari ini cuaca macam mana?", "weather"],
    ["4D 今天开什么号码？", "lottery"],
    ["Who won the football last night?", "sports"],
    ["今天有什么新闻？", "news"],
    ["股票今天涨了吗？", "markets"],
    ["讲个笑话", "entertainment"],
    ["你会唱歌吗？", "entertainment"],
    ["Tell me a joke", "entertainment"],
  ];
  for (const [text, subject] of chitChat) {
    it(`${text} -> cant_help (${subject})`, () => {
      const c = classifyRules(text, ctx);
      expect(c).toMatchObject({ route: "cant_help", reason: "rule:off_topic" });
      expect(c!.signals).toEqual(["off_topic", `off_topic:${subject}`]);
    });
  }

  it("the usual way: a statement stays a note; a symptom, food and drink, exercise, a feeling, the visit, a crisis, a dose", () => {
    expect(routeOf("今天好热")).toBe("log_only");
    expect(routeOf("孙子讲笑话很好笑")).toBe("log_only");
    expect(routeOf("天气冷，膝盖好痛")).toBe("log_only");
    expect(routeOf("天气热，我可以多喝水吗？")).not.toBe("cant_help");
    expect(routeOf("下雨天可以去散步吗？")).not.toBe("cant_help");
    expect(routeOf("讲个笑话吧，我好孤单")).not.toBe("cant_help");
    expect(routeOf("Is it going to rain? My blood pressure was high this morning")).not.toBe("cant_help");
    expect(routeOf("明天下雨，复诊的时间要改吗？")).not.toBe("cant_help");
    expect(routeOf("Will it rain? I don't want to live anymore")).toBe("self_harm");
    expect(routeOf("今天天气这么热，我胸口好痛")).toBe("emergency");
    expect(routeOf("4D 中奖了，可以多吃一粒庆祝吗？")).toBe("refuse_route");
    expect(routeOf("今天 150/95，天气会影响吗？")).not.toBe("cant_help");
  });

  it("offTopic: only asked about (or asked for), never with his care or a feeling in it", () => {
    expect(offTopic("今天下雨了", false)).toBeNull();
    expect(offTopic("今天会下雨吗？", true)).toBe("weather");
    expect(offTopic("今天会下雨吗？药要带伞吗", true)).toBeNull();
    expect(offTopic("我今天去唱歌了", false)).toBeNull();
    expect(offTopic("给我讲个故事", false)).toBe("entertainment");
    expect(offTopic("Can you tell me a story? I feel so lonely", true)).toBeNull();
  });

  it("the model never picks it: cant_help is not in ROUTES (the classify payload and its cassettes stay as they were)", () => {
    expect(ROUTES).not.toContain("cant_help");
    expect(ROUTES).toHaveLength(8);
  });
});

describe("the answer", () => {
  async function account(consents?: ("terms_privacy" | "ai_processing")[]) {
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ch${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank", ...(consents ? { consents } : {}) });
    return a.scope!;
  }

  it("the fixed sentence, no model call at all (no crisis screen), no question, no note", async () => {
    const scope = await account();
    const llm = spyLlm();
    const before = { q: (await store.listQuestions(scope.id)).length, n: (await store.listNotes(scope.id)).length };
    const r = await ask({ sessionId: scope.id, text: "今天天气怎么样？", locale: "zh-Hans", role: "patient" }, { store, llm, checker: null, checkerReason: "t", publish: () => {}, costGuard: null });
    expect(r.route).toBe("cant_help");
    expect(r.sentences.map((s) => [s.templateId, s.zh])).toEqual([["cant_help", TEMPLATES.cant_help.zh]]);
    expect(r.addedQuestionId).toBeUndefined();
    expect(llm.calls).toBe(0);
    expect((await store.listQuestions(scope.id)).length).toBe(before.q);
    expect((await store.listNotes(scope.id)).length).toBe(before.n);
    const ev = (await store.listSafetyEvents(scope.id)).at(-1)!;
    expect(ev.route).toBe("cant_help");
  });

  it("in English, without AI consent; over the question limit refused like any question", async () => {
    const scope = await account(["terms_privacy"]);
    const en = await ask({ sessionId: scope.id, text: "Tell me a joke", locale: "en", role: "patient" }, { store, llm: spyLlm(), checker: null, publish: () => {}, costGuard: null, aiAllowed: false });
    expect(en).toMatchObject({ route: "cant_help" });
    expect(en.sentences.map((s) => s.en)).toEqual([TEMPLATES.cant_help.en]);
    expect(en.addedQuestionId).toBeUndefined();
    // the same sentence with or without consent: no "you have not agreed to AI" note under it (the safety record keeps it)
    expect(en.noAiConsent).toBeUndefined();
    expect(((await store.listSafetyEvents(scope.id)).at(-1)!.output as { noAiConsent: boolean }).noAiConsent).toBe(true);
    // over the per-session question limit it is a question like any other: "try again later" (lib/how/trust.ts), and still
    // no model call
    const guard = new CostGuard({ requestsPerHour: 1, tokensPerDay: 1000 });
    const deps = { store, llm: spyLlm(), checker: null, publish: () => {}, costGuard: guard };
    expect((await ask({ sessionId: scope.id, text: "Who won the football last night?", locale: "en" }, deps)).route).toBe("cant_help");
    await expect(ask({ sessionId: scope.id, text: "Will it rain tomorrow?", locale: "en" }, deps)).rejects.toBeInstanceOf(CostLimitError);
    expect(deps.llm.calls).toBe(0);
  });
});

describe("POST /api/ask keeps the turn", () => {
  it("history returns it as a turn (pairTurns), with no question on his list", async () => {
    const him = await createAccountWithSpace(store, getAuthProvider(), { login: `ch${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const cookie = `rp_at=${him.tokens.access_token}`;
    const res = await askPost(
      new NextRequest("http://localhost/api/ask", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "今天天气怎么样？", locale: "zh-Hans" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AskResult;
    expect(body.route).toBe("cant_help");
    const h = await historyGet(new NextRequest("http://localhost/api/ask/history", { headers: { cookie } }));
    const { turns } = (await h.json()) as { turns: AskTurn[] };
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ text: "今天天气怎么样？", answer: { route: "cant_help" } });
    expect(turns[0].answer!.sentences.map((s) => s.templateId)).toEqual(["cant_help"]);
    expect(turns[0].noted).toBe(false);
    expect(await store.listQuestions(him.userId)).toHaveLength(0);
    // 「记下来」: his words become today's note (his notes route); the kept turn says so after a refresh
    const saved = await notePost(
      new NextRequest("http://localhost/api/notes", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "今天天气怎么样？", source: "typed" }) }),
    );
    expect(saved.status).toBe(201);
    const again = (await (await historyGet(new NextRequest("http://localhost/api/ask/history", { headers: { cookie } }))).json()) as { turns: AskTurn[] };
    expect(again.turns[0].noted).toBe(true);
  });
});
