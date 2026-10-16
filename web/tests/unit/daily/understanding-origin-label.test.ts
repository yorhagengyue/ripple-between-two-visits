/**
 * A "不确定 / not sure" from the understanding checklist (M5) is his own question: on his question list (/p/questions)
 * and on the visit brief (/p/brief) its label is the same as a question he typed himself (q.origin.own), in zh and
 * en, and the brief ranks it with his own questions (refused > pattern > his own).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BriefSheet } from "@/components/brief/BriefSheet";
import { dt } from "@/lib/daily/i18n";
import { questionsView } from "@/lib/daily/questions";
import { answerUnderstanding } from "@/lib/explain/understanding";
import type { Locale } from "@/lib/i18n";
import { getMemoryStore } from "@/lib/store/memory";
import { buildBrief } from "@/lib/summary/brief";
import { BRIEF_ORIGIN_RANK } from "@/lib/summary/questions";

const LOCALES: Locale[] = ["zh-Hans", "en"];
const noPublish = () => undefined;

describe("q.origin.understanding_check reads as his own question", () => {
  it("same words as q.origin.own in zh and en", () => {
    expect(dt("zh-Hans", "q.origin.understanding_check")).toBe("自己想问的");
    expect(dt("en", "q.origin.understanding_check")).toBe("My own question");
    for (const l of LOCALES) expect(dt(l, "q.origin.understanding_check")).toBe(dt(l, "q.origin.own"));
  });

  it("the brief ranks it with his own questions", () => {
    expect(BRIEF_ORIGIN_RANK.understanding_check).toBe(BRIEF_ORIGIN_RANK.own);
  });

  for (const locale of LOCALES) {
    it(`on the question list and the brief (${locale})`, async () => {
      const store = getMemoryStore();
      const s = await store.createSession({ story_day: 9, ttl_hours: 1 });
      const out = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "unsure", locale }, { store, publish: noPublish });
      expect(out.created).toBe(true);

      // /p/questions renders q.origin.<origin> for each question (app/p/questions/page.tsx)
      const list = await questionsView(store, s, locale);
      const mine = [...list.doctor, ...list.pharmacist].filter((q) => q.origin === "understanding_check");
      expect(mine.map((q) => q.id)).toEqual([out.question!.id]);
      expect(dt(locale, `q.origin.${mine[0].origin}` as "q.origin.understanding_check")).toBe(dt(locale, "q.origin.own"));

      // /p/brief: the tag on that question is his-own-question's tag
      const view = await buildBrief(store, s, locale);
      expect(view.questions.shown.map((q) => q.origin)).toContain("understanding_check");
      const html = renderToStaticMarkup(createElement(BriefSheet, { view, locale }));
      const block = new RegExp(`data-origin="understanding_check"[^>]*>\\s*<span class="rp-tag">([^<]*)</span>`).exec(html);
      expect(block?.[1]).toBe(dt(locale, "q.origin.own"));
    });
  }
});
