/**
 * Which scope a request is for, and as whom (docs/plan/real-app.md 3.7, with the C2 decisions). Server-only; pure
 * apart from the store and the identity provider it is given (lib/subject/index.ts gives the process-wide ones).
 *
 * In this order:
 *   1. ?session=<id>                 the demo path: a sandbox or filming session as before. Any other row (an
 *                                    account's space) or no row at all: the same 404 session_not_found, so the
 *                                    answer never tells whether an account with that id exists.
 *   2. rp_view=demo and rp_session   the demo path for a browser that is looking at the demo (the same 404 rule).
 *   3. a valid rp_at                 the account path: the token verified (ES256, JWKS, iss, aud, exp; lib/auth/jwt.ts),
 *                                    the provider session still signed in where the provider can tell, and an
 *                                    account row for its user; a token without an account row counts as signed out.
 *                                    A route that accepts her link (opts.allowFamily) and gets ?link=<id>: his space
 *                                    through that link when it is active and hers (family); otherwise her own space
 *                                    (self), 404 no_profile when she has none. Through her link, whether each of them
 *                                    has agreed to the family text in force is read in the same round as his scope row
 *                                    (lib/care/reconsent.ts linkConsent): while either has not, the scoped store hands
 *                                    her switches out in the alert-only form, to every reader.
 *   4. rp_session                    the demo path (the e2e harness's phones send only this cookie).
 *   5. nothing                       400 no_session, as before; 401 not_signed_in when a token was there but not
 *                                    valid (the browser refreshes and tries again).
 * An account's space is never reached from a session id: only a verified token or an active care link leads to it.
 */
import { verifyAccessToken } from "@/lib/auth/jwt";
import type { AuthProvider } from "@/lib/auth/provider";
// the family texts asked again (owner, 2026-10-14): read with his scope row, applied by her scoped store
import { alertOnly, isHeld, linkConsent, type LinkConsent } from "@/lib/care/reconsent";
import { isAccount } from "@/lib/store/scope";
import type { AccountRow, CareLinkRow, SessionRow, Store } from "@/lib/store/types";
import { scopedStore } from "./scoped-store";
import type { Subject } from "./types";
import { StoreUnavailable } from "./unavailable";

export const SESSION_QUERY = "session";
export const LINK_QUERY = "link";
export const SESSION_COOKIE = "rp_session";
export const VIEW_COOKIE = "rp_view";
export const ACCESS_COOKIE = "rp_at";

export interface CookieJar {
  get(name: string): { value: string } | undefined;
}

