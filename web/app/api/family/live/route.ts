/**
 * GET /api/family/live?link=<her care link>&visit=<id> — his visit as it is recorded, on her phone (scene 1 of the
 * owner's video, 2026-10-15; lib/care/live-visit.ts herLiveVisit). Her live view (components/family/HerVisitLive.tsx)
 * asks it when her stream says a recording started or ended, and when its connection comes back: the visit's state and
 * when the recording started; while he shares his visit records, the lines heard so far with who said each (Ripple's
 * guess) and Ripple's summary. Everything else arrives on her stream (lib/family/events.ts).
 *
 * Her real account only (404 for anyone else, and for his own account); her switches come from her store (cut while her
 * link waits for the family text in force). A read that shows his visit's words is logged as a look at his visit records
 * (lib/care/access-log.ts, at most one row per ten minutes for the same thing). No store, no cache.
 */
import { NextResponse, type NextRequest } from "next/server";
import { logLook } from "@/lib/care/access-log";
import { herLiveVisit } from "@/lib/care/live-visit";
import { NO_GRANTS } from "@/lib/family/types";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const link = found.subject.link;
  if (found.subject.kind !== "account" || found.subject.relation !== "family" || !link || !found.subject.userId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const visitId = req.nextUrl.searchParams.get("visit") ?? "";
  if (!VISIT_ID.test(visitId)) return NextResponse.json({ error: "invalid_query", detail: "visit is required" }, { status: 400 });
  try {
    const now = nowMs();
    const grant = await found.store.getFamilyGrant(found.session.id, link.id);
    const live = await herLiveVisit(found.store, found.session, visitId, { ...NO_GRANTS, ...(grant?.items ?? {}) }, now);
    if (live.shared && live.state !== "missing") {
      await logLook(found.store, found.session.id, { linkId: link.id, userId: found.subject.userId, label: link.family_label, route: "/f/shared/visit/live", items: ["visit_transcripts"] }, now);
    }
    return NextResponse.json(live, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
