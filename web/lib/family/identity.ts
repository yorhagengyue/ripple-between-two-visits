/**
 * Whose device is this, for one request about one session (task M6, privacy). Server-only, no Next imports: the proxy
 * gate (lib/family/gate.ts), the routes' own checks and the pages (lib/family/role.ts) all call resolveIdentity, so the
 * two layers cannot drift apart.
 *
 * Inputs are what the device presents: the session the request is about (an API's ?session= or rp_session cookie; a
 * page's rp_session cookie), its own rp_session cookie, its rp_member cookie (httpOnly, the id of the session_member
 * row /join or POST /api/session made for it) and its rp_role cookie (readable by the page, so never trusted on its own
 * once it matters, see 3).
 *
 *   1 member            the device's row in this session decides (a forged rp_role cannot override it).
 *   2 family_elsewhere  a family device (its row in its own rp_session session is family, or rp_role=family) naming a
 *                       session that is not its own: denied outright, allow-list included. Her phone is family in her
 *                       father's session only; naming another session (made up, or someone else's real one) gets her
 *                       nothing, and dropping to "no role" is not possible either.
 *   3 stranger          no row in a session that someone has joined as family: denied (API 403 member_required, page
 *                       307 to /join). Once Wei Ling is in his session, every request about it must come from a device
 *                       with a row in it, so her phone with its cookies dropped (a private window, fetch with
 *                       credentials "omit"), or with a forged rp_session / rp_role=patient, is nobody, not his side.
 *   4 anonymous         a session nobody joined as family, named by a request that presents no device at all (no
 *                       rp_session, rp_member or rp_role cookie: a private window, fetch with credentials "omit",
 *                       curl with only ?session=). The proxy gate gives it nothing of his: 403 member_required except
 *                       joining with the code and the few routes that read nothing of his (lib/family/gate.ts
 *                       ANONYMOUS_API; GET /api/session answers it the session row without its members). The routes'
 *                       own checks treat it like "none" (other tracks' route tests call handlers that way); the rule
 *                       lives in the gate, which runs before every route.
 *   5 cookie            a session nobody joined as family (the e2e harness's phones, scripts): rp_role counts when the
 *                       device's rp_session is this session (or absent), as before M6.
 *   6 none              the same sessions, a device cookie but no role (the e2e harness's openDevice sends only
 *                       rp_session; its `request` may carry another session's cookies): treated as his side, as every
 *                       route was before M6. Changing what his family can see needs a row (lib/family/role.ts
 *                       denyNonPatient), so even here "none" cannot open her view. Left for item 7: it holds while
 *                       e2e/helpers.ts openDevice gives a phone only rp_session instead of joining with the code.
 *
 * Item 7 (accounts and JWT sessions) replaces the cookies with a verified identity; until then the member id is the
 * device's credential: random, httpOnly, never sent to her (lib/family/events.ts strips member rows from her stream)
 * and never listed by GET /api/session (it answers the members' roles only).
 */
import type { MemberRole } from "@/lib/store/types";
import type { MemberDirectory } from "./member-cache";

export type Identity =
  | { kind: "member"; role: MemberRole }
  | { kind: "cookie"; role: MemberRole }
  | { kind: "none" }
  | { kind: "anonymous" }
  | { kind: "family_elsewhere" }
  | { kind: "stranger" };

export interface IdentityInput {
  /** the session the request is about; null: none (no ?session=, no rp_session) */
  sessionId: string | null;
  /** rp_session cookie */
  cookieSession: string | null;
  /** rp_member cookie */
  memberId: string | null;
  /** rp_role cookie */
  cookieRole: string | null;
}

const ROLES: readonly MemberRole[] = ["patient", "family", "backstage", "director", "judge"];
export const isRole = (x: unknown): x is MemberRole => typeof x === "string" && (ROLES as readonly string[]).includes(x);

const clean = (x: string | null | undefined): string | null => {
  const v = x?.trim();
  return v ? v : null;
};

/** The device's identity for a request about `sessionId`. Throws when the member rows cannot be read. */
export async function resolveIdentity(input: IdentityInput, dir: MemberDirectory): Promise<Identity> {
  const sessionId = clean(input.sessionId);
  const cookieSession = clean(input.cookieSession);
  const memberId = clean(input.memberId);
  const cookieRole = clean(input.cookieRole);
  if (!sessionId) {
    // nothing of anyone's is named: her phone stays family (the allow-list still applies), anyone else is nobody
    return cookieRole === "family" ? { kind: "cookie", role: "family" } : { kind: "none" };
  }
  if (memberId) {
    const role = await dir.role(sessionId, memberId);
    if (role) return { kind: "member", role };
  }
  if (cookieSession !== sessionId) {
    if (cookieRole === "family") return { kind: "family_elsewhere" };
    if (memberId && cookieSession && (await dir.role(cookieSession, memberId)) === "family") return { kind: "family_elsewhere" };
  }
  if (await dir.hasFamily(sessionId)) return { kind: "stranger" };
  if (!cookieSession && !memberId && !cookieRole) return { kind: "anonymous" };
  if (isRole(cookieRole) && (!cookieSession || cookieSession === sessionId)) return { kind: "cookie", role: cookieRole };
  return { kind: "none" };
}

/**
 * The role an identity acts with in the routes; "family" for both kinds of denial (the least a device can be).
 * null: no role ("none", and "anonymous", which the gate has already refused for everything of his).
 */
export function actingRole(id: Identity): MemberRole | null {
  switch (id.kind) {
    case "member":
    case "cookie":
      return id.role;
    case "none":
    case "anonymous":
      return null;
    case "family_elsewhere":
    case "stranger":
      return "family";
  }
}

/** Denied outright, whatever the route: a family device outside its own session, or a stranger in a family session. */
export function isOutsider(id: Identity): id is { kind: "family_elsewhere" } | { kind: "stranger" } {
  return id.kind === "family_elsewhere" || id.kind === "stranger";
}

/** Wei Ling's device in her own session (her row, or rp_role=family in a session nobody joined as family). */
export function isFamily(id: Identity): boolean {
  return (id.kind === "member" || id.kind === "cookie") && id.role === "family";
}
