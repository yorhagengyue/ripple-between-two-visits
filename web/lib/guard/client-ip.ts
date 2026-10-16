/**
 * The client's address for the per-IP limits (C2 track L; docs/plan/real-app.md 3.5, line 523; docs/plan/hosting.md 4,
 * 5.3 item 6, 5.9). Server-only.
 *
 * Who is in front of the app decides which header can be believed, so the rule is configured, and with nothing
 * configured nothing a client sends is believed:
 *
 *   1. the edge's header      EdgeOne adds EO-Connecting-IP (the browser's address). It is taken only when the request
 *                             really came through the origin lock: EDGE_SECRET is set (32+ characters) and the request
 *                             carries it in X-Ripple-Edge, the header the EdgeOne rule sets and Caddy checks. A request
 *                             that reached the server another way (the emergency site that skips EdgeOne, a server
 *                             without the lock) can write that header itself, so there it is ignored.
 *   2. our own proxy's view   TRUSTED_PROXY_HOPS = how many reverse proxies of ours sit directly in front (Caddy: 1).
 *                             Each appends the address it saw to X-Forwarded-For, so the entry that many places from
 *                             the right is the address our outermost proxy saw; everything left of it came from
 *                             outside and is never read. (Caddy's default replaces whatever the client sent.) When the
 *                             server knows who connected (3) and it is a public address, the request did not come
 *                             through our proxy at all (the app's port reached directly): the header is not read.
 *   3. what the server saw    the socket's own address (lib/guard/peer.ts stamps it on every request; Next.js itself
 *                             gives a route none, and the X-Forwarded-For it fills in cannot be told from a forged
 *                             one). This is the default (TRUSTED_PROXY_HOPS unset or 0): next dev, the recording build,
 *                             a laptop, a server reached directly.
 *   4. otherwise              "local", one bucket for everyone: where the stamp is not installed (unit tests call the
 *                             handlers directly). Nobody can pick a fresh bucket by sending a header.
 *
 * A deployment (RIPPLE_DEPLOYED=1) must say which it is: lib/guard/boot.ts refuses to start one without
 * TRUSTED_PROXY_HOPS, because behind Caddy the socket's address is Caddy's for every visitor.
 *
 *   EDGE_SECRET              the origin lock's value (the same string EdgeOne sends and Caddy checks); empty = never
 *                            believe the edge's header
 *   EDGE_SECRET_HEADER       the header that carries it; empty = x-ripple-edge
 *   EDGE_CLIENT_IP_HEADER    the edge's client-address header; empty = eo-connecting-ip (hosting.md: 头名待核实)
 *   TRUSTED_PROXY_HOPS       0 (default) to 8
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { peerAddress } from "./peer";

export type Env = Record<string, string | undefined>;

export interface HeaderLike {
  get(name: string): string | null;
}

/** The address when no header may be believed. */
export const UNKNOWN_ADDRESS = "local";
/** An origin lock shorter than this is not a secret (hosting.md 5.3: 32 bytes or more). */
export const MIN_EDGE_SECRET = 32;
export const DEFAULT_EDGE_SECRET_HEADER = "x-ripple-edge";
export const DEFAULT_EDGE_CLIENT_IP_HEADER = "eo-connecting-ip";
const MAX_HOPS = 8;

const val = (env: Env, name: string) => (env[name] ?? "").trim();

/** One address as a header gives it: a bare IPv4 or IPv6 address ("[::1]" and "::ffff:1.2.3.4" tidied), else null. */
export function cleanAddress(raw: string | null | undefined): string | null {
  let v = (raw ?? "").trim().toLowerCase();
  if (!v || v.length > 64) return null;
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) ? v : null;
}

/** Loopback, a private network or link-local: where a reverse proxy of ours connects from; never a visitor's public address. */
export function isInternalAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) return address === "::1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
  return false;
}

/** How many of our own reverse proxies sit directly in front of the app (TRUSTED_PROXY_HOPS; anything else: 0). */
export function trustedProxyHops(env: Env = process.env): number {
  const raw = val(env, "TRUSTED_PROXY_HOPS");
  if (!/^\d{1,2}$/.test(raw)) return 0;
  return Math.min(MAX_HOPS, Number(raw));
}

interface EdgeLock {
  secret: string;
  secretHeader: string;
  ipHeader: string;
}

/** The origin lock as configured, or null (no secret, or one too short to be one). */
function edgeLock(env: Env): EdgeLock | null {
  const secret = val(env, "EDGE_SECRET");
  if (secret.length < MIN_EDGE_SECRET) return null;
  return {
    secret,
    secretHeader: val(env, "EDGE_SECRET_HEADER").toLowerCase() || DEFAULT_EDGE_SECRET_HEADER,
    ipHeader: val(env, "EDGE_CLIENT_IP_HEADER").toLowerCase() || DEFAULT_EDGE_CLIENT_IP_HEADER,
  };
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Did this request come through the origin lock? (the secret compared in constant time; false without a lock) */
export function cameThroughEdge(headers: HeaderLike, env: Env = process.env): boolean {
  const lock = edgeLock(env);
  if (!lock) return false;
  const given = headers.get(lock.secretHeader);
  if (!given) return false;
  return timingSafeEqual(digest(given.trim()), digest(lock.secret));
}

/** The client's address by the rule above; never a value only the client vouches for. */
export function clientAddress(headers: HeaderLike, env: Env = process.env): string {
  const lock = edgeLock(env);
  if (lock && cameThroughEdge(headers, env)) {
    const fromEdge = cleanAddress(headers.get(lock.ipHeader));
    if (fromEdge) return fromEdge;
  }
  const peer = cleanAddress(peerAddress(headers));
  const hops = trustedProxyHops(env);
  // a peer that is a public address connected to the app itself, not through a proxy of ours: its header is its own
  if (hops > 0 && (!peer || isInternalAddress(peer))) {
    const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    const seen = cleanAddress(chain[chain.length - hops]);
    if (seen) return seen;
  }
  return peer ?? UNKNOWN_ADDRESS;
}

/** The rule in force, in one line for the server log (names only, never a value). */
export function clientAddressRule(env: Env = process.env): string {
  const lock = edgeLock(env);
  const hops = trustedProxyHops(env);
  const edge = lock ? `${lock.ipHeader} when ${lock.secretHeader} matches EDGE_SECRET` : "the edge's header is not believed (EDGE_SECRET not set)";
  const proxy = hops > 0 ? `X-Forwarded-For entry ${hops} from the right (when our proxy connected)` : "no forwarded header is believed";
  return `client address: ${edge}; else ${proxy}; else the address the server saw`;
}
