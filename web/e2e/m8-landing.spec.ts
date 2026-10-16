/**
 * M8 judges' landing (/demo since C2; "/" redirects there): on desktop (>= 1024 px) Mr Tan's /p/today at D29 20:15 in the judge's own sandbox on the
 * left, the live backstage of the same sandbox on the right; the hero button runs the real /api/ask flow on the
 * phone and the whole answer is on the phone within 4 s of the click (fresh session, first click); 「自己问一句」
 * goes through the same box; 「从第一天开始看」 (the film crew's story clock, C2) moves the sandbox to D0 and the phone shows
 * that beat; at 390 px the page stacks without sideways scroll.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, CREW_HEADERS, createSession, crewCookie, DEMO_ROOT } from "./helpers";

const HERO_ZH = "今天 150/95，我能不能多吃一粒？";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // next dev compiles each route on its first request (a production build has nothing to compile)
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const cookie = { cookie: `rp_session=${s.id}; ${crewCookie().name}=${crewCookie().value}` };
  for (const p of [DEMO_ROOT, "/p/today", "/p/visit", "/p/bp", "/backstage"]) await request.get(p, { headers: cookie });
  await request.post(`/api/ask?session=${s.id}`, { data: { text: HERO_ZH, locale: "zh-Hans", role: "patient" } });
  await request.post(`/api/clock?session=${s.id}`, { data: { beat: "next" }, headers: CREW_HEADERS });
});

async function judge(browser: Browser, opts: { width: number; height: number; lang?: "en"; crew?: boolean }): Promise<{ context: BrowserContext; page: Page }> {
  // C2: the phone follows the browser's language the first time; these judges' browsers are Chinese unless the test
  // picks the phone's language itself (the rp_lang cookie wins)
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: opts.width, height: opts.height }, locale: "zh-CN" });
  if (opts.lang) await context.addCookies([{ name: "rp_lang", value: opts.lang, url: BASE_URL }]);
  if (opts.crew) await context.addCookies([crewCookie()]);
  const page = await context.newPage();
  const res = await page.goto(DEMO_ROOT);
  expect(res?.status()).toBe(200);
  return { context, page };
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(client);
}

test("desktop: phone at D29 8:15pm on the left, live backstage on the right; the hero answers on the phone within 4 s of the first click", async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await judge(browser, { width: 1440, height: 900 });
  const hero = page.getByTestId("hero-button");
  await expect(hero).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(hero).toContainText("问：今天 150/95，我能不能多吃一粒？");

  // a fresh sandbox of this judge, on Day 29 at 8:15pm
  const sid = (await context.cookies()).find((c) => c.name === "rp_session")!.value;
  const session = (await (await page.request.get(`/api/session?session=${sid}`)).json()).session;
  expect(session).toMatchObject({ story_day: 29, story_time: "20:15" });
  expect(session.expires_at).not.toBeNull();
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  await expect(page.getByTestId("backstage-day-label")).toContainText("Day 29");

  // split view: phone left, backstage right, side by side
  const phoneBox = (await page.getByTestId("landing-phone-frame").boundingBox())!;
  const feedBox = (await page.getByTestId("event-feed").boundingBox())!;
  expect(phoneBox.x + phoneBox.width).toBeLessThanOrEqual(feedBox.x);
  expect(feedBox.y).toBeLessThan(phoneBox.y + phoneBox.height);
  await noSidewaysScroll(page);

  // the first click: the whole answer on the phone within 4 s
  const t0 = Date.now();
  await hero.click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 4000 });
  await expect(phone.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible({ timeout: 4000 });
  await expect(phone.getByTestId("ask-question-added")).toBeVisible({ timeout: 4000 });
  const ms = Date.now() - t0;
  expect(ms).toBeLessThan(4000);
  test.info().annotations.push({ type: "landing_hero_click_to_answer_ms", description: String(ms) });

  // it is the real flow on the phone: the hero question, R4 verbatim (医生说), the label, the question on the list
  await expect(phone.getByTestId("ask-asked")).toHaveText(`“${HERO_ZH}”`);
  const r4 = phone.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4.getByTestId("answer-text")).toHaveText(R4);
  await expect(r4.getByTestId("answer-chip")).toHaveText("● 医生说");
  await expect(phone.locator('[data-testid="answer-line"][data-source^="label:"]')).toBeVisible();
  const timing = page.getByTestId("hero-timing");
  await expect(timing).toBeAttached();
  expect(Number(await timing.getAttribute("data-ms"))).toBeLessThan(4000);

  // the backstage of the same sandbox shows the steps, the refused request highlighted
  const feed = page.getByTestId("event-feed");
  await expect(feed.locator('[data-testid="event-row"][data-type="ask.received"]')).toHaveCount(1, { timeout: 4000 });
  const blocked = feed.locator('[data-testid="event-row"][data-type="ask.blocked"]');
  await expect(blocked.first()).toHaveAttribute("data-tone", "blocked");
  await expect(blocked.first().getByTestId("event-badge")).toHaveText(/Blocked/);
  for (const t of ["ask.route", "verify.layer1", "verify.layer2", "verify.layer3", "ask.answered"]) {
    await expect(feed.locator(`[data-testid="event-row"][data-type="${t}"]`)).toHaveCount(1);
  }
  await context.close();
});

test("English phone: the hero label is English and the answer says Doctor said; 自己问一句 goes through the same box", async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await judge(browser, { width: 1280, height: 900, lang: "en" });
  const hero = page.getByTestId("hero-button");
  await expect(hero).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(hero).toHaveText("Ask: “Today 150/95, can I take one more tablet?”");
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  const t0 = Date.now();
  await hero.click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 4000 });
  await expect(phone.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]').getByTestId("answer-chip")).toHaveText("● Doctor said");
  expect(Date.now() - t0).toBeLessThan(4000);
  await expect(phone.getByTestId("ask-asked")).toHaveText("“Today 150/95, can I take one more tablet?”");

  // the judge's own sentence: typed on the landing, asked on the phone, seen on the backstage
  const own = "What is amlodipine for?";
  await page.getByTestId("own-question-input").fill(own);
  await page.getByTestId("own-question-send").click();
  await expect(phone.getByTestId("ask-asked")).toHaveText(`“${own}”`, { timeout: 10_000 });
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true");
  await expect(phone.getByTestId("answer-line").first()).toBeVisible();
  await expect(page.getByTestId("event-feed").getByTestId("event-sentence").filter({ hasText: own })).toHaveCount(1, { timeout: 4000 });
  await context.close();
});

test("从第一天开始看 (the film crew's story clock): the sandbox goes to D0 and the phone shows the first visit; then beat by beat", async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await judge(browser, { width: 1440, height: 900, crew: true });
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await page.getByTestId("landing-from-day-one").click();
  await expect(page.getByTestId("landing-day")).toHaveText("Day 0 · Mon 9:30am", { timeout: 10_000 });
  await expect(phone.getByTestId("story-day-label")).toHaveText("第0天 · 周一 上午9:30", { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="landing-phone"]') as HTMLIFrameElement).contentWindow?.location.pathname)).toBe("/p/visit");
  const sid = (await context.cookies()).find((c) => c.name === "rp_session")!.value;
  expect((await (await page.request.get(`/api/session?session=${sid}`)).json()).session).toMatchObject({ story_day: 0, story_time: "09:30" });
  // the backstage on the right follows the clock
  await expect(page.getByTestId("backstage-day-label")).toContainText("Day 0");
  // next beat: Day 1 morning, the blood pressure page
  await page.getByTestId("landing-next-beat").click();
  await expect(page.getByTestId("landing-day")).toHaveText("Day 1 · Tue 7:40am", { timeout: 10_000 });
  await expect(phone.getByTestId("story-day-label")).toHaveText("第1天 · 周二 上午7:40", { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="landing-phone"]') as HTMLIFrameElement).contentWindow?.location.pathname)).toBe("/p/bp");
  await context.close();
});

test("390 px: the landing stacks (phone, then the controls and backstage) with no sideways page scroll", async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page } = await judge(browser, { width: 390, height: 844 });
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await noSidewaysScroll(page);
  const phoneBox = (await page.getByTestId("landing-phone-frame").boundingBox())!;
  const heroBox = (await page.getByTestId("hero-button").boundingBox())!;
  const feedBox = (await page.getByTestId("event-feed").boundingBox())!;
  expect(phoneBox.width).toBeLessThanOrEqual(390);
  expect(heroBox.y).toBeGreaterThan(phoneBox.y + phoneBox.height - 1);
  expect(feedBox.y).toBeGreaterThan(heroBox.y);
  for (const box of [phoneBox, heroBox, feedBox]) expect(box.x + box.width).toBeLessThanOrEqual(390);
  // still works stacked
  await page.getByTestId("hero-button").click();
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 4000 });
  await noSidewaysScroll(page);
  await context.close();
});
