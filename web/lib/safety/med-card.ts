/**
 * Data for one medicine card (web-app.md section 7, M1 acceptance): what the leaflet restatements say (purpose,
 * food, missed dose, stopping; from patient_text.json, each with its HealthHub source) and, once the label is
 * confirmed, the dose and time from the label. The leaflet itself has no dose or time, so before the label is
 * confirmed the card carries `awaitingLabel: true` and no dose part.
 *
 * Every part is also run through layer 1 against its evidence (the drugs.json field for leaflet parts, the label
 * directions for the label part) and carries the verdict, so a page can mark a part whose draft wording adds a
 * slot the evidence does not contain (see web/PROGRESS.md, "patient_text drift").
 */
import { evidenceFor, getDrug, getPatientText, getSource } from "@/lib/kb/load";
import type { MedicationRow } from "@/lib/store/types";
import type { SlotMismatch } from "./slots";
import type { Candidate, Sentence } from "./types";
import { layer1 } from "./verify";
import { zhFromSlots } from "./zh";

export const LEAFLET_PARTS = ["purpose", "food", "missed", "stopping"] as const;
export type LeafletPart = (typeof LEAFLET_PARTS)[number];

export interface MedCardSource {
  kind: "leaflet" | "label";
  sourceId: string;
  url?: string;
  title?: string;
  pageDate?: string;
  /** patient_text status: draft until a pharmacist reviews it */
  reviewStatus?: string;
  medId?: string;
  dispensed?: string | null;
}

export interface MedCardPart {
  key: LeafletPart | "dose_time";
  en: string;
  /** Mandarin: reviewed patient_text zh, or the label slot template; null = show the original words */
  zh: string | null;
  source: MedCardSource;
  check: { pass: boolean; reasons: string[]; missing: SlotMismatch[] };
}

export interface MedCard {
  medId: string;
  drugId: string | null;
  displayName: string | null;
  status: MedicationRow["status"];
  /** true until the label is confirmed: show the leaflet parts and an "awaiting label" tag */
  awaitingLabel: boolean;
  leaflet: MedCardPart[];
  /** dose and time from the confirmed label */
  label: MedCardPart | null;
  /** leaflet parts patient_text.json has no entry for */
  missingLeafletParts: LeafletPart[];
}

const LABEL_OK: MedicationRow["status"][] = ["label_confirmed", "pharmacist_checked"];

export function buildMedCard(med: MedicationRow): MedCard {
  const drug = med.drug_id ? getDrug(med.drug_id) : null;
  const leaflet: MedCardPart[] = [];
  const missingLeafletParts: LeafletPart[] = [];

  if (drug) {
    for (const key of LEAFLET_PARTS) {
      const entry = getPatientText(`${drug.id}.${key}`);
      const ev = entry ? evidenceFor(entry) : null;
      if (!entry || !ev) {
        missingLeafletParts.push(key);
        continue;
      }
      const src = getSource(entry.source_id);
      const sourceId = `${entry.source_id}:${entry.id}`;
      const candidate: Candidate = {
        sourceId,
        kind: "patient_text",
        span: ev.en,
        attribution: "leaflet",
        restatement: { id: entry.id, en: entry.en, zh: entry.zh, status: entry.status },
      };
      const sentence: Sentence = { speechAct: "restate", sourceId, span: ev.en, slots: {}, en: entry.en, zh: entry.zh, attribution: "leaflet" };
      const l1 = layer1(sentence, candidate);
      leaflet.push({
        key,
        en: entry.en,
        zh: entry.zh || null,
        source: { kind: "leaflet", sourceId, url: src?.url, title: src?.title, pageDate: src?.page_date, reviewStatus: entry.status },
        check: { pass: l1.pass, reasons: l1.reasons, missing: l1.missing ?? [] },
      });
    }
  } else {
    missingLeafletParts.push(...LEAFLET_PARTS);
  }

  let label: MedCardPart | null = null;
  const directions = med.label?.directions;
  if (LABEL_OK.includes(med.status) && directions) {
    const sourceId = `label:${med.id}`;
    const candidate: Candidate = { sourceId, kind: "label", span: directions, attribution: "label", instruction: true };
    const zh = zhFromSlots(directions, "label");
    const sentence: Sentence = { speechAct: "restate", sourceId, span: directions, slots: {}, en: directions, zh: zh ?? undefined, attribution: "label" };
    const l1 = layer1(sentence, candidate);
    label = {
      key: "dose_time",
      en: directions,
      zh,
      source: { kind: "label", sourceId, medId: med.id, dispensed: med.label?.dispensed ?? null },
      check: { pass: l1.pass, reasons: l1.reasons, missing: l1.missing ?? [] },
    };
  }

  return {
    medId: med.id,
    drugId: med.drug_id,
    displayName: drug?.display_name ?? null,
    status: med.status,
    awaitingLabel: label === null,
    leaflet,
    label,
    missingLeafletParts,
  };
}
