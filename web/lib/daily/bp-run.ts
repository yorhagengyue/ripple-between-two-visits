/**
 * One pass of an account's blood pressure day (C2 track B; real-app 2.9, 2.24; e2e-chains 序 4). Server-only. The
 * scheduled job (lib/jobs/daily.ts daily.bp) runs it for every account scope; tests run it with an injected clock.
 *
 * Only when the doctor gave a frequency he confirmed (lib/daily/bp-schedule.ts bpPlanFor); otherwise nothing at all.
 *   remind         a part of the day the plan asks for, from its reminder time until it passes, with no reading in it
 *                  yet -> one reminder_delivery (bp_due, ref "bp") and the notice 「该量血压了」 (opens /p/bp)
 *   not measured   that part passed with no reading in it, after he started using Ripple and after the doctor's words
 *                  were in his record -> one unconfirmed reading for it (未确认, written once: reminder_delivery
 *                  bp_unconfirmed), never a judgement. Every such part since then, not only yesterday's and today's
 *                  (real-app 3.11: 只结算关窗时间晚于 tracking_since 的格子; the same rule as his medicine)
 */
import { publish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import { isAccount, scopeD0, scopeNow, scopeRoutine, scopeTz } from "@/lib/store/scope";
import type { BpReadingRow, SessionRow, Store } from "@/lib/store/types";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { localDate, zonedTimeToUtcMs } from "@/lib/time/clock";
import { accountPartOf } from "./bp-changes";
import { bpDueParts, bpPartTimes, bpPlanFor, type BpPart, type BpPlan } from "./bp-schedule";
import { dayWords } from "./doses";
import { dt } from "./i18n";
import { DELIVERY } from "./no-reply";
import type { RoutineEntry } from "./schedule";

export interface BpRunCounts {
  reminded: number;
  notMeasured: number;
  sent: number;
}

export interface BpRunDeps {
  locale?: Locale;
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
  /** the plan already read (tests) */
  plan?: BpPlan | null;
}

/**
 * A reading's part of the day on an account (real-app 2.9: morning or evening by the real clock, nothing in between;
 * lib/daily/bp-changes.ts accountPartOf). A reading from noon on is the day's evening reading, so the evening reminder
 * does not come after it.
 */
export function partOfReading(r: Pick<BpReadingRow, "slot">): BpPart {
  return accountPartOf(r);
}

export interface BpPartWindow {
  part: BpPart;
  day: number;
  date: string;
  remind: string;
  closes: string;
  remindMs: number;
  closeMs: number;
}

/** The plan's parts on a story day, with their instants in the scope's zone. */
export function bpWindows(scope: SessionRow, plan: BpPlan, day: number): BpPartWindow[] {
  const routine = scopeRoutine(scope) as RoutineEntry[];
  const date = storyDate(scopeD0(scope), day);
  const tz = scopeTz(scope);
  return bpDueParts(plan, day).map((part) => {
    const t = bpPartTimes(routine, part);
    return { part, day, date, ...t, remindMs: zonedTimeToUtcMs(date, t.remind, tz), closeMs: zonedTimeToUtcMs(date, t.closes, tz) };
  });
}

export async function runBpDay(store: Store, scope: SessionRow, nowMs: number, deps: BpRunDeps = {}): Promise<BpRunCounts> {
  const counts: BpRunCounts = { reminded: 0, notMeasured: 0, sent: 0 };
  if (!isAccount(scope) || !scope.owner_user_id) return counts;
  const plan = deps.plan !== undefined ? deps.plan : await bpPlanFor(store, scope);
  if (!plan) return counts;
  const send = deps.send ?? sendNotice;
  const locale = deps.locale ?? "zh-Hans";
  const today = scope.story_day;
  // C2 track J: the parts' instants are on the scope's own dates: compare them with its own "now" (scopeNow: a filming
  // account's clock offset, the same instant for every other account)
  const at = scopeNow(scope, nowMs);
  const since = Math.max(...[scope.tracking_since, plan.words.recordedAt].map((x) => (x ? Date.parse(x) : Number.NaN)).filter(Number.isFinite), Number.NEGATIVE_INFINITY);
  // from the day the plan could first be his (it began, he started using Ripple, the doctor's words were recorded)
  const sinceDay = Number.isFinite(since) ? dayOfDate(scopeD0(scope), localDate(since, scopeTz(scope))) : today - 1;
  const fromDay = Math.min(today, Math.max(plan.fromDay, sinceDay));
  const readings = await store.listBp(scope.id, { fromDay, toDay: today });
  const has = (day: number, part: BpPart) => readings.some((r) => r.day === day && partOfReading(r) === part);
  // the parts already written as "not measured" (one delivery row each): an old day costs one lookup
  const noted = new Set((await store.listDeliveries(scope.id, { fromDay, toDay: today })).filter((d) => d.kind === "bp_unconfirmed").map((d) => `${d.day}|${d.slot}`));

  for (let day = fromDay; day <= today; day++) {
    if (bpDueParts(plan, day).every((part) => has(day, part) || noted.has(`${day}|${part}`))) continue;
    for (const w of bpWindows(scope, plan, day)) {
      if (has(day, w.part)) continue;
      if (day === today && at >= w.remindMs && at < w.closeMs) {
        const { created, delivery } = await store.recordDelivery(scope.id, { kind: DELIVERY.bpDue, ref: "bp", day, slot: w.part });
        if (!created) continue;
        counts.reminded += 1;
        counts.sent += (
          await send(
            {
              kind: DELIVERY.bpDue,
              to: { role: "patient", userId: scope.owner_user_id },
              title: dt(locale, "notice.bp.title"),
              body: dt(locale, "notice.bp.body"),
              url: "/p/bp",
              tag: `bp-${w.date}-${w.part}`,
              ttlS: 3 * 3600,
              deliveryId: delivery.id,
              scopeId: scope.id,
              locale,
            },
            store,
          )
        ).sent;
        continue;
      }
      if (at >= w.closeMs && w.closeMs > since) {
        const { created } = await store.recordDelivery(scope.id, { kind: "bp_unconfirmed", ref: "bp", day, slot: w.part });
        if (!created) continue;
        const reading = await store.addBp(scope.id, { day, slot: w.part, state: "unconfirmed" });
        counts.notMeasured += 1;
        publish(scope.id, "bp.logged", `Blood pressure, ${dayWords(scope, day)} ${w.part}: not measured (the doctor's plan asked for it)`, { reading });
      }
    }
  }
  return counts;
}
