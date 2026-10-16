/**
 * POST /api/session/join — join a session with its join code and pick a role.
 *   body: { code, role: "patient" | "family" | "backstage" | "director" | "judge", device_label? }
 *   404 { error: "join_code_not_found" } when no live session has the code.
 *   Who may become which role is lib/family/join.ts (M6 privacy): family with the code alone; patient only while the
 *   session has no patient device yet (403 patient_exists); director and backstage only with the film crew's key
 *   (the rp_crew cookie or the x-ripple-crew-key header, lib/crew/gate.ts; anyone else, a wrong typed key included: 403
 *   crew_key_required. crew_key_wrong and crew_key_attempts are the sign-in door's answers, POST /api/session/crew);
 *   judge never (403 role_not_joinable); a device that is already Wei Ling's only as family (403 patient_only). Member
 *   rows that cannot be read: 503 role_unavailable.
 *   Sets cookies rp_session, rp_member, rp_role and returns { session, member, next } where `next`
 *   is the role's home page (/p/today, /f, /backstage, /director); `member` is this device's own row, id included.
 *   Publishes session.member_joined for a new row, carrying only its role, label and joining time (never the id, the
 *   new device's credential: lib/session/members.ts); the same device joining again as what it already is gets its
 *   own row back (no new row, no event).
 * C2 (lib/crew/gate.ts): a join that carried the crew key itself (header x-ripple-crew-key) also leaves the crew's cookie
 * on this device (a sha256 of the key, as /backstage/crew does), so the backstage or director screen it lands on opens.
 */
import { NextResponse, type NextRequest } from "next/server";
import { joinWithCode } from "@/lib/family/join";
import { roleUnavailable } from "@/lib/family/role";
import { jsonError, parseBody, setSessionCookies, storeErrorResponse } from "@/lib/session/http";
import { homeForRole } from "@/lib/session/ops";
import { joinSessionBody } from "@/lib/session/schemas";
import { CREW_HEADER, crewKeyAccepted } from "@/lib/session/crew-key";
import { setCrewCookie } from "@/lib/session/crew-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await parseBody(req, joinSessionBody);
  if (!body.ok) return body.res;
  try {
    const joined = await joinWithCode(req, body.data);
    if (!joined.ok) {
      if (joined.status === 503) return roleUnavailable();
      return jsonError(joined.status, joined.code, "detail" in joined ? joined.detail : undefined);
    }
    const res = NextResponse.json({ session: joined.session, member: joined.member, next: homeForRole(joined.member.role) });
    setSessionCookies(res, joined.session, joined.member);
    const key = req.headers.get(CREW_HEADER);
    if (key && crewKeyAccepted(key)) setCrewCookie(res, key);
    return res;
  } catch (err) {
    return storeErrorResponse(err);
  }
}
