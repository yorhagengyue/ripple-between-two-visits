/**
 * Shapes shared by the M3 routes, server pages and client components. Types only (client-safe).
 */
import type { MedLabel, MedOrigin, MedStatus } from "@/lib/store/types";

export const MED_ORIGINS: MedOrigin[] = ["prescription", "self_bought", "relative", "supplement"];

/** The "how to take" slots of label directions (glossary ids; strings, not arrays). */
export interface LabelSlots {
  quantity?: string;
  unit?: string;
  time?: string;
  frequency?: string;
}

/** Fields read off a label photo (web-app.md section 8: 药名、规格、用法、配药日期、诊所). */
export interface LabelFields {
  /** the printed line that names the medicine, as printed */
  drug_text: string | null;
  /** kb/drugs.json id from lib/kb's matcher; null = not identified */
  drug_id: string | null;
  /** how the name matched (exact / alias / fuzzy), null when not identified */
  match: "exact" | "alias" | "fuzzy" | null;
  /** "5 mg" */
  strength: string | null;
  /** the dose line as printed ("Take ONE tablet every MORNING"); only for identified medicines */
  directions: string | null;
  slots: LabelSlots | null;
  /** ISO date the label was dispensed */
  dispensed: string | null;
  clinic: string | null;
  /** the label's own "For: ..." line, as printed */
  indication: string | null;
}

/** The label fields the patient confirms one by one, in screen order. */
export const CONFIRM_FIELDS = ["drug_text", "strength", "directions", "dispensed", "clinic"] as const;
export type ConfirmField = (typeof CONFIRM_FIELDS)[number];

/**
 * What M3 keeps in medication.label (a JSON column). MedLabel plus the read fields; extra keys are M3
 * extensions that ride along in the same JSON.
 */
export interface StoredLabel extends MedLabel {
  drug_text?: string | null;
  slots?: LabelSlots | null;
  indication?: string | null;
  /** which reader produced the fields ("mock:vision-cassette", "openai", ...) */
  read_by?: string | null;
  /** the unknown-medicine question this label raised (lib/meds/answers.ts links its answer) */
  question_id?: string | null;
  /** story day the patient confirmed the fields */
  confirmed_day?: number | null;
  // ---- C2 (track F), in the same JSON
  /** the fields he changed while checking the label: their printed words are no longer quoted as the label's */
  edited?: ConfirmField[] | null;
  /** his words for the fields he changed (shown as 「你改过」, never as 「药袋上写着」) */
  edited_values?: Partial<Record<ConfirmField, string>> | null;
  /** he typed this medicine in himself (no label photo, no visit): 「你自己输入」 */
  typed?: boolean | null;
  /** an unidentified medicine: what he says he does with it (他自己设的，app 不判断) */
  patient_status?: PatientMedStatus | null;
  patient_status_at?: string | null;
  /** the question for the doctor he added with 「带去给医生看」 */
  doctor_question_id?: string | null;
}

/** What he says he does with a medicine nobody identified (real-app 12, e2e-chains 6.1). */
export type PatientMedStatus = "not_taking" | "bring_to_doctor";

/** POST /api/labels/read response. */
export interface LabelReadResponse {
  read_token: string;
  fields: LabelFields;
  /** the KB display name when identified ("Amlodipine") */
  display_name: string | null;
  provider: string;
  /** lib/vision/check.ts codes for fields left empty or not double-checked (no label text) */
  warnings?: string[];
  /**
   * C2: the slots the label's own time words name (lib/daily/slots.ts slotsFromLabel, the closed table), exactly what
   * confirming it will set; null when they name none (he chooses) or nobody identified the medicine
   */
  dose_slots?: ("morning" | "midday" | "evening" | "night")[] | null;
}

export type ConfirmOutcome = "label_confirmed" | "unidentified";

/** A line a card shows: text in the UI language, an optional second line, and its source chip. */
export interface CardLine {
  /** what to show in this locale */
  text: string;
  /**
   * shown under `text`: the label's own words under their Mandarin template, or the reviewed Mandarin line
   * under the fixed English unknown-medicine sentence (web-app.md 6.3)
   */
  secondLine: string | null;
  /** secondLine is the label's original wording (prefix it with "On the label:") */
  secondIsOriginal: boolean;
  chip: CardChip;
  sourceId: string;
}

