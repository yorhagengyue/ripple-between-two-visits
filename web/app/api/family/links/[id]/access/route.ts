/**
 * GET /api/family/links/[id]/access — when she looked, for him (C2 track D; real-app 2.21 「他在 /p/family 看得到」):
 *   { entries: CareAccessEntry[] }  newest first, what she looked at (his switch names), never what was in it.
 * His own account only; 404 for any other link.
 */
import { NextResponse, type NextRequest } from "next/server";
import { careAccessEntries } from "@/lib/care/access-log";
import { himOf, notFound, routeId } from "@/lib/care/http";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  try {
    const id = await routeId(ctx);
    const link = await found.store.getCareLink(id).catch(() => null);
    if (!link || link.patient_id !== him.userId) return NextResponse.json({ error: "link_not_found" }, { status: 404 });
    return NextResponse.json({ entries: await careAccessEntries(found.store, found.session, { linkId: id, limit: 50 }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
