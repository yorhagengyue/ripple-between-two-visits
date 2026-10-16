/**
 * What a data route's body may be (C2 track L; docs/plan/real-app.md 3.4 跨站和响应头, line 512:
 * 「改数据的接口只收 application/json」). Server-only; no store. (Where a write comes from is track A's
 * lib/auth/origin.ts; web/proxy.ts runs that first, then this.)
 *
 * A request to /api/** that is not GET, HEAD or OPTIONS carries JSON, or no body at all (several POSTs and DELETEs
 * carry none). Anything else is 415 invalid_body, the answer lib/auth/http.ts guardPost gives for the account routes;
 * now every data route gives it, before its handler runs. The routes that take bytes by design are listed in
 * BYTE_ROUTES and check their own type; a test scans app/api (each route file and the lib files it imports) so the
 * list stays exactly the routes that read bytes.
 *
 * Adding a route that takes bytes (an upload in parts, another microphone):
 *   1. one row in BYTE_ROUTES: its method, its path written as its folder under app (a dynamic segment as [name]),
 *      what the route itself insists on, and why. Without the row the proxy answers 415 before the route runs, and
 *      tests/unit/guard/request.test.ts fails naming the route.
 *   2. only if its body can be larger than the proxy buffers (10 MB): leave it out of the matcher in web/proxy.ts,
 *      add it to OUTSIDE_PROXY in lib/guard/headers.ts (response headers, no-store) and call guardOutsideProxy(req)
 *      first thing in the route (the origin check the proxy would have done).
 *
 * guardOutsideProxy is for the two byte routes the proxy's matcher leaves out (their bodies can exceed what it
 * buffers): nothing checked where their writes come from, so they run track A's origin check themselves.
 */
import { NextResponse } from "next/server";
import { isForeignOrigin, isReadMethod } from "@/lib/auth/origin";

export interface ByteRoute {
  method: string;
  path: string;
  /** what the route itself insists on */
  takes: string;
  why: string;
}

/** The routes that take bytes instead of JSON, each by design. Nothing else under /api does. */
export const BYTE_ROUTES: readonly ByteRoute[] = [
  { method: "POST", path: "/api/asr/chunk", takes: "audio/wav (16 kHz mono 16-bit PCM, at most 1 MiB)", why: "a piece of the visit's audio for the live captions" },
  { method: "POST", path: "/api/ask/transcribe", takes: "audio/wav (16 kHz mono 16-bit PCM, at most 1 MiB)", why: "his spoken question, turned into words for him to check (track S)" },
  { method: "PUT", path: "/api/blob/upload", takes: "the type signed into the upload token (audio/wav, image/png, image/jpeg, image/webp)", why: "the local blob driver's upload link: a recording, her reminder, a label photo" },
  { method: "POST", path: "/api/preflight/upload", takes: "any bytes, counted and thrown away", why: "the deployment check that a 4 MB body gets through the host" },
];

/** Does a request path match a route path written as its folder under app ("[id]" stands for any one segment)? */
export function matchesRoutePath(routePath: string, pathname: string): boolean {
  const want = routePath.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return false;
  return want.every((seg, i) => (/^\[[^\]]+\]$/.test(seg) ? got[i] !== "" : seg === got[i]));
}

export function isByteRoute(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  return BYTE_ROUTES.some((r) => r.method === m && matchesRoutePath(r.path, pathname));
}

/** Is this body one a data route takes: JSON, or nothing at all? */
export function jsonOrEmpty(headers: { get(name: string): string | null }): boolean {
  const type = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type) return type === "application/json";
  const length = (headers.get("content-length") ?? "").trim();
  return (length === "" || length === "0") && !headers.get("transfer-encoding");
}

/** What the body rule reads of a request. */
export interface BodyRequest {
  method: string;
  headers: { get(name: string): string | null };
  nextUrl: { pathname: string };
}

/** null when the request's body is one its route takes, else 415 invalid_body. */
export function guardBody(req: BodyRequest): NextResponse | null {
  if (isReadMethod(req.method)) return null;
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/") || isByteRoute(req.method, path) || jsonOrEmpty(req.headers)) return null;
  return NextResponse.json({ error: "invalid_body" }, { status: 415 });
}

/**
 * For a route the proxy never sees (web/proxy.ts config.matcher): the proxy's origin check, run by the route itself.
 * null when the write may go on, else 403 bad_origin.
 */
export function guardOutsideProxy(req: Request): NextResponse | null {
  if (isReadMethod(req.method)) return null;
  if (!isForeignOrigin({ headers: req.headers, nextUrl: new URL(req.url) })) return null;
  return NextResponse.json({ error: "bad_origin" }, { status: 403 });
}
