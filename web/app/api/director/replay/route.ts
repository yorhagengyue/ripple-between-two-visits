/**
 * POST /api/director/replay — the director's "Start replay" and "Stop replay" (real-status: there was no one-tap replay,
 * and nothing could stop one).
 *   { action: "start" }  the sample visit of the story day (Day 0: v1, Day 8: v2, Day 42: v3; lib/crew/director.ts)
 *                        plays on the phones: every patient phone of the session opens /p/visit?replay=<visit>, whose
 *                        own visit screen starts the replay exactly as a judge's tap would (a replay still running is
 *                        stopped first). 200 { visit, path }. 409 no_visit_today, with a plain sentence, on a day without
 *                        a sample visit.
 *   { action: "stop" }   every replay of the session still pushing sentences stops before its next one.
 *                        200 { stopped: [visit ids] } (empty when none was running).
 * The crew's only (lib/crew/gate.ts): without the crew's cookie or key 404 not_found; an account 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { replayableToday, showOnPhones, stopReplays } from "@/lib/crew/director";
import { crewGate } from "@/lib/crew/gate";
import { replayPage } from "@/lib/crew/story";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const replayBody = z.object({ action: z.enum(["start", "stop"]) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, replayBody);
  if (!body.ok) return body.res;
  try {
    if (body.data.action === "stop") {
      return NextResponse.json({ stopped: await stopReplays(found.store, found.session, "director") });
    }
    const visit = await replayableToday(found.store, found.session);
    if (!visit) {
      return jsonError(409, "no_visit_today", "There is no visit to replay on this day. The visits are on Day 0, Day 8 and Day 42.");
    }
    await stopReplays(found.store, found.session, "director");
    const path = replayPage(visit.id);
    showOnPhones(found.session.id, path, "replay");
    return NextResponse.json({ visit: visit.id, path });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
