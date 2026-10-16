/**
 * What every account page needs from the day's clock (C2 track B, second round; real-app 2.7 「新加坡 0 点，开着的页面自己
 * 换到新的一天」, 6.3, 6.5 「账号上按 useClock() 和格子弹出」). Server-only. app/p/layout.tsx reads it once per render and
 * hands it to components/daily/elder/DayClock.tsx (keeps the open page on the right moment) and DueReminder.tsx (the
 * reminder that is due now, on whichever page he is).
 *
 * Deliberately light: his medicines and today's answers, nothing else (the layout renders for every page of his). The
 * blood pressure plan's own moments stay with the pages that show them (Today, /p/bp: components/daily/elder/TimeKeeper).
 *
 *   nowMs       the account's own "now" (lib/store/scope.ts scopeNow: the app's clock, plus a filming account's offset),
 *               the clock the page keeps time on: its date is `date`, whatever the phone's own clock says
 *   date        today in his zone
 *   nextAtMs    the next moment the day changes by itself, on that same clock: a slot's first or second reminder, a
 *               window's close, his midnight
 *   due         the slot that asks for him right now (its first or second reminder stretch, a cell still waiting:
 *               lib/daily/cells.ts asksNow), with her clip when he has one; null at any other time
 */
import { preferredClip } from "@/lib/family/clips";
import { isAccount, scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type { DaySlot, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { asksNow, buildDoseDay } from "./cells";
import { remindersView } from "./reminders";
import type { ReminderClipView } from "./types";

export interface DueNow {
  slot: DaySlot;
  /** which reminder this is: the first, or the second half an hour later */
  stretch: 1 | 2;
  /** HH:MM of this reminder */
  at: string;
  /** her clip (her own recording first, else the stand-in), or null when he has none */
  clip: ReminderClipView | null;
}

export interface DayClockData {
  /** changes with every read, so the page knows a fresh read from its own re-render (it measures its clock again then) */
  stamp: number;
  /** the account's own clock when this was read (a filming account's offset included) */
  nowMs: number;
  tz: string;
  /** YYYY-MM-DD, his date */
  date: string;
  nextAtMs: number;
  due: DueNow | null;
}

let reads = 0;

export async function accountDayClock(store: Store, scope: SessionRow, nowMs: number): Promise<DayClockData> {
  if (!isAccount(scope)) throw new Error("accountDayClock is for an account");
  // the scope's own "now" (track J: a filming account's clock offset): the slots' instants and his dates are on it,
  // and so is everything handed to the page
  const at = scopeNow(scope, nowMs);
  const day = scope.story_day;
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: day, toDay: day })]);
  const slots = buildDoseDay(scope, day, meds, doses, nowMs);
  const asking = slots.find(asksNow) ?? null;
  const moments = [...slots.flatMap((s) => [s.firstMs, s.secondMs, s.closeMs]), zonedTimeToUtcMs(storyDate(d0, day + 1), "00:00", tz)].filter((m) => m > at);
  let clip: ReminderClipView | null = null;
  if (asking) clip = preferredClip((await remindersView(store, scope)).clips);
  reads = (reads + 1) % 1_000_000_000;
  return {
    stamp: reads,
    nowMs: at,
    tz,
    date: storyDate(d0, day),
    nextAtMs: Math.min(...moments),
    due: asking ? { slot: asking.slot, stretch: asking.phase === "second" ? 2 : 1, at: asking.phase === "second" ? asking.schedule.second : asking.schedule.first, clip } : null,
  };
}
