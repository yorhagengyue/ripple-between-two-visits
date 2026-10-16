/**
 * The visit brief (task M7): one page for the doctor covering the time since the last clinic visit before the story
 * day. Server-only. Everything is a count or an average of his own records, the doctor's own number (R1) word for
 * word with its date, his own notes word for word, his questions, and his medicine list:
 *
 *   bp         readings in the window, their average, how many were not below R1 (R1's own words); R1 quoted
 *   doses      due / taken / missed / unconfirmed, and the weekly routine the missed mornings fall on
 *   signals    (10-14, the owner's decision) what he told Ripple that is for the doctor (chest pain, a stroke sign, a reading
 *              above the doctor's line: lib/daily/signals.ts), word for word with its date, in a section of its own,
 *              「要告诉医生的情况」; read-only. Those words are left out of `notes`
 *   notes      every note he wrote in the window, verbatim; a note on a new topic is marked as a change
 *   questions  at most three for the doctor: refused > pattern > his own
 *   meds       his list on the story day; one that was not on it at the last visit is marked as a change
 *
 * C2 follow-up (track E; real-app 12, the demo side of what the account's brief already does, lib/summary/account-brief.ts):
 *   window     "the last visit" is a clinic visit that left a record (lib/visit/happened.ts): a recording that started and
 *              ended with nothing, a re-watch (replay copy) and a planned visit never move the window
 *   above      the readings in the window above the doctor's own warning line (R2, lib/visit/doctor-numbers.ts), each on a
 *              line of its own with its date and part of the day, next to the line quoted word for word; never a judging
 *              word. Left out when there is none
 *   english    read in English: his own words (notes, questions) with their checked English under them (track S
 *              lib/translate: made once, checked twice, kept); where there is none the sheet says his words are not
 *              translated. Never the model's words in place of his
 *
 * Story-day gating: nothing after session.story_day is read (readings, doses, notes, questions, medicines, R1). A
 * question answered at a visit waits until that answer has been said by the story moment (10-10, lib/daily/questions.ts
 * answerMoment): the D42 morning brief, before the v3 visit, still lists q-extra-tablet.
 * The counts are lib/summary's, shared with Wei Ling's view (lib/family/view.ts).
 */
