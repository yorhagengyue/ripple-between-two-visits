/**
 * GET /api/visits/[id] — the visit screen's data (lines with speaker state, cards, question list, counters).
 * 404 visit_not_found; 409 visit_not_yet when the visit is later than the session's story day (day gating).
 *
 * PATCH /api/visits/[id] — 「我约的日子」 (C2 track F; real-app 2.15): the day of a planned follow-up, changed from the
 * doctor's 「大约 11月20日」 to the day he booked. Body: { date: "YYYY-MM-DD" } (today or later, in his own dates).
 * 200 { visit: { id, date, day, status, approx: false } }. 404 visit_not_found; 409 not_planned (a visit that started, the
 * example's sample visit, the demo); 400 invalid (not a date, a day that has passed). His only: 403 patient_only for
 * Wei Ling's phone in the demo; her account never reaches his visits here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { rescheduleFollowUp } from "@/lib/visit/pipeline";
import { buildVisitView } from "@/lib/visit/view";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const { id } = await ctx.params;
  const view = await buildVisitView(found.store, found.session.id, decodeURIComponent(id), { session: found.session });
  if (!view) return jsonError(404, "visit_not_found");
  if (view.visit.day > found.session.story_day) {
    return jsonError(409, "visit_not_yet", `visit ${view.visit.id} is on day ${view.visit.day}; the story is on day ${found.session.story_day}`);
  }
  return NextResponse.json({ view });
}

const bookedBody = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, bookedBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  try {
    const { visit, approx } = await rescheduleFollowUp(found.store, found.session, decodeURIComponent(id), body.data.date);
    return NextResponse.json({ visit: { id: visit.id, date: visit.date, day: visit.day, status: visit.status, approx } });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
