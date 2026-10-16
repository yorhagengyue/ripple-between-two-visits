/**
 * Where the scheduled jobs' notices go (C2 track B; real-app 2.24 通知一览). Server-only.
 *
 * Track B decides WHEN something is due and records it once (reminder_delivery: one row per scope, kind, ref, day and
 * slot, so a restart or a second server never sends it twice); then it hands the notice to the sender registered here.
 * Track I's web push (lib/push) is that sender: it looks up the person's push subscriptions, sends, removes a
 * subscription the push service answers 410 for, and publishes push.sent. Until it is registered, a notice goes
 * nowhere (the delivery row is still the record that it was due).
 *
 *   registerNoticeSender(async (notice) => ({ sent: n }))   once, at module load (track I)
 *
 * The words are fixed sentences in his or her language (lib/daily/i18n.ts), never a medicine name or a dose on the lock
 * screen: 「早上的药」「还没记」, 「爸爸还没回早上的药」, 「该量血压了」.
 *
 * Track F (only add): visit_ready, 「看诊记录好了」, to him when a visit that waited for its transcript has its record
 * (lib/visit/ready-notice.ts; sent from lib/asr/pending.ts). Its words are lib/push/copy.ts VISIT_READY_WORDS: nothing
 * of what was said at the visit.
 */
import type { Store } from "@/lib/store/types";

export type NoticeKind =
  | "dose_first"
  | "dose_second"
  | "family_no_reply"
  | "bp_due"
  // C2 track F (own line): 「看诊记录好了」 to him when a waiting visit gets its record (real-app 2.14, 2.24)
  | "visit_ready"
  // C2 track I (own line): 「Wei Ling 已经接受」 to him when she accepts his invitation (real-app 2.20 step 4, 2.24)
  | "family_accepted"
  // C2 track A (only add): 「爸爸在重设密码」 to a family member he switched on as his helper (lib/auth/family-reset-notice.ts)
  | "family_reset_help"
  // owner 10-16 (only add): 「爸爸跟 Ripple 说了一件可能要留意的事」 to every family member bound to him, whatever his switches,
  // when Ripple answers his own message on the emergency route (lib/care/told.ts)
  | "family_told";

export interface Notice {
  kind: NoticeKind;
  /** who gets it: him (his own user id), or her through her care link */
  to: { role: "patient"; userId: string } | { role: "family"; userId: string; linkId: string };
  /** lock-screen words: no medicine name, no dose, no reading */
  title: string;
  body: string;
  /** where tapping it lands: /p/today?remind=dose-morning, /p/bp, /f?link=..., /p/visit/<id>/review */
  url: string;
  /** a later notice with the same tag replaces the earlier one (the second reminder replaces the first) */
  tag: string;
  /** how long the push service may hold it (s) */
  ttlS: number;
  /** the reminder_delivery row this notice is (opened_at is set on it when tapped) */
  deliveryId: string;
  /** the scope it is about (server side only: never in the payload a phone receives) */
  scopeId: string;
  locale: "zh-Hans" | "en";
}

export type NoticeSender = (notice: Notice, store: Store) => Promise<{ sent: number }>;

type GlobalWithSender = typeof globalThis & { __rippleNoticeSender?: NoticeSender | null };

/** Track I registers its web push sender here (process-wide, so every bundle of the server shares it). */
export function registerNoticeSender(sender: NoticeSender | null): void {
  (globalThis as GlobalWithSender).__rippleNoticeSender = sender;
}

/**
 * Hand a recorded notice to the sender (track I's web push, registered by lib/push/register.ts when lib/jobs loads).
 * With no sender registered (a unit test that never loads lib/jobs) nothing is sent and the answer is { sent: 0 }: the
 * delivery row already says it was due. A sender's failure never stops the job: it is logged without any content and
 * counted as not sent.
 */
export async function sendNotice(notice: Notice, store: Store): Promise<{ sent: number }> {
  const sender = (globalThis as GlobalWithSender).__rippleNoticeSender;
  if (!sender) return { sent: 0 };
  try {
    return await sender(notice, store);
  } catch (err) {
    console.warn(`[jobs] a ${notice.kind} notice could not be sent: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    return { sent: 0 };
  }
}
