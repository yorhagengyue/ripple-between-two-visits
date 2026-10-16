/**
 * How a dose row reads on Today (client-safe): an undone answer (unconfirmed, reason "undone") is no answer.
 */
import type { DoseLogRow, DoseState } from "@/lib/store/types";

export function shownState(row: Pick<DoseLogRow, "state" | "reason"> | null | undefined): DoseState | null {
  if (!row) return null;
  if (row.state === "unconfirmed" && row.reason === "undone") return null;
  return row.state;
}

/** Reason codes that are about the state, not a reason he gave (never shown as "原因"). */
export const STATE_REASONS = new Set(["later", "no_reply", "undone"]);
