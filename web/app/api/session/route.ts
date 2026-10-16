/**
 * POST /api/session — new session seeded from the template timeline (spec section 2).
 *   body (all optional): { kind: "sandbox" | "filming", story_day, story_time, filming_mode, role, device_label, crew_key }
 *   sandbox (default) = a judge's own copy, expires after 48 h; filming = no expiry, for the shoot.
 *   A filming session, or any session created with filming_mode true, is the crew's (lib/crew/gate.ts: the rp_crew
 *   cookie, the x-ripple-crew-key header or the body's crew_key): without any of them 404 not_found, as if the
 *   route did not take that kind; a wrong typed key is the same 404 (lib/crew/gate.ts, one gate). A keyed
 *   creation also leaves the rp_crew cookie on this browser, so its Director page works.
 *   Sets cookies rp_session, rp_member, rp_role: the creating device's own row (a judge's sandbox, the director's
 *   filming session), so its later requests are a member's. Returns { session, member }.
 * GET /api/session — the current session (?session= or cookie) and its members, each as { role, device_label,
 *   created_at } (lib/session/members.ts memberView, the same shape the session.member_joined event carries): never
 *   the row id, which is that device's rp_member credential (with it a device could act as that
 *   phone). A request with no device cookie at all ("anonymous": a private window, curl with only ?session=) gets
 *   { session } alone. Wei Ling's phone 403 patient_only, a device denied outright 403 (lib/family/role.ts
 *   sessionCaller; the proxy gate answers first).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sessionCaller } from "@/lib/family/role";
import { crewGate } from "@/lib/crew/gate";
import { CREW_HEADER, crewKeyAccepted } from "@/lib/session/crew-key";
import { setCrewCookie } from "@/lib/session/crew-http";
import { parseBody, setSessionCookies, storeErrorResponse } from "@/lib/session/http";
import { memberView } from "@/lib/session/members";
import { createSessionWithMember } from "@/lib/session/ops";
import { createSessionBody } from "@/lib/session/schemas";
import { demoEntryStore, requireDemoSubject } from "@/lib/subject";
import { limitByIp } from "@/lib/subject/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await parseBody(req, createSessionBody);
  if (!body.ok) return body.res;
  const needsCrew = body.data.kind === "filming" || body.data.filming_mode === true;
  let crewKey: string | null = null;
  if (needsCrew) {
    const gate = await crewGate(req, body.data.crew_key);
    if (gate) return gate;
    // a typed key (body or header) is also left as this browser's crew cookie; a cookie that is there already stays
    crewKey = [body.data.crew_key ?? null, req.headers.get(CREW_HEADER)].find((k) => crewKeyAccepted(k)) ?? null;
  } else {
    // C2 track L: a demo sandbox, 10 an hour per address (real-app 3.5; lib/guard/limits.ts)
    const over = await limitByIp(req, "demoSandbox");
    if (over) return over;
  }
  try {
    const { session, member } = await createSessionWithMember(demoEntryStore(), body.data);
    const res = NextResponse.json({ session, member }, { status: 201 });
    setSessionCookies(res, session, member);
    if (crewKey) setCrewCookie(res, crewKey);
    return res;
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  // the session row and its members are the demo's (H5): an account reads its own through GET /api/me
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const who = await sessionCaller(req, found.session);
  if (who instanceof NextResponse) return who;
  if (who.kind === "anonymous") return NextResponse.json({ session: found.session });
  try {
    const members = (await found.store.listMembers(found.session.id)).map(memberView);
    return NextResponse.json({ session: found.session, members });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
