/**
 * The guided harness's follow-up question on his screens (2026-10-16; components/daily/FollowUpQuestion.tsx, drawn by
 * AnswerCard): its words in the answer's language, right after the answer's crisis lines (995 and the helplines above it)
 * and before the rest of the answer (10-16), every option an outline button (the 995 side with a red edge and red words,
 * never the 995 call's filled red), what a tap sends, multi-select with 「好了」 (「都没有」 alone), where the screen goes when
 * the answer arrives, and how it stands once his answer is on its way or was given. The question below is a test-only fixture (the engine's own questions are
 * lib/safety's, templates.ts); the answers it hangs under are real answers of the pipeline (the offline model).
 * The vitest environment has no DOM, so a tap is tested through what it sends (follow-up.ts, streamAsk with a stubbed
 * fetch) and each state through the props the screens give.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { aroundQuestion } from "@/components/daily/answer-parts";
import { answeredFollowUps, followUpOf, followUpReply, followUpScroll, toggleOption } from "@/components/daily/follow-up";
import { AskSection, askBody, draftAnswer, NO_PROGRESS, sendAsk, streamAsk, type AskProgress } from "@/components/today/AskSection";
import { createMockLlm } from "@/lib/llm";
import { ask, screenTurns } from "@/lib/safety/pipeline";
import type { FollowUp } from "@/lib/safety/risk/types";
import { askTurns, recordAskTurn, storedAnswer, type AskTurn, type StoredAnswer } from "@/lib/safety/turns";
import type { AskResult } from "@/lib/safety/types";
import { sseFrame } from "@/lib/sse/frames";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, "");

/** A test-only question in the contract's shape (the chest pathway's first step). */
const CHEST: FollowUp = {
  id: "fu-test-chest-1",
  pathway: "chest",
  step: 1,
  of: 3,
  templateId: "fu_chest_now",
  en: "Is the chest pain still happening now?",
  zh: "胸口现在还痛吗？",
  options: [
    { id: "yes", en: "Yes", zh: "还在痛", tone: "danger" },
    { id: "gone", en: "No, it's gone", zh: "不痛了", tone: "calm" },
    { id: "unsure", en: "Not sure", zh: "说不清", tone: "neutral" },
  ],
};

/** A test-only multi-select question (a short list of signs). */
const SIGNS: FollowUp = {
  id: "fu-test-chest-3",
  pathway: "chest",
  step: 3,
  of: 3,
  templateId: "fu_chest_signs",
  en: "Is any of these happening with it?",
  zh: "有没有下面这些？",
  multi: true,
  options: [
    { id: "sweat", en: "Cold sweat", zh: "出冷汗", tone: "danger" },
    { id: "breath", en: "Short of breath", zh: "喘不上气", tone: "danger" },
    { id: "none", en: "None of these", zh: "都没有", tone: "calm" },
    { id: "unsure", en: "Not sure", zh: "说不清", tone: "neutral" },
  ],
};

