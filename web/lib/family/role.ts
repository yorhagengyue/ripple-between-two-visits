/**
 * Who is calling (task M6): the family role may look, never act for him. Server-only.
 *
 * The identity rule itself is lib/family/identity.ts (shared with the proxy gate, lib/family/gate.ts): the device's
 * session_member row (cookie rp_member, httpOnly, set by /join and POST /api/session) in the requested session first;
 * a family device naming another session is "family_elsewhere" (denied outright); once anyone has joined the session
 * as family, a device with no row in it is a "stranger" (denied outright: her phone with its cookies dropped or forged
 * is nobody, never his side); only in a session nobody joined as family does the rp_role cookie count, or no role at
 * all (the tests' and scripts' plain ?session= calls), as before M6. A request with no device cookie at all
 * ("anonymous") is refused by the proxy gate for everything of his (lib/family/gate.ts ANONYMOUS_API); these checks
 * treat it as "no role", so route tests that call a handler without cookies keep working. Under STORE=supabase found
 * rows are remembered for a minute (lib/family/member-cache.ts).
 *
 *   denyFamily        Wei Ling cannot act for him: POST /api/doses, confirming medicines (POST /api/meds), linking
 *                     an answer to a question (POST /api/meds/[id]/answer), confirming a visit's items and answers
 *                     (POST /api/visits/[id]/confirm), answering his understanding checklist (POST
 *                     /api/understanding), re-photographing a bag (PATCH /api/meds/[id]), recording a reading (POST
 *                     /api/bp) or a note (POST /api/notes), asking in his name (POST /api/ask), moving the story
 *                     clock (POST /api/clock), and reading his visit brief (GET /api/brief, until a grant for it
 *                     exists), his notes (GET /api/notes) or his readings (GET /api/bp). 403 patient_only; a stranger
 *                     gets 403 member_required.
 *   denyNonPatient    only Mr Tan changes what his family can see (POST /api/family/grants), and only from a device
 *                     with a row: his patient row, or a judge's own sandbox (the judge's row; the sandbox plays his
 *                     phone). Family, backstage, director, an rp_role cookie without a row and a call with no
 *                     identity get 403 patient_only (a stranger: member_required). So "no role, so his side" can
 *                     never open her view.
 *   denyOutsider      the reads her own page uses (GET /api/reminders, GET /api/reminders/[id]/audio) refuse a family
 *                     device outside its session and a stranger, like the gate does first.
 *   sessionCaller     the routes about the session itself (GET /api/session, POST /api/session/reset): her phone
 *                     403 patient_only, outsiders 403; otherwise the caller's identity (GET /api/session lists the
 *                     members' roles, never their ids, and nothing but the session row to a request with no device).
 *   All answer 503 role_unavailable (Retry-After: 2, roleUnavailable, the proxy gate's own answer) when the member rows
 *   cannot be read: they fail closed and never turn "could not tell" into "no role, so his side".
 *
 * Pages (server components) use the same rule through the page's own session context:
 *   pageIdentity      the device's identity for the page session (the rp_session cookie).
 *   pageRole          the role it acts with: "family" for her phone and for any denied device, null for none.
 *   sendFamilyToF     a device that is not his is sent away before anything renders: Wei Ling's phone to /f, a
 *                     stranger to /join. app/p/layout.tsx calls it for every /p/* page (and /p/brief, /p/family
 *                     again); the proxy gate redirects first.
 */
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { MEMBER_COOKIE, ROLE_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import { demoMembers } from "@/lib/subject/entry";
import { actingRole, isFamily, isOutsider, resolveIdentity, type Identity } from "./identity";
import { directoryFor, type MembersReader } from "./member-cache";

/**
 * The scope a role check is about. An account's scope has no devices and no member rows: its person comes from a
 * verified token (lib/subject), so every check below is the demo's alone and answers "nothing to refuse" for an
 * account (C2). The member rows are read through the demo's way in (lib/subject/entry.ts), never a raw store.
 */
export type RoleScope = Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>;
const isAccountScope = (s: RoleScope) => s.kind === "account";

/** Where Wei Ling's phone belongs. */
export const FAMILY_HOME = "/f";
/** Where a device with no row in a family session is sent: joining with the code is the only way in. */
export const STRANGER_HOME = "/join";

/** The part of a page's session context (lib/session/server.ts PageSession) the role needs. */
export interface PageRoleContext {
  session: RoleScope;
  /** rp_member cookie */
  memberId: string | null;
  /** rp_role cookie */
  role: string | null;
}

export const PATIENT_ONLY = "patient_only";
export const MEMBER_REQUIRED = "member_required";
export const MEMBER_REQUIRED_DETAIL = "This phone has not joined this session. Join it with its code first.";
const ELSEWHERE_DETAIL = "Wei Ling's phone can only open the session it joined.";

/** The request's identity for this session (?session= or the rp_session cookie names it; the route resolved it). */
export async function requesterIdentity(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<Identity> {
  if (isAccountScope(session)) return { kind: "none" };
  return resolveIdentity(
    {
      sessionId: session.id,
      cookieSession: req.cookies.get(SESSION_COOKIE)?.value ?? null,
      memberId: req.cookies.get(MEMBER_COOKIE)?.value ?? null,
      cookieRole: req.cookies.get(ROLE_COOKIE)?.value ?? null,
    },
    directoryFor(store),
  );
}

/** The role the request acts with: "family" for her phone and for any denied device; null: no role. */
export async function requesterRole(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<MemberRole | null> {
  return actingRole(await requesterIdentity(req, session, store));
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: PATIENT_ONLY, detail: message }, { status: 403 });
}

export function memberRequired(): NextResponse {
  return NextResponse.json({ error: MEMBER_REQUIRED, detail: MEMBER_REQUIRED_DETAIL }, { status: 403 });
}

/** The 403 for a device that is denied outright (family outside its session, or a stranger). */
export function outsiderDenied(id: { kind: "family_elsewhere" } | { kind: "stranger" }): NextResponse {
  return id.kind === "stranger" ? memberRequired() : forbidden(ELSEWHERE_DETAIL);
}

/** The member rows could not be read (database down or slow): try again, never "pass and hope". */
export const ROLE_UNAVAILABLE = "role_unavailable";
export const ROLE_UNAVAILABLE_DETAIL = "Could not check which phone this is. Try again in a moment.";
export const ROLE_RETRY_AFTER_S = 2;

/** 503 role_unavailable with Retry-After, the same answer the proxy gate gives (lib/family/gate.ts). */
export function roleUnavailable(): NextResponse {
  return NextResponse.json(
    { error: ROLE_UNAVAILABLE, detail: ROLE_UNAVAILABLE_DETAIL },
    { status: 503, headers: { "Retry-After": String(ROLE_RETRY_AFTER_S) } },
  );
}

function warnUnavailable(where: string, err: unknown): void {
  console.warn(`[family/role] ${where}: could not read the device's member row`, err instanceof Error ? err.message.slice(0, 160) : "");
}

async function identityOr503(where: string, req: NextRequest, session: RoleScope, store: MembersReader): Promise<Identity | NextResponse> {
  try {
    return await requesterIdentity(req, session, store);
  } catch (err) {
    warnUnavailable(where, err);
    return roleUnavailable();
  }
}

/**
 * 403 when the caller is Wei Ling (she may look, not act for him) or is denied outright; null otherwise. Member rows
 * that cannot be read are 503 role_unavailable (fail closed, and the same error the proxy gate gives).
 */
export async function denyFamily(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<NextResponse | null> {
  const id = await identityOr503("denyFamily", req, session, store);
  if (id instanceof NextResponse) return id;
  if (isOutsider(id)) return outsiderDenied(id);
  return isFamily(id) ? forbidden("Wei Ling can see what Mr Tan allows; only he can do this.") : null;
}

/** Who may change what his family can see: a device with a row as him (patient) or a judge's own sandbox. */
const MAY_CHANGE_GRANTS = new Set<MemberRole>(["patient", "judge"]);

/** 403 unless the caller's row in this session is his (patient) or the judge's sandbox; 503 when it cannot be read. */
export async function denyNonPatient(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<NextResponse | null> {
  if (isAccountScope(session)) return null; // his own account: the token says it is him
  const id = await identityOr503("denyNonPatient", req, session, store);
  if (id instanceof NextResponse) return id;
  if (isOutsider(id)) return outsiderDenied(id);
  if (id.kind === "member" && MAY_CHANGE_GRANTS.has(id.role)) return null;
  return forbidden("Only Mr Tan changes what his family can see, from his own phone.");
}

/** 403 for a device denied outright (family outside its session, a stranger); null otherwise; 503 when unreadable. */
export async function denyOutsider(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<NextResponse | null> {
  const id = await identityOr503("denyOutsider", req, session, store);
  if (id instanceof NextResponse) return id;
  return isOutsider(id) ? outsiderDenied(id) : null;
}

/**
 * The caller of a route about the session itself (GET /api/session, POST /api/session/reset): Wei Ling's phone gets
 * 403 patient_only (the session's members and its reset are his side's), a device denied outright 403 as usual, rows
 * that cannot be read 503. Otherwise the caller's identity, so GET /api/session can give a request with no device at
 * all the session row alone.
 */
export async function sessionCaller(req: NextRequest, session: RoleScope, store: MembersReader = demoMembers()): Promise<Identity | NextResponse> {
  const id = await identityOr503("sessionCaller", req, session, store);
  if (id instanceof NextResponse) return id;
  if (isOutsider(id)) return outsiderDenied(id);
  if (isFamily(id)) return forbidden("Wei Ling's phone opens what Mr Tan shares on /f; the session itself is his side's.");
  return id;
}

/** The device's identity on a page: the page session is its rp_session cookie. */
export async function pageIdentity(ctx: PageRoleContext, store: MembersReader = demoMembers()): Promise<Identity> {
  if (isAccountScope(ctx.session)) return { kind: "none" };
  return resolveIdentity({ sessionId: ctx.session.id, cookieSession: ctx.session.id, memberId: ctx.memberId, cookieRole: ctx.role }, directoryFor(store));
}

/** The role the device acts with on a page: "family" for her phone and for a denied device; null: no role. */
export async function pageRole(ctx: PageRoleContext, store: MembersReader = demoMembers()): Promise<MemberRole | null> {
  return actingRole(await pageIdentity(ctx, store));
}

/**
 * A device that is not his, on one of his pages: Wei Ling's phone goes to /f, a stranger to /join, before anything is
 * rendered (throws NEXT_REDIRECT).
 */
export async function sendFamilyToF(ctx: PageRoleContext, store: MembersReader = demoMembers()): Promise<void> {
  const id = await pageIdentity(ctx, store);
  if (id.kind === "stranger") redirect(STRANGER_HOME);
  if (isFamily(id) || id.kind === "family_elsewhere") redirect(FAMILY_HOME);
}
