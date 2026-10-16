/**
 * Deny by default for Wei Ling's device (task M6, privacy). Server-only; web/proxy.ts runs it before every page and
 * API request.
 *
 * The family role may use exactly what /f and /join need, listed below with the reason. Everything else is closed
 * to her: another page is a 307 to /f before anything is read, another API (any method) is 403 patient_only before
 * the handler runs, so neither his data nor an action in his name can reach her phone through a route nobody
 * thought about (a route added later is closed to her until it is added here on purpose).
 *
 *   pages  /f (built on the server from his switches, lib/family/view.ts) and /join (joining with the code).
 *   APIs   see FAMILY_API: /f's own reads, her live stream (filtered, lib/family/events.ts), her reminder recording
 *          (the upload link only for kind "reminder"; the route checks author and audio, lib/family/reminders.ts),
 *          joining (only as family: her phone has the code, and must not re-join as Mr Tan, the director or backstage;
 *          the join route's own rules say the same, lib/family/join.ts), and the health check.
 *
 * Who is calling is lib/family/identity.ts, the same function the routes' own checks use (lib/family/role.ts). Three
 * kinds of device are refused outright:
 *   family_elsewhere  her phone naming a session that is not its own (?session= wins over the cookie): 403
 *                     patient_only, allow-list included, the same answer for a real session and a made-up one. The
 *                     allow-list is for her father's session only.
 *   stranger          a device with no row in a session someone joined as family: 403 member_required, pages 307 to
 *                     /join (the only page it may open, with POST /api/session/join: the code is the one way in,
 *                     see STRANGER_API). Her phone with its cookies dropped (a private window, fetch
 *                     with credentials "omit") or forged (rp_session of his, rp_role=patient) is a stranger, not his
 *                     side, so it can neither read his data nor switch on what he keeps from her.
 *   anonymous         a request that names a session nobody joined as family and presents no device at all (no
 *                     rp_session, rp_member or rp_role: a private window, curl with only ?session=): 403
 *                     member_required except ANONYMOUS_API, the routes that read nothing of his (joining with the code,
 *                     opening a sandbox of its own, the session row without its members, the public dataset page, the
 *                     health checks). A judge's sandbox and the crew's filming session carry the device row their
 *                     creation made (POST /api/session sets rp_member), so they are members, never anonymous.
 * A request that names no session at all reads nothing and passes (her phone still gets the allow-list). In a session
 * nobody joined as family a device that presents a cookie (the e2e harness's openDevice: rp_session only) still counts
 * as before M6; that closes with item 7, or once e2e/helpers.ts openDevice joins with the code.
 * Who may join as which role is the join route's own rule (lib/family/join.ts): the gate lets a stranger's or an
 * anonymous device's join through to it, and keeps her phone to "family" itself.
 *
 * Defense in depth: the routes this track owns check the role themselves too (denyFamily in GET /api/notes,
 * GET /api/bp, POST /api/ask, POST /api/clock; denyNonPatient in POST /api/family/grants; reminderAuthorFor in POST
 * /api/reminders; denyOutsider in GET /api/reminders and its audio; familyStreamFor in GET /api/events;
 * sendFamilyToF in app/p/layout.tsx; sessionDenied in GET /api/session and POST /api/session/reset; the join rules
 * in POST /api/session/join; the stranger check in app/f/page.tsx), so a matcher change in proxy.ts does not reopen
 * them. The anonymous rule is the gate's alone: other tracks' route unit tests call handlers with no cookie.
 *
 * Outside the gate on purpose (proxy.ts matcher and OUTSIDE_GATE): Next.js internals and static files (no app
 * data); PUT /api/blob/upload (needs a signed token that only POST /api/upload-url hands out, and carries recordings
 * larger than the 10 MB the proxy would buffer); POST /api/preflight/upload (counts bytes, stores nothing).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sessionIdFromRequest } from "@/lib/session-cookie";
import { MEMBER_COOKIE, ROLE_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";
import { createSupabaseStore, storeKind } from "@/lib/store";
import { isFamily, resolveIdentity, type Identity, type IdentityInput } from "./identity";
import { memberDirectory, membersFrom, ROLE_CACHE_MS, type MemberDirectory, type MembersReader } from "./member-cache";
import { FAMILY_HOME, memberRequired, outsiderDenied, PATIENT_ONLY, ROLE_RETRY_AFTER_S, ROLE_UNAVAILABLE_DETAIL, roleUnavailable, STRANGER_HOME } from "./role";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// ------------------------------------------------------------------ the allow-list

export interface FamilyApiRule {
  method: "GET" | "POST" | "DELETE";
  /** the route as written under app/ ("/api/reminders/[id]/audio") */
  route: string;
  why: string;
  /** a rule that also looks at the JSON body (the proxy reads a copy; the handler still gets the body) */
  body?: (body: unknown) => boolean;
}

