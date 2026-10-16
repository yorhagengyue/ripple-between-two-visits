/**
 * Setting up a blank account, one screen at a time (journey 01 建档; real-app 2.5; e2e-chains 12). Track C.
 *
 *   who        现在是谁在填：我自己 / 家人帮我填. Sign-up's own answer decides (「家人帮我操作」, recorded on his consent
 *              as `assisted`); this screen only lets him change it, and skipping it changes nothing.
 *   clinic     常去的诊所 (settings.clinic: visits default to it; and a clinic fact)
 *   breakfast  早饭几点 (settings.routine: the morning reminder is breakfast + 15 min, lib/daily/schedule.ts; and a
 *              routine fact)
 *   habits     每周固定做的事 (settings.routine: weekday habits, the reasons offered after 「还没吃」; a routine fact each)
 *   meds       去拍药袋 (track F's /p/meds/add) / 以后再说
 *   age, conditions, allergies   profile facts (common choices and his own words)
 *   family     现在邀请 (track D's /p/family, every switch off) / 以后再说
 *   reminders  开提醒 (track I's push; the browser's permission needs his tap) / 以后再说
 *   done       去「今天」
 *
 * Every screen can be skipped; the screen he is on is kept (settings.onboarding_step), so he picks up where he left.
 * While someone helps him (「家人帮我填」), what is entered is a family member's proposal: every fact of the round is
 * source family, confirmed_by null and waits for his 「对」, and a clinic or routine stays out of his settings (no
 * reminder moves) until he confirms it (real-app 2.5 line 138, M11 rule 4). What he enters himself is written twice:
 * the setting the app schedules by, and a fact row with its source (lib/profile/facts.ts syncSettingFacts).
 * Server-only.
 */
import { publish } from "@/lib/bus";
import type { ProfileFactRow, ScopeRoutineEntry, ScopeSettings, SessionRow, Store } from "@/lib/store/types";
import { scopeRoutine } from "@/lib/store/scope";
import { questionKey } from "./questions";
import { addFact, cleanFactText, cleanRoutineEntry, cleanTime, isBreakfast, ProfileInputError, routineFactText, sameRoutine, syncSettingFacts, type FactAuthor, type FactKind } from "./facts";

export const ONBOARD_STEPS = ["who", "clinic", "breakfast", "habits", "meds", "age", "conditions", "allergies", "family", "reminders", "done"] as const;
export type OnboardStep = (typeof ONBOARD_STEPS)[number];

export function isOnboardStep(x: unknown): x is OnboardStep {
  return typeof x === "string" && (ONBOARD_STEPS as readonly string[]).includes(x);
}

export function nextStep(step: OnboardStep): OnboardStep {
  const i = ONBOARD_STEPS.indexOf(step);
  return ONBOARD_STEPS[Math.min(i + 1, ONBOARD_STEPS.length - 1)];
}

export function previousStep(step: OnboardStep): OnboardStep | null {
  const i = ONBOARD_STEPS.indexOf(step);
  return i > 0 ? ONBOARD_STEPS[i - 1] : null;
}

/** The screen he is on (settings.onboarding_step), else the first. */
export function currentStep(scope: Pick<SessionRow, "settings">): OnboardStep {
  const s = scope.settings?.onboarding_step;
  return isOnboardStep(s) ? s : "who";
}

/** What sign-up recorded about who was tapping (track A writes consent `assisted`). */
export async function signupAssisted(store: Store, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const records = await store.listConsentRecords(userId, { kind: "terms_privacy" }).catch(() => []);
  return records.at(-1)?.assisted === true;
}

export type OnboardBy = "self" | "family";

/**
 * Who is filling this round in. Sign-up's own answer decides (「家人帮我操作」: his terms consent carries `assisted`);
 * the `who` screen can change it for the round (settings.onboarding_by), and only an answer given there does. An
 * account's space has its owner's id.
 */
export async function onboardingBy(store: Store, scope: Pick<SessionRow, "id" | "settings">): Promise<OnboardBy> {
  const chosen = scope.settings?.onboarding_by;
  if (chosen === "self" || chosen === "family") return chosen;
  return (await signupAssisted(store, scope.id)) ? "family" : "self";
}

