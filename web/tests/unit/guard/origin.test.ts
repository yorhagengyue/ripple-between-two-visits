/**
 * What track L changed in track A's origin check (lib/auth/origin.ts; real-app 3.4 line 512: a write must be shown to
 * come from this site, 「不是就 403 bad_origin」):
 *   - on a real server a write with neither Origin nor Sec-Fetch-Site is refused (it passed everywhere before); where
 *     the developer tools are on it still passes, so Playwright's request helpers and the developer scripts work;
 *   - Origin: null is not this site (it passed before), unless the browser says Sec-Fetch-Site: same-origin;
 *   - Sec-Fetch-Site: same-origin / none is enough by itself, also behind a front proxy that rewrites Host.
 * Track A's own cases are tests/unit/auth/proxy-front.test.ts.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { isForeignOrigin } from "@/lib/auth/origin";
import { proxy } from "@/proxy";

const SITE = "https://app.ripple.example";
/** A real server: the developer tools are off. */
const PROD = { NODE_ENV: "production" };
/** next dev, the tests, the recording build. */
const DEV = { NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" };

const h = (headers: Record<string, string>, url = `${SITE}/api/doses`) => ({ headers: new Headers({ host: new URL(url).host, ...headers }), nextUrl: new URL(url) });

afterEach(() => vi.unstubAllEnvs());

describe("a write that does not say where it comes from", () => {
  it("on a real server: refused", () => {
    expect(isForeignOrigin(h({}), PROD)).toBe(true);
    expect(isForeignOrigin(h({ "sec-fetch-site": "" }), PROD)).toBe(true);
    expect(isForeignOrigin(h({ origin: " " }), PROD)).toBe(true);
  });

  it("where the developer tools are on: passes (Playwright's request helpers, the developer scripts)", () => {
    expect(isForeignOrigin(h({}), DEV)).toBe(false);
    expect(isForeignOrigin(h({}), { NODE_ENV: "test" })).toBe(false);
    expect(isForeignOrigin(h({}), { NODE_ENV: "development" })).toBe(false);
  });

  it("a script that must reach a real server names the site in Origin (scripts/preflight.ts)", () => {
    expect(isForeignOrigin(h({ origin: SITE }), PROD)).toBe(false);
    expect(isForeignOrigin(h({ origin: "https://evil.example" }), PROD)).toBe(true);
    expect(isForeignOrigin(h({ origin: "https://www.ripple.example" }), { ...PROD, RIPPLE_PUBLIC_HOSTS: "www.ripple.example" })).toBe(false);
  });
});

describe("what the browser says", () => {
  it("Sec-Fetch-Site: same-origin or none is this site, with nothing else to compare", () => {
    expect(isForeignOrigin(h({ "sec-fetch-site": "same-origin", origin: SITE }), PROD)).toBe(false);
    expect(isForeignOrigin(h({ "sec-fetch-site": "Same-Origin" }), PROD)).toBe(false);
    expect(isForeignOrigin(h({ "sec-fetch-site": "none" }), PROD)).toBe(false);
    // behind a front proxy that rewrote Host and passed nothing on: the browser's word still holds
    expect(isForeignOrigin(h({ "sec-fetch-site": "same-origin", origin: SITE }, "http://10.0.0.5:3000/api/doses"), PROD)).toBe(false);
  });

  it("Origin: null is not this site; the browser's same-origin still is (a page with no-referrer sending a beacon)", () => {
    expect(isForeignOrigin(h({ origin: "null" }), PROD)).toBe(true);
    expect(isForeignOrigin(h({ origin: "null" }), DEV)).toBe(true);
    expect(isForeignOrigin(h({ origin: "NULL" }), DEV)).toBe(true);
    expect(isForeignOrigin(h({ origin: "null", "sec-fetch-site": "same-origin" }), PROD)).toBe(false);
    expect(isForeignOrigin(h({ origin: "null", "sec-fetch-site": "cross-site" }), DEV)).toBe(true);
  });

  it("cross-site is refused whatever else is sent; same-site needs an Origin that is this site's", () => {
    expect(isForeignOrigin(h({ "sec-fetch-site": "cross-site", origin: SITE }), DEV)).toBe(true);
    expect(isForeignOrigin(h({ "sec-fetch-site": "same-site", origin: "https://family.ripple.example" }), DEV)).toBe(true);
    expect(isForeignOrigin(h({ "sec-fetch-site": "same-site" }), DEV)).toBe(true);
    // the same host on another scheme or behind a proxy that changed the port reads as same-site: the Origin decides
    expect(isForeignOrigin(h({ "sec-fetch-site": "same-site", origin: SITE }), PROD)).toBe(false);
  });
});

describe("where it is used", () => {
  const post = (headers: Record<string, string>) => new NextRequest(`${SITE}/api/doses`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

  it("the proxy on a real server: a bare write is 403 bad_origin; this site's page, and a script that names the site, pass", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    const bare = await proxy(post({}));
    expect(bare.status).toBe(403);
    expect(await bare.json()).toEqual({ error: "bad_origin" });
    expect((await proxy(post({ origin: SITE, "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect((await proxy(post({ origin: SITE }))).status).toBe(200);
    // reading is never checked
    expect((await proxy(new NextRequest(`${SITE}/api/doses`))).status).toBe(200);
  });

  it("the proxy with the developer tools on: a bare write passes, another site's never does", async () => {
    expect((await proxy(post({}))).status).toBe(200);
    expect((await proxy(post({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await proxy(post({ origin: "null" }))).status).toBe(403);
  });

  it("the account routes' own guard follows the same rule (guardPost)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    const bare = await loginPost(new NextRequest(`${SITE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "someone", password: "whatever it is" }) }));
    expect(bare.status).toBe(403);
    expect(await bare.json()).toEqual({ error: "bad_origin" });
  });
});
