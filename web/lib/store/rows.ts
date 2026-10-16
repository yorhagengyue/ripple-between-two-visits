/**
 * Row conventions both store adapters share (lib/store/memory.ts, lib/store/supabase.ts), so the contract tests see the
 * same rows from each. Pure.
 *
 * The C2 columns added to the existing tables (migrations 0004, 0005) are "present only once set": a row handed out
 * carries such a column only when it has a value. Demo rows therefore look exactly as before (their JSON in every
 * response is unchanged), and an account's rows carry the columns its tracks set.
 */
import type { SeedTables } from "@/lib/story/seed";
import type { FamilyGrantRow, ScopeTables } from "./types";

/** Per table, the C2 columns handed out only when set (not null). */
export const OPTIONAL_COLUMNS = {
  // ai_used: C2 track F (0016_f_visit_made), how the visit's record was made
  // audio_parts: C2 track R (0017_r_visit_audio_parts), the files of a long recording
  visit: ["retain_until", "keep_forever", "audio_deleted_at", "ai_used", "audio_parts"],
  medication: ["dose_slots", "dose_slots_source", "start_at"],
  question: ["asked_by_user_id", "edited_at", "merged_into"],
  reminder_clip: ["by_user_id", "by_label", "link_id"],
  // C2 track B (0011_b_daily): the pulse from the blood pressure keypad; (0016_b_bp_changes): the record of his changes
  bp_reading: ["pulse", "history", "deleted_at"],
  // C2 track B (0018_b_dose_pre_tracking): what the row is to a cell outside tracking (true and false are both "set")
  dose_log: ["pre_tracking"],
} as const;

export type OptionalColumnTable = keyof typeof OPTIONAL_COLUMNS;

/** The row without its unset optional columns (a new object; the input is not changed). */
export function withoutUnset<T extends object>(table: OptionalColumnTable, row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const col of OPTIONAL_COLUMNS[table]) if (out[col] === null || out[col] === undefined) delete out[col];
  return out as T;
}

/** A demo grant (no link) has neither link_id nor version; an account's grant has both. */
export function grantOut<T extends Pick<FamilyGrantRow, "link_id" | "version">>(row: T): T {
  if (row.link_id) return row;
  const out = { ...row } as Record<string, unknown>;
  delete out.link_id;
  delete out.version;
  return out as T;
}

/** A user id: the canonical lowercase uuid text (auth.users.id::text). */
export const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUserId(id: unknown): id is string {
  return typeof id === "string" && USER_ID_RE.test(id);
}

/** The rows of a new or reseeded space (deep copies), each moved to the scope (the builder may have used another id). */
export function scopedTables(scopeId: string, tables: ScopeTables | undefined): SeedTables {
  const t = tables ?? {};
  const own = <R extends { session_id: string }>(rows: R[] | undefined): R[] => (rows ?? []).map((r) => ({ ...structuredClone(r), session_id: scopeId }));
  return {
    visits: own(t.visits),
    visit_items: own(t.visit_items),
    medications: own(t.medications),
    dose_logs: own(t.dose_logs),
    bp_readings: own(t.bp_readings),
    notes: own(t.notes),
    questions: own(t.questions),
    family_grants: own(t.family_grants),
    reminder_clips: own(t.reminder_clips),
    // C2 track C: laid out with the rest (empty unless the builder gave them)
    utterances: own(t.utterances),
    profile_facts: own(t.profile_facts),
  };
}
