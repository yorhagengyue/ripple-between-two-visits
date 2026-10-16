/**
 * Medicine row ids (task M3, C2 track F). Pure; client-safe.
 *
 *   med-<kb drug id>          the first medicine of that drug ("med-amlodipine", as the seed names it)
 *   med-<kb drug id>-<n>      another one of the same drug
 *   med-unknown-<n>           a medicine nobody identified (the relative's box), or one he typed that the kb does not know
 */
import type { MedicationRow } from "@/lib/store/types";

export function newMedId(existing: readonly Pick<MedicationRow, "id">[], drugId: string | null): string {
  const base = drugId ? `med-${drugId}` : "med-unknown";
  const taken = new Set(existing.map((m) => m.id));
  if (drugId && !taken.has(base)) return base;
  for (let n = drugId ? 2 : 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
