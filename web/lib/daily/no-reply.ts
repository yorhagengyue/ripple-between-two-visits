/**
 * "No reply after two reminders" on an account (C2 track B; real-app 2.7, 2.24): what other tracks read. Server-only.
 *
 *   settleAccountNoReply(store, scope, nowMs)    the settling itself (lib/daily/doses.ts): every tracked cell since
 *                                                tracking began whose window closed with no answer becomes unconfirmed /
 *                                                no_reply (by system). The scheduled job runs it every minute; his own
 *                                                reads may run it too (idempotent). Never on her reads.
 *   noReplyCells(store, scope, { fromDay, toDay })  the cells that are "no reply" now (read only, any store mode,
 *                                                family included): no grant logic here, her view (track D) checks his
 *                                                switch (no_reply_alert) through her link before showing anything.
 *   familyNoReplyAlerts(store, scope, linkId)    the alerts sent to one family member (reminder_delivery kind
 *                                                family_no_reply, ref = her link id, one per day and slot), each with
 *                                                his answer now: still no reply, or what he answered later and when
 *                                                (「爸爸 10:20 记了：吃了」).
 *
 * The scheduled job (lib/jobs/daily.ts) records family_no_reply once per link, day and slot, and only while his switch
 * is on; a cell settled by one of his reads is picked up by the next job run (a "no reply" row without that delivery is
 * sent then), so a read never swallows her alert. Her alert belongs to the moment the window closes (real-app 2.24
 * 「两次没回 · 关窗时」): a window that closed more than FAMILY_ALERT_FRESH_MS ago is settled in his record and never
 * announced to her, so a server that was down, or the first pass over an account's old days, never sends a burst of old
 * alerts. Nothing here names a scope id.
 */
import { medName } from "@/lib/session/today";
import { scopeD0 } from "@/lib/store/scope";
import type { DaySlot, DoseState, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { scopeSlotSchedule } from "./cells";
import { shownState } from "./dose-state";
import { isDaySlot } from "./slots";

export { settleAccountNoReply, type SettledCell } from "./doses";

/**
 * How long after a window closed her "no reply" alert may still go out (also the notice's lifetime on the push service).
 * Within it: the job's next minute, a server restart, his switch turned on that morning. Past it the cell is old: its
 * row is written, she is not told (her page still counts it in his week).
 */
export const FAMILY_ALERT_FRESH_MS = 6 * 60 * 60 * 1000;

/** reminder_delivery kinds track B writes (one row per scope, kind, ref, day, slot: never sent twice). */
export const DELIVERY = {
  /** his first reminder for a slot (ref "dose") */
  doseFirst: "dose_first",
  /** his second reminder for a slot (ref "dose") */
  doseSecond: "dose_second",
  /** her alert: two reminders, no reply (ref = her link id) */
  familyNoReply: "family_no_reply",
  /** his blood pressure reminder (ref "bp") */
  bpDue: "bp_due",
} as const;

export interface NoReplyCell {
  doseId: string;
  medicationId: string;
  /** "Amlodipine" */
  name: string;
  day: number;
  /** YYYY-MM-DD */
  date: string;
  slot: DaySlot;
  /** HH:MM the window closed */
  closes: string;
  /** when the system wrote it (ISO) */
  settledAt: string;
}

/** The cells that are "no reply" now, oldest first. Read only. */
export async function noReplyCells(store: Store, scope: SessionRow, opts: { fromDay?: number; toDay?: number } = {}): Promise<NoReplyCell[]> {
  const toDay = opts.toDay ?? scope.story_day;
  const fromDay = opts.fromDay ?? toDay - 6;
  const [doses, meds] = await Promise.all([store.listDoses(scope.id, { fromDay, toDay }), store.listMeds(scope.id)]);
  const d0 = scopeD0(scope);
  return doses
    .filter((d) => d.state === "unconfirmed" && d.reason === "no_reply")
    .map((d) => {
      const med = meds.find((m) => m.id === d.medication_id);
      return {
        doseId: d.id,
        medicationId: d.medication_id,
        name: med ? medName(med) : d.medication_id,
        day: d.day,
        date: storyDate(d0, d.day),
        slot: d.slot,
        closes: scopeSlotSchedule(scope, d.slot).closes,
        settledAt: d.created_at,
      };
    });
}

export interface FamilyAlertCell {
  medicationId: string;
  name: string;
  /** his answer now (null: none); unconfirmed with reason no_reply: still no reply */
  state: DoseState | null;
  reason: string | null;
  /** the reason in his words, as stored with his answer (dose_log.reason_text) */
  reasonText: string | null;
  /** when he answered (ISO), when he did after the alert */
  answeredAt: string | null;
}

export interface FamilyNoReplyAlert {
  deliveryId: string;
  linkId: string;
  day: number;
  date: string;
  slot: DaySlot;
  /** HH:MM the window closed */
  closes: string;
  /** when the alert went to her (ISO) */
  sentAt: string;
  openedAt: string | null;
  /** the slot's medicines and his answer now */
  cells: FamilyAlertCell[];
  /** he has answered every one of them since (taken or not taken) */
  answeredSince: boolean;
}

/** The alerts sent to her (her link), newest first, within the last `days` days (default 7). */
export async function familyNoReplyAlerts(store: Store, scope: SessionRow, linkId: string, opts: { days?: number } = {}): Promise<FamilyNoReplyAlert[]> {
  const toDay = scope.story_day;
  const fromDay = toDay - (opts.days ?? 7) + 1;
  const [deliveries, doses, meds] = await Promise.all([
    store.listDeliveries(scope.id, { fromDay, toDay }),
    store.listDoses(scope.id, { fromDay, toDay }),
    store.listMeds(scope.id),
  ]);
  const d0 = scopeD0(scope);
  const out: FamilyNoReplyAlert[] = [];
  for (const del of deliveries) {
    if (del.kind !== DELIVERY.familyNoReply || del.ref !== linkId || !isDaySlot(del.slot)) continue;
    const slot = del.slot;
    const rows = doses.filter((d) => d.day === del.day && d.slot === slot);
    const cells: FamilyAlertCell[] = rows.map((d) => {
      const med = meds.find((m) => m.id === d.medication_id);
      const state = shownState(d);
      const answered = state === "taken" || state === "missed";
      return {
        medicationId: d.medication_id,
        name: med ? medName(med) : d.medication_id,
        state,
        reason: state === null ? null : d.reason,
        reasonText: state === null ? null : (d.reason_text ?? null),
        answeredAt: answered ? d.created_at : null,
      };
    });
    out.push({
      deliveryId: del.id,
      linkId,
      day: del.day,
      date: storyDate(d0, del.day),
      slot,
      closes: scopeSlotSchedule(scope, slot).closes,
      sentAt: del.sent_at,
      openedAt: del.opened_at,
      cells,
      answeredSince: cells.length > 0 && cells.every((c) => c.state === "taken" || c.state === "missed"),
    });
  }
  return out.sort((a, b) => b.day - a.day || b.sentAt.localeCompare(a.sentAt));
}
