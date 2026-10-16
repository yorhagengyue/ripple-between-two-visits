/**
 * When the watch has something to say (journey 12; M12 steps 2-4; e2e-chains 10). Pure and client-safe.
 *
 * His usual range is his own history: the 30 days before the stretch being looked at (at least 14 days with data), its
 * mean plus or minus 1.5 standard deviations, never narrower than a floor (resting heart rate 3 bpm, sleep half an
 * hour, steps 15 % of the mean). Ripple's own rule compares a 7-day mean with a 30-day one; "three weeks above his
 * usual range" cannot be said that way, so this app counts blocks itself (ripple-integration 4: the commercial version
 * computes it from /v1/day/history day totals):
 *
 *   resting heart rate   above his usual range, weekly means, three weeks or more in a row (the newest week first)
 *   sleep                below it, night by night, three nights or more in a row
 *   steps                below it, weekly means, two weeks or more in a row
 *
 * At most one thing at a time, in that order (M12: 每天最多一句；同一时间最多一段「异常」). The words are fixed sentences
 * (sentences.ts) that only describe: never a cause, never a medicine, never an illness, never blood pressure, never a
 * judging word.
 */
import type { WatchMetric } from "./metrics";

export interface Point {
  day: number;
  value: number;
}

export type SeriesByMetric = Partial<Record<WatchMetric, Point[]>>;

export interface UsualRange {
  low: number;
  high: number;
  mean: number;
  /** days with data it was worked out from */
  n: number;
  fromDay: number;
  toDay: number;
}

export interface WatchEpisode {
  metric: WatchMetric;
  direction: "above" | "below";
  /** weeks (7-day blocks ending on the newest day) or nights */
  unit: "week" | "night";
  /** how many in a row */
  count: number;
  /** the first day of the stretch, and the newest day with data */
  runStart: number;
  lastDay: number;
  usual: UsualRange;
  /** each block's mean, newest first (a night is a block of one) */
  recent: number[];
}

interface Spec {
  metric: WatchMetric;
  direction: "above" | "below";
  block: number;
  min: number;
  unit: "week" | "night";
  floor: (mean: number) => number;
}

export const SPECS: readonly Spec[] = [
  { metric: "rhr", direction: "above", block: 7, min: 3, unit: "week", floor: () => 3 },
  { metric: "sleep", direction: "below", block: 1, min: 3, unit: "night", floor: () => 0.5 },
  { metric: "steps", direction: "below", block: 7, min: 2, unit: "week", floor: (m) => 0.15 * m },
];

/**
 * The precision a number is shown with (whole bpm, tenths of an hour, tens of steps). Comparisons are made on the shown
 * numbers, so a week counted as above his range always shows a number above the range's top on screen.
 */
export const PRECISION: Record<WatchMetric, number> = { rhr: 1, sleep: 0.1, steps: 10 };

/** A number rounded as the screen shows it. */
export function shown(metric: WatchMetric, v: number): number {
  const p = PRECISION[metric];
  return Math.round(Math.round(v / p) * p * 10) / 10;
}

const BASELINE_DAYS = 30;
const MIN_BASELINE = 14;

function statsOf(points: Point[], fromDay: number, toDay: number): { mean: number; sd: number; n: number } | null {
  const vals = points.filter((p) => p.day >= fromDay && p.day <= toDay).map((p) => p.value);
  if (vals.length < MIN_BASELINE) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  return { mean, sd, n: vals.length };
}

/** His usual range from the 30 days ending on `toDay`, or null with too little data. */
export function usualRange(points: Point[], toDay: number, floor: (mean: number) => number): UsualRange | null {
  const fromDay = toDay - BASELINE_DAYS + 1;
  const s = statsOf(points, fromDay, toDay);
  if (!s) return null;
  const w = Math.max(1.5 * s.sd, floor(s.mean));
  return { low: s.mean - w, high: s.mean + w, mean: s.mean, n: s.n, fromDay, toDay };
}

/** Block means, newest first, while each block has at least half its days. */
function blockMeans(points: Point[], lastDay: number, block: number, max: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < max; k++) {
    const to = lastDay - k * block;
    const from = to - block + 1;
    const vals = points.filter((p) => p.day >= from && p.day <= to).map((p) => p.value);
    if (vals.length < Math.ceil(block / 2)) break;
    out.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}

function outside(metric: WatchMetric, v: number, r: UsualRange, dir: "above" | "below"): boolean {
  return dir === "above" ? shown(metric, v) > shown(metric, r.high) : shown(metric, v) < shown(metric, r.low);
}

function countRun(metric: WatchMetric, means: number[], r: UsualRange, dir: "above" | "below"): number {
  let k = 0;
  while (k < means.length && outside(metric, means[k], r, dir)) k++;
  return k;
}

/** One metric's stretch outside his usual range up to `today`, or null. */
export function episodeFor(spec: Spec, points: Point[], today: number): WatchEpisode | null {
  const sorted = points.filter((p) => p.day <= today && Number.isFinite(p.value)).sort((a, b) => a.day - b.day);
  if (!sorted.length) return null;
  const lastDay = sorted[sorted.length - 1].day;
  const maxBlocks = Math.floor(120 / spec.block);
  const means = blockMeans(sorted, lastDay, spec.block, maxBlocks);
  // first pass: his usual range from before the shortest stretch that would count (one block more kept out, so a
  // block the stretch only partly covers never sits in his usual range)
  const first = usualRange(sorted, lastDay - spec.block * (spec.min + 1), spec.floor);
  if (!first) return null;
  let count = countRun(spec.metric, means, first, spec.direction);
  if (count < spec.min) return null;
  // second pass: his usual range from the 30 days before the stretch itself (and the block before it), so the
  // stretch never shifts it
  let usual = first;
  const second = usualRange(sorted, lastDay - spec.block * (count + 1), spec.floor);
  if (second) {
    usual = second;
    count = countRun(spec.metric, means, second, spec.direction);
    if (count < spec.min) return null;
  }
  return {
    metric: spec.metric,
    direction: spec.direction,
    unit: spec.unit,
    count,
    runStart: lastDay - spec.block * count + 1,
    lastDay,
    usual,
    recent: means.slice(0, count),
  };
}

/** The one thing worth saying today, in SPECS order, or null. `skip`: metrics already answered on this stretch. */
export function observe(series: SeriesByMetric, today: number, skip: (e: WatchEpisode) => boolean = () => false): WatchEpisode | null {
  for (const spec of SPECS) {
    const e = episodeFor(spec, series[spec.metric] ?? [], today);
    if (e && !skip(e)) return e;
  }
  return null;
}

/** "rhr:above" — the key his answers are kept under. */
export const episodeKey = (e: Pick<WatchEpisode, "metric" | "direction">) => `${e.metric}:${e.direction}`;
