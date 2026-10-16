/**
 * The watch screens in the timeline design (front-end line fe-12; design group 12), rendered on the server (no DOM):
 * the interface's own words keep the watch's rule (no cause, medicine, illness, blood pressure, judgement or order);
 * the chart draws his days against his own usual range and nothing else; the states the draft does not draw (too few
 * days, days without data) say so in words; and the observation's entry in its two places and three answers.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WatchSection } from "@/components/today/WatchSection";
import { allWatchWords, WATCH_WORDS } from "@/components/watch/copy";
import { WatchCard } from "@/components/watch/WatchCard";
import { hasGaps, WatchChart } from "@/components/watch/WatchChart";
import { WatchTrend } from "@/components/watch/WatchTrend";
import { WatchTrends } from "@/components/watch/WatchTrends";
import type { WatchCardData } from "@/lib/watch/today";
import type { WatchMetricView } from "@/lib/watch/view";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** The same list tests/unit/watch/watch.test.ts holds the watch's sentences to. */
const NEVER =
  /因为|导致|由于|引起|原因|\bbecause\b|caused by|due to|药|amlodipine|losartan|ibuprofen|paracetamol|medicine|tablet|血压|blood pressure|\bBP\b|mmHg|高血压|糖尿病|病|disease|illness|正常|偏高|偏低|过高|太高|危险|异常|很好|不好|\bnormal\b|\bhigh\b|\blow\b|\bgood\b|\bbad\b|danger|abnormal|你应该|你需要|建议|去看医生|\bshould\b|need to|\bmust\b/i;

/** 28 days of resting heart rate: two weeks inside his range, then two above it. */
function rhr(over: Partial<WatchMetricView> = {}): WatchMetricView {
  const days = Array.from({ length: 28 }, (_, i) => ({ day: 14 + i, value: i < 14 ? 65 + (i % 3) : 74 + (i % 3) }));
  return {
    id: "rhr",
    name: "静息心率",
    unitWords: "次/分",
    latest: { date: "2026-10-11", dateWords: "10月11日 周日", value: "76" },
    usual: { low: "63", high: "69", words: "63–69 次/分" },
    weeks: [
      { from: "2026-10-05", to: "2026-10-11", mean: "75", outside: "above" },
      { from: "2026-09-28", to: "2026-10-04", mean: "74", outside: "above" },
      { from: "2026-09-21", to: "2026-09-27", mean: "66", outside: null },
    ],
    days,
    band: { low: 63, high: 69 },
    ...over,
  };
}

const CARD: WatchCardData = {
  key: "rhr:above",
  metric: "rhr",
  sentence: "你的静息心率三周都高于你平时的范围。",
  ask: "要把这件事加进下次 check-in 的问题吗？",
  usual: "63–69 次/分",
  name: "静息心率",
  example: true,
  answered: null,
};

describe("the watch screens' own words", () => {
  it("carry no cause, medicine, illness, blood pressure, judgement or order, in either language", () => {
    const words = allWatchWords();
    expect(words.length).toBeGreaterThan(40);
    for (const line of words) expect(line, line).not.toMatch(NEVER);
  });

  it("the header is the draft's: 「手表」 over 「只和你自己平时比」", () => {
    expect(WATCH_WORDS["zh-Hans"]).toMatchObject({ title: "手表", subtitle: "只和你自己平时比", who: "手表", observation: "观察" });
    expect(WATCH_WORDS.en.title).toBe("Watch");
  });

  it("the words the first build already said are kept as they were", () => {
    const zh = WATCH_WORDS["zh-Hans"];
    expect(zh.usual("63–69 次/分")).toBe("你平时的范围：63–69 次/分");
    expect(zh.trends).toBe("看手表上的走势");
    expect(zh.latest("10月11日 周日")).toBe("最近一次 · 10月11日 周日");
    expect([zh.weeks, zh.average("75"), zh.above, zh.below]).toEqual(["每周平均", "平均 75", "在你平时的范围之上", "在你平时的范围之下"]);
    expect([zh.none, zh.example, zh.failed]).toEqual(["还没有手表的数据。", "示例数据", "没有记下，再点一次。"]);
    expect(WATCH_WORDS.en.usual("63–69 bpm")).toBe("Your usual range: 63–69 bpm");
  });
});

