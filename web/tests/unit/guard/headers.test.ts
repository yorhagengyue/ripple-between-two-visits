/**
 * The 3.4 response headers and the origin check on the paths web/proxy.ts never sees (lib/guard/headers.ts,
 * lib/guard/request.ts guardOutsideProxy; track L). Track A's proxy covers everything its matcher sees
 * (tests/unit/auth/proxy-front.test.ts); the matcher leaves out the two upload routes and the static files.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUT as blobUploadPUT } from "@/app/api/blob/upload/route";
import { POST as preflightUploadPOST } from "@/app/api/preflight/upload/route";
import { NO_STORE, OUTSIDE_PROXY, outsideProxyHeaderRules, SECURITY_HEADERS } from "@/lib/guard/headers";
import { guardOutsideProxy } from "@/lib/guard/request";
import nextConfig from "@/next.config";
import { config, proxy } from "@/proxy";

const SITE = "https://app.ripple.example";

afterEach(() => vi.unstubAllEnvs());

describe("one list of the fixed headers", () => {
  it("is the design's four, word for word, and HSTS is not among them (the edge's)", () => {
    expect(Object.fromEntries(SECURITY_HEADERS)).toEqual({
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "microphone=(self), camera=(self)",
      "X-Content-Type-Options": "nosniff",
    });
    expect(SECURITY_HEADERS.map(([name]) => name.toLowerCase())).not.toContain("strict-transport-security");
  });

  it("the proxy puts exactly this list on what it answers", async () => {
    const res = await proxy(new NextRequest(`${SITE}/login`));
    for (const [name, value] of SECURITY_HEADERS) expect(res.headers.get(name), name).toBe(value);
  });
});

describe("the paths the proxy's matcher leaves out", () => {
  it("are listed one for one with the matcher (the dev server's own overlay aside)", () => {
    const matcher = config.matcher[0];
    const left = /\(\?!([^)]*)\)/.exec(matcher)![1].split("|");
    expect(left.filter((p) => p !== "__nextjs").sort()).toEqual(OUTSIDE_PROXY.map((p) => p.matcherPart).sort());
  });

  it("next.config.ts gives each of them the fixed headers; the two upload routes also private, no-store", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual(outsideProxyHeaderRules());
    expect(rules.map((r) => r.source)).toEqual(["/_next/:path*", "/favicon.ico", "/worklets/:path*", "/api/blob/upload", "/api/preflight/upload"]);
    for (const r of rules) {
      const got = Object.fromEntries(r.headers.map((h) => [h.key, h.value]));
      for (const [name, value] of SECURITY_HEADERS) expect(got[name], `${r.source} ${name}`).toBe(value);
      const upload = r.source.startsWith("/api/");
      // never a Cache-Control on the static files: it would replace Next's one-year immutable caching
      expect(got["Cache-Control"], r.source).toBe(upload ? NO_STORE : undefined);
    }
    expect(NO_STORE).toBe("private, no-store");
    // no rule covers a path the proxy handles (a header from both places would be sent twice)
    for (const r of rules) for (const p of ["/", "/p/today", "/api/doses", "/login"]) expect(r.source === p || p.startsWith(r.source.replace("/:path*", "/")), `${r.source} vs ${p}`).toBe(false);
  });
});

describe("the two upload routes check where a write comes from themselves", () => {
  const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
  const own = { origin: SITE, "sec-fetch-site": "same-origin" };

  it("another site's upload is 403 bad_origin; this site's goes on to the route", async () => {
    const pre = await preflightUploadPOST(new Request(`${SITE}/api/preflight/upload`, { method: "POST", headers: { ...evil, "content-type": "application/octet-stream" }, body: "abcd" }));
    expect(pre.status).toBe(403);
    expect(await pre.json()).toEqual({ error: "bad_origin" });
    const ok = await preflightUploadPOST(new Request(`${SITE}/api/preflight/upload`, { method: "POST", headers: { ...own, "content-type": "application/octet-stream" }, body: "abcd" }));
    expect(await ok.json()).toEqual({ bytes: 4 });
    const put = await blobUploadPUT(new NextRequest(`${SITE}/api/blob/upload?token=x`, { method: "PUT", headers: { ...evil, "content-type": "audio/wav" }, body: "RIFF" }));
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: "bad_origin" });
    const mine = await blobUploadPUT(new NextRequest(`${SITE}/api/blob/upload?token=x`, { method: "PUT", headers: { ...own, "content-type": "audio/wav" }, body: "RIFF" }));
    // the route's own answer about the token (403 bad_token; 404 with another driver), not the origin's
    expect(((await mine.json()) as { error?: string }).error).not.toBe("bad_origin");
  });

  it("on a real server a bare write is refused there too; a script that names the site passes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    const bare = new Request(`${SITE}/api/preflight/upload`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: "abcd" });
    expect(guardOutsideProxy(bare)?.status).toBe(403);
    const named = new Request(`${SITE}/api/preflight/upload`, { method: "POST", headers: { origin: SITE, "content-type": "application/octet-stream" }, body: "abcd" });
    expect(guardOutsideProxy(named)).toBeNull();
    expect(guardOutsideProxy(new Request(`${SITE}/api/preflight/upload`))).toBeNull(); // reading is never checked
  });
});
