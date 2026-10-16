/**
 * Which story days a summary covers (M6 family view, M7 visit brief). Pure; client-safe.
 *
 *   sinceLastVisit  the brief: from the day after the last clinic visit before the story day, to the story day.
 *                   "Visit" means a visit with the doctor: the D12 pharmacy visit is not a boundary (the doctor's
 *                   brief at D41 covers 09-02 to 10-04, after the D8 clinic visit, like the D42 check card in M2).
 *                   On a visit day the visit itself is not "before the story day": the brief still covers the
 *                   time up to it. Before any visit the window starts at day 0.
 *   thisWeek        Wei Ling's view: Monday of the story day's calendar week up to the story day.
 */
import type { VisitRow } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";

export type VisitRef = Pick<VisitRow, "id" | "day" | "date" | "kind" | "place">;

export interface SummaryWindow {
  fromDay: number;
  toDay: number;
  fromDate: string;
  toDate: string;
  /** the clinic visit the window starts after; null before the first visit */
  lastVisit: VisitRef | null;
}

/** A visit with the doctor (or the clinic counter): not the pharmacy. */
export function isClinicVisit(v: Pick<VisitRow, "kind">): boolean {
  return v.kind !== "pharmacy";
}

/** The last clinic visit on a day before the story day, or null. */
export function lastClinicVisit<V extends VisitRef>(visits: V[], storyDay: number): V | null {
  const before = visits.filter((v) => isClinicVisit(v) && v.day < storyDay).sort((a, b) => a.day - b.day);
  return before.length ? before[before.length - 1] : null;
}

export function sinceLastVisit(visits: VisitRef[], storyDay: number, d0: string): SummaryWindow {
  const last = lastClinicVisit(visits, storyDay);
  const fromDay = last ? last.day + 1 : 0;
  const toDay = storyDay;
  return {
    fromDay: Math.min(fromDay, toDay),
    toDay,
    fromDate: storyDate(d0, Math.min(fromDay, toDay)),
    toDate: storyDate(d0, toDay),
    lastVisit: last ? { id: last.id, day: last.day, date: last.date, kind: last.kind, place: last.place } : null,
  };
}

/** Monday of the story day's week (weeks start on Monday) up to the story day. */
export function thisWeek(storyDay: number, d0: string): SummaryWindow {
  const offset = (weekdayIndex(d0, storyDay) + 6) % 7; // Monday 0 ... Sunday 6
  const fromDay = Math.max(0, storyDay - offset);
  return { fromDay, toDay: storyDay, fromDate: storyDate(d0, fromDay), toDate: storyDate(d0, storyDay), lastVisit: null };
}
