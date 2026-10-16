/**
 * The demo fence and the judges' pages (C2 track E; docs/plan/real-app.md 5.2, 5.3, 8.6 demo-fence and
 * demo-with-account; real-status "导演台和评委页"):
 *   1. without the film crew's cookie the crew's pages (/director, /backstage, /backstage/real, /join) and routes (the
 *      story clock, the cues, filming mode, the replay, reset, the real recording) answer 404, /demo has no story-clock
 *      buttons and the navigation no crew links; with the cookie they are all there;
 *   2. /demo reads plainly: one intro line, the phone at Day 29 8:15pm, a reason under a button that cannot be pressed,
 *      no join code and no filming words, Singapore times, plural counts, the links to the phone view and to the real
 *      app on a phone; the old addresses redirect; the phone follows the browser's language;
 *   3. a browser signed in to an account sees the demo copy on /demo with "Back to my account", and its own account,
 *      on its real date and without the crew's chrome, on /p/today afterwards; what is tapped on one side stays there;
 *   4. /eval shows real results, /how shows what runs here; the page checks pass on these pages.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "../_checks/page-checks";
import { BASE_URL, CREW_HEADERS, crewCookie, DEMO_ROOT, waitLive } from "../helpers";

const CREW_PAGES = ["/director", "/backstage", "/backstage/real", "/join"];

async function judgeContext(browser: import("@playwright/test").Browser, opts: { locale?: string; crew?: boolean; width?: number } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: opts.width ?? 1440, height: 900 }, ...(opts.locale ? { locale: opts.locale } : {}) });
  if (opts.crew) await context.addCookies([crewCookie()]);
  return context;
}

/** /demo ready: the copy made, the view and language set, the phone live in its frame. */
async function openDemo(page: Page): Promise<void> {
  expect((await page.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await waitLive(page);
}

const sessionOf = async (context: BrowserContext) => (await context.cookies()).find((c) => c.name === "rp_session")!.value;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // next dev compiles each route on its first request
  for (const p of [DEMO_ROOT, "/eval", "/how", "/p/today", "/backstage/crew"]) await request.get(p);
});

test("without the crew's cookie: the crew's pages and routes do not exist, /demo has no story clock; with it, all are there", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await judgeContext(browser);
  const page = await context.newPage();
  await openDemo(page);
  const sid = await sessionOf(context);
  await expect(page.getByTestId("landing-story")).toHaveCount(0);
  await expect(page.getByTestId("staff-nav")).toHaveAttribute("data-crew", "false");
  await expect(page.getByTestId("staff-nav").getByRole("link")).toHaveText(["Demo", "Evaluation", "How it works"]);
  for (const route of CREW_PAGES) expect((await page.request.get(route)).status(), route).toBe(404);
  const q = `?session=${sid}`;
  for (const [route, data] of [
    [`/api/clock${q}`, { day: 3 }],
    [`/api/director/cue${q}`, { cue: "reminder" }],
    [`/api/director/filming${q}`, { on: false }],
    [`/api/director/replay${q}`, { action: "stop" }],
    [`/api/session/reset${q}`, {}],
    ["/api/real", { consultation: "day1_consultation06" }],
    ["/api/session", { kind: "filming" }],
  ] as const) {
    const res = await page.request.post(route, { data });
    expect(res.status(), route).toBe(404);
    expect(await res.json(), route).toEqual({ error: "not_found" });
  }
  expect(((await (await page.request.get(`/api/session${q}`)).json()) as { session: { story_day: number } }).session.story_day).toBe(29);
  await context.close();

  // the crew's browser: the same pages answer, the story clock is on /demo, the navigation lists the crew's pages
  const crew = await judgeContext(browser, { crew: true });
  const cp = await crew.newPage();
  await openDemo(cp);
  await expect(cp.getByTestId("landing-story")).toBeVisible();
  await expect(cp.getByTestId("staff-nav")).toHaveAttribute("data-crew", "true");
  for (const route of CREW_PAGES) expect((await cp.request.get(route)).status(), route).toBe(200);
  const csid = await sessionOf(crew);
  expect((await cp.request.post(`/api/clock?session=${csid}`, { data: { day: 99 } })).status()).toBe(400);
  expect((await cp.request.post(`/api/clock?session=${csid}`, { data: { day: 43 } })).status()).toBe(200);
  await crew.close();
});

