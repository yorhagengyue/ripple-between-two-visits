/**
 * The decision table, read (the harness, 2026-10-16: "code decides, the model only reads"; the rows are web/kb/pathways.json,
 * the facts risk/pathways.ts). Pure: no store, no model, no clock.
 *
 *   decisionTable()                 the rows, validated once (zod): every row has a source and a review state, a level or a
 *                                   ladder step, fixed lines that exist in templates.ts and a question that exists in
 *                                   FOLLOW_UPS
 *   rowHolds(row, facts)            a row's `when`: every key's fact equals the value, or one of the values of a list
 *   decide(frame, answers, ctx)     the decision for one message: the ladder row and the medical row that fired (the first
 *                                   of each track, top to bottom), the level and the ladder step, the fixed lines in the
 *                                   order they are shown, the next follow-up question (or none), the question for his
 *                                   doctor or pharmacist, whether his family is told, and whether the answer may show
 *                                   no amount at all (a lethality question, saved-up tablets)
 *
 * What is shown first: the higher of the two tracks. A level-1 row or the danger step puts its 995 line first; then the
 * helplines of the ladder; then the medical lines. Exactly one follow-up question at most, and it is always drawn after
 * every line (so 995 and the helplines come before any question): the ladder's question while the ladder is at "possible"
 * or "thoughts" (safety first), else the medical row's, never with a level-1 row (995 now, no question first: STCC, Ada).
 * A row that asks a question whose pathway may ask no more (asked earlier in the conversation, three answers already)
 * still decides, without the question.
 */
import { z } from "zod";
import pathwaysJson from "@/kb/pathways.json";
import { FOLLOW_UPS, TEMPLATES, type FollowUpTemplateId } from "../templates";
import {
  buildFollowUp,
  deriveFacts,
  isQuestionId,
  mayAsk,
  pathwayOfQuestion,
  QUESTION_FACT,
  questionsAhead,
  type Answers,
  type DecideContext,
  type Facts,
  type FollowUpValues,
} from "./pathways";
import type { FollowUp, Frame, LadderStep, MedicalLevel, PathwayId, PathwayRow } from "./types";

/** Line ids a row may show besides TEMPLATES: the line that says his words were kept for his doctor (templates.ts SIGNAL_RECORDED). */
export const ROW_LINES_EXTRA = ["signal_recorded"];

const PATHWAYS: (PathwayId | "general")[] = [
  "chest",
  "breathing",
  "reading_high",
  "extra_dose",
  "missed_dose",
  "looks_different",
  "side_effect",
  "stop_change",
  "self_harm_check",
  "general",
];

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const rowSchema = z.object({
  id: z.string().min(1),
  pathway: z.enum(PATHWAYS as [string, ...string[]]),
  when: z.record(z.string(), z.union([scalar, z.array(scalar).min(1)])),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  ladder: z.enum(["none", "possible", "thoughts", "danger"]).optional(),
  show: z.array(z.string()),
  ask: z.string().optional(),
  question: z.enum(["doctor", "pharmacist"]).optional(),
  notifyFamily: z.boolean().optional(),
  source: z.string().min(1),
  review: z.enum(["pending_clinician", "signed"]),
  note: z.string().optional(),
});
const fileSchema = z.object({ meta: z.looseObject({ purpose: z.string() }), rows: z.array(rowSchema).min(1) });

let cached: PathwayRow[] | null = null;

/** The rows of kb/pathways.json, validated once (see the header). Throws on a malformed table: it is checked in. */
export function decisionTable(): PathwayRow[] {
  if (cached) return cached;
  const parsed = fileSchema.parse(pathwaysJson);
  const seen = new Set<string>();
  for (const r of parsed.rows) {
    if (seen.has(r.id)) throw new Error(`pathways.json: row ${r.id} twice`);
    seen.add(r.id);
    if ((r.level === undefined) === (r.ladder === undefined)) throw new Error(`pathways.json: row ${r.id} needs a level or a ladder step, not both`);
    for (const t of r.show) {
      if (!(t in TEMPLATES) && !ROW_LINES_EXTRA.includes(t)) throw new Error(`pathways.json: row ${r.id} shows unknown line ${t}`);
    }
    if (r.ask !== undefined && !isQuestionId(r.ask)) throw new Error(`pathways.json: row ${r.id} asks unknown question ${r.ask}`);
    if (r.ask !== undefined && r.pathway !== "general" && FOLLOW_UPS[r.ask as FollowUpTemplateId].pathway !== r.pathway) {
      throw new Error(`pathways.json: row ${r.id} asks ${r.ask} of another pathway`);
    }
  }
  cached = parsed.rows as PathwayRow[];
  return cached;
}

/** A row's `when` holds for these facts (every key; a list means any of its values; a missing fact never holds). */
export function rowHolds(row: Pick<PathwayRow, "when">, facts: Facts): boolean {
  for (const [key, want] of Object.entries(row.when)) {
    if (!(key in facts)) return false;
    const have = facts[key];
    if (Array.isArray(want) ? !want.includes(have) : want !== have) return false;
  }
  return true;
}

const LADDER_RANK: Record<LadderStep, number> = { none: 0, possible: 1, thoughts: 2, danger: 3 };

