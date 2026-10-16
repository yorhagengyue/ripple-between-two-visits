/**
 * POST /api/director/filming — { on: boolean, crew_key? }. Filming mode: phones hide the jump menu and debug
 * line and use larger text. Publishes session.filming_mode with the session row.
 *
 * The crew's only, both ways (lib/crew/gate.ts; real-app 5.2 closed the open "off"): the rp_crew cookie, the
 * x-ripple-crew-key header or the body's crew_key; for anyone else 404 not_found (no key, a stale
 * cookie and a wrong typed key alike: lib/crew/gate.ts). An account 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewGate } from "@/lib/crew/gate";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { setFilming } from "@/lib/session/ops";
import { filmingBody } from "@/lib/session/schemas";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await parseBody(req, filmingBody);
  const gate = await crewGate(req, body.ok ? body.data.crew_key : null);
  if (gate) return gate;
  if (!body.ok) return body.res;
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json({ session: await setFilming(found.store, found.session, body.data.on) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
