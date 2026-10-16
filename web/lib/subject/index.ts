/**
 * Who a request is for, and the store bound to it (docs/plan/real-app.md 3.7; C2 architecture review 认人, finding 9).
 * Server-only. The one place routes and pages get data access from:
 *
 *   const found = await requireSubject(req);                 // route handlers
 *   if (!found.ok) return found.res;                         // 400 no_session, 401 not_signed_in, 404 session_not_found / no_profile
 *   const { session, store, subject } = found;               // session = subject.scope; store bound to it
 *
 *   const ctx = await getPageSubject();                      // pages and layouts (React cache: once per request)
 *   if (!ctx) return <NoSessionPhone .../>;
 *   ctx.store, ctx.session (server use), ctx.client (what client components may get), ctx.d0, ctx.since
 *
 * Routes that are her entry points pass { allowFamily: true }: ?link=<her care link> then reads his space through the
 * link (family mode, read-only). Every other route ignores ?link=.
 *
 * The demo works exactly as before: ?session= or the rp_session cookie name a sandbox or filming session, and the
 * device's role still comes from its member row (lib/family/role.ts). An account's space is reached only through a
 * verified token or an active care link, never through a session id (resolve.ts).
 *
 * Direct getStore() is allowed only here, in lib/jobs, lib/store, scripts and tests
 * (tests/unit/subject/store-allowlist.test.ts scans for it).
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { cache } from "react";
import { getAuthProvider } from "@/lib/auth";
import { getBus } from "@/lib/bus";
import { getStore } from "@/lib/store";
import { scopeD0, isAccount } from "@/lib/store/scope";
import type { SessionRow } from "@/lib/store/types";
import { partsOfRequest, resolveSubject, selfSubject, signedInUser, type RequestParts, type ResolveOptions, type SignedInUser } from "./resolve";
import { scopedStore, type ScopedStore } from "./scoped-store";
import type { Subject } from "./types";
// C2 track A (only add): a store that cannot be read is 503, never a guess (real-app 2.25)
import { isStoreUnavailable, StoreUnavailable, storeUnavailableResponse, warnStoreUnavailable } from "./unavailable";
import { clientScope } from "./url";

export type { Subject, SubjectKind, SubjectRelation } from "./types";
export { ScopeViolation, scopedStore, type ScopedStore, type ScopeMode } from "./scoped-store";
export { clientScope, linkUrl, scopedUrl } from "./url";
export { demoSubject, explicitDemoSession, familySubject, partsOfRequest, resolveSubject, selfSubject, systemSubject, type RequestParts, type Resolved } from "./resolve";
export { demoEntryStore, type DemoEntryStore } from "./entry";

const deps = () => ({ store: getStore(), auth: () => getAuthProvider() });

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export type SubjectFound = { ok: true; subject: Subject; session: SessionRow; store: ScopedStore } | { ok: false; res: NextResponse };

/** The request's subject (the order is in resolve.ts), or the error response. */
export async function requireSubject(req: NextRequest, opts: ResolveOptions = {}): Promise<SubjectFound> {
  let r: Awaited<ReturnType<typeof resolveSubject>>;
  try {
    r = await resolveSubject(partsOfRequest(req), opts, deps());
  } catch (err) {
    // who this is could not be read: refuse with 503 (never 400 / 401 / 404, which would be a guess)
    if (!isStoreUnavailable(err)) throw err;
    warnStoreUnavailable("requireSubject", err);
    return { ok: false, res: storeUnavailableResponse() };
  }
  if (!r.ok) return { ok: false, res: jsonError(r.status, r.error) };
  return { ok: true, subject: r.subject, session: r.subject.scope, store: r.subject.store };
}

/** A demo route (the story clock, the director, the crew's tools): an account's request answers 404 not_found. */
export async function requireDemoSubject(req: NextRequest): Promise<SubjectFound> {
  const found = await requireSubject(req);
  if (found.ok && found.subject.kind !== "demo") return { ok: false, res: jsonError(404, "not_found") };
  return found;
}

/** The demo session a request names (?session= or rp_session), or null; an account's id reads as none. */
export async function demoSessionFor(req: NextRequest): Promise<SessionRow | null> {
  const parts = partsOfRequest(req);
  const id = parts.querySession ?? parts.cookieSession;
  if (!id) return null;
  const row = await getStore().getSession(id).catch(() => null);
  return row && !isAccount(row) ? row : null;
}

export type UserFound =
  | { ok: true; user: SignedInUser; scope: SessionRow | null; store: ScopedStore }
  | { ok: false; res: NextResponse };

