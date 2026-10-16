/**
 * The days and the clock of the two whole-line journeys of track G (23 blank, 24 example): real dates worked out from
 * the server's own "today" in Singapore, the developer test clock (one clock for the whole server process: set it,
 * and always clear it in journey.afterAll), and one pass of named scheduled jobs. These two are the only developer
 * tools the whole-line journeys use (real-app 8.12): a person cannot move time or wait for a job.
 */
import { expect, type APIRequestContext } from "@playwright/test";

const DAY_MS = 86_400_000;

/** Today in Singapore as YYYY-MM-DD (real time, read once at the start of a journey: its day one). */
export function sgToday(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}

/** A date n days after (or before) another, YYYY-MM-DD. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** A Singapore wall-clock moment as an ISO string with its offset ("2026-10-11", "08:45"). */
export const sgt = (date: string, hhmm: string): string => `${date}T${hhmm}:00+08:00`;

/** The same moment in UTC, as the stores write it ("2026-10-11T00:45:00.000Z"). */
export const utcOf = (date: string, hhmm: string): string => new Date(sgt(date, hhmm)).toISOString();

/** "10月11日" as the app's Chinese screens write a date. */
export const zhDay = (date: string): string => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "11 Oct" as the app's English screens write a date. */
export const enDay = (date: string): string => `${Number(date.slice(8, 10))} ${EN_MONTHS[Number(date.slice(5, 7)) - 1]}`;

const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
/** "周六" for a date. */
export function zhWeekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return ZH_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Freeze the app's developer test clock at a moment (it stands still there until the next call). */
export async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), `dev clock: ${await res.text()}`).toBe(200);
}

/** Back to real time. Call it in journey.afterAll, so a failed journey does not leave the server on a test clock. */
export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

export type JobCounts = Record<string, number>;

/**
 * One pass of the named scheduled jobs, now (POST /api/dev/tick; only these jobs run). Every one of them must have run.
 * Returns each job's counts; they cover every account on the server, so a journey checks its own account's records and
 * uses these only for "at least" and for "nothing more on a second pass".
 */
export async function tick(request: APIRequestContext, names: string[]): Promise<Record<string, JobCounts>> {
  const res = await request.post("/api/dev/tick", { data: { names } });
  expect(res.status(), `dev tick: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { reports: { job: string; outcome: string; counts: JobCounts }[] };
  const out: Record<string, JobCounts> = {};
  for (const name of names) {
    const report = body.reports.find((r) => r.job === name);
    expect(report?.outcome, `job ${name}: ${JSON.stringify(body.reports)}`).toBe("ran");
    out[name] = report!.counts;
  }
  return out;
}

/** One pass of the medicine job (reminders, settling "no reply", her alert): its counts. */
export async function tickDoses(request: APIRequestContext): Promise<JobCounts> {
  return (await tick(request, ["daily.doses"]))["daily.doses"];
}
