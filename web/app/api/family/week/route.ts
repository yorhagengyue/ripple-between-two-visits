/**
 * GET /api/family/week?link=<her care link>&offset=0|-1|-2|-3 — one week of his medicine, day by day (C2 track D; the
 * daughter brief C: 「这一周」 and the week before). Each day: its mark (taken / missed / no reply / not yet / nothing to
 * log) and each medicine by name with when he tapped it; never a reason. Only while his dose_summary switch for her
 * link is on (403 not_shared otherwise). Her read writes nothing of his but her access-log row.
 */
import { NextResponse, type NextRequest } from "next/server";
import { logLook } from "@/lib/care/access-log";
import { herOf, notFound } from "@/lib/care/http";
import { familyWeek } from "@/lib/care/home";
import { readGrants } from "@/lib/family/grants";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const her = herOf(found.subject);
  if (!her) return notFound();
  try {
    const grants = await readGrants(found.store, found.session, her.linkId);
    if (!grants.items.dose_summary) return jsonError(403, "not_shared");
    const now = nowMs();
    const week = await familyWeek(found.store, found.session, now, Number(req.nextUrl.searchParams.get("offset") ?? 0));
    await logLook(found.store, found.session.id, { linkId: her.linkId, userId: her.userId, label: her.label, route: "/f/week", items: ["dose_summary"] }, now);
    return NextResponse.json(week, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
