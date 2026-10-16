/**
 * Cookie names and lifetimes for sessions. Client-safe (no server imports).
 *
 * - rp_session: which session this device is in (lib/session-cookie.ts reads it for API routes).
 * - rp_member:  the session_member row this device created when it joined.
 * - rp_role:    the role it picked on /join (patient / family / backstage / director / judge).
 * - rp_lang:    UI language override (lib/i18n.ts LOCALE_COOKIE).
 *
 * Pages read the session from the cookie only. Client components then pass the id explicitly
 * (`?session=<id>`) on every API call and on the event stream, so one page never mixes two sessions
 * even if another tab joins a different one and rewrites the cookie.
 */
export { SESSION_COOKIE, SESSION_QUERY } from "@/lib/session-cookie";
export { LOCALE_COOKIE } from "@/lib/i18n";

export const MEMBER_COOKIE = "rp_member";
export const ROLE_COOKIE = "rp_role";

/** Judge sandboxes expire; filming sessions do not. */
export const SANDBOX_TTL_HOURS = 48;
/** Cookie lifetime for sessions without an expiry (filming). */
export const FILMING_COOKIE_DAYS = 30;
