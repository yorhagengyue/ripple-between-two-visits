/**
 * POST /api/session/reset — restore the session to the template timeline (timeline.seed.json).
 * Keeps the session id, join code, members and filming mode; the story clock goes back to the evening of Day 29, 8:15pm
 * (lib/crew/story.ts RESET_DAY, RESET_TIME; real-status: the clock had no time after a reset). A visit replay still running
 * is stopped first (real-status: one more sentence leaked in after a reset). Clears the event history, then publishes
 * session.reset so every page reloads its data, and clock.changed with the time.
 * The crew's only (lib/crew/gate.ts; "重置我的沙盒" is one of the story-clock buttons): without the crew's cookie or key
 * 404 not_found; an account has no reset either (404). It wipes what was recorded in the session, so Wei Ling's phone
 * gets 403 patient_only and a device denied outright 403 here as well as at the proxy gate (lib/family/role.ts
 * sessionCaller); 503 role_unavailable when the member rows cannot be read.
 */
import { NextResponse, type NextRequest } from "next/server";
import { stopReplays } from "@/lib/crew/director";
import { crewGate } from "@/lib/crew/gate";
import { sessionCaller } from "@/lib/family/role";
import { storeErrorResponse } from "@/lib/session/http";
import { RESET_DAY, RESET_TIME } from "@/lib/crew/story";
import { moveClock, resetSession } from "@/lib/session/ops";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  // an account has no reset (its space is his): 404
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const who = await sessionCaller(req, found.session);
  if (who instanceof NextResponse) return who;
  try {
    await stopReplays(found.store, found.session, "reset");
    const reset = await resetSession(found.store, found.session.id);
    const { session } = await moveClock(found.store, reset, { day: RESET_DAY, time: RESET_TIME });
    return NextResponse.json({ session });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
