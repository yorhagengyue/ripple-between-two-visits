/**
 * The visit screen's data (built on the server by lib/visit/view.ts, rendered by components/visit).
 * Client-safe: types only.
 *
 * Clinical words on the screen come from exactly three places, all carried here as data:
 *   - the speaker's own sentence (LineView.text, DocCardView.quote, QItemView.answer.text), verbatim;
 *   - his own records (CheckCardView numbers, his note verbatim, the label text verbatim);
 *   - lib/safety fixed text (the unknown-medicine sentence).
 * The UI adds only labels from lib/visit/strings.ts.
 */
import type { DoseSummary } from "@/lib/summary/doses";
import type { QuestionOrigin, RequiredLineId, RoleState, UtteranceRole, VisitStatus } from "@/lib/store/types";

/**
 * What the speaker chip shows:
 * - confirmed: he confirmed it in the after-visit review -> "Doctor said" etc.
 * - label: a medicine sentence that agrees with a confirmed medicine label -> "Doctor said · matches your label"
 * - inferred: the app's guess -> "Inferred: doctor" (never "Doctor said")
 * - unknown: no guess
 */
export type RoleDisplay = "confirmed" | "label" | "inferred" | "unknown";

export interface ClipView {
  url: string;
  /** a synthetic stand-in voice (web/fixtures/visits/clips), labelled 代录音 / stand-in recording */
  standIn: boolean;
}

export interface MarkView {
  /** a substring of the line text to underline */
  text: string;
  kind: "doc" | "chk";
}

export interface LineView {
  id: string;
  tStartMs: number;
  tEndMs: number;
  text: string;
  lang: string | null;
  role: UtteranceRole;
  roleState: RoleState;
  display: RoleDisplay;
  /** the sentence is about medicine (the hard rule applies) */
  medication: boolean;
  scriptedFallback: boolean;
  clip: ClipView | null;
  marks: MarkView[];
  /** id of the question-list item this line is shown under (asked / answered), else null */
  inQuestion: string | null;
  /** C2: the kept Chinese of a clinician's English line (lib/visit/translate.ts, checked twice); null: the English alone */
  translation?: string | null;
}

export type DocVariant =
  | "reading"
  | "measure_home"
  | "how_to_measure"
  | "lifestyle"
  | "target"
  | "threshold"
  | "diagnosis"
  | "new_med"
  | "med"
  | "purpose"
  | "dose_rule"
  | "watch"
  | "how_to_take"
  | "missed_dose"
  | "follow_up"
  | "test"
  | "instruction";

export interface DocRow {
  variant: DocVariant;
  itemId: string;
  /** kb drug id and its display name (medicine rows) */
  drug?: string;
  drugName?: string;
  /** strength as said ("50 mg") */
  strength?: string;
  isNew?: boolean;
  /**
   * visit date + the "in N weeks" the speaker said. Always shown as approximate ("About 6 Oct" / 大约 10月6日):
   * the date is the app's arithmetic, the doctor's own words are in the quote.
   */
  dueDate?: string;
  /** the speaker said "about" / "大约" themselves */
  dueApprox?: boolean;
  requiredLine?: RequiredLineId | null;
  confirmedBy: "patient" | "label" | null;
  /** his answer in the review (lib/visit/verdict.ts), null while he has not answered */
  verdict?: "right" | "wrong" | "unsure" | null;
  /** he said this is not right: kept and shown with a mark, never deleted */
  disputed?: boolean;
  /** C2 track E (the demo's review): how many times he changed his answer about it (the item's history), when any */
  changes?: number;
}

export interface DocCardView {
  id: string;
  kind: "doc";
  anchor: string;
  rows: DocRow[];
  /** the whole sentence as said */
  quote: string;
  tStartMs: number;
  role: UtteranceRole;
  display: RoleDisplay;
  medication: boolean;
  clip: ClipView | null;
  /** every row is one he said is not right (shown with the mark 「你说这句不对」) */
  disputed?: boolean;
}

export interface BpBar {
  systolic: number;
  diastolic: number;
  day: number;
  /** at or above the doctor's R1 numbers; null when there is no R1 */
  notBelow: boolean | null;
}

