/**
 * POST /api/family/invites — he invites a family member (C2 track D; real-app 2.19, 3.10 step 1).
 *   body { family_label: "Wei Ling", relation?: "daughter", patient_label?: "爸爸" }
 *   201 { link: PatientLinkView, path: "/invite/<token>" }: the one-time link (7 days), every switch off. The token is
 *       in `path` this once and never again (only its sha256 is stored).
 * His own account only: a family member's link, the demo and a signed-out request get 404 / 401.
 * 400 label_missing, 429 too_many_invites (five open invitations at most).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { failureResponse, himOf, notFound } from "@/lib/care/http";
import { createInviteFor } from "@/lib/care/links";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    family_label: z.string().trim().min(1).max(80),
    relation: z.string().trim().max(40).optional(),
    patient_label: z.string().trim().max(40).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const him = himOf(found.subject);
  if (!him) return notFound();
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const made = await createInviteFor(found.store, found.session, him.userId, { familyLabel: b.data.family_label, relation: b.data.relation, patientLabel: b.data.patient_label }, nowMs());
    if ("ok" in made) return failureResponse(made);
    return NextResponse.json({ link: made.link, path: made.path }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