describe("the chart: his days against his own usual range", () => {
  it("one dot per day, the newest one marked, one unbroken line, the band with its two numbers", () => {
    const out = html(createElement(WatchChart, { m: rhr(), locale: "zh-Hans" }));
    expect(count(out, /class="rp12-dot"/g)).toBe(28);
    expect(count(out, /data-last="true"/g)).toBe(1);
    expect(count(out, /class="rp12-band"/g)).toBe(1);
    expect(out).toMatch(/data-edge="top"[^>]*>69</);
    expect(out).toMatch(/data-edge="bottom"[^>]*>63</);
    // one path, drawn in one stroke: a single "M"
    const d = /<path d="([^"]+)"/.exec(out)![1];
    expect(count(d, /M/g)).toBe(1);
    expect(count(d, /L/g)).toBe(27);
    // what the picture is, in words, for someone who cannot see it
    expect(out).toContain('aria-label="过去四周的静息心率，灰色一段是你平时的范围（63–69 次/分）"');
    // the two days the four weeks run between
    expect(out).toContain("9月14日");
    expect(out).toContain("10月11日");
  });

  it("every mark is inside the plot, and a higher value is drawn higher", () => {
    const m = rhr();
    const out = html(createElement(WatchChart, { m, locale: "zh-Hans" }));
    const dots = [...out.matchAll(/class="rp12-dot"[^>]*style="left:([\d.]+)%;top:([\d.]+)%"/g)].map((x) => ({ left: Number(x[1]), top: Number(x[2]) }));
    expect(dots).toHaveLength(28);
    for (const p of dots) {
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left).toBeLessThanOrEqual(100);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeLessThanOrEqual(100);
    }
    // left to right in time
    for (let i = 1; i < dots.length; i++) expect(dots[i].left).toBeGreaterThan(dots[i - 1].left);
    // day 27 (76) stands above day 0 (65): a smaller "top"
    expect(dots[27].top).toBeLessThan(dots[0].top);
    // the band lies between its two numbers, the upper one above the lower one
    const band = /class="rp12-band" style="top:([\d.]+)%;height:([\d.]+)%"/.exec(out)!;
    const tops = [...out.matchAll(/class="rp12-band-t"[^>]*style="top:([\d.]+)%"/g)].map((x) => Number(x[1]));
    expect(tops[0]).toBeCloseTo(Number(band[1]), 1);
    expect(tops[1]).toBeCloseTo(Number(band[1]) + Number(band[2]), 1);
  });

  it("nothing in it is coloured by what a number is: no inline colour, no fill, no red or accent", () => {
    const out = html(createElement(WatchTrend, { m: rhr(), locale: "zh-Hans" }));
    expect(out).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|color:/i);
    expect(out).not.toMatch(/urgent|accent/);
  });

  it("days without data: the line is left open there, and one sentence says so", () => {
    const m = rhr();
    const days = m.days.filter((d) => d.day < 24 || d.day > 27);
    expect(hasGaps(days)).toBe(true);
    expect(hasGaps(m.days)).toBe(false);
    const out = html(createElement(WatchTrend, { m: { ...m, days }, locale: "zh-Hans" }));
    const d = /<path d="([^"]+)"/.exec(out)![1];
    expect(count(d, /M/g)).toBe(2);
    expect(out).toContain('data-testid="watch-gaps"');
    expect(out).toContain("有几天手表没有数据，图上那几天空着。");
    expect(html(createElement(WatchTrend, { m, locale: "zh-Hans" }))).not.toContain("watch-gaps");
  });

  it("too few days to say what is usual for him: no band, no numbers of a range, one sentence instead", () => {
    const few = rhr({ usual: null, band: null, weeks: [], days: [20, 21, 22, 23, 24].map((day) => ({ day, value: 70 + (day % 2) })) });
    const out = html(createElement(WatchTrend, { m: few, locale: "zh-Hans" }));
    expect(out).toContain('data-band="false"');
    expect(out).not.toContain("rp12-band");
    expect(out).toContain('data-testid="watch-no-usual"');
    expect(out).toContain("手表的数据还不到两周，暂时比不出你平时的范围。");
    expect(out).toContain('aria-label="过去四周的静息心率"');
    // no weekly list without a full week
    expect(out).not.toContain('data-testid="watch-week"');
    // and with a single day there is no picture at all, only the number and the sentence
    const one = html(createElement(WatchTrend, { m: { ...few, days: [{ day: 24, value: 70 }] }, locale: "en" }));
    expect(one).not.toContain('data-testid="watch-chart"');
    expect(one).toContain("76");
    expect(one).toContain("The watch has less than two weeks of data");
  });

  it("the weeks: newest first, a week outside his range says so in words", () => {
    const out = html(createElement(WatchTrend, { m: rhr(), locale: "zh-Hans" }));
    expect([...out.matchAll(/data-testid="watch-week" data-outside="(\w+)"/g)].map((x) => x[1])).toEqual(["above", "above", "no"]);
    expect(out).toContain("10月5日–10月11日");
    expect(out).toContain("平均 75");
    expect(count(out, /在你平时的范围之上/g)).toBe(2);
    expect(out).not.toMatch(NEVER);
  });

  it("the two parts apart: the card alone, the weeks alone", () => {
    const card = html(createElement(WatchTrend, { m: rhr(), locale: "zh-Hans", part: "chart" }));
    expect(card).toContain('data-testid="watch-trend"');
    expect(card).not.toContain("watch-week");
    const weeks = html(createElement(WatchTrend, { m: rhr(), locale: "zh-Hans", part: "weeks", hidden: true }));
    expect(weeks).toMatch(/<div data-testid="watch-weeks" data-metric="rhr" hidden=""/);
    expect(count(weeks, /data-testid="watch-week"/g)).toBe(3);
  });
});

