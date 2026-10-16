/**
 * His answer about one item of a visit (C2 track F; real-app 2.15, 12): the review's 「是，医生说的」/「不是」/「不记得」,
 * the demo review's 对 / 不对. Pure; server and client safe.
 *
 *   right   the item is his doctor's (confirmed_by "patient"); its line becomes the clinician's, confirmed
 *   wrong   he says it is not right: flagged (slots.disputed), kept on the screen, a question for the doctor (or the
 *           pharmacist); a line with the warning line or 995 stays on the emergency path, every other one leaves the
 *           sources (slots.rejected: lib/safety never quotes it)
 *   unsure  he does not remember: the item and its line stay as they are (inferred)
 */
import type { VisitItemRow } from "@/lib/store/types";

export type ItemVerdict = "right" | "wrong" | "unsure";

/** His last answer about an item, or null while he has not answered. */
export function verdictOf(it: Pick<VisitItemRow, "confirmed_by" | "slots">): ItemVerdict | null {
  const v = it.slots?.verdict;
  if (v === "right" || v === "wrong" || v === "unsure") return v;
  if (it.confirmed_by === "patient") return "right";
  if (it.slots?.rejected === true || it.slots?.disputed === true) return "wrong";
  return null;
}

/** The warning line, or a line that sends him to 995 or A&E: "not right" keeps it on the emergency path (real-app 12). */
export function emergencyItem(it: Pick<VisitItemRow, "type" | "text">): boolean {
  return it.type === "threshold" || /\b995\b|\bA&E\b|急诊|救护车/i.test(it.text);
}

/** A change of his answer, kept in the item's slots.history. */
export interface VerdictChange {
  at: string;
  from: ItemVerdict;
  to: ItemVerdict;
}

export function verdictHistory(it: Pick<VisitItemRow, "slots">): VerdictChange[] {
  const h = it.slots?.history;
  return Array.isArray(h) ? (h.filter((x) => x && typeof x === "object") as VerdictChange[]) : [];
}
