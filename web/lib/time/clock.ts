/**
 * "Today" for a scope (docs/plan/real-app.md 3.3; C2 architecture review: 今天是哪天). Pure; client-safe.
 *
 *   account         day = (the local date in the scope's time zone, Asia/Singapore by default) - d0; time = local HH:MM
 *   filming account the same, after adding clock_offset_ms to now (the crew dialled the phone to a beat)
 *   demo            (judge sandbox, crew filming session) the stored story_day / story_time, as before
 *
 * The store fills story_day / story_time this way every time it hands out a session row (lib/store), so the many
 * readers of session.story_day never compute a date themselves. All local dates come from Intl with an explicit time
 * zone, never from the machine's own zone: a server on UTC and one in Singapore give the same day.
 */
import { dayOfDate } from "@/lib/story/clock";

export const DEFAULT_TZ = "Asia/Singapore";

export type ScopeKind = "sandbox" | "filming" | "account";

/** The columns projectScope reads (a SessionRow has them all). */
export interface ScopeClockRow {
  kind: ScopeKind;
  story_day: number | null;
  story_time: string | null;
  d0: string | null;
  tz: string | null;
  filming: boolean;
  clock_offset_ms: number | null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" (24 h) */
  time: string;
  seconds: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock date and time of an instant in a time zone. */
export function localParts(ms: number, tz: string = DEFAULT_TZ): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz || DEFAULT_TZ).formatToParts(new Date(ms))) parts[p.type] = p.value;
  // some runtimes print midnight as "24" even with h23; normalise
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    seconds: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** "YYYY-MM-DD" in the time zone. */
export function localDate(ms: number, tz: string = DEFAULT_TZ): string {
  return localParts(ms, tz).date;
}

/** "HH:MM" in the time zone. */
export function localHHMM(ms: number, tz: string = DEFAULT_TZ): string {
  return localParts(ms, tz).time;
}

/** The zone's offset from UTC at an instant, in ms (Singapore: +8 h). */
export function zoneOffsetMs(ms: number, tz: string = DEFAULT_TZ): number {
  const p = localParts(ms, tz);
  const [y, mo, d] = p.date.split("-").map(Number);
  const [h, mi] = p.time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, p.seconds);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** The instant at which the local date and time occur in the zone ("2026-10-10", "09:45" in Singapore). */
export function zonedTimeToUtcMs(date: string, hhmm: string, tz: string = DEFAULT_TZ): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) throw new Error(`Not a local date and time: ${date} ${hhmm}`);
  const wall = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  // two passes settle the offset around a change (no change in Singapore, which has no daylight saving)
  let guess = wall - zoneOffsetMs(wall, tz);
  guess = wall - zoneOffsetMs(guess, tz);
  return guess;
}

/** Is this row an account's space (its day comes from the real date)? */
export function isAccountScope(row: Pick<ScopeClockRow, "kind">): boolean {
  return row.kind === "account";
}

/** The moment the scope lives in: real now, plus the crew's offset on a filming account. */
export function scopeNowMs(row: Pick<ScopeClockRow, "kind" | "filming" | "clock_offset_ms">, nowMs: number): number {
  return row.kind === "account" && row.filming && row.clock_offset_ms ? nowMs + row.clock_offset_ms : nowMs;
}

/** An account's day number and time at this moment. */
export function accountMoment(row: Pick<ScopeClockRow, "kind" | "d0" | "tz" | "filming" | "clock_offset_ms">, nowMs: number): { day: number; time: string; date: string } {
  if (!row.d0) throw new Error("an account scope needs d0");
  const t = scopeNowMs(row, nowMs);
  const p = localParts(t, row.tz || DEFAULT_TZ);
  return { day: dayOfDate(row.d0, p.date), time: p.time, date: p.date };
}

/**
 * The row with story_day / story_time filled in: computed for an account from d0 and the moment, the stored values for
 * a demo row. Returns a new object for an account, the same object for a demo row.
 */
export function projectScope<T extends ScopeClockRow>(row: T, nowMs: number): T & { story_day: number; story_time: string | null } {
  if (row.kind !== "account") return row as T & { story_day: number; story_time: string | null };
  const m = accountMoment(row, nowMs);
  return { ...row, story_day: m.day, story_time: m.time };
}
