/**
 * A reading against the target his doctor set (owner 10-15, the demo video's second scene: 「量完显示今天超过了异常值」;
 * decided with the coordinator: the target the doctor gave at a visit, R1's 135/85, never the 180 warning line, which keeps
 * its own 995 relay, lib/safety/threshold.ts). The ONE rule every place uses, so the blood pressure page's card, his month,
 * her month and her 「留意」 (lib/care/record.ts) never disagree about a day:
 *
 *   a recorded reading is outside the target when its upper number is strictly above the target's upper number, or its
 *   lower number strictly above the target's lower number, and it was taken on or after the day of the visit the target
 *   was given at (lib/safety/threshold.ts rule B: only the target he confirmed is compared; none confirmed, nothing is)
 *
 * And the tie between a reading and what he said about it (「按住说说今天怎么了」): his words are one of his notes, exactly as
 * heard, whose id names the reading, "bpnote-<reading id>-<8 hex>" (as lib/visit/own-note.ts ties a note to a visit; the
 * note table has no reading column, so no migration). Pure; server and client safe.
 */

/** The target as the rule needs it: the doctor's two numbers and the story day of the visit he gave them at. */
export interface TargetRule {
  systolic: number;
  diastolic: number;
  /** the visit's story day: readings before it are not compared */
  since: number;
}

export interface RuleReading {
  day: number;
  systolic: number | null;
  diastolic: number | null;
  state?: string;
}

/** Outside the doctor's target (see the header). False without a target, for a reading not taken, or one from before it. */
export function outsideTarget(r: RuleReading, target: TargetRule | null | undefined): boolean {
  if (!target) return false;
  if (r.state !== undefined && r.state !== "recorded") return false;
  if (r.systolic === null || r.diastolic === null) return false;
  return r.day >= target.since && (r.systolic > target.systolic || r.diastolic > target.diastolic);
}

/** The rule's target from the doctor's number (lib/visit/doctor-numbers.ts DoctorNumber), or null without both numbers. */
export function targetRule(n: { systolic: number; diastolic: number | null; visitDay: number } | null | undefined): TargetRule | null {
  return n && n.diastolic !== null ? { systolic: n.systolic, diastolic: n.diastolic, since: n.visitDay } : null;
}

// ---------------------------------------------------------------- his words about a reading

const PREFIX = "bpnote-";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The id of a new note about this reading (`hex8`: eight hex characters, random). */
export function reasonNoteId(readingId: string, hex8: string): string {
  return `${PREFIX}${readingId}-${hex8}`;
}

/** Is this note what he said about this reading? (the whole id is matched: reading "a" never takes the notes of "a-b") */
export function isReasonNoteOf(note: { id: string }, readingId: string): boolean {
  return new RegExp(`^${escapeRe(PREFIX)}${escapeRe(readingId)}-[0-9a-f]{8}$`).test(note.id);
}

/** The reading a note is about, or null for any other note. */
export function readingOfNote(note: { id: string }): string | null {
  const m = /^bpnote-(.+)-[0-9a-f]{8}$/.exec(note.id);
  return m ? m[1] : null;
}

/** What he said about each reading: its latest note (by created_at, then insertion), keyed by the reading's id. */
export function latestReasons<T extends { id: string; created_at: string }>(notes: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const n of notes) {
    const reading = readingOfNote(n);
    if (!reading) continue;
    const was = out.get(reading);
    if (!was || n.created_at >= was.created_at) out.set(reading, n);
  }
  return out;
}