async function answerTo(question: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<StoredAnswer> {
  const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
  const r = await ask({ sessionId: s.id, text: question, locale, role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
  return storedAnswer(r);
}

/** The question's entry: everything from its hook to the end of the markup. */
const questionOf = (out: string) => out.slice(out.indexOf('data-testid="ask-followup"'));
/** The option buttons, in order: [option id, variant, the button's opening tag]. */
const options = (out: string) => [...out.matchAll(/<button[^>]*data-testid="ask-followup-option"[^>]*>/g)].map((m) => [/data-option="([^"]+)"/.exec(m[0])![1], /data-variant="([^"]+)"/.exec(m[0])![1], m[0]] as const);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the follow-up question under an answer", () => {
  it("an emergency answer: the 995 lines first, then the question, then the rest of the answer (the doctor's words), in Mandarin", async () => {
    const plain = await answerTo("我胸口好痛，喘不上气");
    const answer = { ...plain, followUp: CHEST };
    const out = html(createElement(AnswerCard, { question: "我胸口好痛，喘不上气", answer, locale: "zh-Hans", followUp: { onReply: () => undefined } }));
    // every crisis line and its 995 stand above the question; his doctor's words come after it
    const at = out.indexOf('data-testid="ask-followup"');
    expect(out.indexOf('href="tel:995"')).toBeGreaterThan(-1);
    expect(out.lastIndexOf('href="tel:995"')).toBeLessThan(at);
    if (out.includes('data-rp="emergency"')) expect(out.indexOf('data-rp="emergency"')).toBeLessThan(at);
    const quote = out.indexOf('data-kind="quote"');
    expect(quote).toBeGreaterThan(-1);
    expect(quote).toBeGreaterThan(at);
    // without a question nothing of it is drawn and nothing moves
    const before = html(createElement(AnswerCard, { question: "我胸口好痛，喘不上气", answer: { ...plain, followUp: undefined }, locale: "zh-Hans" }));
    expect(before).not.toContain("ask-followup");
    // Ripple's entry: the question in its tinted bubble, a group labelled by those words
    const q = questionOf(out);
    expect(q).toMatch(/^data-testid="ask-followup" data-followup="fu-test-chest-1" data-pathway="chest" data-step="1" data-of="3" data-multi="false" data-state="open">/);
    const label = /<div role="group" aria-labelledby="([^"]+)" lang="zh-Hans"/.exec(q)?.[1];
    expect(label).toBeTruthy();
    expect(q).toContain(`<p id="${label}" class="rpu-bubble" data-rp="bubble" data-node="rip" data-rp-role="say" lang="zh-Hans" data-testid="ask-followup-question">胸口现在还痛吗？</p>`);
    // one option per row, each a real button, the words in the answer's language
    expect(q).toMatch(/<div class="rpu-acts" data-rp="acts" style="--rpu-cols:1">/);
    expect(options(q).map(([id]) => id)).toEqual(["yes", "gone", "unsure"]);
    expect(text(q)).toContain("还在痛不痛了说不清");
    for (const [, , tag] of options(q)) expect(tag).not.toMatch(/ disabled=""/);
    expect(q).not.toContain("ask-followup-done");
    expect(q).not.toContain("ask-followup-pending");
  });

  it("in English: the question and the options in the answer's language; every option an outline button, the 995 side red-edged, the others plain alike", async () => {
    const answer = { ...(await answerTo("My chest hurts and I can't breathe", "en")), followUp: CHEST };
    const out = html(createElement(AnswerCard, { question: "My chest hurts and I can't breathe", answer, locale: "en", followUp: { onReply: () => undefined } }));
    const q = questionOf(out);
    expect(q).toContain(">Is the chest pain still happening now?</p>");
    expect(text(q)).toContain("YesNo, it&#x27;s goneNot sure");
    // 10-16: no fill on any option (the only filled red is the real 995 call): the 995 side with the red edge and words of
    // .rpu-act[data-variant="danger-outline"]; calm and neutral are not told apart
    expect(options(q).map(([id, v]) => [id, v])).toEqual([
      ["yes", "danger-outline"],
      ["gone", "secondary"],
      ["unsure", "secondary"],
    ]);
    expect(options(q)[0][2]).toMatch(/^<button [^>]*type="button" class="rpu-act" data-rp="act" data-variant="danger-outline"/);
    expect(q).not.toMatch(/data-testid="ask-followup-option"[^>]*data-variant="danger"/);
    // the 995 call itself is still the filled red one (the red card's call, or the 995 button of a 995 line)
    expect(out).toMatch(/class="rpu-emergency-call" href="tel:995"|<a class="rpu-act" href="tel:995" data-variant="danger"/);
  });

  it("the question follows the answer's language, not the screen's", async () => {
    const answer = { ...(await answerTo("My chest hurts and I can't breathe", "en")), followUp: CHEST };
    const out = html(createElement(AnswerCard, { question: "My chest hurts and I can't breathe", answer, locale: "zh-Hans" }));
    expect(questionOf(out)).toContain(">Is the chest pain still happening now?</p>");
  });

  it("the helplines stand above the self-harm confirm question", async () => {
    const confirm: FollowUp = {
      id: "fu-test-sh-1",
      pathway: "self_harm_check",
      step: 1,
      of: 2,
      templateId: "fu_self_harm_confirm",
      en: "Are you having thoughts of ending your life?",
      zh: "你有没有想过结束自己的生命？",
      options: [
        { id: "yes", en: "Yes", zh: "有", tone: "danger" },
        { id: "no", en: "No", zh: "没有", tone: "calm" },
        { id: "rather_not", en: "I'd rather not say", zh: "不想说", tone: "neutral" },
      ],
    };
    const answer = { ...(await answerTo("我觉得活着没什么意思，只会拖累孩子")), followUp: confirm };
    const out = html(createElement(AnswerCard, { question: "我觉得活着没什么意思，只会拖累孩子", answer, locale: "zh-Hans", followUp: { onReply: () => undefined } }));
    const at = out.indexOf('data-testid="ask-followup"');
    expect(out.indexOf('data-kind="hotlines"')).toBeGreaterThan(-1);
    expect(out.lastIndexOf('class="rpu-hotline"')).toBeLessThan(at);
    expect(out.lastIndexOf('data-rp="call"')).toBeLessThan(at);
    // (Ripple's own lines of the ladder with no number, 「我在这里……」, come after the question)
    for (const tail of [...out.matchAll(/data-kind="ripple"/g)].map((m) => m.index ?? 0)) expect(tail).toBeGreaterThan(at);
  });

  it("under chit-chat too (the answer the day's record draws): no crisis line, so the question comes first, before Ripple's own entries", async () => {
    const answer = { ...(await answerTo("今天天气怎么样？")), followUp: CHEST };
    const out = html(createElement(AnswerCard, { question: "今天天气怎么样？", answer, locale: "zh-Hans", followUp: { onReply: () => undefined } }));
    expect(out).toContain('data-route="cant_help"');
    expect(out.indexOf('data-testid="ask-followup"')).toBeLessThan(out.indexOf('data-testid="ask-note-offer"'));
    expect(out.indexOf('data-testid="ask-followup"')).toBeGreaterThan(out.indexOf("<h1"));
  });

  it("no question: nothing of it is drawn (and a draft never draws one: the final answer carries it)", async () => {
    const plain = await answerTo("今天 150/95，我能不能多吃一粒？");
    const out = html(createElement(AnswerCard, { question: "今天 150/95，我能不能多吃一粒？", answer: { ...plain, followUp: undefined }, locale: "zh-Hans", followUp: { onReply: () => undefined } }));
    expect(out).not.toContain("ask-followup");
    const draft = html(createElement(AnswerCard, { question: "q", answer: { ...plain, followUp: CHEST }, locale: "zh-Hans", draft: { line: "正在写……", writing: true }, followUp: { onReply: () => undefined } }));
    expect(draft).not.toContain("ask-followup");
  });

  it("on its way: what he chose marked and busy, the others off, the waiting line under them", async () => {
    const answer = { ...(await answerTo("我胸口好痛，喘不上气")), followUp: CHEST };
    const q = questionOf(html(createElement(AnswerCard, { question: "q", answer, locale: "zh-Hans", followUp: { chosen: ["yes"], pending: true } })));
    expect(q).toContain('data-state="pending"');
    const [yes, gone, unsure] = options(q);
    // the chosen one keeps the filled "on" mark while busy (a plain disabled button would grey it)
    expect(yes[1]).toBe("on");
    expect(yes[2]).toContain('aria-pressed="true"');
    expect(yes[2]).toContain('aria-busy="true"');
    for (const o of [gone, unsure]) {
      expect(o[2]).toContain('disabled=""');
      expect(o[2]).not.toContain("aria-busy");
    }
    expect(q).toContain('<p class="rpu-tl-note" role="status" data-testid="ask-followup-pending">在找医生说过的话……</p>');
  });

  it("answered: what he chose marked, nothing to tap", async () => {
    const answer = { ...(await answerTo("我胸口好痛，喘不上气")), followUp: CHEST };
    const q = questionOf(html(createElement(AnswerCard, { question: "q", answer, locale: "zh-Hans", latest: false, followUp: { chosen: ["gone"], onReply: () => undefined } })));
    expect(q).toContain('data-state="answered"');
    const [yes, gone, unsure] = options(q);
    expect(gone[1]).toBe("on");
    expect(gone[2]).toContain('aria-pressed="true"');
    expect(gone[2]).toContain('aria-disabled="true"');
    expect(gone[2]).not.toContain("aria-busy");
    for (const o of [yes, unsure]) expect(o[2]).toContain('disabled=""');
    expect(q).not.toContain("ask-followup-pending");
  });

  it("closed (not his to answer here): every option off", async () => {
    const answer = { ...(await answerTo("我胸口好痛，喘不上气")), followUp: CHEST };
    const q = questionOf(html(createElement(AnswerCard, { question: "q", answer, locale: "zh-Hans", latest: false })));
    expect(q).toContain('data-state="closed"');
    expect(options(q).every(([, , tag]) => tag.includes('disabled=""'))).toBe(true);
  });

  it("multi-select: the options toggle (aria-pressed) and one 「好了」 / Done sends them, off until one is ticked", async () => {
    const zh = { ...(await answerTo("我胸口好痛，喘不上气")), followUp: SIGNS };
    const q = questionOf(html(createElement(AnswerCard, { question: "q", answer: zh, locale: "zh-Hans", followUp: { onReply: () => undefined } })));
    expect(q).toContain('data-multi="true"');
    expect(options(q).map(([, , tag]) => /aria-pressed="([a-z]+)"/.exec(tag)?.[1])).toEqual(["false", "false", "false", "false"]);
    expect(q).toMatch(/<button data-testid="ask-followup-done" type="button" class="rpu-act" data-rp="act" data-variant="primary" disabled="">好了<\/button>/);
    const en = { ...(await answerTo("My chest hurts and I can't breathe", "en")), followUp: SIGNS };
    expect(questionOf(html(createElement(AnswerCard, { question: "q", answer: en, locale: "en", followUp: { onReply: () => undefined } })))).toContain(">Done</button>");
    // answered: the ticked ones marked, no Done
    const done = questionOf(html(createElement(AnswerCard, { question: "q", answer: zh, locale: "zh-Hans", followUp: { chosen: ["sweat", "breath"] } })));
    expect(options(done).map(([id, v]) => [id, v])).toEqual([
      ["sweat", "on"],
      ["breath", "on"],
      ["none", "secondary"],
      ["unsure", "secondary"],
    ]);
    expect(done).not.toContain("ask-followup-done");
  });
});

