/**
 * What a doctor, a pharmacist or the clinic counter said at his visits, as he confirmed it (C2 track K). Server-only.
 *
 * Track K quotes these lines word for word next to his own records: the doctor's words about food first on the diet
 * screen (journey 13), the doctor's diagnosis and the tests he asked for on the prevention screen (journey 11), the
 * doctor's line about the same symptom under a note in his conversation (journey 04). Nothing here words a sentence:
 * a line is shown whole, with who said it, the visit's real date, the time point in the recording and the clip when
 * there is one (the stand-in voices under fixtures/visits/clips are labelled 代录音).
 *
 * A line counts only when all of these hold:
 *   - its visit happened (track F lib/visit/happened.ts: never a planned visit, an empty recording or a replay copy)
 *     and is on or before today (the scope's computed day);
 *   - he confirmed who said it (role_state "confirmed": the review after the visit, or the example's laid-out review);
 *   - it was not replaced by the whole-visit transcript (lib/visit/state.ts SUPERSEDED_LANG);
 *   - no visit item made from it is marked superseded, rejected or disputed (he said 「不是」 in the review).
 * Newest visit first; inside a visit, in the order said.
 */
import { fixtureClipPath, isStandInClip } from "@/lib/asr/fixtures";
import { clipUrlFor } from "@/lib/safety/candidates";
import type { SessionRow, Store, UtteranceRole, VisitItemRow, VisitRow } from "@/lib/store/types";
import { happenedVisits } from "@/lib/visit/happened";
import { SUPERSEDED_LANG } from "@/lib/visit/state";

export type ClinicianRole = Extract<UtteranceRole, "doctor" | "pharmacist" | "dispenser">;

export interface SaidLine {
  visitId: string;
  /** the visit's real date (YYYY-MM-DD) */
  visitDate: string;
  visitDay: number;
  utteranceId: string;
  /** word for word */
  text: string;
  /** the language of the words themselves */
  lang: "en" | "zh-Hans";
  role: ClinicianRole;
  /** where in the recording (ms) */
  tStartMs: number;
  /** same-origin URL that plays the line (GET /api/visits/[id]/clip), or null when there is no clip */
  clipUrl: string | null;
  /** the clip is a synthetic stand-in voice (代录音) */
  standIn: boolean;
  /** visit items made from this line (their ids), for a caller that records where a question came from */
  itemIds: string[];
}

const CLINICIANS: readonly ClinicianRole[] = ["doctor", "pharmacist", "dispenser"];

const hasHan = (s: string) => /\p{Script=Han}/u.test(s);

function itemsByUtterance(items: VisitItemRow[]): Map<string, VisitItemRow[]> {
  const out = new Map<string, VisitItemRow[]>();
  for (const it of items) for (const u of it.utterance_ids ?? []) out.set(u, [...(out.get(u) ?? []), it]);
  return out;
}

const markedOff = (it: VisitItemRow) => it.slots?.superseded === true || it.slots?.rejected === true || it.slots?.disputed === true;

/**
 * The confirmed lines of clinicians at the visits that happened up to today (newest visit first). `roles` narrows
 * whose lines (default: doctor, pharmacist, counter).
 */
export async function confirmedClinicianLines(store: Store, scope: SessionRow, opts: { roles?: readonly ClinicianRole[] } = {}): Promise<SaidLine[]> {
  const roles = opts.roles ?? CLINICIANS;
  const visits = (await happenedVisits(store, scope.id)).filter((v) => v.day <= scope.story_day);
  if (!visits.length) return [];
  const items = itemsByUtterance(await store.listVisitItems(scope.id));
  const newestFirst = [...visits].sort((a, b) => b.day - a.day || b.created_at.localeCompare(a.created_at));
  const out: SaidLine[] = [];
  for (const v of newestFirst) {
    const lines = await store.listUtterances(scope.id, v.id);
    for (const u of lines) {
      if (u.lang === SUPERSEDED_LANG) continue;
      if (u.role_state !== "confirmed" || !(roles as readonly string[]).includes(u.role)) continue;
      const made = items.get(u.id) ?? [];
      if (made.some(markedOff)) continue;
      out.push(lineOf(scope, v, u, made));
    }
  }
  return out;
}

function lineOf(scope: SessionRow, v: VisitRow, u: { id: string; text: string; lang: string | null; role: UtteranceRole; t_start_ms: number; clip_path: string | null }, made: VisitItemRow[]): SaidLine {
  const clip = u.clip_path ?? fixtureClipPath(u.id);
  return {
    visitId: v.id,
    visitDate: v.date,
    visitDay: v.day,
    utteranceId: u.id,
    text: u.text.trim(),
    lang: hasHan(u.text) ? "zh-Hans" : "en",
    role: u.role as ClinicianRole,
    tStartMs: u.t_start_ms,
    clipUrl: clip ? clipUrlFor(scope, v.id, u.id) : null,
    standIn: isStandInClip(clip),
    itemIds: made.map((m) => m.id),
  };
}
