/**
 * POST /api/visits/[id]/scripted — switch the scripted fallback for a visit (web-app.md section 8; real-app 5.2).
 *
 * Body: { on: boolean, key?: string }. 200 { fallback: { allowed: true, on, unlockable: false } }.
 * The crew's only, through the one gate (lib/crew/gate.ts): the rp_crew cookie, the x-ripple-crew-key header, or the crew
 * key in `key`. Anyone else gets 404 not_found, as if the route did not exist: no credential, a stale cookie and a typed
 * key that is wrong are the same answer (a wrong typed key is counted; the place that says "wrong key" is the sign-in
 * door, POST /api/session/crew, which the visit page's key field uses). A typed key that is right also leaves the
 * crew's cookie on this browser, as the door does. With the crew:
 *   - a filming scope (the crew's filming session in filming mode; lib/visit/fallback.ts filmingSession): the switch is
 *     set. Nothing is unlocked per session any more: the crew and a filming scope are the whole rule;
 *   - a judge's sandbox, or filming mode off: 403 fallback_filming_only (whatever the key);
 *   - an account: 404, unless it is a filming account (C2 track J: his own sign-in on the phone, the crew's credential
 *     above, and the filming mark all required); the fallback then aligns to the scene's script (scriptFor).
 * The key is never echoed, logged or published.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewGate, crewNotFound } from "@/lib/crew/gate";
import { CREW_HEADER, crewKeyAccepted } from "@/lib/session/crew-key";
import { setCrewCookie } from "@/lib/session/crew-http";
import { parseBody } from "@/lib/session/http";
import { filmingSession } from "@/lib/visit/fallback";
import { visitErrorResponse } from "@/lib/visit/http";
import { setScriptedFallback } from "@/lib/visit/pipeline";
import { scriptedBody } from "@/lib/visit/schemas";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const body = await parseBody(req, scriptedBody);
  const gate = await crewGate(req, body.ok ? body.data.key : null);
  if (gate) return gate;
  if (!body.ok) return body.res;
  // the scripted fallback is for the crew's filming session (H2), and (C2 track J) for an account its owner marked as a
  // filming account, on his own signed-in phone: every other account gets 404, crew or not
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (found.subject.kind === "account" && !(found.subject.relation === "self" && filmingSession(found.session))) return crewNotFound();
  const { id } = await ctx.params;
  try {
    const on = await setScriptedFallback(found.store, found.session, decodeURIComponent(id), body.data.on);
    const res = NextResponse.json({ fallback: { allowed: true, on, unlockable: false } });
    const typed = [body.data.key ?? null, req.headers.get(CREW_HEADER)].find((k) => crewKeyAccepted(k));
    if (typed) setCrewCookie(res, typed);
    return res;
  } catch (err) {
    return visitErrorResponse(err);
  }
}
