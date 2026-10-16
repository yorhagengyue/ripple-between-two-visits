/**
 * /api/profile — his profile (M11; journey 01; real-app 2.5, 2.23). Track C.
 *
 * GET   -> { profile } his clinic, breakfast and the morning reminder it sets, his weekly habits, when each part of the
 *          day is reminded, the facts he recorded (with who wrote each) and what a family member wrote that waits for
 *          him. No scope id, real dates only.
 * PATCH { clinic?: string | null, breakfast?: "HH:MM", habits?: [{ label, label_zh?, days, time }],
 *         reminder_time?: "HH:MM" | null,
 *         reminder_times?: { morning?, midday?, evening?, night?: "HH:MM" | null },
 *         name?: string, locale?: "zh-Hans" | "en" } -> { profile, name? }: his own settings (an account's; a demo
 *         session 404s).
 *         habits replaces his weekly habits (breakfast and daily habits are kept); clinic null clears it. His clinic and
 *         each routine entry are also written as a fact row with him as the source (lib/profile/facts.ts).
 *         reminder_times: the first reminder of a part of the day (null: back to what his routine or the app says); each
 *         time must lie in its part of the day (400 time_out_of_range). reminder_time is the morning's, as before.
 *         A new breakfast time moves the morning reminder with it unless the same request sets the morning time.
 *         name: 称呼 (his account's name and his profile's name fact). locale: 语言 (his account, his space, and this
 *         browser's rp_lang cookie).
 * His only (a family subject and her demo phone get 403 patient_only).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { cleanFactText, cleanRoutineEntry, cleanTime, isBreakfast, syncSettingFacts } from "@/lib/profile/facts";
import { accountSelf, hisSubject, inputErrorResponse } from "@/lib/profile/http";
import { hisName, saveHisLanguage, saveHisName } from "@/lib/profile/identity";
import { keptByHabits } from "@/lib/profile/onboarding";
import { reminderTimesPatch } from "@/lib/profile/reminder-times";
import { profileView } from "@/lib/profile/view";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { scopeRoutine } from "@/lib/store/scope";
import type { ScopeSettings } from "@/lib/store/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const habit = z
  .object({
    label: z.string().max(400),
    label_zh: z.string().max(400).nullable().optional(),
    days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).min(1).max(7),
    time: z.string().max(5),
  })
  .strict();

const slotTime = z.string().max(5).nullable().optional();

const patchBody = z
  .object({
    clinic: z.string().max(400).nullable().optional(),
    breakfast: z.string().max(5).optional(),
    habits: z.array(habit).max(12).optional(),
    reminder_time: z.string().max(5).nullable().optional(),
    reminder_times: z.object({ morning: slotTime, midday: slotTime, evening: slotTime, night: slotTime }).strict().optional(),
    name: z.string().max(200).optional(),
    locale: z.enum(["zh-Hans", "en"]).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json({ profile: await profileView(found.store, found.session) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const found = await accountSelf(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.res;
  try {
    const b = body.data;
    const scope = found.session;
    const settings: ScopeSettings = {};
    if (b.clinic !== undefined) settings.clinic = b.clinic === null || !b.clinic.trim() ? null : cleanFactText(b.clinic);
    let routine = scopeRoutine(scope);
    if (b.breakfast !== undefined) {
      const entry = { label: "Breakfast", label_zh: "早饭", days: "daily" as const, time: cleanTime(b.breakfast) };
      routine = [...routine.filter((r) => !isBreakfast(r)), entry];
      settings.routine = routine;
      // the morning reminder follows breakfast again, unless this request says otherwise below
      settings.reminder_time = null;
    }
    if (b.habits !== undefined) {
      const entries = b.habits.map((h) => cleanRoutineEntry(h));
      routine = [...routine.filter(keptByHabits), ...entries.filter((e) => !isBreakfast(e))];
      settings.routine = routine;
    }
    // every time is validated before anything is written
    Object.assign(settings, reminderTimesPatch(scope, { ...(b.reminder_times ?? {}), ...(b.reminder_time !== undefined ? { morning: b.reminder_time } : {}) }));
    const name = b.name !== undefined ? await saveHisName(found.store, scope, b.name) : undefined;
    let row = Object.keys(settings).length ? await found.store.updateScope(scope.id, { settings }) : scope;
    // his clinic and his routine are facts too, with him as their source
    if (settings.clinic !== undefined || settings.routine !== undefined) await syncSettingFacts(found.store, row);
    if (b.locale !== undefined) row = await saveHisLanguage(found.store, row, b.locale);
    const res = NextResponse.json({ profile: await profileView(found.store, row), ...(name !== undefined ? { name: await hisName(found.store, row) } : {}) });
    if (b.locale !== undefined) res.cookies.set(LOCALE_COOKIE, b.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  } catch (err) {
    return inputErrorResponse(err);
  }
}
