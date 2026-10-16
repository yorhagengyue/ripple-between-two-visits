/**
 * 「看诊记录好了」 (C2 track F; real-app 2.14: 「做完推送『看诊记录好了，回来认一认』」; 2.24 通知一览: to him, when a visit that
 * waited for its transcript is done, tapping lands on that visit's review page). Server-only.
 *
 * Follows the other notices (lib/daily/dose-run.ts, lib/daily/bp-run.ts): first the delivery is recorded, once per
 * visit (reminder_delivery: kind visit_ready, ref = the visit, slot "visit"), then the notice goes to the registered
 * sender (lib/jobs/notify.ts sendNotice: track I's web push, his own subscriptions, the lock-screen rule). His
 * settings are respected the same way: a phone gets it only when he turned reminders on for it, and nothing else
 * decides. Without a subscription the row is still the record that it was due.
 *
 *   day    the scope's day when it is sent, not the visit's: a recording may wait several days, and the tap marks a
 *          delivery of today or yesterday (POST /api/push/opened). "Once per visit" is checked on every row of the
 *          visit, whatever its day.
 *   words  lib/push/copy.ts VISIT_READY_WORDS: that a record is ready, never anything that was said
 *   never  for a demo session or a judge sandbox (they have no account and no phone to tell)
 */
import type { Locale } from "@/lib/i18n";
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import { VISIT_READY_WORDS } from "@/lib/push/copy";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow, Store, VisitRow } from "@/lib/store/types";

/** reminder_delivery kind (and the notice's kind). */
export const VISIT_READY = "visit_ready" as const;
/** the delivery's slot: a visit has no part of the day */
export const VISIT_READY_SLOT = "visit";
/** how long the push service may hold it for a phone that is off (s): a day; nothing in it goes stale sooner */
export const VISIT_READY_TTL_S = 24 * 3600;

/** Where the tap lands: that visit's review. */
export function visitReviewPath(visitId: string): string {
  return `/p/visit/${encodeURIComponent(visitId)}/review`;
}

export interface ReadyNoticeDeps {
  /** his language for the words (default 华语) */
  locale?: Locale;
  /** where notices go (default lib/jobs/notify.ts sendNotice) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
}

export interface ReadyNoticeResult {
  /** a delivery row was written now (false: not an account, or this visit was told before) */
  recorded: boolean;
  /** phones the sender reports it reached */
  sent: number;
}

/**
 * Tell him this visit's record is ready: once per visit. `store` is the store bound to his scope (a scheduled job's
 * system-mode store): the delivery row is written through it and the sender reads his medicine names through it.
 */
export async function notifyVisitReady(store: Store, scope: SessionRow, visit: Pick<VisitRow, "id">, deps: ReadyNoticeDeps = {}): Promise<ReadyNoticeResult> {
  if (!isAccount(scope) || !scope.owner_user_id) return { recorded: false, sent: 0 };
  // once per visit, whatever day the earlier row carries
  const before = await store.listDeliveries(scope.id);
  if (before.some((d) => d.kind === VISIT_READY && d.ref === visit.id)) return { recorded: false, sent: 0 };
  const { created, delivery } = await store.recordDelivery(scope.id, { kind: VISIT_READY, ref: visit.id, day: scope.story_day, slot: VISIT_READY_SLOT });
  if (!created) return { recorded: false, sent: 0 };
  const locale = deps.locale ?? "zh-Hans";
  const words = VISIT_READY_WORDS[locale];
  const notice: Notice = {
    kind: VISIT_READY,
    to: { role: "patient", userId: scope.owner_user_id },
    title: words.title,
    body: words.body,
    url: visitReviewPath(visit.id),
    tag: `visit-ready-${visit.id}`,
    ttlS: VISIT_READY_TTL_S,
    deliveryId: delivery.id,
    scopeId: scope.id,
    locale,
  };
  const { sent } = await (deps.send ?? sendNotice)(notice, store);
  return { recorded: true, sent };
}
