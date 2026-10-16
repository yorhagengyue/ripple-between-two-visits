/**
 * The visit brief on an account (C2 track B, journey 14; real-app 2.18, 4.4). Server-only. The demo keeps
 * lib/summary/brief.ts buildBrief exactly as it was.
 *
 *   window      from the day after the last clinic visit that happened (track F lib/visit/happened.ts: never a planned
 *               visit, an empty recording, one still waiting for its transcript or a replay copy; the pharmacy is not a
 *               boundary) to today, in real dates
 *   bp          readings in the window, their average, how many were not below the target he confirmed (track F
 *               doctorNumbers; the target's own words quoted), and every reading above the doctor's warning line on a
 *               line of its own (its date, time and numbers; never a judging word). C2 track S, round 2: which warning
 *               line is lib/safety/threshold.ts rule A, the same line the blood pressure page relays (the latest one
 *               said at a visit, reviewed or not), so the page and the brief agree before he reviews the visit too; an
 *               unreviewed line is labelled as inferred, one he marked "not right" says so (`above.review`)
 *   doses       cell by cell (lib/summary/scope-doses.ts): an unanswered cell counts only once its window closed and only
 *               when it is tracked; the routine the missed ones fall on
 *   signals     (10-14, the owner's decision) what he told Ripple that is for the doctor (chest pain, a stroke sign, a reading
 *               above the doctor's line), his words with his date and clock time (lib/summary/signals.ts), in a section of
 *               its own, 「要告诉医生的情况」; read-only. Those words are left out of notes
 *   notes       his notes in the window, word for word; a note on a new topic since the last visit marked as such
 *   questions   the same three as the visit screen (lib/summary/questions.ts briefQuestions: refused > pattern > his own)
 *   english     his own words in English for the doctor (track S lib/translate: checked twice, kept); without his consent
 *               to AI processing, or when a check fails, there is none and the brief says his words are not translated
 *   meds        his list today; one new since the last visit marked
 *   diet        track K's diet check over the window (lib/diet/summary.ts weeklyDietLine): counts only, or nothing
 *   nextVisit   the next planned visit (the countdown, the doctor view's heading)
 */
import { doctorLineView, type DoctorLineView } from "@/lib/daily/bp";
import { countedDoseRows } from "@/lib/daily/cells";
import { d0Of, routineOf } from "@/lib/daily/doses";
import { clockWords } from "@/lib/daily/i18n";
import { answerMoment, askedWordsByQuestion, questionDay } from "@/lib/daily/questions";
import type { DoctorTarget } from "@/lib/daily/types";
import { weeklyDietLine, type DietBriefLine } from "@/lib/diet/summary";
import type { Locale } from "@/lib/i18n";
import { aiConsent } from "@/lib/safety/consent";
import { reviewOf, warningLineOf } from "@/lib/safety/threshold";
import { scopeTz } from "@/lib/store/scope";
import type { SessionRow, Store, VisitRow } from "@/lib/store/types";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { localHHMM } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { cachedTranslation, translateOwnWords } from "@/lib/translate";
import { zhLookup } from "@/lib/translate/shown";
import { doctorNumbers } from "@/lib/visit/doctor-numbers";
import { happenedVisits } from "@/lib/visit/happened";
import { isSignalNote } from "@/lib/daily/signals";
import { summarizeBp } from "./bp";
import type { BriefView } from "./brief";
import { prescribingLines } from "@/lib/meds/on-day";
import { medsForBrief } from "./meds";
import { notesInWindow } from "./notes";
import { briefQuestions, waitingQuestions } from "./questions";
import { summarizeAccountDoses } from "./scope-doses";
import { briefSignals } from "./signals";
import { isClinicVisit, type SummaryWindow } from "./window";

export interface AboveReading {
  id: string;
  day: number;
  date: string;
  /** local HH:MM it was recorded */
  time: string;
  systolic: number;
  diastolic: number | null;
}

export interface NextVisit {
  date: string;
  /** days from today (0: today) */
  days: number;
  place: string;
}

