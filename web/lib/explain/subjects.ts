/**
 * What he can hold (owner's decision of 10-14, modelled on his iOS app: RippleApp/Explain/ExplainLongPress.swift, and its
 * server, ripple-core src/lib/explain.ts). Every element on his screens that stands for one of his records can be held
 * for half a second, and Ripple's read of it opens. The screen names the thing and nothing more ({ type, ref }); the
 * server looks everything up (lib/explain/evidence.ts) and POST /api/explain answers with a HoldRead.
 *
 * This is the long-press line. The medicine's explain card (the draft's 06-8: lib/explain/card.ts, types.ts,
 * components/explain/ExplainCard.tsx) is another thing and stays as it is.
 *
 *   med          a medicine                     ref: its id
 *   dose         one part of one day's medicine  ref: "<YYYY-MM-DD>:<slot>" (doseRef)
 *   bp           one blood-pressure reading     ref: its id
 *   bp_week      a week of readings             ref: any day of that week (YYYY-MM-DD); "": this week
 *   visit        a visit, planned or past       ref: its id
 *   visit_line   one line of a visit's record   ref: "<visit id>:<item id>" (lineRef)
 *   question     a question on his list         ref: its id
 *   next_visit   the next planned visit         ref: "" (the server finds it)
 *
 * The family side (owner's decision of 10-14: 「长按进入 AI 在家属端也要有」): on her screens the same elements can be
 * held, and the same sheet opens, read through her care link and cut by his switches. A type is hers to hold only while
 * the switch it belongs to is on (HOLD_GRANT); what the sheet then says is cut line by line (lib/explain/evidence.ts).
 *
 * Client-safe: types and how a ref is spelled, nothing else.
 */
import type { Sentence } from "@/lib/safety/types";
import type { DaySlot, FamilyGrantItems } from "@/lib/store/types";

export const HOLD_TYPES = ["med", "dose", "bp", "bp_week", "visit", "visit_line", "question", "next_visit"] as const;
export type HoldType = (typeof HOLD_TYPES)[number];

export interface HoldSubject {
  type: HoldType;
  ref: string;
}

export type HoldLocale = "zh-Hans" | "en";

export const REF_MAX = 200;

export function isHoldType(x: unknown): x is HoldType {
  return typeof x === "string" && (HOLD_TYPES as readonly string[]).includes(x);
}

/**
 * Which of his switches a type belongs to, for a family member: with that switch off the thing is not hers to hold, and
 * POST /api/explain answers 404 as if it did not exist.
 */
export const HOLD_GRANT: Record<HoldType, keyof FamilyGrantItems> = {
  med: "dose_summary",
  dose: "dose_summary",
  bp: "bp_summary",
  bp_week: "bp_summary",
  visit: "visit_transcripts",
  visit_line: "visit_transcripts",
  question: "questions_count",
  next_visit: "questions_count",
};

/** May she hold a thing of this type under these switches? */
export function familyMayHold(type: HoldType, grants: Partial<FamilyGrantItems> | null | undefined): boolean {
  return !!grants?.[HOLD_GRANT[type]];
}

/**
 * Who reads the sheet's words: he himself (「你」), or a family member through her link, who reads about him in the third
 * person (`dad`: how she calls him, 「爸爸」) and in the family side's vocabulary (lib/explain/copy.ts).
 */
export type WordsViewer = { kind: "self" } | { kind: "family"; dad: string };

const SLOTS: readonly DaySlot[] = ["morning", "midday", "evening", "night"];

/** A dose's ref: the day and the part of the day. */
export function doseRef(date: string, slot: DaySlot): string {
  return `${date}:${slot}`;
}

export function parseDoseRef(ref: string): { date: string; slot: DaySlot } | null {
  const m = /^(\d{4}-\d{2}-\d{2}):([a-z]+)$/.exec(ref.trim());
  if (!m || !(SLOTS as readonly string[]).includes(m[2])) return null;
  return { date: m[1], slot: m[2] as DaySlot };
}

/** A visit line's ref: the visit and the item of its record (the server matches the two ids as one string). */
export function lineRef(visitId: string, itemId: string): string {
  return `${visitId}:${itemId}`;
}

/** Why the sentence at the top was not written by the model (HoldRead.verdictWhy). */
export type VerdictWhy =
  /** he has not agreed to AI processing */
  | "no_consent"
  /** no model is configured (the offline mock) */
  | "no_model"
  /** his day's model spend is used up */
  | "spend_cap"
  /** the model did not answer in time, or failed */
  | "model_failed"
  /** the model said the facts do not say */
  | "model_abstained"
  /** the model's sentence said what it must not, and was dropped */
  | "guard"
  /** this thing never gets a model's words (a reading above the doctor's warning line, a medicine nobody identified ...) */
  | "fixed";

/** What POST /api/explain answers. */
export interface HoldRead {
  subject: HoldSubject & { name: string };
  /** one or two sentences */
  verdict: string;
  /** the records do not say: the sentence says so and points to the doctor or pharmacist */
  abstain: boolean;
  /** "model": written by the model from the evidence and let through by the guards; "records": built from his records */
  verdictBy: "model" | "records";
  verdictWhy?: VerdictWhy;
  /** what Ripple looked at, as short factual lines */
  checked: string[];
  /**
   * the quotes that bear on it, each word for word with where it comes from (the shape /api/ask answers with, so the
   * sheet draws them with the ask screen's own parts: components/daily/answer-parts.ts)
   */
  sources: Sentence[];
  /**
   * the question 「加进问题单」 puts on his list; null: nothing to add (it is a question on the list already; for a
   * family member also: he does not share his questions with her, so she cannot add one)
   */
  ask: { text: string; for: "doctor" | "pharmacist" } | null;
  /** the same thing with the same records gives the same id */
  answerId?: string;
  /**
   * only for a family member: the quiet line under the sentence, in the place of his own (「根据爸爸同意分享的记录写成，
   * 不是医嘱。」; lib/explain/copy.ts holdWords, with how she calls him)
   */
  note?: string;
  /**
   * only on the first of two lines (Accept: application/x-ndjson): the model is still writing, and `verdict` is the
   * sentence built from his records, shown if the second line never comes
   */
  waiting?: boolean;
}
