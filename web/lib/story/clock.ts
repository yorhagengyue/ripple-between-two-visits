/**
 * Story clock: day numbers count from meta.d0 of the template timeline (Mr Tan: 2026-08-24, a Monday).
 * All date maths is done in UTC so the weekday never shifts with the machine's time zone.
 * Pure functions, safe to import from client components.
 */

export type ClockLocale = "en" | "zh-Hans";

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const DAY_MS = 86_400_000;

function parseIsoDate(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** d0 + day as "YYYY-MM-DD". */
export function storyDate(d0: string, day: number): string {
  return toIsoDate(parseIsoDate(d0) + day * DAY_MS);
}

/** Inverse of storyDate. */
export function dayOfDate(d0: string, isoDate: string): number {
  return Math.round((parseIsoDate(isoDate) - parseIsoDate(d0)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayIndex(d0: string, day: number): number {
  return new Date(parseIsoDate(d0) + day * DAY_MS).getUTCDay();
}

export function weekdayShort(d0: string, day: number, locale: ClockLocale = "en"): string {
  const i = weekdayIndex(d0, day);
  return locale === "zh-Hans" ? WEEKDAY_ZH[i] : WEEKDAY_EN[i];
}

/** "07:40" -> minutes after midnight. Throws on anything else. */
export function parseClockTime(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`Not a clock time: ${time}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Not a clock time: ${time}`);
  return h * 60 + min;
}

export function isClockTime(time: unknown): time is string {
  if (typeof time !== "string") return false;
  try {
    parseClockTime(time);
    return true;
  } catch {
    return false;
  }
}

/** "07:40" -> "7:40am" (en) or "上午7:40" (zh-Hans). Hand-rolled: Intl output varies by runtime. */
export function formatClockTime(time: string, locale: ClockLocale = "en"): string {
  const total = parseClockTime(time);
  const h = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (locale === "zh-Hans") {
    const part = h < 6 ? "凌晨" : h < 12 ? "上午" : h < 18 ? "下午" : "晚上";
    return `${part}${h12}:${mm}`;
  }
  return `${h12}:${mm}${h < 12 ? "am" : "pm"}`;
}

export interface StoryMoment {
  d0: string;
  day: number;
  /** "HH:MM"; null or omitted = no time in the label */
  time?: string | null;
  locale?: ClockLocale;
}

/**
 * The label at the top of every phone screen.
 * en:      "Day 29 · Tue 8:15pm"
 * zh-Hans: "第29天 · 周二 晚上8:15"
 */
export function storyDayLabel({ d0, day, time, locale = "en" }: StoryMoment): string {
  const wd = weekdayShort(d0, day, locale);
  const t = time ? ` ${formatClockTime(time, locale)}` : "";
  return locale === "zh-Hans" ? `第${day}天 · ${wd}${t}` : `Day ${day} · ${wd}${t}`;
}
