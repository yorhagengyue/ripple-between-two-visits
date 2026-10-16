/**
 * The harness's state across one conversation (2026-10-16), kept on the rows Ripple already writes: no new table. Every
 * answer's safety_event carries two things in its `output` (the memory store and the Postgres store both keep `output` as
 * it is given, jsonb in Postgres, so nothing new is needed to persist them):
 *
 *   output.risk      the RiskSummary (./types.ts): level, ladder step, the table rows that fired, where the frame came from,
 *                    the frame's codes (his quoted words taken out: `evidence` emptied), the watch state, whether his family
 *                    was told, the follow-up asked. Codes only, never a word the model wrote. The watch state (./watch.ts)
 *                    reads this, and a row id starting with "self-harm-confirm-no" in `rows` is his "No" to the confirm
 *                    question.
 *   output.harness   the pathway state a reply continues (HarnessRecord): the follow-up this answer asked (its id
 *                    `<safety event id>:<pathway>:<step>`, its question, which medicine each medicines button stands for), the
 *                    pathway's answers so far, the frame and the context it was decided with, and which follow-up this answer
 *                    was itself a reply to.
 *
 * A reply (AskInput.reply) names a follow-up id: findPending looks it up among his own recent safety records (his scoped
 * store: a reply never reaches another person's state) and refuses one older than PENDING_TTL_MS or already answered by a
 * later record; then `text` is read as a new message. latestPending is the follow-up still waiting at the end of his
 * conversation (for typed words that answer it). history is today's: which pathways asked already, which questions were
 * never answered.
 *
 * Pure apart from the shapes: the pipeline reads the rows (store.listSafetyEvents) and passes them in.
 */
import type { SafetyEventRow } from "@/lib/store/types";
import type { Route } from "../types";
import type { Answers, FollowUpValues, PathwayHistory } from "./pathways";
import type { FollowUp, Frame, FrameSource, LadderStep, MedicalLevel, PathwayId } from "./types";

/** A follow-up older than this is no longer answered by its buttons (the reply is read as a new message). */
export const PENDING_TTL_MS = 30 * 60 * 1000;

/** What a reply needs to continue the pathway (output.harness.state). */
export interface PathwayState {
  pathway: PathwayId;
  /** the question asked (FOLLOW_UPS id) */
  questionId: string;
  /** his answers in this pathway before this question */
  answers: Answers;
  /** the medicine each medicines-question button stands for */
  values: FollowUpValues;
  /** the frame it was decided with: codes only (evidence emptied) */
  frame: Frame;
  frameSource: FrameSource;
  /** the safety record of the message the pathway started from (its `input` is his words) */
  originEventId: string;
  /**
   * That message's classification: `rulesRoute` the rules' own route (the floor the table reads), `route` the route its answer
   * went out on (a reply below level 1 keeps it), and the reason, signals, topics and medicines
   */
  origin: { rulesRoute: Route | null; route: Route; reason: string; signals: string[]; topics: string[]; drugs: string[] };
  /** the decision context that does not change within the conversation */
  context: {
    readingAboveLine: boolean;
    fits: string[];
    asksAmount: boolean;
    asksLargeAmount: boolean;
    sideEffect: boolean;
    missedDose: boolean;
    watch: boolean;
    /** urgent signs only cue words saw (risk/pathways.ts DecideContext.cueOnly) */
    cueOnly?: string[];
    /** his words said the dose was taken by mistake (risk/pathways.ts DecideContext.accidental; round 2) */
    accidental?: boolean;
  };
  /** what was decided when the question was asked (his family is told again only when a reply raises it) */
  decided: { level: MedicalLevel; ladder: LadderStep };
  /** the line that said his words were kept for his doctor, as it was shown (a chest reply shows it again) */
  kept?: { sourceId: string; en: string; zh: string; day: number; date: string };
}

export interface HarnessRecord {
  v: 1;
  /** the story day of the answer (the conversation is one day's) */
  day: number;
  /** the follow-up this answer asked (as his screen drew it), still waiting until a later record answers it */
  followUp: FollowUp | null;
  /** the follow-up this answer was a reply to (a tap, or typed words that answered it) */
  replied: { followUpId: string; optionIds: string[]; typed: boolean } | null;
  state: PathwayState | null;
}

