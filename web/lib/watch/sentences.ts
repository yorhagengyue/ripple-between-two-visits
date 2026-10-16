/**
 * The watch's fixed sentences (journey 12; 老人端提示词 12: 「过去 3 晚睡得比你平时少」 / 「你的静息心率三周都高于你平时的范围，
 * 要把这件事加进下次 check-in 的问题吗？」). Client-safe, pure. Written by hand, filled only with a count and his own numbers.
 *
 * What they may say: which number, which way against his own usual range, for how long. What they never say: a cause
 * (因为 / 导致 / 由于 / 引起 / because / caused by / due to), a medicine, an illness, blood pressure, a judging word (正常 /
 * 偏高 / 危险 / 好 / normal / high / good), or what he should do. tests/unit/watch/watch.test.ts scans every sentence.
 */
import type { Locale } from "@/lib/i18n";
import { formatValue, METRIC_INFO, type WatchMetric } from "./metrics";
import { shown, type WatchEpisode } from "./observe";

const ZH_COUNT = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
const EN_COUNT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

const zhCount = (n: number) => (n <= 10 ? ZH_COUNT[n] : String(n));
const enCount = (n: number) => (n <= 10 ? EN_COUNT[n] : String(n));

/** The observation: one plain sentence. */
export function observationSentence(e: Pick<WatchEpisode, "metric" | "direction" | "count">, locale: Locale): string {
  const n = e.count;
  if (e.metric === "rhr") {
    return locale === "zh-Hans" ? `你的静息心率${zhCount(n)}周都高于你平时的范围。` : `Your resting heart rate has been above your usual range for ${enCount(n)} weeks.`;
  }
  if (e.metric === "sleep") {
    return locale === "zh-Hans" ? `过去 ${n} 晚，你睡得比你平时少。` : `For the past ${n} nights, you slept less than you usually do.`;
  }
  return locale === "zh-Hans" ? `过去${zhCount(n)}周，你每天走的步数比你平时少。` : `For the past ${enCount(n)} weeks, you walked fewer steps a day than you usually do.`;
}

/** The question under it; 要 adds a question for the doctor, 不要 keeps only this look. */
export const ASK_SENTENCE: Record<Locale, string> = {
  "zh-Hans": "要把这件事加入下次就诊的问题单吗？",
  en: "Shall I add this to the questions for your next check-in?",
};

export const ANSWER_WORDS: Record<Locale, { yes: string; no: string }> = {
  "zh-Hans": { yes: "要", no: "不要" },
  en: { yes: "Yes", no: "No" },
};

/** After 不要: the card says so once, then goes. */
export const DECLINED_SENTENCE: Record<Locale, string> = { "zh-Hans": "好，不加。", en: "OK, not added." };

/** His usual range in words: 「64–70 次/分」. */
export function usualWords(metric: WatchMetric, usual: { low: number; high: number }, locale: Locale): string {
  const r = rangeOf(metric, usual);
  return `${r.low}–${r.high} ${METRIC_INFO[metric].unitWords[locale]}`;
}

/** The range as shown, rounded the way observe.ts compares (whole bpm, tenths of an hour, tens of steps). */
export function rangeOf(metric: WatchMetric, usual: { low: number; high: number }): { low: string; high: string } {
  return { low: formatValue(metric, shown(metric, usual.low)), high: formatValue(metric, shown(metric, usual.high)) };
}

/**
 * The question as it goes on his list (origin watch_pattern, for the doctor): what the watch showed, his usual range and
 * the newest week's (or nights') numbers, in his words. Track C's list never lets the words be edited (it is Ripple's).
 */
export function questionText(e: WatchEpisode, locale: Locale): string {
  const usual = usualWords(e.metric, e.usual, locale);
  const unit = METRIC_INFO[e.metric].unitWords[locale];
  if (e.metric === "sleep") {
    const nights = e.recent.slice(0, e.count).map((v) => formatValue("sleep", shown("sleep", v))).join(locale === "zh-Hans" ? "、" : ", ");
    return locale === "zh-Hans"
      ? `手表显示，我过去 ${e.count} 晚睡得比平时少（平时 ${usual}，这几晚 ${nights} ${unit}）。`
      : `My watch shows I slept less than usual for the past ${e.count} nights (usually ${usual}; these nights ${nights} ${unit}).`;
  }
  const last = formatValue(e.metric, shown(e.metric, e.recent[0]));
  if (e.metric === "rhr") {
    return locale === "zh-Hans"
      ? `手表显示，我的静息心率${zhCount(e.count)}周都高于我平时的范围（平时 ${usual}，最近一周平均 ${last}）。`
      : `My watch shows my resting heart rate above my usual range for ${enCount(e.count)} weeks (usually ${usual}; last week's average ${last}).`;
  }
  return locale === "zh-Hans"
    ? `手表显示，我过去${zhCount(e.count)}周每天走的步数比平时少（平时 ${usual}，最近一周平均 ${last}）。`
    : `My watch shows I walked fewer steps a day for the past ${enCount(e.count)} weeks (usually ${usual}; last week's average ${last}).`;
}

/** Where the numbers come from, under the trends: the example account's watch is example data. */
export const SOURCE_WORDS: Record<Locale, { example: string; own: string }> = {
  "zh-Hans": { example: "示例数据：陈先生（虚构人物）的合成手表数据。", own: "来自你的手表。" },
  en: { example: "Example data: synthetic watch data of Mr Tan (a fictional person).", own: "From your watch." },
};
