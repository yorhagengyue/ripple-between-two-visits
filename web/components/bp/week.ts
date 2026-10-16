/**
 * A week of blood pressure readings, as the week view and Today's cell count it (design group 03; pure, client-safe).
 *
 * A week is Monday to Sunday of the calendar (the same week her side counts: lib/summary/window.ts thisWeek, Monday to
 * the day itself). All date maths is on the YYYY-MM-DD strings in UTC, so nothing shifts with the phone's time zone.
 * 「这周量了 N 次」 counts readings with both numbers; a reading that was due and not taken (未确认) is counted apart and
 * never drawn, never averaged (lib/summary/bp.ts).
 *
 * The facts of a week are its count, the average and the highest upper number: what was recorded, nothing more. No
 * reading is counted as above or below the doctor's number here (lib/daily/bp.ts: the blood pressure screen never
 * does; that count is the brief's, for the doctor). Nothing here judges a reading.
 */

export interface WeekReading {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  part: "morning" | "evening";
  /** local HH:MM it was recorded */
  time: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  state: "recorded" | "unconfirmed";
  /** today's: it can be changed or deleted */
  editable: boolean;
}

const DAY_MS = 86_400_000;

function parse(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
}

export function addDays(iso: string, days: number): string {
  return new Date(parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the calendar week a date is in. */
export function mondayOf(iso: string): string {
  const wd = new Date(parse(iso)).getUTCDay(); // 0 Sunday ... 6 Saturday
  return addDays(iso, -((wd + 6) % 7));
}

/** The seven dates of the week that starts on this Monday. */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Whole weeks from one Monday to another (negative: earlier). */
export function weeksBetween(fromMonday: string, toMonday: string): number {
  return Math.round((parse(toMonday) - parse(fromMonday)) / (7 * DAY_MS));
}

const isRecorded = <R extends Pick<WeekReading, "state" | "systolic" | "diastolic">>(r: R): r is R & { systolic: number; diastolic: number } =>
  r.state === "recorded" && r.systolic !== null && r.diastolic !== null;

/** Newest first: by day, the evening before the morning, then by the time it was written. */
function newestFirst(a: WeekReading, b: WeekReading): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.part !== b.part) return a.part === "evening" ? -1 : 1;
  return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
}

export interface WeekFacts {
  /** readings with both numbers */
  count: number;
  /** due and not taken (未确认) */
  unconfirmed: number;
  avgSystolic: number | null;
  avgDiastolic: number | null;
  /** the highest upper number */
  topSystolic: number | null;
}

export interface WeekView<R extends WeekReading = WeekReading> {
  monday: string;
  sunday: string;
  dates: string[];
  /** every row of the week, newest first */
  rows: R[];
  /** the recorded ones, oldest first (the chart draws them in this order) */
  recorded: (R & { systolic: number; diastolic: number })[];
  facts: WeekFacts;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** The week that starts on `monday`, from all his readings. */
export function weekView<R extends WeekReading>(readings: readonly R[], monday: string): WeekView<R> {
  const dates = weekDates(monday);
  const sunday = dates[6];
  const rows = readings.filter((r) => r.date >= monday && r.date <= sunday).sort(newestFirst);
  const recorded = rows.filter(isRecorded).reverse();
  return {
    monday,
    sunday,
    dates,
    rows,
    recorded,
    facts: {
      count: recorded.length,
      unconfirmed: rows.length - recorded.length,
      avgSystolic: avg(recorded.map((r) => r.systolic)),
      avgDiastolic: avg(recorded.map((r) => r.diastolic)),
      topSystolic: recorded.length ? Math.max(...recorded.map((r) => r.systolic)) : null,
    },
  };
}

/** The Monday of the earliest week that has a row (the current week when he has none). */
export function earliestMonday(readings: readonly Pick<WeekReading, "date">[], today: string): string {
  const first = readings.reduce<string | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  const current = mondayOf(today);
  return first && first < current ? mondayOf(first) : current;
}

/** This week's count and its days, for Today's cell: recorded readings from Monday to today, each day once. */
export function weekSoFar(readings: readonly Pick<WeekReading, "date" | "state" | "systolic" | "diastolic">[], today: string): { count: number; days: string[] } {
  const monday = mondayOf(today);
  const mine = readings.filter((r) => r.date >= monday && r.date <= today && isRecorded(r));
  return { count: mine.length, days: [...new Set(mine.map((r) => r.date))].sort() };
}

// ---------------------------------------------------------------- the chart

export interface PlotBar {
  sys: number;
  dia: number;
  part: "morning" | "evening";
}

export interface PlotDay {
  date: string;
  today: boolean;
  /** this day's readings, the morning before the evening */
  bars: PlotBar[];
}

export interface PlotModel {
  days: PlotDay[];
  low: number;
  high: number;
  /** the reading is written over each bar (one reading a day at most, and no two neighbours that would overlap) */
  labelled: boolean;
}

const BASE_LOW = 70;
const BASE_HIGH = 160;

/**
 * What the week's picture draws. The scale is 70 to 160 so weeks compare (the draft's), and grows by tens only when a
 * reading or one of the doctor's numbers would fall outside it: a bar is never cut short.
 */
export function plotModel(week: WeekView, today: string, refs: readonly number[]): PlotModel {
  const days: PlotDay[] = week.dates.map((date) => ({
    date,
    today: date === today,
    bars: week.recorded
      .filter((r) => r.date === date)
      .sort((a, b) => (a.part === b.part ? (a.time < b.time ? -1 : 1) : a.part === "morning" ? -1 : 1))
      .map((r) => ({ sys: r.systolic, dia: r.diastolic, part: r.part })),
  }));
  const values = [...week.recorded.flatMap((r) => [r.systolic, r.diastolic]), ...refs];
  const max = values.length ? Math.max(...values) : BASE_HIGH;
  const min = values.length ? Math.min(...values) : BASE_LOW;
  const high = max > BASE_HIGH - 8 ? Math.ceil((max + 8) / 10) * 10 : BASE_HIGH;
  const low = min < BASE_LOW + 4 ? Math.max(0, Math.floor((min - 4) / 10) * 10) : BASE_LOW;
  // a reading over its bar is wider than a day's column: it is written only when its neighbours leave it room
  const apart = (high - low) * 0.13;
  let labelled = days.every((d) => d.bars.length <= 1);
  for (let i = 1; labelled && i < days.length; i++) {
    const a = days[i - 1].bars[0];
    const b = days[i].bars[0];
    if (a && b && Math.abs(a.sys - b.sys) < apart) labelled = false;
  }
  return { days, low, high, labelled };
}
