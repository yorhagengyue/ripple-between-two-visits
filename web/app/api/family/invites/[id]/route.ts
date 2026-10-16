/**
 * DELETE /api/family/invites/[id] — he takes back an invitation nobody has accepted yet (C2 track D; real-app 3.10).
 *   200 { ok: true }; 404 link_not_found; 409 link_closed (already accepted, confirmed or ended: he stops sharing instead).
 */
import { NextResponse, type NextRequest } from "next/server";
import { failureResponse, himOf, notFound, routeId } from "@/lib/care/http";
import { cancelInvite } from "@/lib/care/links";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  try {
    const r = await cancelInvite(found.store, found.session, him.userId, await routeId(ctx));
    return r.ok ? NextResponse.json({ ok: true }) : failureResponse(r);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
