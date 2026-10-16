/**
 * Shapes for Wei Ling's view (/f) and Mr Tan's switches (/p/family). Types only; client-safe.
 *
 * A section exists in FamilyViewData only while Mr Tan has its switch on: the server never sends data for a switch
 * that is off (lib/family/view.ts), so nothing hidden is in the page or in any response.
 */
import type { LineChip } from "@/lib/daily/types";
import type { DueDose } from "@/lib/session/today";
import type { FamilyGrantItems, FamilyGrantRow } from "@/lib/store/types";

export const GRANT_KEYS = ["dose_summary", "bp_summary", "questions_count", "no_reply_alert", "visit_transcripts", "notes"] as const satisfies readonly (keyof FamilyGrantItems)[];
export type GrantKey = (typeof GRANT_KEYS)[number];

export const FAMILY_MEMBER = "wei-ling";

export interface FamilyWeek {
  fromDay: number;
  toDay: number;
  fromDate: string;
  toDate: string;
}

export interface FamilyDoseSection {
  week: FamilyWeek;
  /** days this week with a due dose (today only once it was answered or its window closed) */
  daysDue: number;
  /** days on which every due dose was taken */
  daysTaken: number;
  daysMissed: number;
  daysUnconfirmed: number;
  /** this morning's doses, live on the page (M0's family-dose-<med>) */
  today: DueDose[];
}

export interface FamilyBpSection {
  week: FamilyWeek;
  /** readings with both numbers this week; the numbers themselves are not shown */
  count: number;
  unconfirmed: number;
}

export interface FamilyQuestionsSection {
  /** questions waiting for the next visit (count only) */
  waiting: number;
}

export interface FamilyVisitLine {
  id: string;
  text: string;
  lang: string | null;
  /** who said it: kind "self" is Mr Tan; clinicians carry inferred until he confirms */
  chip: LineChip;
}

export interface FamilyVisit {
  id: string;
  day: number;
  date: string;
  place: string;
  lines: FamilyVisitLine[];
}

export interface FamilyNote {
  id: string;
  day: number;
  date: string;
  text: string;
  lang: string | null;
}

export interface FamilyViewData {
  day: number;
  grants: FamilyGrantItems;
  /** server clock when built: the page keeps whichever copy is newer (render or refetch) */
  generatedAt: number;
  doses?: FamilyDoseSection;
  bp?: FamilyBpSection;
  questions?: FamilyQuestionsSection;
  visits?: FamilyVisit[];
  notes?: FamilyNote[];
}

/** family_grant.changed */
export interface FamilyGrantChangedData {
  grant: FamilyGrantRow;
  /** the switches this change set */
  changed: Partial<FamilyGrantItems>;
}

export interface GrantsResponse {
  member: string;
  items: FamilyGrantItems;
  updated_at: string | null;
}

export const NO_GRANTS: FamilyGrantItems = {
  dose_summary: false,
  bp_summary: false,
  questions_count: false,
  no_reply_alert: false,
  visit_transcripts: false,
  notes: false,
};
