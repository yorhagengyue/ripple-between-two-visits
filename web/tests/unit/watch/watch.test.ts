/**
 * Track K, journey 12 (M12; e2e-chains 10): the synthetic example watch, his usual range from his own history, the one
 * observation (never a cause, a medicine, an illness or blood pressure), 要 / 不要, and the same stretch not raised again.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import seedFile from "@/fixtures/watch.seed.json";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject";
import { advanceTestClock, setTestClock } from "@/lib/time/now";
import { ensureExampleWatch, exampleWatchDay, lastDayOf, watchData } from "@/lib/watch/data";
import { METRIC_INFO, WATCH_METRICS } from "@/lib/watch/metrics";
import { observe, type SeriesByMetric } from "@/lib/watch/observe";
import { ASK_SENTENCE, DECLINED_SENTENCE, observationSentence, questionText, SOURCE_WORDS, usualWords } from "@/lib/watch/sentences";
import { buildWatchSeed, SYNTH_FROM_DAY, synthWatchDay } from "@/lib/watch/synth";
import { answerWatch, watchToday } from "@/lib/watch/today";
import { watchView } from "@/lib/watch/view";

const store = getMemoryStore();

afterEach(() => {
  setTestClock(null);
});

async function account(space: "example" | "blank") {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `kw${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
  const scope = async () => (await own.getSession(a.scope!.id))!;
  return { a, own, scope };
}

function seriesUpTo(today: number): SeriesByMetric {
  const s: SeriesByMetric = {};
  for (const m of WATCH_METRICS) {
    s[m] = [];
    for (let d = -30; d <= lastDayOf(m, today); d++) s[m]!.push({ day: d, value: exampleWatchDay(d)[m] });
  }
  return s;
}

/** Words a watch sentence may never carry: a cause, a medicine, an illness, blood pressure, a judgement, an order. */
const NEVER =
  /因为|导致|由于|引起|原因|\bbecause\b|caused by|due to|药|amlodipine|losartan|ibuprofen|paracetamol|medicine|tablet|血压|blood pressure|\bBP\b|mmHg|高血压|糖尿病|病|disease|illness|正常|偏高|偏低|过高|太高|危险|异常|很好|不好|\bnormal\b|\bhigh\b|\blow\b|\bgood\b|\bbad\b|danger|abnormal|你应该|你需要|建议|去看医生|\bshould\b|need to|\bmust\b/i;

describe("the synthetic example watch", () => {
  it("web/fixtures/watch.seed.json is exactly the generator's output (regenerate, never hand-edit)", () => {
    expect(seedFile).toEqual(JSON.parse(JSON.stringify(buildWatchSeed())));
  });

  it("past the fixture the generator carries on, and the built-in stretch comes back down", () => {
    expect(exampleWatchDay(10)).toEqual(synthWatchDay(10));
    expect(exampleWatchDay(80)).toEqual(synthWatchDay(80));
    const usual = [0, 1, 2, 3, 4, 5, 6].map((d) => exampleWatchDay(d).rhr);
    const later = [70, 71, 72, 73, 74, 75, 76].map((d) => exampleWatchDay(d).rhr);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(later) - mean(usual))).toBeLessThan(2.5);
  });

  it("carries only resting heart rate, sleep and steps", () => {
    for (const d of buildWatchSeed().days) expect(Object.keys(d).sort()).toEqual(["day", "rhr", "sleep", "steps"]);
  });
});

