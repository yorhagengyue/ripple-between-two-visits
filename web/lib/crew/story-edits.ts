/**
 * The director's story sheet (ux pass 10-13; docs/ux/后端改动记录.md): small changes to Mr Tan's story that a filming
 * account is laid out with (lib/crew/filming-account.ts layoutAtMoment). Pure; client-safe (the sheet on /director and
 * the route that takes it read the same schema).
 *
 * The story stays Mr Tan's: the same visits, the same recordings, the same medicines. What the crew may change is what
 * he did between the visits, and which of his medicines are there:
 *
 *   meds        a medicine is in the story or not; a prescription's bag is read already ("confirmed") or still waits
 *               for his photograph ("awaiting": the scene where he photographs the bag). A label is never typed here:
 *               "confirmed" for a medicine the template leaves waiting takes the words of that medicine's prop bag
 *               (fixtures/labels/<drug>.expected.json), nothing else
 *   doses       one morning's answer: taken, missed (with one of the app's own reasons), no reply, or no record
 *   bp          one reading: its two numbers, "not measured", or no record
 *   notes       his own notes: a template note left out, a note added (typed, his words)
 *   questions   his question list: a template question left out, a question of his own added (open, unanswered)
 *
 * Never cross (C2 rule, kept): nothing here is a sentence of Ripple's, a doctor's line or an answer. A question that is
 * added has no answer; a doctor's answer exists only in a recording.
 *
 * The sheet is not stored on the server: the director's browser keeps it and sends it with every "lay out", so laying
 * the account out again (the only way back in time) brings the same changes back. An edit that names something the
 * story does not have is refused with a sentence (StoryEditError), never applied in part.
 */
import { z } from "zod";
import losartanLabel from "@/fixtures/labels/losartan.expected.json";
import type { BpReadingRow, DoseLogRow, MedLabel, MedicationRow, NoteRow, QuestionRow } from "@/lib/store/types";
import type { SeedTables } from "@/lib/story/seed";
import { CLOCK_LAST_DAY } from "./story";

/** The one slot the story's tablets are taken in (the bags say "every MORNING"). */
export const SHEET_DOSE_SLOT = "morning" as const;
/** The app's own reasons after 没吃 (lib/daily/schedule.ts FIXED_REASONS, and the routine's tai chi morning). */
export const SHEET_MISSED_REASONS = ["tai_chi_morning", "forgot", "away", "not_with_me"] as const;
export type SheetMissedReason = (typeof SHEET_MISSED_REASONS)[number];

const day = z.number().int().min(0).max(CLOCK_LAST_DAY);
const id = z.string().min(1).max(60);
const words = z.string().trim().min(1).max(200);

