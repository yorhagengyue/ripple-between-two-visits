/**
 * GET /api/family/links — the signed-in person's family links (C2 track D; real-app 2.19-2.21).
 *   { patient: PatientLinkView[], family: FamilyLinkView[] }
 *   patient   his links, when he has a space of his own: who, the state (invited / accepted / active / ended), her
 *             name and login once she accepted (his confirm card), the switches and their version
 *   family    her links, her side only (the state; his word for himself)
 * Her waiting page polls this until he confirms; his page re-reads it on care_link events. Never a token or its hash.
 */
import { NextResponse, type NextRequest } from "next/server";
import { familyLinks, patientLinks } from "@/lib/care/links";
import { storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  try {
    const now = nowMs();
    const userId = found.user.userId;
    const [patient, family] = await Promise.all([
      found.scope ? patientLinks(found.store, careEntryStore(), found.scope, userId, now) : Promise.resolve([]),
      familyLinks(found.store, userId, now),
    ]);
    return NextResponse.json({ patient, family }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
