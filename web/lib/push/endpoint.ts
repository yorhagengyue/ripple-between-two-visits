/**
 * Which push endpoints this server will send to, and which subscription keys it accepts (C2 track I). Server-only.
 *
 * A subscription's endpoint comes from the browser, so it is untrusted: the server would POST to whatever URL a phone
 * claims. Only the browsers' own push services are allowed (https, these hosts), so a crafted subscription cannot make
 * the server call into this machine or the private network:
 *
 *   fcm.googleapis.com, android.googleapis.com     Chrome, Edge on Android, Samsung Internet, Opera
 *   *.push.services.mozilla.com                    Firefox
 *   *.notify.windows.com                           Edge on Windows
 *   *.push.apple.com                               Safari, and web apps on the iPhone home screen
 *   PUSH_ALLOWED_HOSTS                             more hosts, comma-separated ("push.example.com" exact, ".example.com"
 *                                                  any subdomain), for a push service not listed here
 * With the developer tools on, http(s)://localhost, 127.0.0.1 and [::1] (any port) are allowed too: the tests and the
 * journey recordings stand up a local push service there. Never redirects: the sender does not follow them.
 */
import { b64u, isP256PublicKey } from "./crypto";

const PUSH_SERVICES: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const MAX_ENDPOINT_LENGTH = 2048;

export type EndpointCheck = { ok: true; url: URL } | { ok: false; error: "endpoint_invalid" | "endpoint_not_allowed" };

function extraHosts(env: Record<string, string | undefined>): string[] {
  return (env.PUSH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h));
}

/** Is `raw` an endpoint this server may send to? `devTools`: allow the local push service of the tests. */
export function checkEndpoint(raw: string, opts: { devTools: boolean; env?: Record<string, string | undefined> }): EndpointCheck {
  if (typeof raw !== "string" || !raw || raw.length > MAX_ENDPOINT_LENGTH) return { ok: false, error: "endpoint_invalid" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "endpoint_invalid" };
  }
  if (url.username || url.password || url.hash) return { ok: false, error: "endpoint_invalid" };
  const host = url.hostname.toLowerCase();
  if (opts.devTools && LOCAL_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) return { ok: true, url };
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return { ok: false, error: "endpoint_not_allowed" };
  if (PUSH_SERVICES.some((re) => re.test(host))) return { ok: true, url };
  const extra = extraHosts(opts.env ?? process.env);
  if (extra.some((h) => (h.startsWith(".") ? host.endsWith(h) && host.length > h.length : host === h))) return { ok: true, url };
  return { ok: false, error: "endpoint_not_allowed" };
}

/** Are these a browser's subscription keys (p256dh: a P-256 public key, uncompressed; auth: 16 bytes)? */
export function checkKeys(keys: { p256dh?: unknown; auth?: unknown } | null | undefined): keys is { p256dh: string; auth: string } {
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return false;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth)) return false;
  return isP256PublicKey(b64u.decode(keys.p256dh)) && b64u.decode(keys.auth).length === 16;
}
