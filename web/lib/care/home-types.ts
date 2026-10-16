/**
 * Her home on a real account (/f, GET /api/family/view?link=; C2 track D, the daughter brief B, C, D, F): what the server
 * hands her page. Types only; client-safe.
 *
 * Every section is there only while his switch for her link is on; a switch that is off leaves its section out, so
 * nothing hidden is in the page or the response.
 *
 * The owner's decision of 2026-10-14: the same six switches, and each one shows its kind in full while it is on (until
 * then the first three gave her only "whether and how many": never a reason, a count of readings, a count of questions).
 *   dose_summary      every medicine named in every row ("Amlodipine", "Losartan"), what he answered, when, and the
 *                     reason he gave when he did not take it (CellView.reason)
 *   bp_summary        this week's readings themselves, with the pulse when he recorded one (BpReadingView), and how many
 *   questions_count   the words of the questions waiting for a visit and who each is for (QuestionView), how many, and the
 *                     next visit's date and place
 * Unchanged: the no-reply alert, his visit records (only lines he confirmed as the doctor's or the pharmacist's), his
 * notes; and with the no-reply switch on alone, the alert in its own form and nothing of the above.
 */
import type { DoctorName } from "@/lib/daily/visit-details";
import type { DaySlot, FamilyGrantItems, QuestionFor } from "@/lib/store/types";

/** One medicine in one slot, as she may see it. */
/** untracked: its window closed before he started using Ripple (lib/daily/cells.ts tracked), so there is no record */
export type CellMark = "taken" | "missed" | "no_reply" | "waiting" | "pending" | "untracked";
/** One day on the 7-dot strip: shape, colour and words together (taken: teal filled tick; missed: amber ring; no
 * reply: amber ring with a bell; pending: dashed ring; none: grey dash = nothing to record that day). */
export type DayMark = "taken" | "missed" | "no_reply" | "pending" | "none";

export interface CellView {
  medicationId: string;
  name: string;
  strength: string | null;
  mark: CellMark;
  /** when he answered (ISO), for taken / missed */
  at: string | null;
  /**
   * the reason he gave when he did not take it (owner, 10-14): the words of the reason he tapped, or his own words, as
   * stored with his answer and as his Today shows them (dose_log.reason_text). null for every other mark, and for a
   * missed dose he gave no reason for
   */
  reason: string | null;
}

export interface SlotView {
  slot: DaySlot;
  /** "08:45" first reminder, "09:15" second, "09:45" closes */
  first: string;
  second: string;
  closes: string;
  phase: "before" | "first" | "second" | "closed";
  cells: CellView[];
}

export interface WeekDayView {
  date: string;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  isToday: boolean;
  mark: DayMark;
  slots: SlotView[];
}

export interface WeekView {
  /** 0 = this week, -1 = the week before, ... */
  offset: number;
  fromDate: string;
  toDate: string;
  days: WeekDayView[];
  /** days with something to record so far, and those with every dose taken (the brief's own numbers) */
  daysDue: number;
  daysAllTaken: number;
}

/**
 * What today's headline says (the brief B1-B5), for the slot that matters now. answered: only the no-reply switch is on
 * and he answered the reminder after her alert (what he answered is the dose switch's, so it is not said).
 */
export type HomeState = "before" | "reminding" | "taken" | "missed" | "mixed" | "no_reply" | "not_logged" | "untracked" | "answered" | "no_meds";

export interface TodayStatus {
  state: HomeState;
  slot: SlotView | null;
  /** the latest answer time today in this slot (ISO) */
  at: string | null;
}

/** One line of today's timeline (like a visit transcript): what happened, when. */
export interface TimelineLine {
  /** ISO */
  at: string;
  /** answered: he answered after the window, what he answered not said (the no-reply switch on alone) */
  kind: "reminded" | "reminded_again" | "taken" | "missed" | "later" | "no_reply" | "told_you" | "late_taken" | "late_missed" | "answered";
  /** the medicines it is about, by name (for answers) */
  meds: string[];
  /** a reminder that got no reply (amber 「没有回」) */
  unanswered?: boolean;
}

export interface NoReplyView {
  slot: SlotView;
  /** when her alert went out (ISO), when there is a delivery row */
  sentAt: string | null;
  /** he answered every medicine of that slot since */
  answeredSince: boolean;
  /** his later answer and when */
  answer: "taken" | "missed" | "mixed" | null;
  answeredAt: string | null;
}

export interface ReminderNow {
  /** the words of the clip that plays (its own transcript), or null: shown as 「女儿的录音」 only */
  text: string | null;
  /** who: her own recording, the labelled stand-in, or another family member's */
  whose: "yours" | "stand_in" | "other";
  /** the morning's first reminder time, "08:45" */
  at: string;
}

/**
 * One line she added to his details (real-app 3.10 补档案): what she wrote, and whether he has confirmed it. Her own
 * words only: when he changed the wording, `edited` says so and `text` is still hers.
 */
export interface HerFact {
  id: string;
  /** lib/care/facts.ts HER_FACT_KINDS */
  kind: string;
  text: string;
  /** a routine proposal's time ("08:00"), for her screen to word; null for every other kind */
  time: string | null;
  state: "waiting" | "confirmed";
  edited: boolean;
  /** when she wrote it (ISO) */
  at: string;
  confirmedAt: string | null;
}

/** How her own proposals stand: how many wait for his answer, how many he confirmed. */
export interface HerFactsSummary {
  waiting: number;
  confirmed: number;
}

/**
 * One blood pressure reading as she may see it (bp_summary on; owner, 10-14: the readings themselves). Only a reading
 * he recorded with both numbers; never the seed's note, never the changes he made to it.
 */
