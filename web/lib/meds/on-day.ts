/**
 * Which medicines are his at a moment of the story (C2 track F; real-app 12 「第 42 天看诊前，简报就列出当天才开的 Losartan」,
 * 「medsOnDay 按看诊时刻算」). The medicine list, the label match and the card read through here.
 *
 *   prescribed at a visit   only once that visit has happened by the moment: the story clock reached it
 *                           (lib/safety/line-state.ts visitHappened: an earlier day, or that day with its record, or the
 *                           whole day) and it left a record (lib/visit/happened.ts: never a planned visit, never an empty
 *                           recording); a replay copy counts as the visit it copies
 *   otherwise               from its start day (no start day: always, as the demo's self-bought boxes)
 *
 * The one rule everywhere (C2 track S, round 2): the brief (lib/summary/meds.ts) and the safety sources and classifier of
 * an ask (lib/safety/candidates.ts, pipeline.ts) read through medsOnDayAt too, so the brief before the day's visit never
 * lists what that visit prescribes, and an ask before it is not about a medicine he does not have yet.
 * Pure (medsOnDayAt) and store readers (medsNow, prescribingLines).
 */
import { liveTranscript, visitHappened as reachedByStoryClock, type StoryMoment } from "@/lib/safety/line-state";
import type { MedicationRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { visitHappened } from "@/lib/visit/happened";

/** `lines`: each visit's live transcript length (a visit missing here has none). */
export function medsOnDayAt(meds: readonly MedicationRow[], visits: readonly VisitRow[], at: StoryMoment, lines: ReadonlyMap<string, number>): MedicationRow[] {
  const byId = new Map(visits.map((v) => [v.id, v]));
  return meds.filter((m) => {
    const v = m.prescribed_visit_id ? byId.get(m.prescribed_visit_id) : undefined;
    if (v) {
      const n = lines.get(v.id) ?? 0;
      return visitHappened(v, { lines: n }) && reachedByStoryClock(v, at, n > 0);
    }
    if (m.start_day !== null) return m.start_day <= at.day;
    return true;
  });
}

/** His medicines now (the scope's story moment), read from the store. */
export async function medsNow(store: Store, session: Pick<SessionRow, "id" | "story_day" | "story_time">): Promise<MedicationRow[]> {
  const [meds, visits] = await Promise.all([store.listMeds(session.id), store.listVisits(session.id)]);
  const wanted = new Set(meds.map((m) => m.prescribed_visit_id).filter((id): id is string => !!id));
  const lines = new Map<string, number>();
  for (const v of visits) if (wanted.has(v.id) && v.day <= session.story_day) lines.set(v.id, liveTranscript(await store.listUtterances(session.id, v.id)).length);
  return medsOnDayAt(meds, visits, { day: session.story_day, time: session.story_time }, lines);
}

// ---------------------------------------------------------------- C2 track S (round 2): the rows medsOnDayAt needs, for other readers

/**
 * How many live transcript lines this scope holds for each visit that prescribed one of `meds`, up to story day `day`
 * (medsOnDayAt's `lines`). One read per prescribing visit; a planned visit has no transcript and is not read.
 */
export async function prescribingLines(
  store: Pick<Store, "listUtterances">,
  scopeId: string,
  meds: readonly Pick<MedicationRow, "prescribed_visit_id">[],
  visits: readonly Pick<VisitRow, "id" | "day" | "status">[],
  day: number,
): Promise<Map<string, number>> {
  const wanted = new Set(meds.map((m) => m.prescribed_visit_id).filter((id): id is string => !!id));
  const mine = visits.filter((v) => wanted.has(v.id) && v.day <= day && v.status !== "planned");
  const counts = await Promise.all(mine.map(async (v) => [v.id, liveTranscript(await store.listUtterances(scopeId, v.id)).length] as const));
  return new Map(counts);
}
