/**
 * Her notice when it came from his answer to Ripple's follow-up question (the guided harness, 2026-10-16; lib/care/told.ts
 * ToldNotice.steps; components/family/ToldCard.tsx): the card on her 「留意」 and the conversation opened show his first
 * message, then each question Ripple asked and the option he tapped, in order, then Ripple's answer; in both languages; a
 * notice without steps is drawn as before.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToldCard, ToldConversation } from "@/components/family/ToldCard";
import type { ToldNotice } from "@/lib/care/told";

const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

const EN: ToldNotice = {
  id: "d1",
  at: "2026-10-16T05:00:00.000Z",
  words: "I counted my pills last night. There are enough now.",
  lang: "en",
  lines: [{ text: "If you are thinking of ending your life, please call SOS at 1767.", lang: "en" }],
  answerLang: "en",
  openedAt: null,
  steps: [{ question: "It sounds like things are very hard right now. Are you having thoughts of ending your life or hurting yourself?", answer: "I'd rather not say" }],
};
const ZH: ToldNotice = {
  ...EN,
  words: "最近觉得自己活着就是给孩子添麻烦",
  lang: "zh-Hans",
  answerLang: "zh-Hans",
  lines: [{ text: "如果你有结束生命的念头，请打 SOS 1767。", lang: "zh-Hans" }],
  steps: [{ question: "听起来你现在很难受。你有没有想过结束自己的生命，或者伤害自己？", answer: "不想说" }],
};

describe("her notice of an answer to a follow-up question", () => {
  it("the conversation opened (English): his first words, Ripple's question, his tap, then Ripple's answer, in that order", () => {
    const out = renderToStaticMarkup(createElement(ToldConversation, { notice: EN, today: "2026-10-16", tz: "Asia/Singapore", locale: "en", dad: "Dad" }));
    const t = text(out);
    const at = (s: string) => t.indexOf(s);
    expect(at("I counted my pills")).toBeGreaterThan(-1);
    expect(at("Ripple asked him")).toBeGreaterThan(at("I counted my pills"));
    expect(at("Are you having thoughts")).toBeGreaterThan(at("Ripple asked him"));
    expect(at("He tapped")).toBeGreaterThan(at("Are you having thoughts"));
    expect(at("“I'd rather not say”")).toBeGreaterThan(at("He tapped"));
    expect(at("Ripple told him")).toBeGreaterThan(at("“I'd rather not say”"));
    expect(at("SOS at 1767")).toBeGreaterThan(at("Ripple told him"));
    expect((out.match(/data-testid="told-step"/g) ?? []).length).toBe(1);
  });

  it("the card on her 「留意」 (Mandarin): the same order, in her words", () => {
    const out = renderToStaticMarkup(createElement(ToldCard, { notice: ZH, today: "2026-10-16", tz: "Asia/Singapore", locale: "zh-Hans", dad: "爸爸", href: "/f/alert/told?id=d1" }));
    const t = text(out);
    const order = ["最近觉得自己活着", "Ripple 问他", "你有没有想过结束自己的生命", "他点了", "「不想说」", "Ripple 回他的", "SOS 1767"].map((s) => t.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a notice without steps is drawn as before", () => {
    const out = renderToStaticMarkup(createElement(ToldConversation, { notice: { ...EN, steps: undefined }, today: "2026-10-16", tz: "Asia/Singapore", locale: "en", dad: "Dad" }));
    expect(out).not.toContain("told-step");
    expect(text(out)).not.toContain("Ripple asked");
  });
});
