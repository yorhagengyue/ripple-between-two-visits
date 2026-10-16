/**
 * The sign-in cookies (docs/plan/real-app.md 3.4). Server-only.
 *
 *   rp_at      the access token, 15 minutes at most (ACCESS_COOKIE_MAX_S) whatever the provider's token says: Supabase
 *              signs hour-long tokens on the project, the app keeps one for 15 minutes and the proxy refreshes by then
 *   rp_rt      the refresh token, 30 days, set again at every refresh (rolling)
 *   rp_since   when this sign-in started and whether it is 「这不是我的手机」, signed (lib/auth/since.ts); 180 days
 *   rp_device  this browser's random device id (lib/auth/device.ts), 400 days; outlives a sign-out
 *
 * 「这不是我的手机」: rp_at, rp_rt and rp_since carry no expiry, so the browser drops them when it closes (and rp_since
 * stops refreshes after 12 hours). All are httpOnly, SameSite=Lax, path /. Secure follows the request: set when the
 * request reached us over https (the URL, or x-forwarded-proto from the proxy in front), so a production build on a
 * laptop over http (the filming LAN, `next start` for the recordings) still keeps its cookies. Lax, not Strict: he
 * opens Ripple from a WhatsApp link, a cross-site top-level visit.
 */
import type { NextResponse } from "next/server";
import { realNowMs } from "@/lib/time/now";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_S } from "./device";
import { ACCESS_COOKIE_MAX_S, REFRESH_TOKEN_TTL_S, SIGN_IN_MAX_S, type AuthTokens } from "./provider";
import { encodeSince, SINCE_COOKIE, type SignInSince } from "./since";

export const ACCESS_COOKIE = "rp_at";
export const REFRESH_COOKIE = "rp_rt";
export { DEVICE_COOKIE, SINCE_COOKIE };

export interface RequestShape {
  nextUrl: URL;
  headers: Headers;
}

/** Did this request come over https (directly, or through a proxy that says so)? */
export function isSecureRequest(req: RequestShape): boolean {
  if (req.nextUrl.protocol === "https:") return true;
  const fwd = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return fwd === "https";
}

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  /** seconds; absent: a session cookie (gone when the browser closes) */
  maxAge?: number;
}

/**
 * The three sign-in cookies for a set of tokens: [name, value, options]. `since` is when this sign-in started (kept
 * across refreshes); without it the sign-in starts now, ordinary (the developer tools' sign-ins).
 */
export function authCookies(tokens: AuthTokens, secure: boolean, nowMs: number = realNowMs(), since?: SignInSince): [string, string, CookieOptions][] {
  const base = { path: "/", httpOnly: true, sameSite: "lax" as const, secure };
  const s: SignInSince = since ?? { atMs: nowMs, ephemeral: false };
  const life = (seconds: number) => (s.ephemeral ? {} : { maxAge: Math.max(0, Math.floor(seconds)) });
  const accessLeft = Math.min(ACCESS_COOKIE_MAX_S, tokens.expires_at - Math.floor(nowMs / 1000));
  return [
    [ACCESS_COOKIE, tokens.access_token, { ...base, ...life(accessLeft) }],
    [REFRESH_COOKIE, tokens.refresh_token, { ...base, ...life(REFRESH_TOKEN_TTL_S) }],
    [SINCE_COOKIE, encodeSince(s), { ...base, ...life(SIGN_IN_MAX_S) }],
  ];
}

export function setAuthCookies(res: NextResponse, tokens: AuthTokens, secure: boolean, since?: SignInSince): void {
  for (const [name, value, opts] of authCookies(tokens, secure, realNowMs(), since)) res.cookies.set(name, value, opts);
}

/** Sign the browser out: the three sign-in cookies go (the device cookie stays: it is the phone, not the person). */
export function clearAuthCookies(res: NextResponse, secure: boolean): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, SINCE_COOKIE]) res.cookies.set(name, "", { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 0 });
}

/** The device cookie for a browser that had none. */
export function setDeviceCookie(res: NextResponse, deviceId: string, secure: boolean): void {
  res.cookies.set(DEVICE_COOKIE, deviceId, { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: DEVICE_COOKIE_MAX_S });
}