/** What a request presents (an API request, or a page with its cookies and the page's own link). */
export interface RequestParts {
  querySession: string | null;
  queryLink: string | null;
  cookieSession: string | null;
  cookieView: string | null;
  accessToken: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function partsOfRequest(req: { nextUrl: URL; cookies: CookieJar }): RequestParts {
  return {
    querySession: clean(req.nextUrl.searchParams.get(SESSION_QUERY)),
    queryLink: clean(req.nextUrl.searchParams.get(LINK_QUERY)),
    cookieSession: clean(req.cookies.get(SESSION_COOKIE)?.value),
    cookieView: clean(req.cookies.get(VIEW_COOKIE)?.value),
    accessToken: clean(req.cookies.get(ACCESS_COOKIE)?.value),
  };
}

/** The demo session a request names explicitly (?session=, or rp_session while rp_view=demo), else null. */
export function explicitDemoSession(parts: RequestParts): string | null {
  if (parts.querySession) return parts.querySession;
  if (parts.cookieView === "demo" && parts.cookieSession) return parts.cookieSession;
  return null;
}

export interface ResolveDeps {
  store: Store;
  auth: () => AuthProvider;
}

export interface ResolveOptions {
  /** this route accepts ?link= (her entry points, real-app 3.10) */
  allowFamily?: boolean;
}

export type Resolved = { ok: true; subject: Subject } | { ok: false; status: 400 | 401 | 403 | 404; error: string };

// ------------------------------------------------------------------ subjects

export function demoSubject(base: Store, scope: SessionRow): Subject {
  return { kind: "demo", relation: "demo", userId: null, scope, link: null, store: scopedStore(base, scope, "demo") };
}

export function selfSubject(base: Store, scope: SessionRow, userId: string): Subject {
  return { kind: "account", relation: "self", userId, scope, link: null, store: scopedStore(base, scope, "self", { userId, maskSessionId: true }) };
}

/**
 * Her subject through her link. `consent`: whether each of them has agreed to the family text in force for it
 * (lib/care/reconsent.ts); while either has not, the store's getFamilyGrant hands every reader the alert-only form.
 * resolveSubject always reads and passes it. Left out, neither has agreed (as for a link with no record at all): a caller
 * that builds a subject for a link it made itself (tests) passes what lib/care/reconsent.ts linkConsent reads.
 */
export function familySubject(base: Store, scope: SessionRow, userId: string, link: CareLinkRow, consent: LinkConsent = { his: false, hers: false }): Subject {
  return {
    kind: "account",
    relation: "family",
    userId,
    scope,
    link,
    consent,
    store: scopedStore(base, scope, "family", { userId, linkId: link.id, maskSessionId: true, switches: isHeld(consent) ? alertOnly : null }),
  };
}

/** A scheduled job's subject for one account scope (lib/jobs). */
export function systemSubject(base: Store, scope: SessionRow): Subject {
  return { kind: "account", relation: "system", userId: null, scope, link: null, store: scopedStore(base, scope, "system") };
}

// ------------------------------------------------------------------ the account behind a token

export interface SignedInUser {
  userId: string;
  /** the provider's session id (signs out per session) */
  sessionId: string | null;
  account: AccountRow;
}

/**
 * The signed-in user behind an access token: verified, its provider session alive (where the provider can tell), and
 * an account row for it. null: signed out (no token, a bad token, an ended session, or no account row).
 */
export async function signedInUser(token: string | null, deps: ResolveDeps): Promise<SignedInUser | null> {
  if (!token) return null;
  const auth = deps.auth();
  const verified = await verifyAccessToken(token, { keys: await auth.keySet(), issuer: auth.issuer() });
  // C2 track A (only add): the provider's keys could not be fetched, so the token could not be checked: that is
  // "could not tell" (503 upstream, lib/subject/unavailable.ts), never "signed out"
  if (!verified.ok && verified.reason === "no_keys") throw new StoreUnavailable("the identity provider's keys");
  if (!verified.ok) return null;
  if (auth.sessionAlive && !(await auth.sessionAlive(verified.token.sessionId))) return null;
  const account = await deps.store.getAccount(verified.token.sub);
  if (!account) return null;
  return { userId: verified.token.sub, sessionId: verified.token.sessionId, account };
}

// ------------------------------------------------------------------ the resolution

async function demoPath(id: string, deps: ResolveDeps): Promise<Resolved> {
  const row = await deps.store.getSession(id);
  // an account's space is never reached by its id: the same answer as for an id that does not exist
  if (!row || isAccount(row)) return { ok: false, status: 404, error: "session_not_found" };
  return { ok: true, subject: demoSubject(deps.store, row) };
}

export async function resolveSubject(parts: RequestParts, opts: ResolveOptions, deps: ResolveDeps): Promise<Resolved> {
  const explicit = explicitDemoSession(parts);
  if (explicit) return demoPath(explicit, deps);

  const user = await signedInUser(parts.accessToken, deps);
  if (user) {
    if (opts.allowFamily && parts.queryLink) {
      const link = await deps.store.getCareLink(parts.queryLink);
      if (!link || link.family_id !== user.userId) return { ok: false, status: 404, error: "link_not_found" };
      if (link.status !== "active") return { ok: false, status: 403, error: "link_not_active" };
      // his scope row, and whether each of them has agreed to the family text in force: one round
      const [scope, consent] = await Promise.all([deps.store.getSession(link.patient_id), linkConsent(deps.store, link)]);
      if (!scope || !isAccount(scope)) return { ok: false, status: 404, error: "link_not_found" };
      return { ok: true, subject: familySubject(deps.store, scope, user.userId, link, consent) };
    }
    const scope = await deps.store.getSession(user.userId);
    if (!scope || !isAccount(scope)) return { ok: false, status: 404, error: "no_profile" };
    return { ok: true, subject: selfSubject(deps.store, scope, user.userId) };
  }

  if (parts.cookieSession) return demoPath(parts.cookieSession, deps);
  if (parts.accessToken) return { ok: false, status: 401, error: "not_signed_in" };
  return { ok: false, status: 400, error: "no_session" };
}
