/**
 * The film crew's one gate (docs/plan/real-app.md 5.2; C2 track E). Everything that is for the crew only answers as if
 * it did not exist for everyone else: a page renders Next's 404, a route answers 404 { error: "not_found" }. Nobody but
 * the crew ever sees these screens and calls, so a judge, Mr Tan's phone and Wei Ling's phone cannot even tell they are
 * there:
 *   pages   /director, /backstage, /backstage/real, /join (and the jump menu and the debug line on a demo phone)
 *   routes  POST /api/clock, /api/director/*, POST /api/session/reset, POST /api/session for a filming session,
 *           POST /api/visits/[id]/scripted (and the `fallback` flag of /extract), /api/real/*, /api/crew/*, the details
 *           of GET /api/asr/health, and the story-clock buttons on /demo
 * The crew's sign-in page /backstage/crew stays open (no public page links to it).
 *
 * Who is the crew: isCrew(req). A browser that carries the rp_crew cookie of an accepted key (set by the sign-in door,
 * a sha256 of the key, never the key), or a request that carries the key itself (header x-ripple-crew-key; some routes
 * also take a body field). Which keys count, and the one counter of wrong keys, are lib/session/crew-key.ts. Pages look
 * at the cookie only; routes take any of the three.
 *
 * One answer for everyone else: 404. No credential at all, a stale cookie, a typed key that is wrong, a client locked
 * out for too many wrong keys: all the same 404, so a crew-only route never says "there is a key and yours is wrong".
 * The only place that tells a typo from a closed door is the sign-in door itself (POST /api/session/crew: 403
 * crew_key_wrong, 429 crew_key_attempts). This is the one mechanism: the scripted fallback's own per-session unlock and
 * its counter (lib/visit/crew.ts, until the C2 follow-up) are gone; the fallback needs the crew (this gate) and a
 * filming scope (lib/visit/fallback.ts filmingSession), nothing else.
 *
 * The decision is made in each page's own server component (notFound()) and in each route handler, never in proxy.ts
 * (track A's file), so the fence and the identity gate never edit the same file. Server-only.
 */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { CREW_COOKIE, crewCookieAccepted, crewCredential, type CrewRequestLike } from "@/lib/session/crew-key";

export { CREW_COOKIE, CREW_HEADER } from "@/lib/session/crew-key";

/** The answer of every crew-only route to anyone else: the same as a route that does not exist. */
export function crewNotFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * Is this request the crew's? The rp_crew cookie of an accepted key, or the key itself in the x-ripple-crew-key header
 * (or in `bodyKey`, for the routes that take one). The one question every crew-only page and route asks. A typed key
 * that is wrong counts against the client (lib/session/crew-key.ts crewCredential), and is simply "not the crew".
 * The count is rows of the store, so the answer is a promise: every caller awaits it (a promise that is not awaited
 * reads as true).
 */
export async function isCrew(req: CrewRequestLike, bodyKey?: string | null): Promise<boolean> {
  return (await crewCredential(req, bodyKey)) !== null;
}

/**
 * The gate of a crew-only route: null when the request is the crew's (go on), else the response to send, which is
 * always 404 not_found: the same as a route that does not exist, whatever was or was not typed. Awaited by every
 * caller, like isCrew.
 */
export async function crewGate(req: CrewRequestLike, bodyKey?: string | null): Promise<NextResponse | null> {
  return (await isCrew(req, bodyKey)) ? null : crewNotFound();
}

/** Is the browser rendering this page the crew's (the rp_crew cookie of an accepted key)? For server components. */
export async function isCrewPage(): Promise<boolean> {
  const jar = await cookies();
  return crewCookieAccepted(jar.get(CREW_COOKIE)?.value);
}

/** First line of a crew-only page: Next's 404 for anyone but the crew. */
export async function requireCrewPage(): Promise<void> {
  if (!(await isCrewPage())) notFound();
}