test("/demo reads plainly: intro, the phone at Day 29 8:15pm, reasons, no code or filming words, Singapore times, the phone links", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await judgeContext(browser, { locale: "zh-CN" });
  const page = await context.newPage();
  await openDemo(page);
  await expect(page.getByTestId("demo-intro-line")).toContainText("Mr Tan is 67");
  await expect(page.getByTestId("demo-intro-line")).toContainText("Ripple keeps what the doctor said");
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  // a judge's phone has no crew chrome
  await expect(phone.getByTestId("jump-menu")).toHaveCount(0);
  await expect(phone.getByTestId("debug-info")).toHaveCount(0);
  // a button that cannot be pressed says why
  await expect(page.getByTestId("own-question-send")).toBeDisabled();
  await expect(page.getByTestId("own-question-why")).toHaveText("Type a sentence first, as Mr Tan would.");
  // the copy's line: no join code, Singapore time
  const sid = await sessionOf(context);
  const session = ((await (await page.request.get(`/api/session?session=${sid}`)).json()) as { session: { join_code: string } }).session;
  const text = await page.locator("main").innerText();
  expect(text).not.toContain(session.join_code);
  await expect(page.getByTestId("landing-sandbox")).toContainText("(Singapore time)");
  for (const word of ["Hero shot", "rehearsal", "sandbox", "beat", "v3 direction", "verify.layer", "rule:"]) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
  // the phone links: the same copy in its own tab, and the real app on a judge's phone
  await expect(page.getByTestId("open-phone-tab")).toHaveAttribute("href", "/p/today");
  // the judge's own phone starts at the front door (welcome page: 注册 / 登录), lib/crew/demo-view.ts PHONE_APP_PATH
  await expect(page.getByTestId("phone-app-url")).toHaveText(`${BASE_URL}/`);
  await expect(page.getByTestId("phone-app-qr")).toHaveAttribute("aria-label", `QR code of ${BASE_URL}/`);

  // the hero question: the backstage rows in Singapore time, no event names, counted in steps
  await page.getByTestId("hero-button").click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 6000 });
  const row = page.locator('[data-testid="event-row"][data-type="ask.received"]').first();
  await expect(row).toBeVisible({ timeout: 4000 });
  const iso = (await row.getByTestId("event-time").getAttribute("datetime"))!;
  const sgt = new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(11, 19);
  await expect(row.getByTestId("event-time")).toHaveText(sgt);
  await expect(page.getByTestId("event-count")).toContainText(/\d+ steps · newest at the bottom · Singapore time/);
  const feed = await page.getByTestId("event-feed").innerText();
  expect(feed).not.toMatch(/\bask\.received\b|\bverify\.layer\d\b|\brule:/);
  await expect(page.locator('[data-testid="event-row"][data-type="ask.route"]').first().getByTestId("event-sentence")).toContainText("Sorted as a request that is not Ripple's to answer");
  await context.close();
});

test("the old addresses: /try leads to /demo; /demo/try is not a page of its own; / is the app's welcome page", async ({ request }) => {
  const front = await request.get("/", { maxRedirects: 0 });
  expect(front.status()).toBe(200);
  expect(front.headers()["set-cookie"] ?? "").not.toMatch(/rp_session=|rp_view=/);
  for (const [from, to] of [["/try", "/demo/try"]] as const) {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(307);
    expect(new URL(res.headers().location, BASE_URL).pathname, from).toBe(to);
  }
  const tryRes = await request.get("/demo/try", { maxRedirects: 0 });
  expect(tryRes.status()).toBe(307);
  expect(new URL(tryRes.headers().location, BASE_URL).pathname).toBe(DEMO_ROOT);
});

test("the phone follows the browser's language the first time", async ({ browser }) => {
  test.setTimeout(90_000);
  for (const [locale, lang, hero] of [
    ["en-US", "en", "Ask: “Today 150/95, can I take one more tablet?”"],
    ["zh-CN", "zh-Hans", "问：今天 150/95，我能不能多吃一粒？"],
  ] as const) {
    const context = await judgeContext(browser, { locale });
    const page = await context.newPage();
    await openDemo(page);
    expect((await context.cookies()).find((c) => c.name === "rp_lang")?.value, locale).toBe(lang);
    await expect(page.frameLocator('[data-testid="landing-phone"]').locator(".rp-patient").first()).toHaveAttribute("lang", lang);
    await expect(page.getByTestId("hero-button")).toContainText(hero);
    await context.close();
  }
});

