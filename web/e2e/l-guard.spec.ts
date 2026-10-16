/**
 * Track L on a running server (docs/plan/real-app.md 3.4 跨站和响应头, 3.7 页面跳转). The origin check, the fixed headers
 * and Cache-Control at the proxy are track A's (lib/auth/origin.ts, web/proxy.ts); this spec is the site-wide check of
 * them on a real build, with what track L added or changed:
 *   - the response headers on a page, a signed-in page, API answers and a signed-in person's error answers; also on
 *     the files and the upload route the proxy never sees (next.config.ts); the event stream and a sound clip of a
 *     signed-in person are private, no-store as well;
 *   - the judges' /demo page still frames the phone (frame-ancestors 'self');
 *   - a write from another site is 403 bad_origin (a real cross-site form post from a browser, and a request that says
 *     it is cross-site), a body that is not JSON 415, while the app's own fetches, a beacon and the service worker's
 *     route pass;
 *   - a signed-in person who has not finished setting up is sent from his pages to /onboard (also on a tap inside the
 *     app), a family member with no space of her own to /f; the demo's phones are untouched.
 * Runs with the developer tools on (test accounts); in-memory store and identity. The strict rule for a write with
 * neither Origin nor Sec-Fetch-Site (403 on a real server) is tests/unit/guard/origin.test.ts: this server's
 * developer tools let Playwright's own request helper through.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, createSession } from "./helpers";

const PASSWORD = "a long test password";
const PORT = new URL(BASE_URL).port;
/** The same server under another host name: to a browser, another site. */
const OTHER_SITE = `http://127.0.0.1:${PORT}`;

async function phone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  return { context, page: await context.newPage() };
}

async function account(context: BrowserContext, opts: { space: "blank" | "example" | "none"; onboarding?: "started" | "done" }): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", {
    data: { login: `lg${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: PASSWORD, space: opts.space, display_name: "陈先生", locale: "zh-Hans", ...(opts.onboarding ? { onboarding: opts.onboarding } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
}

function expectFixedHeaders(res: APIResponse, what: string): void {
  const h = res.headers();
  expect(h["content-security-policy"], what).toBe("frame-ancestors 'self'");
  expect(h["referrer-policy"], what).toBe("no-referrer");
  expect(h["permissions-policy"], what).toBe("microphone=(self), camera=(self)");
  expect(h["x-content-type-options"], what).toBe("nosniff");
  expect(h["strict-transport-security"], `${what}: HSTS is the edge's`).toBeUndefined();
}

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/dev/accounts", { data: {} });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test.describe("response headers", () => {
  test("a public page, a signed-in page, API answers and a signed-in person's error answers: the fixed headers and private, no-store", async ({ browser, request }) => {
    // nobody signed in: the fixed headers; the page's own caching (Next's for a page that reads cookies)
    const demo = await request.get("/demo");
    expect(demo.status()).toBe(200);
    expectFixedHeaders(demo, "/demo");
    const away = await request.get("/p/today", { maxRedirects: 0 });
    expect(away.status()).toBe(307);
    expectFixedHeaders(away, "the redirect to the login");
    const nobody = await request.get("/api/doses");
    expect([400, 401]).toContain(nobody.status()); // no_session today; not_signed_in once nothing presented is a 401
    expectFixedHeaders(nobody, "/api/doses without a session");

    const { context } = await phone(browser);
    await account(context, { space: "example" });
    const today = await context.request.get("/p/today");
    expect(today.status()).toBe(200);
    expectFixedHeaders(today, "/p/today");
    expect(today.headers()["cache-control"]).toBe("private, no-store");

    const me = await context.request.get("/api/me");
    expect(me.status()).toBe(200);
    expectFixedHeaders(me, "/api/me");
    expect(me.headers()["cache-control"]).toBe("private, no-store");
    const doses = await context.request.get("/api/doses");
    expect(doses.status()).toBe(200);
    expect(doses.headers()["cache-control"]).toBe("private, no-store");
    // a sound clip route answers a signed-in person private, no-store too (here its own 404: no such visit)
    const clip = await context.request.get("/api/visits/no-such-visit/clip?u=x");
    expect(clip.status()).toBeGreaterThanOrEqual(400);
    expect(clip.headers()["cache-control"]).toBe("private, no-store");
    await context.close();

    // requireSubject's own error answer to a signed-in person (a family member with no space of her own: no_profile)
    const her = await phone(browser);
    await account(her.context, { space: "none" });
    const refused = await her.context.request.get("/api/doses");
    expect(refused.status()).toBe(404);
    expect(((await refused.json()) as { error: string }).error).toBe("no_profile");
    expectFixedHeaders(refused, "requireSubject's error answer");
    expect(refused.headers()["cache-control"]).toBe("private, no-store");
    await her.context.close();
  });

  test("the event stream keeps no-transform; static files keep their own caching and still get the fixed headers", async ({ browser, request }) => {
    const { context, page } = await phone(browser);
    await account(context, { space: "example" });
    const stream = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/events");
    await page.goto("/p/today");
    const events = await stream;
    expect(events.status()).toBe(200);
    expect(events.headers()["cache-control"]).toBe("private, no-store, no-transform");
    expect(events.headers()["content-type"]).toContain("text/event-stream");

    // the files the proxy's matcher leaves out get the fixed headers from next.config.ts and keep the build's caching
    const html = await (await request.get("/login")).text();
    const asset = /\/_next\/static\/[^"']+\.js/.exec(html)?.[0];
    expect(asset, "a script of the login page").toBeTruthy();
    const js = await request.get(asset!);
    expect(js.status()).toBe(200);
    expectFixedHeaders(js, asset!);
    expect(js.headers()["cache-control"]).not.toBe("private, no-store");
    const worklet = await request.get("/worklets/pcm-recorder.js");
    expect(worklet.status()).toBe(200);
    expectFixedHeaders(worklet, "/worklets/pcm-recorder.js");
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expectFixedHeaders(sw, "/sw.js");
    expect(sw.headers()["cache-control"]).not.toBe("private, no-store");
    const sample = await request.get("/api/labels/sample?name=amlodipine");
    expect(sample.headers()["cache-control"]).toBe("public, max-age=3600");
    // the upload route the proxy's matcher leaves out: the fixed headers, and its answers (here a refused token) are not kept
    const put = await request.fetch("/api/blob/upload?token=not-a-token", { method: "PUT", headers: { "content-type": "audio/wav" }, data: Buffer.from("RIFF") });
    expect(put.status()).toBeGreaterThanOrEqual(400);
    expectFixedHeaders(put, "PUT /api/blob/upload");
    expect(put.headers()["cache-control"]).toBe("private, no-store");
    await context.close();
  });

  test("the judges' /demo page still frames the phone from the same origin", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto("/demo");
    const frame = page.frameLocator('[data-testid="landing-phone-frame"] iframe');
    await expect(frame.locator("body")).toContainText(/陈先生|Mr Tan|今天|Today/, { timeout: 30_000 });
    const inner = page.frames().find((f) => new URL(f.url()).pathname.startsWith("/p/"));
    expect(inner, "the phone's own frame loaded").toBeTruthy();
    await context.close();
  });
});

