/**
 * The no-reply alerts sent to her link, as she may read them (GET /api/family/alerts?link=; C2 track D). Server-only.
 *
 * Track B's familyNoReplyAlerts (lib/daily/no-reply.ts) reads each alert with the whole of its slot: every medicine by
 * name, his answer now, the reason code stored with it and the reason in his words. It has no switch logic, so his
 * switches cut it down here, by the rule her home is built by (./home.ts familyHome, ./hide.ts):
 *   no_reply_alert alone    the alert in its own form: that there was no reply and when, whether he answered since and
 *                           when. No cell is kept: never which medicine, what he answered or why
 *   dose_summary on too     the slot's medicines by name, each with his answer now as her home marks a closed window
 *                           (taken, missed, no reply) and, for a dose he did not take, the reason he gave in the words
 *                           stored with his answer (the owner's decision of 2026-10-14; ./home.ts cellReason, her home's rule)
 *   under no switch         the reason's code (dose_log.reason: "forgot", "own_words", ...)
 * Every field is copied by name: a field added to track B's alert later is not hers until it is added here.
 */
import type { FamilyNoReplyAlert } from "@/lib/daily/no-reply";
import type { DaySlot, FamilyGrantItems } from "@/lib/store/types";
import { cellReason } from "./home";

/** One medicine of an alert's slot, as she may see it while the dose switch is on. */
export interface HerAlertCell {
  medicationId: string;
  name: string;
  /**
   * his answer now. no_reply: none; the alert's window has closed, so 等一下 and an answer he took back read 「没回」
   * here as they do on her home (./home.ts cellMark)
   */
  mark: "taken" | "missed" | "no_reply";
  /** the reason he gave when he did not take it, in his words (./home-types.ts CellView.reason); null for every other mark, and when he gave none */
  reason: string | null;
  /** when he answered (ISO), for taken / missed */
  answeredAt: string | null;
}

export interface HerNoReplyAlert {
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
  /** dose_summary on: the slot's medicines and his answer now; off: none */
  cells: HerAlertCell[];
  /** he has answered every medicine of the slot since */
  answeredSince: boolean;
  /** when he did (ISO, his latest answer); null until he has answered them all */
  answeredAt: string | null;
}

/** The alerts sent to her link under his switches for it (the caller has checked no_reply_alert). */
export function herAlerts(alerts: readonly FamilyNoReplyAlert[], grants: Pick<FamilyGrantItems, "dose_summary">): HerNoReplyAlert[] {
  return alerts.map((a) => ({
    deliveryId: a.deliveryId,
    linkId: a.linkId,
    day: a.day,
    date: a.date,
    slot: a.slot,
    closes: a.closes,
    sentAt: a.sentAt,
    openedAt: a.openedAt,
    cells: grants.dose_summary
      ? a.cells.map((c) => ({
          medicationId: c.medicationId,
          name: c.name,
          mark: c.state === "taken" || c.state === "missed" ? c.state : ("no_reply" as const),
          reason: cellReason(c),
          answeredAt: c.answeredAt,
        }))
      : [],
    answeredSince: a.answeredSince,
    answeredAt: a.answeredSince
      ? (a.cells
          .map((c) => c.answeredAt)
          .filter((x): x is string => !!x)
          .sort()
          .at(-1) ?? null)
      : null,
  }));
}
