/**
 * Whose words a visit line is, following this session's transcript (M4 cross-module fix).
 *
 * The seed is the story's end state: R1-R4 are stored as visit items with speaker "doctor" and every seeded
 * visit is "confirmed". When a session replays or records a visit (M2), the transcript is written into the store
 * and every line starts as "inferred" until he confirms it in the after-visit review. From then on the doctor's
 * lines (R1-R4 included) follow the transcript, so the medicine card, /api/ask and the blood pressure page show
 * the same state as the visit screen (lib/visit/view.ts): 推断：医生 until he confirms, 医生说 after.
 *
 *   transcript line found (by the item's utterance ids, else the same words)  -> that line's role and role_state
 *   no transcript stored and the visit is confirmed (never replayed here)    -> the seed's speaker, confirmed
 *   a transcript exists, or the visit is being recorded, but the line is not in it -> not said (yet)
 *
 * Lines replaced by a whole-visit transcript (lang "x-superseded", lib/visit/state.ts) are not part of the
 * transcript. Pure; server and client safe (types only).
 */
import type { QuestionRow, UtteranceRole, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import type { Attribution, LineRoleState } from "./types";

/** lib/visit/state.ts SUPERSEDED_LANG (kept here as a literal so lib/safety does not import the visit module). */
export const SUPERSEDED_LANG = "x-superseded";

export function liveTranscript(rows: UtteranceRow[]): UtteranceRow[] {
  return rows.filter((u) => u.lang !== SUPERSEDED_LANG);
}

export interface LineState {
  /** the line has been said by this point of the story (false while a recording has not reached it) */
  said: boolean;
  role: UtteranceRole | null;
  state: LineRoleState;
  /** the transcript row, when the visit has one */
  utterance: UtteranceRow | null;
}

const NOT_SAID: LineState = { said: false, role: null, state: "unknown", utterance: null };

/**
 * State of a visit item's line (R1-R4 or any item carrying a speaker). `transcript` is the visit's live transcript
 * rows from the store (see liveTranscript); an empty list means none was stored in this session.
 */
export function itemLineState(visit: Pick<VisitRow, "status">, item: Pick<VisitItemRow, "text" | "utterance_ids" | "speaker">, transcript: UtteranceRow[]): LineState {
  const text = item.text.trim();
  const u =
    transcript.find((x) => item.utterance_ids.includes(x.id)) ??
    transcript.find((x) => x.text.trim() === text) ??
    null;
  if (u) return { said: true, role: u.role, state: u.role_state, utterance: u };
  if (transcript.length === 0 && visit.status === "confirmed") {
    return { said: true, role: item.speaker, state: item.speaker ? "confirmed" : "unknown", utterance: null };
  }
  return NOT_SAID;
}

/** The point of the story a source is looked at: the story day and, when the story clock has one, the time of day. */
export interface StoryMoment {
  day: number;
  /** "HH:MM", or null: a day with no time of day counts as the whole day */
  time: string | null;
}

/**
 * Has this visit happened by the story moment (gap 7.5, 10-10)? A visit before the story day has, one after it has not. On
 * its own day the seed's record of it (every seeded visit is "confirmed", the story's end state) does not say whether it
 * has happened yet: the visit counts once this session holds its record (replayed or recorded, or being recorded now;
 * itemLineState then says which lines were said), or when the story clock has no time of day (the whole day, as the
 * question list and the brief count it). So at D0 08:00, before the 09:30 visit nobody has replayed, R2 is not quoted.
 */
export function visitHappened(visit: Pick<VisitRow, "day" | "status">, at: StoryMoment, hasRecord: boolean): boolean {
  if (visit.day !== at.day) return visit.day < at.day;
  return hasRecord || visit.status === "recording" || at.time === null;
}

/**
 * Has a question's recorded answer been said by the story moment (10-10)? Its visit has happened (visitHappened), and an
 * answer the seed records with no line linked (answer_utterance_id null), for a visit this session holds the record of or
 * is recording, counts only once its words are in that record: the D42 replay reaches Dr Lim's answer at 1:34, not
 * before. `record` is the visit's live transcript in this session (empty: never replayed or recorded here). The one rule
 * for the sources (candidates.ts), the question list, Today's count, the brief and her view (lib/daily/questions.ts).
 */
export function answerSaid(
  q: Pick<QuestionRow, "answer_text" | "answer_utterance_id">,
  visit: Pick<VisitRow, "day" | "status">,
  at: StoryMoment,
  record: UtteranceRow[],
): boolean {
  if (!q.answer_text) return false;
  if (!visitHappened(visit, at, record.length > 0)) return false;
  if (q.answer_utterance_id || (record.length === 0 && visit.status !== "recording")) return true;
  const words = q.answer_text.trim();
  return record.some((u) => u.text.trim() === words);
}

/** Who a line may be attributed to: only a clinician role (inferred or confirmed); the state goes on the chip. */
export function clinicianAttribution(role: UtteranceRole | null | undefined): Attribution | undefined {
  return role === "doctor" || role === "dispenser" || role === "pharmacist" ? role : undefined;
}
