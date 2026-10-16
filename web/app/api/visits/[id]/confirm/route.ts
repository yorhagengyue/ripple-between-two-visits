/**
 * POST /api/visits/[id]/confirm — the after-visit review: which lines were his, and whether each item is
 * right. His lines become role patient (confirmed); lines of items he marked right become their speaker
 * (confirmed); a line the app thought was his but he did not mark becomes unknown. Answers to his
 * questions that he confirmed are written to his question list with the clinician's own words.
 * Status becomes "confirmed".
 *
 * Body: { mine: string[], items: { [itemId]: "right" | "wrong" }, locale? }. 200 { view }.
 * Wei Ling (family role) cannot confirm for him: 403 patient_only (lib/family/role.ts, M6).
 */
import { NextResponse, type NextRequest } from "next/server";
import { parseBody } from "@/lib/session/http";
import { denyFamily } from "@/lib/family/role";
import { visitErrorResponse } from "@/lib/visit/http";
import { confirmVisit } from "@/lib/visit/pipeline";
import { confirmBody } from "@/lib/visit/schemas";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, confirmBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  try {
    const view = await confirmVisit(found.store, found.session, decodeURIComponent(id), body.data);
    return NextResponse.json({ view });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
