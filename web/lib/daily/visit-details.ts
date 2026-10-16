/**
 * What a visit row has no column for (owner 10-15, the demo video's first scene: 「她点那天，显示这次就诊的信息和医生」): the time
 * of a planned visit and the doctor a clinic visit is with. Kept in the scope's settings (`visit_details`, JSON, keyed by
 * visit id), so no migration: ScopeSettings takes any key, and the example's layout writes it (lib/story/example.ts with
 * fixtures/example-extra.json; a 「重新铺一遍」 or a clear resets it with the timeline's other keys).
 *
 *   visitDetail(scope, visitId)   { time "HH:MM" | null, doctor | null } for one visit
 *   doctorWords(doctor, locale)   the doctor's name as a screen says it: the full name where a visit is listed
 *                                 (「林伟明医生（虚构）」 / "Dr Lim Wei Ming (fictional)"), the short form inside a sentence
 *                                 (「林医生」 / "Dr Lim")
 *
 * An example account laid out before these details existed reads them from the example's own file (its visit ids are the
 * template's), so a filming account that was not laid out again still shows them. Nothing here is clinical: a name and a
 * time. Pure (no store); server and client safe.
 */
import extraJson from "@/fixtures/example-extra.json";
import type { Locale } from "@/lib/i18n";
import type { SessionRow } from "@/lib/store/types";

/** A doctor as the record names him: the full name, a short form for sentences, and their Chinese. */
export interface DoctorName {
  name: string;
  short?: string | null;
  name_zh?: string | null;
  short_zh?: string | null;
}

/** One visit's details: a planned visit's time ("10:30", his time zone) and the doctor. */
export interface VisitDetail {
  time: string | null;
  doctor: DoctorName | null;
}

/** The settings key (ScopeSettings.visit_details). */
export const VISIT_DETAILS_KEY = "visit_details";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function doctorOf(v: unknown): DoctorName | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const name = str(d.name);
  if (!name) return null;
  return { name, short: str(d.short), name_zh: str(d.name_zh), short_zh: str(d.short_zh) };
}

function detailOf(v: unknown): VisitDetail | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const time = str(d.time);
  const out: VisitDetail = { time: time && HHMM.test(time) ? time : null, doctor: doctorOf(d.doctor) };
  return out.time || out.doctor ? out : null;
}

/** A visit_details object as stored (only well-formed entries are kept). */
export function readVisitDetails(raw: unknown): Record<string, VisitDetail> {
  const out: Record<string, VisitDetail> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = detailOf(v);
    if (d) out[id] = d;
  }
  return out;
}

interface ExtraDetails {
  doctors?: Record<string, unknown>;
  visit_details?: Record<string, unknown>;
}

/**
 * The example's visit details as the settings keep them: each visit's doctor written out (the file names him by a key),
 * its time where it has one. The file's "about" lines are not entries.
 */
export function exampleVisitDetails(file: ExtraDetails = extraJson as ExtraDetails): Record<string, { time?: string; doctor?: DoctorName }> {
  const doctors = file.doctors ?? {};
  const out: Record<string, { time?: string; doctor?: DoctorName }> = {};
  for (const [id, v] of Object.entries(file.visit_details ?? {})) {
    if (!v || typeof v !== "object") continue;
    const e = v as { time?: unknown; doctor?: unknown };
    const doctor = typeof e.doctor === "string" ? doctorOf(doctors[e.doctor]) : null;
    const time = str(e.time);
    if (!doctor && !time) continue;
    out[id] = { ...(time && HHMM.test(time) ? { time } : {}), ...(doctor ? { doctor } : {}) };
  }
  return out;
}

/** Every visit's details in this scope: its settings, else (an example account laid out before 10-15) the example's file. */
export function scopeVisitDetails(scope: Partial<Pick<SessionRow, "settings" | "example_data">>): Record<string, VisitDetail> {
  const raw = scope.settings && typeof scope.settings === "object" ? scope.settings[VISIT_DETAILS_KEY] : undefined;
  if (raw !== undefined && raw !== null) return readVisitDetails(raw);
  return scope.example_data ? readVisitDetails(exampleVisitDetails()) : {};
}

const NONE: VisitDetail = { time: null, doctor: null };

/** One visit's details (both null when the scope has none for it). */
export function visitDetail(scope: Partial<Pick<SessionRow, "settings" | "example_data">>, visitId: string): VisitDetail {
  return scopeVisitDetails(scope)[visitId] ?? NONE;
}

/** The doctor's name in the screen's language: "full" where a visit is listed, "short" inside a sentence. */
export function doctorWords(doctor: DoctorName | null | undefined, locale: Locale, form: "full" | "short" = "full"): string | null {
  if (!doctor) return null;
  if (locale === "zh-Hans") {
    const zh = form === "short" ? (doctor.short_zh ?? doctor.name_zh) : doctor.name_zh;
    if (zh) return zh;
  }
  return form === "short" ? (doctor.short ?? doctor.name) : doctor.name;
}
