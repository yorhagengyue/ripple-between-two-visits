/**
 * POST /api/director/cue — director remote cues (spec section 2).
 *   { cue: "reminder", slot? }  every patient page in the session shows the reminder card now
 *                               (today's due medicines + Wei Ling's recorded reminder, her own words).
 *   { cue: "no_reply", slot? }  simulate "no reply": today's unanswered doses are recorded as
 *                               unconfirmed (answered ones are left alone); patient pages close the card.
 *   Publishes director.cue (and dose.logged for each dose it marks). Returns the cue data.
 * The crew's only (lib/crew/gate.ts): without the crew's cookie or key, 404 not_found; an account 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewGate } from "@/lib/crew/gate";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { cueNoReply, cueReminder } from "@/lib/session/ops";
import { cueBody } from "@/lib/session/schemas";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, cueBody);
  if (!body.ok) return body.res;
  try {
    const data =
      body.data.cue === "reminder"
        ? await cueReminder(found.store, found.session, body.data.slot)
        : await cueNoReply(found.store, found.session, body.data.slot);
    return NextResponse.json(data);
  } catch (err) {
    return storeErrorResponse(err);
  }
}
