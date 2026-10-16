/**
 * An account's check cards and question list on the visit screen, counted the way the brief counts (C2 track F with
 * track B's lib/summary/visit-check.ts; real-app 4.4 「核对卡和简报用同一口径」). The card is what a brief opened at the
 * moment the visit started says: the same window (after the last clinic visit that happened), the same cells as of
 * that moment, the same readings next to the target he confirmed at an earlier visit, the same three questions.
 * A demo session keeps its own cards (lib/visit/checks.ts buildBpCheck / buildMedCheck). Server-only.
 *
 * "As of the moment the visit started" also holds after the visit: the three questions are the ones the brief showed
 * then, so answering them in this visit, or a question written after it started (a line he says is not right), does
 * not bring others onto this visit's list.
 */
import type { Locale } from "@/lib/i18n";
import type { BpReadingRow, MedicationRow, QuestionRow, SessionRow, Store, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { visitCheckSummary, type VisitCheckSummary } from "@/lib/summary/visit-check";
import type { BpCheck, MedCheck, TargetRef } from "./types";

/**
 * The moment the visit started: the consent card's tap (an account's recording keeps the wall clock), else the first
 * line heard (a sample replay has no consent card; its lines arrive from the start), else when the row was made.
 */
export function visitStartedMs(visit: Pick<VisitRow, "id" | "created_at">, items: readonly Pick<VisitItemRow, "type" | "slots">[], lines: readonly Pick<UtteranceRow, "created_at">[]): number {
  const consent = items.find((i) => i.type === "consent" && i.slots?.variant === "screen" && typeof i.slots?.at === "string");
  const tapped = consent ? Date.parse(consent.slots.at as string) : NaN;
  if (Number.isFinite(tapped)) return tapped;
  const heard = lines.map((l) => Date.parse(l.created_at)).filter(Number.isFinite);
  if (heard.length) return Math.min(...heard);
  return Date.parse(visit.created_at);
}

/** His question rows as they stood when the visit started: none written after it, none answered in it yet. */
export function questionsAsOfStart(rows: readonly QuestionRow[], visitId: string, startedMs: number): QuestionRow[] {
  return rows
    .filter((q) => !(Date.parse(q.created_at) > startedMs))
    .map((q) =>
      q.answer_visit_id === visitId ? { ...q, status: "open", answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null } : q,
    );
}

/** The store as track B's summary reads it, with the question rows as of the start (everything else as it is). */
function storeAsOfStart(store: Store, visitId: string, startedMs: number): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "listQuestions") {
        return async (...args: Parameters<Store["listQuestions"]>) => questionsAsOfStart(await target.listQuestions(...args), visitId, startedMs);
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * Track B's visit check summary at the moment the visit started. `locale` only words the brief's pattern questions;
 * the visit screen uses the questions' ids and the counts.
 */
export function accountCheckSummary(store: Store, scope: SessionRow, visit: Pick<VisitRow, "id" | "day">, startedMs: number, locale: Locale = "zh-Hans"): Promise<VisitCheckSummary> {
  return visitCheckSummary(storeAsOfStart(store, visit.id, startedMs), scope, { visit, startedMs, locale });
}

/** The ids of the brief's three questions for the doctor (the visit's question list shows these, and the ones asked or answered in it). */
export function briefThree(summary: VisitCheckSummary): Set<string> {
  return new Set(summary.questions.shown.map((q) => q.id));
}

/** The target he confirmed at an earlier visit, as the readings card shows it (his confirmed line, so 「医生说」). */
function targetRef(summary: VisitCheckSummary): TargetRef | null {
  const t = summary.target;
  if (!t || t.diastolic === null) return null;
  return {
    systolic: t.systolic,
    diastolic: t.diastolic,
    quote: t.text,
    date: t.visitDate,
    visitId: t.visitId,
    display: t.state === "confirmed" ? "confirmed" : "inferred",
    tStartMs: t.tStartMs,
  };
}

/**
 * The readings card from the summary: its count, average, unconfirmed and not-below numbers are the summary's; the
 * bars are the same readings (in the window, recorded before the visit started), one per reading. Null without readings.
 */
export function bpCheckFromSummary(summary: VisitCheckSummary, readings: readonly BpReadingRow[], visitDay: number, startedMs: number): BpCheck | null {
  const { bp, window } = summary;
  if (bp.count === 0 || bp.avgSystolic === null || bp.avgDiastolic === null) return null;
  const target = targetRef(summary);
  const recorded = readings.filter(
    (r) =>
      r.day >= window.fromDay &&
      r.day <= window.toDay &&
      (r.day < visitDay || Date.parse(r.created_at) <= startedMs) &&
      r.state === "recorded" &&
      r.systolic !== null &&
      r.diastolic !== null,
  );
  return {
    check: "bp",
    fromDay: window.fromDay,
    toDay: window.toDay,
    fromDate: window.fromDate,
    toDate: window.toDate,
    recorded: bp.count,
    unconfirmed: bp.unconfirmed,
    avgSystolic: bp.avgSystolic,
    avgDiastolic: bp.avgDiastolic,
    bars: recorded.map((r) => ({
      systolic: r.systolic!,
      diastolic: r.diastolic!,
      day: r.day,
      notBelow: target ? r.systolic! >= target.systolic || r.diastolic! >= target.diastolic : null,
    })),
    target,
    notBelow: target ? bp.notBelow : null,
  };
}

/**
 * The medicines card from the summary: the cells it counted (every slot his medicines owed in the window, as of the
 * moment the visit started), each medicine with its label's first line word for word. The routine line only when every
 * missed morning falls on it. Null when no medicine owed a dose in the window.
 */
export function medCheckFromSummary(summary: VisitCheckSummary, meds: readonly MedicationRow[], drugName: (id: string) => string): MedCheck | null {
  const { doses, window } = summary;
  if (doses.meds.length === 0) return null;
  const routine = doses.routine && doses.routine.all ? { label: doses.routine.label, labelZh: doses.routine.labelZh, days: doses.routine.weekdays } : null;
  return {
    check: "med",
    meds: doses.meds.map((m) => {
      const row = meds.find((r) => r.id === m.id);
      const labelLine = row?.label?.text ? (row.label.text.split("\n")[0] ?? "").trim() : "";
      return { id: m.id, labelLine: labelLine || m.name, drugName: row?.drug_id ? drugName(row.drug_id) : m.name };
    }),
    fromDate: window.fromDate,
    toDate: window.toDate,
    total: doses.due,
    taken: doses.taken,
    missed: doses.missed,
    unconfirmed: doses.unconfirmed,
    missedDays: doses.missedDays,
    routine,
    // the brief's own summary (its missed days only), so the review words the missed doses as the brief does
    doses: { ...doses, days: doses.days.filter((d) => d.missed > 0) },
  };
}
