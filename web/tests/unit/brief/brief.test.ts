/**
 * M7 visit brief (lib/summary/brief.ts + components/brief/BriefSheet.tsx), rendered to markup and read as text.
 *
 * Literal requirements covered here: the D41 numbers ("10 readings, average 140/85, 9 not below the doctor's 135/85 of
 * 24 Aug"; "29 of 33 doses, the 4 missed all on Tuesdays and Thursdays"), R1 word for word with its date, mirroring
 * R1's own words (not below / 不低于, never 高于 / 偏高 / high), the D37 note word for word, at most three questions
 * (refused > pattern > own), no judgement words in zh and en, red only on change-marked items (the DOM colour test
 * is e2e/m7-brief.spec.ts), and story-day gating.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BriefSheet } from "@/components/brief/BriefSheet";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import type { Locale } from "@/lib/i18n";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildBrief } from "@/lib/summary/brief";
import { allBriefStrings, bt } from "@/lib/summary/i18n";

const R1_TEXT = "At home, we want it below 135 over 85.";
const D37_NOTE = "今天在大巴窑中心走了一圈，脚踝有点肿。";
/** the task's extra list, on top of lib/safety/judgement.ts */
const EXTRA_ZH = ["正常", "偏高", "危险"];
const EXTRA_EN = ["normal", "high", "dangerous", "good"];

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

function decode(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function render(s: SessionRow, locale: Locale) {
  const store = getMemoryStore();
  await syncPatternQuestions(store, s);
  const view = await buildBrief(store, s, locale);
  const html = renderToStaticMarkup(createElement(BriefSheet, { view, locale }));
  return { view, html, text: textOf(html) };
}

/**
 * Ripple's own words: everything except quoted words (data-verbatim), a question's recorded summary (data-recorded:
 * the seeded question's wording, labelled as such, wave B) and the line that mirrors R1 (data-mirror).
 */
function ownWords(html: string): string {
  return textOf(
    html
      .replace(/<p[^>]*data-verbatim="[^"]*"[^>]*>[\s\S]*?<\/p>/g, " ")
      .replace(/<p[^>]*data-recorded="summary"[^>]*>[\s\S]*?<\/p>/g, " ")
      .replace(/<p[^>]*data-mirror="R1"[^>]*>[\s\S]*?<\/p>/g, " "),
  );
}

function mirrorText(html: string): string {
  const m = /<p[^>]*data-mirror="R1"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  return m ? textOf(m[1]) : "";
}

function extraHits(text: string): string[] {
  return [...EXTRA_ZH.filter((w) => text.includes(w)), ...EXTRA_EN.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text))];
}