/** Every API the family role may call. Anything not here: 403 patient_only. */
export const FAMILY_API: readonly FamilyApiRule[] = [
  { method: "GET", route: "/api/family/view", why: "/f itself: only the sections he switched on, trimmed on the server (lib/family/view.ts)" },
  { method: "GET", route: "/api/family/alerts", why: "the 'no reply after two reminders' card, empty while he has it off" },
  { method: "GET", route: "/api/events", why: "the live stream, filtered for her: switches, the session row and content-free hints (lib/family/events.ts)" },
  { method: "GET", route: "/api/reminders", why: "her own reminder recordings and today's reminder times" },
  { method: "POST", route: "/api/reminders", why: "registering her recording (the route checks who recorded it and that the WAV is there, lib/family/reminders.ts)" },
  { method: "GET", route: "/api/reminders/[id]/audio", why: "playing a reminder recording back (hers, or the labelled stand-in)" },
  // C2 track E (real-app 12 「她录的提醒存完听不回、删不掉」): the demo's /f lists her recordings with 「删掉这段」
  {
    method: "DELETE",
    route: "/api/demo/reminders/[id]",
    why: "deleting one of her own reminder recordings in this copy (the route checks who asks and that the clip is one she recorded; the story's own clip stays)",
  },
  {
    method: "POST",
    route: "/api/upload-url",
    why: "the signed upload link for her reminder recording; kind \"reminder\" only (visit audio and bag photos are his)",
    body: (b) => isObj(b) && b.kind === "reminder",
  },
  {
    method: "POST",
    route: "/api/session/join",
    why: "joining with the code, as family only: a phone already known as hers must not re-join as Mr Tan, the director or backstage (the join route's own rules, lib/family/join.ts, say the same)",
    body: (b) => isObj(b) && b.role === "family",
  },
  { method: "GET", route: "/api/health", why: "deployment health check: no session data" },
];

/**
 * Every API a request with no device at all may call about a session nobody joined as family (identity "anonymous").
 * Anything else: 403 member_required. None of these reads his data: the session row GET /api/session gives such a
 * caller has no member list (the member ids are the devices' credentials) and holds nothing of his health.
 */
export const ANONYMOUS_API: readonly { method: "GET" | "POST"; route: string; why: string }[] = [
  { method: "POST", route: "/api/session/join", why: "joining with the code is the way in (the route decides which role, lib/family/join.ts)" },
  { method: "POST", route: "/api/session", why: "opening a sandbox of its own: a new session, nothing of this one" },
  { method: "GET", route: "/api/session", why: "the session row (story day, code), without its members; the landing test and the preflight script read it" },
  { method: "GET", route: "/api/real", why: "the public dataset page and whether this session may run it; nothing of his" },
  { method: "GET", route: "/api/health", why: "deployment health check: no session data" },
  { method: "GET", route: "/api/asr/health", why: "the speech service's health: no session data" },
];

const ANONYMOUS_RULES = ANONYMOUS_API.map((r) => ({ ...r, re: routeRegex(r.route) }));

/** May a request with no device at all make this call (about a session nobody joined as family)? Pure. */
export function anonymousAllowed(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  return ANONYMOUS_RULES.some((r) => r.method === m && r.re.test(pathname));
}

