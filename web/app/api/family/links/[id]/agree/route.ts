/**
 * POST /api/family/links/[id]/agree — one of the two agrees to the family text in force for their own link (the family
 * texts asked again, owner 2026-10-14; lib/care/reconsent.ts has the rule, lib/care/reconsent-agree.ts the writes).
 * Each person's own action on their own link: no ?link=, never his space through her link. Who is asking decides which
 * record is written, from the link row:
 *   he (the link's patient, on his own account)   his family_share granted under the text in force, method
 *                                                 family_confirm, as his confirmation writes it (his card's 「同意」 on
 *                                                 Today and on his family page)
 *   she (the link's family member)                her family_accept granted under the text in force, with the method of
 *                                                 her acceptance (her card's 「同意新的说明」 on her home)
 *   body { assisted? }   his side only: someone is helping him on his device right now (the record keeps it and the
 *                        note; absent: what his sign-up recorded). Hers is never assisted.
 *   200 { ok: true, written }   written false: agreed under the text in force already (a second tap writes nothing)
 *   404 link_not_found (not a party, or no such link), 409 link_not_active (waiting for his 「是她」), 409 link_closed,
 *   401 not_signed_in, 400 invalid_body.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { careLocale, failureResponse, routeId } from "@/lib/care/http";
import { failure } from "@/lib/care/links";
import { agreeAsHer, agreeAsHim } from "@/lib/care/reconsent-agree";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ assisted: z.boolean().optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const id = await routeId(ctx);
    const me = found.user.userId;
    const entry = careEntryStore();
    const link = await entry.getCareLink(id).catch(() => null);
    const r =
      link && link.patient_id === me && found.scope
        ? await agreeAsHim(found.store, found.scope, me, id, careLocale(req), { texts: entry, assisted: b.data.assisted })
        : link && link.family_id === me
          ? await agreeAsHer(entry, found.store, me, id, careLocale(req))
          : failure("link_not_found");
    return r.ok ? NextResponse.json({ ok: true, written: r.written }) : failureResponse(r);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