export type ChipKind = "doctor" | "dispenser" | "pharmacist" | "label" | "leaflet" | "self" | "family" | "ripple" | "records" | "recording";

export interface CardChip {
  kind: ChipKind;
  /** ISO date (visit, label dispensed, leaflet page date) */
  date?: string | null;
  /** time point in the visit recording, ms */
  tStartMs?: number | null;
  /** leaflet page title or url host */
  title?: string | null;
  url?: string | null;
  /** patient_text review status (draft) */
  reviewStatus?: string | null;
  /** synthetic stand-in voice clip */
  standInVoice?: boolean;
  /**
   * doctor / dispenser / pharmacist only: the speaker is Ripple's inference from a visit this session replayed and
   * he has not confirmed yet (lib/safety cite.roleState "inferred"), shown as 推断：医生 like the visit screen (M4)
   */
  inferred?: boolean;
}

export interface MedCardView {
  medId: string;
  drugId: string | null;
  name: string;
  strength: string | null;
  origin: MedOrigin;
  status: MedStatus;
  /** status === awaiting_label: show the leaflet parts and the "awaiting label" marker */
  awaitingLabel: boolean;
  /** doctor's purpose lines first (R3), then the leaflet's */
  purpose: CardLine[];
  /** from the confirmed label */
  howToTake: CardLine[];
  /** other leaflet points */
  leaflet: CardLine[];
  /** unidentified medicine: the fixed sentence */
  unknown: CardLine[];
  /** the unknown-medicine question and its answer, when there is one */
  question: CardQuestion | null;
  /** sentences that failed a safety check and are not shown (source ids, for the backstage and tests) */
  hidden: { sourceId: string; section: "purpose" | "howToTake" | "leaflet" | "unknown" | "answer"; reasons: string[] }[];
  // ---- C2 (track F)
  /** the Chinese generic name from the checked table */
  zhName?: string | null;
  /** fields he changed while checking the label, with his words (shown as 「你改过」) */
  edited?: { field: ConfirmField; value: string }[];
  /** he typed this medicine in himself */
  typed?: boolean;
  /** an unidentified medicine: what he says he does with it */
  patientStatus?: PatientMedStatus | null;
  /** the slots he takes it in, and where they come from */
  slots?: { slots: string[]; source: "label" | "patient" | null };
}

export interface CardQuestion {
  id: string;
  text: string;
  for: "doctor" | "pharmacist";
  status: "open" | "answered" | "skipped";
  answer: CardLine | null;
  /** who said the recorded answer: confirmed in his review or named by him when he linked it; null = not confirmed */
  answerSpeaker: AnswerSpeaker | null;
  /** an answer is saved but did not pass lib/safety's checks (for example, a medicine instruction nobody is named for) */
  answerHidden: boolean;
  /** lines from a visit after the question that may be its answer (patient picks one) */
  answerChoices: AnswerChoice[];
}

/** Who may be named as the speaker of a recorded answer. */
export type AnswerSpeaker = "doctor" | "dispenser" | "pharmacist";

export interface AnswerChoice {
  visitId: string;
  visitDate: string;
  utteranceId: string;
  text: string;
  tStartMs: number;
  /** a clinician role he confirmed in the post-visit review; null = nobody confirmed who said it */
  speaker: AnswerSpeaker | null;
  /** whom he may name as the speaker: who works at that kind of visit (pharmacy: pharmacist; clinic: doctor, counter) */
  speakerOptions: AnswerSpeaker[];
}

export interface MedListItem {
  id: string;
  name: string;
  strength: string | null;
  origin: MedOrigin;
  status: MedStatus;
  /** the Chinese generic name from the checked table (lib/meds/zh-names.ts), when there is one */
  zhName?: string | null;
  /** he typed it in himself */
  typed?: boolean;
  /** an unidentified medicine: what he says he does with it */
  patientStatus?: PatientMedStatus | null;
  /** the slots he takes it in (label or his choice); empty: not known yet */
  slots?: string[];
}

export type { MedOrigin, MedStatus };