export interface AccountBriefView extends BriefView {
  kind: "account";
  /** today, YYYY-MM-DD */
  date: string;
  /**
   * the doctor's warning line (lib/safety/threshold.ts rule A: the one the blood pressure page relays) and the window's
   * readings above it, each shown on its own line; `review`: he confirmed the line, has not reviewed it yet (labelled as
   * inferred), or marked it "not right" in the review (kept, and said)
   */
  above: { line: DoctorLineView; readings: AboveReading[]; review: "confirmed" | "inferred" | "disputed" } | null;
  /** the target as the account's page quotes it (clip, stand-in, state) */
  targetLine: DoctorLineView | null;
  /** his words (notes, questions) in English for the doctor: original text -> checked translation */
  english: Record<string, string>;
  /** he agreed to AI processing (translations can be made) */
  aiAllowed: boolean;
  /**
   * C2 track S (round 2; real-app 12): the checked Chinese of the doctor's English lines quoted in the brief (the target,
   * the warning line), by their English words, for his Chinese brief; empty in English, without his consent to AI
   * processing, or when a line has no checked translation (lib/translate/shown.ts)
   */
  doctorZh: Record<string, string>;
  nextVisit: NextVisit | null;
  /** track K's diet check over the brief's window (counts only, in the brief's language), or null */
  diet: DietBriefLine | null;
}

export interface AccountBriefOptions {
  nowMs?: number;
  /** "model": translate what is not kept yet (his consent permitting), within `translateMs`; "cache": only what is kept */
  translate?: "model" | "cache";
  translateMs?: number;
}

/** The next planned visit on or after today, or null. */
export function nextPlannedVisit(visits: Pick<VisitRow, "status" | "date" | "place">[], today: string, d0: string): NextVisit | null {
  const planned = visits.filter((v) => v.status === "planned" && v.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const v = planned[0];
  if (!v) return null;
  return { date: v.date, days: dayOfDate(d0, v.date) - dayOfDate(d0, today), place: v.place };
}

function asDoctorTarget(line: DoctorLineView, d0: string): DoctorTarget {
  return {
    sourceId: `visit:${line.visitId}:${line.utteranceId ?? line.kind}`,
    text: line.text,
    systolic: line.systolic,
    diastolic: line.diastolic ?? 0,
    visitId: line.visitId,
    date: line.date,
    day: dayOfDate(d0, line.date),
    tStartMs: line.tStartMs,
    clipUrl: line.clipUrl,
    standInVoice: line.standIn,
    chip: { kind: "doctor", inferred: line.state !== "confirmed", date: line.date, tStartMs: line.tStartMs, standInVoice: line.standIn },
  };
}

/**
 * His own words' English (cached first; the model only when allowed and asked for, within the time given).
 * Exported for the demo's brief (C2 track E: lib/summary/brief.ts), which shows the same checked translations.
 */
export async function englishFor(store: Store, scopeId: string, texts: string[], aiAllowed: boolean, opts: AccountBriefOptions): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(texts.map((t) => t.trim()).filter((t) => /\p{Script=Han}/u.test(t)))];
  const signal = opts.translate === "model" ? AbortSignal.timeout(opts.translateMs ?? 6_000) : undefined;
  await Promise.all(
    unique.map(async (text) => {
      try {
        const t =
          opts.translate === "model" && aiAllowed
            ? await translateOwnWords(store, scopeId, text, { aiAllowed, signal })
            : await cachedTranslation(store, scopeId, text, "zh-Hans>en");
        if (t?.text) out[text] = t.text;
      } catch {
        // no translation: the brief shows his words, marked as not translated
      }
    }),
  );
  return out;
}

