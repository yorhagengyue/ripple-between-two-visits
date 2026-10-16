/**
 * Mr Tan's synthetic watch (journey 12; M12 step 1; real-app 6.17 「示例资料是否带手表数据，到做 M12 时再定」: the example
 * account carries it, labelled 示例). Pure and deterministic: the same story day always gives the same numbers, so a
 * space laid out today and the same space a week later agree, and web/fixtures/watch.seed.json is exactly this
 * generator's output (tests/unit/watch/watch.test.ts checks it).
 *
 * The shape follows Ripple's elder persona (ripple-core scripts/seed_demo_elder.py, read only): a morning walk every
 * day, tai chi on the template's Tuesdays and Thursdays (story days 1 and 3 of each week: the example account rotates his
 * routine so the same story days stay tai chi days), early nights. Usual values: resting heart rate about 66, sleep about
 * 7 hours, 4,500 to 7,000 steps.
 *
 * One stretch is built in for the screen to notice (M12: 「可以埋一段『静息心率连续三周高于常态』的走势」): from story day 21
 * his resting heart rate sits about 8 above his usual, until day 49, then it comes back down over four days. On day 42
 * (the example account's today) that is three weeks above his usual range. Nothing else in the data stands out.
 *
 * This is example data for the example account only: a real account's watch data would come from his own watch
 * (Ripple's /v1/day/history), never from here.
 */
import type { WatchMetric } from "./metrics";

export interface SynthDay {
  day: number;
  /** resting heart rate, bpm (whole numbers) */
  rhr: number;
  /** hours slept the night before this day's morning (one decimal) */
  sleep: number;
  /** steps walked that day (to the nearest 10) */
  steps: number;
}

export const SYNTH_SEED = "mr-tan-watch-v1";
/** the story days web/fixtures/watch.seed.json covers */
export const SYNTH_FROM_DAY = -30;
export const SYNTH_TO_DAY = 49;
/** the built-in stretch: resting heart rate above his usual from this story day ... */
export const RISE_FROM_DAY = 21;
/** ... to this one, then four days back down */
export const RISE_TO_DAY = 49;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, one stream per (seed, day, metric). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard-normal draw (Box-Muller). */
function normal(next: () => number): number {
  const u = Math.max(next(), 1e-9);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const draw = (day: number, metric: WatchMetric) => normal(rng(hash32(`${SYNTH_SEED}:${metric}:${day}`)));

/** The template's weekday of a story day: day 0 is a Monday (fixtures/timeline.seed.json d0 2026-08-24). 0 = Mon. */
const weekday = (day: number) => ((day % 7) + 7) % 7;

/** How far above his usual the built-in stretch puts his resting heart rate on a story day (0 outside it). */
export function riseOn(day: number): number {
  if (day < RISE_FROM_DAY) return 0;
  if (day <= RISE_TO_DAY) return Math.min(8, 3 + (day - RISE_FROM_DAY) * 2.5);
  return Math.max(0, 8 - (day - RISE_TO_DAY) * 2);
}

export function synthWatchDay(day: number): SynthDay {
  const wd = weekday(day);
  const taiChi = wd === 1 || wd === 3;
  const weekend = wd === 5 || wd === 6;
  const rhr = Math.round(66 + 1.4 * draw(day, "rhr") + riseOn(day));
  const sleep = Math.round((7.05 + 0.28 * draw(day, "sleep") - (taiChi ? 0.15 : 0)) * 10) / 10;
  const steps = Math.round((5300 + 520 * draw(day, "steps") + (taiChi ? 1400 : 0) - (weekend ? 450 : 0)) / 10) * 10;
  return { day, rhr, sleep, steps };
}

export interface WatchSeed {
  meta: {
    persona: "mr-tan";
    d0: string;
    from_day: number;
    to_day: number;
    generator: string;
    note: string;
    units: Record<WatchMetric, string>;
    stretch: { metric: "rhr"; from_day: number; to_day: number; note: string };
  };
  days: SynthDay[];
}

/** web/fixtures/watch.seed.json, as this generator makes it. */
export function buildWatchSeed(): WatchSeed {
  const days: SynthDay[] = [];
  for (let d = SYNTH_FROM_DAY; d <= SYNTH_TO_DAY; d++) days.push(synthWatchDay(d));
  return {
    meta: {
      persona: "mr-tan",
      d0: "2026-08-24",
      from_day: SYNTH_FROM_DAY,
      to_day: SYNTH_TO_DAY,
      generator: "web/lib/watch/synth.ts (buildWatchSeed); regenerate with it, never by hand",
      note: "Synthetic example data for the example account only (shown as 示例数据). Story days: day 0 is the first visit.",
      units: { rhr: "bpm", sleep: "h", steps: "steps" },
      stretch: { metric: "rhr", from_day: RISE_FROM_DAY, to_day: RISE_TO_DAY, note: "resting heart rate about 8 bpm above his usual, then back down over four days" },
    },
    days,
  };
}
