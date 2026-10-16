/**
 * Mr Tan's example data as an account has it, worked out from today's date alone (real-app 4.1-4.4), for the example
 * account's whole-line journey (24). Nothing here reads the app: these are the script's own expectations, written the
 * way tests/unit/story/seed-account-rules.test.ts writes them.
 *
 *   d0 = today - 42 (today is day 42 of his story; days 0-41 are in the past)
 *   the first visit is on day 0, the second on day 8 (Dr Lim's R4), he asked 「能不能多吃一粒」 on day 29
 *   the four missed mornings are days 15, 17, 24 and 36: the two tai chi weekdays, which turn with d0's weekday
 *   (the template's d0 is a Monday with tai chi on Tuesday and Thursday; k = d0's weekday - Monday, both move k days on)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { addDays, zhDay } from "./clock";

export const EXAMPLE_TODAY_DAY = 42;
export const MISSED_DAYS = [15, 17, 24, 36];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ZH_WEEKDAYS: Record<string, string> = { Sun: "周日", Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六" };

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface ExampleDates {
  today: string;
  d0: string;
  /** the date of a day of his story */
  day: (n: number) => string;
  /** the two tai chi weekdays on this d0, as the store has them ("Sun", "Tue") and as the screens write them */
  taiChi: string[];
  taiChiZh: string;
  /** the four missed mornings: their dates, and as the screens list them (「9月13日、9月15日、…」) */
  missedDates: string[];
  missedZh: string;
}

export function exampleDates(today: string): ExampleDates {
  const d0 = addDays(today, -EXAMPLE_TODAY_DAY);
  const k = (weekdayOf(d0) - 1 + 7) % 7;
  const taiChi = [WEEKDAYS[(2 + k) % 7], WEEKDAYS[(4 + k) % 7]];
  const missedDates = MISSED_DAYS.map((n) => addDays(d0, n));
  // the script's own check of its arithmetic: every missed morning falls on one of the two weekdays
  for (const date of missedDates) if (!taiChi.includes(WEEKDAYS[weekdayOf(date)])) throw new Error(`${date} is not a tai chi day of d0 ${d0}`);
  return {
    today,
    d0,
    day: (n) => addDays(d0, n),
    taiChi,
    taiChiZh: taiChi.map((w) => ZH_WEEKDAYS[w]).join("、"),
    missedDates,
    missedZh: missedDates.map(zhDay).join("、"),
  };
}

interface FixtureUtterance {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster?: number;
  text: string;
}

/** One line of the sample visit's replay file (web/fixtures/visits/v3.utterances.json), words and time point as written there. */
export function sampleLine(id: string): { id: string; text: string; start_ms: number } {
  const file = path.join(__dirname, "..", "..", "..", "fixtures", "visits", "v3.utterances.json");
  const u = (JSON.parse(readFileSync(file, "utf8")) as { utterances: FixtureUtterance[] }).utterances.find((x) => x.id === id);
  if (!u) throw new Error(`the sample visit has no line ${id}`);
  return { id: u.id, text: u.text, start_ms: u.t_start_ms };
}
