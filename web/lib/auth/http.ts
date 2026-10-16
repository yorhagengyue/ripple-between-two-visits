/**
 * What the account routes (app/api/auth/**, app/api/me) share. Server-only.
 *
 *   guardPost(req)        a POST must be JSON and from this site: another site's Origin (or Sec-Fetch-Site:
 *                         cross-site) is 403 bad_origin, any other content type 415. A request without an Origin (a
 *                         script, the tests) passes: the cookies are SameSite=Lax, so another site's form never
 *                         carries them, and the content type keeps it from posting JSON without a preflight.
 *   requestFacts(req)     the client's address, this browser's rp_device id (a new one if it had none), its User-Agent
 *   signedInResponse()    the answer plus the sign-in cookies, the device cookie and rp_lang
 *   refusal(r)            { error, until? } with the refusal's status (Retry-After on 429 and 423)
 *   private, no-store     on every answer (real-app 3.4: signed-in answers are never cached)
 *   accountRoute(handler) wraps every account route: when the store or the identity provider cannot be read, the answer
 *                         is 503 store_unavailable (real-app 2.25), never an unhandled 500 and never a guess such as
 *                         "not signed in" (lib/subject/unavailable.ts)
 */
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { clearAuthCookies, DEVICE_COOKIE, isSecureRequest, setAuthCookies, setDeviceCookie } from "./cookies";
import { isDeviceId, newDeviceId } from "./device";
import { isStoreUnavailable, storeUnavailableResponse, warnStoreUnavailable } from "@/lib/subject/unavailable";
import { clientIp } from "./limits";
import { isForeignOrigin } from "./origin";
import type { Refusal, RequestFacts, SignedIn } from "./service";

/** The rp_lang cookie: a year (it is only his language). */
const LANG_COOKIE_MAX_S = 365 * 24 * 3600;

function noStore<T extends NextResponse>(res: T): T {
  res.headers.set("cache-control", "private, no-store");
  return res;
}

export function json(body: unknown, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

/** A refusal from lib/auth/service.ts as the browser gets it. */
export function refusal(r: Refusal): NextResponse {
  const res = json(r.until ? { error: r.error, until: r.until } : { error: r.error }, r.status);
  if (r.until && (r.status === 429 || r.status === 423)) {
    const s = Math.max(1, Math.ceil((Date.parse(r.until) - Date.now()) / 1000));
    res.headers.set("retry-after", String(s));
  }
  return res;
}

/** null when the POST may go on, else the answer to send. */
export function guardPost(req: NextRequest): NextResponse | null {
  // the proxy refuses another site's writes first (lib/auth/origin.ts); checked here again so the route holds alone
  if (isForeignOrigin(req)) return json({ error: "bad_origin" }, 403);
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const length = req.headers.get("content-length");
  if (!type.startsWith("application/json") && !(length === "0" && !type)) return json({ error: "invalid_body" }, 415);
  return null;
}

/**
 * Wrap an account route's handler: a store or identity provider that cannot be read is 503 store_unavailable with
 * Retry-After (real-app 2.25), whatever step it happened at. Anything else is thrown on as before.
 */
export function accountRoute<A extends unknown[]>(handler: (req: NextRequest, ...rest: A) => Promise<Response>): (req: NextRequest, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      if (!isStoreUnavailable(err)) throw err;
      warnStoreUnavailable(`${req.method} ${req.nextUrl.pathname}`, err);
      return storeUnavailableResponse();
    }
  };
}

export function requestFacts(req: NextRequest): RequestFacts {
  const cookie = req.cookies.get(DEVICE_COOKIE)?.value;
  const known = isDeviceId(cookie);
  return { ip: clientIp(req.headers), deviceId: known ? cookie : newDeviceId(), knownDevice: known, userAgent: req.headers.get("user-agent") };
}

/** Give a browser that came without a device cookie the one this request used. */
export function withDevice(res: NextResponse, req: NextRequest, facts: RequestFacts): NextResponse {
  if (!facts.knownDevice) setDeviceCookie(res, facts.deviceId, isSecureRequest(req));
  return res;
}

/** The answer of a flow that signed him in: the sign-in cookies, the device cookie, his language. */
export function signedInResponse(req: NextRequest, facts: RequestFacts, signedIn: SignedIn, body: unknown, status = 200): NextResponse {
  const res = json(body, status);
  const secure = isSecureRequest(req);
  setAuthCookies(res, signedIn.tokens, secure, signedIn.since);
  if (signedIn.locale === "en" || signedIn.locale === "zh-Hans") {
    res.cookies.set(LOCALE_COOKIE, signedIn.locale, { path: "/", sameSite: "lax", secure, maxAge: LANG_COOKIE_MAX_S });
  }
  // a browser that was looking at the demo is now someone's own phone (real-app 3.7: rp_view)
  res.cookies.set("rp_view", "", { path: "/", maxAge: 0 });
  return withDevice(res, req, facts);
}

/** The answer of a sign-out: the sign-in cookies go. */
export function signedOutResponse(req: NextRequest, body: unknown, status = 200): NextResponse {
  const res = json(body, status);
  clearAuthCookies(res, isSecureRequest(req));
  return res;
}
