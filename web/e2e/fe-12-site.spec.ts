/**
 * Front-end line fe-12 (web/progress/fe-12.md), in a real browser with the automatic page checks
 * (e2e/_checks/page-checks.ts: no sideways scroll at 360px, no text under 18px, no target under 48x48, AA contrast):
 *
 *   the watch            Today's cell and the trends screen in every state the screens can be in (asking, 要, 不要; each
 *                        of the three numbers), in 华语 and in English
 *   the not-found page   one plain sentence and one way on, the same page for an address that never existed and for a
 *                        visit, a medicine or a family link that is not his; 404 each time; signed in (to Today), a
 *                        family member without a space of her own (her own dark look, to /f), nobody signed in (to the
 *                        front door); both languages
 *   the fault screen     a page that cannot be drawn: this line's plain sentence when the fault is the page's own,
 *                        track A's fixed sentences when it is the store's; 「再试一次」 that brings the page back, a
 *                        second way on to Today; nothing of the fault itself on the screen; and the page the proxy
 *                        sends when it sees the store's fault first, which is the same screen
 *   the page on its way  the thin bar at the top after a tap on the tab bar when the next page takes its time, the
 *                        screen marked busy, gone when the page is there and after 8 s at the latest; the same for a
 *                        page change that code starts (router.push); never for a change of ?query alone that code
 *                        makes, never on a page made for a computer
 *
 * Runs against a production build with the developer tools on (node scripts/record/serve.mjs --port <port> --build;
 * PW_PORT names it): the fault screen is the app's error boundary, which `next dev` covers with its own overlay.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { STORE_UNAVAILABLE_WORDS, storeUnavailablePage } from "@/lib/subject/unavailable";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

/** A test account signed in on this browser (the foundation's developer tool). */
async function account(context: BrowserContext, space: "example" | "blank" | "none" = "example"): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `x${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
  if (space === "example") await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
}

async function language(page: Page, baseURL: string | undefined, lang: "zh-Hans" | "en"): Promise<void> {
  await page.context().addCookies([{ name: "rp_lang", value: lang, url: baseURL! }]);
}

const pathOf = (url: URL | string) => new URL(String(url)).pathname;

test.beforeAll(async ({ request }) => {
  // Mon 12 Oct 2026, 08:00: before the morning reminder, so Today is the day's overview (the watch has its entry)
  const res = await request.post("/api/dev/clock", { data: { at: SGT("2026-10-12", "08:00"), frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
});

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

// ------------------------------------------------------------------------------------------------ the watch

for (const lang of ["zh-Hans", "en"] as const) {
  test(`the watch in each of its states passes the page checks (${lang})`, async ({ browser, baseURL }) => {
    const zh = lang === "zh-Hans";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await language(page, baseURL, lang);
    await account(context);

    // Today's cell, asking
    await page.goto("/p/today");
    const cell = page.getByTestId("today-watch");
    await expect(cell.getByTestId("watch-yes")).toHaveText(zh ? "要" : "Yes");
    await expect(page.locator('[data-today-section="watch"]')).toHaveAttribute("data-node", "wch");
    await expectPageChecks(page, { side: "elder" });

    // the trends screen: the three numbers, one at a time
    await cell.getByTestId("watch-trends-link").click();
    await page.waitForURL(/\/p\/watch$/);
    await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "手表" : "Watch");
    await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
    for (const metric of ["rhr", "sleep", "steps"] as const) {
      await page.getByTestId("watch-pick").locator(`[data-seg="${metric}"]`).click();
      await expect(page.getByTestId("watch-pick")).toHaveAttribute("data-shown", metric);
      await expect(page.locator(`[data-testid="watch-trend"][data-metric="${metric}"]`)).toBeVisible();
      await expect(page.locator('[data-testid="watch-trend"]:visible')).toHaveCount(1);
      await expect(page.locator('[data-testid="watch-weeks"]:visible')).toHaveCount(1);
      await expectPageChecks(page, { side: "elder" });
    }
    // the way back is Today
    await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/today");

    // 要: the tick is an entry of its own here, and sits in the watch's entry on Today
    await page.getByTestId("watch-yes").click();
    await expect(page.getByTestId("watch-card")).toHaveAttribute("data-state", "added");
    await expect(page.getByTestId("watch-added")).toHaveAttribute("data-node", "ok");
    await expectPageChecks(page, { side: "elder" });
    await page.goto("/p/today");
    await expect(cell.getByTestId("watch-added")).toBeVisible();
    await expect(cell.getByTestId("watch-yes")).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });
    await cell.getByTestId("watch-added").getByRole("link").click();
    await page.waitForURL(/\/p\/questions$/);
    await context.close();

    // 不要: Today's entry folds to its head line and one sentence; the trends screen keeps the observation
    const second = await browser.newContext({ baseURL });
    const p2 = await second.newPage();
    await language(p2, baseURL, lang);
    await account(second);
    await p2.goto("/p/today");
    const cell2 = p2.getByTestId("today-watch");
    await cell2.getByTestId("watch-no").click();
    await expect(cell2.getByTestId("watch-declined")).toHaveText(zh ? "好，不加。" : "OK, not added.");
    await expect(cell2.getByTestId("watch-sentence")).toHaveCount(0);
    await expect(cell2.getByTestId("watch-trends-link")).toBeVisible();
    await expectPageChecks(p2, { side: "elder" });
    await p2.goto("/p/watch");
    await expect(p2.getByTestId("watch-card")).toHaveAttribute("data-state", "declined");
    await expect(p2.getByTestId("watch-sentence")).toBeVisible();
    await expectPageChecks(p2, { side: "elder" });
    await second.close();
  });
}

// ------------------------------------------------------------------------------------------------ not found

/** What the not-found page shows, and that it is a 404 that names nothing of what was asked for. */
async function seeNotFound(page: Page, address: string): Promise<string> {
  const res = await page.goto(address);
  expect(res?.status(), address).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
  // the tab's title is the app's own: no code, no "not found" (the framework's own page would say both)
  expect(await page.title()).toMatch(/^Ripple/);
  expect(await page.title()).not.toMatch(/404|found|找不到/i);
  const shown = await page.locator("body").innerText();
  // never a code, never the framework's own page, never an apology
  expect(shown).not.toMatch(/404|not be found|not found|找不到|不存在|抱歉|对不起|sorry/i);
  // nothing of the address he asked for
  for (const part of address.split(/[/?=&]/).filter((s) => s.length > 5)) expect(shown, `${address} shows ${part}`).not.toContain(part);
  return shown;
}

for (const lang of ["zh-Hans", "en"] as const) {
  test(`an address that cannot be opened, nobody signed in: one sentence and the way to the front door (${lang})`, async ({ page, baseURL }) => {
    const zh = lang === "zh-Hans";
    await language(page, baseURL, lang);
    const unknown = await seeNotFound(page, "/there-is-no-such-page-kq7");
    await expect(page.getByTestId("not-found-words")).toHaveText(zh ? "这个地址打不开。" : "This address cannot be opened.");
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-way", "front");
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-look", "elder");
    await expect(page.getByTestId("not-found-on")).toHaveText(zh ? "回到首页" : "Go to the front page");
    await expect(page.getByTestId("not-found-on")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("not-found")).toHaveAttribute("lang", lang);
    await expectPageChecks(page, { side: "elder" });
    const title = await page.title();
    // the crew's door answers a stranger the same way: the same page, word for word, under the same title
    for (const door of ["/director", "/join", "/backstage"]) {
      expect(await seeNotFound(page, door), door).toBe(unknown);
      expect(await page.title(), door).toBe(title);
    }
    // the way on works
    await page.getByTestId("not-found-on").click();
    await expect(page.getByTestId("front-door")).toBeVisible();
  });

  test(`an address that cannot be opened, signed in: the same page for "not there" and "not his", and the way back to Today (${lang})`, async ({ browser, baseURL }) => {
    const zh = lang === "zh-Hans";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await language(page, baseURL, lang);
    await account(context);
    const unknown = await seeNotFound(page, "/p/there-is-no-such-page-kq7");
    await expect(page.getByTestId("not-found-words")).toHaveText(zh ? "这个地址打不开。" : "This address cannot be opened.");
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-way", "today");
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-look", "elder");
    await expect(page.getByTestId("not-found-on")).toHaveText(zh ? "回到今天" : "Back to Today");
    await expect(page.getByTestId("not-found-on")).toHaveAttribute("href", "/p/today");
    // a root not-found page stands alone: no tab bar, no 「我」, no example line
    await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
    await expect(page.locator('[data-kind="me"]')).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });
    // a visit, a medicine, a family link, a question that are not his (or not there: the page cannot be told apart)
    for (const address of ["/p/visit/visit-of-someone-else/review", "/p/meds/medicine-of-someone-else", "/p/family/link-of-someone-else", "/p/profile/times/teatime", "/nowhere-at-all-kq7"]) {
      expect(await seeNotFound(page, address), address).toBe(unknown);
    }
    await page.getByTestId("not-found-on").click();
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    await context.close();
  });
}

for (const lang of ["zh-Hans", "en"] as const) {
  test(`an address that cannot be opened, a family member with no space of her own: her own dark look, and the way on is her home (${lang})`, async ({ browser, baseURL }) => {
    const zh = lang === "zh-Hans";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await language(page, baseURL, lang);
    await account(context, "none");
    const shown = await seeNotFound(page, "/f/there-is-no-such-page-kq7");
    await expect(page.getByTestId("not-found")).toHaveAttribute("lang", lang);
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-way", "family");
    await expect(page.getByTestId("not-found-way")).toHaveAttribute("data-look", "family");
    await expect(page.getByTestId("not-found-words")).toHaveText(zh ? "这个地址打不开。" : "This address cannot be opened.");
    await expect(page.getByTestId("not-found-on")).toHaveText(zh ? "回到首页" : "Go to the front page");
    await expect(page.getByTestId("not-found-on")).toHaveAttribute("href", "/f");
    // her screen, not his: the dark ground, her one solid button, nothing of the elder pieces
    await expect(page.locator('[data-rp="family-screen"]')).toHaveCount(1);
    await expect(page.locator('[data-rp="screen"]')).toHaveCount(0);
    expect(await page.locator('[data-rp="family-screen"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(10, 12, 15)");
    await expectPageChecks(page, { side: "family" });
    // one of his pages asked for by her: the proxy sends her home before any page is drawn; an address under his pages
    // that is no page at all is the same sentence
    expect(await seeNotFound(page, "/nowhere-at-all-kq7")).toBe(shown);
    await page.getByTestId("not-found-on").click();
    await expect(page.getByTestId("family-app")).toBeVisible();
    await context.close();
  });
}

// ------------------------------------------------------------------------------------------------ the fault screen

/**
 * A page that cannot be drawn, made in the browser: Today reads navigator.onLine while it is drawn (the offline note),
 * so a getter that throws when the test says so is a fault in the page itself. The fault's own text carries a marker
 * that must never be on the screen. `store: true` gives the fault the digest track A's StoreUnavailable carries: that
 * digest is all the browser gets of a fault thrown on the server, so the boundary sees the same thing either way.
 */
async function faultOnDemand(page: Page, opts: { store?: boolean } = {}): Promise<void> {
  await page.addInitScript((asStore) => {
    const own = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get() {
        if ((window as unknown as { __fault?: boolean }).__fault) {
          const fault = new Error("made by the test: marker-4711");
          if (asStore) (fault as Error & { digest?: string }).digest = "RIPPLE_STORE_UNAVAILABLE";
          throw fault;
        }
        return own?.get ? own.get.call(this) : true;
      },
    });
  }, opts.store === true);
}

async function breakThePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __fault?: boolean }).__fault = true;
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.getByTestId("store-unavailable")).toBeVisible();
}

for (const lang of ["zh-Hans", "en"] as const) {
  test(`a page that cannot be drawn: one plain sentence, 再试一次 brings it back, and a second way on (${lang})`, async ({ browser, baseURL }) => {
    const zh = lang === "zh-Hans";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await language(page, baseURL, lang);
    await faultOnDemand(page);
    await account(context);
    await page.goto("/p/today");
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");

    await breakThePage(page);
    const screen = page.getByTestId("store-unavailable");
    // not the store's sentence: this fault is the page's own
    await expect(screen).toHaveAttribute("data-fault", "page");
    await expect(screen).toHaveAttribute("lang", lang);
    await expect(screen.locator("h1")).toHaveText(zh ? "这一页这次没打开。" : "This page did not open this time.");
    await expect(screen).toContainText(zh ? "你记下的东西都还在。" : "Everything you saved is still there.");
    await expect(screen).not.toContainText(zh ? "读不到资料" : "cannot read your records");
    await expect(page.getByTestId("store-unavailable-retry")).toHaveText(zh ? "再试一次" : "Try again");
    await expect(page.getByTestId("fault-way-on")).toHaveText(zh ? "先看今天" : "Go to Today");
    await expect(page.getByTestId("fault-way-on")).toHaveAttribute("href", "/p/today");
    // nothing of the fault itself, and the page under it is gone whole (his tab bar too)
    const shown = await page.locator("body").innerText();
    expect(shown).not.toMatch(/marker-4711|made by the test|Error|digest|\b5\d\d\b|抱歉|sorry/i);
    await expect(page.getByTestId("page-today")).toHaveCount(0);
    await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });

    // 再试一次 with the fault still there: the page is asked for and drawn again, fails again, and the same screen
    // stands there anew (a fresh one: the one he tapped carries the mark), not a blank page
    await screen.evaluate((el) => el.setAttribute("data-tapped", "1"));
    const asked = page.waitForRequest((r) => pathOf(r.url()) === "/p/today" && r.url().includes("_rsc="));
    await page.getByTestId("store-unavailable-retry").click();
    await asked;
    await expect(page.locator('[data-testid="store-unavailable"]:not([data-tapped])')).toBeVisible();
    await expect(page.locator('[data-testid="store-unavailable"]')).toHaveCount(1);
    await expect(page.getByTestId("page-today")).toHaveCount(0);
    // the fault is over: 再试一次 brings the page back
    await page.evaluate(() => ((window as unknown as { __fault?: boolean }).__fault = false));
    await page.getByTestId("store-unavailable-retry").click();
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    await expect(page.getByTestId("store-unavailable")).toHaveCount(0);

    // the second way on: a fresh load of Today (the fault does not follow him there)
    await breakThePage(page);
    await page.getByTestId("fault-way-on").click();
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    await expect(page.getByTestId("store-unavailable")).toHaveCount(0);
    expect(pageErrors.join("\n")).not.toMatch(/hydrat/i);
    await context.close();
  });

  test(`the records could not be read: track A's fixed sentences on the same screen, and the two ways on (${lang})`, async ({ browser, baseURL }) => {
    const zh = lang === "zh-Hans";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await language(page, baseURL, lang);
    await faultOnDemand(page, { store: true });
    await account(context);
    await page.goto("/p/today");
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");

    await breakThePage(page);
    const screen = page.getByTestId("store-unavailable");
    await expect(screen).toHaveAttribute("data-fault", "store");
    await expect(screen.locator("h1")).toHaveText(zh ? "现在读不到资料。" : "Ripple cannot read your records right now.");
    await expect(screen).toContainText(zh ? "所以先不显示。你记下的东西都还在，过一会儿再试一次。" : "So nothing is shown. Everything you saved is still there. Try again in a moment.");
    await expect(page.getByTestId("store-unavailable-retry")).toHaveText(zh ? "再试一次" : "Try again");
    await expect(page.getByTestId("fault-way-on")).toHaveAttribute("data-way", "today");
    expect(await page.locator("body").innerText()).not.toMatch(/marker-4711|RIPPLE_STORE|digest|抱歉|sorry/i);
    await expectPageChecks(page, { side: "elder" });
    await context.close();
  });
}

