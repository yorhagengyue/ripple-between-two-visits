/**
 * The response headers of real-app 3.4 (lines 513-519) for the paths web/proxy.ts never sees (C2 track L). No imports:
 * next.config.ts loads this file by a relative path, and the proxy takes the list from here, so there is one list.
 *
 * Track A's proxy puts the four fixed headers on every answer it handles. Its matcher leaves some paths out (the two
 * upload routes, whose bodies can exceed what the proxy buffers; Next's own files; the favicon; the audio worklets),
 * and those answers had none of them: two routes without nosniff and frame-ancestors, and every script the app serves
 * without nosniff. next.config.ts headers() adds them for exactly those paths (OUTSIDE_PROXY). The two upload routes
 * are a signed-in person's, so they also get Cache-Control: private, no-store there; the static files keep Next's own
 * caching (a Cache-Control rule on /_next/static would replace its one-year immutable).
 * HSTS is the edge's (hosting.md 5.3 item 3), not set here.
 */

/** The response headers every answer carries (real-app 3.4), as [name, value]. */
export const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["Content-Security-Policy", "frame-ancestors 'self'"],
  ["Referrer-Policy", "no-referrer"],
  ["Permissions-Policy", "microphone=(self), camera=(self)"],
  ["X-Content-Type-Options", "nosniff"],
];

export interface OutsideProxy {
  /** the piece of the proxy's matcher that leaves the path out */
  matcherPart: string;
  /** the same paths as a next.config.ts header source */
  source: string;
  /** a signed-in person's route: its answers are never kept */
  noStore: boolean;
}

/** What the proxy's matcher leaves out that the app itself serves. (`__nextjs` is the dev server's own overlay.) */
export const OUTSIDE_PROXY: readonly OutsideProxy[] = [
  { matcherPart: "_next/", source: "/_next/:path*", noStore: false },
  { matcherPart: "favicon\\.ico", source: "/favicon.ico", noStore: false },
  { matcherPart: "worklets/", source: "/worklets/:path*", noStore: false },
  { matcherPart: "api/blob/upload", source: "/api/blob/upload", noStore: true },
  { matcherPart: "api/preflight/upload", source: "/api/preflight/upload", noStore: true },
];

export const NO_STORE = "private, no-store";

/** next.config.ts headers(): the fixed headers (and no-store where it applies) on the paths the proxy never sees. */
export function outsideProxyHeaderRules(): { source: string; headers: { key: string; value: string }[] }[] {
  return OUTSIDE_PROXY.map((p) => ({
    source: p.source,
    headers: [...SECURITY_HEADERS.map(([key, value]) => ({ key, value })), ...(p.noStore ? [{ key: "Cache-Control", value: NO_STORE }] : [])],
  }));
}
