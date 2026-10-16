/**
 * Three more of Mr Tan's medicines, laid out only on an example account (scene 3 of the owner's demo video, 10-15: an
 * elder with three or four medicines who has forgotten how much of each to take photographs one box; data in
 * web/fixtures/example-meds.json). The story template (web/fixtures/timeline.seed.json) stays as it is: the demo, the
 * crew's filming account and the tests read it; buildExampleSpace (./example.ts) adds these rows to what it lays out.
 *
 *   the medicines  metformin 500 mg, atorvastatin 20 mg and aspirin 100 mg, prescribed and dispensed at Blossom Family
 *                  Clinic (fictional) with his amlodipine: label confirmed, the label's lines as the printed labels say
 *                  them, its dispensing date amlodipine's (the template's calendar, moved to the account's days as
 *                  amlodipine's is), taken from the same day 9. No visit is named as where they were prescribed (no
 *                  recording mentions them), so nothing a doctor said is ever linked to them.
 *   the doses      every slot each one is taken in (lib/daily/slots.ts doseSlotsOf: the label's time words, metformin's
 *                  two slots kept as his own choice), every day from its start day to the day before today: taken,
 *                  except a morning on which the template's own log has his morning tablet missed (the four tai chi
 *                  mornings): then every morning medicine is missed too, with the same reason in his words. So the
 *                  calendar keeps the story's four missed mornings and nothing else, and the pattern question (missed
 *                  mornings counted by day) is unchanged. Each row says it is his record from before tracking began
 *                  (pre_tracking), as the template's laid-out doses do.
 * Ids start with "x-" (never one of the template's). Nothing clinical is invented: the label lines are the labels', the
 * rest is the story's own log. Pure (no store, no clock of its own).
 */
import medsJson from "@/fixtures/example-meds.json";
import { doseSlotsOf } from "@/lib/daily/slots";
import type { DaySlot, DoseLogRow, MedicationRow, MedStatus } from "@/lib/store/types";
import { loadTemplate } from "./seed";

interface MedsFile {
  medications: {
    id: string;
    drug_id: string;
    origin: string;
    start_day: number;
    label: { text: string; drug: string; strength: string; directions: string; dispensed: string; clinic: string };
    status: string;
    dose_slots?: string[];
    dose_slots_source?: string;
  }[];
}

const MEDS = medsJson as MedsFile;
const DAY_MS = 86_400_000;

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);

/** Whether an example account gets these medicines: always, except where RIPPLE_EXAMPLE_MEDS=off (the unit tests). */
export function exampleMedsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.RIPPLE_EXAMPLE_MEDS !== "off";
}

export interface ExampleMedsTables {
  medications: MedicationRow[];
  dose_logs: DoseLogRow[];
}

/** A morning of the template's log on which his morning tablet was missed, with his reason. */
export interface MissedMorning {
  day: number;
  reason: string | null;
  reason_text: string | null;
}

/** The mornings the template's own log has a prescription's morning dose missed (the four tai chi mornings). */
export function templateMissedMornings(): MissedMorning[] {
  const seed = loadTemplate("mr-tan");
  const rx = new Set(seed.medications.filter((m) => m.origin === "prescription").map((m) => m.id));
  const out = new Map<number, MissedMorning>();
  for (const d of seed.dose_log) {
    if (d.slot !== "morning" || d.state !== "missed" || !rx.has(d.med) || out.has(d.day)) continue;
    out.set(d.day, { day: d.day, reason: d.reason ?? null, reason_text: d.reason_text_zh ?? null });
  }
  return [...out.values()].sort((a, b) => a.day - b.day);
}

/**
 * The medicines and their doses for an example space whose day 0 is `d0`, only the days before `beforeDay` (today is
 * not laid out). `nowIso` stamps the rows; rows carry `scopeId` as their session_id.
 */
export function exampleMedsTables(scopeId: string, opts: { d0: string; beforeDay: number; nowIso: string }): ExampleMedsTables {
  // the labels' dates are in the template's calendar: moved to the account's days as amlodipine's is (./example.ts)
  const shift = Math.round((utc(opts.d0) - utc(loadTemplate("mr-tan").meta.d0)) / DAY_MS);
  const base = { session_id: scopeId, created_at: opts.nowIso };
  const medications: MedicationRow[] = MEDS.medications.map((m) => ({
    ...base,
    id: m.id,
    drug_id: m.drug_id,
    origin: m.origin as MedicationRow["origin"],
    label: { ...m.label, dispensed: addDays(m.label.dispensed, shift) },
    status: m.status as MedStatus,
    start_day: m.start_day,
    prescribed_visit_id: null,
    note: null,
    pharmacist_answer: null,
    ...(m.dose_slots ? { dose_slots: m.dose_slots as DaySlot[], dose_slots_source: (m.dose_slots_source ?? "label") as "label" | "patient" } : {}),
  }));

  const missed = new Map(templateMissedMornings().map((m) => [m.day, m]));
  const dose_logs: DoseLogRow[] = [];
  for (const med of medications) {
    // the slots as every account screen reads them (an account scope: the label's time words or his own choice)
    const slots = doseSlotsOf({ kind: "account" }, med).slots;
    for (let day = med.start_day ?? opts.beforeDay; day < opts.beforeDay; day++) {
      for (const slot of slots) {
        const miss = slot === "morning" ? missed.get(day) : undefined;
        dose_logs.push({
          ...base,
          id: `x-dose-d${day}-${med.id}-${slot}`,
          medication_id: med.id,
          day,
          slot,
          state: miss ? "missed" : "taken",
          reason: miss?.reason ?? null,
          reason_text: miss?.reason_text ?? null,
          pre_tracking: true,
        });
      }
    }
  }
  return { medications, dose_logs };
}