describe("the lines around the question (answer-parts.ts aroundQuestion, 10-16)", () => {
  const crisis = (t: string) => t.startsWith("995") || t.startsWith("sos");
  const warning = (t: string) => t === "doctor-warning";
  it("the crisis lines first, the question, then the rest", () => {
    expect(aroundQuestion(["doctor", "label", "995", "noted"], crisis, warning)).toEqual({ head: ["995"], tail: ["doctor", "label", "noted"] });
    expect(aroundQuestion(["995-safety", "sos", "here"], crisis, warning)).toEqual({ head: ["995-safety", "sos"], tail: ["here"] });
  });
  it("his doctor's warning line came before the 995 sentence (the owner's 10-14 order): everything up to it stays, only what came after goes under the question", () => {
    expect(aroundQuestion(["doctor-warning", "995", "noted"], crisis, warning)).toEqual({ head: ["doctor-warning", "995"], tail: ["noted"] });
    expect(aroundQuestion(["kept", "doctor-warning", "995"], crisis, warning)).toEqual({ head: ["kept", "doctor-warning", "995"], tail: [] });
  });
  it("no crisis line: the question first", () => {
    expect(aroundQuestion(["noted", "doctor-warning"], crisis, warning)).toEqual({ head: [], tail: ["noted", "doctor-warning"] });
  });
});