/**
 * The signed-in person, with or without a space of their own (her accepting an invitation, his account page). The store
 * is bound to their own space when they have one; without one only their own account rows and links are reachable.
 */
export async function requireUser(req: NextRequest): Promise<UserFound> {
  const d = deps();
  let user: SignedInUser | null;
  let row: SessionRow | null;
  try {
    user = await signedInUser(partsOfRequest(req).accessToken, d);
    row = user ? await d.store.getSession(user.userId) : null;
  } catch (err) {
    if (!isStoreUnavailable(err)) throw err;
    warnStoreUnavailable("requireUser", err);
    return { ok: false, res: storeUnavailableResponse() };
  }
  if (!user) return { ok: false, res: jsonError(401, "not_signed_in") };
  const scope = row && isAccount(row) ? row : null;
  const store = scope ? selfSubject(d.store, scope, user.userId).store : scopedStore(d.store, { id: `no-scope:${user.userId}` }, "self", { userId: user.userId, maskSessionId: true });
  return { ok: true, user, scope, store };
}

// ------------------------------------------------------------------ pages

export interface PageSubject {
  subject: Subject;
  /** the scope row, "today" computed (server use: never hand an account's row to the browser, use `client`) */
  session: SessionRow;
  store: ScopedStore;
  /** the scope row as client components may have it (an account's without its id: lib/subject/url.ts clientScope) */
  client: SessionRow;
  /** the scope's day 0 (the template's for the demo) for the day label */
  d0: string;
  /** last bus event id at render time; the client stream resumes after it */
  since: number;
  /** demo: the device's rp_role / rp_member cookies (lib/family/role.ts decides from the member row); account: null */
  role: string | null;
  memberId: string | null;
}

/** The page context for a subject (also what tests build directly). */
export function pageSubjectFor(subject: Subject, extras: { role?: string | null; memberId?: string | null; since?: number } = {}): PageSubject {
  const session = subject.scope;
  const demo = subject.kind === "demo";
  return {
    subject,
    session,
    store: subject.store,
    client: clientScope(session),
    d0: scopeD0(session),
    since: extras.since ?? getBus().recent(session.id, { limit: 1 })[0]?.id ?? 0,
    role: demo ? (extras.role ?? null) : null,
    memberId: demo ? (extras.memberId ?? null) : null,
  };
}

/**
 * This request's page context (deduplicated across layout and page): the demo session from the rp_session cookie (or
 * an account from its sign-in cookie, see resolve.ts), or null when there is none. `link`: her care link, for her pages.
 */
export const getPageSubject = cache(async (link?: string): Promise<PageSubject | null> => {
  const jar = await cookies();
  const parts: RequestParts = {
    querySession: null, // pages are named by their cookies only (the demo's rule, unchanged)
    queryLink: link?.trim() || null,
    cookieSession: jar.get("rp_session")?.value?.trim() || null,
    cookieView: jar.get("rp_view")?.value?.trim() || null,
    accessToken: jar.get("rp_at")?.value?.trim() || null,
  };
  let r: Awaited<ReturnType<typeof resolveSubject>>;
  try {
    r = await resolveSubject(parts, { allowFamily: !!parts.queryLink }, deps());
  } catch (err) {
    // a page cannot answer 503 itself: the error boundary (app/error.tsx) says the sentence; never "no session"
    if (!isStoreUnavailable(err)) throw err;
    warnStoreUnavailable("getPageSubject", err);
    throw new StoreUnavailable("getPageSubject");
  }
  if (!r.ok) return null;
  return pageSubjectFor(r.subject, { role: jar.get("rp_role")?.value ?? null, memberId: jar.get("rp_member")?.value ?? null });
});

/**
 * The page context of the demo's own screens (the judges' landing, backstage, the director, /try): the demo session
 * from the rp_session cookie even when the browser is also signed in to an account (as if rp_view=demo), and null
 * for anything but a demo session. An account never renders on these screens.
 */
export const getDemoPageSubject = cache(async (): Promise<PageSubject | null> => {
  const jar = await cookies();
  const parts: RequestParts = {
    querySession: null,
    queryLink: null,
    cookieSession: jar.get("rp_session")?.value?.trim() || null,
    cookieView: "demo",
    accessToken: null,
  };
  const r = await resolveSubject(parts, {}, deps());
  if (!r.ok || r.subject.kind !== "demo") return null;
  return pageSubjectFor(r.subject, { role: jar.get("rp_role")?.value ?? null, memberId: jar.get("rp_member")?.value ?? null });
});
