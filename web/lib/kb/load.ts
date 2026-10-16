/**
 * Knowledge base loader: web/kb/*.json (read-only data, curated by people; see web/scripts/data/build_kb.py).
 *
 * Licence rule (web-app.md section 7): Singapore government content may only be shown as our own paraphrase
 * with a citation. What the app shows is always the paraphrase in patient_text.json (or a label / doctor quote),
 * never HealthHub text, and US label text never reaches the patient screen. When sources disagree the app does
 * not merge them; it takes the "uncertain" route.
 *
 * Every file is validated once with zod (loose objects: extra keys are allowed, missing keys fail loudly).
 * Server-only (lib/safety, route handlers, scripts).
 */
import { z } from "zod";
import drugsJson from "@/kb/drugs.json";
import glossaryJson from "@/kb/glossary.json";
import patientTextJson from "@/kb/patient_text.json";
import referralsJson from "@/kb/referrals.json";
import screeningJson from "@/kb/screening.json";
import sourcesJson from "@/kb/sources.json";

// ---------------------------------------------------------------- schemas

const drugField = z.looseObject({
  en: z.string(),
  zh: z.string(),
  zh_status: z.string(),
  source_id: z.string(),
});

export const DRUG_FIELD_NAMES = ["indication", "how_to_take", "missed_dose", "stop_or_see_doctor", "overdose"] as const;
export type DrugFieldName = (typeof DRUG_FIELD_NAMES)[number];

const drugSchema = z.looseObject({
  id: z.string(),
  display_name: z.string(),
  aliases: z.array(z.string()),
  source_id: z.string(),
  fields: z.looseObject({
    indication: drugField,
    how_to_take: drugField,
    missed_dose: drugField,
    stop_or_see_doctor: drugField,
    overdose: drugField,
  }),
  other_points: z.array(
    z.looseObject({
      key: z.string(),
      topic: z.string(),
      en: z.string(),
      zh: z.string(),
      zh_status: z.string(),
      source_id: z.string(),
    }),
  ),
});

const drugsFileSchema = z.looseObject({ meta: z.looseObject({}), drugs: z.array(drugSchema) });

const patientTextSchema = z.looseObject({
  meta: z.looseObject({}),
  entries: z.array(
    z.looseObject({
      id: z.string(),
      drug: z.string(),
      evidence_field: z.string(),
      source_id: z.string(),
      status: z.string(),
      en: z.string(),
      zh: z.string(),
      reviewed_by: z.string().optional(),
      reviewed_on: z.string().optional(),
    }),
  ),
});

const referralSchema = z.looseObject({
  id: z.string(),
  section: z.string(),
  kind: z.string(),
  situation: z.string(),
  refer_to: z.string(),
  singapore_contact: z.string(),
  source: z.string(),
  license: z.string().optional(),
  note_zh: z.string().optional(),
});
const referralsFileSchema = z.looseObject({ meta: z.looseObject({}), referrals: z.array(referralSchema) });

const screeningFileSchema = z.looseObject({
  meta: z.looseObject({}),
  screening: z.array(z.looseObject({ id: z.string(), section: z.string(), kind: z.string() })),
});

const sourceSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  page_date: z.string(),
  license: z.string().optional(),
});
const sourcesFileSchema = z.looseObject({ meta: z.looseObject({}), sources: z.record(z.string(), sourceSchema) });

const glossarySchema = z.looseObject({
  meta: z.looseObject({}),
  drugs: z.record(z.string(), z.array(z.string())),
  units: z.record(z.string(), z.array(z.string())),
  frequencies: z.record(z.string(), z.array(z.string())),
  times: z.record(z.string(), z.array(z.string())),
  numbers: z.record(z.string(), z.array(z.string())),
  directive_patterns: z.looseObject({
    note: z.string().optional(),
    en: z.array(z.string()),
    zh: z.array(z.string()),
  }),
});

