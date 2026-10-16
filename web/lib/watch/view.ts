/**
 * The watch screen /p/watch (journey 12; M12 step 8 「/p/watch 看各项走势」; 老人端提示词 12.1). Server-only.
 *
 * For each of the three numbers: the newest value and its date, his usual range (from his own history, the same way
 * observe.ts works it out, before any stretch outside it), the last six weeks' averages (newest first, the weeks
 * outside his range marked as such, in words) and the last 28 days for the little chart. Blood pressure is never here.
 * The card on top is the same as Today's (watchToday), with today's answer if he already gave one.
 */
import { dateWords } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { scopeD0 } from "@/lib/store/scope";
import type { SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { watchData } from "./data";
import { formatValue, METRIC_INFO, WATCH_METRICS, type WatchMetric } from "./metrics";
import { episodeFor, shown, SPECS, usualRange, type Point, type UsualRange } from "./observe";
import { rangeOf, SOURCE_WORDS, usualWords } from "./sentences";
import { watchAnswers, watchToday, type WatchCardData } from "./today";

export interface WatchWeek {
  /** YYYY-MM-DD */
  from: string;
  to: string;
  /** the week's average as shown */
  mean: string;
  /** outside his usual range: "above" / "below" (described, never judged) */
  outside: "above" | "below" | null;
}

export interface WatchMetricView {
  id: WatchMetric;
  name: string;
  unitWords: string;
  latest: { date: string; dateWords: string; value: string } | null;
  usual: { low: string; high: string; words: string } | null;
  weeks: WatchWeek[];
  /** the last 28 days, oldest first, for the chart */
  days: { day: number; value: number }[];
  /** the usual range as numbers, for the chart's band */
  band: { low: number; high: number } | null;
}

export interface WatchView {
  has: boolean;
  /** the example account's synthetic watch */
  example: boolean;
  source: string | null;
  metrics: WatchMetricView[];
  /** the card (same as Today's: answered the day he answered), or null */
  card: WatchCardData | null;
  /** what he answered today, if he did (the card above then shows that answer) */
  answeredToday: { key: string; answer: "yes" | "no"; questionId: string | null } | null;
}

const WEEKS = 6;

function metricView(metric: WatchMetric, points: Point[], today: number, d0: string, locale: Locale): WatchMetricView {
  const info = METRIC_INFO[metric];
  const spec = SPECS.find((s) => s.metric === metric)!;
  const sorted = [...points].sort((a, b) => a.day - b.day);
  const last = sorted[sorted.length - 1] ?? null;
  // his usual range as the observation sees it: before a stretch outside it when there is one
  const episode = episodeFor(spec, sorted, today);
  const usual: UsualRange | null = episode?.usual ?? (last ? usualRange(sorted, last.day, spec.floor) : null);
  const weeks: WatchWeek[] = [];
  if (last) {
    for (let k = 0; k < WEEKS; k++) {
      const to = last.day - 7 * k;
      const from = to - 6;
      const vals = sorted.filter((p) => p.day >= from && p.day <= to).map((p) => p.value);
      if (vals.length < 4) break;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const s = shown(metric, mean);
      const outside = usual ? (s > shown(metric, usual.high) ? "above" : s < shown(metric, usual.low) ? "below" : null) : null;
      weeks.push({ from: storyDate(d0, from), to: storyDate(d0, to), mean: formatValue(metric, s), outside });
    }
  }
  const r = usual ? rangeOf(metric, usual) : null;
  return {
    id: metric,
    name: info.name[locale],
    unitWords: info.unitWords[locale],
    latest: last ? { date: storyDate(d0, last.day), dateWords: dateWords(locale, storyDate(d0, last.day)), value: formatValue(metric, shown(metric, last.value)) } : null,
    usual: usual && r ? { low: r.low, high: r.high, words: usualWords(metric, usual, locale) } : null,
    weeks,
    days: sorted.filter((p) => p.day > (last?.day ?? 0) - 28),
    band: usual ? { low: usual.low, high: usual.high } : null,
  };
}

export async function watchView(store: Store, scope: SessionRow, locale: Locale): Promise<WatchView> {
  const data = await watchData(store, scope);
  const d0 = scopeD0(scope);
  const metrics = data.has ? WATCH_METRICS.filter((m) => (data.series[m]?.length ?? 0) > 0).map((m) => metricView(m, data.series[m] ?? [], scope.story_day, d0, locale)) : [];
  const card = await watchToday(store, scope, locale);
  const todays = Object.entries(watchAnswers(scope)).find(([, a]) => a.day === scope.story_day);
  return {
    has: data.has,
    example: data.source === "example",
    source: data.source,
    metrics,
    card,
    answeredToday: todays ? { key: todays[0], answer: todays[1].answer, questionId: todays[1].question_id ?? null } : null,
  };
}

export const sourceWords = (view: Pick<WatchView, "example">, locale: Locale) => (view.example ? SOURCE_WORDS[locale].example : SOURCE_WORDS[locale].own);
