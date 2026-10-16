/**
 * Installs the peer stamp (lib/guard/peer.ts explains what it is for). Node.js only: loaded by instrumentation.ts in
 * its Node.js branch, never by a page, a route or the proxy.
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { PeerGlobal } from "./peer";

/** Wrap http.Server's "request" event so every request carries its socket's address. Safe to call again. */
export function installPeerStamp(): void {
  const g = globalThis as PeerGlobal;
  if (g.__ripplePeerStamp) return;
  const header = `x-ripple-peer-${randomBytes(12).toString("hex")}`;
  const proto = http.Server.prototype as unknown as { emit: (this: http.Server, event: string | symbol, ...args: unknown[]) => boolean };
  const emit = proto.emit;
  proto.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === "request") {
      try {
        const req = args[0] as http.IncomingMessage | undefined;
        if (req?.headers) req.headers[header] = req.socket?.remoteAddress ?? "";
      } catch {
        // a request we cannot stamp goes on without the address (it then counts as unknown)
      }
    }
    return emit.call(this, event, ...args);
  };
  g.__ripplePeerStamp = { header };
}
