/**
 * Dates as his screens say them (real-app 2.0: 「10月9日 周五」 / "Fri 9 Oct", never 「第 N 天」). Pure; client-safe.
 */
import type { SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";

export type DateLocale = "zh-Hans" | "en";

const ZH_WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** weekday codes as the routine stores them -> his words */
const ZH_DAY: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };

function parts(iso: string): { y: number; m: number; d: number; wd: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!x) return null;
  const [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "2026-09-06" -> 「9月6日」 / "6 Sep" */
export function shortDate(iso: string | null | undefined, locale: DateLocale): string {
  const p = iso ? parts(iso) : null;
  if (!p) return "";
  return locale === "zh-Hans" ? `${p.m}月${p.d}日` : `${p.d} ${EN_MONTH[p.m - 1]}`;
}

/** "2026-10-10" -> 「10月10日 周六」 / "Sat 10 Oct" */
export function dayLabel(iso: string, locale: DateLocale): string {
  const p = parts(iso);
  if (!p) return iso;
  return locale === "zh-Hans" ? `${p.m}月${p.d}日 ${ZH_WEEKDAY[p.wd]}` : `${EN_WEEKDAY[p.wd]} ${p.d} ${EN_MONTH[p.m - 1]}`;
}

/** "08:45" -> 「早上 8:45」 / "8:45 am" */
export function clockWords(hhmm: string, locale: DateLocale): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  if (locale === "en") return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "am" : "pm"}`;
  const part = h < 5 ? "凌晨" : h < 12 ? "早上" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上";
  const h12 = h > 12 ? h - 12 : h;
  return `${part} ${h12}:${m[2]}`;
}

/** The top line of his screens: today's real date and the time (「10月10日 周六 · 早上 9:30」). */
export function metaLine(scope: Pick<SessionRow, "d0" | "story_day" | "story_time">, locale: DateLocale): string {
  if (!scope.d0) return "";
  const date = dayLabel(storyDate(scope.d0, scope.story_day), locale);
  return scope.story_time ? `${date} · ${clockWords(scope.story_time, locale)}` : date;
}

/** 64246 -> "1:04" (where in a recording) */
export function clipAt(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** ["Tue", "Thu"] -> 「周二、周四」 / "Tue, Thu"; "daily" -> 「每天」 / "Every day" */
export function weekdaysWords(days: "daily" | string[], locale: DateLocale): string {
  if (days === "daily") return locale === "zh-Hans" ? "每天" : "Every day";
  return locale === "zh-Hans" ? days.map((d) => ZH_DAY[d] ?? d).join("、") : days.join(", ");
}

export const WEEKDAY_ZH = ZH_DAY;
