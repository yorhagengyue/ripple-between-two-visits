/**
 * GET /api/family/shared?link=<her care link> — what he shares beyond the counts (C2 track D; the daughter brief F):
 *   { items, visits?: SharedVisit[], notes?: SharedNote[] }
 *   items    his six switches for her link (the read-only list 「爸爸让你看到的」)
 *   visits   only while 「看诊录音和逐字稿」 is on: each visit's clinician lines he confirmed (lib/care/shared.ts)
 *   notes    only while 「他自己写的笔记」 is on
 * A switch that is off leaves its part out altogether. Her read writes nothing of his but her access-log row.
 */
import { NextResponse, type NextRequest } from "next/server";
import { logLook } from "@/lib/care/access-log";
import { herOf, notFound } from "@/lib/care/http";
import { sharedNotes, sharedVisits } from "@/lib/care/shared";
import { readGrants } from "@/lib/family/grants";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const her = herOf(found.subject);
  if (!her) return notFound();
  try {
    const { items } = await readGrants(found.store, found.session, her.linkId);
    const [visits, notes] = await Promise.all([
      items.visit_transcripts ? sharedVisits(found.store, found.session, her.linkId) : Promise.resolve(undefined),
      items.notes ? sharedNotes(found.store, found.session) : Promise.resolve(undefined),
    ]);
    const shown = [...(visits ? ["visit_transcripts"] : []), ...(notes ? ["notes"] : [])];
    if (shown.length) await logLook(found.store, found.session.id, { linkId: her.linkId, userId: her.userId, label: her.label, route: "/f/shared", items: shown }, nowMs());
    return NextResponse.json({ items, ...(visits ? { visits } : {}), ...(notes ? { notes } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