test("signed in to an account: /demo shows the demo copy and Back to my account; /p/today is the account again; nothing crosses", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await judgeContext(browser, { locale: "zh-CN" });
  const login = `judge${Date.now().toString(36)}`;
  const made = await context.request.post("/api/dev/accounts", { data: { login, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  // his own records before the demo (read as the account: no rp_view yet)
  const before = await (await context.request.get("/api/doses")).json();
  const page = await context.newPage();
  await openDemo(page);
  // the frame is the demo copy (the story's Day 29), not his account
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  await expect(page.getByTestId("demo-account-banner")).toContainText("演示中");
  expect((await context.cookies()).find((c) => c.name === "rp_view")?.value).toBe("demo");
  // a tick in the demo copy lands in the copy
  const sid = await sessionOf(context);
  const tick = await page.request.post(`/api/doses?session=${sid}`, { data: { medication_id: "med-amlodipine", slot: "morning", state: "missed", day: 29 } });
  expect(tick.status()).toBe(200);
  const copy = (await (await page.request.get(`/api/doses?session=${sid}&from=29&to=29`)).json()) as { doses: { state: string }[] };
  expect(copy.doses.map((d) => d.state)).toContain("missed");

  await page.getByTestId("demo-back-to-account").click();
  await page.waitForURL((u) => u.pathname === "/p/today", { timeout: 20_000 });
  expect((await context.cookies()).find((c) => c.name === "rp_view")).toBeUndefined();
  // his own Today: the real date, no story day, no crew chrome
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/第\s*\d+\s*天|Day \d+/);
  await expect(page.getByTestId("jump-menu")).toHaveCount(0);
  await expect(page.getByTestId("debug-info")).toHaveCount(0);
  await expect(page.getByTestId("story-day-label")).toHaveCount(0);
  // the demo's tick did not reach the account
  expect(await (await page.request.get("/api/doses")).json()).toEqual(before);

  // the other direction (C2 follow-up, track E; 8.6 「两边点的东西互不进入」): a reading he records on his own account
  // is in his account and not in the demo copy he opens afterwards
  const reading = /"systolic":137,"diastolic":83/;
  const own = await page.request.post("/api/bp", { data: { systolic: 137, diastolic: 83 } });
  expect(own.status(), await own.text()).toBe(201);
  expect(JSON.stringify(await own.json())).toMatch(reading);
  await openDemo(page);
  expect((await context.cookies()).find((c) => c.name === "rp_view")?.value).toBe("demo");
  const copyNow = await sessionOf(context);
  const demoReadings = await page.request.get(`/api/bp?session=${copyNow}`);
  expect(demoReadings.status()).toBe(200);
  expect(JSON.stringify(await demoReadings.json())).not.toMatch(reading);
  await context.close();
});

test("/eval shows the real results; /how shows what runs here without paths or ports", async ({ page }) => {
  expect((await page.goto("/eval"))?.status()).toBe(200);
  await expect(page.getByTestId("eval-live-score")).toHaveText("51 of 51 passed");
  await expect(page.getByTestId("eval-live-meta")).toContainText("(Singapore time)");
  await expect(page.getByTestId("eval-live-meta")).toContainText("DeepSeek deepseek-flash");
  await expect(page.getByTestId("eval-offline-score")).toHaveText("51 of 51 passed");
  await expect(page.getByTestId("eval-live-categories")).toContainText("Asking to change the dose (must be refused)");
  const evalText = (await page.locator("main").textContent()) ?? "";
  expect(evalText).not.toMatch(/[A-Z]:\\|llm-spend|\.jsonl?\b|M8|built in/);

  expect((await page.goto("/how"))?.status()).toBe(200);
  await expect(page.getByTestId("how-box-database").getByTestId("how-box-running")).toContainText("On this server:");
  await expect(page.getByTestId("trust-storage-summary")).toBeVisible();
});

test("page checks on the judges' and the crew's pages (desktop: text at least 16 px, targets at least 44 px, contrast AA, no sideways scroll at 360 px)", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await judgeContext(browser, { crew: true });
  const page = await context.newPage();
  // the phone in the frame is Mr Tan's page, checked with the phone pages; the gallery-free desktop page around it here
  const allow = ['[data-testid="landing-phone"]'];
  await openDemo(page);
  await expectPageChecks(page, { side: "family", allow });
  for (const route of ["/eval", "/how", "/backstage/crew", "/director", "/backstage"]) {
    await page.goto(route);
    if (route === "/director" || route === "/backstage") await waitLive(page);
    await expectPageChecks(page, { side: "family" });
  }
  // the same as a judge (no crew links, no story clock)
  const judge = await judgeContext(browser);
  const jp = await judge.newPage();
  await openDemo(jp);
  await expectPageChecks(jp, { side: "family", allow });
  await judge.close();
  await context.close();
});

test.describe("the crew key over the API", () => {
  test.use({ extraHTTPHeaders: CREW_HEADERS });
  test("the header opens the routes for a script (the journey kit and the e2e harness use it)", async ({ request }) => {
    const s = (await (await request.post("/api/session", { data: { story_day: 29, story_time: "20:15" } })).json()) as { session: { id: string } };
    const res = await request.post(`/api/clock?session=${s.session.id}`, { data: { beat: "d42-visit", show: true } });
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { beat: { id: string } }).beat.id).toBe("d42-visit");
    const replay = await request.post(`/api/director/replay?session=${s.session.id}`, { data: { action: "start" } });
    expect(await replay.json()).toEqual({ visit: "v3", path: "/p/visit?replay=v3" });
  });
});
