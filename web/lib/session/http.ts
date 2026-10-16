/**
 * Helpers for route handlers: JSON errors, zod body parsing, store errors as HTTP, and the demo session cookies.
 * Which scope a request is for is lib/subject (requireSubject). Server-only (no `import "server-only"`: that package is
 * not installed for vitest).
 */
import { NextResponse } from "next/server";
import type { z } from "zod";
import { ScopeViolation } from "@/lib/subject/scoped-store";
import { isStoreUnavailable, storeUnavailableResponse, warnStoreUnavailable } from "@/lib/subject/unavailable";
import { StoreError, type SessionMemberRow, type SessionRow } from "@/lib/store";
import { nowMs } from "@/lib/time/now";
import { FILMING_COOKIE_DAYS, MEMBER_COOKIE, ROLE_COOKIE, SESSION_COOKIE } from "./cookies";

export function jsonError(status: number, error: string, detail?: unknown): NextResponse {
  return NextResponse.json(detail === undefined ? { error } : { error, detail }, { status });
}

/** Parse and validate a JSON body. An empty body counts as `{}`. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: NextResponse }> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, res: jsonError(400, "invalid_json") };
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: jsonError(400, "invalid_body", parsed.error.issues) };
  return { ok: true, data: parsed.data };
}

/**
 * Map store errors to HTTP; rethrow anything else. An account asking for a demo-only operation (account_scope) is a 404
 * like any route that does not exist for it; a taken key (conflict) is a 409. A ScopeViolation (a route asking its
 * scoped store for another scope) is never answered here: it is a bug, and surfaces as a 500.
 * C2 track A (only add): a store or identity provider that cannot be read (no response, a timeout, a 5xx) is 503
 * store_unavailable with Retry-After (real-app 2.25: refused, never let through, never an unhandled 500).
 */
export function storeErrorResponse(err: unknown): NextResponse {
  if (err instanceof ScopeViolation) throw err;
  if (isStoreUnavailable(err)) {
    warnStoreUnavailable("a route", err);
    return storeUnavailableResponse();
  }
  if (err instanceof StoreError) {
    if (err.code === "account_scope") return jsonError(404, "not_found");
    const status = err.code === "invalid" ? 400 : err.code === "not_configured" ? 503 : err.code === "conflict" ? 409 : 404;
    return jsonError(status, err.code, err.message);
  }
  throw err;
}

/**
 * Set rp_session (and rp_member / rp_role when a member row is given) on a response.
 *
 * C2 track E (fix round of 10-11): the cookies live as long as the copy has left on the app's clock (lib/time/now.ts),
 * the clock its expires_at was made with (the store's own now). On a real server that is the machine's clock, as before.
 * Where the developer test clock is set it is not: a journey had left it frozen at 2026-09-01, the next judge's copy
 * expired "2026-09-03", which measured against the machine's Date.now() was weeks ago, so the lifetime fell to the 60 s
 * floor. A minute into /demo the browser dropped the three cookies and the phone's next ask was refused (403
 * member_required): journey 22's own-question step on the real stack.
 */
export function setSessionCookies(res: NextResponse, session: SessionRow, member?: SessionMemberRow): void {
  const maxAge = session.expires_at
    ? Math.max(60, Math.floor((Date.parse(session.expires_at) - nowMs()) / 1000))
    : FILMING_COOKIE_DAYS * 24 * 3600;
  const base = { path: "/", sameSite: "lax" as const, maxAge, httpOnly: true };
  res.cookies.set(SESSION_COOKIE, session.id, base);
  if (member) {
    res.cookies.set(MEMBER_COOKIE, member.id, base);
    res.cookies.set(ROLE_COOKIE, member.role, { ...base, httpOnly: false });
  }
}