import { bpView, doctorLineView, type DoctorLineView } from "@/lib/daily/bp";
import { d0Of, routineOf, scheduleFor } from "@/lib/daily/doses";
import { isSignalNote } from "@/lib/daily/signals";
import { answerMoment, askedWordsByQuestion, questionDay } from "@/lib/daily/questions";
import { windowClosed } from "@/lib/daily/schedule";
import type { DoctorTarget } from "@/lib/daily/types";
import type { Locale } from "@/lib/i18n";
import { aiConsent } from "@/lib/safety/consent";
import type { BpReadingRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { doctorNumbers } from "@/lib/visit/doctor-numbers";
import { happenedVisits } from "@/lib/visit/happened";
import { englishFor } from "./account-brief";
import { summarizeBp, type BpSummary } from "./bp";
import { summarizeDoses, type DoseSummary } from "./doses";
import { prescribingLines } from "@/lib/meds/on-day";
import { medsForBrief, type MedItem } from "./meds";
import { notesInWindow, type NoteItem } from "./notes";
import { briefQuestions, waitingQuestions, type WaitingQuestion } from "./questions";
import { briefSignals, type BriefSignal } from "./signals";
import { sinceLastVisit, type SummaryWindow } from "./window";

/** A reading above the doctor's warning line, as the demo's brief lists it (the story's readings have a part of the day, no clock time). */
export interface AboveSlotReading {
  id: string;
  day: number;
  date: string;
  slot: BpReadingRow["slot"];
  systolic: number;
  diastolic: number | null;
}

export interface BriefOptions {
  /** his words in English: "model" (default) translates what is not kept yet, within `translateMs`; "cache" only reads what is kept */
  translate?: "model" | "cache";
  translateMs?: number;
}

export interface BriefView {
  day: number;
  window: SummaryWindow;
  /**
   * the demo's brief (buildBrief): the doctor's warning line and the window's readings above it; null: no warning line
   * said yet. (The account's brief has its own, with clock times: AccountBriefView.above.)
   */
  aboveLine?: { line: DoctorLineView; readings: AboveSlotReading[] } | null;
  /** his words (notes, questions) in English for the doctor: original text -> checked translation; filled when read in English */
  english?: Record<string, string>;
  bp: BpSummary;
  /** R1 word for word with its visit date, time point and speaker state; null before the doctor said a number */
  target: DoctorTarget | null;
  doses: DoseSummary;
  /**
   * 10-14: what he told Ripple to tell the doctor (briefSignals), shown in a section of its own, 「要告诉医生的情况」 / "For the
   * doctor"; those words are not repeated under `notes`. Absent on a brief kept before it existed (brief-snapshot.ts)
   */
  signals?: BriefSignal[];
  notes: NoteItem[];
  questions: { shown: WaitingQuestion[]; more: number };
  meds: MedItem[];
}

export async function buildBrief(store: Store, session: SessionRow, locale: Locale, opts: BriefOptions = {}): Promise<BriefView> {
  const day = session.story_day;
  const d0 = d0Of(session);
  const routine = routineOf(session);
  const [visits, readings, doses, meds, notes, questions, schedule, bp, numbers] = await Promise.all([
    store.listVisits(session.id),
    store.listBp(session.id, { toDay: day }),
    store.listDoses(session.id, { toDay: day }),
    store.listMeds(session.id),
    store.listNotes(session.id, { toDay: day }),
    store.listQuestions(session.id),
    scheduleFor(store, session),
    bpView(store, session),
    doctorNumbers(store, session.id, { day, time: session.story_time ?? null }),
  ]);
  // "the last visit" is one that left a record: never an empty recording, a re-watch or a planned visit (C2)
  const window = sinceLastVisit(await happenedVisits(store, session.id, visits), day, d0);
  const target = bp.target;
  const lastDay = window.lastVisit?.day ?? null;
  const before =
    lastDay === null
      ? { notes: [], questions: [] }
      : {
          notes: notes.filter((n) => n.day <= lastDay),
          questions: questions.filter((q) => {
            const d = questionDay(q, visits);
            return d !== null && d <= lastDay;
          }),
        };
  // his own words for a refused question he asked again (the seeded one is otherwise a recorded summary, wave B), and
  // whether each recorded answer has been said yet at the story moment
  const [asked, moment] = await Promise.all([askedWordsByQuestion(store, session.id), answerMoment(store, session, visits, questions)]);
  const waiting = waitingQuestions({ questions, visits, doses, meds, routine, d0, day, moment, locale, asked });
  const shown = briefQuestions(waiting);
  // 10-14: what he told Ripple to tell the doctor stands in its own section, so those words are not his notes here again
  const signals = await briefSignals(store, session, locale);
  const noteItems = notesInWindow({ notes: notes.filter((n) => !isSignalNote(n)), fromDay: window.fromDay, toDay: window.toDay, d0, before });
  // the doctor's own warning line (R2) and the window's readings above it, each on its own line (C2; never judged)
  const thresholdLine = numbers.threshold ? doctorLineView(session, numbers.threshold, locale) : null;
  const above: AboveSlotReading[] = thresholdLine
    ? readings
        .filter((r) => r.day >= window.fromDay && r.day <= window.toDay && r.state === "recorded" && r.systolic !== null && r.systolic > thresholdLine.systolic)
        .map((r) => ({ id: r.id, day: r.day, date: storyDate(d0, r.day), slot: r.slot, systolic: r.systolic!, diastolic: r.diastolic }))
    : [];
  // read in English: his own words with their checked English (C2; the same translations as the account's brief)
  let english: Record<string, string> = {};
  if (locale === "en") {
    const ownWords = [...signals.map((s) => s.text), ...noteItems.map((n) => n.text), ...shown.shown.filter((q) => q.wording !== "pattern").map((q) => q.text)];
    // made on first reading (within the time given), kept afterwards; a caller that must not wait passes "cache"
    english = await englishFor(store, session.id, ownWords, await aiConsent(store, session), { translate: opts.translate ?? "model", translateMs: opts.translateMs });
  }
  return {
    day,
    window,
    aboveLine: thresholdLine ? { line: thresholdLine, readings: above } : null,
    english,
    bp: summarizeBp(readings, window.fromDay, window.toDay, target ? { systolic: target.systolic, diastolic: target.diastolic } : null),
    target,
    doses: summarizeDoses({
      meds,
      doses,
      fromDay: window.fromDay,
      toDay: window.toDay,
      storyDay: day,
      todayWindowClosed: windowClosed(day, day, session.story_time, schedule),
      d0,
      routine,
    }),
    signals,
    notes: noteItems,
    questions: shown,
    // C2 track S (round 2): his list at the story moment (lib/meds/on-day.ts), not the whole day
    meds: medsForBrief(meds, visits, day, lastDay, locale, { time: session.story_time ?? null, lines: await prescribingLines(store, session.id, meds, visits, day) }),
  };
}
