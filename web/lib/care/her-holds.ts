/**
 * What she can hold on her home (owner's decision of 2026-10-14: 「长按进入 AI 在家属端也要有」, the same long press as his
 * side). Client-safe, pure: from the copy of his day the server sent (lib/care/home-types.ts), which element of her home
 * stands for which of his records (lib/explain/subjects.ts). The screen names the thing and nothing more; the server
 * looks everything up through her link and cuts it by his switches (POST /api/explain?link=).
 *
 *   today's sentence        the part of today's medicine it is about                     dose  "<today>:<slot>"
 *   a day of 「这一周」       that day's medicine, when the day has one part only           dose  "<date>:<slot>"
 *                           (a day with two parts stands for two records: it stays a plain part of the week's link)
 *   the blood pressure row  this week's readings                                         bp_week ""
 *   its number              the latest reading                                           bp    <reading id>
 *   a question's words      that question                                                question <question id>
 *   the next visit's row    the next visit                                               next_visit ""
 *
 * Only what the copy holds: a section his switch leaves out has no element, so nothing to hold; and the moment he
 * switches a kind off her page cuts it out of the copy (lib/care/hide.ts), and these go with it.
 */
import { doseRef, type HoldSubject } from "@/lib/explain/subjects";
import type { FamilyHomeData } from "./home-types";

/** How many of his questions' words her home lists (lib/care/her-view.ts HOME_QUESTIONS: the same number). */
const QUESTION_LINES = 3;

export interface HomeHolds {
  /** today's large sentence (also the amber one when he did not reply), while he shares his medicine */
  status: HoldSubject | null;
  /** the days of 「这一周」 that stand for one record, by date */
  days: Record<string, HoldSubject>;
  /** the blood pressure row, and its number (his latest reading) */
  bpWeek: HoldSubject | null;
  bpLatest: HoldSubject | null;
  /** the lines under his questions' row, in the order her home lists them */
  questions: (HoldSubject | null)[];
  /** the next visit's row */
  nextVisit: HoldSubject | null;
}

const NONE: HomeHolds = { status: null, days: {}, bpWeek: null, bpLatest: null, questions: [], nextVisit: null };

export function homeHolds(home: FamilyHomeData | null | undefined): HomeHolds {
  if (!home) return NONE;
  const out: HomeHolds = { status: null, days: {}, bpWeek: null, bpLatest: null, questions: [], nextVisit: null };
  // his medicine: the copy carries a slot's medicines only while that switch is on (with the no-reply switch alone the
  // slot is there without them, and there is nothing of his medicine to hold)
  const slot = home.status?.slot;
  if (home.grants.dose_summary && slot && slot.cells.length > 0) out.status = { type: "dose", ref: doseRef(home.today, slot.slot) };
  if (home.grants.dose_summary && home.week) {
    for (const d of home.week.days) {
      // a day still to come has no record yet; a day with nothing to record has none either
      if (d.date > home.today || d.mark === "none" || d.slots.length !== 1) continue;
      out.days[d.date] = { type: "dose", ref: doseRef(d.date, d.slots[0].slot) };
    }
  }
  if (home.bp) {
    out.bpWeek = { type: "bp_week", ref: "" };
    // `?? []` and the id check: a copy built by a server still on the older build has the count alone, or no ids
    const latest = (home.bp.readings ?? [])[0];
    if (latest && typeof latest.id === "string" && latest.id) out.bpLatest = { type: "bp", ref: latest.id };
  }
  if (home.questions) {
    out.questions = (home.questions.items ?? []).slice(0, QUESTION_LINES).map((q) => (typeof q.id === "string" && q.id ? { type: "question", ref: q.id } : null));
    if (home.questions.nextVisit) out.nextVisit = { type: "next_visit", ref: "" };
  }
  return out;
}