/** Someone is helping him on his phone this round: what is entered is a family member's proposal. */
export async function helped(store: Store, scope: Pick<SessionRow, "id" | "settings" | "onboarding">): Promise<boolean> {
  return scope.onboarding !== "done" && (await onboardingBy(store, scope)) === "family";
}

/** Presets for the habits screen: the label the reminders and patterns use, and the words he sees. */
export const HABIT_PRESETS: { label: string; label_zh: string }[] = [
  { label: "Tai chi", label_zh: "打太极" },
  { label: "Morning walk", label_zh: "散步" },
  { label: "Market", label_zh: "去巴刹买菜" },
  { label: "Exercise", label_zh: "做运动" },
];

/** Common answers offered on the conditions and allergies screens (he can also say his own). Recorded, never explained. */
export const CONDITION_CHOICES: { zh: string; en: string }[] = [
  { zh: "高血压", en: "High blood pressure" },
  { zh: "糖尿病", en: "Diabetes" },
  { zh: "高胆固醇", en: "High cholesterol" },
  { zh: "心脏病", en: "Heart disease" },
  { zh: "中风", en: "Stroke" },
  { zh: "肾病", en: "Kidney disease" },
];
export const ALLERGY_CHOICES: { zh: string; en: string }[] = [
  { zh: "青霉素", en: "Penicillin" },
  { zh: "阿司匹林", en: "Aspirin" },
  { zh: "磺胺类药", en: "Sulfa drugs" },
  { zh: "海鲜", en: "Seafood" },
];
export const NO_ALLERGY = { zh: "没有已知的过敏", en: "No known allergies" };

/** What came of 「开提醒」 (lib/push/client.ts enablePush's state, as the onboarding records it), or 「以后再说」. */
export type ReminderResult = "granted" | "denied" | "dismissed" | "unsupported" | "needs_home_screen" | "failed" | "later";

export type OnboardAnswer =
  /** by null: he skipped the screen, so who is filling it in stays what it was (sign-up's answer, or an earlier choice) */
  | { step: "who"; by: OnboardBy | null }
  | { step: "clinic"; clinic: string | null }
  | { step: "breakfast"; time: string | null }
  | { step: "habits"; habits: { label: string; label_zh?: string | null; days: string[]; time: string }[] | null }
  | { step: "meds"; choice: "photo" | "later" }
  | { step: "age"; age: number | null }
  | { step: "conditions"; items: string[] | null }
  | { step: "allergies"; items: string[] | null; none?: boolean }
  | { step: "family"; choice: "invite" | "later" }
  | { step: "reminders"; result: ReminderResult }
  | { step: "done" };

export interface OnboardResult {
  scope: SessionRow;
  /** the screen after this one (null: finished) */
  next: OnboardStep | null;
  /** where his phone goes now */
  href: string;
  /** facts written on this screen */
  facts: ProfileFactRow[];
}

const AGE_MIN = 18;
const AGE_MAX = 120;

/** The facts of one kind he (or the helper) already gave, so a screen seen twice adds nothing twice. */
async function existing(store: Store, scope: SessionRow, kind: FactKind): Promise<ProfileFactRow[]> {
  return (await store.listProfileFacts(scope.id)).filter((f) => f.kind === kind && f.hidden !== true);
}

function routineWith(scope: SessionRow, entries: ScopeRoutineEntry[]): ScopeRoutineEntry[] {
  const kept = scopeRoutine(scope).filter((r) => !entries.some((e) => sameRoutine(r, e)));
  return [...kept, ...entries];
}

/**
 * Apply his answer on one onboarding screen (null values: he skipped it) and move to the next screen. Writes the scope's
 * settings or facts; a helper's clinic and routine become proposals instead of settings.
 */
