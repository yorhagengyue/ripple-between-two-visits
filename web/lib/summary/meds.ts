/**
 * His medicine list on the story day, for the visit brief (M7): name, where it came from, and whether it is new
 * since the last visit (the brief marks only changes in red). Server-only (medicine names come from lib/meds).
 *
 * "On the list" is the one rule of lib/meds/on-day.ts medsOnDayAt (prescribed at a visit that has happened by the story
 * moment, or started by then; a medicine with neither is part of the list from the start, as the seed's end state has
 * it). C2 round 2 (real-app 12 「第 42 天看诊前，简报就列出当天才开的 Losartan」): "now" is the story moment, time of day
 * included, so the brief he opens before the day's visit does not list what that visit prescribes. New since the last
 * visit: on the list now, not on it on the last visit's day (the whole day). A medicine prescribed at that visit is not
 * new to the doctor who prescribed it.
 */
import type { Locale } from "@/lib/i18n";
import { medsOnDayAt } from "@/lib/meds/on-day";
import { medDisplayName } from "@/lib/meds/write";
import type { MedicationRow, MedOrigin, MedStatus, VisitRow } from "@/lib/store/types";

export interface MedItem {
  id: string;
  name: string;
  strength: string | null;
  origin: MedOrigin;
  status: MedStatus;
  /** on the list now and not on it at the last visit */
  newSinceLastVisit: boolean;
}

export interface BriefMoment {
  /** the story clock's time of day on `day` ("HH:MM"); null or left out: the whole day */
  time?: string | null;
  /** each prescribing visit's live transcript length in this scope (lib/meds/on-day.ts prescribingLines); the demo seed needs none */
  lines?: ReadonlyMap<string, number>;
}

export function medsForBrief(meds: MedicationRow[], visits: VisitRow[], day: number, lastVisitDay: number | null, locale: Locale, at: BriefMoment = {}): MedItem[] {
  const lines = at.lines ?? new Map<string, number>();
  const now = medsOnDayAt(meds, visits, { day, time: at.time ?? null }, lines);
  const then = lastVisitDay === null ? null : new Set(medsOnDayAt(meds, visits, { day: lastVisitDay, time: null }, lines).map((m) => m.id));
  return now.map((m) => ({
    id: m.id,
    name: medDisplayName(m, locale),
    strength: m.drug_id ? (m.label?.strength ?? null) : null,
    origin: m.origin,
    status: m.status,
    newSinceLastVisit: then !== null && !then.has(m.id),
  }));
}