test.describe("writes from another site", () => {
  test("a real cross-site form post is 403 bad_origin and opens nothing; the site's own post works", async ({ browser }) => {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    // a page on another site (the same server under 127.0.0.1) posts a form to the app
    await page.goto(`${OTHER_SITE}/login`);
    const answer = page.waitForResponse((r) => r.url() === `${BASE_URL}/api/session` && r.request().method() === "POST");
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;
      document.body.appendChild(form);
      form.submit();
    }, `${BASE_URL}/api/session`);
    const res = await answer;
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect((await context.cookies(BASE_URL)).filter((c) => c.name === "rp_session")).toEqual([]);

    // a cross-site fetch with JSON never even gets that far without CORS; a "simple" one is refused the same way
    await page.goto(`${OTHER_SITE}/login`);
    const simple = page.waitForResponse((r) => r.url() === `${BASE_URL}/api/session` && r.request().method() === "POST");
    await page.evaluate((url) => void fetch(url, { method: "POST", mode: "no-cors", body: "{}" }).catch(() => undefined), `${BASE_URL}/api/session`);
    expect((await simple).status()).toBe(403);

    // the app's own page: the same request passes and opens a sandbox
    await page.goto(`${BASE_URL}/login`);
    const own = await page.evaluate(async () => {
      const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return r.status;
    });
    expect(own).toBe(201);
    await context.close();
  });

  test("a request that says it is cross-site, or names another origin, is refused on every kind of write", async ({ request }) => {
    const s = await createSession(request);
    const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    for (const [method, path, data] of [
      ["POST", `/api/doses?session=${s.id}`, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }],
      ["DELETE", `/api/doses?session=${s.id}`, { medication_id: "med-amlodipine", slot: "morning" }],
      ["POST", "/api/auth/login", { login: "someone", password: "whatever it is" }],
      ["POST", "/api/push/subscribe", { endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } }],
      ["POST", "/api/upload-url", { kind: "label", content_type: "image/png" }],
      ["PUT", "/api/blob/upload?token=x", {}],
      ["POST", "/api/preflight/upload", {}],
    ] as const) {
      const res = await request.fetch(path, { method, headers: evil, data });
      expect(res.status(), `${method} ${path}`).toBe(403);
      expect(await res.json(), `${method} ${path}`).toEqual({ error: "bad_origin" });
    }
    // only the Origin header, as an older browser sends: the same
    const old = await request.post(`/api/doses?session=${s.id}`, { headers: { origin: "https://evil.example" }, data: {} });
    expect(old.status()).toBe(403);
    // reading is never refused for where it comes from
    expect((await request.get("/api/health", { headers: evil })).status()).toBe(200);
  });

  test("a data route takes JSON only; the byte routes check their own type", async ({ request }) => {
    const s = await createSession(request);
    const rows = async () => JSON.stringify(await (await request.get(`/api/doses?session=${s.id}&day=20`)).json());
    const before = await rows();
    const form = await request.post(`/api/doses?session=${s.id}`, { form: { medication_id: "med-amlodipine", slot: "evening", state: "taken", day: "20" } });
    expect(form.status()).toBe(415);
    expect(await form.json()).toEqual({ error: "invalid_body" });
    const text = await request.post(`/api/doses?session=${s.id}`, { headers: { "content-type": "text/plain" }, data: JSON.stringify({ medication_id: "med-amlodipine", slot: "evening", state: "taken", day: 20 }) });
    expect(text.status()).toBe(415);
    // neither refused write left a trace; the same words as JSON are taken
    expect(await rows() === before, "a refused write changed nothing").toBe(true);
    const json = await request.post(`/api/doses?session=${s.id}`, { data: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } });
    expect(json.status()).toBe(200);
    // a POST with no body at all is fine (several routes take none)
    expect((await request.post("/api/demo/view")).status()).toBe(200);
    // the audio route answers for itself (here: not the Whisper provider, or its own 415 for WebM), never the guard's invalid_body
    const chunk = await request.post(`/api/asr/chunk?session=${s.id}&visit_id=v1&kind=chunk&line=v1-wx-1&offset_ms=0`, { headers: { "content-type": "audio/webm" }, data: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) });
    expect([409, 415]).toContain(chunk.status());
    expect(((await chunk.json()) as { error: string }).error).not.toBe("invalid_body");
  });

  test("the app's own writes pass: a page's fetch, a beacon, and the route the service worker posts to", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await account(context, { space: "example" });
    await page.goto("/p/today");
    const results = await page.evaluate(async () => {
      const post = async (url: string, body: unknown) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status;
      return {
        // what public/sw.js posts when a notification is tapped (an unknown delivery: answered by the route, not refused by the guard)
        opened: await post("/api/push/opened", { delivery: "no-such-delivery" }),
        lang: (await fetch("/api/me")).status,
        beacon: navigator.sendBeacon("/api/ask", new Blob(["{}"], { type: "application/json" })),
      };
    });
    expect(results.opened).not.toBe(403);
    expect(results.opened).not.toBe(415);
    expect(results.lang).toBe(200);
    expect(results.beacon).toBe(true);
    await context.close();
  });
});