test("the app's own CSS never arrived: the screen for a page that cannot be drawn still holds, sizes and colours and all", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  // every stylesheet of the app is refused: the tokens, the fonts, the foundation's classes are all gone
  await context.route(/\/_next\/static\/.*\.css(\?.*)?$/, (route) => route.abort());
  const page = await context.newPage();
  await faultOnDemand(page);
  await account(context);
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rp-accent").trim())).toBe("");

  await breakThePage(page);
  const screen = page.getByTestId("store-unavailable");
  await expect(screen.locator("h1")).toHaveText("这一页这次没打开。");
  const look = await screen.evaluate((el) => {
    const css = (sel: string) => getComputedStyle(el.querySelector(sel)!);
    const px = (v: string) => Math.round(parseFloat(v));
    return {
      ground: getComputedStyle(el).backgroundColor,
      ink: getComputedStyle(el).color,
      column: px(getComputedStyle(el).maxWidth),
      box: [css('[role="alert"]').backgroundColor, css('[role="alert"]').borderTopColor],
      title: px(css("h1").fontSize),
      body: px(css('[role="alert"] p').fontSize),
      retry: [css("button").backgroundColor, css("button").color, px(css("button").fontSize), px(css("button").minHeight)],
      on: [css("a").borderTopColor, css("a").color, px(css("a").fontSize), px(css("a").minHeight)],
    };
  });
  expect(look).toEqual({
    ground: "rgb(242, 245, 249)",
    ink: "rgb(24, 32, 44)",
    column: 430,
    box: ["rgb(255, 255, 255)", "rgb(164, 38, 44)"],
    title: 22,
    body: 19,
    retry: ["rgb(106, 76, 147)", "rgb(255, 255, 255)", 26, 72],
    on: ["rgb(24, 32, 44)", "rgb(24, 32, 44)", 23, 64],
  });
  // nothing under 18px, both targets 48 or more, AA contrast, no sideways scroll: by itself, without the app's CSS
  await expectPageChecks(page, { side: "elder" });
  // and both ways on work from there
  await page.evaluate(() => ((window as unknown as { __fault?: boolean }).__fault = false));
  await page.getByTestId("store-unavailable-retry").click();
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await context.close();
});

