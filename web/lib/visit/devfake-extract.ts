/**
 * An extraction stand-in for the developer tools: 「the model adds two lines and changes one」 (C2 track F, fix round).
 *
 * With the offline model a visit's items come from the rules alone (lib/visit/extract.ts). With a real model the
 * whole-visit pass also asks the model (lib/visit/model-extract.ts), and its labels, after the checks, add items the
 * rules did not make: a line nobody expected is in the review, and a line the rules already had carries one item more.
 * The first run against the real model was the first time any review had such lines. This stand-in answers the
 * labelling call the way a model can, so the review, the unit tests and the journeys can be run against model-shaped
 * output with no model:
 *
 *   adds two lines   the first two clinician lines the rules gave nothing: each gets an "instruction" label;
 *   changes one      the first clinician line the rules did label (not a consent, an answer or a required line, and
 *                    without an instruction of its own): one more "instruction" label, so that line's card has a row
 *                    more and his one answer applies to both.
 * A transcript with fewer such lines gets fewer labels (a visit where every clinician line already has an item gets
 * only the changed one). Like any model output it writes no text: it points at sentence ids, and every label still
 * goes through draftsFromLabels and mergeDrafts.
 *
 * In a server: only while the developer tools are on (lib/dev/enabled.ts), the main model is the offline mock, and
 * DEVFAKE_EXTRACT=adds-two-changes-one is set on purpose (a journey run). Otherwise devfakeExtractor() is null and
 * nothing changes. Server-only.
 */
import { devToolsEnabled } from "@/lib/dev/enabled";
import type { LlmClient } from "@/lib/llm/types";
import { extractItems, type ExtractLine } from "./extract";
import type { ModelExtractPayload, ModelLabel } from "./model-extract";
import { isClinician } from "./roles";

export const DEVFAKE_EXTRACT_ENV = "DEVFAKE_EXTRACT";
export const DEVFAKE_EXTRACT_MODE = "adds-two-changes-one";

/** The labels of 「adds two lines and changes one」 for one labelling payload (pure). */
export function standInLabels(payload: ModelExtractPayload): ModelLabel[] {
  const all: ExtractLine[] = payload.lines.map((l, i) => ({ id: l.id, text: l.text, role: l.role, t_start_ms: i, t_end_ms: i }));
  const from = payload.lines.findIndex((l) => !l.context);
  if (from < 0) return [];
  // what the rules make of the same lines (the required lines by their words only: enough to know which lines they take)
  const rules = extractItems(all, from, {
    visit: { id: "", day: 0, kind: payload.visit_kind },
    requiredLines: payload.required_lines.map((r) => ({ id: `item-${r.id}`, visit_id: "", type: r.type as never, text: r.text, required_line: r.id, slots: {}, speaker: "doctor" as const })),
    priorPrescriptions: [],
  });
  const byLine = new Map<string, typeof rules>();
  for (const d of rules) for (const id of d.utterance_ids) byLine.set(id, [...(byLine.get(id) ?? []), d]);
  const clinician = payload.lines.slice(from).filter((l) => isClinician(l.role));
  const label = (id: string): ModelLabel => ({ utterance_id: id, type: "instruction", variant: "instruction", required_line: null });
  const added = clinician.filter((l) => !byLine.has(l.id)).slice(0, 2);
  const changed = clinician.find((l) => {
    const its = byLine.get(l.id);
    return !!its && its.every((d) => d.type !== "consent" && d.type !== "answer" && d.type !== "instruction" && !d.required_line);
  });
  return [...added.map((l) => label(l.id)), ...(changed ? [label(changed.id)] : [])];
}

/** The stand-in as a model client: it answers the labelling call (lib/visit/model-extract.ts extractWithModel). */
export function extractionStandIn(): LlmClient {
  return {
    provider: "devfake",
    model: DEVFAKE_EXTRACT_MODE,
    async chat(opts) {
      const payload = JSON.parse(opts.user) as ModelExtractPayload;
      return { content: JSON.stringify({ items: standInLabels(payload) }), tokens: 0 };
    },
  };
}

/** The stand-in when this server was started for it (see the header), else null. */
export function devfakeExtractor(env: Record<string, string | undefined> = process.env): LlmClient | null {
  if ((env[DEVFAKE_EXTRACT_ENV] ?? "").trim() !== DEVFAKE_EXTRACT_MODE) return null;
  if (!devToolsEnabled(env)) return null;
  return extractionStandIn();
}
