/**
 * An answer or a reading that arrives late from the phone's to-send list (C2 track O; real-app 2.25). Server-only: what
 * POST /api/doses and POST /api/bp do with `at`, the moment he tapped (lib/offline/tap.ts).
 *
 * A medicine answer overwrites its cell (药、日子、格子), so sending the same entry again changes nothing, and the list
 * is replayed in the order he tapped. Two rules keep a late answer from undoing a later one:
 *   - the cell already holds his own answer from a later moment (he answered on another phone, or the first try did
 *     reach the server and only its reply was lost): that answer stands, nothing is written;
 *   - the cell holds this very answer (the same words, written within two minutes of the tap: the same moment, or the
 *     first try's own arrival a little before or after it on the two clocks): nothing is written, no second event.
 * The system's own 「没回」 row is not his answer: the answer he gave before the window closed replaces it.
 * A reading is keyed by the uuid his phone made (app/api/bp/route.ts): a resend finds its row.
 */
import { scopeNow } from "@/lib/store/scope";
import type { DoseLogRow, DoseState, SessionRow, Store } from "@/lib/store/types";
import { tapMoment, type TapMoment, type TapRefusal } from "./tap";

export type LateRefusal = TapRefusal;

/** The tap as the server takes it, or why not. `nowMs` is the app's now (lib/time/now.ts). */
export function lateTap(scope: SessionRow, at: string, nowMs: number): TapMoment | LateRefusal {
  return tapMoment(scope, at, scopeNow(scope, nowMs));
}

export interface LateDoseInput {
  medication_id: string;
  slot: DoseLogRow["slot"];
  state: DoseState;
  reason?: string | null;
  reason_text?: string | null;
  when?: "today" | "yesterday";
}

export type LateDose =
  | { refused: LateRefusal }
  /** his own later (or identical) answer is already in the cell */
  | { stands: DoseLogRow }
  /** write it: the cell's day and the tap's instant */
  | { day: number; at: string };

/** How far apart the phone's moment and the server's stamp of the same tap can be and still be that tap. */
const SAME_TAP_MS = 120_000;

const isHisAnswer = (row: DoseLogRow) => !(row.state === "unconfirmed" && (row.reason === "no_reply" || row.reason === "undone"));

/** Where a late medicine answer goes: refused, already there, or the cell's day with the tap's instant. */
export async function lateDose(store: Pick<Store, "listDoses">, scope: SessionRow, input: LateDoseInput, at: string, nowMs: number): Promise<LateDose> {
  const tap = lateTap(scope, at, nowMs);
  if (typeof tap === "string") return { refused: tap };
  const day = tap.day - (input.when === "yesterday" ? 1 : 0);
  // real-app 2.8: only today and yesterday, as the server counts them now
  if (scope.story_day - day > 1) return { refused: "too_late" };
  const row = (await store.listDoses(scope.id, { fromDay: day, toDay: day, medication_id: input.medication_id })).find((d) => d.slot === input.slot);
  if (row && isHisAnswer(row)) {
    const have = Date.parse(row.created_at);
    const same = row.state === input.state && (row.reason ?? null) === (input.reason ?? null) && (row.reason_text ?? null) === (input.reason_text ?? null);
    if (have > tap.ms || (same && tap.ms - have <= SAME_TAP_MS)) return { stands: row };
  }
  return { day, at: tap.iso };
}