export async function applyOnboardAnswer(store: Store, scope: SessionRow, answer: OnboardAnswer): Promise<OnboardResult> {
  const helper = answer.step !== "who" && (await helped(store, scope));
  const who: FactAuthor = helper ? { kind: "helper" } : { kind: "patient" };
  const settings: ScopeSettings = {};
  const facts: ProfileFactRow[] = [];
  const fact = async (kind: FactKind, text: string, data?: unknown) => {
    facts.push(await addFact(store, scope, { kind, text, data }, who));
  };

  switch (answer.step) {
    case "who":
      if (answer.by !== null) settings.onboarding_by = answer.by;
      break;
    case "clinic":
      if (answer.clinic !== null) {
        const clinic = cleanFactText(answer.clinic);
        if (helper) await fact("clinic", clinic);
        else settings.clinic = clinic;
      }
      break;
    case "breakfast":
      if (answer.time !== null) {
        const entry: ScopeRoutineEntry = { label: "Breakfast", label_zh: "早饭", days: "daily", time: cleanTime(answer.time) };
        if (helper) await fact("routine", routineFactText(entry), { entry });
        else {
          settings.routine = routineWith(scope, [entry]);
          // the morning reminder follows breakfast again (a time he set by hand earlier no longer holds)
          settings.reminder_time = null;
        }
      }
      break;
    case "habits":
      if (answer.habits !== null && answer.habits.length) {
        const entries = answer.habits.map((h) => cleanRoutineEntry({ ...h, days: h.days }));
        if (entries.some(isBreakfast)) throw new ProfileInputError("routine_invalid");
        if (helper) {
          for (const e of entries) await fact("routine", routineFactText(e), { entry: e });
        } else settings.routine = [...scopeRoutine(scope).filter(keptByHabits), ...entries];
      } else if (answer.habits !== null && !helper) {
        // an empty list he sent: no weekly habits (breakfast and the daily ones stay)
        settings.routine = scopeRoutine(scope).filter(keptByHabits);
      }
      break;
    case "age":
      if (answer.age !== null) {
        if (!Number.isInteger(answer.age) || answer.age < AGE_MIN || answer.age > AGE_MAX) throw new ProfileInputError("age_invalid");
        for (const old of await existing(store, scope, "age")) await store.updateProfileFact(scope.id, old.id, { hidden: true });
        await fact("age", String(answer.age), { years: answer.age });
      }
      break;
    case "conditions":
    case "allergies": {
      const kind: FactKind = answer.step === "conditions" ? "condition" : "allergy";
      const items = [...(answer.items ?? [])];
      if (answer.step === "allergies" && answer.none) items.push(NO_ALLERGY.zh);
      const had = new Set((await existing(store, scope, kind)).map((f) => questionKey(f.text)));
      for (const raw of items) {
        const text = cleanFactText(raw);
        if (had.has(questionKey(text))) continue;
        had.add(questionKey(text));
        await fact(kind, text, answer.step === "allergies" && text === NO_ALLERGY.zh ? { none: true } : null);
      }
      break;
    }
    case "reminders":
      settings.onboarding_reminders = answer.result;
      break;
    case "meds":
    case "family":
    case "done":
      break;
  }

  // once he is set up, a screen opened again from his profile changes what it shows and nothing else
  const finished = scope.onboarding === "done";
  const next = answer.step === "done" || finished ? null : nextStep(answer.step);
  if (!finished) settings.onboarding_step = next ?? "done";
  let row = await store.updateScope(scope.id, {
    settings,
    ...(answer.step === "done" ? { onboarding: "done" as const } : {}),
  });
  if (answer.step === "done" && !finished) {
    publish(scope.id, "account.changed", "He finished setting up his account.", { onboarding: "done" });
  }
  row = row ?? scope;
  // what he said himself about his clinic or his day is also a fact, with him as its source
  if (!helper && (settings.clinic !== undefined || settings.routine !== undefined)) facts.push(...(await syncSettingFacts(store, row)));
  return { scope: row, next, href: next ? `/onboard/${next}` : finished && answer.step !== "done" ? "/p/profile" : "/p/today", facts };
}

/** What the weekly-habits screen leaves alone: breakfast and the daily habits (a morning walk). */
export const keptByHabits = (r: ScopeRoutineEntry): boolean => isBreakfast(r) || !Array.isArray(r.days);

/** Where /onboard sends him: the screen he is on, or Today once he is done. */
export function onboardHref(scope: Pick<SessionRow, "onboarding" | "settings">): string {
  return scope.onboarding === "done" ? "/p/today" : `/onboard/${currentStep(scope)}`;
}