// (Where the second button leads from a page that is not his, the front door, is held by tests/unit/site/site.test.ts:
// no page outside /p has a part a browser test can make throw.)

for (const lang of ["zh-Hans", "en"] as const) {
  test(`the store is down and the proxy sees it first: the page it sends is the same screen (${lang})`, async ({ page }) => {
    // no browser can take the store away from a running server, so the page is the one lib/subject/unavailable.ts
    // makes, put in the place of an address of his: the browser draws exactly what the proxy would send
    const w = STORE_UNAVAILABLE_WORDS[lang];
    const sent = storeUnavailablePage(lang, "/p/today?remind=dose-morning");
    const body = await sent.text();
    await page.route(
      (url) => pathOf(url) === "/p/as-the-proxy-answers",
      (route) => route.fulfill({ status: sent.status, contentType: "text/html; charset=utf-8", body }),
    );
    const res = await page.goto("/p/as-the-proxy-answers");
    expect(res?.status()).toBe(503);
    const screen = page.getByTestId("store-unavailable");
    await expect(screen.locator("h1")).toHaveText(w.title);
    await expect(screen).toContainText(w.body);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    const again = page.getByTestId("store-unavailable-retry");
    await expect(again).toHaveText(w.retry);
    await expect(again).toHaveAttribute("href", "/p/today?remind=dose-morning");
    // the timeline design's ground and the red-bordered box, not the first look's black on white
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(242, 245, 249)");
    expect(await screen.locator(".box").evaluate((el) => getComputedStyle(el).borderTopColor)).toBe("rgb(164, 38, 44)");
    expect(await again.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(106, 76, 147)");
    expect((await again.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    await expectPageChecks(page, { side: "elder" });
  });
}

// ------------------------------------------------------------------------------------------------ the page on its way

test("a tap on the tab bar when the next page takes its time: the bar at the top, the screen marked busy, gone when the page is there", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await account(context);
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  const mark = page.getByTestId("nav-progress");
  await expect(mark).toHaveAttribute("data-busy", "false");
  // idle: it is there, it shows nothing, it takes no room and no tap
  expect(await mark.evaluate((el) => ({ kids: el.querySelectorAll(".rp12-nav-bar").length, words: el.textContent ?? "", events: getComputedStyle(el).pointerEvents, position: getComputedStyle(el).position, fixedInColumn: el.hasAttribute("data-rp-phone-fixed") }))).toEqual({
    kids: 0,
    words: "",
    events: "none",
    position: "fixed",
    fixedInColumn: true,
  });

  // the question list takes two seconds to answer. (Not the blood pressure page: it, and the prevention and diet
  // pages, have a loading boundary of their own; there the page's own outline is the sign of work and the address
  // changes at once, so the mark has nothing to do.)
  await page.route(
    (url) => pathOf(url) === "/p/questions",
    async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    },
  );
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.locator('[data-rp="tabbar"] a[href="/p/questions"]').click();
  await expect(mark).toHaveAttribute("data-busy", "true", { timeout: 1500 });
  expect(pathOf(page.url())).toBe("/p/today");
  await expect(mark).toHaveText("正在打开……");
  await expect(page.locator('[data-rp="screen"]')).toHaveAttribute("aria-busy", "true");
  // a thin bar over the top edge: the page did not move, and a tap under it still lands on the page
  const box = await mark.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390 });
  expect(box!.height).toBeLessThanOrEqual(4);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(before);
  expect(await page.evaluate(() => document.elementFromPoint(195, 2)?.closest('[data-testid="nav-progress"]') === null)).toBe(true);
  expect(await mark.locator(".rp12-nav-bar").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(106, 76, 147)");

  // the page is there: the mark is gone and nothing stays busy
  await page.waitForURL(/\/p\/questions$/, { timeout: 15_000 });
  await expect(mark).toHaveAttribute("data-busy", "false");
  await expect(mark.locator(".rp12-nav-bar")).toHaveCount(0);
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  await page.unroute((url) => pathOf(url) === "/p/questions");

  // a page change that code starts (router.push after a button: the question he typed, the visit he ended): the same mark
  await page.route(
    (url) => pathOf(url) === "/p/watch",
    async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    },
  );
  await page.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/p/watch"));
  await expect(mark).toHaveAttribute("data-busy", "true", { timeout: 1500 });
  expect(pathOf(page.url())).toBe("/p/questions");
  await expect(page.locator('[data-rp="screen"]')).toHaveAttribute("aria-busy", "true");
  await page.waitForURL(/\/p\/watch$/, { timeout: 15_000 });
  await expect(mark).toHaveAttribute("data-busy", "false");
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  // the same screen answering a tap with another ?query (router.replace) is not a page change: no mark, however slow
  await page.evaluate(() => (window as unknown as { next: { router: { replace: (href: string) => void } } }).next.router.replace("/p/watch?lang=zh-Hans"));
  await page.waitForTimeout(900);
  await expect(mark).toHaveAttribute("data-busy", "false");
  await page.waitForURL(/\/p\/watch\?lang=zh-Hans$/, { timeout: 15_000 });
  await page.unroute((url) => pathOf(url) === "/p/watch");

  // a link to a part of this page, to a file or to another site starts nothing
  const started = await page.evaluate(async () => {
    const mark = document.querySelector('[data-testid="nav-progress"]')!;
    const tried: string[] = [];
    for (const href of ["#top", "/api/watch", "tel:995", "https://example.org/", window.location.pathname + window.location.search]) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = "x";
      a.addEventListener("click", (e) => e.preventDefault());
      document.body.appendChild(a);
      a.click();
      await new Promise((r) => setTimeout(r, 450));
      if (mark.getAttribute("data-busy") === "true") tried.push(href);
      a.remove();
    }
    return tried;
  });
  expect(started).toEqual([]);
  await context.close();
});

