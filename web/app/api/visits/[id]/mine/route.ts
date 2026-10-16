/**
 * POST /api/visits/[id]/mine — 「哪几句是我说的」 in the after-visit review (C2 track F, round three; real-app 2.15: 他点出
 * 哪几句是自己说的), one line at a time, saved as he taps, before or after he confirmed the visit.
 *
 * Body: { line: utterance id, mine: boolean }
 *   mine true    a line whose speaker nobody could tell is his own (patient, confirmed)
 *   mine false   a line he had marked is given back (unknown again)
 * 200 { view }. 400 invalid (unknown line, a visit still recording, or a line he already said is the clinician's: that
 * answer is changed first); 404 visit_not_found. Wei Ling cannot answer for him: 403 patient_only (the demo's family
 * role; her account never reaches his visits through this route).
 */
import { NextResponse, type NextRequest } from "next/server";
import { denyFamily } from "@/lib/family/role";
import { parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { setLineMine } from "@/lib/visit/pipeline";
import { mineBody } from "@/lib/visit/schemas";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, mineBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  try {
    const view = await setLineMine(found.store, found.session, decodeURIComponent(id), body.data);
    return NextResponse.json({ view });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
