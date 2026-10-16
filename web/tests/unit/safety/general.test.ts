/**
 * Owner 10-15 (「AI 规则太死 … 995 的回答太僵硬了 … 应该完全放开」): Ripple's own answer to an everyday question
 * (lib/safety/general.ts), the 995 and self-harm answers worded for what he said (lib/safety/crisis-words.ts), both from the
 * owner's policy file (lib/safety/policy/answer-policy.md). What the code still keeps: never changing his medicines, never a
 * diagnosis, no number on the do-not-display list, 995 and the helplines always there, the fixed sentences as the fallback.
 *
 * The live model is a stand-in (tests/unit/safety/live-stand-in.ts: provider "hunyuan", no network); each test scripts its
 * "general" or "crisis_words" reply.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatAnswer } from "@/components/chat/ChatAnswer";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { answerLine } from "@/components/daily/answer-parts";
import { createMockLlm, MOCK_GENERAL } from "@/lib/llm/mock";
import type { CrisisWordsPayload, GeneralPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { CRISIS_WORDS_TIMEOUT_MS, guardCrisisWords, urgencyOf } from "@/lib/safety/crisis-words";
import { guardGeneral, type GeneralRecord } from "@/lib/safety/general";
import { GENERAL_NOTE } from "@/lib/safety/gloss-note";
import { ask } from "@/lib/safety/pipeline";
import { answerPolicy, policyPath } from "@/lib/safety/policy/load";
import { renderText } from "@/lib/safety/render";
import { TEMPLATES } from "@/lib/safety/templates";
import { storedAnswer } from "@/lib/safety/turns";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import { deadline, liveStandIn, type StandIn } from "./live-stand-in";

const ULCER = "我口腔溃疡，可以吃辣吗？";
const ULCER_ANSWER = "口腔溃疡这几天最好先别吃辣，辣会刺激伤口，更痛也好得慢。先吃温和清淡的，多喝水。要是两周还不好，或者越来越大，就去看医生。";

const store = getMemoryStore();

async function askWith(text: string, llm: LlmClient, opts: { locale?: "en" | "zh-Hans"; aiAllowed?: boolean; deadlineMs?: number } = {}) {
  const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
  const before = (await store.listQuestions(s.id)).length;
  const t0 = performance.now();
  const result = await ask(
    { sessionId: s.id, text, locale: opts.locale, role: "patient" },
    { store, llm, checker: null, checkerReason: "no checker in unit tests", publish: () => {}, costGuard: null, aiAllowed: opts.aiAllowed, deadlineMs: opts.deadlineMs },
  );
  const out = result.events[0].output as { general: GeneralRecord | null; crisisWords: { voiced: boolean; why?: string; reasons?: string[] } | null };
  return { result, out, added: (await store.listQuestions(s.id)).length - before, ms: performance.now() - t0 };
}

const general = (answer: string, ask: "doctor" | "pharmacist" | "none" = "none") => JSON.stringify({ answer, ask });
const live = (script: StandIn) => liveStandIn(script);

describe("the policy file is what the model is told", () => {
  it("answerPolicy reads lib/safety/policy/answer-policy.md: the owner's three never-do lines are in it", () => {
    expect(policyPath()).toMatch(/lib[\\/]safety[\\/]policy[\\/]answer-policy\.md$/);
    const policy = answerPolicy()!;
    expect(policy).toContain("## 一定不做的三件事");
    expect(policy).toContain("不叫他自己改药");
    expect(policy).toContain("## 紧急情况（要打 995）");
  });

  it("a missing file is no policy (the fixed sentences then stand)", () => {
    expect(answerPolicy("D:/no/such/answer-policy.md")).toBeNull();
  });

  it("the general prompt is the policy file plus the output format; the payload is his question, his medicines and his sources", async () => {
    const calls: NonNullable<StandIn["calls"]> = [];
    await askWith(ULCER, live({ general: general(ULCER_ANSWER), calls }), { locale: "zh-Hans" });
    const call = calls.find((c) => c.task === "general")!;
    expect(call.opts.system.startsWith(answerPolicy()!)).toBe(true);
    expect(call.opts.system).toContain('{"answer"');
    const payload = JSON.parse(call.opts.user) as GeneralPayload;
    expect(payload).toMatchObject({ task: "general", locale: "zh-Hans", question: ULCER });
    expect(payload.medicines.length).toBeGreaterThan(0);
    expect(payload.sources.length).toBeLessThanOrEqual(10);
  });
});

describe("an everyday question gets Ripple's own answer", () => {
  it("「我口腔溃疡，可以吃辣吗？」: the model's answer, no 'I won't guess', nothing added, the doctor offered", async () => {
    const { result, out, added } = await askWith(ULCER, live({ general: general(ULCER_ANSWER, "doctor") }), { locale: "zh-Hans" });
    expect(result.route).toBe("explain");
    expect(result.sentences.map((s) => s.templateId)).not.toContain("uncertain_no_source");
    expect(result.gloss).toEqual({ kind: "general", lang: "zh-Hans", sentences: [{ text: ULCER_ANSWER, sourceIds: [] }], at: 0, offer: "doctor" });
    expect(result.addedQuestionId).toBeUndefined();
    expect(added).toBe(0);
    expect(out.general).toMatchObject({ shown: true, calls: 1, ask: "doctor" });
    // the text form carries it with the line that says whose words these are
    expect(renderText(result, "zh-Hans")).toBe(`${ULCER_ANSWER}\n${GENERAL_NOTE.zh}`);
  });

  it("drawn as Ripple's entry with the quiet line and the offer to put it on his list (only when nothing was added)", async () => {
    const { result } = await askWith(ULCER, live({ general: general(ULCER_ANSWER, "doctor") }), { locale: "zh-Hans" });
    const parts = answerLine(result.sentences, "zh-Hans", result.gloss);
    expect(parts.map((p) => [p.kind, p.source])).toEqual([["gloss", "general"]]);
    const html = renderToStaticMarkup(createElement(AnswerCard, { question: ULCER, answer: storedAnswer(result), locale: "zh-Hans" }));
    expect(html).toContain(ULCER_ANSWER);
    expect(html).toContain(GENERAL_NOTE.zh);
    expect(html).toContain('data-testid="ask-offer"');
    expect(html).toContain("加到问题单，问医生");
    // a question already on his list: no offer
    const listed = renderToStaticMarkup(createElement(AnswerCard, { question: ULCER, answer: { ...storedAnswer(result), addedQuestionId: "q1" }, locale: "zh-Hans" }));
    expect(listed).not.toContain('data-testid="ask-offer"');
    // the day's record draws the same answer with the same line under it
    const day = renderToStaticMarkup(createElement(ChatAnswer, { answer: storedAnswer(result), locale: "zh-Hans" }));
    expect(day).toContain(ULCER_ANSWER);
    expect(day).toContain(GENERAL_NOTE.zh);
    expect(day).toContain('data-kind="general"');
  });

  it("in English too: the English answer and the English line", async () => {
    const text = "I have a mouth ulcer, can I eat spicy food?";
    const answer = "Better to skip spicy food for a few days: it stings and slows healing. Eat soft, mild food and drink water. See a doctor if it lasts more than two weeks.";
    const { result } = await askWith(text, live({ general: general(answer) }), { locale: "en" });
    expect(result.gloss).toMatchObject({ kind: "general", lang: "en", sentences: [{ text: answer }] });
    expect(result.gloss?.offer).toBeUndefined();
    expect(renderText(result, "en")).toContain(GENERAL_NOTE.en);
  });

  it("a request only the model sorted as a refusal is an everyday question too (owner 10-15)", async () => {
    const { result, added } = await askWith("睡不好怎么办？", live({ classify: '{"route":"refuse_route","topic":"other","reason":"asks for a recommendation"}', general: general("睡不好可以先固定时间上床，睡前别喝浓茶咖啡，白天多走动。连着几周都睡不好，就跟医生说。", "doctor") }), { locale: "zh-Hans" });
    expect(result.route).toBe("explain");
    expect(result.routeChangedFrom).toBe("uncertain");
    expect(result.refusedRequest).toBeUndefined();
    expect(result.gloss?.kind).toBe("general");
    expect(added).toBe(0);
  });

  it("his own sources still come first: the leaflet line, then Ripple's answer after it", async () => {
    const { result } = await askWith("What is amlodipine for?", live({ compose: (_o, p) => JSON.stringify({ sentences: (p as { candidates: { sourceId: string; span: string; restatement?: { en: string }; attribution?: string }[] }).candidates.filter((c) => c.sourceId === "hh-amlodipine:amlodipine.purpose").map((c) => ({ speechAct: "restate", sourceId: c.sourceId, span: c.span, slots: {}, en: c.restatement ? c.restatement.en : c.span, attribution: c.attribution })) }), general: general("It lowers your blood pressure by relaxing the blood vessels.") }), { locale: "en" });
    expect(result.sentences[0].sourceId).toBe("hh-amlodipine:amlodipine.purpose");
    expect(result.gloss).toMatchObject({ kind: "general", at: 1 });
  });
});

describe("what code still keeps (guardGeneral): the answer is then what it was before", () => {
  it.each([
    ["可以多吃一粒，没关系。", "med_change"],
    ["血压低的时候可以先停药两天。", "med_change"],
    ["你就减半吃降压药吧。", "med_change"],
    ["You can take an extra tablet tonight.", "med_change"],
    ["It's fine to skip your morning dose.", "med_change"],
    ["你这是得了口腔癌。", "diagnosis"],
    ["You have a stroke.", "diagnosis"],
  ])("%s -> %s", async (text, code) => {
    const locale = /\p{Script=Han}/u.test(text) ? "zh-Hans" : "en";
    expect(guardGeneral(text, locale), text).toContain(code);
    const { result, out, added } = await askWith(locale === "zh-Hans" ? "睡不好怎么办？" : "I can't sleep well, what can I do?", live({ general: general(text) }), { locale });
    expect(result.gloss).toBeUndefined();
    expect(out.general).toMatchObject({ shown: false, why: "guard" });
    expect(out.general?.reasons).toContain(code);
    // as before 10-15: not sure, and his question on his list
    expect(result.route).toBe("uncertain");
    expect(result.sentences.map((s) => s.templateId)).toContain("uncertain_no_source");
    expect(added).toBe(1);
  });

  it("ordinary advice passes, telling him NOT to change his medicine on his own too", () => {
    for (const text of [
      ULCER_ANSWER,
      "可以少吃辣的，多喝水，早点休息。",
      "降压药不要自己停，停药之前先问医生。",
      "不能自己多吃一粒，这个要问医生。",
      "停药的事要问医生，别自己决定。",
      "停药之前先问医生。",
      "Don't skip your dose; ask your doctor before you stop taking your medicine.",
      "Drinking cold water on a hot day is fine; sip it slowly.",
    ]) {
      expect(guardGeneral(text, /\p{Script=Han}/u.test(text) ? "zh-Hans" : "en"), text).toEqual([]);
    }
  });

  it("the model's machinery in the answer (Hunyuan, 10-16: its JSON tail, think and tool_call tags): not shown", () => {
    for (const text of [
      '量血压前先坐下休息五分钟。","ask":"none"}',
      "Ask your pharmacist. None. Final json.</think:6124c78e>",
      "Take it as usual.<tool_call:1>",
      "Yes, after measuring. Ask none. (End.)",
      "Use {answer} here.",
    ]) {
      expect(guardGeneral(text, /\p{Script=Han}/u.test(text) ? "zh-Hans" : "en"), text).toContain("machinery");
    }
    expect(guardGeneral("You can ask your pharmacist (the one at the clinic) about it.", "en")).toEqual([]);
  });

  it("the wrong language and a reply that is not the JSON asked for: no answer of Ripple's own", async () => {
    expect(guardGeneral("Eat mild food.", "zh-Hans")).toContain("language");
    const bad = await askWith("睡不好怎么办？", live({ general: "not json" }), { locale: "zh-Hans" });
    expect(bad.result.gloss).toBeUndefined();
    expect(bad.out.general).toMatchObject({ shown: false, why: "model_failed" });
    const down = await askWith("睡不好怎么办？", live({ general: deadline() }), { locale: "zh-Hans" });
    expect(down.result.gloss).toBeUndefined();
    expect(down.result.sentences.map((s) => s.templateId)).toContain("uncertain_no_source");
  });
});

describe("where Ripple's own answer never goes", () => {
  it("a dose question keeps his doctor's words, the referral and his list; no model words it", async () => {
    const calls: NonNullable<StandIn["calls"]> = [];
    const { result } = await askWith("可以多吃一粒吗？", live({ general: general("可以多吃。"), calls }), { locale: "zh-Hans" });
    expect(result.route).toBe("refuse_route");
    expect(calls.map((c) => c.task)).not.toContain("general");
    expect(result.gloss).toBeUndefined();
    expect(result.addedQuestionId).toBeTruthy();
  });

  it("an unknown medicine keeps the fixed sentence", async () => {
    const calls: NonNullable<StandIn["calls"]> = [];
    const { result } = await askWith("阿司匹灵宝是做什么的？", live({ general: general("这是一种药。"), calls }), { locale: "zh-Hans" });
    expect(result.route).toBe("unknown_med");
    expect(calls.map((c) => c.task)).not.toContain("general");
    expect(result.gloss).toBeUndefined();
  });

  it("without his consent to AI processing no model sees it, offline or live", async () => {
    const calls: NonNullable<StandIn["calls"]> = [];
    const { result } = await askWith(ULCER, live({ general: general(ULCER_ANSWER), calls }), { locale: "zh-Hans", aiAllowed: false });
    expect(calls).toEqual([]);
    expect(result.gloss).toBeUndefined();
    expect(result.sentences.map((s) => s.templateId)).toEqual(["no_ai_consent"]);
  });

  it("offline: the mock's canned answer where nothing of his answers it, and none under his own sources", async () => {
    const none = await askWith(ULCER, createMockLlm(), { locale: "zh-Hans" });
    expect(none.result.gloss).toMatchObject({ kind: "general", sentences: [{ text: MOCK_GENERAL.zh.answer }], offer: "doctor" });
    expect(none.added).toBe(0);
    const quoted = await askWith("What is amlodipine for?", createMockLlm(), { locale: "en" });
    expect(quoted.result.sentences[0].sourceId).toBe("hh-amlodipine:amlodipine.purpose");
    expect(quoted.result.gloss).toBeUndefined();
    expect(quoted.out.general).toMatchObject({ shown: false, why: "offline_quoted" });
  });
});

describe("the 995 and self-harm answers in a person's words (crisis-words.ts)", () => {
  const CHEST_NOW = "我胸口很痛，出冷汗，喘不上气";
  const WORDED = "现在就打 995 叫救护车。你胸口痛、出冷汗、喘不上气，要马上处理，先坐下别走动。";

  it("the danger signs: the model's words on the red card, 995 kept, the fixed sentence still the record", async () => {
    const calls: NonNullable<StandIn["calls"]> = [];
    const { result, out } = await askWith(CHEST_NOW, live({ crisis_words: JSON.stringify({ answer: WORDED }), calls }), { locale: "zh-Hans" });
    expect(result.route).toBe("emergency");
    const first = result.sentences[0];
    expect(first).toMatchObject({ templateId: "emergency_995", origin: "voiced", zh: WORDED });
    expect(answerLine(result.sentences, "zh-Hans")[0]).toMatchObject({ kind: "emergency", text: WORDED });
    // the record keeps the fixed sentence it stands in for
    expect(result.fixedTextZh).toContain(TEMPLATES.emergency_995.zh);
    expect(out.crisisWords).toMatchObject({ voiced: true });
    const payload = JSON.parse(calls.find((c) => c.task === "crisis_words")!.opts.user) as CrisisWordsPayload;
    expect(payload).toMatchObject({ kind: "emergency", urgency: "now", locale: "zh-Hans", message: CHEST_NOW });
    expect(payload.fixed).toContain(TEMPLATES.emergency_995.zh);
  });

  it("self-harm: the model's words first, the helplines after them, fixed", async () => {
    const words = "我听到了，你说不想活了，我很担心你。你现在安全吗？如果可能会伤害自己，请马上打 995 或去最近的急诊。";
    const { result } = await askWith("我不想活了", live({ crisis_words: JSON.stringify({ answer: words }) }), { locale: "zh-Hans" });
    expect(result.route).toBe("self_harm");
    expect(result.sentences.map((s) => [s.templateId, s.origin])).toEqual([
      ["self_harm_995", "voiced"],
      ["self_harm_sos", "template"],
      ["self_harm_mindline", "template"],
      ["self_harm_care_corner", "template"],
    ]);
    expect(renderText(result, "zh-Hans")).toContain("1767");
  });

  it("chest pain with nothing that says it is bad now: kept for his doctor, and the 995 stays conditional", async () => {
    expect(urgencyOf(["signal_recorded", "signal_995_chest"])).toBe("if_worse");
    expect(urgencyOf(["emergency_995"])).toBe("now");
    expect(urgencyOf(["signal_recorded", "signal_995_stroke"])).toBe("now");
    const fixed = [TEMPLATES.signal_995_chest.zh];
    // "call 995 now" for a sign kept for the doctor is not what the fixed sentence says
    expect(guardCrisisWords("现在马上打 995。", { locale: "zh-Hans", fixed, noted: null, message: "我胸口很痛", urgency: "if_worse" })).toContain("not_conditional");
    expect(guardCrisisWords("要是痛得厉害或喘不上气，马上打 995。", { locale: "zh-Hans", fixed, noted: null, message: "我胸口很痛", urgency: "if_worse" })).toEqual([]);
  });

  it.each([
    ["no 995", "请马上去医院。", "missing_number"],
    ["another number", "现在就打 995，或者打 6123 4567。", "other_number"],
    ["a medicine", "现在就打 995，先嚼一片阿司匹林。", "medicine"],
    ["the wrong language", "Call 995 now.", "language"],
  ])("%s: the fixed sentence stands", async (_label, words, code) => {
    expect(guardCrisisWords(words, { locale: "zh-Hans", fixed: [TEMPLATES.emergency_995.zh], noted: null, message: CHEST_NOW, urgency: "now" })).toContain(code);
    const { result, out } = await askWith(CHEST_NOW, live({ crisis_words: JSON.stringify({ answer: words }) }), { locale: "zh-Hans" });
    expect(result.sentences[0]).toMatchObject({ templateId: "emergency_995", origin: "template", zh: TEMPLATES.emergency_995.zh });
    expect(out.crisisWords).toMatchObject({ voiced: false, why: "guard" });
  });

  it("a model that does not answer: the fixed sentences within CRISIS_WORDS_TIMEOUT_MS", async () => {
    const { result, out, ms } = await askWith(CHEST_NOW, live({ crisis_words: "hang" }), { locale: "zh-Hans", deadlineMs: 60_000 });
    expect(ms).toBeLessThan(CRISIS_WORDS_TIMEOUT_MS + 1000);
    expect(result.sentences[0]).toMatchObject({ templateId: "emergency_995", origin: "template" });
    expect(out.crisisWords).toMatchObject({ voiced: false, why: "time" });
  });

  it("offline and without his consent: the fixed sentences, no call", async () => {
    const off = await askWith(CHEST_NOW, createMockLlm(), { locale: "zh-Hans" });
    expect(off.result.sentences[0]).toMatchObject({ templateId: "emergency_995", origin: "template" });
    expect(off.out.crisisWords).toMatchObject({ voiced: false, why: "offline" });
    const calls: NonNullable<StandIn["calls"]> = [];
    const noConsent = await askWith(CHEST_NOW, live({ crisis_words: JSON.stringify({ answer: WORDED }), calls }), { locale: "zh-Hans", aiAllowed: false });
    expect(calls).toEqual([]);
    expect(noConsent.result.sentences[0].origin).toBe("template");
  });
});

/** (AskResult stays importable for the helpers above) */
export type { AskResult };
