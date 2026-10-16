/**
 * POST /api/family/links/[id]/leave — she stops looking at his Ripple (C2 track D; real-app 2.22 「她『不再看爸爸的记录』：
 * 效果一样」, 3.10 「她自己的动作：接受邀请、POST /api/family/links/[id]/leave」; the daughter brief G, H2). Her own action
 * on her own link: the route does not take ?link= and never enters his space. The link is revoked by her, her
 * family_accept consent is withdrawn, care_link.left goes on his channel and her open stream ends with it.
 *   200 { ok: true }; 401 not_signed_in; 404 link_not_found (not her link); 409 link_closed (already ended).
 */
import { NextResponse, type NextRequest } from "next/server";
import { careLocale, failureResponse, routeId } from "@/lib/care/http";
import { leaveLinkAs } from "@/lib/care/links";
import { storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  try {
    const r = await leaveLinkAs(careEntryStore(), found.store, found.user.userId, await routeId(ctx), careLocale(req));
    return r.ok ? NextResponse.json({ ok: true }) : failureResponse(r);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
