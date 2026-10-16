/**
 * His profile as his phone shows it (/p/profile, GET /api/profile; M11, journey 01). Track C. Server-only.
 *
 *   settings   his clinic, breakfast (and the morning reminder it sets), his weekly habits, when each part of the day
 *              is reminded: what the app schedules by. His clinic and each routine entry also have a fact row, so the
 *              page can say who wrote them (clinicFact, breakfastFact, habitFacts).
 *   facts      what he (or a family member, once he said 对) recorded: name, age, conditions, allergies, languages ...
 *   pending    what a family member wrote that waits for his 对 / 改一下 / 不对
 *
 * Who wrote each line rides with it (他自己 / 女儿写的，等你确认 / 本人确认（女儿写的）/ 看诊). No scope id, no user id, no day
 * number: dates are real dates.
 */
import { reminderSchedule } from "@/lib/daily/schedule";
import type { ProfileFactRow, ScopeRoutineEntry, SessionRow, Store } from "@/lib/store/types";
import { scopeClinic, scopeD0, scopeReminderTime, scopeRoutine } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { factEntry, isBreakfast, isPending, isShown, sameEntry } from "./facts";
import { slotTimes, type SlotTime } from "./reminder-times";

export interface FactView {
  id: string;
  kind: string;
  text: string;
  /** "patient": his own; "family": a family member's (pending or, once confirmed, 「本人确认（女儿写的）」); "visit" */
  source: string;
  /** who typed it, as a label ("Wei Ling", "family", "patient") */
  enteredBy: string | null;
  confirmed: boolean;
  /** he changed a family member's words before confirming */
  editedByHim: boolean;
  /** the real date it was recorded */
  date: string | null;
}

export interface ProfileView {
  /** how the profile names him (the name fact), or null */
  name: string | null;
  clinic: string | null;
  breakfast: string | null;
  /** the morning dose's first reminder (breakfast + 15 min, or the time he chose) */
  reminderAt: string;
  /** every part of the day with its reminder times, and whether he set the time himself */
  slots: SlotTime[];
  habits: ScopeRoutineEntry[];
  /** the fact row behind his clinic, his breakfast and each weekly habit (same order as habits), or null */
  clinicFact: FactView | null;
  breakfastFact: FactView | null;
  habitFacts: (FactView | null)[];
  facts: FactView[];
  pending: FactView[];
  onboarding: "started" | "done" | null;
  example: boolean;
}

function factView(f: ProfileFactRow, d0: string | null): FactView {
  const data = (f.data && typeof f.data === "object" ? f.data : {}) as Record<string, unknown>;
  return {
    id: f.id,
    kind: f.kind,
    text: f.text,
    source: f.source,
    enteredBy: f.entered_by,
    confirmed: f.confirmed_by !== null,
    editedByHim: typeof data.edited_from === "string",
    date: d0 && f.created_day !== null ? storyDate(d0, f.created_day) : null,
  };
}

export async function profileView(store: Store, scope: SessionRow): Promise<ProfileView> {
  const facts = await store.listProfileFacts(scope.id);
  const d0 = scope.d0 ?? (scope.kind === "account" ? null : scopeD0(scope));
  const routine = scopeRoutine(scope);
  const breakfast = routine.find(isBreakfast)?.time ?? null;
  const own = facts.filter(isShown);
  const clinic = scopeClinic(scope);
  const habits = routine.filter((r) => !isBreakfast(r));
  const routineFact = (entry: ScopeRoutineEntry | undefined): FactView | null => {
    const f = entry ? own.find((x) => x.kind === "routine" && factEntry(x) !== null && sameEntry(factEntry(x)!, entry)) : undefined;
    return f ? factView(f, d0) : null;
  };
  const clinicRow = clinic === null ? undefined : own.find((f) => f.kind === "clinic" && f.text === clinic);
  return {
    name: own.find((f) => f.kind === "name")?.text ?? null,
    clinic,
    breakfast,
    reminderAt: scopeReminderTime(scope) ?? reminderSchedule(routine, "after_breakfast").first,
    slots: slotTimes(scope),
    habits,
    clinicFact: clinicRow ? factView(clinicRow, d0) : null,
    breakfastFact: routineFact(routine.find(isBreakfast)),
    habitFacts: habits.map((h) => routineFact(h)),
    facts: own.map((f) => factView(f, d0)),
    pending: facts.filter(isPending).map((f) => factView(f, d0)),
    onboarding: scope.onboarding,
    example: scope.example_data,
  };
}
