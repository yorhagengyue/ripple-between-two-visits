/**
 * How often a visit's recording was sent for its transcript by the server on its own (C2 track F; real-app 2.14:
 * 「服务好了，就把等着的看诊依次送去转写，每次看诊只送一次」). Pure; server and client safe.
 *
 * What the sentence forbids, as this build reads it: two submissions of one visit at the same time, and sending a
 * waiting visit again on every five-minute pass. What it does not forbid is trying again after a real failure (the
 * service took the recording and then could not make the transcript): without that a visit would stay stuck for good.
 * So lib/asr/pending.ts sends a waiting visit once per failure, at most MAX_TRANSCRIPT_SENDS times in all, and each
 * submission is written down first-come as one reminder_delivery row (kind TRANSCRIPT_TRY, ref = the visit, slot = the
 * attempt's number; the table's unique key makes an attempt impossible to count twice, across restarts too). After the
 * last failed attempt the visit keeps its recording and the review page says the text could not be made.
 */
import type { ReminderDeliveryRow } from "@/lib/store/types";

/** reminder_delivery kind of one submission (never a notification: lib/push/deliveries.ts HIS_KINDS does not list it). */
export const TRANSCRIPT_TRY = "transcript_try";

/** The server sends one visit's recording at most this many times on its own. */
export const MAX_TRANSCRIPT_SENDS = 3;

/** How many times this visit's recording was sent by the server on its own. */
export function transcriptTries(deliveries: readonly Pick<ReminderDeliveryRow, "kind" | "ref">[], visitId: string): number {
  return deliveries.filter((d) => d.kind === TRANSCRIPT_TRY && d.ref === visitId).length;
}

/** No more attempts are left for this visit. */
export function transcriptGaveUp(deliveries: readonly Pick<ReminderDeliveryRow, "kind" | "ref">[], visitId: string): boolean {
  return transcriptTries(deliveries, visitId) >= MAX_TRANSCRIPT_SENDS;
}
