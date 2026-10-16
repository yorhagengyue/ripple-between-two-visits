/**
 * Keeping him signed in between two reminders (docs/plan/real-app.md 3.4, 续期). web/proxy.ts calls refreshSession()
 * before every page and API request. Server-only.
 *
 * The app keeps an access token for 15 minutes, whatever the provider's own expiry (Supabase signs hour-long tokens on
 * the project): the rp_at cookie lives 15 minutes (lib/auth/cookies.ts), and when the token is within a minute of
 * those 15 minutes (or of its exp, or the cookie is gone) and a refresh token is there, the proxy trades it for new
 * tokens. The response sets the new cookies AND the request the page or route handler then sees carries them, so that
 * request is already signed in with the new token.
 *
 * It signs the browser out (both token cookies and rp_since cleared) when:
 *   - rp_since is missing, forged, or past its limit (180 days; 12 hours for 「这不是我的手机」; lib/auth/since.ts);
 *   - the provider refuses the refresh token (used, expired, its session signed out);
 *   - the refreshed session is no longer open in the session registry (signed out from another device, a new password,
 *     a recovery reset): Supabase would still refresh it, the registry says no.
 * A provider that is down leaves the request as it is (the proxy then answers 503: who he is could not be told). A
 * registry that cannot be read after a successful refresh keeps the new tokens: "could not tell" never signs him out.
 *
 * Only a request that carries rp_rt does anything here: the demo (rp_session cookies) and anonymous requests pass
 * untouched.
 */
import type { NextRequest, NextResponse } from "next/server";
import { realNowMs } from "@/lib/time/now";
import { ACCESS_COOKIE, authCookies, clearAuthCookies, isSecureRequest, REFRESH_COOKIE, SINCE_COOKIE, setAuthCookies } from "./cookies";
import { accessSecondsLeft, tokenClaims } from "./jwt";
import { AuthError, type AuthProvider, type AuthTokens } from "./provider";
import { decodeSince, sinceExpired, type SignInSince } from "./since";

/** Refresh when the access token has fewer seconds than this left (of the app's 15 minutes, or of its own exp). */
export const REFRESH_WITHIN_S = 60;

export type RefreshOutcome =
  | { kind: "refreshed"; tokens: AuthTokens; secure: boolean; since: SignInSince }
  | { kind: "signed_out"; secure: boolean }
  | null;

/** What to do for this request (null: nothing). Never throws: a provider that is down leaves the request as it is. */
export async function refreshSession(req: NextRequest, provider: () => AuthProvider): Promise<RefreshOutcome> {
  const rt = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!rt) return null;
  const left = accessSecondsLeft(req.cookies.get(ACCESS_COOKIE)?.value);
  if (left !== null && left >= REFRESH_WITHIN_S) return null;
  const secure = isSecureRequest(req);
  const since = decodeSince(req.cookies.get(SINCE_COOKIE)?.value);
  if (!since || sinceExpired(since, realNowMs())) return { kind: "signed_out", secure };
  try {
    const p = provider();
    const tokens = await p.refresh(rt);
    const { sessionId } = tokenClaims(tokens.access_token);
    let alive = true;
    try {
      alive = !p.sessionAlive || (await p.sessionAlive(sessionId));
    } catch (err) {
      // the registry could not tell. The refresh token is spent, so the new tokens are kept (dropping them would sign
      // him out); who he is gets decided right after, and that refuses with 503 while the registry cannot be read
      console.warn(`[auth] the session registry could not be asked after a refresh: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    }
    if (!alive) {
      // the registry closed this session (another device signed it out): end it at the provider too
      await p.signOut(tokens.access_token, "local").catch(() => undefined);
      return { kind: "signed_out", secure };
    }
    return { kind: "refreshed", tokens, secure, since };
  } catch (err) {
    if (err instanceof AuthError && err.code === "invalid_refresh") return { kind: "signed_out", secure };
    console.warn(`[auth] could not refresh the session: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    return null;
  }
}

/** The request's Cookie header with the new tokens (or without the sign-in cookies), for NextResponse.next(). */
export function forwardedHeaders(req: NextRequest, outcome: Exclude<RefreshOutcome, null>): Headers {
  const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
  if (outcome.kind === "refreshed") for (const [name, value] of authCookies(outcome.tokens, outcome.secure, realNowMs(), outcome.since)) jar.set(name, value);
  else {
    jar.delete(ACCESS_COOKIE);
    jar.delete(REFRESH_COOKIE);
    jar.delete(SINCE_COOKIE);
  }
  const headers = new Headers(req.headers);
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");
  return headers;
}

/** Put the outcome on the response the browser gets. */
export function applyOutcome(res: NextResponse, outcome: Exclude<RefreshOutcome, null>): NextResponse {
  if (outcome.kind === "refreshed") setAuthCookies(res, outcome.tokens, outcome.secure, outcome.since);
  else clearAuthCookies(res, outcome.secure);
  return res;
}
