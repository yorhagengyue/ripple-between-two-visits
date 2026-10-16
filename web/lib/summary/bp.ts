/**
 * Blood pressure counts over a window of story days (M6 "how many readings", M7 "number of readings, their average,
 * and how many were not below the number the doctor gave"). Pure; server and client safe.
 *
 * The only comparison line is the doctor's own number (R1, "At home, we want it below 135 over 85."), and only when
 * the caller passes it (lib/daily/bp.ts gives it once it was said at a visit before the story day). The count
 * mirrors R1's own words: a reading is "below 135 over 85" when both numbers are under it, so "not below" is the
 * top number at or over the first, or the bottom number at or over the second (the same rule as M2's check card,
 * lib/visit/checks.ts buildBpCheck). Never "above", never "high": the brief only counts against what he was told.
 * A reading that was due and not taken (state unconfirmed) is counted apart and never averaged.
 */
import type { BpReadingRow } from "@/lib/store/types";

export interface BpTargetNumbers {
  systolic: number;
  diastolic: number;
}

export interface BpSummary {
  fromDay: number;
  toDay: number;
  /** readings with both numbers */
  count: number;
  /** readings that were due and not taken (未确认) */
  unconfirmed: number;
  avgSystolic: number | null;
  avgDiastolic: number | null;
  /** readings not below the doctor's number (R1); null without R1 */
  notBelow: number | null;
  target: BpTargetNumbers | null;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** R1's rule: below means both numbers under the doctor's; anything else is "not below". */
export function notBelowTarget(r: { systolic: number; diastolic: number }, target: BpTargetNumbers): boolean {
  return r.systolic >= target.systolic || r.diastolic >= target.diastolic;
}

export function summarizeBp(readings: BpReadingRow[], fromDay: number, toDay: number, target: BpTargetNumbers | null): BpSummary {
  const inWindow = readings.filter((r) => r.day >= fromDay && r.day <= toDay);
  const recorded = inWindow.filter((r) => r.state === "recorded" && r.systolic !== null && r.diastolic !== null) as (BpReadingRow & {
    systolic: number;
    diastolic: number;
  })[];
  return {
    fromDay,
    toDay,
    count: recorded.length,
    unconfirmed: inWindow.length - recorded.length,
    avgSystolic: avg(recorded.map((r) => r.systolic)),
    avgDiastolic: avg(recorded.map((r) => r.diastolic)),
    notBelow: target ? recorded.filter((r) => notBelowTarget(r, target)).length : null,
    target,
  };
}