export async function buildAccountBrief(store: Store, scope: SessionRow, locale: Locale, opts: AccountBriefOptions = {}): Promise<AccountBriefView> {
  const nowMs = opts.nowMs ?? appNowMs();
  const day = scope.story_day;
  const d0 = d0Of(scope);
  const today = storyDate(d0, day);
  const routine = routineOf(scope);
  const [visitsAll, readings, doses, meds, notes, questions, numbers] = await Promise.all([
    store.listVisits(scope.id),
    store.listBp(scope.id, { toDay: day }),
    store.listDoses(scope.id, { toDay: day }),
    store.listMeds(scope.id),
    store.listNotes(scope.id, { toDay: day }),
    store.listQuestions(scope.id),
    doctorNumbers(store, scope.id, { day, time: scope.story_time ?? null }),
  ]);
  const happened = await happenedVisits(store, scope.id, visitsAll);
  const window = sinceLastHappenedVisit(happened, day, d0);
  const lastDay = window.lastVisit?.day ?? null;
  const targetLine = numbers.target ? doctorLineView(scope, numbers.target, locale) : null;
  // C2 track S (round 2): rule A's line, the same one the blood pressure page relays next to a reading above it
  const warning = warningLineOf(numbers);
  const thresholdLine = warning ? doctorLineView(scope, warning, locale) : null;
  const before =
    lastDay === null
      ? { notes: [], questions: [] }
      : {
          notes: notes.filter((n) => n.day <= lastDay),
          questions: questions.filter((q) => {
            const d = questionDay(q, visitsAll);
            return d !== null && d <= lastDay;
          }),
        };
  const [asked, moment, aiAllowed, diet] = await Promise.all([
    askedWordsByQuestion(store, scope.id),
    answerMoment(store, scope, visitsAll, questions),
    aiConsent(store, scope),
    weeklyDietLine(store, scope, locale, { fromDay: window.fromDay, toDay: window.toDay }),
  ]);
  // the pattern question counts as the dose lines do (real-app 4.4: never an untracked cell)
  const waiting = waitingQuestions({ questions, visits: visitsAll, doses: countedDoseRows(scope, meds, doses), meds, routine, d0, day, moment, locale, asked });
  const shownQuestions = briefQuestions(waiting);
  // 10-14: what he told Ripple to tell the doctor stands in its own section, with his clock time; not his notes here again
  const signals = await briefSignals(store, scope, locale);
  const noteItems = notesInWindow({ notes: notes.filter((n) => !isSignalNote(n)), fromDay: window.fromDay, toDay: window.toDay, d0, before });
  const inWindow = readings.filter((r) => r.day >= window.fromDay && r.day <= window.toDay);
  const above: AboveReading[] = thresholdLine
    ? inWindow
        .filter((r) => r.state === "recorded" && r.systolic !== null && r.systolic > thresholdLine.systolic)
        .map((r) => ({ id: r.id, day: r.day, date: storyDate(d0, r.day), time: localHHMM(Date.parse(r.created_at), scopeTz(scope)), systolic: r.systolic!, diastolic: r.diastolic }))
    : [];
  // his notes and the questions' words (his own, or the recorded summary of a question he asked): their English for the doctor
  const ownWords = [...signals.map((s) => s.text), ...noteItems.map((n) => n.text), ...shownQuestions.shown.filter((q) => q.wording !== "pattern").map((q) => q.text)];
  const english = await englishFor(store, scope.id, ownWords, aiAllowed, opts);
  // C2 track S (round 2): the doctor's two English lines with their checked Chinese under them, on his Chinese brief
  const zh = await zhLookup(store, scope, { locale, aiAllowed });
  const doctorZh: Record<string, string> = {};
  for (const line of [targetLine, thresholdLine]) {
    const t = line ? zh(line.text) : null;
    if (line && t) doctorZh[line.text] = t;
  }
  return {
    kind: "account",
    day,
    date: today,
    window,
    bp: summarizeBp(readings, window.fromDay, window.toDay, targetLine ? { systolic: targetLine.systolic, diastolic: targetLine.diastolic ?? 0 } : null),
    target: targetLine ? asDoctorTarget(targetLine, d0) : null,
    targetLine,
    above: thresholdLine && warning ? { line: thresholdLine, readings: above, review: reviewOf(warning) } : null,
    doses: summarizeAccountDoses({ scope, meds, doses, fromDay: window.fromDay, toDay: window.toDay, nowMs, routine }),
    signals,
    notes: noteItems,
    questions: shownQuestions,
    // C2 track S (round 2): his list at this moment (lib/meds/on-day.ts): before today's visit, not what it prescribes
    meds: medsForBrief(meds, visitsAll, day, lastDay, locale, { time: scope.story_time ?? null, lines: await prescribingLines(store, scope.id, meds, visitsAll, day) }),
    english,
    aiAllowed,
    doctorZh,
    nextVisit: nextPlannedVisit(visitsAll, today, d0),
    diet,
  };
}

/** "晚上 8:15" / "8:15 pm" for a reading's time on the brief. */
export function readingTimeWords(locale: Locale, hhmm: string): string {
  return clockWords(locale, hhmm);
}

/**
 * An account's window: from the day after the last clinic visit that happened, today's included (a visit this morning
 * starts the next brief tomorrow; until then the window is empty), to today. Before any visit: from day 0.
 */
export function sinceLastHappenedVisit(happened: VisitRow[], today: number, d0: string): SummaryWindow {
  const last = happened.filter((v) => isClinicVisit(v) && v.day <= today).sort((a, b) => a.day - b.day).at(-1) ?? null;
  const fromDay = last ? last.day + 1 : 0;
  return {
    fromDay,
    toDay: today,
    fromDate: storyDate(d0, fromDay),
    toDate: storyDate(d0, today),
    lastVisit: last ? { id: last.id, day: last.day, date: last.date, kind: last.kind, place: last.place } : null,
  };
}