describe("observe: one thing, only when a number stays outside his own usual range for a while", () => {
  it("story day 42 (the example's today): resting heart rate above his usual range for three weeks", () => {
    const e = observe(seriesUpTo(42), 42)!;
    expect(e).toMatchObject({ metric: "rhr", direction: "above", unit: "week", count: 3, lastDay: 41 });
    expect(observationSentence(e, "zh-Hans")).toBe("你的静息心率三周都高于你平时的范围。");
    expect(observationSentence(e, "en")).toBe("Your resting heart rate has been above your usual range for three weeks.");
    // his usual range comes from before the stretch, and every counted week shows above its top
    expect(usualWords("rhr", e.usual, "zh-Hans")).toBe("63–69 次/分");
    for (const m of e.recent) expect(Math.round(m)).toBeGreaterThan(69);
  });

  it("nothing before the stretch has lasted, and nothing once it has passed", () => {
    for (const day of [0, 10, 20, 30, 35]) expect(observe(seriesUpTo(day), day), `day ${day}`).toBeNull();
    for (const day of [60, 70]) expect(observe(seriesUpTo(day), day), `day ${day}`).toBeNull();
  });

  it("too little history: no usual range, nothing said", () => {
    const s: SeriesByMetric = { rhr: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39].map((day) => ({ day, value: 80 })) };
    expect(observe(s, 40)).toBeNull();
  });

  it("three short nights in a row are said; two are not", () => {
    const base = Array.from({ length: 40 }, (_, i) => ({ day: i, value: 7 + (i % 3) * 0.1 }));
    const two: SeriesByMetric = { sleep: [...base, { day: 40, value: 7 }, { day: 41, value: 5.6 }, { day: 42, value: 5.5 }] };
    expect(observe(two, 42)).toBeNull();
    const three: SeriesByMetric = { sleep: [...base, { day: 40, value: 5.4 }, { day: 41, value: 5.6 }, { day: 42, value: 5.5 }] };
    const e = observe(three, 42)!;
    expect(e).toMatchObject({ metric: "sleep", direction: "below", unit: "night", count: 3 });
    expect(observationSentence(e, "zh-Hans")).toBe("过去 3 晚，你睡得比你平时少。");
  });

  it("every sentence the watch can say carries no cause, medicine, illness, blood pressure, judgement or order", () => {
    const e42 = observe(seriesUpTo(42), 42)!;
    const lines: string[] = [ASK_SENTENCE["zh-Hans"], ASK_SENTENCE.en, DECLINED_SENTENCE["zh-Hans"], DECLINED_SENTENCE.en, SOURCE_WORDS["zh-Hans"].example, SOURCE_WORDS.en.example, SOURCE_WORDS["zh-Hans"].own, SOURCE_WORDS.en.own];
    for (const metric of WATCH_METRICS) {
      for (const direction of ["above", "below"] as const) {
        for (let count = 2; count <= 6; count++) {
          for (const locale of ["zh-Hans", "en"] as const) {
            lines.push(observationSentence({ metric, direction, count }, locale));
            lines.push(questionText({ ...e42, metric, direction, count, unit: metric === "sleep" ? "night" : "week", recent: [5.5, 5.6, 5.4, 5.5, 5.6, 5.4] }, locale));
          }
        }
      }
    }
    for (const line of lines) expect(line, line).not.toMatch(NEVER);
  });
});