describe("multi-select: 「都没有」 stands alone, 「不确定」 goes with anything (10-16)", () => {
  it("ticking 「都没有」 clears the signs; ticking a sign clears 「都没有」; 「不确定」 stays", () => {
    expect(toggleOption([], "sweat")).toEqual(["sweat"]);
    expect(toggleOption(["sweat", "breath"], "none")).toEqual(["none"]);
    expect(toggleOption(["sweat", "unsure"], "none")).toEqual(["unsure", "none"]);
    expect(toggleOption(["none"], "sweat")).toEqual(["sweat"]);
    expect(toggleOption(["none", "unsure"], "breath")).toEqual(["unsure", "breath"]);
    expect(toggleOption(["none"], "unsure")).toEqual(["none", "unsure"]);
    expect(toggleOption(["sweat"], "unsure")).toEqual(["sweat", "unsure"]);
    expect(toggleOption(["sweat", "unsure"], "sweat")).toEqual(["unsure"]);
    expect(toggleOption(["none"], "none")).toEqual([]);
  });
});

describe("where the screen goes when an answer with a question arrives (10-16)", () => {
  const view = 750;
  it("the whole question shows from the top: the top", () => {
    expect(followUpScroll({ view, anchor: { top: 300 }, question: { top: 400, firstBottom: 560, bottom: 700 } })).toEqual({ scrollTo: 0, chip: false });
  });
  it("the 995 line and the whole question fit together: down until the last button shows, the 995 line still in view", () => {
    const r = followUpScroll({ view, anchor: { top: 320 }, question: { top: 650, firstBottom: 820, bottom: 1040 } });
    expect(r).toEqual({ scrollTo: 1040 + 12 - view, chip: false });
    expect(r.scrollTo).toBeLessThanOrEqual(320);
  });
  it("the 995 line and the question with its first answer fit: the 995 line at the top", () => {
    expect(followUpScroll({ view, anchor: { top: 320 }, question: { top: 700, firstBottom: 900, bottom: 1300 } })).toEqual({ scrollTo: 308, chip: false });
  });
  it("neither: the top stays (the 995 line in view) and the chip takes him to the question", () => {
    expect(followUpScroll({ view, anchor: { top: 320 }, question: { top: 1500, firstBottom: 1700, bottom: 1900 } })).toEqual({ scrollTo: 0, chip: true });
  });
  it("no 995 line: the question at the top of the view", () => {
    expect(followUpScroll({ view, anchor: null, question: { top: 900, firstBottom: 1100, bottom: 1300 } })).toEqual({ scrollTo: 888, chip: false });
  });
});

