/**
 * Which session a request belongs to: `?session=<id>` (explicit: judge landing iframe, tests,
 * a shared filming link) or the cookie `rp_session`. The query parameter wins when both are present.
 */
export const SESSION_COOKIE = "rp_session";
export const SESSION_QUERY = "session";

export interface RequestLike {
  cookies: { get(name: string): { value: string } | undefined };
  nextUrl: URL;
}

export function sessionIdFromRequest(req: RequestLike): string | null {
  const fromQuery = req.nextUrl.searchParams.get(SESSION_QUERY)?.trim();
  if (fromQuery) return fromQuery;
  const fromCookie = req.cookies.get(SESSION_COOKIE)?.value?.trim();
  return fromCookie || null;
}
