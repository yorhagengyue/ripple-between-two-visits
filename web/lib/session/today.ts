/**
 * "Today" view model shared by the patient Today card, the reminder card, backstage and the family page.
 * Pure functions over store rows; client-safe (type imports only).
 *
 * M0 rule for which doses are due: prescription medicines whose start_day has come, one morning slot
 * each (both labels in the story say "every MORNING" / "once in the morning"). M4 replaces this with
 * slots read from the confirmed label.
 */
import type { DaySlot, DoseLogRow, DoseState, MedicationRow } from "@/lib/store/types";

export interface DueDose {
  medication_id: string;
  day: number;
  slot: DaySlot;
  /** e.g. "Amlodipine" (from the label's drug field, else the kb id) */
  name: string;
  /** e.g. "5 mg", or null when there is no confirmed label yet */
  strength: string | null;
  label_confirmed: boolean;
  /** null = nothing recorded yet for this day and slot */
  state: DoseState | null;
}

export const DOSE_SLOT: DaySlot = "morning";

export function doseKey(medicationId: string, day: number, slot: DaySlot): string {
  return `${medicationId}|${day}|${slot}`;
}

function titleCase(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** Display name for a medicine: label drug name, else kb drug id, else the medicine row id. */
export function medName(med: Pick<MedicationRow, "id" | "drug_id" | "label">): string {
  const raw = med.label?.drug ?? med.drug_id ?? med.id;
  return titleCase(raw);
}

export function isDue(med: MedicationRow, day: number): boolean {
  return med.origin === "prescription" && med.start_day !== null && med.start_day <= day;
}

export function dueDoses(meds: MedicationRow[], doses: DoseLogRow[], day: number): DueDose[] {
  const byKey = new Map(doses.map((d) => [doseKey(d.medication_id, d.day, d.slot), d]));
  return meds
    .filter((m) => isDue(m, day))
    .map((m) => ({
      medication_id: m.id,
      day,
      slot: DOSE_SLOT,
      name: medName(m),
      strength: m.label?.strength ?? null,
      label_confirmed: m.status === "label_confirmed" || m.status === "pharmacist_checked",
      state: byKey.get(doseKey(m.id, day, DOSE_SLOT))?.state ?? null,
    }));
}
