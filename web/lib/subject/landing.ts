/**
 * The landing rule's reads and redirects (C2 track L; the rule itself is lib/guard/landing.ts). Server-only; in
 * lib/subject because it asks the process-wide store who a signed-in person is before any subject exists.
 *
 *   landingRedirect(req, token)   web/proxy.ts, for a signed-in account's page request: 307 to /onboard or /f, or null.
 *                                 The proxy runs on client-side navigations too, where a layout does not.
 * (The layout's second layer, familyOnlyHome, is lib/subject/landing-page.ts: it needs next/headers, which the proxy's
 * bundle does not load.)
 *
 * It reads two rows at most (his space; when there is none, his account) and never writes. "Onboarding done" is
 * remembered per user for a few seconds of real time (the test clock may stand still): a page view prefetches several
 * /p links, each of which passes the proxy. Unfinished onboarding is never remembered, so finishing it opens his pages
 * at once.
 */
import { NextResponse, type NextRequest } from "next/server";
import { tokenClaims } from "@/lib/auth/jwt";
import { isPatientPage, landingFor, type Lander } from "@/lib/guard/landing";
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { Store } from "@/lib/store/types";
import { realNowMs } from "@/lib/time/now";

/** How long "his onboarding is done" is remembered. */
export const DONE_MEMO_MS = 10_000;
const MEMO_MAX = 5000;
const done = new Map<string, number>();

/** Forget what was remembered (tests; a process that just changed someone's onboarding). */
export function forgetLanders(): void {
  done.clear();
}

/** Who this user is for the landing rule. */
export async function landerOf(userId: string, store: Pick<Store, "getSession" | "getAccount"> = getStore(), now: number = realNowMs()): Promise<Lander> {
  const until = done.get(userId);
  if (until !== undefined && until > now) return { kind: "self", onboarding: "done" };
  const row = await store.getSession(userId);
  if (row && isAccount(row)) {
    if (row.onboarding === "done") {
      if (done.size >= MEMO_MAX) done.clear();
      done.set(userId, now + DONE_MEMO_MS);
    } else done.delete(userId);
    return { kind: "self", onboarding: row.onboarding ?? null };
  }
  done.delete(userId);
  return (await store.getAccount(userId)) ? { kind: "family_only" } : { kind: "nobody" };
}

/**
 * The redirect for a signed-in account's request (the proxy verified `accessToken` already), or null: only GET and HEAD
 * of a /p page are ever redirected. A store that cannot be read redirects nobody (the page says what is wrong).
 */
export async function landingRedirect(req: NextRequest, accessToken: string, store?: Pick<Store, "getSession" | "getAccount">): Promise<NextResponse | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = req.nextUrl.pathname;
  if (!isPatientPage(path)) return null;
  const userId = tokenClaims(accessToken).userId;
  if (!userId) return null;
  let to: string | null;
  try {
    to = landingFor(path, await landerOf(userId, store));
  } catch {
    return null;
  }
  if (!to) return null;
  const target = req.nextUrl.clone();
  target.pathname = to;
  target.search = "";
  return NextResponse.redirect(target, 307);
}