/** Every page the family role may open. Anything else: 307 to /f. */
export const FAMILY_PAGES: readonly { route: string; why: string }[] = [
  { route: FAMILY_HOME, why: "her page: only what he switched on (lib/family/view.ts)" },
  { route: "/join", why: "joining with the code" },
];

/** Paths the gate does not look at, and why (proxy.ts keeps these out of its matcher or passes them first). */
export const OUTSIDE_GATE: readonly { prefix: string; why: string }[] = [
  { prefix: "/_next/", why: "Next.js build output, image optimiser and dev tooling: no app data" },
  { prefix: "/__nextjs", why: "Next.js dev overlay endpoints: no app data" },
  { prefix: "/favicon.ico", why: "static icon" },
  { prefix: "/worklets/", why: "public audio worklet her WAV recorder loads (web/public/worklets)" },
  { prefix: "/api/blob/upload", why: "PUT with a signed token only POST /api/upload-url hands out; bodies over the proxy's 10 MB buffer" },
  { prefix: "/api/preflight/upload", why: "deployment check: counts bytes, stores nothing; bodies over the proxy's 10 MB buffer" },
];

export function outsideGate(pathname: string): boolean {
  return OUTSIDE_GATE.some((o) => pathname === o.prefix || pathname.startsWith(o.prefix));
}

