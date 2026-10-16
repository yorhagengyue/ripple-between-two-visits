/**
 * His reminders as sent and opened (C2 track I; reminder_delivery rows that track B's jobs write). Server-only.
 * What his notifications page lists and what GET /api/push answers: kind, slot, the real date, when it went, when he
 * opened it. Never an id of the space, never her alert (those rows are about her link).
 */
import { scopeD0 } from "@/lib/store/scope";
import type { ReminderDeliveryRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";

/** reminder_delivery kinds that are his own notifications (track B's DELIVERY, minus her alert). One kind per line. */
export const HIS_KINDS: ReadonlySet<string> = new Set([
  "dose_first",
  "dose_second",
  "bp_due",
  // C2 track F (own line): 「看诊记录好了」 (lib/visit/ready-notice.ts), so its tap is marked opened too
  "visit_ready",
  // C2 track I (own line): 「Wei Ling 已经接受」 (lib/push/accepted.ts)
  "family_accepted",
]);

/** Her alert (ref = her link's id): the one row in his space whose opening is hers to record. */
export const HER_KIND = "family_no_reply";

/**
 * The rows in his space whose opening is hers to record (ref = her link's id): her no-reply alert, and (owner 10-16)
 * 「爸爸跟 Ripple 说了一件可能要留意的事」 (lib/care/told.ts TOLD_KIND).
 */
export const HER_KINDS: ReadonlySet<string> = new Set([HER_KIND, "family_told"]);

/**
 * How far back a tap may still mark its notice opened (days): a notification can sit on a lock screen for days, and
 * 「Wei Ling 已经接受」 is still worth opening then.
 */
export const OPENED_LOOKBACK_DAYS = 7;

export interface SentReminder {
  kind: string;
  slot: string;
  /** YYYY-MM-DD in his zone */
  date: string;
  sent_at: string;
  opened_at: string | null;
}

/** His reminders of yesterday and today, newest first. */
export async function recentReminders(store: Store, scope: SessionRow): Promise<SentReminder[]> {
  const today = scope.story_day;
  const rows: ReminderDeliveryRow[] = await store.listDeliveries(scope.id, { fromDay: today - 1, toDay: today });
  const d0 = scopeD0(scope);
  return rows
    .filter((r) => HIS_KINDS.has(r.kind))
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
    .map((r) => ({ kind: r.kind, slot: r.slot, date: storyDate(d0, r.day), sent_at: r.sent_at, opened_at: r.opened_at }));
}
