/**
 * Whose address the per-IP limits count (lib/guard/client-ip.ts, lib/guard/boot.ts; track L; real-app 3.5 line 523,
 * hosting.md 5.3 item 6 and 5.9): nothing a client sends by itself is believed; the edge's header only through the
 * origin lock; else what our own proxy saw; else one shared bucket.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "@/lib/auth/limits";
import { guardDeployProblems, refuseUnsafeGuardStart } from "@/lib/guard/boot";
import { cameThroughEdge, cleanAddress, clientAddress, clientAddressRule, isInternalAddress, trustedProxyHops, UNKNOWN_ADDRESS } from "@/lib/guard/client-ip";
import { peerAddress, peerHeaderName, type PeerGlobal } from "@/lib/guard/peer";
import { installPeerStamp } from "@/lib/guard/peer-install";
import { clientId } from "@/lib/session/crew-key";

const SECRET = "edge-secret-0123456789abcdef0123456789abcdef";
const h = (init: Record<string, string>) => new Headers(init);

describe("with nothing configured", () => {
  it("no forwarded header picks the bucket: every client is the same one", () => {
    const env = {};
    expect(clientAddress(h({}), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.9" }), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "x-real-ip": "198.51.100.4" }), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "eo-connecting-ip": "198.51.100.4", "x-ripple-edge": SECRET }), env)).toBe(UNKNOWN_ADDRESS);
    expect(trustedProxyHops(env)).toBe(0);
  });

  it("the sign-in limits and the crew-key lockout read the same rule", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    vi.stubEnv("EDGE_SECRET", "");
    const forged = h({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.4" });
    expect(clientIp(forged)).toBe("local");
    expect(clientId(forged)).toBe("local");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp(forged)).toBe("203.0.113.9");
    expect(clientId(forged)).toBe("203.0.113.9");
    vi.unstubAllEnvs();
  });
});

describe("our own reverse proxy (TRUSTED_PROXY_HOPS)", () => {
  it("1: the rightmost entry, the address Caddy saw; whatever the client put to its left is never read", () => {
    const env = { TRUSTED_PROXY_HOPS: "1" };
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-forwarded-for": "evil, 6.6.6.6 ,203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({}), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "x-real-ip": "198.51.100.4" }), env)).toBe(UNKNOWN_ADDRESS);
  });

  it("2: the entry two from the right; a chain shorter than the hops names nobody", () => {
    const env = { TRUSTED_PROXY_HOPS: "2" };
    expect(clientAddress(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.9, 10.0.0.2" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-forwarded-for": "10.0.0.2" }), env)).toBe(UNKNOWN_ADDRESS);
  });

  it("only an address counts: IPv6, a bracketed one and an IPv4-mapped one are tidied, anything else is nobody", () => {
    const env = { TRUSTED_PROXY_HOPS: "1" };
    expect(clientAddress(h({ "x-forwarded-for": "2001:DB8::1" }), env)).toBe("2001:db8::1");
    expect(clientAddress(h({ "x-forwarded-for": "[2001:db8::1]" }), env)).toBe("2001:db8::1");
    expect(clientAddress(h({ "x-forwarded-for": "::ffff:203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-forwarded-for": "not-an-address" }), env)).toBe(UNKNOWN_ADDRESS);
    expect(clientAddress(h({ "x-forwarded-for": "203.0.113.9:4711" }), env)).toBe(UNKNOWN_ADDRESS);
    expect(cleanAddress("  10.1.2.3 ")).toBe("10.1.2.3");
    expect(cleanAddress("")).toBeNull();
    expect(cleanAddress("x".repeat(100))).toBeNull();
  });

  it("a value that is not a small number is 0", () => {
    for (const v of ["", "one", "-1", "1.5", " "]) expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: v }), v).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "3" })).toBe(3);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "40" })).toBe(8);
  });
});

describe("the edge's header, only through the origin lock", () => {
  const env = { EDGE_SECRET: SECRET, TRUSTED_PROXY_HOPS: "1" };

  it("with the lock's secret on the request, the address EdgeOne reports", () => {
    const req = h({ "x-ripple-edge": SECRET, "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "43.1.2.3" });
    expect(cameThroughEdge(req, env)).toBe(true);
    expect(clientAddress(req, env)).toBe("198.51.100.77");
  });

  it("without it (the site that skips EdgeOne) or with a wrong one, a forged edge header is ignored: what Caddy saw", () => {
    expect(clientAddress(h({ "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-ripple-edge": `${SECRET}x`, "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(clientAddress(h({ "x-ripple-edge": "", "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "203.0.113.9" }), env)).toBe("203.0.113.9");
    expect(cameThroughEdge(h({ "x-ripple-edge": "guess" }), env)).toBe(false);
  });

  it("through the lock but with no usable edge address: what Caddy saw (the edge node)", () => {
    expect(clientAddress(h({ "x-ripple-edge": SECRET, "x-forwarded-for": "43.1.2.3" }), env)).toBe("43.1.2.3");
    expect(clientAddress(h({ "x-ripple-edge": SECRET, "eo-connecting-ip": "junk", "x-forwarded-for": "43.1.2.3" }), env)).toBe("43.1.2.3");
  });

  it("a secret too short to be one is no lock at all", () => {
    const weak = { EDGE_SECRET: "short", TRUSTED_PROXY_HOPS: "0" };
    expect(cameThroughEdge(h({ "x-ripple-edge": "short" }), weak)).toBe(false);
    expect(clientAddress(h({ "x-ripple-edge": "short", "eo-connecting-ip": "198.51.100.77" }), weak)).toBe(UNKNOWN_ADDRESS);
  });

  it("the header names can be changed (the edge's header name is still to be confirmed)", () => {
    const named = { EDGE_SECRET: SECRET, EDGE_SECRET_HEADER: "X-Origin-Lock", EDGE_CLIENT_IP_HEADER: "X-Client-IP" };
    expect(clientAddress(h({ "x-origin-lock": SECRET, "x-client-ip": "198.51.100.5" }), named)).toBe("198.51.100.5");
    expect(clientAddress(h({ "x-ripple-edge": SECRET, "eo-connecting-ip": "198.51.100.5" }), named)).toBe(UNKNOWN_ADDRESS);
  });

  it("the rule in force is logged by names, never the secret", () => {
    const line = clientAddressRule(env);
    expect(line).toContain("eo-connecting-ip");
    expect(line).toContain("entry 1 from the right");
    expect(line).not.toContain(SECRET);
    expect(clientAddressRule({})).toContain("no forwarded header is believed; else the address the server saw");
  });
});

describe("the address the server itself saw (the peer stamp)", () => {
  const STAMP = "x-ripple-peer-test";
  const stamped = (peer: string, more: Record<string, string> = {}) => h({ [STAMP]: peer, ...more });
  const g = globalThis as PeerGlobal;
  const withStamp = <T>(run: () => T): T => {
    const before = g.__ripplePeerStamp;
    g.__ripplePeerStamp = { header: STAMP };
    try {
      return run();
    } finally {
      g.__ripplePeerStamp = before;
    }
  };
  afterEach(() => vi.unstubAllEnvs());

  it("not installed (unit tests call the handlers directly): nothing is read, whatever header a client sends", () => {
    expect(peerHeaderName()).toBeNull();
    expect(peerAddress(h({ [STAMP]: "203.0.113.9", "x-ripple-peer": "203.0.113.9" }))).toBeNull();
    expect(clientAddress(h({ [STAMP]: "203.0.113.9" }), {})).toBe(UNKNOWN_ADDRESS);
  });

  it("no proxy of ours in front (the default): the client is whoever connected, never what a header says", () => {
    withStamp(() => {
      expect(clientAddress(stamped("192.168.1.23"), {})).toBe("192.168.1.23");
      expect(clientAddress(stamped("::ffff:192.168.1.23"), {})).toBe("192.168.1.23");
      expect(clientAddress(stamped("203.0.113.9", { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4", "eo-connecting-ip": "1.2.3.4" }), {})).toBe("203.0.113.9");
      expect(clientAddress(stamped("::1", { "x-forwarded-for": "1.2.3.4" }), { TRUSTED_PROXY_HOPS: "0" })).toBe("::1");
      expect(clientAddress(stamped(""), {})).toBe(UNKNOWN_ADDRESS);
    });
  });

  it("behind our proxy (hops 1): its view, as long as it is our proxy that connected (loopback or a private network)", () => {
    withStamp(() => {
      const env = { TRUSTED_PROXY_HOPS: "1" };
      for (const proxy of ["127.0.0.1", "::1", "10.0.3.4", "172.20.0.2", "192.168.0.2", "fd00::2"]) {
        expect(clientAddress(stamped(proxy, { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), env), proxy).toBe("203.0.113.9");
      }
      // Caddy connected but sent no usable header: the proxy's own address, one bucket (never the forged left part)
      expect(clientAddress(stamped("127.0.0.1"), env)).toBe("127.0.0.1");
    });
  });

  it("the app's port reached directly from outside although a proxy is configured: the forwarded header is the client's own, not read", () => {
    withStamp(() => {
      const env = { TRUSTED_PROXY_HOPS: "1" };
      expect(clientAddress(stamped("198.51.100.20", { "x-forwarded-for": "203.0.113.9" }), env)).toBe("198.51.100.20");
      expect(clientAddress(stamped("2001:db8::7", { "x-forwarded-for": "203.0.113.9" }), env)).toBe("2001:db8::7");
    });
  });

  it("the edge's header still needs the origin lock, and wins when the lock is there", () => {
    withStamp(() => {
      const env = { TRUSTED_PROXY_HOPS: "1", EDGE_SECRET: SECRET };
      expect(clientAddress(stamped("127.0.0.1", { "x-ripple-edge": SECRET, "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "43.1.2.3" }), env)).toBe("198.51.100.77");
      expect(clientAddress(stamped("127.0.0.1", { "eo-connecting-ip": "198.51.100.77", "x-forwarded-for": "43.1.2.3" }), env)).toBe("43.1.2.3");
    });
  });

  it("internal addresses: loopback, the private ranges, link-local; nothing public", () => {
    for (const a of ["127.0.0.1", "127.8.9.1", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.50.1", "169.254.1.1", "::1", "fc00::1", "fd12:3456::1", "fe80::1"]) expect(isInternalAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.64.0.1", "203.0.113.9", "2001:db8::1", "local", ""]) expect(isInternalAddress(a), a).toBe(false);
  });

  it("installPeerStamp: a real server's requests carry their socket's address under a name no client knows; a sent value is overwritten", async () => {
    const before = g.__ripplePeerStamp;
    g.__ripplePeerStamp = undefined;
    installPeerStamp();
    const name = peerHeaderName();
    expect(name).toMatch(/^x-ripple-peer-[0-9a-f]{24}$/);
    installPeerStamp(); // again: the same stamp
    expect(peerHeaderName()).toBe(name);
    const seen: (string | string[] | undefined)[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers[name!]);
      seen.push(clientAddress(new Headers(Object.entries(req.headers).map(([k, v]) => [k, String(v)] as [string, string])), {}));
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    await fetch(`http://127.0.0.1:${port}/`, { headers: { [name!]: "203.0.113.9", "x-forwarded-for": "203.0.113.9" } });
    await new Promise<void>((r) => server.close(() => r()));
    expect(seen).toEqual(["127.0.0.1", "127.0.0.1"]);
    g.__ripplePeerStamp = before;
  });
});

describe("a deployment must say how the address is read", () => {
  it("nothing to say outside a deployment", () => {
    expect(guardDeployProblems({})).toEqual([]);
    expect(guardDeployProblems({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).toEqual([]);
  });

  it("RIPPLE_DEPLOYED=1 without TRUSTED_PROXY_HOPS, with a bad one, or with a short EDGE_SECRET does not start", () => {
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1" })).toHaveLength(1);
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1" })[0]).toContain("TRUSTED_PROXY_HOPS");
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "many" })[0]).toContain("0 to 8");
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "1", EDGE_SECRET: "short" })[0]).toContain("EDGE_SECRET");
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "1" })).toEqual([]);
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "0" })).toEqual([]);
    expect(guardDeployProblems({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "1", EDGE_SECRET: SECRET })).toEqual([]);
  });

  it("the refusal exits 1 and prints no value; a good deployment logs its rule once", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const exit = vi.fn();
    refuseUnsafeGuardStart({ RIPPLE_DEPLOYED: "1", EDGE_SECRET: "short" }, exit);
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0][0])).not.toContain("short\"");
    exit.mockClear();
    refuseUnsafeGuardStart({ RIPPLE_DEPLOYED: "1", TRUSTED_PROXY_HOPS: "1", EDGE_SECRET: SECRET }, exit);
    expect(exit).not.toHaveBeenCalled();
    expect(String(info.mock.calls[0][0])).toContain("client address");
    expect(String(info.mock.calls[0][0])).not.toContain(SECRET);
    refuseUnsafeGuardStart({}, exit);
    expect(exit).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
