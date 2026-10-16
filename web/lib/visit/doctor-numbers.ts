/**
 * The doctor's own blood-pressure numbers (real-app 2.9, 2.15, 6.7; C2 track F): the target ("At home, we want it below
 * 135 over 85.") and the warning line ("If your reading at home is above 180 on top ... call 995."), word for word,
 * with the visit and the moment they were said. The blood pressure page (B), the warning line of an ask and the doctor's
 * words next to a reading over it (S), the visit check card (F) and her view (D) all take them from here.
 *
 * Which line counts:
 *   - the visit happened (lib/visit/happened.ts: not planned, not an empty recording, not a replay copy) and, when a
 *     story moment is given, the story clock has reached it (lib/safety/line-state.ts visitHappened);
 *   - the line has been said in this scope's record (line-state.ts itemLineState: a transcript line, or the demo seed's
 *     confirmed visit that was never replayed here);
 *   - it is not superseded, and he did not mark it "not right" (slots.disputed, review 「不是」);
 *   - an account's line counts once he confirmed it (confirmed_by "patient"); the demo's required lines R1 and R2
 *     count as they always did (their speaker state, 医生说 or 推断：医生, goes with them in `state`).
 * The latest such line wins (latest visit, then latest in the visit).
 *
 * emergencyThreshold is wider, for the emergency path only: the latest warning line from a visit that happened, also
 * when he has not reviewed it yet or said it was "not right" (real-app 12: 含 995 或警示线的句子被点「不对」时，急症转述
 * 照常用它). `state` and `disputed` say how it must be labelled (推断：医生, never 医生说, unless confirmed).
 *
 * Pure over rows (confirmedTarget / confirmedThreshold / emergencyThreshold take what the caller already read), plus
 * doctorNumbers(store, scopeId, at?) that reads them. Server and client safe apart from doctorNumbers.
 */