export interface Decision {
  level: MedicalLevel;
  ladder: LadderStep;
  /** the rows that fired, ladder first (risk/types.ts RiskSummary.rows) */
  rows: string[];
  ladderRow: PathwayRow | null;
  medicalRow: PathwayRow;
  /** the pathway the medical row belongs to */
  pathway: PathwayId | "general";
  /** the fixed lines, in the order they are shown (the pipeline drops the ones that do not apply: see pipeline.ts) */
  show: string[];
  /** the 995 line goes first (a level-1 row, or the danger step) */
  urgentFirst: boolean;
  /** the next follow-up question, when a row asks one and its pathway may still ask */
  ask: { questionId: FollowUpTemplateId; pathway: PathwayId; step: number; of: number } | null;
  /** a question goes on his list, and for whom */
  question: "doctor" | "pharmacist" | null;
  notifyFamily: boolean;
  /**
   * The answer shows no amount at all: no label, no dose line, no number of tablets, and his words do not go on the
   * doctor's list as a dose question. Round 2 (10-16: sh-let-07 「这个药最多能吃多少？吃太多会怎么样？」 showed his label's
   * "Take ONE tablet every MORNING" at the possible step): whenever the ladder is above none, a lethality question or
   * saved-up tablets are in the frame ("yes" or "unclear"), or he asks any amount with the watch state on, whatever the route
   */
  noAmounts: boolean;
  facts: Facts;
}

/**
 * The decision for one message (see the header). `answers` are his answers so far in the pathway this answer continues
 * (ctx.continuing); `values` the medicines behind a medicines question's options.
 */
export function decide(frame: Frame, answers: Answers, ctx: DecideContext, values: FollowUpValues = {}): Decision {
  const rows = decisionTable();
  const facts = deriveFacts(frame, answers, ctx, values);
  const ladderRow = rows.find((r) => r.ladder !== undefined && rowHolds(r, facts)) ?? null;
  const medicalRow = rows.find((r) => r.level !== undefined && rowHolds(r, facts));
  if (!medicalRow) throw new Error("pathways.json: no medical row held (the last row must hold always)");
  const ladder: LadderStep = ladderRow?.ladder ?? "none";
  const level = medicalRow.level as MedicalLevel;

  const urgentFirst = level === 1 || ladder === "danger";
  const ladderShow = ladderRow?.show ?? [];
  // the higher first: at danger the ladder's own 995 line leads (a second plain 995 line is left out); else a level-1 line
  // leads the ladder's lines; else the ladder's lines (the safety line, the helplines) lead the medical ones
  const show =
    ladder === "danger"
      ? [...ladderShow, ...medicalRow.show.filter((t) => t !== "emergency_995")]
      : level === 1
        ? [...medicalRow.show, ...ladderShow]
        : [...ladderShow, ...medicalRow.show];

  // one question at most: the ladder's (possible, thoughts) first, else the medical row's; none beside a level-1 row
  const askOf = (row: PathwayRow | null): Decision["ask"] => {
    if (!row?.ask || !isQuestionId(row.ask)) return null;
    const q = row.ask;
    const p = pathwayOfQuestion(q);
    if (facts[QUESTION_FACT[q]] !== "unknown") return null;
    if (!mayAsk(q, answers, ctx)) return null;
    const done = Object.keys(answers).filter((a) => isQuestionId(a) && pathwayOfQuestion(a) === p).length;
    return { questionId: q, pathway: p, step: done + 1, of: Math.max(done + 1, questionsAhead(p, answers, facts)) };
  };
  let ask: Decision["ask"] = null;
  if (level !== 1 && (ladder === "possible" || ladder === "thoughts")) ask = askOf(ladderRow);
  if (!ask && level !== 1 && LADDER_RANK[ladder] === 0) ask = askOf(medicalRow);

  const lethal = ["yes", "unclear"];
  const noAmounts =
    LADDER_RANK[ladder] > 0 ||
    lethal.includes(String(facts["selfHarm.lethalityQuestion"])) ||
    lethal.includes(String(facts["selfHarm.means"])) ||
    (facts.watch === true && facts["asks.amount"] === true);

  return {
    level,
    ladder,
    rows: [...(ladderRow ? [ladderRow.id] : []), medicalRow.id],
    ladderRow,
    medicalRow,
    pathway: medicalRow.pathway,
    show: [...new Set(show)],
    urgentFirst,
    ask,
    question: noAmounts ? null : (medicalRow.question ?? null),
    notifyFamily: !!(medicalRow.notifyFamily || (ladderRow && ladder !== "none" && ladderRow.notifyFamily)),
    noAmounts,
    facts,
  };
}

/** The decision's follow-up question with its id (pipeline.ts names it after the safety record that asks it). */
export function followUpFor(decision: Pick<Decision, "ask">, opts: { id: string; meds: DecideContext["meds"]; fits?: string[] }): { followUp: FollowUp; values: FollowUpValues } | null {
  if (!decision.ask) return null;
  return buildFollowUp(decision.ask.questionId, { id: opts.id, step: decision.ask.step, of: decision.ask.of, meds: opts.meds, fits: opts.fits });
}

/** Higher of two ladder steps. */
export function higherStep(a: LadderStep, b: LadderStep): LadderStep {
  return LADDER_RANK[a] >= LADDER_RANK[b] ? a : b;
}
