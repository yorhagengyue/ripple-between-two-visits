/**
 * Is a request from another site? (docs/plan/real-app.md 3.4 「跨站和响应头」: 「代理对非 GET 请求核对 Origin（或
 * Sec-Fetch-Site）是本站，不是就 403 bad_origin」; track A.) Used by the proxy for every request that can change something
 * and by the account routes' own guard (lib/auth/http.ts guardPost). Its only import has none itself, so the proxy
 * bundle uses it as is.
 *
 *   Sec-Fetch-Site: cross-site      another site (the browser says so itself)
 *   Sec-Fetch-Site: same-origin     this site: the browser says so itself, and a page cannot set or change this header.
 *     or none                       Nothing else is compared, so a front proxy that rewrites Host needs no
 *                                   RIPPLE_PUBLIC_HOSTS for the browsers that send it ("none": opened by the person,
 *                                   not by a page).
 *   Origin: <another host>          another site; this site's own host is the request's Host, the proxy's
 *                                   X-Forwarded-Host, or one of RIPPLE_PUBLIC_HOSTS (comma-separated host[:port], for
 *                                   a front proxy that rewrites Host without passing the original on)
 *   Origin: null                    another site (a sandboxed frame, a redirect across sites): it is not this site's
 *                                   name. A browser that hides the origin of this site's own write still says
 *                                   Sec-Fetch-Site: same-origin, which is read first.
 *   neither header                  no browser leaves both out on a write, so this is a script. C2 track L: where the
 *                                   developer tools are on (next dev, the tests, the recording build: Playwright's
 *                                   request helpers and the developer scripts send neither) it passes; on a real
 *                                   server it is refused like any write that does not show it comes from this site. A
 *                                   tool that must reach a real deployment names the site in Origin
 *                                   (scripts/preflight.ts does). The cookies are SameSite=Lax as well: this is the
 *                                   second lock, not the only one.
 */
import { devToolsEnabled } from "@/lib/dev/enabled";

type Env = Record<string, string | undefined>;

export interface OriginRequest {
  headers: Headers;
  nextUrl: { host: string };
}

const first = (v: string | null): string | null => {
  const t = (v ?? "").split(",")[0].trim().toLowerCase();
  return t || null;
};

/** This site's own hosts for a request (lower case, with the port when there is one). */
export function ownHosts(req: OriginRequest, env: Env = process.env): string[] {
  const extra = (env.RIPPLE_PUBLIC_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [first(req.headers.get("x-forwarded-host")), first(req.headers.get("host")), req.nextUrl.host.toLowerCase(), ...extra].filter((h): h is string => !!h);
}

/** true when the request says it comes from another site, or (on a real server) does not show where it comes from. */
export function isForeignOrigin(req: OriginRequest, env: Env = process.env): boolean {
  const site = (req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (site === "cross-site") return true;
  // C2 track L: the browser's own word that the page is this site's (or that no page made the request) is enough
  if (site === "same-origin" || site === "none") return false;
  const origin = (req.headers.get("origin") ?? "").trim();
  // C2 track L: neither header is a script (passes only where the developer tools are on); same-site without an
  // Origin, or an Origin of "null", names no site of ours
  if (!origin) return site !== "" || !devToolsEnabled(env);
  if (origin.toLowerCase() === "null") return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  return !ownHosts(req, env).includes(host);
}

/** The methods that never change anything (the check is for every other one). */
export function isReadMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}
