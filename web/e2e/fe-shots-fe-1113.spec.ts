/**
 * Screenshots for the owner of design groups 11 「预防」 and 13 「饮食」 rebuilt after the timeline draft
 * (web/progress/fe-1113.md): one PNG per screen state at 390x844 @2x, named by the draft's screen id, in
 * FE_SHOTS_DIR/11/ and FE_SHOTS_DIR/13/. Not a test of looks, and never part of a default run: without FE_SHOTS_DIR
 * every test here is skipped, so nothing is written anywhere. (The approach of e2e/fe-shots.spec.ts, which belongs to
 * the Today line.)
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3850 npx playwright test e2e/fe-shots-fe-1113.spec.ts
 *
 * Each group makes its own accounts on the developer test clock (the example data, laid out on Mon 12 Oct 2026). The
 * draft's screens first (11-1; 13-1, 13-2, 13-3), then the states the draft did not draw (11-0-*, 13-0-*) and English.
 * A screen longer than the phone is also saved whole as <id>-full.png. The two "loading" pictures need a production
 * build (a development server does not hand the router a route's loading state before it is asked for the route).
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, lang: "zh-Hans" | "en" = "zh-Hans", baseURL?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === "en" ? "en-SG" : "zh-CN", timezoneId: "Asia/Singapore" });
  if (lang === "en" && baseURL) await context.addCookies([{ name: "rp_lang", value: "en", url: baseURL }]);
  return context;
}

async function account(context: BrowserContext, space: "example" | "blank" = "example", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  // the example's one-time intro was put away earlier
  if (space === "example") await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
}

async function fact(context: BrowserContext, kind: string, text: string): Promise<void> {
  const res = await context.request.post("/api/profile/facts", { data: { kind, text } });
  expect(res.status(), await res.text()).toBe(201);
}

/** Bring an entry to the middle of the phone (the bars at the foot would cover one scrolled to the edge). */
async function centre(target: Locator): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, group: "11" | "13", id: string): Promise<void> {
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

/** The route's loading state, held on screen: the way in from 「我」 with the route's data kept waiting (production builds only). */
async function loadingShot(page: Page, group: "11" | "13", entry: "prevent" | "diet"): Promise<void> {
  await page.goto("/p/me");
  const link = page.locator(`[data-entry="${entry}"]`);
  await expect(link).toBeVisible();
  // give the router time to fetch the route's loading state ahead of the tap, then keep the route's own data waiting
  await page.waitForTimeout(1500);
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route(`**/p/${entry}?_rsc=*`, async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  await link.click();
  const loading = page.getByTestId(`page-${entry}-loading`);
  const shown = await loading.waitFor({ state: "visible", timeout: 4000 }).then(
    () => true,
    () => false,
  );
  if (shown) await shot(page, group, `${group}-0-loading`);
  release();
  await expect(page.getByTestId(`${entry}-screen`)).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  test.info().annotations.push({ type: "loading", description: shown ? `${entry}: saved` : `${entry}: not shown on this server (a development server)` });
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("11 预防", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();
  const screen = page.getByTestId("prevent-screen");
  const row = (id: string) => page.locator(`[data-testid="prevent-row"][data-item="${id}"]`);
  const open = async (p: Page = page, query = "") => {
    await p.goto(`/p/prevent${query}`);
    await expect(p.getByTestId("prevent-screen")).toBeVisible();
  };

  // 11-1: the next visit, the doctor's words, the tables' lines for his age, cardiovascular followed by his doctor, the caveat
  await open();
  await expect(row("C1-03")).toHaveAttribute("data-state", "followed");
  await shot(page, "11", "11-1");
  await row("C2-03").scrollIntoViewIfNeeded();
  await shot(page, "11", "11-1-table");
  await row("C1-03").scrollIntoViewIfNeeded();
  await shot(page, "11", "11-1-followed");

  // he taps 「加进问题单，问医生」 under the flu vaccine
  await row("C2-03").getByTestId("prevent-ask").click();
  await expect(row("C2-03").getByTestId("prevent-asked")).toBeVisible();
  await row("C2-03").scrollIntoViewIfNeeded();
  await shot(page, "11", "11-1-asked");

  // a tap that does not reach the server: the red box inside that entry
  await page.route("**/api/prevent*", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await row("C2-04").getByTestId("prevent-done-btn").click();
  await expect(row("C2-04").getByTestId("prevent-error")).toBeVisible();
  await row("C2-04").scrollIntoViewIfNeeded();
  await shot(page, "11", "11-0-save-refused");
  await page.unroute("**/api/prevent*");

  // 「我做过了」 on the stool test and on the doctor's line: the undo strip, then the ticks under 「已经做了的」
  await row("C1-06").getByTestId("prevent-done-btn").click();
  await expect(page.locator('[data-testid="prevent-done"][data-item="C1-06"]')).toBeVisible();
  // (the hook's own box is empty: the strip inside it is fixed to the foot of the screen)
  await expect(page.getByTestId("undo-toast").locator('[data-rp="toast"]')).toBeVisible();
  await page.locator('[data-testid="prevent-done"][data-item="C1-06"]').scrollIntoViewIfNeeded();
  await shot(page, "11", "11-1-done");
  await page.locator('[data-testid="prevent-row"][data-kind="doctor"]').getByTestId("prevent-done-btn").click();
  await expect(page.locator('[data-testid="prevent-done"]')).toHaveCount(2);
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 20_000 });
  await open();
  await expect(screen).toBeVisible();
  await shot(page, "11", "11-1-after");
  await loadingShot(page, "11", "prevent");
  await context.close();

  // English
  const english = await phone(browser, "en", baseURL);
  await account(english);
  const ep = await english.newPage();
  await open(ep);
  await shot(ep, "11", "11-1-en");
  await english.close();

  // a new account: no age yet, no visit yet
  const blank = await phone(browser);
  await account(blank, "blank");
  const bp = await blank.newPage();
  await open(bp);
  await expect(bp.getByTestId("prevent-noage")).toBeVisible();
  await shot(bp, "11", "11-0-noage");
  // an age the tables list nothing for
  await fact(blank, "age", "12");
  await open(bp);
  await expect(bp.getByTestId("prevent-notable")).toBeVisible();
  await shot(bp, "11", "11-0-nothing-listed");
  await blank.close();
});

test("13 饮食", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "19:00"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();
  const open = async (p: Page = page, query = "") => {
    await p.goto(`/p/diet${query}`);
    await expect(p.getByTestId("page-diet")).toBeVisible();
  };

  // 13-3: Today in the evening, the day's question on the day's line
  await page.goto("/p/today");
  const cell = page.getByTestId("today-diet");
  await expect(cell).toBeVisible();
  await centre(cell);
  await shot(page, "13", "13-3");

  // 13-1: the diet screen, the question still open
  await open();
  await expect(page.getByTestId("diet-check")).toHaveAttribute("data-today", "none");
  await shot(page, "13", "13-1");
  await page.locator('[data-testid="diet-condition"]').first().scrollIntoViewIfNeeded();
  await shot(page, "13", "13-1-official");
  await page.getByTestId("diet-grapefruit").scrollIntoViewIfNeeded();
  await shot(page, "13", "13-1-foot");

  // an answer that does not reach the server: the red box under the answers
  await page.route("**/api/diet/check", (route) => route.abort());
  await page.getByTestId("diet-check").locator('[data-testid="diet-answer"][data-answer="yes"]').click();
  await expect(page.getByTestId("diet-check-error")).toBeVisible();
  await shot(page, "13", "13-0-save-refused");
  await page.unroute("**/api/diet/check");

  // 13-3 answered on Today: 「已记下：没有」, 「改一下」, the way to the diet screen
  await page.goto("/p/today");
  await expect(cell).toBeVisible();
  await cell.locator('[data-testid="diet-answer"][data-answer="no"]').click();
  await expect(cell.getByTestId("diet-answered")).toBeVisible();
  await centre(cell);
  await shot(page, "13", "13-3-answered");

  // 13-1 with today's answer and the week's count
  await open();
  await expect(page.getByTestId("diet-answered")).toBeVisible();
  await expect(page.getByTestId("diet-week")).toBeVisible();
  await shot(page, "13", "13-1-answered");

  // 13-2: his own dishes: nothing picked, then 鸡饭 and 汤面
  await page.getByTestId("diet-foods-open").click();
  await expect(page.getByTestId("diet-foods")).toBeVisible();
  await shot(page, "13", "13-2-none-picked");
  for (const id of ["chicken_rice", "noodle_soup"]) {
    await page.locator(`[data-testid="diet-food"][data-food="${id}"]`).click();
    await expect(page.locator(`[data-testid="diet-picked"][data-food="${id}"]`)).toBeVisible();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "13", "13-2");
  await page.route("**/api/diet/foods", (route) => route.abort());
  await page.locator('[data-testid="diet-food"][data-food="laksa"]').click();
  await expect(page.getByTestId("diet-error")).toBeVisible();
  await shot(page, "13", "13-0-foods-save-refused");
  await page.unroute("**/api/diet/foods");
  await loadingShot(page, "13", "diet");
  await context.close();

  // English: the diet screen, the dishes, Today's entry
  const english = await phone(browser, "en", baseURL);
  await account(english);
  const ep = await english.newPage();
  await ep.goto("/p/today");
  await expect(ep.getByTestId("today-diet")).toBeVisible();
  await centre(ep.getByTestId("today-diet"));
  await shot(ep, "13", "13-3-en");
  await open(ep);
  await shot(ep, "13", "13-1-en");
  expect((await english.request.post("/api/diet/foods", { data: { foods: ["chicken_rice", "kopi_teh"] } })).status()).toBe(200);
  await open(ep, "?view=foods");
  await shot(ep, "13", "13-2-en");
  await english.close();

  // a new account: no visit yet, nothing recorded the knowledge base has lines for
  const blank = await phone(browser);
  await account(blank, "blank");
  const bp = await blank.newPage();
  await open(bp);
  await expect(bp.getByTestId("diet-nodoctor")).toBeVisible();
  await expect(bp.getByTestId("diet-nocondition")).toBeVisible();
  await shot(bp, "13", "13-0-nothing-yet");
  // a special diet recorded: the referral comes first and the general lines are not listed
  for (const text of ["高血压", "肾病"]) await fact(blank, "condition", text);
  await open(bp);
  await expect(bp.locator('[data-testid="diet-special"][data-first="true"]')).toBeVisible();
  await shot(bp, "13", "13-0-special-diet");
  await blank.close();
});
