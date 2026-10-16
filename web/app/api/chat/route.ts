/**
 * GET /api/chat[?date=YYYY-MM-DD | ?day=<story day>] — one day of his conversation with Ripple (journey 04; lib/chat/view.ts chatDay):
 * the turns oldest first (his words, Ripple's answer as it was shown, a can't-help turn and his 要 / 不用, the doctor's
 * line under a note about the same symptom) and the other days he talked. Default: today.
 *
 * 200 ChatDayView | 400 no session / bad day | 401 not signed in | 403 patient_only (her phone: his conversation is his) | 404
 * Nothing in the answer names the scope.
 */
import { NextResponse, type NextRequest } from "next/server";
import { chatDay } from "@/lib/chat/view";
import { hisSubject, requestLocale } from "@/lib/profile/http";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { scopeD0 } from "@/lib/store/scope";
import { dayOfDate } from "@/lib/story/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const today = found.session.story_day;
  const date = req.nextUrl.searchParams.get("date");
  const raw = req.nextUrl.searchParams.get("day");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayOfDate(scopeD0(found.session), date) : raw === null || raw.trim() === "" ? today : Number(raw);
  if (!Number.isInteger(day) || day < -400 || day > today) return jsonError(400, "bad_day");
  try {
    return NextResponse.json(await chatDay(found.store, found.session, day, requestLocale(req)));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
