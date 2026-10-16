/**
 * The address the server itself saw (C2 track L; docs/plan/real-app.md 3.5, line 523). Server-only, Node.js only.
 *
 * Next.js gives a proxy or a route no socket address: its only trace is X-Forwarded-For, which Next fills in when the
 * client sent none and leaves alone when the client sent one, so it cannot be told from a forged value. This puts the
 * socket's own address on every incoming request, under a header name made up when the process starts: a client cannot
 * know the name, and whatever it sends under it is overwritten.
 *
 *   installPeerStamp()    lib/guard/peer-install.ts (it loads node:http, so it is its own file), called by
 *                         instrumentation.ts once per process: wraps http.Server's "request" event
 *   peerAddress(headers)  the socket address of this request, or null (not installed: unit tests call handlers
 *                         directly; or a request that arrived before the stamp was installed)
 *
 * lib/guard/client-ip.ts uses it two ways: as the client's address when no proxy of ours is in front (a laptop, the
 * filming machine, a server reached directly), and to tell that a request did not come through our proxy at all (its
 * peer is a public address), in which case a forwarded header is not believed even when one is configured.
 */
export interface PeerStamp {
  header: string;
}
export type PeerGlobal = typeof globalThis & { __ripplePeerStamp?: PeerStamp };
type G = PeerGlobal;

/** The header the stamp writes, or null when it is not installed in this process. */
export function peerHeaderName(): string | null {
  return (globalThis as G).__ripplePeerStamp?.header ?? null;
}

/** The raw socket address stamped on this request, or null. */
export function peerAddress(headers: { get(name: string): string | null }): string | null {
  const name = peerHeaderName();
  if (!name) return null;
  const value = (headers.get(name) ?? "").trim();
  return value || null;
}
