/**
 * Which slots of the day he takes a medicine in (C2 track B; real-app 2.16, 6.5). Pure; server and client safe apart
 * from the glossary read (lib/safety/slots reads kb/glossary.json).
 *
 *   demo      one morning slot per prescription medicine, as before (lib/session/today.ts DOSE_SLOT)
 *   account   medication.dose_slots when set (from the label's time words, or his own choice: dose_slots_source), else
 *             the label's own time words through a closed table (kb/glossary.json times -> slot), else none: no
 *             reminder until he says when he takes it (POST /api/doses/slots). The model never sets a slot.
 *
 * The closed table: morning / every morning / after breakfast / om / 早上 / 早饭后 -> morning; evening / 傍晚 -> evening;
 * night / at night / bedtime / on / 晚上 / 睡前 -> night. Words like "after food" or "twice a day" name no slot: he
 * chooses (早上 / 中午 / 晚上 / 睡前).
 */
import { DOSE_SLOT } from "@/lib/session/today";
import { extractSlots } from "@/lib/safety/slots";
import { isAccount } from "@/lib/store/scope";
import type { DaySlot, MedicationRow, SessionRow } from "@/lib/store/types";

/** The day's slots in order. */
export const SLOT_ORDER: readonly DaySlot[] = ["morning", "midday", "evening", "night"];

/** kb/glossary.json time ids -> the slot (the closed list; anything not here names no slot). */
export const TIME_WORD_SLOT: Readonly<Record<string, DaySlot>> = {
  morning: "morning",
  after_breakfast: "morning",
  evening: "evening",
  night: "night",
};

export function isDaySlot(x: unknown): x is DaySlot {
  return typeof x === "string" && (SLOT_ORDER as readonly string[]).includes(x);
}

/** In the day's order, each once. */
export function sortSlots(slots: readonly DaySlot[]): DaySlot[] {
  return SLOT_ORDER.filter((s) => slots.includes(s));
}

/** The slots a label's own words name (closed table), or null when they name none. */
export function slotsFromLabel(text: string | null | undefined): DaySlot[] | null {
  if (!text || !text.trim()) return null;
  const found = extractSlots(text).times.map((id) => TIME_WORD_SLOT[id]).filter((s): s is DaySlot => !!s);
  const slots = sortSlots(found);
  return slots.length ? slots : null;
}

export type SlotSource = "label" | "patient" | "demo";

export interface MedSlots {
  slots: DaySlot[];
  /** label: from the label's time words; patient: he chose; demo: the demo's one morning slot; null: not known yet */
  source: SlotSource | null;
}

type ScopeKindLike = Partial<Pick<SessionRow, "kind">>;
type MedSlotFields = Pick<MedicationRow, "label"> & Partial<Pick<MedicationRow, "dose_slots" | "dose_slots_source">>;

/** The slots a medicine is taken in on this scope (see the header). */
export function doseSlotsOf(scope: ScopeKindLike, med: MedSlotFields): MedSlots {
  if (!isAccount(scope)) return { slots: [DOSE_SLOT], source: "demo" };
  const own = Array.isArray(med.dose_slots) ? sortSlots(med.dose_slots.filter(isDaySlot)) : [];
  if (own.length) return { slots: own, source: med.dose_slots_source === "patient" ? "patient" : "label" };
  const fromLabel = slotsFromLabel(med.label?.directions ?? med.label?.text ?? null);
  return fromLabel ? { slots: fromLabel, source: "label" } : { slots: [], source: null };
}
