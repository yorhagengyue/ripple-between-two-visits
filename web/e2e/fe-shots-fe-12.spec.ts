/**
 * Screenshots for the owner of what front-end line fe-12 rebuilt after the timeline draft (web/progress/fe-12.md):
 * design group 12 「手表」 (the trends screen and Today's cell) and the site-wide pieces (the not-found page, the screen
 * for a page that could not be drawn, the offline page, the mark that shows a page is on its way). One PNG per state at
 * 390x844 @2x, named by the draft's screen id, in FE_SHOTS_DIR/12/ and FE_SHOTS_DIR/site/. Not a test of looks, and
 * never part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3865 npx playwright test e2e/fe-shots-fe-12.spec.ts -g "12|site"
 *
 * Each group makes its own account on the developer test clock (the example data, laid out on Mon 12 Oct 2026). A
 * screen longer than the phone is also saved whole as <id>-full.png. Run it on a production build (node
 * scripts/record/serve.mjs --port <port> --build): `next dev` covers the fault screen with its own overlay. The
 * to-send list on Today and on the blood pressure page is pictured by track O's own spec, which really cuts the
 * network: O_SHOTS_DIR=<FE_SHOTS_DIR>/site/offline with e2e/o-offline.spec.ts.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { storeUnavailablePage } from "@/lib/subject/unavailable";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, locale: "zh-CN" | "en-SG" = "zh-CN"): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank" | "none" = "example", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  // the example's one-time intro was put away earlier
  if (space === "example") await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, group: string, id: string): Promise<void> {
  const out = path.join(DIR!, group);
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the tab bar
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page without what is fixed at the bottom (those bars are on the phone-sized picture)
    const hide = await page.addStyleTag({ content: ".rpu-tabs, .rpu-say, .rpu-typedock, .rpu-toast[data-placement='fixed'] { display: none !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await hide.evaluate((el) => (el as Element).remove());
  }
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("12 手表：今天页的那一格，和走势", async ({ browser, request }) => {
  // Mon 12 Oct 2026, 08:00: before the 8:45 reminder, so Today is the day's overview and the watch has its entry
  await setClock(request, SGT("2026-10-12", "08:00"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();

  // 12-2: Today, the watch has something to say
  await page.goto("/p/today");
  const cell = page.getByTestId("today-watch");
  await expect(cell.getByTestId("watch-yes")).toBeVisible();
  await cell.scrollIntoViewIfNeeded();
  await shot(page, "12", "12-2");

  // 12-1: the trends, the observation still asking; each of the three numbers
  await cell.getByTestId("watch-trends-link").click();
  await page.waitForURL(/\/p\/watch$/);
  await expect(page.getByTestId("watch-card")).toHaveAttribute("data-state", "asking");
  await shot(page, "12", "12-1");
  for (const metric of ["sleep", "steps"] as const) {
    await page.getByTestId("watch-pick").locator(`[data-seg="${metric}"]`).click();
    await expect(page.locator(`[data-testid="watch-trend"][data-metric="${metric}"]`)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "12", `12-1-${metric}`);
  }

  // 要: on the trends screen the tick is an entry of its own; on Today it sits in the watch's entry
  await page.getByTestId("watch-pick").locator('[data-seg="rhr"]').click();
  await page.getByTestId("watch-yes").click();
  await expect(page.getByTestId("watch-added")).toBeVisible();
  await page.getByTestId("watch-added").scrollIntoViewIfNeeded();
  await shot(page, "12", "12-1-added");
  await page.goto("/p/today");
  await expect(cell.getByTestId("watch-added")).toBeVisible();
  await cell.scrollIntoViewIfNeeded();
  await shot(page, "12", "12-2-added");
  await context.close();

  // 不要: Today's entry folds to one line; the trends screen keeps the observation and says 「好，不加。」
  const second = await phone(browser);
  await account(second);
  const p2 = await second.newPage();
  await p2.goto("/p/today");
  await p2.getByTestId("today-watch").getByTestId("watch-no").click();
  await expect(p2.getByTestId("today-watch").getByTestId("watch-declined")).toBeVisible();
  await p2.getByTestId("today-watch").scrollIntoViewIfNeeded();
  await shot(p2, "12", "12-2-declined");
  await p2.goto("/p/watch");
  await expect(p2.getByTestId("watch-card")).toHaveAttribute("data-state", "declined");
  await p2.getByTestId("watch-card").scrollIntoViewIfNeeded();
  await shot(p2, "12", "12-1-declined");
  await second.close();

  // English
  const en = await phone(browser, "en-SG");
  await en.addCookies([{ name: "rp_lang", value: "en", url: test.info().project.use.baseURL! }]);
  await account(en);
  const p3 = await en.newPage();
  await p3.goto("/p/today");
  await expect(p3.getByTestId("today-watch").getByTestId("watch-yes")).toBeVisible();
  await p3.getByTestId("today-watch").scrollIntoViewIfNeeded();
  await shot(p3, "12", "12-2-en");
  await p3.goto("/p/watch");
  await expect(p3.getByTestId("watch-card")).toBeVisible();
  await shot(p3, "12", "12-1-en");
  await en.close();

  // no watch: the trends screen says so in one box (Today has no entry at all)
  const blank = await phone(browser);
  await account(blank, "blank");
  const p4 = await blank.newPage();
  await p4.goto("/p/watch");
  await expect(p4.locator('[data-testid="page-watch"][data-has="false"]')).toBeVisible();
  await shot(p4, "12", "12-1-no-watch");
  await blank.close();
});

test("site 全站的几块：打不开的地址、这一页没打开、没网的那一页、正在打开", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "08:00"));
  const base = test.info().project.use.baseURL!;

  // ---- an address that cannot be opened: nobody signed in, his account, a family member (her own look), English
  const visitor = await phone(browser);
  const v = await visitor.newPage();
  await v.goto("/there-is-no-such-page");
  await expect(v.getByTestId("not-found")).toBeVisible();
  await shot(v, "site", "not-found-front");
  await visitor.close();

  const his = await phone(browser);
  await account(his);
  const h = await his.newPage();
  await h.goto("/p/visit/not-his/review");
  await expect(h.getByTestId("not-found-way")).toHaveAttribute("data-way", "today");
  await shot(h, "site", "not-found-today");
  await his.addCookies([{ name: "rp_lang", value: "en", url: base }]);
  await h.reload();
  await expect(h.getByTestId("not-found")).toHaveAttribute("lang", "en");
  await shot(h, "site", "not-found-today-en");
  await his.close();

  const hers = await phone(browser);
  await account(hers, "none");
  const f = await hers.newPage();
  await f.goto("/f/there-is-no-such-page");
  await expect(f.getByTestId("not-found-way")).toHaveAttribute("data-look", "family");
  await shot(f, "site", "not-found-family");
  await hers.close();

  // ---- a page that could not be drawn (a fault made in the browser; a production build: `next dev` covers it)
  for (const [id, lang, store] of [
    ["fault-page", "zh-Hans", false],
    ["fault-page-en", "en", false],
    ["fault-store", "zh-Hans", true],
    ["fault-store-en", "en", true],
  ] as const) {
    const c = await phone(browser);
    await c.addCookies([{ name: "rp_lang", value: lang, url: base }]);
    await account(c);
    const p = await c.newPage();
    await p.addInitScript((asStore) => {
      const own = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get() {
          if ((window as unknown as { __fault?: boolean }).__fault) {
            const fault = new Error("made for the picture");
            if (asStore) (fault as Error & { digest?: string }).digest = "RIPPLE_STORE_UNAVAILABLE";
            throw fault;
          }
          return own?.get ? own.get.call(this) : true;
        },
      });
    }, store);
    await p.goto("/p/today");
    await expect(p.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    await p.evaluate(() => {
      (window as unknown as { __fault?: boolean }).__fault = true;
      window.dispatchEvent(new Event("offline"));
    });
    await expect(p.getByTestId("store-unavailable")).toHaveAttribute("data-fault", store ? "store" : "page");
    await shot(p, "site", id);
    await c.close();
  }

  // ---- the same screen as the proxy sends it when it sees the store's fault first (lib/subject/unavailable.ts makes
  // the page; here it stands in the place of an address of his)
  const down = await phone(browser);
  const d = await down.newPage();
  const sent = storeUnavailablePage("zh-Hans", "/p/today");
  const sentBody = await sent.text();
  await d.route(
    (url) => new URL(String(url)).pathname === "/p/as-the-proxy-answers",
    (route) => route.fulfill({ status: sent.status, contentType: "text/html; charset=utf-8", body: sentBody }),
  );
  await d.goto("/p/as-the-proxy-answers");
  await expect(d.getByTestId("store-unavailable")).toBeVisible();
  await shot(d, "site", "fault-store-proxy");
  await down.close();

  // ---- the page a phone without a network shows in place of any page: alone, with entries waiting, English
  const shell = await phone(browser);
  const s = await shell.newPage();
  await s.goto("/offline.html");
  await expect(s.getByTestId("offline-shell")).toBeVisible();
  await shot(s, "site", "offline-page");
  await s.evaluate(() => {
    window.localStorage.setItem("rp_outbox_owner", "picture");
    window.localStorage.setItem("rp_outbox_v1", JSON.stringify([{ owner: "picture", state: "waiting" }, { owner: "picture", state: "waiting" }]));
  });
  await s.reload();
  await expect(s.getByTestId("shell-waiting")).toBeVisible();
  await shot(s, "site", "offline-page-waiting");
  await shell.addCookies([{ name: "rp_lang", value: "en", url: base }]);
  await s.reload();
  await expect(s.locator("h1")).toHaveText("No connection right now.");
  await shot(s, "site", "offline-page-en");
  await shell.close();

  // ---- the next page is on its way: the thin bar over the top edge, on his page and on hers
  const slow = async (page: Page, pathname: string) =>
    page.route(
      (url) => new URL(String(url)).pathname === pathname,
      async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue().catch(() => undefined);
      },
    );
  const nav = await phone(browser);
  await account(nav);
  const n = await nav.newPage();
  await n.goto("/p/today");
  await expect(n.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  // (the question list: a page without a loading boundary of its own; the blood pressure page has one)
  await slow(n, "/p/questions");
  await n.locator('[data-rp="tabbar"] a[href="/p/questions"]').click();
  await expect(n.getByTestId("nav-progress")).toHaveAttribute("data-busy", "true");
  await n.waitForTimeout(900);
  await n.screenshot({ path: path.join(DIR!, "site", "nav-on-its-way.png") });
  await n.waitForURL(/\/p\/questions$/, { timeout: 20_000 });
  await nav.close();

  const her = await phone(browser);
  await account(her, "none");
  const hp = await her.newPage();
  await hp.goto("/f");
  await expect(hp.getByTestId("family-app")).toBeVisible();
  await slow(hp, "/privacy");
  await hp.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/privacy"));
  await expect(hp.getByTestId("nav-progress")).toHaveAttribute("data-busy", "true");
  await hp.waitForTimeout(900);
  await hp.screenshot({ path: path.join(DIR!, "site", "nav-on-its-way-family.png") });
  await her.close();
});
