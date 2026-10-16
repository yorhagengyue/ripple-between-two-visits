/**
 * The visit screen's check card and question list on an account, counted the way the brief counts (C2 track B, for
 * track F's lib/visit/view.ts; real-app 4.4 「核对卡和简报用同一口径」: the card's window runs to the moment the visit
 * started, the brief's to now, and the visit day's cell follows the same rule). Server-only.
 *
 *   window     from the day after the clinic visit before this one that happened (track F happenedVisits: a planned
 *              visit, an empty recording or a replay copy is not a boundary, nor is the pharmacy) to this visit's day
 *   doses      cell by cell (scopeDoseSummary) as of the moment the visit started: an answered cell counts; a cell
 *              whose window closed before that moment, tracked and unanswered, is not confirmed; any other cell of the
 *              visit day not yet; a cell from before he started (4.4) never. A brief opened at that moment says the same.
 *   bp         the readings recorded in the window before the visit started (summarizeBp, as the brief), next to the
 *              target he confirmed at an earlier visit (track F's confirmedTarget over the visits before this one)
 *   questions  the brief's three (briefQuestions over waitingQuestions: refused > pattern > his own), and how many more
 * A demo session keeps its own card in lib/visit/view.ts; call this for an account.
 */
import { countedDoseRows } from "@/lib/daily/cells";
import { d0Of, routineOf } from "@/lib/daily/doses";
import { answerMoment, askedWordsByQuestion } from "@/lib/daily/questions";
import type { Locale } from "@/lib/i18n";
import type { SessionRow, Store, UtteranceRow, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { liveTranscript } from "@/lib/safety/line-state";
import { confirmedTarget, type DoctorNumber } from "@/lib/visit/doctor-numbers";
import { happenedVisits } from "@/lib/visit/happened";
import { summarizeBp, type BpSummary } from "./bp";
import type { DoseSummary } from "./doses";
import { briefQuestions, waitingQuestions, type WaitingQuestion } from "./questions";
import { appMsOf } from "@/lib/store/scope";
import { scopeDoseSummary } from "./scope-doses";
import { isClinicVisit, type SummaryWindow } from "./window";

export interface VisitCheckSummary {
  window: SummaryWindow;
  doses: DoseSummary;
  bp: BpSummary;
  /** the target the readings are put next to (said and confirmed at an earlier visit), or null */
  target: DoctorNumber | null;
  questions: { shown: WaitingQuestion[]; more: number };
}

export async function visitCheckSummary(store: Store, scope: SessionRow, input: { visit: Pick<VisitRow, "id" | "day">; startedMs: number; locale: Locale }): Promise<VisitCheckSummary> {
  const { visit, startedMs, locale } = input;
  const d0 = d0Of(scope);
  const [visits, readings, doseRows, meds, questions, items] = await Promise.all([
    store.listVisits(scope.id),
    store.listBp(scope.id, { toDay: visit.day }),
    store.listDoses(scope.id, { toDay: visit.day }),
    store.listMeds(scope.id),
    store.listQuestions(scope.id),
    store.listVisitItems(scope.id),
  ]);
  const earlier = (await happenedVisits(store, scope.id, visits)).filter((v) => v.id !== visit.id && v.day < visit.day);
  const prev = earlier.filter(isClinicVisit).sort((a, b) => b.day - a.day)[0] ?? null;
  const fromDay = prev ? prev.day + 1 : 0;
  const toDay = visit.day;
  const window: SummaryWindow = {
    fromDay,
    toDay,
    fromDate: storyDate(d0, fromDay),
    toDate: storyDate(d0, toDay),
    lastVisit: prev ? { id: prev.id, day: prev.day, date: prev.date, kind: prev.kind, place: prev.place } : null,
  };

  // the target he confirmed at a visit before this one (a line said in this visit is not yet a comparison line)
  const numberItems = items.filter((i) => (i.type === "target" || i.type === "threshold") && earlier.some((v) => v.id === i.visit_id));
  const transcripts = new Map<string, readonly UtteranceRow[]>();
  for (const id of new Set(numberItems.map((i) => i.visit_id))) transcripts.set(id, liveTranscript(await store.listUtterances(scope.id, id)));
  const target = confirmedTarget({ visits: earlier, items: numberItems, transcripts });

  const before = readings.filter((r) => r.day < visit.day || (r.day === visit.day && Date.parse(r.created_at) <= startedMs));
  const [doses, asked, moment] = await Promise.all([
    // C2 track J (filming): startedMs comes from the visit's stamps (on the account's own clock); the dose day takes the
    // app's clock (the same instant for every account that is not filming)
    scopeDoseSummary(store, scope, { fromDay, toDay, nowMs: appMsOf(scope, startedMs) }),
    askedWordsByQuestion(store, scope.id),
    answerMoment(store, scope, visits, questions),
  ]);
  // the pattern question counts as the brief does (real-app 4.4: never an untracked cell)
  const waiting = waitingQuestions({ questions, visits, doses: countedDoseRows(scope, meds, doseRows), meds, routine: routineOf(scope), d0, day: visit.day, moment, locale, asked });
  return {
    window,
    doses,
    bp: summarizeBp(before, fromDay, toDay, target ? { systolic: target.systolic, diastolic: target.diastolic ?? 0 } : null),
    target,
    questions: briefQuestions(waiting),
  };
}
