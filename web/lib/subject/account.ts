/**
 * The account routes' and pages' way to the store and the identity provider (track A; docs/plan/real-app.md 7.3 names
 * this file). Server-only.
 *
 * Signing up, logging in and recovering act before there is any subject: there is no scope to bind a store to yet. They
 * get the process-wide store here, and lib/auth/service.ts touches only account-level rows (the account, its recovery
 * code, devices, consent, rate limits, events) and the new account's own space (track C's seedAccount). Everything a
 * signed-in person does with his own data still goes through requireSubject / getPageSubject and a scoped store.
 *
 *   accountDeps()        { store, auth } for lib/auth/service.ts
 *   currentUser(req)     the signed-in person behind a request's rp_at (verified, session open, account row), or null
 *   pageUser()           the same for a page (its cookies)
 *   signedInHome()       where a signed-in person belongs, for /login and /signup to send him on; null when signed out
 *   signedInWithoutSpace()  a signed-in family member with no space of her own (the /p pages send her to /f)
 */
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { getAuthProvider } from "@/lib/auth";
import { ACCESS_COOKIE, DEVICE_COOKIE, SINCE_COOKIE } from "@/lib/auth/cookies";
import { isDeviceId, newDeviceId } from "@/lib/auth/device";
import { tokenClaims } from "@/lib/auth/jwt";
import { clientIp } from "@/lib/auth/limits";
import { homeAfterSignIn } from "@/lib/auth/next";
import type { AccountDeps, Me, RequestFacts } from "@/lib/auth/service";
import { decodeSince } from "@/lib/auth/since";
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow } from "@/lib/store/types";
import { signedInUser } from "./resolve";

export function accountDeps(): AccountDeps {
  return { store: getStore(), auth: getAuthProvider() };
}

async function meFrom(token: string | null | undefined, sinceCookie: string | null | undefined): Promise<Me | null> {
  const t = token?.trim() || null;
  if (!t) return null;
  const user = await signedInUser(t, { store: getStore(), auth: () => getAuthProvider() });
  if (!user) return null;
  return {
    userId: user.userId,
    sessionId: user.sessionId,
    account: user.account,
    email: tokenClaims(t).email,
    ephemeral: decodeSince(sinceCookie)?.ephemeral === true,
  };
}

/** The signed-in person behind a request (route handlers), or null. */
export async function currentUser(req: NextRequest): Promise<Me | null> {
  return meFrom(req.cookies.get(ACCESS_COOKIE)?.value, req.cookies.get(SINCE_COOKIE)?.value);
}

/** The signed-in person on a page (server components), or null. */
export async function pageUser(): Promise<Me | null> {
  const jar = await cookies();
  return meFrom(jar.get(ACCESS_COOKIE)?.value, jar.get(SINCE_COOKIE)?.value);
}

/** His own space, or null (a family member without one). */
export async function ownScopeOf(userId: string): Promise<SessionRow | null> {
  const row = await getStore().getSession(userId);
  return row && isAccount(row) ? row : null;
}

/** Where a signed-in person belongs (his today, his onboarding, or her family page); null when nobody is signed in. */
export async function signedInHome(): Promise<string | null> {
  const me = await pageUser();
  if (!me) return null;
  return homeAfterSignIn(await ownScopeOf(me.userId));
}

/**
 * Is the person on this page signed in without a space of their own (a family member who only looks)? real-app 3.7
 * 页面跳转: 「只是家属，打开 /p/*：跳 /f」; app/p/layout.tsx asks when no page subject resolved.
 */
export async function signedInWithoutSpace(): Promise<boolean> {
  const me = await pageUser();
  return !!me && !(await ownScopeOf(me.userId));
}

/** What a page knows about the browser asking (his devices page marks "this phone" by its device cookie). */
export async function pageFacts(): Promise<RequestFacts> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const cookie = jar.get(DEVICE_COOKIE)?.value;
  const known = isDeviceId(cookie);
  return { ip: clientIp(h), deviceId: known ? cookie : newDeviceId(), knownDevice: known, userAgent: h.get("user-agent") };
}
