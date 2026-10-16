/**
 * Next.js 16 proxy (formerly middleware), Node.js runtime: runs before every page and API request.
 *
 * In this order:
 *   0. refuse another site's writes (real-app 3.4 跨站): a request that is not GET / HEAD / OPTIONS whose Origin is
 *      another host, or that the browser marks Sec-Fetch-Site: cross-site, is 403 bad_origin before anything else runs
 *      (lib/auth/origin.ts; a request with no Origin passes: the sign-in cookies are SameSite=Lax).
 *   1. keep a signed-in account signed in (lib/auth/refresh.ts): when the access token is near the end of the 15 minutes
 *      the app keeps one (or of its own exp, or its cookie is gone) and a refresh token (rp_rt) is there, trade it for
 *      new tokens; the response sets the new cookies and the request the page or route handler sees already carries
 *      them. A refused refresh, a sign-in past its limit (rp_since: 180 days, 12 hours for 「这不是我的手机」) or a session
 *      the registry has closed clears the sign-in cookies. Requests without rp_rt (the demo, anonymous) are untouched.
 *   2. the deny-by-default gate of lib/family/gate.ts, decided by who the device is (lib/family/identity.ts, its
 *      member row first):
 *   - Wei Ling's phone may open /f and /join and call the few APIs /f needs (FAMILY_API); any other page sends her to
 *     /f, any other API is 403 patient_only, before the page or handler runs; naming a session that is not her own is
 *     403 patient_only everywhere;
 *   - once she has joined, a device with no row in his session (her phone with its cookies dropped or forged) gets
 *     403 member_required from every API but the join, and every page sends it to /join;
 *   - a request with no device cookie at all that names a session nobody joined as family gets 403 member_required
 *     except the few routes that read nothing of his (ANONYMOUS_API);
 *   - a request that names no session reads nothing and passes, and so does his phone, a judge's sandbox and the crew.
 *   A signed-in account's request (a verified token whose session is still open) that names no demo session skips the
 *   gate: the routes resolve the account from its token (lib/subject).
 *   3. send a browser that is not signed in from his and her pages to the login (real-app 2.1, track A): a page request
 *      for /p/*, /onboard, /f or a page under /f with neither a signed-in account nor a demo session (rp_session) is 307
 *      to /login?next=<the page it asked for, query included>, and comes back there after logging in. APIs never
 *      redirect (they answer 401 / 400 as before); the demo's phones, which carry rp_session, are untouched. The
 *      invitation page /invite/<token> is public (real-app 2.20): someone without an account reads it first.
 *   4. when who the request is for cannot be told because the store or the identity provider cannot be read
 *      (real-app 2.25 「存储读不到：照旧拒绝，不放行，503」): 503, a plain JSON body for an API and one plain sentence for
 *      a page (lib/subject/unavailable.ts). Never "signed out", never let through.
 *
 * C2 track L adds two things, each in its own file: right after the origin check, lib/guard/request.ts (a data route's
 * body is JSON or nothing: 415); after the login redirect, lib/subject/landing.ts (a signed-in person's /p page goes to
 * /onboard until he is set up, and to /f when he has no space of his own, also on a tap inside the app, where the
 * layout's own check does not run).
 *
 * Every answer that passes through here carries the response headers of real-app 3.4: Content-Security-Policy
 * frame-ancestors 'self' (the judges' /demo frames are same-origin), Referrer-Policy no-referrer (an invitation link
 * carries a token), Permissions-Policy for the microphone and camera on this site only, X-Content-Type-Options nosniff;
 * and a signed-in account's answers are Cache-Control: private, no-store. A header set here replaces the route's own
 * (measured on the production build), so the few routes with a caching rule of their own are left alone
 * (OWN_CACHE_RULE: the event stream, which must stay no-transform and says private, no-store itself). C2 track L: the
 * three sound clips are no longer left alone: a signed-in person's recordings are private, no-store like the rest.
 *
 * The matcher leaves out what the gate does not look at (lib/family/gate.ts OUTSIDE_GATE): Next.js internals, the
 * favicon, the public worklets, and the two upload routes whose bodies can exceed the 10 MB the proxy buffers.
 * Matcher values must be literal; gate.ts passes the same prefixes again in case this list and that one drift.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAuthProvider } from "@/lib/auth";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { loginUrl } from "@/lib/auth/next";
import { isForeignOrigin, isReadMethod } from "@/lib/auth/origin";
import { applyOutcome, forwardedHeaders, refreshSession, type RefreshOutcome } from "@/lib/auth/refresh";
import { familyGate } from "@/lib/family/gate";
import { SECURITY_HEADERS } from "@/lib/guard/headers";
import { guardBody } from "@/lib/guard/request";
import { landingRedirect } from "@/lib/subject/landing";
import { explicitDemoSession, partsOfRequest, SESSION_COOKIE } from "@/lib/subject/resolve";
import { isStoreUnavailable, storeUnavailablePage, storeUnavailableResponse, warnStoreUnavailable } from "@/lib/subject/unavailable";

/** Who the request's account token is: could not be told (the store or the provider did not answer). */
const UNAVAILABLE = Symbol("unavailable");

