/**
 * What a scope says about itself: its day 0, time zone, routine, clinic, reminder time (C2 architecture review,
 * finding 13: "读的时候先看空间、再看模板"). Pure; server and tests.
 *
 *   account    the scope row only (session.d0, session.tz, session.settings). Never the template: a blank account has
 *              no routine and no clinic until he says so, and the example account's routine is the template's moved
 *              to its own weekdays (written into its settings when it was laid out).
 *   demo       the scope row first when it carries a value, then the template timeline (lib/story/seed.ts), exactly
 *              what the demo read before (d0 2026-08-24, tai chi on Tue/Thu, Blossom Family Clinic).
 *
 * Every reader of these values goes through here (lib/daily/doses.ts d0Of / routineOf, lib/daily/reminders.ts, the
 * clinic in lib/visit/pipeline.ts, the label date check in lib/meds/write.ts, lib/visit/view.ts, page headers).
 */
import { templateCast, templateDefaults } from "@/lib/story/seed";
import { DEFAULT_TZ, scopeNowMs } from "@/lib/time/clock";
import type { ScopeKind, ScopeRoutineEntry, ScopeSettings, SessionRow, TemplateId } from "./types";

/** The columns these helpers read. Older callers pass only { template }: that is a demo row. */
export type ScopeLike = { template: TemplateId } & Partial<Pick<SessionRow, "kind" | "d0" | "tz" | "settings">>;

export function scopeKind(row: Pick<ScopeLike, "kind">): ScopeKind {
  return row.kind ?? "sandbox";
}

/** An account's own space (real dates, real people)? */
export function isAccount(row: Partial<Pick<SessionRow, "kind">> | null | undefined): boolean {
  return row?.kind === "account";
}

/** A judge sandbox or the crew's filming session (the story clock, join codes)? */
export function isDemo(row: Partial<Pick<SessionRow, "kind">> | null | undefined): boolean {
  return !!row && row.kind !== "account";
}

const settingsOf = (row: ScopeLike): ScopeSettings => (row.settings && typeof row.settings === "object" ? row.settings : {});

/** The template applies only to a demo row with the template timeline. */
function demoTemplate(row: ScopeLike): "mr-tan" | null {
  return isAccount(row) || row.template !== "mr-tan" ? null : "mr-tan";
}

/** Day 0: the account's d0; a demo row's d0 when set, else the template's (2026-08-24). */
export function scopeD0(row: ScopeLike): string {
  if (row.d0) return row.d0;
  if (isAccount(row)) throw new Error("an account scope has no d0");
  return templateDefaults(demoTemplate(row) ?? "mr-tan").d0;
}

export function scopeTz(row: ScopeLike): string {
  return row.tz && row.tz.trim() ? row.tz : DEFAULT_TZ;
}

/** His routine: the scope's settings.routine; for a demo row without one, the template persona's. */
export function scopeRoutine(row: ScopeLike): ScopeRoutineEntry[] {
  const own = settingsOf(row).routine;
  if (Array.isArray(own)) return own;
  const t = demoTemplate(row);
  return t ? ((templateCast(t).persona.routine ?? []) as ScopeRoutineEntry[]) : [];
}

/** His clinic: settings.clinic; for a demo row without one, the template's Healthier SG clinic. null: not known. */
export function scopeClinic(row: ScopeLike): string | null {
  const own = settingsOf(row).clinic;
  if (typeof own === "string" && own.trim()) return own;
  const t = demoTemplate(row);
  return t ? (templateCast(t).persona.healthier_sg_clinic ?? null) : null;
}

/** The first dose reminder time he chose ("HH:MM"), or null (breakfast + 15 min). */
export function scopeReminderTime(row: ScopeLike): string | null {
  const t = settingsOf(row).reminder_time;
  return typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t) ? t : null;
}

/** The scope's "now" (a filming account's offset included) as epoch ms. */
export function scopeNow(row: Partial<Pick<SessionRow, "kind" | "filming" | "clock_offset_ms">>, nowMs: number): number {
  return scopeNowMs({ kind: row.kind ?? "sandbox", filming: row.filming ?? false, clock_offset_ms: row.clock_offset_ms ?? null }, nowMs);
}

/**
 * C2 track J (filming): may this scope use the example's sample material (the sample visit replay, the sample label
 * photos)? The example account, as before; and a filming account when the request or the page is the film crew's (its
 * visit and prescription scenes are filmed with them). Any other account: no, whoever asks.
 */
export function samplesAllowed(row: Partial<Pick<SessionRow, "kind" | "example_data" | "filming">>, crew: boolean): boolean {
  if (row.example_data === true) return true;
  return row.kind === "account" && row.filming === true && crew;
}

/**
 * C2 track J (filming): an instant on the scope's own clock (a row's stamp: the store stamps a filming account's rows on
 * its clock) back on the app's clock, for code that takes the app's "now" (lib/daily buildDoseDay). The offset is taken
 * off for a filming account; the same instant for every other scope.
 */
export function appMsOf(row: Partial<Pick<SessionRow, "kind" | "filming" | "clock_offset_ms">>, scopeMs: number): number {
  return scopeMs - scopeNow(row, 0);
}
