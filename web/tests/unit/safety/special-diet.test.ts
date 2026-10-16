/**
 * What to eat or drink with a long-term condition (C2 track S, journey 13, routed from track K): kidney disease, diabetes,
 * heart failure, pregnancy ... are his doctor's or a dietitian's to answer: refuse_route with the fixed 「这个要问医生或营养师」,
 * a question on his doctor's list, no dose line, no label, no 995 line, no model words. A medicine named or meant, a
 * supplement, or a statement goes the usual way.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as historyGet } from "@/app/api/ask/history/route";
import { POST as askPost } from "@/app/api/ask/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { createMockLlm } from "@/lib/llm";
import { classifyRules, type ClassifyContext } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { dietCondition, specialDiet } from "@/lib/safety/special-diet";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskTurn } from "@/lib/safety/turns";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const ctx: ClassifyContext = { doctorThresholdSystolic: 180, meds: [] };

const DIET_QUESTIONS: [string, string][] = [
  ["我有肾病，可以吃什么？", "kidney"],
  ["I have kidney disease, what can I eat?", "kidney"],
  ["我有糖尿病，可以吃榴莲吗？", "diabetes"],
  ["I have diabetes, can I eat rice?", "diabetes"],
  ["Got diabetes, can eat durian or not?", "diabetes"],
  ["我有心衰，每天可以吃多少盐？", "heart_failure"],
  ["I have heart failure, how much salt can I have?", "heart_failure"],
  ["我怀孕了，有什么不能吃？", "pregnancy"],
  ["I'm pregnant, what foods should I avoid?", "pregnancy"],
  ["痛风可以喝啤酒吗？", "gout"],
];

async function askIn(sessionId: string, text: string, locale: "zh-Hans" | "en") {
  const before = (await store.listQuestions(sessionId)).length;
  const r = await ask({ sessionId, text, locale, role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "t", publish: () => {}, costGuard: null });
  return { r, added: (await store.listQuestions(sessionId)).length - before };
}

describe("the rule", () => {
  for (const [text, condition] of DIET_QUESTIONS) {
    it(`${text} -> the doctor or a dietitian (${condition})`, () => {
      const c = classifyRules(text, ctx);
      expect(c).toMatchObject({ route: "refuse_route", reason: "rule:special_diet", questionFor: "doctor", topics: [], drugs: [] });
      expect(c!.signals).toEqual(["special_diet", `special_diet:${condition}`]);
    });
  }

  it("the usual way: a medicine named or meant, a supplement, a statement, no food words, no condition", () => {
    expect(classifyRules("我有肾病，可以吃布洛芬吗？", ctx)?.reason).not.toBe("rule:special_diet");
    expect(classifyRules("I have kidney disease, can I take two tablets?", ctx)?.reason).toBe("rule:dose_change");
    expect(classifyRules("糖尿病可以吃鱼油吗？", ctx)?.reason).toBe("rule:combination");
    expect(classifyRules("我有糖尿病，今天吃了一块榴莲", ctx)?.route).toBe("log_only");
    expect(classifyRules("糖尿病要注意什么？", ctx)?.reason ?? null).not.toBe("rule:special_diet");
    expect(classifyRules("我可以吃榴莲吗？", ctx)?.reason ?? null).not.toBe("rule:special_diet");
    // a diet named without a long-term condition (his blood pressure doctor's salt line): track K's screen quotes the line
    expect(classifyRules("医生说少盐，那我可以吃咸蛋吗？", ctx)?.reason ?? null).not.toBe("rule:special_diet");
    // an emergency keeps its 995 whatever else is in it
    expect(classifyRules("我有糖尿病，现在胸口好痛，可以吃东西吗？", ctx)?.route).toBe("emergency");
  });

  it("specialDiet: 糖 inside 糖尿病 is not a food; dietCondition names the condition only", () => {
    expect(specialDiet("糖尿病要怎么办？", true)).toBeNull();
    expect(specialDiet("糖尿病可以吃糖吗？", true)).toBe("diabetes");
    expect(specialDiet("我有肾病，可以吃什么？", false)).toBeNull();
    expect(dietCondition("我有肾病")).toBe("kidney");
    expect(dietCondition("膝盖痛可以吃什么？")).toBeNull();
  });
});

describe("the answer", () => {
  // owner 10-15 (the rules were too rigid): what to eat with a long-term condition is an everyday question. Ripple's own
  // answer (general.ts; offline the mock's canned one) stands in place of the fixed referral, the doctor or a dietitian is
  // offered, not added; still no dose line, no label, no 995 line. Without his consent it is the referral as before
  it("Ripple's own answer, the doctor offered, nothing added: no dose line, no label, no 995 line", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const zh = await askIn(s.id, "我有肾病，可以吃什么？", "zh-Hans");
    expect(zh.r).toMatchObject({ route: "explain", routeChangedFrom: "refuse_route", routeReason: "rule:special_diet" });
    expect(zh.r.refusedRequest).toBeUndefined();
    expect(zh.r.sentences).toEqual([]);
    expect(zh.r.gloss).toMatchObject({ kind: "general", lang: "zh-Hans", offer: "doctor" });
    expect(zh.added).toBe(0);
    const salt = await askIn(s.id, "I have heart failure, how much salt can I have?", "en");
    expect(salt.r.gloss).toMatchObject({ kind: "general", lang: "en" });
    // (what he sees, not the whole result: its random safety-event ids held "995" now and then under load)
    expect(JSON.stringify({ sentences: salt.r.sentences, gloss: salt.r.gloss, followUp: salt.r.followUp ?? null })).not.toMatch(/995|change the dose|ONE tablet/);
    expect(salt.added).toBe(0);
  });

  it("without his consent to AI processing: the fixed referral and the question on his doctor's list, as before", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const r = await ask(
      { sessionId: s.id, text: "我有肾病，可以吃什么？", locale: "zh-Hans", role: "patient" },
      { store, llm: createMockLlm(), checker: null, checkerReason: "t", publish: () => {}, costGuard: null, aiAllowed: false },
    );
    expect(r).toMatchObject({ route: "refuse_route", routeReason: "rule:special_diet", refusedRequest: { rule: "rule:special_diet", replacedBy: "refer_diet" } });
    expect(r.sentences.map((x) => [x.templateId, x.zh])).toEqual([["refer_diet", TEMPLATES.refer_diet.zh]]);
    const q = (await store.listQuestions(s.id)).find((x) => x.id === r.addedQuestionId)!;
    expect(q).toMatchObject({ for: "doctor", origin: "refused_question", text: "我有肾病，可以吃什么？" });
  });

  it("asked again: answered again, still nothing added to his list", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const a = await askIn(s.id, "I have kidney disease, what can I eat?", "en");
    const b = await askIn(s.id, "I have kidney disease, what can I eat?", "en");
    expect([a.added, b.added]).toEqual([0, 0]);
    expect(b.r.gloss?.kind).toBe("general");
  });

  it("POST /api/ask on his account: 200, the referral, the question, the turn kept", async () => {
    const him = await createAccountWithSpace(store, getAuthProvider(), { login: `sd${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const cookie = `rp_at=${him.tokens.access_token}`;
    const res = await askPost(
      new NextRequest("http://localhost/api/ask", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "我有肾病，可以吃什么？", locale: "zh-Hans" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AskResult;
    // (owner 10-15: Ripple's own answer, offline the canned one; nothing added to his list)
    expect(body.route).toBe("explain");
    expect(body.addedQuestionId).toBeUndefined();
    expect(body.gloss?.kind).toBe("general");
    expect(body.sentences.map((x) => x.templateId)).toEqual([]);
    expect((await store.listQuestions(him.userId)).map((q) => q.text)).toEqual([]);
    const h = await historyGet(new NextRequest("http://localhost/api/ask/history", { headers: { cookie } }));
    const { turns } = (await h.json()) as { turns: AskTurn[] };
    expect(turns.map((t) => [t.text, t.answer?.route, t.answer?.gloss?.kind])).toEqual([["我有肾病，可以吃什么？", "explain", "general"]]);
  });
});
