/**
 * His own notes over a window of story days (M7 "notes he wrote that the doctor may want, verbatim, no
 * explanation"; M6 when Mr Tan lets Wei Ling see his notes). Pure; server-safe.
 *
 * Ripple does not pick notes by what they might mean: every note he wrote in the window is shown word for word with
 * its date (notes are his health log; small talk is never stored as a note, M13). The only thing worked out is
 * whether a note is on a new topic since the last visit: a body word from the M2 check card's list
 * (lib/visit/checks.ts SYMPTOMS: ankle, swelling, dizzy, headache, tired, cough) that none of his notes or
 * questions up to the last visit used. That marks it "changed since the last visit" (the brief's red); a note with no
 * listed word is shown but not marked. Nothing explains or links a note to a medicine.
 */
import type { NoteRow, QuestionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { SYMPTOMS } from "@/lib/visit/checks";

export interface NoteItem {
  id: string;
  day: number;
  date: string;
  /** his words, verbatim */
  text: string;
  lang: string | null;
  source: string;
  /** body words from the topic list found in the note */
  topics: string[];
  /** on a topic none of his notes or questions used up to the last visit */
  newTopic: boolean;
}

export function topicsOf(text: string): string[] {
  return Object.entries(SYMPTOMS)
    .filter(([, res]) => res.some((re) => re.test(text)))
    .map(([k]) => k);
}

export interface NotesInput {
  notes: NoteRow[];
  fromDay: number;
  toDay: number;
  d0: string;
  /** what he had already said by the last visit: his notes up to that day and his questions raised by then */
  before: { notes: Pick<NoteRow, "text">[]; questions: Pick<QuestionRow, "text">[] };
}

export function notesInWindow(input: NotesInput): NoteItem[] {
  const known = new Set<string>();
  for (const x of [...input.before.notes, ...input.before.questions]) for (const t of topicsOf(x.text)) known.add(t);
  return input.notes
    .filter((n) => n.day >= input.fromDay && n.day <= input.toDay)
    .map((n) => {
      const topics = topicsOf(n.text);
      return {
        id: n.id,
        day: n.day,
        date: storyDate(input.d0, n.day),
        text: n.text,
        lang: n.lang,
        source: n.source,
        topics,
        newTopic: topics.length > 0 && topics.some((t) => !known.has(t)),
      };
    });
}
