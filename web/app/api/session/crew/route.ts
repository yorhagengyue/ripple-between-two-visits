/**
 * The crew's sign-in door (lib/session/crew-key.ts crewSignIn; real-app 5.2). Used by /backstage/crew, and by the key
 * field on a filming phone's visit page (/p/visit?crew=1), so the film crew types the key once per browser. It is the
 * only place that answers a typed key in words; every crew-only route answers anyone who is not the crew 404.
 *   POST   { key } -> 200 { crew: true } and the rp_crew cookie (sha256 of the key, httpOnly);
 *          403 crew_key_required (empty) / crew_key_wrong, 429 crew_key_attempts (ten wrong keys from one client in ten
 *          minutes, for ten minutes)
 *   GET    -> { crew: boolean } (does this browser carry a valid crew cookie?)
 *   DELETE -> { crew: false }, cookie cleared
 * The key is never echoed, logged or published.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CREW_COOKIE, crewCookieAccepted, crewSignIn } from "@/lib/session/crew-key";
import { clearCrewCookie, setCrewCookie } from "@/lib/session/crew-http";
import { jsonError, parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const crewBody = z.object({ key: z.string().max(200) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const body = await parseBody(req, crewBody);
  if (!body.ok) return body.res;
  // only the typed key counts here (not a cookie the browser may already carry)
  const crew = await crewSignIn(req.headers, body.data.key);
  if (!crew.ok) return jsonError(crew.status, crew.error);
  const res = NextResponse.json({ crew: true });
  setCrewCookie(res, body.data.key);
  return res;
}

export async function GET(req: NextRequest): Promise<Response> {
  return NextResponse.json({ crew: crewCookieAccepted(req.cookies.get(CREW_COOKIE)?.value) });
}

export async function DELETE(): Promise<Response> {
  const res = NextResponse.json({ crew: false });
  clearCrewCookie(res);
  return res;
}
