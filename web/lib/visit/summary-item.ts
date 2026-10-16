/**
 * Where Ripple's final summary of a visit lives (lib/visit/ripple-summary.ts writes it): one visit_item row per visit,
 * type "summary", id "<visit>-ripple-summary", a fixed neutral text, no utterance ids, never confirmed, the points in
 * slots.summary. No migration (visit_item.type is plain text), it goes with its visit, and it is in his export.
 *
 * It is not the record and never a source: every reader of visit items leaves it out by isSummaryItem (the view's cards
 * and question list, the verdicts, lib/safety/candidates.ts, lib/explain/evidence.ts). A reader that lists items without
 * filtering shows the neutral text, never the points. Pure and client-safe, so lib/safety can name the type without
 * importing anything that calls a model.
 */
import type { VisitItemRow } from "@/lib/store/types";
import type { VisitSummaryView } from "./types";

export const SUMMARY_ITEM_TYPE = "summary" as const;
export const summaryItemId = (visitId: string): string => `${visitId}-ripple-summary`;
/** What the row's own text says, for any reader that lists items as they are: a label, never the points. */
export const SUMMARY_ITEM_TEXT = "Ripple's summary of what was said at this visit: not confirmed, and never a source.";

/** Ripple's summary row: never a card, an answer, a verdict or a source. */
export const isSummaryItem = (it: Pick<VisitItemRow, "type">): boolean => it.type === SUMMARY_ITEM_TYPE;

/** The summary kept with a visit, from its items (null: none). */
export function storedSummary(items: readonly VisitItemRow[], visitId: string): VisitSummaryView | null {
  const row = items.find((it) => it.id === summaryItemId(visitId) && isSummaryItem(it));
  const s = row?.slots?.summary as { lang?: unknown; points?: unknown; made_at?: unknown } | undefined;
  if (!s || !Array.isArray(s.points)) return null;
  const points = s.points
    .map((p) => p as { text?: unknown; lines?: unknown })
    .filter((p): p is { text: string; lines: unknown } => typeof p.text === "string" && p.text.trim() !== "")
    .map((p) => ({ text: p.text, lines: Array.isArray(p.lines) ? p.lines.filter((x): x is string => typeof x === "string") : [] }));
  if (!points.length) return null;
  return { stage: "final", lang: s.lang === "en" ? "en" : "zh-Hans", points, madeAt: typeof s.made_at === "string" ? s.made_at : "" };
}