describe("one number at a time", () => {
  const sleep = rhr({ id: "sleep", name: "睡眠", unitWords: "小时" });
  const steps = rhr({ id: "steps", name: "步数", unitWords: "步" });

  it("three numbers: a control with three buttons, the first shown, the other two in the page but hidden", () => {
    const out = html(createElement(WatchTrends, { metrics: [rhr(), sleep, steps], locale: "zh-Hans" }));
    expect(out).toMatch(/data-testid="watch-pick" data-shown="rhr"/);
    expect([...out.matchAll(/data-seg="(\w+)" aria-pressed="(\w+)"/g)].map((x) => `${x[1]}:${x[2]}`)).toEqual(["rhr:true", "sleep:false", "steps:false"]);
    expect([...out.matchAll(/<section[^>]*data-testid="watch-trend" data-metric="(\w+)"[^>]*?( hidden="")?>/g)].map((x) => `${x[1]}${x[2] ? ":hidden" : ""}`)).toEqual(["rhr", "sleep:hidden", "steps:hidden"]);
  });

  it("it opens on the number the observation is about; what the watch says stands between the card and the weeks", () => {
    const out = html(createElement(WatchTrends, { metrics: [rhr(), sleep, steps], locale: "zh-Hans", initial: "sleep" }, createElement("p", { id: "said" }, "x")));
    expect(out).toMatch(/data-testid="watch-pick" data-shown="sleep"/);
    const at = (needle: string) => out.indexOf(needle);
    expect(at('data-testid="watch-trend"')).toBeLessThan(at('id="said"'));
    expect(at('id="said"')).toBeLessThan(at('data-testid="watch-weeks"'));
  });

  it("one number: nothing to choose, no control", () => {
    const out = html(createElement(WatchTrends, { metrics: [rhr()], locale: "zh-Hans" }));
    expect(out).not.toContain("watch-pick");
    expect(count(out, /data-testid="watch-trend"/g)).toBe(1);
  });
});

