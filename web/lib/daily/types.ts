/**
 * Shapes shared by the M4 routes, server pages and client components (types only; client-safe).
 */
import type { DaySlot, DoseState, QuestionFor, QuestionOrigin } from "@/lib/store/types";

/** One due dose on Today, with what he answered (M0's DueDose plus the reason). */
export interface TodayDose {
  medication_id: string;
  day: number;
  slot: DaySlot;
  name: string;
  strength: string | null;
  label_confirmed: boolean;
  /** null = no answer recorded yet */
  state: DoseState | null;
  /** option code: later, no_reply, undone, forgot, away, not_with_me, own_words, <routine>_morning ... */
  reason: string | null;
  /** his own words for the reason, or the chip's label */
  reason_text: string | null;
}

/** A reason chip after 没吃 (his answer; never advice). */
export interface ReasonOption {
  code: string;
  label: { en: string; zh: string };
}

/** Reminder times for a dose slot on a story day ("HH:MM"). */
export interface ReminderSchedule {
  /** first reminder: after breakfast (plays_at "after_breakfast") */
  first: string;
  /** second reminder */
  second: string;
  /** after this, a dose with no answer is recorded as unconfirmed (reason no_reply) */
  closes: string;
}

/** A chip for a quoted line: who said it, and how sure Ripple is of the speaker. */
export interface LineChip {
  kind: "doctor" | "dispenser" | "pharmacist" | "label" | "leaflet" | "records" | "recording" | "ripple" | "family" | "self";
  /** the speaker is Ripple's inference (推断：医生), not confirmed by him */
  inferred?: boolean;
  date?: string | null;
  tStartMs?: number | null;
  standInVoice?: boolean;
}

/** The doctor's own number (R1) for the blood pressure page, with where and when he said it. */
export interface DoctorTarget {
  sourceId: string;
  /** R1 word for word */
  text: string;
  systolic: number;
  diastolic: number;
  visitId: string;
  date: string;
  day: number;
  tStartMs: number | null;
  clipUrl: string | null;
  standInVoice: boolean;
  chip: LineChip;
}

export interface BpReadingView {
  id: string;
  day: number;
  date: string;
  slot: DaySlot;
  systolic: number | null;
  diastolic: number | null;
  state: "recorded" | "unconfirmed";
}

export interface BpView {
  day: number;
  readings: BpReadingView[];
  /** null before the doctor said a number (no comparison line at all) */
  target: DoctorTarget | null;
  /** the doctor's measuring lines from this session's confirmed or inferred visit items (verbatim), if any */
  measuring: QuotedLine[];
}

export interface QuotedLine {
  sourceId: string;
  text: string;
  chip: LineChip;
  visitId: string;
  date: string;
  tStartMs: number | null;
  clipUrl: string | null;
}

/**
 * What the shown question text is (wave B): his own words (typed by him: data-verbatim), a recorded summary (a
 * seeded question's wording, not his words: never shown as verbatim), or Ripple's wording of a pattern in his log.
 */
export type QuestionWording = "own_words" | "recorded_summary" | "pattern";

export interface QuestionItemView {
  id: string;
  for: QuestionFor;
  origin: QuestionOrigin;
  /** shown text: his words, or Ripple's pattern wording in the UI language */
  text: string;
  lang: string | null;
  /** what `text` is (lib/daily/questions.ts questionWords) */
  wording: QuestionWording;
  /** a recorded summary shown next to his own words (the seeded question he asked again in his words), or null */
  summary: { text: string; lang: string | null } | null;
  /** status on this story day: an answer recorded at a later visit is not shown yet (open) */
  status: "open" | "answered" | "skipped";
  createdDay: number | null;
  answer: QuotedLine | null;
}

export interface QuestionsView {
  day: number;
  doctor: QuestionItemView[];
  pharmacist: QuestionItemView[];
}

export interface FamilyAlert {
  id: string;
  day: number;
  date: string;
  slot: DaySlot;
  medication_id: string;
  name: string;
  /** reminders that went unanswered before the window closed */
  reminders: number;
}

export interface FamilyAlertsResponse {
  /** family_grant.no_reply_alert */
  on: boolean;
  alerts: FamilyAlert[];
}

export interface ReminderClipView {
  id: string;
  by: string;
  text: string | null;
  lang: string | null;
  plays_at: string;
  /** same-origin audio URL, or null when there is no audio */
  audio_url: string | null;
  /** the audio is a synthetic stand-in (代录音), not her own recording */
  stand_in: boolean;
  /** C2 track B: how the clip names her on an account ("Wei Ling（示例）", her link's label); absent on the demo */
  by_label?: string | null;
  /**
   * C2 track S (round 2): the relation on the care link the clip was recorded through ("daughter", "son" ...), so his
   * card says whose recording it is (real-app 6.16); absent on the demo and for a clip with no link (the example's)
   */
  by_relation?: string | null;
}

export interface RemindersResponse {
  day: number;
  schedule: ReminderSchedule;
  clips: ReminderClipView[];
}