export const storyEditsSchema = z
  .object({
    v: z.literal(1),
    meds: z
      .array(z.object({ id, present: z.boolean().optional(), label: z.enum(["confirmed", "awaiting"]).optional() }).strict())
      .max(20)
      .optional(),
    doses: z
      .array(z.object({ med: id, day, state: z.enum(["taken", "missed", "no_reply", "none"]), reason: z.enum(SHEET_MISSED_REASONS).optional() }).strict())
      .max(200)
      .optional(),
    bp: z
      .array(
        z
          .object({
            day,
            slot: z.enum(["morning", "evening"]),
            state: z.enum(["recorded", "not_measured", "none"]),
            systolic: z.number().int().min(60).max(260).optional(),
            diastolic: z.number().int().min(30).max(160).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    notes: z
      .object({ hide: z.array(id).max(40).optional(), add: z.array(z.object({ day, text: words }).strict()).max(20).optional() })
      .strict()
      .optional(),
    questions: z
      .object({
        hide: z.array(id).max(40).optional(),
        add: z.array(z.object({ day, text: words, for: z.enum(["doctor", "pharmacist"]).optional() }).strict()).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type StoryEdits = z.infer<typeof storyEditsSchema>;
export type MedEdit = NonNullable<StoryEdits["meds"]>[number];
export type DoseEdit = NonNullable<StoryEdits["doses"]>[number];
export type BpEdit = NonNullable<StoryEdits["bp"]>[number];

export const EMPTY_STORY_EDITS: StoryEdits = { v: 1 };

/** How many things the sheet changes (0: the story as it is). */
export function countStoryEdits(edits: StoryEdits | null | undefined): number {
  if (!edits) return 0;
  return (
    (edits.meds?.length ?? 0) +
    (edits.doses?.length ?? 0) +
    (edits.bp?.length ?? 0) +
    (edits.notes?.hide?.length ?? 0) +
    (edits.notes?.add?.length ?? 0) +
    (edits.questions?.hide?.length ?? 0) +
    (edits.questions?.add?.length ?? 0)
  );
}

/** Why a sheet was refused; `message` is a sentence the director reads. */
export class StoryEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryEditError";
  }
}

// ---------------------------------------------------------------- the prop bags of the medicines that wait for one

interface ExpectedLabel {
  drug_text: string;
  drug_id: string;
  strength: string;
  directions: string;
  dispensed?: string;
  clinic?: string;
}

/** The medicines the template leaves "awaiting_label", and the prop bag each one has (fixtures/labels). */
const PROP_LABELS: Readonly<Record<string, { expected: ExpectedLabel; photo: string }>> = {
  "med-losartan": { expected: losartanLabel, photo: "labels/losartan.png" },
};

/** The bag's words as a label row, the shape the template's own amlodipine label has. */
function propLabel(medId: string): MedLabel | null {
  const prop = PROP_LABELS[medId];
  if (!prop) return null;
  const e = prop.expected;
  return {
    text: `${e.drug_text}\n${e.directions}`,
    drug: e.drug_id,
    strength: e.strength,
    directions: e.directions,
    dispensed: e.dispensed ?? null,
    clinic: e.clinic ?? null,
    photo_fixture: prop.photo,
  };
}

/** May this medicine's bag be set to "awaiting" / "confirmed" on the sheet? (a prescription: the others have no bag to read) */
export function labelChoices(med: Pick<MedicationRow, "id" | "origin" | "label">): { awaiting: boolean; confirmed: boolean } {
  if (med.origin !== "prescription") return { awaiting: false, confirmed: false };
  return { awaiting: true, confirmed: !!med.label || !!PROP_LABELS[med.id] };
}

// ---------------------------------------------------------------- apply

function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

function lastOf<T, K>(items: readonly T[] | undefined, key: (x: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const x of items ?? []) out.set(key(x), x);
  return out;
}

/**
 * The template's tables with the sheet's changes in (a new object; `t` is not touched). `base` is what every new row
 * carries (the scope and the layout's day-0 stamp; the layout stamps each record with its own moment afterwards). The
 * same thing named twice: the later entry counts.
 */
export function applyStoryEdits(t: SeedTables, edits: StoryEdits | null | undefined, base: { session_id: string; created_at: string }): SeedTables {
  if (!edits || countStoryEdits(edits) === 0) return t;

  // medicines
  const medEdits = lastOf(edits.meds, (m) => m.id);
  for (const mid of medEdits.keys()) {
    if (!t.medications.some((m) => m.id === mid)) throw new StoryEditError(`The story sheet names a medicine the story does not have (${mid}).`);
  }
  const medications: MedicationRow[] = [];
  for (const m of t.medications) {
    const e = medEdits.get(m.id);
    if (e?.present === false) continue;
    if (!e?.label) {
      medications.push(m);
      continue;
    }
    const can = labelChoices(m);
    if (e.label === "awaiting") {
      if (!can.awaiting) throw new StoryEditError(`Only a prescription's bag can wait for his photograph (${m.id}).`);
      medications.push({ ...m, label: null, status: "awaiting_label" });
    } else {
      if (!can.confirmed) throw new StoryEditError(`This medicine has no bag in the props to read (${m.id}).`);
      medications.push(m.label ? { ...m, status: "label_confirmed" } : { ...m, label: propLabel(m.id), status: "label_confirmed" });
    }
  }
  const medById = new Map(medications.map((m) => [m.id, m]));

  // doses: one morning's answer
  const doseKey = (med: string, d: number) => `${med}|${d}`;
  const doseEdits = lastOf(edits.doses, (d) => doseKey(d.med, d.day));
  const dose_logs: DoseLogRow[] = t.dose_logs.filter((d) => d.slot !== SHEET_DOSE_SLOT || !doseEdits.has(doseKey(d.medication_id, d.day)));
  for (const e of doseEdits.values()) {
    const med = t.medications.find((m) => m.id === e.med);
    if (!med || med.origin !== "prescription" || med.start_day === null) throw new StoryEditError(`The story sheet records a tablet for a medicine he is not prescribed (${e.med}).`);
    if (e.day < med.start_day) throw new StoryEditError(`The story sheet records a tablet before he had the medicine (${e.med}, day ${e.day}).`);
    // a medicine the sheet took out of the story has no doses; "none" is the record left out
    if (e.state === "none" || !medById.has(e.med)) continue;
    const reason = e.state === "no_reply" ? "no_reply" : e.state === "missed" ? (e.reason ?? null) : null;
    const was = t.dose_logs.find((d) => d.medication_id === e.med && d.day === e.day && d.slot === SHEET_DOSE_SLOT);
    dose_logs.push({
      ...base,
      id: was?.id ?? `dose-d${e.day}-${e.med}-${SHEET_DOSE_SLOT}`,
      medication_id: e.med,
      day: e.day,
      slot: SHEET_DOSE_SLOT,
      state: e.state === "taken" ? "taken" : e.state === "missed" ? "missed" : "unconfirmed",
      reason,
      // his words for a reason are the template's own (「打太极，忘了」), when it has them
      reason_text: e.state === "missed" && reason ? (t.dose_logs.find((d) => d.reason === reason && d.reason_text)?.reason_text ?? null) : null,
    });
  }
  dose_logs.sort((a, b) => a.day - b.day);

  // readings
  const bpKey = (d: number, slot: string) => `${d}|${slot}`;
  const bpEdits = lastOf(edits.bp, (b) => bpKey(b.day, b.slot));
  const bp_readings: BpReadingRow[] = t.bp_readings.filter((b) => !bpEdits.has(bpKey(b.day, b.slot)));
  for (const e of bpEdits.values()) {
    if (e.state === "none") continue;
    const was = t.bp_readings.find((b) => b.day === e.day && b.slot === e.slot);
    if (e.state === "recorded") {
      if (e.systolic === undefined || e.diastolic === undefined || e.systolic <= e.diastolic) {
        throw new StoryEditError(`A reading on the story sheet needs both numbers, the first one higher (day ${e.day}, ${e.slot}).`);
      }
    }
    bp_readings.push({
      ...base,
      id: was?.id ?? `bp-d${e.day}-${e.slot}`,
      day: e.day,
      slot: e.slot,
      systolic: e.state === "recorded" ? e.systolic! : null,
      diastolic: e.state === "recorded" ? e.diastolic! : null,
      state: e.state === "recorded" ? "recorded" : "unconfirmed",
      note: was?.note ?? null,
    });
  }
  bp_readings.sort((a, b) => a.day - b.day);

  // notes
  const hideNotes = new Set(edits.notes?.hide ?? []);
  for (const nid of hideNotes) if (!t.notes.some((n) => n.id === nid)) throw new StoryEditError(`The story sheet leaves out a note the story does not have (${nid}).`);
  const notes: NoteRow[] = [
    ...t.notes.filter((n) => !hideNotes.has(n.id)),
    ...(edits.notes?.add ?? []).map((n, i) => ({
      ...base,
      id: `note-d${n.day}-s${i + 1}`,
      day: n.day,
      text: n.text,
      source: "typed" as const,
      lang: hasHan(n.text) ? "zh-Hans" : "en",
      app_reply: null,
    })),
  ];

  // questions
  const hideQuestions = new Set(edits.questions?.hide ?? []);
  for (const qid of hideQuestions) {
    if (!t.questions.some((q) => q.id === qid)) throw new StoryEditError(`The story sheet leaves out a question the story does not have (${qid}).`);
  }
  const questions: QuestionRow[] = [
    ...t.questions.filter((q) => !hideQuestions.has(q.id)),
    ...(edits.questions?.add ?? []).map((q, i) => ({
      ...base,
      id: `q-sheet-${i + 1}`,
      for: q.for ?? ("doctor" as const),
      origin: "own" as const,
      text: q.text,
      lang: hasHan(q.text) ? "zh-Hans" : "en",
      status: "open" as const,
      answer_text: null,
      answer_utterance_id: null,
      answer_visit_id: null,
      answer_speaker: null,
      asked_at_visit_id: null,
      created_day: q.day,
      evidence: null,
    })),
  ];

  return { ...t, medications, dose_logs, bp_readings, notes, questions };
}

// ---------------------------------------------------------------- the story as the sheet shows it

/** The story's own details, as the sheet on /director lists them before any change (plain data for the client). */
export interface StorySheetBase {
  d0: string;
  lastDay: number;
  /** `name` is "" for a medicine nobody identified (the relative's box) */
  meds: { id: string; name: string; origin: MedicationRow["origin"]; startDay: number | null; label: "confirmed" | "awaiting" | null; canAwait: boolean; canConfirm: boolean }[];
  doses: { med: string; day: number; state: "taken" | "missed" | "no_reply"; reason: string | null }[];
  bp: { day: number; slot: "morning" | "evening"; state: "recorded" | "not_measured"; systolic: number | null; diastolic: number | null }[];
  notes: { id: string; day: number; text: string }[];
  questions: { id: string; day: number | null; text: string; for: QuestionRow["for"]; answered: boolean }[];
}

export function storySheetBase(t: SeedTables, d0: string): StorySheetBase {
  const titleCase = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);
  return {
    d0,
    lastDay: CLOCK_LAST_DAY,
    meds: t.medications.map((m) => {
      const can = labelChoices(m);
      return {
        id: m.id,
        name: titleCase(m.label?.drug ?? m.drug_id ?? ""),
        origin: m.origin,
        startDay: m.start_day,
        label: m.origin !== "prescription" ? null : m.status === "awaiting_label" ? "awaiting" : "confirmed",
        canAwait: can.awaiting,
        canConfirm: can.confirmed,
      };
    }),
    doses: t.dose_logs
      .filter((d) => d.slot === SHEET_DOSE_SLOT)
      .map((d) => ({
        med: d.medication_id,
        day: d.day,
        state: d.state === "taken" ? ("taken" as const) : d.state === "missed" ? ("missed" as const) : ("no_reply" as const),
        reason: d.reason,
      })),
    bp: t.bp_readings
      .filter((b) => b.slot === "morning" || b.slot === "evening")
      .map((b) => ({
        day: b.day,
        slot: b.slot as "morning" | "evening",
        state: b.state === "recorded" && b.systolic !== null ? ("recorded" as const) : ("not_measured" as const),
        systolic: b.systolic,
        diastolic: b.diastolic,
      })),
    notes: t.notes.map((n) => ({ id: n.id, day: n.day, text: n.text })),
    questions: t.questions.map((q) => ({ id: q.id, day: q.created_day, text: q.text, for: q.for, answered: q.status === "answered" })),
  };
}