describe("what a tap sends", () => {
  it("his words are the options' words in the answer's language, in the question's order; the reply names the question and the options", () => {
    expect(followUpReply(CHEST, ["gone"], "en")).toEqual({ text: "No, it's gone", reply: { followUpId: "fu-test-chest-1", optionIds: ["gone"] } });
    expect(followUpReply(CHEST, ["yes"], "zh-Hans")).toEqual({ text: "还在痛", reply: { followUpId: "fu-test-chest-1", optionIds: ["yes"] } });
    expect(followUpReply(SIGNS, ["breath", "sweat"], "zh-Hans")).toEqual({ text: "出冷汗、喘不上气", reply: { followUpId: "fu-test-chest-3", optionIds: ["sweat", "breath"] } });
    expect(followUpReply(SIGNS, ["breath", "sweat", "x"], "en")).toEqual({ text: "Cold sweat, Short of breath", reply: { followUpId: "fu-test-chest-3", optionIds: ["sweat", "breath"] } });
    expect(followUpReply(SIGNS, [], "en")).toBeNull();
    expect(followUpReply(SIGNS, ["x"], "en")).toBeNull();
  });

  it("POST /api/ask: { text, locale, reply } for a tap, { text, locale } for a typed question (streamed and plain)", async () => {
    const sent: unknown[] = [];
    const final: AskResult = { route: "explain", sentences: [], events: [], locale: "en", blocked: [], routeReason: "test", latencyMs: 1, llm: null, followUp: SIGNS } as unknown as AskResult;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json(final);
    });
    const tap = followUpReply(CHEST, ["yes"], "en")!;
    const out = await streamAsk(tap.text, "en", () => {}, tap.reply);
    expect(sent[0]).toEqual({ text: "Yes", locale: "en", reply: { followUpId: "fu-test-chest-1", optionIds: ["yes"] } });
    // the turn says it answered that question, and carries the next one
    expect(out.ok && out.turn.reply).toEqual({ followUpId: "fu-test-chest-1", optionIds: ["yes"] });
    expect(out.ok && out.turn.answer?.followUp?.id).toBe("fu-test-chest-3");
    await sendAsk("Is it OK?", "en");
    expect(sent[1]).toEqual({ text: "Is it OK?", locale: "en" });
    expect(askBody("x", "zh-Hans")).toEqual({ text: "x", locale: "zh-Hans" });
  });

  it("the stream's followup event is kept with what has come (after the sentences); the final answer carries the question", async () => {
    const frames = [
      sseFrame("stage", { stage: "reading" }),
      sseFrame("sentence", { index: 0, sentence: { speechAct: "referral", sourceId: "tpl:emergency_995", span: "x", slots: {}, en: "Call 995 now.", origin: "template", templateId: "emergency_995" }, route: "emergency" }),
      sseFrame("followup", { followUp: CHEST }),
      sseFrame("final", { route: "emergency", sentences: [], events: [], locale: "en", blocked: [], routeReason: "rule", latencyMs: 1, llm: null, followUp: CHEST }),
    ];
    vi.stubGlobal("fetch", async () => new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } }));
    const steps: AskProgress[] = [];
    const out = await streamAsk("my chest", "en", (p) => steps.push(p));
    const withQuestion = steps.findIndex((p) => p.followUp);
    expect(withQuestion).toBeGreaterThan(0);
    expect(steps[withQuestion].sentences).toHaveLength(1);
    expect(steps[withQuestion].followUp?.id).toBe("fu-test-chest-1");
    expect(out.ok && out.turn.answer?.followUp?.id).toBe("fu-test-chest-1");
    // a draft holds the sentences, not the question
    expect(draftAnswer({ ...NO_PROGRESS, ...steps[withQuestion] }, "en").followUp).toBeUndefined();
  });
});