export type KbDrug = z.infer<typeof drugSchema>;
export type KbDrugField = z.infer<typeof drugField>;
export type KbOtherPoint = KbDrug["other_points"][number];
export type PatientTextEntry = z.infer<typeof patientTextSchema>["entries"][number];
export type Referral = z.infer<typeof referralSchema>;
export type ScreeningItem = z.infer<typeof screeningFileSchema>["screening"][number];
export type KbSource = z.infer<typeof sourceSchema>;
export type Glossary = z.infer<typeof glossarySchema>;

export interface Kb {
  drugs: KbDrug[];
  patientText: PatientTextEntry[];
  referrals: Referral[];
  screening: ScreeningItem[];
  sources: Record<string, KbSource>;
  glossary: Glossary;
}

function parse<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`web/kb/${file} does not match the expected shape: ${result.error.message}`);
  return result.data;
}

let cached: Kb | null = null;

/** The parsed knowledge base (shared and read-only: never mutate what it returns). */
export function getKb(): Kb {
  if (!cached) {
    cached = {
      drugs: parse(drugsFileSchema, drugsJson, "drugs.json").drugs,
      patientText: parse(patientTextSchema, patientTextJson, "patient_text.json").entries,
      referrals: parse(referralsFileSchema, referralsJson, "referrals.json").referrals,
      screening: parse(screeningFileSchema, screeningJson, "screening.json").screening,
      sources: parse(sourcesFileSchema, sourcesJson, "sources.json").sources,
      glossary: parse(glossarySchema, glossaryJson, "glossary.json"),
    };
  }
  return cached;
}

// ---------------------------------------------------------------- lookups

export function getDrug(id: string): KbDrug | null {
  return getKb().drugs.find((d) => d.id === id) ?? null;
}

export function getSource(id: string): KbSource | null {
  return getKb().sources[id] ?? null;
}

export function getPatientText(id: string): PatientTextEntry | null {
  return getKb().patientText.find((e) => e.id === id) ?? null;
}

export function getReferral(id: string): Referral | null {
  return getKb().referrals.find((r) => r.id === id) ?? null;
}

export interface Evidence {
  drug: string;
  /** "indication", or "other_points:<topic>" exactly as patient_text.json writes it */
  field: string;
  en: string;
  zh: string;
  zh_status: string;
  source_id: string;
}

/**
 * The drugs.json text a patient_text entry restates (its evidence_field). Fields are named directly
 * ("indication") or as "other_points:<topic>". Returns null when it cannot be found.
 */
export function evidenceFor(entry: Pick<PatientTextEntry, "drug" | "evidence_field">): Evidence | null {
  const drug = getDrug(entry.drug);
  if (!drug) return null;
  const f = entry.evidence_field;
  if (f.startsWith("other_points:")) {
    const topic = f.slice("other_points:".length);
    const point = drug.other_points.find((p) => p.topic === topic);
    return point
      ? { drug: drug.id, field: f, en: point.en, zh: point.zh, zh_status: point.zh_status, source_id: point.source_id }
      : null;
  }
  if ((DRUG_FIELD_NAMES as readonly string[]).includes(f)) {
    const field = drug.fields[f as DrugFieldName];
    return { drug: drug.id, field: f, en: field.en, zh: field.zh, zh_status: field.zh_status, source_id: field.source_id };
  }
  return null;
}

/** Strip the markdown emphasis the referral table uses (**995**). */
export function plainReferralText(s: string): string {
  return s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Numbers listed as "Do not display" in referrals.json B4-06 (retired or stale helplines). Read from the data,
 * never hard-coded: every bold segment of B4-06 singapore_contact that contains digits.
 */
export function doNotDisplayNumbers(): string[] {
  const row = getReferral("B4-06");
  if (!row) throw new Error("referrals.json has no B4-06 row (the do-not-display list)");
  const out: string[] = [];
  for (const m of row.singapore_contact.matchAll(/\*\*([^*]+)\*\*/g)) {
    const text = m[1].trim();
    if (/\d{3}/.test(text)) out.push(text);
  }
  if (out.length === 0) throw new Error("referrals.json B4-06 lists no numbers in bold");
  return out;
}
