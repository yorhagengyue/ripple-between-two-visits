/**
 * POST /api/family/links/[id]/revoke — he stops sharing with a family member (C2 track D; real-app 2.22; the elder brief
 * 16-20 item 5: 「一下就停，她马上看不到；之后可以重新邀请」). At once and for good: the link is revoked, his consent is
 * withdrawn, care_link.revoked goes on his channel and her open stream ends with it; her next request is 403
 * link_not_active. No undo: he invites her again (decision noted in web/progress/d.md).
 *   body (optional) { assisted? }: someone is helping him on his device right now (the withdrawn record keeps it).
 *   200 { ok: true }; 404 link_not_found; 409 link_closed.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { careLocale, failureResponse, himOf, notFound, routeId } from "@/lib/care/http";
import { revokeLinkAs } from "@/lib/care/links";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ assisted: z.boolean().optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  // the body is optional (the button sends none): anything that is not this shape counts as no body
  const sent = body.safeParse(await req.json().catch(() => ({})));
  try {
    const r = await revokeLinkAs(found.store, found.session, him.userId, await routeId(ctx), careLocale(req), { texts: careEntryStore(), assisted: sent.success ? sent.data.assisted : undefined });
    return r.ok ? NextResponse.json({ ok: true }) : failureResponse(r);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
