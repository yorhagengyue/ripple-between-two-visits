/**
 * What the proxy does at the front door for accounts (web/proxy.ts, track A; docs/plan/real-app.md 2.1, 3.4, 3.7):
 *   - signed out, her pages too (/f and every page under it) go to /login?next=<the page asked for, query kept>, and
 *     the login brings her back there; the invitation page stays public (2.20);
 *   - a write (anything but GET / HEAD / OPTIONS) from another site is 403 bad_origin before anything runs; this
 *     site's own writes and requests without an Origin pass;
 *   - every answer carries the response headers of 3.4, and a signed-in person's answers are private, no-store.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthProvider, type AuthTokens, type MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { destinationAfterSignIn, loginUrl, safeNext } from "@/lib/auth/next";
import { isForeignOrigin, isReadMethod, ownHosts } from "@/lib/auth/origin";
import { getMemoryStore } from "@/lib/store/memory";
import { proxy } from "@/proxy";

const store = getMemoryStore();
const auth = () => getAuthProvider() as MemoryAuthProvider;

function req(p: string, opts: { cookies?: Record<string, string>; headers?: Record<string, string>; method?: string; base?: string } = {}): NextRequest {
  const cookie = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`${opts.base ?? "http://localhost:3510"}${p}`, { method: opts.method ?? "GET", headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) } });
}

async function signedIn(space: "blank" | "example" | "none" = "example"): Promise<AuthTokens> {
  return (await createAccountWithSpace(store, auth(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space })).tokens;
}

afterEach(() => vi.restoreAllMocks());

describe("signed out: her pages go to the login and keep the page she asked for", () => {
  it("/f and every page under it: 307 to /login?next=<the same path and query>", async () => {
    const link = randomUUID();
    for (const [path, next] of [
      ["/f", "/f"],
      [`/f?link=${link}`, `/f?link=${link}`],
      [`/f/week?link=${link}`, `/f/week?link=${link}`],
      [`/f/alert?link=${link}&from=push`, `/f/alert?link=${link}&from=push`],
      [`/f/shared/visit/v1?link=${link}`, `/f/shared/visit/v1?link=${link}`],
      [`/f/reminder?link=${link}&_rsc=abc12`, `/f/reminder?link=${link}`],
      ["/f/me", "/f/me"],
      ["/f/me/delete", "/f/me/delete"],
      ["/p/me/reset-help", "/p/me/reset-help"],
    ] as const) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin, path).toBe("http://localhost:3510");
      expect(loc.pathname, path).toBe("/login");
      expect(loc.searchParams.get("next"), path).toBe(next);
      // and after logging in she is sent exactly there: a path on this site, never anywhere else
      expect(safeNext(loc.searchParams.get("next")), path).toBe(next);
      // (a family member with no space of her own for her pages; his own space for his)
      expect(destinationAfterSignIn(loc.searchParams.get("next"), path.startsWith("/p") ? { onboarding: "done" } : null), path).toBe(next);
    }
  });

  it("only paths on this site come back: a next that points elsewhere is dropped by the login", () => {
    for (const bad of ["https://evil.example/f", "//evil.example/f", "/\\evil.example", "/login?next=/f", "/api/family/view", "javascript:alert(1)", "f/week"]) {
      expect(safeNext(bad), bad).toBeNull();
      expect(loginUrl(bad), bad).toBe("/login");
      expect(destinationAfterSignIn(bad, null), bad).toBe("/f");
    }
  });

  it("the invitation page and the other public pages stay open; things that only start with f are not her pages", async () => {
    for (const p of [`/invite/${randomUUID()}.token`, "/", "/login", "/signup", "/recover", "/privacy", "/demo", "/how", "/favorites", "/fx"]) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location"), p).toBeNull();
    }
  });

  it("signed in (her token, or his) the pages are let through; the demo's phones on /f are the demo's business as before", async () => {
    const hers = await signedIn("none");
    for (const p of ["/f", `/f/week?link=${randomUUID()}`]) expect((await proxy(req(p, { cookies: { rp_at: hers.access_token } }))).status, p).toBe(200);
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const member = await store.addMember(s.id, { role: "family" });
    const demo = await proxy(req("/f", { cookies: { rp_session: s.id, rp_member: member.id, rp_role: "family" } }));
    expect(demo.status).toBe(200);
    // an API under her pages' names is never redirected
    expect((await proxy(req(`/api/family/view?link=${randomUUID()}`))).status).toBe(200);
    // a write to a page path is not a navigation
    expect((await proxy(req("/f", { method: "POST" }))).status).toBe(200);
  });
});

describe("another site's writes are refused before anything runs", () => {
  it("the check itself: Origin against this site's hosts, Sec-Fetch-Site, and what passes", () => {
    const h = (headers: Record<string, string>, url = "https://ripple.example/api/doses") => ({ headers: new Headers(headers), nextUrl: new URL(url) });
    expect(isForeignOrigin(h({ origin: "https://evil.example", host: "ripple.example" }))).toBe(true);
    expect(isForeignOrigin(h({ origin: "https://ripple.example.evil.example", host: "ripple.example" }))).toBe(true);
    expect(isForeignOrigin(h({ origin: "https://ripple.example:8443", host: "ripple.example" }))).toBe(true); // another port is another origin
    expect(isForeignOrigin(h({ origin: "not a url", host: "ripple.example" }))).toBe(true);
    expect(isForeignOrigin(h({ "sec-fetch-site": "cross-site", host: "ripple.example" }))).toBe(true);
    expect(isForeignOrigin(h({ origin: "https://ripple.example", host: "ripple.example", "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isForeignOrigin(h({ origin: "https://RIPPLE.example", host: "ripple.example" }))).toBe(false);
    expect(isForeignOrigin(h({ host: "ripple.example" }))).toBe(false); // no Origin: a script, a job, the tests (the developer tools are on here)
    // C2 track L: "null" is not this site's name (it passed before); and on a real server a write that names no origin
    // at all is refused too (tests/unit/guard/origin.test.ts)
    expect(isForeignOrigin(h({ origin: "null", host: "ripple.example" }))).toBe(true);
    expect(isForeignOrigin(h({ origin: "null", host: "ripple.example", "sec-fetch-site": "same-origin" }))).toBe(false);
    // behind a front proxy: the public host comes in X-Forwarded-Host, or is named in RIPPLE_PUBLIC_HOSTS
    expect(isForeignOrigin(h({ origin: "https://ripple.example", host: "10.0.0.5:3000", "x-forwarded-host": "ripple.example" }, "http://10.0.0.5:3000/api/doses"))).toBe(false);
    expect(isForeignOrigin(h({ origin: "https://ripple.example", host: "10.0.0.5:3000" }, "http://10.0.0.5:3000/api/doses"))).toBe(true);
    expect(isForeignOrigin(h({ origin: "https://ripple.example", host: "10.0.0.5:3000" }, "http://10.0.0.5:3000/api/doses"), { RIPPLE_PUBLIC_HOSTS: "app.example, ripple.example" })).toBe(false);
    expect(ownHosts(h({ host: "A.example:3000" }, "http://a.example:3000/x"), { RIPPLE_PUBLIC_HOSTS: " B.example " })).toEqual(["a.example:3000", "a.example:3000", "b.example"]);
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) expect(isReadMethod(m)).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(isReadMethod(m)).toBe(false);
  });

  it("through the proxy: POST, PUT, PATCH and DELETE from another origin are 403 bad_origin; his own and origin-less ones pass", async () => {
    const t = await signedIn();
    const mine = { rp_at: t.access_token };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const p of ["/api/doses", "/api/bp", "/api/family/invites", "/api/me/delete", "/p/today"]) {
        const res = await proxy(req(p, { method, cookies: mine, headers: { origin: "https://evil.example" } }));
        expect(res.status, `${method} ${p}`).toBe(403);
        expect(await res.json()).toEqual({ error: "bad_origin" });
      }
    }
    const marked = await proxy(req("/api/doses", { method: "POST", cookies: mine, headers: { "sec-fetch-site": "cross-site" } }));
    expect(marked.status).toBe(403);
    // this site's own page writing, and a caller that sends no Origin
    expect((await proxy(req("/api/doses", { method: "POST", cookies: mine, headers: { origin: "http://localhost:3510", "sec-fetch-site": "same-origin" } }))).status).toBe(200);
    expect((await proxy(req("/api/doses", { method: "POST", cookies: mine }))).status).toBe(200);
    // reads are not writes: another site may link here (he opens Ripple from a WhatsApp link)
    expect((await proxy(req("/p/today", { cookies: mine, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }))).status).toBe(200);
    expect((await proxy(req("/api/doses", { cookies: mine, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(200);
  });

  it("a refused write does nothing at all: no refresh is traded and no cookie is set", async () => {
    const t = await signedIn();
    const refresh = vi.spyOn(auth(), "refresh");
    const res = await proxy(req("/api/auth/logout", { method: "POST", cookies: { rp_rt: t.refresh_token }, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("the response headers of real-app 3.4", () => {
  const expected: Record<string, string> = {
    "content-security-policy": "frame-ancestors 'self'",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), camera=(self)",
    "x-content-type-options": "nosniff",
  };

  it("on a page, an API answer, the login redirect, a refusal and the demo alike", async () => {
    const t = await signedIn();
    const s = await store.createSession({ story_day: 3, story_time: "09:00", ttl_hours: 1 });
    for (const r of [
      req("/"),
      req("/login"),
      req("/p/today"), // 307 to the login
      req("/p/today", { cookies: { rp_at: t.access_token } }),
      req("/api/doses", { cookies: { rp_at: t.access_token } }),
      req("/api/doses", { method: "POST", headers: { origin: "https://evil.example" } }), // 403
      req("/demo"),
      req("/p/today", { cookies: { rp_session: s.id } }),
      req(`/invite/${randomUUID()}`),
    ]) {
      const res = await proxy(r);
      for (const [name, value] of Object.entries(expected)) expect(res.headers.get(name), `${r.method} ${r.nextUrl.pathname} ${name}`).toBe(value);
    }
  });

  it("a signed-in person's answers are private, no-store; an anonymous page is left to its own caching", async () => {
    const t = await signedIn();
    for (const p of ["/p/today", "/api/doses", "/api/me", "/privacy"]) expect((await proxy(req(p, { cookies: { rp_at: t.access_token } }))).headers.get("cache-control"), p).toBe("private, no-store");
    expect((await proxy(req("/privacy"))).headers.get("cache-control")).toBeNull();
    expect((await proxy(req("/demo"))).headers.get("cache-control")).toBeNull();
    // a header set by the proxy replaces the route's own, so the one route with a caching rule of its own is left to
    // it: the event stream (private, no-store, no-transform)
    const stream = await proxy(req("/api/events", { cookies: { rp_at: t.access_token } }));
    expect(stream.headers.get("cache-control")).toBeNull();
    expect(stream.headers.get("x-content-type-options")).toBe("nosniff");
    // C2 track L: the sound clips of a signed-in person are private, no-store like everything else of his (they were
    // left at the routes' private, max-age=300); the demo's sample clips keep the routes' own header
    for (const p of ["/api/family/clip", `/api/reminders/${randomUUID()}/audio`, `/api/visits/${randomUUID()}/clip`]) {
      expect((await proxy(req(p, { cookies: { rp_at: t.access_token } }))).headers.get("cache-control"), p).toBe("private, no-store");
      expect((await proxy(req(p))).headers.get("cache-control"), p).toBeNull();
    }
    expect((await proxy(req("/api/eventsx", { cookies: { rp_at: t.access_token } }))).headers.get("cache-control")).toBe("private, no-store");
  });
});
