/**
 * The seeded refused question q-extra-tablet is not his words (10-09 wave B; M6/M7 round-3 check problem 8). Its text
 * 「读数高的时候（例如 150/95）可以多吃一粒吗？」 is the story's summary; the script has him type
 * 「今天 150/95，我能不能多吃一粒？」 on D29, and the hero ask reuses the seeded question instead of adding his. The brief
 * showed the summary with data-verbatim="question", as if he had said 「读数高」.
 *
 * Now: a refused question no ask of his created is a recorded summary (data-recorded, labelled "not his own words");
 * once he asks it himself and the ask reuses it, his own words are the question (data-verbatim) and the summary is
 * shown beside them as such. His words come from the ask's safety_event (input, addedQuestionId, askedBy).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BriefSheet } from "@/components/brief/BriefSheet";
import { askedWordsFrom, questionWords, questionsView } from "@/lib/daily/questions";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildBrief } from "@/lib/summary/brief";
import { bt } from "@/lib/summary/i18n";

const SEED_TEXT = "读数高的时候（例如 150/95）可以多吃一粒吗？";
const HIS_WORDS = "今天 150/95，我能不能多吃一粒？";

const sessionAt = (day: number, time: string | null = null): Promise<SessionRow> => getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });

async function heroAsk(s: SessionRow, role = "patient") {
  const store = getMemoryStore();
  return ask({ sessionId: s.id, text: HIS_WORDS, role, locale: "zh-Hans" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
}

/** The <p> of a brief question by id, as markup. */
function questionMarkup(html: string, id: string): string {
  const start = html.indexOf(`data-question="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const end = html.indexOf('data-testid="brief-question"', start + 1);
  return html.slice(start, end > 0 ? end : undefined);
}

describe("askedWordsFrom / questionWords", () => {
  const ev = (input: string, output: Record<string, unknown>) => ({ input, lang: "zh-Hans", output });
  it("created by an ask: his words; reused by his ask: his words, the seed text a summary; family or unknown askers do not count", () => {
    const asked = askedWordsFrom([
      ev("my own question", { addedQuestionId: "q-1", questionReused: false, askedBy: "patient" }),
      ev(HIS_WORDS, { addedQuestionId: "q-extra-tablet", questionReused: true, askedBy: "patient" }),
      ev("Wei Ling typed this", { addedQuestionId: "q-extra-tablet", questionReused: true, askedBy: "family" }),
      ev("no askedBy (an older record)", { addedQuestionId: "q-extra-tablet", questionReused: true }),
      ev("not about a question", { addedQuestionId: null }),
    ]);
    expect(asked.get("q-1")).toEqual({ created: true, reusedBy: [] });
    expect(asked.get("q-extra-tablet")).toEqual({ created: false, reusedBy: [{ text: HIS_WORDS, lang: "zh-Hans" }] });
    const seeded = { origin: "refused_question" as const, text: SEED_TEXT, lang: "zh-Hans" };
    expect(questionWords(seeded, undefined)).toEqual({ text: SEED_TEXT, lang: "zh-Hans", wording: "recorded_summary", summary: null });
    expect(questionWords(seeded, asked.get("q-extra-tablet"))).toEqual({ text: HIS_WORDS, lang: "zh-Hans", wording: "own_words", summary: { text: SEED_TEXT, lang: "zh-Hans" } });
    expect(questionWords({ origin: "own", text: "x", lang: null }, undefined).wording).toBe("own_words");
  });
});

describe("the question list and the brief", () => {
  it("before he asks (D29 morning): the seeded question is a recorded summary on /p/questions", async () => {
    const s = await sessionAt(29, "08:00");
    const view = await questionsView(getMemoryStore(), s, "zh-Hans");
    const q = view.doctor.find((x) => x.id === "q-extra-tablet")!;
    expect(q).toMatchObject({ text: SEED_TEXT, wording: "recorded_summary", summary: null });
  });

  it("after the hero ask reuses it: his own words are the question, the seed text is the recorded summary", async () => {
    const s = await sessionAt(29, "20:15");
    const res = await heroAsk(s);
    expect(res).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
    const view = await questionsView(getMemoryStore(), s, "zh-Hans");
    const q = view.doctor.find((x) => x.id === "q-extra-tablet")!;
    expect(q).toMatchObject({ text: HIS_WORDS, wording: "own_words", summary: { text: SEED_TEXT } });
  });

  it("the D41 brief without his ask: the summary is marked data-recorded, never data-verbatim", async () => {
    const s = await sessionAt(41);
    const view = await buildBrief(getMemoryStore(), s, "zh-Hans");
    const q = view.questions.shown.find((x) => x.id === "q-extra-tablet")!;
    expect(q).toMatchObject({ wording: "recorded_summary", text: SEED_TEXT });
    const html = renderToStaticMarkup(createElement(BriefSheet, { view, locale: "zh-Hans" }));
    const part = questionMarkup(html, "q-extra-tablet");
    expect(part).toContain('data-recorded="summary"');
    expect(part).not.toContain("data-verbatim");
    expect(part).toContain(bt("zh-Hans", "brief.questions.recordedSummary"));
  });

  it("the D41 brief after he asked on D29: his words verbatim, the summary beside them", async () => {
    const s = await sessionAt(29, "20:15");
    await heroAsk(s);
    const store = getMemoryStore();
    const later = await store.setStoryDay(s.id, 41);
    const view = await buildBrief(store, later, "zh-Hans");
    const q = view.questions.shown.find((x) => x.id === "q-extra-tablet")!;
    expect(q).toMatchObject({ wording: "own_words", text: HIS_WORDS, summary: { text: SEED_TEXT } });
    const html = renderToStaticMarkup(createElement(BriefSheet, { view, locale: "zh-Hans" }));
    const part = questionMarkup(html, "q-extra-tablet");
    expect(part).toMatch(/data-verbatim="question"[^>]*>今天 150\/95，我能不能多吃一粒？</);
    expect(part).toMatch(/data-recorded="summary"/);
    expect(part).toContain(SEED_TEXT);
  });

  it("the daughter asking the same thing does not put her words in his mouth", async () => {
    const s = await sessionAt(29, "20:15");
    await heroAsk(s, "family");
    const view = await questionsView(getMemoryStore(), s, "zh-Hans");
    expect(view.doctor.find((x) => x.id === "q-extra-tablet")).toMatchObject({ wording: "recorded_summary", text: SEED_TEXT });
  });
});