import { itemLineState, liveTranscript, visitHappened as reachedByStoryClock, type StoryMoment } from "@/lib/safety/line-state";
import type { RequiredLineId, Store, UtteranceRole, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { visitHappened } from "./happened";

export type DoctorNumberKind = "target" | "threshold";

export interface DoctorNumber {
  kind: DoctorNumberKind;
  /** the upper number: 135 in "below 135 over 85", 180 in "above 180 on top" */
  systolic: number;
  /** the target's lower number (85); null for a warning line */
  diastolic: number | null;
  /** the whole sentence, as said */
  text: string;
  itemId: string;
  visitId: string;
  visitDay: number;
  visitDate: string;
  /** R1 / R2 in the demo; null on an account's own visit */
  requiredLine: RequiredLineId | null;
  /** the transcript line; null for the demo seed's visit that was never replayed in this scope */
  utteranceId: string | null;
  /** where in the recording (ms), when there is a transcript line */
  tStartMs: number | null;
  /** the line's audio (a stand-in clip under web/fixtures, or a segment of his recording); null when there is none */
  clipPath: string | null;
  /** who said it, as the record has it (the transcript line's role, else the item's speaker) */
  speaker: UtteranceRole | null;
  /** "confirmed": he confirmed it was the doctor (or the demo seed's record); "inferred": the app's guess */
  state: "confirmed" | "inferred";
  /** he said the line was not right (review 「不是」): never a comparison line; kept on the emergency path only */
  disputed: boolean;
}

export interface DoctorNumberRows {
  visits: readonly VisitRow[];
  /** the scope's visit items (any order; other types are ignored) */
  items: readonly VisitItemRow[];
  /** each visit's transcript (superseded rows are left out here); a visit missing from the map has none */
  transcripts: ReadonlyMap<string, readonly UtteranceRow[]>;
  /** the story moment (day, and time of day or null): visits the story clock has not reached do not count */
  at?: StoryMoment;
}

export interface DoctorNumbers {
  /** the target he confirmed (the demo: R1) */
  target: DoctorNumber | null;
  /** the warning line he confirmed (the demo: R2) */
  threshold: DoctorNumber | null;
  /** the latest warning line said at a visit that happened, confirmed or not, disputed or not (emergency path only) */
  emergency: DoctorNumber | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

interface Found {
  n: DoctorNumber;
  /** counts as his confirmed number (not merely said) */
  counted: boolean;
}

function lines(kind: DoctorNumberKind, rows: DoctorNumberRows): Found[] {
  const visits = new Map(rows.visits.map((v) => [v.id, v]));
  const out: Found[] = [];
  for (const item of rows.items) {
    if (item.type !== kind) continue;
    if (item.slots?.superseded === true || item.slots?.rejected === true) continue;
    const visit = visits.get(item.visit_id);
    if (!visit) continue;
    const transcript = liveTranscript([...(rows.transcripts.get(visit.id) ?? [])]);
    if (!visitHappened(visit, { lines: transcript.length })) continue;
    if (rows.at && !reachedByStoryClock(visit, rows.at, transcript.length > 0)) continue;
    const line = itemLineState(visit, item, transcript);
    if (!line.said) continue;
    const systolic = num(item.slots?.systolic);
    const diastolic = kind === "target" ? num(item.slots?.diastolic) : null;
    if (systolic === null || (kind === "target" && diastolic === null)) continue;
    // the demo's required lines (R1, R2) count as they always did; a line the model found, and every line of an
    // account's own visit, counts once he confirmed it (the rule lib/safety/candidates.ts applies to every source)
    const required = !!item.required_line && item.slots?.extracted_by !== "model";
    const disputed = item.slots?.disputed === true;
    const confirmedByHim = item.confirmed_by !== null && item.confirmed_by !== undefined;
    const u = line.utterance;
    out.push({
      counted: (required || confirmedByHim) && !disputed,
      n: {
        kind,
        systolic,
        diastolic,
        text: u?.text ?? item.text,
        itemId: item.id,
        visitId: visit.id,
        visitDay: visit.day,
        visitDate: visit.date,
        requiredLine: item.required_line ?? null,
        utteranceId: u?.id ?? null,
        tStartMs: u?.t_start_ms ?? null,
        clipPath: u?.clip_path ?? null,
        speaker: line.role ?? item.speaker ?? null,
        state: !disputed && (line.state === "confirmed" || confirmedByHim) ? "confirmed" : "inferred",
        disputed,
      },
    });
  }
  // latest visit first, then latest in the visit
  return out.sort((a, b) => b.n.visitDay - a.n.visitDay || b.n.visitDate.localeCompare(a.n.visitDate) || (b.n.tStartMs ?? -1) - (a.n.tStartMs ?? -1));
}

/** The latest target he confirmed (the demo: R1), or null (a new account before its first confirmed visit). */
export function confirmedTarget(rows: DoctorNumberRows): DoctorNumber | null {
  return lines("target", rows).find((f) => f.counted)?.n ?? null;
}

/** The latest warning line he confirmed (the demo: R2), or null. Comparisons (the blood pressure page) use this one. */
export function confirmedThreshold(rows: DoctorNumberRows): DoctorNumber | null {
  return lines("threshold", rows).find((f) => f.counted)?.n ?? null;
}

/**
 * The emergency path's warning line: the latest one said at a visit that happened, whether or not he confirmed it, also
 * when he said it was "not right". Label it by `state` (推断：医生 unless "confirmed") and never compare readings with it
 * unless it is also confirmedThreshold.
 */
export function emergencyThreshold(rows: DoctorNumberRows): DoctorNumber | null {
  return lines("threshold", rows)[0]?.n ?? null;
}

/** Reads what the three need from the scope and returns all three. `at`: the story moment (default: no gating). */
export async function doctorNumbers(store: Store, scopeId: string, at?: StoryMoment): Promise<DoctorNumbers> {
  const [visits, all] = await Promise.all([store.listVisits(scopeId), store.listVisitItems(scopeId)]);
  const items = all.filter((i) => i.type === "target" || i.type === "threshold");
  const transcripts = new Map<string, UtteranceRow[]>();
  for (const id of new Set(items.map((i) => i.visit_id))) transcripts.set(id, liveTranscript(await store.listUtterances(scopeId, id)));
  const rows: DoctorNumberRows = { visits, items, transcripts, at };
  return { target: confirmedTarget(rows), threshold: confirmedThreshold(rows), emergency: emergencyThreshold(rows) };
}
