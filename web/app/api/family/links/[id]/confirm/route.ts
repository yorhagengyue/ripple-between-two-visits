/**
 * POST /api/family/links/[id]/confirm — he says whether the person who accepted is her (C2 track D; real-app 2.20, 3.10
 * step 3). Until he says yes she sees nothing: the invitation passed through a chat app and whoever opened it first
 * could accept it.
 *   body { yes: boolean, assisted? }   assisted: someone is helping him on his device right now (the record keeps it and
 *       the note; absent: what his sign-up recorded)
 *   200 { link: PatientLinkView }: yes, active (every switch still off; his family_share consent record, version 1,
 *       written through lib/privacy/consents.ts); no, declined (the invitation is void).
 *   404 link_not_found, 409 link_not_accepted.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { careLocale, failureResponse, himOf, notFound, routeId } from "@/lib/care/http";
import { confirmLinkAs, patientLinks } from "@/lib/care/links";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ yes: z.boolean(), assisted: z.boolean().optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const id = await routeId(ctx);
    const r = await confirmLinkAs(found.store, found.session, him.userId, id, b.data.yes, careLocale(req), { texts: careEntryStore(), assisted: b.data.assisted });
    if (!r.ok) return failureResponse(r);
    const link = (await patientLinks(found.store, careEntryStore(), found.session, him.userId, nowMs())).find((l) => l.id === id);
    return NextResponse.json({ link });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
