/**
 * POST /api/visits/[id]/verdict — one answer of the after-visit review, saved as he taps (C2: one line at a time), or an
 * edit after he confirmed the visit (kept in the item's history).
 *
 * Body: { items: [item ids of one line], verdict: "right" | "wrong" | "unsure", locale? }
 *   right   「是，医生说的」: the items are his doctor's; the line becomes 医生说 (or the counter's, the pharmacist's)
 *   wrong   「不是」: flagged and kept, a question for the doctor; a warning line or a 995 line stays on the emergency path
 *   unsure  「不记得」: nothing changes
 * 200 { view }. 400 invalid (unknown item, a visit still recording); 404 visit_not_found. Wei Ling cannot answer for
 * him: 403 patient_only (the demo's family role; her account never reaches his visits through this route).
 */
import { NextResponse, type NextRequest } from "next/server";
import { denyFamily } from "@/lib/family/role";
import { parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { setItemVerdict } from "@/lib/visit/pipeline";
import { verdictBody } from "@/lib/visit/schemas";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, verdictBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  try {
    const view = await setItemVerdict(found.store, found.session, decodeURIComponent(id), body.data);
    return NextResponse.json({ view });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
