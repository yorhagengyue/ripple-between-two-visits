/**
 * His watch data as the screens read it (journey 12). Server-only.
 *
 *   the example account   carries Mr Tan's synthetic watch (示例数据; real-app 6.17, M12 step 1): web/fixtures/watch.seed.json
 *                         laid out by story day (lib/watch/synth.ts makes the file and continues it past its last day),
 *                         from 30 days before day 0 up to today, and topped up as days pass. It is laid out when one of
 *                         his own screens first reads it (the example's other rows come from track C's seedAccount; this
 *                         part is track K's, so it is written here, once, with source "example"). Her view never writes.
 *   any other account     only what a watch sent (none yet: the commercial version reads Ripple's /v1/day/history). No
 *                         watch data: the watch section does not appear (老人端提示词 12.3: 没有手表时这一项不出现).
 *
 * Days: a day's sleep is the night that ended that morning, so today's sleep is there; steps and resting heart rate are
 * whole days, so they stop at yesterday.
 */
import seedFile from "@/fixtures/watch.seed.json";
import { publish } from "@/lib/bus";
import type { NewWatchMetric, SessionRow, Store, WatchMetricRow } from "@/lib/store/types";
import { isWatchMetric, METRIC_INFO, WATCH_METRICS, type WatchMetric } from "./metrics";
import type { Point, SeriesByMetric } from "./observe";
import { SYNTH_FROM_DAY, synthWatchDay, type SynthDay, type WatchSeed } from "./synth";

export const EXAMPLE_SOURCE = "example";

const SEED = seedFile as WatchSeed;
const SEED_BY_DAY = new Map<number, SynthDay>(SEED.days.map((d) => [d.day, d]));

/** The example's numbers for a story day: the fixture where it has the day, the generator after it. */
export function exampleWatchDay(day: number): SynthDay {
  return SEED_BY_DAY.get(day) ?? synthWatchDay(day);
}

/** The last story day a metric has a value for, given today (sleep: today; the rest: yesterday). */
export const lastDayOf = (metric: WatchMetric, today: number) => (metric === "sleep" ? today : today - 1);

type Writable = Store & { mode?: string };

/**
 * The example account's watch rows up to today, added where missing. Returns how many rows were added (0 when the
 * scope is not the example account, when nothing was missing, or when the store is her read-only view).
 */
export async function ensureExampleWatch(store: Writable, scope: SessionRow, existing?: WatchMetricRow[]): Promise<number> {
  if (scope.kind !== "account" || !scope.example_data || store.mode === "family") return 0;
  const rows = existing ?? (await store.listWatchMetrics(scope.id));
  const have = new Set(rows.map((r) => `${r.metric}:${r.day}`));
  const add: NewWatchMetric[] = [];
  for (const metric of WATCH_METRICS) {
    for (let day = SYNTH_FROM_DAY; day <= lastDayOf(metric, scope.story_day); day++) {
      if (have.has(`${metric}:${day}`)) continue;
      add.push({ day, metric, value: exampleWatchDay(day)[metric], unit: METRIC_INFO[metric].unit, source: EXAMPLE_SOURCE });
    }
  }
  if (!add.length) return 0;
  await store.addWatchMetrics(scope.id, add);
  publish(scope.id, "watch.synced", `Watch data arrived: ${add.length} readings (example data).`, { count: add.length, source: EXAMPLE_SOURCE });
  return add.length;
}

export interface WatchData {
  series: SeriesByMetric;
  /** where the numbers come from ("example" for the example account's synthetic watch) */
  source: string | null;
  /** any watch data at all */
  has: boolean;
}

/** His watch series up to today (the example's laid out first). One value per metric per day: the last one written. */
export async function watchData(store: Writable, scope: SessionRow): Promise<WatchData> {
  let rows = await store.listWatchMetrics(scope.id, { toDay: scope.story_day });
  if (await ensureExampleWatch(store, scope, rows)) rows = await store.listWatchMetrics(scope.id, { toDay: scope.story_day });
  const byMetric = new Map<WatchMetric, Map<number, number>>();
  let source: string | null = null;
  for (const r of rows) {
    if (!isWatchMetric(r.metric) || r.value === null || !Number.isFinite(r.value)) continue;
    if (r.day > lastDayOf(r.metric, scope.story_day)) continue;
    const m = byMetric.get(r.metric) ?? new Map<number, number>();
    m.set(r.day, r.value);
    byMetric.set(r.metric, m);
    source ??= r.source;
  }
  const series: SeriesByMetric = {};
  for (const [metric, m] of byMetric) series[metric] = [...m.entries()].map<Point>(([day, value]) => ({ day, value })).sort((a, b) => a.day - b.day);
  return { series, source, has: byMetric.size > 0 };
}
