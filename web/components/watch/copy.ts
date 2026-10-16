/**
 * The words of the watch screens that are Ripple's own interface (design group 12; web/progress/fe-12.md): the header
 * of /p/watch, the labels around the chart, the buttons' way on. Nothing here says anything about a number: which
 * sentence the watch says and when is lib/watch (sentences.ts: fixed text), and his 要 / 不要 are its ANSWER_WORDS.
 *
 * What these may say: which number, his own usual range, when. Never a cause, a medicine, an illness, blood pressure,
 * a judging word or what he should do (tests/unit/watch/fe-12-watch.test.ts scans every string here).
 *
 * A plain module (no "use client"): the server page reads it for the header, the client parts for the rest.
 */
import type { Locale } from "@/lib/i18n";

export interface WatchWords {
  /** the header of /p/watch: 「手表」 over 「只和你自己平时比」 */
  title: string;
  subtitle: string;
  /** who an entry is from, on its node: 「手表」; and what kind of entry it is on the watch screen: 「观察」 */
  who: string;
  observation: string;
  /** his usual range, under the observation: 「你平时的范围：63–69 次/分」 */
  usual: (range: string) => string;
  /** from Today's cell to the watch screen */
  trends: string;
  /** the tag on the example account's synthetic watch */
  example: string;
  /** his tap did not reach Ripple */
  failed: string;
  /** from 「已在下次看诊的问题单里」 to the list */
  seeQuestions: string;
  /** what the three segments choose between (for a screen reader) */
  pick: string;
  /** under the newest value: 「最近一次 · 10月11日 周日」 */
  latest: (date: string) => string;
  /** over the list of weeks */
  weeks: string;
  /** a week's average: 「平均 75」 */
  average: (value: string) => string;
  above: string;
  below: string;
  /** what the picture is, for a screen reader: with his usual range, and without one */
  chart: (name: string, range: string) => string;
  chartPlain: (name: string) => string;
  /** under the picture: what the grey band is */
  band: (range: string) => string;
  /** too few days to say what is usual for him (the watch needs two weeks of them) */
  noUsual: string;
  /** some days of the four weeks have no value: the line is left open there */
  gaps: string;
  /** no watch data at all */
  none: string;
  noneBody: string;
}

export const WATCH_WORDS: Record<Locale, WatchWords> = {
  "zh-Hans": {
    title: "手表",
    subtitle: "只和你自己平时比",
    who: "手表",
    observation: "观察",
    usual: (r) => `你平时的范围：${r}`,
    trends: "看手表上的走势",
    example: "示例数据",
    failed: "没有记下，再点一次。",
    seeQuestions: "看问题单",
    pick: "看哪一项",
    latest: (d) => `最近一次 · ${d}`,
    weeks: "每周平均",
    average: (v) => `平均 ${v}`,
    above: "在你平时的范围之上",
    below: "在你平时的范围之下",
    chart: (name, r) => `过去四周的${name}，灰色一段是你平时的范围（${r}）`,
    chartPlain: (name) => `过去四周的${name}`,
    band: (r) => `灰色一段是你平时的范围：${r}。`,
    noUsual: "手表的数据还不到两周，暂时比不出你平时的范围。",
    gaps: "有几天手表没有数据，图上那几天空着。",
    none: "还没有手表的数据。",
    noneBody: "连上手表以后，这里会把静息心率、睡眠、步数和你自己平时的范围放在一起。",
  },
  en: {
    title: "Watch",
    subtitle: "Only against your own usual",
    who: "Watch",
    observation: "Observation",
    usual: (r) => `Your usual range: ${r}`,
    trends: "See the trends",
    example: "Example data",
    failed: "Not saved. Tap again.",
    seeQuestions: "See the question list",
    pick: "Which number to look at",
    latest: (d) => `Latest · ${d}`,
    weeks: "Weekly averages",
    average: (v) => `average ${v}`,
    above: "above your usual range",
    below: "below your usual range",
    chart: (name, r) => `${name} over the last four weeks; the grey band is your usual range (${r})`,
    chartPlain: (name) => `${name} over the last four weeks`,
    band: (r) => `The grey band is your usual range: ${r}.`,
    noUsual: "The watch has less than two weeks of data, so there is no usual range to compare with yet.",
    gaps: "The watch has no data for some days; the chart is left open there.",
    none: "No watch data yet.",
    noneBody: "Once a watch is connected, your resting heart rate, sleep and steps show here next to your own usual range.",
  },
};

/** Every string, for the test that scans the watch's words (no cause, medicine, illness, blood pressure, judgement, order). */
export function allWatchWords(): string[] {
  const out: string[] = [];
  for (const w of Object.values(WATCH_WORDS)) {
    for (const v of Object.values(w)) if (typeof v === "string") out.push(v);
    out.push(w.usual("63–69"), w.latest("10-11"), w.average("75"), w.chart("x", "63–69"), w.chartPlain("x"), w.band("63–69"));
  }
  return out;
}