describe("the watch on an account", () => {
  it("a blank account has no watch data: no card, an empty screen, nothing invented", async () => {
    const { own, scope } = await account("blank");
    expect(await watchToday(own, await scope(), "zh-Hans")).toBeNull();
    const view = await watchView(own, await scope(), "zh-Hans");
    expect(view).toMatchObject({ has: false, metrics: [], card: null });
    expect(await own.listWatchMetrics((await scope()).id)).toEqual([]);
  });

  it("the example account: its watch is laid out once (示例), Today's card asks, 要 adds one question for the doctor and no visit item", async () => {
    const { own, scope } = await account("example");
    const s = await scope();
    const card = (await watchToday(own, s, "zh-Hans"))!;
    expect(card).toMatchObject({ key: "rhr:above", metric: "rhr", sentence: "你的静息心率三周都高于你平时的范围。", ask: "要把这件事加入下次就诊的问题单吗？", usual: "63–69 次/分", example: true });
    const rows = await own.listWatchMetrics(s.id);
    expect(rows.length).toBeGreaterThan(200);
    expect(new Set(rows.map((r) => r.metric))).toEqual(new Set(["rhr", "sleep", "steps"]));
    expect(rows.every((r) => r.source === "example")).toBe(true);
    // a second read adds nothing
    expect(await ensureExampleWatch(own, s)).toBe(0);
    // nothing after today: sleep up to today, the others up to yesterday
    expect(Math.max(...rows.filter((r) => r.metric === "sleep").map((r) => r.day))).toBe(s.story_day);
    expect(Math.max(...rows.filter((r) => r.metric === "steps").map((r) => r.day))).toBe(s.story_day - 1);

    const itemsBefore = (await own.listVisitItems(s.id)).length;
    const questionsBefore = (await own.listQuestions(s.id)).length;
    const r = await answerWatch(own, s, "rhr:above", "yes", "zh-Hans");
    expect(r).toMatchObject({ ok: true, answer: "yes", outcome: "created" });
    const questions = await own.listQuestions(s.id);
    expect(questions).toHaveLength(questionsBefore + 1);
    const q = questions.find((x) => x.origin === "watch_pattern")!;
    expect(q).toMatchObject({ for: "doctor", origin: "watch_pattern", status: "open" });
    expect(q.text).toBe("手表显示，我的静息心率三周都高于我平时的范围（平时 63–69 次/分，最近一周平均 75）。");
    expect(q.text).not.toMatch(NEVER);
    expect((await own.listVisitItems(s.id)).length).toBe(itemsBefore);
    // answered: the card stays for the rest of today, answered (a refresh of Today never takes it away while he reads)
    const after = await scope();
    expect(await watchToday(own, after, "zh-Hans")).toMatchObject({ key: "rhr:above", answered: { answer: "yes", questionId: q.id } });
    expect((await watchView(own, after, "zh-Hans")).answeredToday).toMatchObject({ key: "rhr:above", answer: "yes", questionId: q.id });
    expect((await watchView(own, after, "zh-Hans")).card).toMatchObject({ key: "rhr:above", answered: { answer: "yes" } });
    expect(await answerWatch(own, after, "rhr:above", "no", "zh-Hans")).toMatchObject({ ok: false, error: "nothing_to_answer" });
  });

  it("不要: nothing on the list; tomorrow the same stretch stays quiet", async () => {
    setTestClock({ at: "2026-10-10T09:00:00+08:00", frozen: true });
    const { own, scope } = await account("example");
    const s = await scope();
    expect(s.story_day).toBe(42);
    const before = (await own.listQuestions(s.id)).length;
    expect(await answerWatch(own, s, "rhr:above", "no", "en")).toMatchObject({ ok: true, answer: "no", questionId: null });
    expect((await own.listQuestions(s.id)).length).toBe(before);
    expect(await watchToday(own, await scope(), "en")).toMatchObject({ answered: { answer: "no", questionId: null } });
    advanceTestClock(86_400_000);
    const tomorrow = await scope();
    expect(tomorrow.story_day).toBe(43);
    expect(await watchToday(own, tomorrow, "en")).toBeNull();
    // a stale answer to something no longer on screen is refused
    expect(await answerWatch(own, tomorrow, "sleep:below", "yes", "en")).toMatchObject({ ok: false, error: "nothing_to_answer" });
  });

  it("her read-only view never lays the example watch out", async () => {
    const { a } = await account("example");
    const view = scopedStore(store, a.scope!, "family", { userId: randomUUID(), linkId: randomUUID(), maskSessionId: true });
    expect(await ensureExampleWatch(view, a.scope!)).toBe(0);
    expect((await watchData(view, a.scope!)).has).toBe(false);
  });
});

describe("lib/watch stays away from medicines and blood pressure", () => {
  it("no file in lib/watch reads medicines, doses or blood pressure", () => {
    const dir = path.join(process.cwd(), "lib", "watch");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/listMeds|getMed|listDoses|listBp|lib\/daily\/bp|lib\/meds|doctorNumbers|lib\/safety/);
    }
  });
});

describe("a demo session (a judge's sandbox, the crew's session)", () => {
  it("even with watch rows in it: no card, an answer is refused, nothing written to its scope row and no question added", async () => {
    const row = await store.createSession({ story_day: 45, ttl_hours: 1 });
    const demo = scopedStore(store, row, "demo");
    const s = (await demo.getSession(row.id))!;
    // the scoped store refuses a demo's scope-row write outright (a 500 on the route): the watch must never try it
    await expect(demo.updateScope(s.id, { settings: { watch_answers: {} } })).rejects.toThrow(/not for demo mode/);
    const rows = WATCH_METRICS.flatMap((metric) =>
      Array.from({ length: lastDayOf(metric, 45) - SYNTH_FROM_DAY + 1 }, (_, i) => SYNTH_FROM_DAY + i).map((day) => ({ day, metric, value: exampleWatchDay(day)[metric], unit: METRIC_INFO[metric].unit, source: "example" })),
    );
    await demo.addWatchMetrics(s.id, rows);
    const data = await watchData(demo, s);
    expect(data.has).toBe(true);
    // the same numbers on an account would raise the resting heart rate card
    expect(observe(data.series, 45, () => false)).toMatchObject({ metric: "rhr", direction: "above" });
    expect(await watchToday(demo, s, "zh-Hans")).toBeNull();
    expect(await answerWatch(demo, s, "rhr:above", "yes", "zh-Hans")).toEqual({ ok: false, status: 409, error: "nothing_to_answer" });
    expect((await watchView(demo, s, "zh-Hans")).card).toBeNull();
    expect((await demo.listQuestions(s.id)).filter((q) => q.origin === "watch_pattern")).toEqual([]);
    expect((await store.getSession(row.id))?.settings ?? {}).not.toHaveProperty("watch_answers");
  });
});
