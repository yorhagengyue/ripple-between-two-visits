/**
 * The watch's three daily numbers (journey 12; M12; 老人端提示词 12): resting heart rate, sleep, steps. Client-safe.
 *
 * They are described against his own usual range, never judged, and blood pressure is never one of them (blood
 * pressure is only ever put next to the doctor's own number, journey 03). Nothing here names a medicine, an illness or
 * a cause.
 */
import type { Locale } from "@/lib/i18n";

export const WATCH_METRICS = ["rhr", "sleep", "steps"] as const;
export type WatchMetric = (typeof WATCH_METRICS)[number];

export const isWatchMetric = (v: unknown): v is WatchMetric => typeof v === "string" && (WATCH_METRICS as readonly string[]).includes(v);

export interface MetricInfo {
  id: WatchMetric;
  /** stored in watch_metric.unit */
  unit: string;
  name: Record<Locale, string>;
  /** the unit as the screen says it after a number */
  unitWords: Record<Locale, string>;
  /** decimals shown */
  decimals: number;
}

export const METRIC_INFO: Record<WatchMetric, MetricInfo> = {
  rhr: { id: "rhr", unit: "bpm", name: { "zh-Hans": "静息心率", en: "Resting heart rate" }, unitWords: { "zh-Hans": "次/分", en: "bpm" }, decimals: 0 },
  sleep: { id: "sleep", unit: "h", name: { "zh-Hans": "睡眠", en: "Sleep" }, unitWords: { "zh-Hans": "小时", en: "h" }, decimals: 1 },
  steps: { id: "steps", unit: "steps", name: { "zh-Hans": "步数", en: "Steps" }, unitWords: { "zh-Hans": "步", en: "steps" }, decimals: 0 },
};

/** A value as the screen shows it: 67, 7.1, 5,230. */
export function formatValue(metric: WatchMetric, value: number): string {
  const d = METRIC_INFO[metric].decimals;
  const rounded = d ? value.toFixed(d) : String(Math.round(value));
  return metric === "steps" ? Number(rounded).toLocaleString("en-US") : rounded;
}
