/**
 * Did a visit happen? (real-app 12 「一次什么都没录到的看诊也算『上次看诊』」, C2 track F). Server and client safe (pure, apart
 * from happenedVisits, which reads the store it is given).
 *
 * A visit row exists from the moment he starts recording (or as today's planned follow-up), but only a visit with a
 * record counts as one that happened: the brief's "since the last visit" window (track B), the visit check card's
 * window (lib/visit/view.ts) and the medicine list (lib/meds/on-day.ts) start after it.
 *
 *   planned                                  never (the example account's follow-up today, a follow-up he confirmed)
 *   a live transcript (at least one line)    yes: it was recorded and transcribed (or replayed)
 *   status confirmed with no transcript      yes: the demo seed's visits, the story's end state (never replayed here)
 *   anything else                            no: started and ended with nothing captured, a recording still waiting
 *                                            for its transcript (awaiting_transcript), a review with no lines
 *
 * A recording that waits for its transcript does not move the window yet: the brief keeps the readings since the
 * visit before it (more for the doctor to see, never fewer) until the transcript is there.
 *
 * A replay copy (lib/visit/pipeline.ts: a confirmed visit played again is written to a copy, so his confirmed labels
 * stay) is a re-watch, not a visit: never "the last visit".
 *
 * Not the same as lib/safety/line-state.ts visitHappened (that one asks whether the story clock has reached the visit;
 * this one whether the visit left a record). Callers that need both apply both.
 */
import type { Store, UtteranceRow, VisitRow } from "@/lib/store/types";
import { SUPERSEDED_LANG } from "./state";

/** script_section of a replay copy: "copy:<the visit it copies>" (lib/visit/pipeline.ts startVisit). */
export const COPY_PREFIX = "copy:";

export function isReplayCopy(visit: Pick<VisitRow, "script_section">): boolean {
  return typeof visit.script_section === "string" && visit.script_section.startsWith(COPY_PREFIX);
}

/** The visit a replay copy was made from, or null. */
export function copiedFrom(visit: Pick<VisitRow, "script_section">): string | null {
  return isReplayCopy(visit) ? visit.script_section!.slice(COPY_PREFIX.length) || null : null;
}

/**
 * `lines`: the visit's live transcript rows (superseded rows are not counted), or how many there are.
 */
export function visitHappened(visit: Pick<VisitRow, "status" | "script_section">, record: { lines: number | readonly Pick<UtteranceRow, "lang">[] }): boolean {
  if (visit.status === "planned") return false;
  if (isReplayCopy(visit)) return false;
  const lines = typeof record.lines === "number" ? record.lines : record.lines.filter((u) => u.lang !== SUPERSEDED_LANG).length;
  if (lines > 0) return true;
  return visit.status === "confirmed";
}

/** The scope's visits that happened (visitHappened), in the store's order (by day). `visits`: already listed ones. */
export async function happenedVisits(store: Store, scopeId: string, visits?: VisitRow[]): Promise<VisitRow[]> {
  const all = visits ?? (await store.listVisits(scopeId));
  const candidates = all.filter((v) => v.status !== "planned" && !isReplayCopy(v));
  // a confirmed visit counts whatever its transcript: no need to read it. The others' transcripts are read side by
  // side (one round trip to the database, not one per visit)
  const happened = await Promise.all(candidates.map(async (v) => v.status === "confirmed" || visitHappened(v, { lines: await store.listUtterances(scopeId, v.id) })));
  return candidates.filter((_, i) => happened[i]);
}
