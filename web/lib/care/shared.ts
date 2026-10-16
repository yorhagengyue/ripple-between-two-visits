/**
 * What he shares beyond the counts (C2 track D; the daughter brief F3-F5): his visit records and his own notes, each
 * only while its switch for her link is on. Server-only, read only.
 *
 *   sharedVisits(store, scope, linkId)   the visits that happened, newest first; in each, the clinicians' words he
 *                                        confirmed in his review (doctor, counter, pharmacist), word for word with the
 *                                        time point, a link to the line's own sound through her link, and under an
 *                                        English line the Chinese only when its translation passed both checks
 *                                        (lib/translate cachedTranslation: made once after the visit, never here)
 *   sharedNotes(store, scope)            his typed and spoken notes, newest first
 *
 * Lines Ripple only inferred, his own words in the room, and anything unclear are left out: she reads only what he
 * confirmed a clinician said.
 */
import { isStandInClip } from "@/lib/asr";
import { liveTranscript } from "@/lib/safety/line-state";
import { scopeD0 } from "@/lib/store/scope";
import type { SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { cachedTranslation } from "@/lib/translate";
import { happenedVisits } from "@/lib/visit/happened";
import type { SharedNote, SharedVisit, SharedVisitLine } from "./home-types";

const CLINICIANS = new Set(["doctor", "dispenser", "pharmacist"]);

/** Her link to one line's sound (app/api/family/clip). */
export function familyClipUrl(linkId: string, visitId: string, utteranceId: string): string {
  return `/api/family/clip?link=${encodeURIComponent(linkId)}&visit=${encodeURIComponent(visitId)}&u=${encodeURIComponent(utteranceId)}`;
}

export async function sharedVisits(store: Store, scope: SessionRow, linkId: string): Promise<SharedVisit[]> {
  const visits = await happenedVisits(store, scope.id);
  const out: SharedVisit[] = [];
  for (const v of [...visits].sort((a, b) => b.date.localeCompare(a.date))) {
    const rows = liveTranscript(await store.listUtterances(scope.id, v.id));
    const lines: SharedVisitLine[] = [];
    for (const u of rows) {
      if (!CLINICIANS.has(u.role) || u.role_state !== "confirmed") continue;
      const zh = /[㐀-鿿]/.test(u.text) ? null : ((await cachedTranslation(store, scope.id, u.text, "en>zh-Hans").catch(() => null))?.text ?? null);
      lines.push({
        id: u.id,
        speaker: u.role as SharedVisitLine["speaker"],
        text: u.text,
        lang: u.lang,
        tStartMs: u.t_start_ms,
        zh,
        clipUrl: u.clip_path ? familyClipUrl(linkId, v.id, u.id) : null,
        standIn: !!u.clip_path && isStandInClip(u.clip_path),
      });
    }
    out.push({ id: v.id, date: v.date || storyDate(scopeD0(scope), v.day), place: v.place, kind: v.kind, lines });
  }
  return out;
}

export async function sharedNotes(store: Store, scope: SessionRow): Promise<SharedNote[]> {
  const d0 = scopeD0(scope);
  const rows = await store.listNotes(scope.id, { toDay: scope.story_day });
  return rows.map((n) => ({ id: n.id, date: storyDate(d0, n.day), text: n.text, source: n.source })).reverse();
}