describe("the observation's entry", () => {
  it("Today's cell, asking: the head line with the way to the trends, the sentence and the question in one paragraph, his range, 要 / 不要", () => {
    const out = html(createElement(WatchSection, { locale: "zh-Hans", data: CARD }));
    expect(out).toMatch(/data-testid="today-watch"/);
    expect(out).toMatch(/data-testid="watch-card" data-key="rhr:above" data-state="asking" data-mode="today"/);
    expect(out).toMatch(/<a[^>]*href="\/p\/watch"[^>]*>看手表上的走势/);
    expect(out).toMatch(/<p class="rpu-bubble"[^>]*><span data-testid="watch-sentence">你的静息心率三周都高于你平时的范围。<\/span><span data-testid="watch-ask">要把这件事加进下次 check-in 的问题吗？<\/span><\/p>/);
    expect(out).toContain("你平时的范围：63–69 次/分");
    expect(out).toContain("示例数据");
    expect(out).toMatch(/data-testid="watch-yes"[^>]*data-variant="primary"[^>]*>要</);
    expect(out).toMatch(/data-testid="watch-no"[^>]*data-variant="secondary"[^>]*>不要</);
    // nothing is said before he taps
    expect(out).not.toContain("watch-added");
    expect(out).not.toContain("watch-declined");
  });

  it("in English the two sentences are two sentences", () => {
    const en: WatchCardData = { ...CARD, sentence: "Your resting heart rate has been above your usual range for three weeks.", ask: "Shall I add this to the questions for your next check-in?", usual: "63–69 bpm" };
    const out = html(createElement(WatchSection, { locale: "en", data: en }));
    expect(out).toContain('three weeks.</span> <span data-testid="watch-ask">Shall I add');
    expect(out).toMatch(/data-testid="watch-yes"[^>]*>Yes</);
  });

  it("Today's cell after 要: the tick, 「已在下次看诊的问题单里」 and the way to the list; the question is no longer asked", () => {
    const out = html(createElement(WatchSection, { locale: "zh-Hans", data: { ...CARD, answered: { answer: "yes", questionId: "q1" } } }));
    expect(out).toMatch(/data-state="added"/);
    expect(out).toMatch(/data-testid="watch-added"[\s\S]*data-node="ok"[\s\S]*已加入下次就诊的问题单[\s\S]*问医生[\s\S]*href="\/p\/questions"[^>]*>看问题单/);
    expect(out).toContain("你的静息心率三周都高于你平时的范围。");
    expect(out).not.toContain("watch-ask");
    expect(out).not.toContain("watch-yes");
  });

  it("Today's cell after 不要: folded to its head line and 「好，不加。」", () => {
    const out = html(createElement(WatchSection, { locale: "zh-Hans", data: { ...CARD, answered: { answer: "no", questionId: null } } }));
    expect(out).toMatch(/data-state="declined"/);
    expect(out).toMatch(/data-testid="watch-declined"[^>]*><p[^>]*>好，不加。</);
    expect(out).toMatch(/href="\/p\/watch"/);
    expect(out).not.toContain("watch-sentence");
    expect(out).not.toContain("watch-yes");
    expect(out).not.toContain("你平时的范围");
  });

  it("the watch screen: an entry on the watch's own node, 「手表 · 观察」; after 要 the tick is an entry of its own", () => {
    const asking = html(createElement(WatchCard, { card: CARD, locale: "zh-Hans", mode: "screen" }));
    expect(asking).toMatch(/class="rpu-tl-item"[^>]*data-node="wch"[^>]*data-testid="watch-card"/);
    expect(asking).toMatch(/<span class="rpu-tl-who" data-node="wch">手表<\/span><span> · 观察<\/span>/);
    expect(asking).not.toContain('href="/p/watch"');
    const added = html(createElement(WatchCard, { card: { ...CARD, answered: { answer: "yes", questionId: "q1" } }, locale: "zh-Hans", mode: "screen" }));
    expect(count(added, /class="rpu-tl-item"/g)).toBe(2);
    expect(added).toMatch(/data-node="ok"[^>]*data-testid="watch-added"[\s\S]*已加入下次就诊的问题单[\s\S]*href="\/p\/questions"/);
    const declined = html(createElement(WatchCard, { card: { ...CARD, answered: { answer: "no", questionId: null } }, locale: "zh-Hans", mode: "screen" }));
    expect(declined).toContain("你的静息心率三周都高于你平时的范围。");
    expect(declined).toMatch(/data-testid="watch-declined"[^>]*>好，不加。</);
  });

  it("no watch, or nothing to say: Today's cell renders nothing at all", () => {
    expect(html(createElement(WatchSection, { locale: "zh-Hans" }))).toBe("");
    expect(html(createElement(WatchSection, { locale: "zh-Hans", data: null }))).toBe("");
  });

  it("whatever its state, the entry's words carry no cause, medicine, illness, blood pressure or judgement", () => {
    for (const answered of [null, { answer: "yes" as const, questionId: "q1" }, { answer: "no" as const, questionId: null }]) {
      for (const mode of ["today", "screen"] as const) {
        const text = html(createElement(WatchCard, { card: { ...CARD, answered }, locale: "zh-Hans", mode })).replace(/<[^>]+>/g, " ");
        expect(text, `${mode} ${answered?.answer ?? "asking"}`).not.toMatch(NEVER);
      }
    }
  });
});
