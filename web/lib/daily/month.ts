/**
 * His own month at the top of Today (owner, 10-14: 「今天」 opens on a month calendar of his own records, each day marked
 * as her month marks it). Server-only, read only: nothing here writes, nothing settles a window (the page has settled
 * the closed ones before it asks).
 *
 * The month is her calendar's builder (lib/care/month.ts familyMonth) asked for the two kinds his calendar draws, so
 * both calendars mark a day the same way and nothing of it is written twice:
 *   his medicine     the day's mark (every dose taken, one not taken, a reminder with no response, not yet: lib/care/
 *                    home.ts dayMark over lib/daily/cells.ts buildDoseDay, the cells his Today answers), and on the
 *                    chosen day each medicine with his answer, the time he tapped and the reason he gave
 *   his visits       the days of his visits: one that happened (a confirmed visit, or one whose recording says so:
 *                    lib/visit/happened.ts) and the one planned, with what kind of visit and where
 *   his readings     (owner 10-15, the demo video's second scene) a day with a reading outside the target his doctor
 *                    set is marked (lib/daily/bp-target.ts, the rule her month uses), and the chosen day lists each
 *                    reading with what he said happened that day under it
 *   his notes        on the chosen day, in his own words; his questions added that day (the one Ripple wrote from a
 *                    reading among them)
 * It is his own space, so nothing is held back: her switches only say which kinds are read here.
 *
 * Only this month, and no paging to another: the chosen day is a day of it (Today's ?d=YYYY-MM-DD), else today.
 */
import { familyMonth, type MonthView } from "@/lib/care/month";
import { NO_GRANTS } from "@/lib/family/types";
import { scopeD0 } from "@/lib/store/scope";
import type { FamilyGrantItems, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";

/** What his calendar reads: his medicine, his visits (what a visit was, whether it happened), his readings, notes and questions. */
const OWN_KINDS: FamilyGrantItems = { ...NO_GRANTS, dose_summary: true, visit_transcripts: true, bp_summary: true, notes: true, questions_count: true };

/** His month and the chosen day of it. `chosen` outside this month (or not a date) means today. */
export async function ownMonth(store: Store, scope: SessionRow, chosen: string | null, nowMs: number): Promise<MonthView> {
  const today = storyDate(scopeD0(scope), scope.story_day);
  const d = chosen && /^\d{4}-\d{2}-\d{2}$/.test(chosen) && chosen.slice(0, 7) === today.slice(0, 7) ? chosen : undefined;
  return familyMonth(store, scope, OWN_KINDS, { d }, nowMs);
}
