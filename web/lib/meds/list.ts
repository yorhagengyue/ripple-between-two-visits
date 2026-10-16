/**
 * The medicine list (task M3 item 1): every medicine that is his at the moment, grouped by where it came from
 * (doctor / bought himself / from a relative / supplements), each with its check status. Server-only.
 *
 * C2 (track F): a medicine prescribed at a visit is on the list only once that visit happened (lib/meds/on-day.ts: the
 * story clock reached it and it left a record), so a planned or empty visit never puts a medicine here; each row also
 * carries the Chinese generic name from the checked table, whether he typed it in himself, his status for a medicine
 * nobody identified, and the slots he takes it in.
 */
import { doseSlotsOf } from "@/lib/daily/slots";
import type { Locale } from "@/lib/i18n";
import { liveTranscript } from "@/lib/safety/line-state";
import type { Store } from "@/lib/store/types";
import { medsOnDayAt } from "./on-day";
import { MED_ORIGINS, type MedListItem, type MedOrigin, type StoredLabel } from "./types";
import { medDisplayName } from "./write";
import { zhGenericName } from "./zh-names";

export interface MedGroup {
  origin: MedOrigin;
  items: MedListItem[];
}

/** `time`: the story clock's time of day on `day` ("HH:MM"), or null for the whole day. */
export async function listMedGroups(store: Store, sessionId: string, day: number, locale: Locale, time: string | null = null): Promise<MedGroup[]> {
  const [meds, visits, scope] = await Promise.all([store.listMeds(sessionId), store.listVisits(sessionId), store.getSession(sessionId)]);
  const lines = new Map<string, number>();
  const wanted = new Set(meds.map((m) => m.prescribed_visit_id).filter((id): id is string => !!id));
  for (const v of visits) if (wanted.has(v.id) && v.day <= day) lines.set(v.id, liveTranscript(await store.listUtterances(sessionId, v.id)).length);
  const visible = medsOnDayAt(meds, visits, { day, time }, lines);
  return MED_ORIGINS.map((origin) => ({
    origin,
    items: visible
      .filter((m) => m.origin === origin)
      .map((m) => {
        const label = m.label as StoredLabel | null;
        return {
          id: m.id,
          name: medDisplayName(m, locale),
          strength: m.label?.strength ?? null,
          origin: m.origin,
          status: m.status,
          zhName: zhGenericName(m.drug_id),
          typed: label?.typed === true,
          patientStatus: label?.patient_status ?? null,
          slots: scope ? doseSlotsOf(scope, m).slots : [],
        };
      }),
  })).filter((g) => g.items.length > 0);
}