/** "/api/reminders/[id]/audio" -> a regex for one concrete path segment per [param]. */
function routeRegex(route: string): RegExp {
  const parts = route.split("/").map((seg) => (/^\[[^\]/]+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp(`^${parts.join("/")}/?$`);
}

const API_RULES = FAMILY_API.map((r) => ({ ...r, re: routeRegex(r.route) }));

export type FamilyAccess = { kind: "allow"; rule?: FamilyApiRule } | { kind: "deny" } | { kind: "redirect"; to: string } | { kind: "needs_body"; rule: FamilyApiRule };

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function pagePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * What the family role may do with this request. Pure. `body` is the parsed JSON body when a rule asked for it
 * (undefined: not read yet -> needs_body; anything unparsable is passed as null and fails the rule).
 */
export function familyAccess(method: string, pathname: string, body?: unknown): FamilyAccess {
  const m = method.toUpperCase();
  if (isApiPath(pathname)) {
    const rule = API_RULES.find((r) => r.method === m && r.re.test(pathname));
    if (!rule) return { kind: "deny" };
    if (!rule.body) return { kind: "allow", rule };
    if (body === undefined) return { kind: "needs_body", rule };
    return rule.body(body) ? { kind: "allow", rule } : { kind: "deny" };
  }
  if (FAMILY_PAGES.some((p) => p.route === pagePath(pathname))) return { kind: "allow" };
  return { kind: "redirect", to: FAMILY_HOME };
}

// ------------------------------------------------------------------ who is calling

/** The parts of a request the identity needs (a NextRequest, or a test's stand-in). */
export interface GateRequest {
  method: string;
  nextUrl: URL;
  cookies: { get(name: string): { value: string } | undefined };
}

/** What the device presents for this request: an API names its session with ?session= or the cookie, a page with the cookie. */
export function gateInput(req: GateRequest): IdentityInput {
  const cookieSession = req.cookies.get(SESSION_COOKIE)?.value?.trim() || null;
  return {
    sessionId: isApiPath(req.nextUrl.pathname) ? sessionIdFromRequest(req) : cookieSession,
    cookieSession,
    memberId: req.cookies.get(MEMBER_COOKIE)?.value?.trim() || null,
    cookieRole: req.cookies.get(ROLE_COOKIE)?.value?.trim() || null,
  };
}

/** The device's identity for this request (lib/family/identity.ts). Throws when the member rows cannot be read. */
export async function gateIdentity(req: GateRequest, dir: MemberDirectory): Promise<Identity> {
  return resolveIdentity(gateInput(req), dir);
}

/** Can this request need the gate at all? Not when it names no session and does not say it is family: no read. */
export function namesAnything(req: GateRequest): boolean {
  const input = gateInput(req);
  return !!input.sessionId || input.cookieRole === "family";
}

// ------------------------------------------------------------------ member rows for the proxy

/**
 * The proxy is bundled apart from the route handlers, so it must not build the app's process-wide store: a store it
 * built would throw its own StoreError class into the routes' `instanceof` checks. In memory mode it reads the
 * instance the routes already keep on globalThis (lib/store/memory.ts getMemoryStore; none yet = no session yet);
 * with STORE=supabase it keeps its own read-only adapter and remembers found rows (and "family is here") for
 * ROLE_CACHE_MS, so her phone's and his phone's requests do not each pay a round trip to the database.
 */
export const MEMORY_STORE_GLOBAL = "__rippleMemoryStore";

let supabaseDirectory: MemberDirectory | null = null;

/** The member directory web/proxy.ts uses for the current STORE. */
export function proxyDirectory(env: Record<string, string | undefined> = process.env): MemberDirectory {
  let kind: "memory" | "supabase";
  try {
    kind = storeKind(env);
  } catch {
    kind = "memory"; // an unknown STORE fails in every route; here it only means "no store to ask"
  }
  if (kind === "memory") {
    return memberDirectory(membersFrom(() => ((globalThis as Record<string, unknown>)[MEMORY_STORE_GLOBAL] as MembersReader | undefined) ?? null));
  }
  if (!supabaseDirectory) {
    let reader: MembersReader | null = null;
    supabaseDirectory = memberDirectory(
      membersFrom(() => {
        try {
          reader ??= createSupabaseStore();
        } catch {
          return null; // not configured: every route answers 503 not_configured itself
        }
        return reader;
      }),
      ROLE_CACHE_MS,
    );
  }
  return supabaseDirectory;
}

// ------------------------------------------------------------------ the gate

const DENIED_DETAIL = "Wei Ling's phone can open what Mr Tan shares on /f; only he can use this.";

export function familyDenied(): NextResponse {
  return NextResponse.json({ error: PATIENT_ONLY, detail: DENIED_DETAIL }, { status: 403 });
}

async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.clone().text();
    return text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** The one API a stranger may call: joining with the code (POST /api/session/join), the way to stop being one. */
export const STRANGER_API = routeRegex("/api/session/join");

function redirectTo(req: NextRequest, to: string): NextResponse {
  return NextResponse.redirect(new URL(to, req.nextUrl), 307);
}

/**
 * The gate itself (web/proxy.ts). null: let the request through unchanged; otherwise the answer for this device.
 * Member rows that cannot be read are 503 role_unavailable (never "pass and hope").
 */
export async function familyGate(req: NextRequest, dir: MemberDirectory = proxyDirectory()): Promise<NextResponse | null> {
  const pathname = req.nextUrl.pathname;
  if (outsideGate(pathname) || !namesAnything(req)) return null;
  const api = isApiPath(pathname);
  let id: Identity;
  try {
    id = await gateIdentity(req, dir);
  } catch (err) {
    console.warn("[family/gate] could not read the device's member row", err instanceof Error ? err.message.slice(0, 160) : "");
    return api
      ? roleUnavailable()
      : new NextResponse(ROLE_UNAVAILABLE_DETAIL, {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(ROLE_RETRY_AFTER_S) },
        });
  }
  if (id.kind === "stranger") {
    // joining with the code is the one way in, so /join and its API stay open (the join route decides the role)
    if (api) return req.method === "POST" && STRANGER_API.test(pathname) ? null : outsiderDenied(id);
    return pagePath(pathname) === STRANGER_HOME ? null : redirectTo(req, STRANGER_HOME);
  }
  if (id.kind === "family_elsewhere") return api ? outsiderDenied(id) : redirectTo(req, FAMILY_HOME);
  // no device at all (only an API can name a session without a cookie): nothing of his, only ANONYMOUS_API
  if (id.kind === "anonymous") return !api || anonymousAllowed(req.method, pathname) ? null : memberRequired();
  if (!isFamily(id)) return null;
  let access = familyAccess(req.method, pathname);
  if (access.kind === "needs_body") access = familyAccess(req.method, pathname, await readJson(req));
  if (access.kind === "allow") return null;
  if (access.kind === "redirect") return redirectTo(req, access.to);
  return familyDenied();
}
