/**
 * POST /api/visits — start a visit after the consent step (or a sample replay).
 *
 * Body: { mode: "record" | "replay", fixture?: "v1" | "v2" | "v3" | "p1", consent?: { given, at?, statement? }, place? }
 *   - record (demo): the visit on the session's story day (a seeded visit when there is one, else a new row);
 *     the consent statement and its story moment are kept as a consent item.
 *   - record (an account, C2): a new visit row with a full uuid, or today's planned follow-up (planned, no sample audio);
 *     place "pharmacy" makes it a pharmacy visit. The doctor's yes is a consent_record (visit_recording, granted, the
 *     card's version and hash, the server's wall clock); the browser's `at` is not used.
 *   - record with consent.given false: nothing starts. An account keeps the doctor's "no" (consent_record declined);
 *     200 { declined: true }.
 *   - record on an account with no consent in the request: 400 consent_required (no recording without the doctor's
 *     answer to the card). consent.assisted says someone is helping him on his device right now (the record keeps it;
 *     absent: what sign-up recorded).
 *   - replay: the sample visit itself (its seeded row), so R1-R4 link to their seeded items; a visit he already
 *     confirmed here is played into a copy (his labels stay).
 * Status becomes "recording". Publishes visit.changed. 200 { visit, view }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { denyFamily } from "@/lib/family/role";
import { parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { declineRecording, startVisit } from "@/lib/visit/pipeline";
import { startVisitBody } from "@/lib/visit/schemas";
import { buildVisitView } from "@/lib/visit/view";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, startVisitBody);
  if (!body.ok) return body.res;
  try {
    if (body.data.mode === "record" && body.data.consent && !body.data.consent.given) {
      const denied = await denyFamily(req, found.session);
      if (denied) return denied;
      await declineRecording(found.store, found.session, { place: body.data.place, assisted: body.data.consent.assisted });
      return NextResponse.json({ declined: true });
    }
    const visit = await startVisit(found.store, found.session, body.data);
    const view = await buildVisitView(found.store, found.session.id, visit.id, { session: found.session });
    return NextResponse.json({ visit, view });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
