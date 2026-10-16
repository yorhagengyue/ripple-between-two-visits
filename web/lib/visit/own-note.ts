/**
 * 「先自己记一句」 (C2 track F; real-app 2.14: while a visit waits for its transcript he can write a line of his own:
 * 「存成他的笔记，标『本人记的』，不当医生的话引用」). Server-only (node:crypto).
 *
 * The line is one of his notes, exactly like a note written on Today (track B's POST /api/notes: the note table,
 * source "typed", the day he wrote it, nothing added to his words, note.logged on the bus), so everything that reads
 * his notes sees it as his: the brief, a later visit's check card, the family view while he shares notes. It is never
 * a visit line and never a visit item: nothing can quote it as the doctor's.
 *
 * What ties it to the visit is its id: "vnote-<visit id>-<8 hex>". The note table has no visit column, and the day of
 * a note is the day he wrote it, which can be days after the visit, so the day cannot say which visit it is about. The
 * id's shape is matched whole (visitNoteOf), so the notes of visit "a" never include those of a visit "a-…".
 */
import { randomUUID } from "node:crypto";
import { dayWords } from "@/lib/daily/doses";
import { detectLang } from "@/lib/safety/text";
import type { NoteRow, SessionRow, Store } from "@/lib/store/types";
import { publish } from "@/lib/bus";

/** How long one line may be (characters). */
export const OWN_NOTE_MAX = 300;
/** How many lines of his own one visit keeps. */
export const OWN_NOTES_PER_VISIT = 20;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this note one he wrote about this visit? */
export function visitNoteOf(note: Pick<NoteRow, "id">, visitId: string): boolean {
  return new RegExp(`^vnote-${escapeRe(visitId)}-[0-9a-f]{8}$`).test(note.id);
}

/** His own lines about this visit, oldest first. */
export function visitNotes<T extends Pick<NoteRow, "id" | "created_at">>(notes: readonly T[], visitId: string): T[] {
  return notes.filter((n) => visitNoteOf(n, visitId)).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** One line, as he typed it: spaces and line breaks become single spaces; nothing else changes. */
export function cleanOwnNote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export class OwnNoteError extends Error {
  constructor(readonly code: "empty" | "too_long" | "too_many") {
    super(code);
    this.name = "OwnNoteError";
  }
}

/** Save his line about this visit as his own note. `store` is the request's own store (his scope). */
export async function addVisitNote(store: Store, scope: SessionRow, visitId: string, text: string): Promise<NoteRow> {
  const line = cleanOwnNote(text);
  if (!line) throw new OwnNoteError("empty");
  if ([...line].length > OWN_NOTE_MAX) throw new OwnNoteError("too_long");
  const before = visitNotes(await store.listNotes(scope.id), visitId);
  if (before.length >= OWN_NOTES_PER_VISIT) throw new OwnNoteError("too_many");
  const note = await store.addNote(scope.id, {
    id: `vnote-${visitId}-${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    day: scope.story_day,
    text: line,
    source: "typed",
    lang: detectLang(line),
    app_reply: "logged only",
  });
  const short = note.text.length > 80 ? `${note.text.slice(0, 79)}…` : note.text;
  // the same event as a note written on Today (an account's sentence names the real date, never a story day)
  publish(scope.id, "note.logged", `Noted for ${dayWords(scope, scope.story_day)} (his own line about a visit waiting for its transcript): "${short}"`, { note, visit_id: visitId });
  return note;
}