describe("today's turns keep the question and his reply", () => {
  it("storedAnswer keeps followUp and never the risk summary", () => {
    const r = { route: "emergency", sentences: [], events: [], locale: "en", blocked: [], routeReason: "rule", latencyMs: 1, llm: null, followUp: CHEST, risk: { level: 1, ladder: "none", rows: [], frameSource: "rules", watch: { on: false } } } as unknown as AskResult;
    const kept = storedAnswer(r);
    expect(kept.followUp).toEqual(CHEST);
    expect(kept).not.toHaveProperty("risk");
  });

  it("recordAskTurn keeps his tap on his own row; a re-read pairs it back, and the question it answered reads as answered", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const first = { route: "emergency", sentences: [], events: [{ id: "ev-1" }], locale: "en", blocked: [], routeReason: "rule", latencyMs: 1, llm: null, followUp: CHEST } as unknown as AskResult;
    const second = { route: "emergency", sentences: [], events: [{ id: "ev-2" }], locale: "en", blocked: [], routeReason: "rule", latencyMs: 1, llm: null, followUp: SIGNS } as unknown as AskResult;
    await recordAskTurn(store, s.id, { day: 29, text: "My chest feels tight", lang: "en", result: first });
    const tapped = await recordAskTurn(store, s.id, { day: 29, text: "Yes", lang: "en", result: second, reply: { followUpId: CHEST.id, optionIds: ["yes"] } });
    expect(tapped.reply).toEqual({ followUpId: CHEST.id, optionIds: ["yes"] });
    const turns = await askTurns(store, s.id, 29);
    expect(turns.map((t) => [t.text, t.answer?.followUp?.id, t.reply?.followUpId ?? null])).toEqual([
      ["My chest feels tight", CHEST.id, null],
      ["Yes", SIGNS.id, CHEST.id],
    ]);
    const replies = answeredFollowUps(turns);
    expect(followUpOf(turns[0].answer!, replies)).toEqual({ chosen: ["yes"] });
    const onReply = () => undefined;
    expect(followUpOf(turns[1].answer!, replies, null, onReply)).toEqual({ onReply });
    expect(followUpOf(turns[1].answer!, replies, { followUpId: SIGNS.id, optionIds: ["none"] })).toEqual({ chosen: ["none"], pending: true });
    expect(followUpOf({}, replies)).toBeUndefined();
  });

  it("the risk screen reads the kept question back as part of Ripple's turn (pipeline.ts screenTurns over askTurns)", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const r = { route: "emergency", sentences: [], events: [{ id: "ev-9" }], locale: "en", blocked: [], routeReason: "rule", latencyMs: 1, llm: null, followUp: CHEST } as unknown as AskResult;
    await recordAskTurn(store, s.id, { day: 29, text: "My chest feels a bit tight", lang: "en", result: r });
    const read = screenTurns(await askTurns(store, s.id, 29), "en");
    expect(read[0]).toEqual({ role: "patient", text: "My chest feels a bit tight" });
    expect(read[1].role).toBe("ripple");
    expect(read[1].text).toContain(CHEST.en);
  });

  it("the ask screen after a refresh: the latest answer's question is his to answer, the earlier one is drawn answered with his choice marked", async () => {
    const a = await answerTo("My chest hurts and I can't breathe", "en");
    const turns: AskTurn[] = [
      { id: "t1", day: 29, at: "2026-10-16T01:00:00.000Z", text: "My chest hurts and I can't breathe", lang: "en", answer: { ...a, followUp: CHEST } },
      { id: "t2", day: 29, at: "2026-10-16T01:01:00.000Z", text: "Yes", lang: "en", answer: { ...a, followUp: SIGNS }, reply: { followUpId: CHEST.id, optionIds: ["yes"] } },
    ];
    const out = html(createElement(AskSection, { locale: "en", mode: "screen", initialTurns: turns }));
    const states = [...out.matchAll(/data-testid="ask-followup" data-followup="([^"]+)"[^>]*data-state="([a-z]+)"/g)].map((m) => [m[1], m[2]]);
    expect(states).toEqual([
      [SIGNS.id, "open"],
      [CHEST.id, "answered"],
    ]);
    const earlier = out.slice(out.indexOf('data-testid="ask-earlier"'));
    const chosen = options(questionOf(earlier)).filter(([, v]) => v === "on").map(([id]) => id);
    expect(chosen).toEqual(["yes"]);
  });
});
