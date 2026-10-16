/**
 * POST /api/meds/[id]/answer — the patient points at the line in a later visit recording that answers the
 * question this medicine raised (the pharmacist's answer at D12 to the unknown-medicine question).
 * Body: { visit_id, utterance_id, speaker? }. The question keeps the line word for word, with its utterance id.
 * speaker is who said it, as he names it (pharmacist at a pharmacy visit; doctor or dispenser at a clinic visit);
 * null when he is not sure; omitted keeps the speaker the question already records for this same line. A role
 * confirmed in his post-visit review wins; nothing is inferred.
 * 200 { question, med } | 400 speaker_not_at_visit | 404 med_not_found / no_question / visit_not_found /
 * utterance_not_found | 409 visit_not_yet (the visit is later than the story day) / visit_not_for_question (not a
 * visit where the question's addressee works, or before the question) / not_an_answer (his or his family's line).
 * 403 patient_only from Wei Ling (family role): she cannot answer a question for him (lib/family/role.ts, M6).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { linkAnswer } from "@/lib/meds/answers";
import { medsErrorResponse } from "@/lib/meds/http";
import { denyFamily } from "@/lib/family/role";
import { parseBody } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(100);
const body = z.object({ visit_id: id, utterance_id: id, speaker: z.enum(["doctor", "dispenser", "pharmacist"]).nullable().optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const { id: medId } = await ctx.params;
  try {
    const out = await linkAnswer({
      sessionId: found.session.id,
      medId: decodeURIComponent(medId),
      visitId: parsed.data.visit_id,
      utteranceId: parsed.data.utterance_id,
      speaker: parsed.data.speaker,
    }, { store: found.store });
    return NextResponse.json(out);
  } catch (err) {
    return medsErrorResponse(err, "api/meds/[id]/answer");
  }
}