test.describe("where signed-in people land", () => {
  test("not set up yet: his pages go to setting up, also on a tap inside the app; the pages setting up hands to stay open", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await account(context, { space: "blank", onboarding: "started" });
    await page.goto("/p/today");
    await page.waitForURL("**/onboard/who");
    await page.goto("/p/me/devices");
    await page.waitForURL("**/onboard/who");
    // the medicines are open: setting up sends him there to photograph a label
    await page.goto("/p/meds/add?from=onboard");
    await expect(page).toHaveURL(/\/p\/meds\/add\?from=onboard$/);
    await page.goto("/p/family");
    await expect(page).toHaveURL(/\/p\/family$/);
    // a tap on the tab bar is a client-side navigation: the proxy answers it too
    await page.goto("/p/meds");
    await page.locator('[data-tab="today"]').first().click();
    await page.waitForURL("**/onboard/who");
    await expect(page.getByTestId("no-session")).toHaveCount(0);
    await context.close();
  });

  test("set up: his pages open", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await account(context, { space: "blank" });
    await page.goto("/p/today");
    await expect(page).toHaveURL(/\/p\/today$/);
    await context.close();
  });

  test("only a family member: /p goes to /f, never 「这台手机还没有登录」", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await account(context, { space: "none" });
    for (const p of ["/p/today", "/p/meds/add", "/p"]) {
      await page.goto(p);
      await page.waitForURL(/\/f(\?|$)/);
      await expect(page.getByTestId("no-session")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("这台手机还没有登录");
    }
    await context.close();
  });

  test("the demo is untouched: a sandbox phone opens Today, a phone whose sandbox is gone still sees the demo's own screen", async ({ browser, request }) => {
    const s = await createSession(request);
    const context = await browser.newContext({ baseURL: BASE_URL, locale: "zh-CN" });
    await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
    const page = await context.newPage();
    await page.goto("/p/today");
    await expect(page).toHaveURL(/\/p\/today$/);
    await expect(page.getByTestId("no-session")).toHaveCount(0);
    await context.clearCookies();
    await context.addCookies([{ name: "rp_session", value: "demo-00000000-0000-4000-8000-000000000000", url: BASE_URL }]);
    await page.goto("/p/today");
    await expect(page.getByTestId("no-session")).toBeVisible();
    await context.close();
  });
});