/** The doctor's R1 sentence, quoted for the comparison line. */
export interface TargetRef {
  systolic: number;
  diastolic: number;
  quote: string;
  date: string;
  visitId: string;
  display: RoleDisplay;
  tStartMs: number | null;
}

export interface BpCheck {
  check: "bp";
  fromDay: number;
  toDay: number;
  fromDate: string;
  toDate: string;
  recorded: number;
  unconfirmed: number;
  avgSystolic: number;
  avgDiastolic: number;
  bars: BpBar[];
  /** R1 when it exists in the session before this visit; otherwise null and only average and count show */
  target: TargetRef | null;
  notBelow: number | null;
}

export interface MedCheck {
  check: "med";
  meds: { id: string; labelLine: string; drugName: string }[];
  fromDate: string;
  toDate: string;
  total: number;
  taken: number;
  missed: number;
  unconfirmed: number;
  /** weekdays (localised by the UI from day numbers) of the missed mornings */
  missedDays: number[];
  /** when every missed morning falls on one routine (tai chi Tue/Thu) */
  routine: { label: string; labelZh: string | null; days: string[] } | null;
  /**
   * An account's card: the brief's own dose summary for the same window and moment (track B's visitCheckSummary), with
   * only the days that have a missed dose, so the review can say the missed doses in the brief's own sentence
   * (components/brief/words.ts missedText). Absent in the demo.
   */
  doses?: DoseSummary;
}

export interface NoteCheck {
  check: "note";
  note: { id: string; text: string; day: number; date: string; source: "typed" | "voice_note" };
}

export interface UnknownMedCheck {
  check: "unknown_med";
  /** lib/safety fixed text (TEMPLATES.unknown_med) */
  en: string;
  zh: string;
}

export type CheckCardView = { id: string; kind: "chk"; anchor: string; d0: string } & (BpCheck | MedCheck | NoteCheck | UnknownMedCheck);

export type CardView = DocCardView | CheckCardView;

export type QItemWhy = "ripple_target" | "ripple_new_med" | "ripple_test" | QuestionOrigin;

export interface QItemView {
  id: string;
  why: QItemWhy;
  /** his own words (seed questions) or a Ripple question in both languages */
  text: { own?: string; en?: string; zh?: string };
  /**
   * An account's question from his list: whose words `text.own` is (lib/daily/questions.ts questionWords, as his question
   * list shows it). "own_words": what he typed or said, his latest words once he asked it again himself;
   * "recorded_summary": a summary kept for a question Ripple refused that he never worded himself (never shown as what
   * he asked); "pattern": the question Ripple worded from his records. Absent in the demo and for Ripple's own questions.
   */
  wording?: "own_words" | "recorded_summary" | "pattern";
  /** story day the question was written (own / pattern / refused) */
  createdDay: number | null;
  /** store question row, when one exists */
  questionId: string | null;
  state: "not_asked" | "now" | "done";
  askedBy: string | null;
  answer: {
    utteranceId: string;
    /** the visit_item he confirms in the review (the answer, or the target line for an auto answer) */
    itemId: string | null;
    text: string;
    role: UtteranceRole;
    display: RoleDisplay;
    tStartMs: number;
    /** answered by something the doctor had already said (R1 for "what counts as normal") */
    auto: boolean;
    /** his answer about it in the review (lib/visit/verdict.ts), null while he has not answered */
    verdict?: "right" | "wrong" | "unsure" | null;
    /** C2 track E (the demo's review): how many times he changed that answer, when any */
    changes?: number;
  } | null;
  medication: boolean;
}

export interface QListView {
  anchor: string;
  items: QItemView[];
  answered: number;
}