describe("the brief at D41 (seed)", () => {
  it("numbers: 10 readings, average 140/85, 9 not below R1; 29 of 33 doses, the 4 missed all on Tue/Thu", async () => {
    const { view } = await render(await sessionAt(41), "zh-Hans");
    expect(view.window).toMatchObject({ fromDay: 9, toDay: 41, fromDate: "2026-09-02", toDate: "2026-10-04", lastVisit: { id: "v2", date: "2026-09-01" } });
    expect(view.bp).toMatchObject({ count: 10, unconfirmed: 0, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
    expect(view.target).toMatchObject({ text: R1_TEXT, systolic: 135, diastolic: 85, date: "2026-08-24", visitId: "v1", chip: { kind: "doctor", inferred: false } });
    expect(view.doses).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0, missedDays: [15, 17, 24, 36] });
    expect(view.doses.routine).toMatchObject({ weekdays: ["Tue", "Thu"], all: true });
    expect(view.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(view.questions.shown.length).toBeLessThanOrEqual(3);
  });

  it("华语: the page says so, mirrors R1 (不低于), quotes R1 with its date and the D37 note verbatim", async () => {
    const { html, text } = await render(await sessionAt(41), "zh-Hans");
    expect(text).toContain("上次就诊（9月1日）之后：9月2日到10月4日");
    expect(text).toContain("记了 10 次，平均 140/85");
    expect(mirrorText(html)).toBe("其中 9 次不低于医生 8月24日 说的 135/85");
    expect(text).toContain(R1_TEXT);
    expect(text).toContain("医生说");
    expect(text).toContain("2026年8月24日 · 0:49 处 · 代录音");
    expect(text).toContain("33 次中已服药 29 次");
    expect(text).toContain("未服药的 4 次都在周二、周四（打太极的早上）：9月8日、9月10日、9月17日、9月29日");
    expect(text).toContain(`「${D37_NOTE}」`);
    expect(text).toContain("本人说 · 9月30日");
    expect((html.match(/data-testid="brief-question"/g) ?? []).length).toBe(3);
  });

  it("English: the same numbers and words", async () => {
    const { html, text } = await render(await sessionAt(41), "en");
    expect(text).toContain("Since the visit on 1 Sep: 2 Sep to 4 Oct");
    expect(text).toContain("10 readings, average 140/85");
    expect(mirrorText(html)).toBe("9 of them not below the doctor's 135/85 of 24 Aug");
    expect(text).toContain(R1_TEXT);
    expect(text).toContain("Doctor said");
    expect(text).toContain("29 of 33 doses taken");
    expect(text).toContain("The 4 missed were all on Tuesdays and Thursdays (tai chi mornings): 8 Sep, 10 Sep, 17 Sep, 29 Sep");
    expect(text).toContain(`「${D37_NOTE}」`);
    expect(text).toContain("All 4 mornings I missed were tai chi days (Tue, Thu): 8 Sep, 10 Sep, 17 Sep, 29 Sep.");
  });

  it("no judgement words anywhere, in zh and en (quoted words and the R1 mirror aside); the mirror never says above or high", async () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const { html, text } = await render(await sessionAt(41), locale);
      expect(judgementHits(ownWords(html)), locale).toEqual([]);
      expect(extraHits(text), locale).toEqual([]);
      const mirror = mirrorText(html);
      expect(mirror).toMatch(locale === "en" ? /not below/ : /不低于/);
      expect(mirror).not.toMatch(/above|high|over|高于|偏高|超过/i);
      // the mirror's only comparison word is R1's own ("below" / 低于)
      expect(judgementHits(mirror).map((h) => h.word).sort()).toEqual(locale === "en" ? ["below"] : ["低于"]);
    }
  });

  it("every dictionary string is free of judgement words, except R1's mirror", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const mirror = bt(locale, "brief.bp.mirror");
      for (const s of allBriefStrings(locale)) {
        if (s === mirror) continue;
        expect(judgementHits(s), `${locale}: ${s}`).toEqual([]);
        expect(extraHits(s), `${locale}: ${s}`).toEqual([]);
      }
    }
  });

  it("the change mark is only on change-marked items: the two notes on topics new since D8, no medicine", async () => {
    const { view, html } = await render(await sessionAt(41), "zh-Hans");
    expect(view.notes.map((n) => [n.day, n.newTopic])).toEqual([
      [20, true],
      [37, true],
    ]);
    expect(view.meds.every((m) => !m.newSinceLastVisit)).toBe(true);
    expect((html.match(/data-changed="true"/g) ?? []).length).toBe(2);
    expect((html.match(/data-testid="brief-changed-tag"/g) ?? []).length).toBe(2);
    // the mark's classes (the accent rule on the item, the accent on its tag: components/brief/BriefSheet.tsx) appear
    // only on those two items and their tags; the first design's red is not drawn any more (fe-demo, 2026-10-11)
    expect((html.match(/border-l-accent|text-accent-ink/g) ?? []).length).toBe(4);
    expect(html).not.toMatch(/#B3261E/i);
  });

  it("a medicine added since the last visit is marked as a change", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(41);
    await store.upsertMed(s.id, { id: "med-new", drug_id: "ibuprofen", origin: "self_bought", status: "label_confirmed", start_day: 30, label: { text: "Ibuprofen 400 mg", drug: "ibuprofen", strength: "400 mg" } });
    const { view, html } = await render(s, "en");
    expect(view.meds.find((m) => m.id === "med-new")?.newSinceLastVisit).toBe(true);
    expect(html).toMatch(/<li[^>]*data-med="med-new"[^>]*data-changed="true"/);
  });
});

describe("story-day gating", () => {
  it("D29: nothing after D29 (7 readings, 21 doses, the D20 note only, no q-knee-2)", async () => {
    const { view, text } = await render(await sessionAt(29, "20:15"), "zh-Hans");
    expect(view.window).toMatchObject({ fromDay: 9, toDay: 29 });
    expect(view.bp).toMatchObject({ count: 7, avgSystolic: 140, avgDiastolic: 86, notBelow: 6 });
    expect(view.doses).toMatchObject({ due: 21, taken: 18, missed: 3, unconfirmed: 0 });
    expect(view.notes.map((n) => n.day)).toEqual([20]);
    expect(view.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi"]);
    expect(text).not.toContain(D37_NOTE);
    expect(text).not.toContain("膝盖止痛药还可以吃吗");
  });

  it("D8 (visit day): since D0, 13 readings and 1 not confirmed, average 144/92, all 13 not below", async () => {
    const { view, text } = await render(await sessionAt(8), "zh-Hans");
    expect(view.window.lastVisit?.id).toBe("v1");
    expect(view.bp).toMatchObject({ count: 13, unconfirmed: 1, avgSystolic: 144, avgDiastolic: 92, notBelow: 13 });
    expect(view.doses.due).toBe(0);
    expect(text).toContain("未确认：1 次");
  });

  it("D0: no previous visit and no number from the doctor yet: no comparison at all", async () => {
    const { view, html, text } = await render(await sessionAt(0), "zh-Hans");
    expect(view.window.lastVisit).toBeNull();
    expect(view.target).toBeNull();
    expect(view.bp.count).toBe(0);
    expect(mirrorText(html)).toBe("");
    expect(text).toContain("医生还没有说过数字。");
    expect(text).not.toContain("135");
  });
});
