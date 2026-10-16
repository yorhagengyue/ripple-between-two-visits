/**
 * Shapes of the explain card 「为什么没感觉也要吃」 and the understanding checklist (task M5). Types and constants
 * only (client-safe).
 */
import type { CardChip } from "@/lib/meds/types";

/** Where a line on the explain card comes from. Nothing else may be on the card. */
export type ExplainLineKind =
  /** R3, the doctor's own words at the D8 visit, verbatim */
  | "doctor"
  /** a clinic counter (or pharmacist) line at the prescribing visit, verbatim, once he confirmed who said it */
  | "counter"
  /** a reviewed restatement from web/kb/patient_text.json (its own en / zh) */
  | "leaflet";

export interface ExplainClip {
  /** GET /api/visits/<visit>/clip?u=<utterance>&session=<id> */
  url: string;
  /** a synthetic stand-in voice (代录音 / stand-in recording) */
  standIn: boolean;
}

export interface ExplainLine {
  kind: ExplainLineKind;
  /** lib/safety candidate source id (visit:v2:R3, visit:v2:v2-u12, hh-amlodipine:amlodipine.purpose) */
  sourceId: string;
  /** what the card shows: the original words for doctor and counter lines, the restatement in the UI language */
  text: string;
  /** language of `text` (BCP 47-ish: "en", "zh-Hans") */
  lang: "en" | "zh-Hans";
  chip: CardChip;
  /** R1-R4 when the line is a required doctor line */
  requiredLine: string | null;
  clip: ExplainClip | null;
}

export interface ExplainCardView {
  medId: string;
  drugId: string;
  name: string;
  lines: ExplainLine[];
  /**
   * Exactly what read-aloud sends to text-to-speech: the card's rendered sentences, in screen order, one per line,
   * nothing added (no title, no source labels).
   */
  speechText: string;
  /** candidate lines that failed one of lib/safety's three checks and are not shown */
  hidden: { sourceId: string; reasons: string[] }[];
}

/** The four checklist items (task M5 item 4), in screen order. */
export const UNDERSTANDING_ITEMS = ["purpose", "feel_fine", "when", "missed"] as const;
export type UnderstandingItem = (typeof UNDERSTANDING_ITEMS)[number];

export type UnderstandingAnswer = "know" | "unsure";

export interface UnderstandingItemView {
  id: UnderstandingItem;
  /** the open (or answered) question this item put on his list after 不确定, if any */
  questionId: string | null;
  questionStatus: "open" | "answered" | "skipped" | null;
  /** C2: his last answer, kept (知道 too); null while he has not answered */
  answer?: UnderstandingAnswer | null;
}

export interface UnderstandingView {
  medId: string;
  items: UnderstandingItemView[];
}

/** question.evidence of the question an item adds (one per medicine and item, never duplicated). */
export function understandingEvidence(medId: string, item: UnderstandingItem): string {
  return `understanding_check:${medId}:${item}`;
}