test("on a computer every one of these pieces stands in the phone's column: the mark, the fault screen, the not-found page, the offline page", async ({ browser, baseURL }) => {
  type Edges = { left: number; right: number; width: number };
  const edgesOf = (page: Page, selector: string): Promise<Edges> =>
    page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    });
  /** a 430px column in the middle of the window (whatever a scrollbar takes) */
  const expectColumn = async (page: Page, selector: string): Promise<Edges> => {
    const e = await edgesOf(page, selector);
    const client = await page.evaluate(() => document.documentElement.clientWidth);
    expect(e.width, selector).toBe(430);
    expect(Math.abs(e.left - (client - 430) / 2), `${selector} is in the middle`).toBeLessThanOrEqual(1);
    return e;
  };

  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await faultOnDemand(page);
  await account(context);

  // his page: the mark has the column's own edges, idle and while a page is on its way; the bar never leaves it
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  const column = await expectColumn(page, '[data-rp="screen"]');
  expect(await edgesOf(page, '[data-testid="nav-progress"]')).toEqual(column);
  await page.route(
    (url) => pathOf(url) === "/p/questions",
    async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    },
  );
  await page.locator('[data-rp="tabbar"] a[href="/p/questions"]').click();
  await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-busy", "true", { timeout: 1500 });
  expect(await edgesOf(page, '[data-testid="nav-progress"]')).toEqual(column);
  const bar = await edgesOf(page, ".rp12-nav-bar");
  expect(bar.left).toBeGreaterThanOrEqual(column.left);
  expect(bar.right).toBeLessThanOrEqual(column.right);
  await page.waitForURL(/\/p\/questions$/, { timeout: 15_000 });
  await page.unroute((url) => pathOf(url) === "/p/questions");

  // the screen for a page that could not be drawn
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await breakThePage(page);
  await expectColumn(page, '[data-testid="store-unavailable"]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // the not-found page, his
  await page.goto("/p/there-is-no-such-page-kq7");
  await expectColumn(page, '[data-testid="not-found"]');

  // the page a phone without a network shows (a static file with its own styles)
  await page.goto("/offline.html");
  await expectColumn(page, '[data-testid="offline-shell"]');
  await context.close();

  // her not-found page and the mark on it: her own 430px column
  const hers = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const hp = await hers.newPage();
  await account(hers, "none");
  await hp.goto("/f/there-is-no-such-page-kq7");
  const herColumn = await expectColumn(hp, '[data-rp="family-screen"]');
  expect(await edgesOf(hp, '[data-testid="nav-progress"]')).toEqual(herColumn);
  await hers.close();
});