/**
 * The request's account token, after the refresh, when it is verified and its session is still open; null when there
 * is none or it is not valid (not signed in); UNAVAILABLE when that could not be checked: the keys or the session
 * registry did not answer. "Could not tell" is never "signed out" and never "signed in".
 */
async function signedInToken(req: NextRequest, auth: RefreshOutcome): Promise<string | null | typeof UNAVAILABLE> {
  const token = auth?.kind === "refreshed" ? auth.tokens.access_token : auth?.kind === "signed_out" ? null : partsOfRequest(req).accessToken;
  if (!token) return null;
  try {
    const provider = getAuthProvider();
    const verified = await verifyAccessToken(token, { keys: await provider.keySet(), issuer: provider.issuer() });
    if (!verified.ok) return verified.reason === "no_keys" ? UNAVAILABLE : null;
    if (provider.sessionAlive && !(await provider.sessionAlive(verified.token.sessionId))) return null;
    return token;
  } catch (err) {
    if (!isStoreUnavailable(err)) return null;
    warnStoreUnavailable("the proxy", err);
    return UNAVAILABLE;
  }
}

/** The pages of a signed-in person, his (/p, /onboard) and hers (/f): a browser that is nobody is sent to the login. */
const SIGNED_IN_PAGES = /^\/(p|onboard|f)(\/|$)/;

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

/** The page this request asked for, as a path on this site with its query (without the client router's own marker). */
function askedFor(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  params.delete("_rsc"); // a client-side navigation's own marker, not part of the page he wanted
  const search = params.toString();
  return `${req.nextUrl.pathname}${search ? `?${search}` : ""}`;
}

function loginRedirect(req: NextRequest): NextResponse | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (!SIGNED_IN_PAGES.test(req.nextUrl.pathname)) return null;
  if (req.cookies.get(SESSION_COOKIE)?.value?.trim()) return null; // a demo phone: the demo decides, as before
  const [pathname, query] = loginUrl(askedFor(req)).split("?");
  const target = req.nextUrl.clone();
  target.pathname = pathname;
  target.search = query ? `?${query}` : "";
  return NextResponse.redirect(target, 307);
}

/** 503 when who this is could not be told: JSON for an API, one sentence for a page. */
function unavailable(req: NextRequest): NextResponse {
  if (isApi(req.nextUrl.pathname) || isReadMethod(req.method) === false) return storeUnavailableResponse();
  return storeUnavailablePage(req.cookies.get("rp_lang")?.value === "en" ? "en" : "zh-Hans", askedFor(req));
}

// The response headers every answer carries (real-app 3.4) are SECURITY_HEADERS in lib/guard/headers.ts (C2 track L
// moved the list there: next.config.ts puts the same headers on the paths this proxy's matcher leaves out). A header
// the answer already has is left alone.

/**
 * Routes that set Cache-Control themselves and must keep it: the live event stream (private, no-store, no-transform:
 * a proxy in between must not buffer or compress it). Everything else of a signed-in person is no-store.
 * C2 track L: the three sound clips (his visit's audio, her reminder) were listed here too and kept private,
 * max-age=300; real-app 3.4 says 一律 private, no-store, and they are what a shared phone should keep least. Playing
 * them does not need the cache (the whole e2e suite and the journeys with sound ran with no-store on them). The demo's
 * sample clips, which are nobody's, keep their five minutes: this rule is for signed-in accounts only.
 */
const OWN_CACHE_RULE = /^\/api\/events$/;

function withHeaders(res: NextResponse, signedIn: boolean, path = ""): NextResponse {
  for (const [name, value] of SECURITY_HEADERS) if (!res.headers.has(name)) res.headers.set(name, value);
  // a signed-in person's pages and answers are never kept by a cache in between
  if (signedIn && !res.headers.has("Cache-Control") && !OWN_CACHE_RULE.test(path)) res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (!isReadMethod(req.method) && isForeignOrigin(req)) return withHeaders(NextResponse.json({ error: "bad_origin" }, { status: 403 }), false);
  // C2 track L: a data route's body is JSON or nothing, 415 otherwise; the byte routes are listed (lib/guard/request.ts)
  const badBody = guardBody(req);
  if (badBody) return withHeaders(badBody, false);
  const auth = await refreshSession(req, () => getAuthProvider());
  const parts = partsOfRequest(req);
  const identity = explicitDemoSession(parts) ? null : await signedInToken(req, auth);
  if (identity === UNAVAILABLE) {
    const refused = withHeaders(unavailable(req), true);
    return auth ? applyOutcome(refused, auth) : refused;
  }
  const signedIn = identity;
  const gate = signedIn ? null : await familyGate(req);
  const login = gate || signedIn ? null : loginRedirect(req);
  // C2 track L: a signed-in person's /p page goes to /onboard until he is set up, to /f when he has no space (lib/guard/landing.ts)
  const landing = signedIn ? await landingRedirect(req, signedIn) : null;
  const res = gate ?? login ?? landing ?? (auth ? NextResponse.next({ request: { headers: forwardedHeaders(req, auth) } }) : NextResponse.next());
  return withHeaders(auth ? applyOutcome(res, auth) : res, !!signedIn, req.nextUrl.pathname);
}

export const config = {
  matcher: ["/((?!_next/|__nextjs|favicon\\.ico|worklets/|api/blob/upload|api/preflight/upload).*)"],
};