export interface BpReadingView {
  /** the reading's id: what her screen names when she holds it (lib/explain/subjects.ts `bp`); it says nothing by itself */
  id: string;
  /** his date of the reading, YYYY-MM-DD */
  date: string;
  slot: DaySlot;
  /** when he recorded it (ISO), only when he did so on that day (a backfilled or seeded row has its day and slot, no time) */
  at: string | null;
  systolic: number;
  diastolic: number;
  /** the pulse he read off the monitor, when he recorded one */
  pulse: number | null;
}

/**
 * One question waiting for a visit as she may see it (questions_count on; owner, 10-14: its words). `text` is the
 * question as it is stored on his list; what he typed to Ripple around it is not read for her.
 */
export interface QuestionView {
  /** the question's id: what her screen names when she holds it (lib/explain/subjects.ts `question`) */
  id: string;
  /** who it is for */
  for: QuestionFor;
  text: string;
  lang: string | null;
}

export interface FamilyHomeData {
  linkId: string;
  /** how she calls him ("爸爸"), or null: her page says 爸爸 / Dad */
  patientLabel: string | null;
  /** his today (his time zone) */
  today: string;
  /** the server's now (ms) when built; the page keeps the newer copy */
  generatedAt: number;
  grants: FamilyGrantItems;
  /**
   * which change of his switches this copy was built at (the link's grant version; 0 when the caller did not say). Her
   * page never lets a copy built at an older change replace what a newer change left on screen: a read that was on
   * its way when he switched something off must not bring that section back.
   */
  grantsVersion: number;
  /**
   * dose_summary on: today's main slot. The no-reply switch on alone: only while today has an alert, no_reply (open) or
   * answered (he answered since), with the slot's cells left out (no medicine names, no marks)
   */
  status: TodayStatus | null;
  /**
   * dose_summary on: today's main slot as a timeline. The no-reply switch on alone: the alert's lines only (the
   * reminders, when it became 「没回」 and she was told, a neutral 「他回了提醒」), never what he answered
   */
  timeline: TimelineLine[];
  week: WeekView | null;
  /** no_reply_alert on, and today's main slot got no reply */
  noReply: NoReplyView | null;
  /** bp_summary on: this week's readings, newest first, and how many they are (owner, 10-14; before: the count alone) */
  bp: { count: number; readings: BpReadingView[] } | null;
  /**
   * questions_count on: how many questions wait for a visit; the words of the newest of them, at most QUESTIONS_SHOWN
   * (lib/care/home.ts; owner, 10-14; before: the count alone); and the next planned visit (the questions wait for it):
   * its date and, when one is written, its place
   */
  questions: {
    waiting: number;
    items: QuestionView[];
    nextVisit: string | null;
    nextVisitPlace: string | null;
    /** owner 10-15 (scene 2's job, additive): the next visit's time ("10:30") and doctor, when the scope has them */
    nextVisitTime?: string | null;
    nextVisitDoctor?: DoctorName | null;
  } | null;
  /**
   * his last record she may know of (the no-reply screen): only from sections she sees. `at` only when he made it on
   * that day (a backfilled or seeded row has its day and part of the day, no time)
   */
  lastRecord: { at: string | null; date: string; slot: DaySlot | null; what: "dose" | "bp" } | null;
  visitsShared: boolean;
  notesShared: boolean;
  /** the reminder his phone plays (always hers to see: her own recording or the stand-in) */
  reminder: ReminderNow | null;
  /** what she added to his details through this link (hers to see whatever his switches: it is her own writing) */
  facts: HerFactsSummary;
  /**
   * The family texts asked again (owner, 2026-10-14; lib/care/reconsent.ts): set while he or she has not agreed to the
   * family text in force for this link, and then `grants` is the alert-only form. Her home says why in one quiet line;
   * `hers` false: the card with her text and 「同意新的说明」. Absent or null: nothing waits.
   */
  reconsent?: { his: boolean; hers: boolean } | null;
  /**
   * Scene 1 (owner, 2026-10-15): he is recording a visit right now (lib/care/live-visit.ts recordingNow). Her home says so
   * whatever his switches, once he has acknowledged her link and while it does not wait for the family text; `shared`:
   * his visit records are hers to see, so the banner opens the visit live (else it says only that it is being recorded).
   * Absent or null: no recording now.
   */
  liveVisit?: { id: string; startedAt: string | null; shared: boolean } | null;
  /**
   * Owner 10-16 (lib/care/told.ts): today he told Ripple something that may need attention (Ripple answered his own
   * message on the emergency route), the newest such notice sent to her link: its id (the conversation's address) and
   * when it went to her. THE BASELINE: whatever his switches (hideOff keeps it). Nothing of what was said is on her home:
   * the line leads to the conversation. Absent or null: none today.
   */
  told?: { id: string; at: string } | null;
}

/** A visit she may read (visit_transcripts on): the doctor's confirmed words only. */
export interface SharedVisitLine {
  id: string;
  /** who said it */
  speaker: "doctor" | "dispenser" | "pharmacist";
  text: string;
  lang: string | null;
  tStartMs: number | null;
  /** a translation that passed both checks (lib/translate), shown under the English; null: English only */
  zh: string | null;
  /** her link to the line's own sound, or null */
  clipUrl: string | null;
  standIn: boolean;
}

export interface SharedVisit {
  id: string;
  date: string;
  place: string;
  kind: string;
  lines: SharedVisitLine[];
}

export interface SharedNote {
  id: string;
  date: string;
  text: string;
  source: "typed" | "voice_note";
}