test("a page that never comes: the mark gives up after 8 s; and the pages made for a computer have none", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await account(context);
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  const mark = page.getByTestId("nav-progress");
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route(
    (url) => pathOf(url) === "/p/questions",
    async (route) => {
      await held;
      await route.continue().catch(() => undefined);
    },
  );
  await page.locator('[data-rp="tabbar"] a[href="/p/questions"]').click();
  const tapped = Date.now();
  await expect(mark).toHaveAttribute("data-busy", "true", { timeout: 1500 });
  await expect(mark).toHaveAttribute("data-busy", "false", { timeout: 10_000 });
  const lasted = Date.now() - tapped;
  expect(lasted).toBeGreaterThan(7000);
  expect(lasted).toBeLessThan(9500);
  expect(pathOf(page.url())).toBe("/p/today");
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  // the page comes after all: he is taken there, late, with no mark left behind
  release();
  await page.waitForURL(/\/p\/questions$/, { timeout: 15_000 });
  await expect(mark).toHaveAttribute("data-busy", "false");
  await context.close();

  // a page made for a computer: no mark in the page at all
  const desk = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  for (const address of ["/how", "/demo", "/design"]) {
    await dp.goto(address);
    await expect(dp.locator("body")).toBeVisible();
    await expect(dp.getByTestId("nav-progress"), address).toHaveCount(0);
  }
  await desk.close();
});