export interface VisitView {
  visit: {
    id: string;
    day: number;
    date: string;
    kind: string;
    place: string;
    status: VisitStatus;
    audioPath: string | null;
    scriptSection: string | null;
  };
  d0: string;
  /**
   * `at` is the wall clock when he agreed (kept for the record); the screen shows the story moment
   * (`storyDay`, `storyTime`, the session's clock at that moment; no time when the story clock had none).
   */
  consent: {
    given: boolean;
    at: string | null;
    storyDay: number | null;
    storyTime: string | null;
    utteranceId: string | null;
    role: UtteranceRole | null;
  };
  lines: LineView[];
  cards: CardView[];
  qlist: QListView | null;
  /**
   * The three v3 counters. `doc` counts only cards headed as a clinician's note; a medicine card whose
   * speaker is still only inferred is headed "To confirm" and counted in `toConfirm` instead.
   */
  counts: { doc: number; toConfirm: number; chk: number; q: number };
  stream: { state: "idle" | "running" | "ended"; fixture: string | null; speed: number; startedAt: number | null };
  /**
   * Scripted fallback (filming only). `allowed`: the scope can use it (a filming scope: the crew's filming session
   * in filming mode, a filming account); the switch itself shows only on the crew's browser (the rp_crew cookie:
   * components/session/useCrewBrowser), and its route answers anyone else 404 (lib/crew/gate.ts, the one gate).
   * `unlockable`: a filming scope on a server that has a crew key, so a phone that is not the crew's yet can sign in
   * with the key field on /p/visit?crew=1 (the same door as /backstage/crew). A judge sandbox has neither.
   */
  fallback: { allowed: boolean; on: boolean; unlockable: boolean };
  /**
   * C2 track E (the demo): this is a re-watch of a visit that already happened in the story (a replay copy,
   * lib/visit/pipeline.ts seedConfirmedBefore): nothing on it changes the record of the visit itself.
   */
  rewatch?: boolean;
  /** replay file for this visit (mock speech) */
  replayable: string | null;
  speech: "mock" | "trtc" | "whisper" | "tencent" | "devfake";
  /** C2: what an account's review page says beyond the record itself (absent in the demo) */
  account?: VisitAccountView;
}

/** One line he wrote himself about a visit that waits for its transcript (lib/visit/own-note.ts): his note. */
export interface OwnNoteView {
  id: string;
  text: string;
  /** when he wrote it (ISO) */
  at: string;
}

export interface VisitAccountView {
  /** his own lines about this visit (「本人记的」): his notes, never a line of the visit */
  ownNotes: OwnNoteView[];
  /**
   * While the visit waits for its transcript: "waiting", or "failed" once the server used up its attempts
   * (lib/visit/transcript-tries.ts: the recording is kept, the text could not be made). null in every other status.
   */
  transcript: "waiting" | "failed" | null;
  /**
   * This visit's record was made without AI (his own page only; false where it cannot be read): its points came from
   * the rules only and the doctor's English was not translated. C2 round three: read from the visit itself
   * (visit.ai_used, kept when the record was made), so it describes this visit whatever his setting is today. Where
   * the visit does not say (its record is not made yet, or it was made before this was kept) it is his setting as it
   * is now, and `aiOffFrom` says which.
   */
  aiOff: boolean;
  /** where `aiOff` comes from: the visit's own record, or his setting as it is now */
  aiOffFrom: "record" | "setting";
  /** his consent to AI processing is off now: the way to change it is offered (it changes the visits to come) */
  aiOffNow: boolean;
  /** the example's recorded visit played again (示例回放), never his own visit */
  sample: boolean;
  /**
   * The follow-up planned from a line of this visit he said 「是」 to (real-app 2.15): its day, 「大约」 while it is the
   * app's arithmetic from the doctor's words, and no longer once he set the day he booked (PATCH /api/visits/[id]).
   * null: none planned, or it already happened.
   */
  followUp: { id: string; date: string; approx: boolean } | null;
  /**
   * Ripple's final summary of the visit (lib/visit/ripple-summary.ts), written from the whole transcript once the record
   * was made, with his consent and a live model; null or absent: none (yet). Drawn at the top of the review, labelled as
   * Ripple's and not confirmed, above the doctor's own lines. Never a source for an answer.
   */
  summary?: VisitSummaryView | null;
}

/** Ripple's summary of a visit (lib/visit/ripple-summary.ts): its notes of what was said, not confirmed, never a source. */
export interface VisitSummaryView {
  /** live: while the visit is recorded (the event visit.summary only); final: from the whole transcript, kept */
  stage: "live" | "final";
  /** the language it is written in (his) */
  lang: "zh-Hans" | "en";
  /** at most four, the most important first; each with the ids of the lines it rests on */
  points: { text: string; lines: string[] }[];
  /** when it was written (ISO) */
  madeAt: string;
}