/** A frame with his quoted words taken out (the record and the backstage keep codes only). */
export function frameCodes(frame: Frame): Frame {
  return {
    ...frame,
    medicines: frame.medicines.map((m) => ({ ref: m.ref, evidence: [] })),
    amount: { relation: frame.amount.relation, evidence: [] },
    symptoms: frame.symptoms.map((s) => ({ ...s, evidence: [] })),
    selfHarm: { ...frame.selfHarm, evidence: [] },
    missing: [...frame.missing],
  };
}

/** The harness record of a safety event, or null (an event from before the harness, or not an answer). */
export function harnessOf(e: Pick<SafetyEventRow, "output">): HarnessRecord | null {
  const h = (e.output as { harness?: unknown } | null)?.harness;
  if (!h || typeof h !== "object" || (h as { v?: unknown }).v !== 1) return null;
  return h as HarnessRecord;
}

const ageMs = (e: Pick<SafetyEventRow, "created_at">, nowMs: number) => nowMs - Date.parse(e.created_at);

/** Whether a later record answered this follow-up. */
function answeredLater(events: readonly SafetyEventRow[], index: number, followUpId: string): boolean {
  for (let i = index + 1; i < events.length; i++) if (harnessOf(events[i])?.replied?.followUpId === followUpId) return true;
  return false;
}

export type PendingLookup =
  | { ok: true; event: SafetyEventRow; record: HarnessRecord & { followUp: NonNullable<HarnessRecord["followUp"]>; state: PathwayState } }
  | { ok: false; why: "unknown" | "stale" | "answered" };

/** The follow-up a reply names, among his recent safety records (oldest first, as listSafetyEvents returns them). */
export function findPending(events: readonly SafetyEventRow[], followUpId: string, nowMs: number): PendingLookup {
  const i = events.findIndex((e) => harnessOf(e)?.followUp?.id === followUpId);
  if (i < 0) return { ok: false, why: "unknown" };
  const record = harnessOf(events[i])!;
  if (!record.state || !record.followUp) return { ok: false, why: "unknown" };
  if (ageMs(events[i], nowMs) > PENDING_TTL_MS) return { ok: false, why: "stale" };
  if (answeredLater(events, i, followUpId)) return { ok: false, why: "answered" };
  return { ok: true, event: events[i], record: record as HarnessRecord & { followUp: NonNullable<HarnessRecord["followUp"]>; state: PathwayState } };
}

/** The follow-up still waiting at the end of his conversation: the newest harness record's, when it asked one (else none). */
export function latestPending(events: readonly SafetyEventRow[], nowMs: number): PendingLookup | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const h = harnessOf(events[i]);
    if (!h) continue;
    if (!h.followUp) return null;
    return findPending(events, h.followUp.id, nowMs);
  }
  return null;
}

/**
 * Today's conversation as the decision table needs it (risk/pathways.ts PathwayHistory): the pathways he answered a question
 * of (other than `continuing`, the one this reply goes on with), the questions he was asked and never answered (other than
 * the one this reply answers), and how many questions each pathway asked.
 */
export function harnessHistory(events: readonly SafetyEventRow[], day: number, opts: { continuing?: PathwayId | null; answering?: string | null } = {}): PathwayHistory {
  const answered = new Set<PathwayId>();
  const unanswered: string[] = [];
  const asks: Partial<Record<PathwayId, number>> = {};
  events.forEach((e, i) => {
    const h = harnessOf(e);
    if (!h || h.day !== day || !h.followUp) return;
    const p = h.followUp.pathway;
    asks[p] = (asks[p] ?? 0) + 1;
    if (h.followUp.id === opts.answering) return;
    if (answeredLater(events, i, h.followUp.id)) {
      if (p !== opts.continuing) answered.add(p);
    } else {
      unanswered.push(h.followUp.templateId);
    }
  });
  return { answered: [...answered], unanswered: [...new Set(unanswered)], asks };
}
