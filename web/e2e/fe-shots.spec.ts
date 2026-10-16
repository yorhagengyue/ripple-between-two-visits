/**
 * Screenshots for the owner of the elder screens rebuilt after the timeline draft (web/progress/fe.md): one PNG per
 * screen state at 390x844 @2x in 华语, named by the draft's screen id, in FE_SHOTS_DIR/<group>/. Not a test of looks,
 * and never part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3700 npx playwright test e2e/fe-shots.spec.ts -g "02"
 *
 * Each group makes its own account on the developer test clock (the example data, laid out on Mon 12 Oct 2026) and
 * walks to the states the draft draws. A screen longer than the phone is also saved whole as <id>-full.png.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { withCrew } from "./helpers";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

// her clip starts by itself, as on a phone that allows it (02-8 refuses it on purpose); the microphone is Chromium's
// stand-in device, allowed without a prompt (the ask screen's listening states)
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function tick(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/dev/tick", { data: {} });
  expect(res.status()).toBe(200);
}

async function phone(browser: Browser, locale: "zh-CN" | "en-SG" = "zh-CN"): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank" = "example", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
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

test("02 吃药提醒和没吃的原因（今天页）", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  // the example's one-time intro was put away earlier
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();
  const open = async (query = "") => {
    await page.goto(`/p/today${query}`);
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  };

  // Tue 13 Oct, a tai chi morning. 02-1: before the reminder
  await setClock(request, SGT("2026-10-13", "08:30"));
  await open();
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  await shot(page, "02", "02-1");

  // 02-2b: the reminder opened, her recording playing
  await setClock(request, SGT("2026-10-13", "08:45"));
  await tick(request);
  await open("?remind=dose-morning");
  await expect(page.getByTestId("her-reminder")).toHaveAttribute("data-state", "playing");
  await shot(page, "02", "02-2b");

  // 02-2en: the same in English
  await open("?remind=dose-morning&lang=en");
  await expect(page.getByTestId("her-reminder")).toBeVisible();
  await shot(page, "02", "02-2en");

  // 02-4a, 02-4b: 还没吃, the reasons (his own routine first), 打太极
  await setClock(request, SGT("2026-10-13", "08:46"));
  await open("?remind=dose-morning");
  await page.getByTestId("dose-missed").click();
  await expect(page.getByTestId("dose-reasons")).toBeVisible();
  // (the undo strip of 「还没吃」 is still up: when it goes, the reason step goes with it)
  await shot(page, "02", "02-4a");
  await page.getByTestId("dose-reasons").locator('[data-reason="tai_chi_morning"]').click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "missed");
  await shot(page, "02", "02-4b");

  // Wed 14 Oct. 02-3: 吃了, and the day once the undo strip is gone
  await setClock(request, SGT("2026-10-14", "08:47"));
  await open("?remind=dose-morning");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await shot(page, "02", "02-3");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 16_000 });
  await expect(page.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  await shot(page, "02", "02-3-after");

  // Thu 15 Oct. 02-5: 等一下; then he takes it, so tomorrow has nothing left over from today
  await setClock(request, SGT("2026-10-15", "08:46"));
  await open("?remind=dose-morning");
  await page.getByTestId("dose-later").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "later");
  await shot(page, "02", "02-5");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 16_000 });
  await shot(page, "02", "02-5-after");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");

  // Fri 16 Oct. 02-6a, 02-6b: no reply by 9:45, then logged late at 10:20
  await setClock(request, SGT("2026-10-16", "08:45"));
  await tick(request);
  await setClock(request, SGT("2026-10-16", "09:15"));
  await tick(request);
  await setClock(request, SGT("2026-10-16", "09:46"));
  await tick(request);
  await open();
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "closed");
  await shot(page, "02", "02-6a");
  await setClock(request, SGT("2026-10-16", "10:20"));
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await shot(page, "02", "02-6b");

  // Sat 17 Oct. 04-1 on Today: 「打字」 puts the typing dock in the bar's place
  await setClock(request, SGT("2026-10-17", "08:40"));
  await open();
  await page.getByTestId("say-type").click();
  await page.getByTestId("ask-input").fill("我今天好累。");
  await shot(page, "02", "04-1-typing");
  await context.close();

  // 02-8: the browser refuses to start her recording
  const refused = await phone(browser);
  await refused.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError"));
    };
  });
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(refused);
  await refused.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const quiet = await refused.newPage();
  await setClock(request, SGT("2026-10-13", "08:45"));
  await quiet.goto("/p/today?remind=dose-morning");
  await expect(quiet.getByTestId("her-reminder")).toHaveAttribute("data-state", "blocked");
  await shot(quiet, "02", "02-8");
  await refused.close();
});

test("02-7 两种药各自记", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();

  // a second prescription medicine through the example's sample bag: Losartan, every morning (its label confirmed today,
  // so it is asked from tomorrow)
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-prescription").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-sample-losartan").click();
  const check = page.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 12 && (await check.count()) > 0; i++) {
    const index = await check.getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect.poll(async () => (await check.count()) === 0 || (await check.getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
  }
  await expect(page.getByTestId("add-done")).toBeVisible({ timeout: 30_000 });

  await setClock(request, SGT("2026-10-13", "08:45"));
  await tick(request);
  await page.goto("/p/today?remind=dose-morning");
  await expect(page.getByTestId("dose-med-med-amlodipine")).toContainText("Amlodipine 5 mg");
  await expect(page.getByTestId("dose-med-med-losartan")).toContainText("Losartan 50 mg");
  await shot(page, "02", "02-7");

  // one answered, the other still asks
  await page.getByTestId("dose-taken-med-amlodipine").click();
  await expect(page.getByTestId("dose-med-med-amlodipine")).toHaveAttribute("data-state", "taken");
  await expect(page.getByTestId("dose-taken-med-losartan")).toBeVisible();
  await shot(page, "02", "02-7-one-answered");

  // the other: 还没吃 and why; then the slot is one entry of the line
  await page.getByTestId("dose-missed-med-losartan").click();
  await expect(page.getByTestId("dose-reasons")).toBeVisible();
  await shot(page, "02", "02-7-reason");
  await page.getByTestId("dose-reasons").locator("[data-reason]").first().click();
  await expect(page.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "missed");
  await shot(page, "02", "02-7-both-answered");
  const rows = (await (await context.request.get("/api/doses?from=43&to=43")).json()) as { doses: { medication_id: string; state: string; reason: string | null }[] };
  expect(rows.doses.map((d) => `${d.medication_id}:${d.state}:${d.reason}`).sort()).toEqual(["med-amlodipine:taken:null", "med-losartan:missed:tai_chi_morning"]);
  await context.close();
});

/** Types a question on the ask screen, taps 「问这句」 and waits until its answer is the screen. */
async function askOnScreen(page: Page, text: string): Promise<void> {
  await page.getByTestId("ask-input").fill(text);
  const answered = page.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await page.getByTestId("ask-send").click();
  expect((await answered).status()).toBe(200);
  await expect(page.locator('[data-testid="ask-turn"][data-latest="true"]').getByRole("heading", { level: 1 })).toHaveText(text, { timeout: 10_000 });
}

test("07 问一句（含 22-2、通用-3）", async ({ browser, request }) => {
  // the evening of the 150/95 reading
  await setClock(request, SGT("2026-10-12", "20:15"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");

  // 22-2: the example account's start, 「可以这样问」
  await expect(page.getByTestId("ask-start").locator('[data-action="example-ask"]')).toHaveCount(3);
  await shot(page, "22", "22-2");

  // 通用-3: no network
  await context.setOffline(true);
  await expect(page.getByTestId("ask-offline")).toBeVisible();
  await shot(page, "通用", "通用-3");
  await context.setOffline(false);
  await expect(page.getByTestId("ask-offline")).toHaveCount(0);

  // 07-1c: typing
  await page.getByTestId("ask-input").fill("这个药是做什么的？");
  await shot(page, "07", "07-1c");

  // 07-2a: what the medicine is for
  await askOnScreen(page, "这个药是做什么的？");
  await shot(page, "07", "07-2a");

  // 07-3: the hero question. While its answer is on the way (held here for the picture) his sentence has the screen
  await page.route("**/api/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-asking")).toContainText("今天 150/95，我能不能多吃一粒？");
  await expect(page.getByTestId("ask-pending")).toBeVisible();
  await shot(page, "07", "07-3-asking");
  await expect(page.locator('[data-testid="ask-turn"][data-latest="true"]').getByRole("heading", { level: 1 })).toHaveText("今天 150/95，我能不能多吃一粒？", { timeout: 15_000 });
  await page.unroute("**/api/ask");
  await expect(page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible();
  await shot(page, "07", "07-3");

  // 07-4: a question his doctor already answered
  await askOnScreen(page, "我家的血压机是绑手腕的，能用吗？");
  await expect(page.getByTestId("answer-answered-before")).toBeVisible();
  await shot(page, "07", "07-4");

  // 07-5: what the doctor said about his blood pressure
  await askOnScreen(page, "总结一下医生说我血压怎么样");
  await shot(page, "07", "07-5");

  // 07-2d: how he feels is a note; 07-2g: chit-chat, 「记下来」
  await askOnScreen(page, "最近很累，没有力气");
  await shot(page, "07", "07-2d");
  await askOnScreen(page, "今天天气怎么样？");
  await expect(page.getByTestId("ask-write-down")).toBeVisible();
  await shot(page, "07", "07-2g");
  await page.getByTestId("ask-write-down").click();
  await expect(page.getByTestId("ask-written")).toBeVisible();
  await shot(page, "07", "07-2g-noted");

  // 07-2h: the same structure with other fixed sentences (a dose he asks for, something his records do not hold)
  await askOnScreen(page, "止痛药一次吃几粒？");
  await shot(page, "07", "07-2h-dose");
  await askOnScreen(page, "我去年量的血压是多少？");
  await shot(page, "07", "07-2h-none");
  // 07-2c: a medicine Ripple cannot identify: the fixed English sentence and one Chinese line under it
  await askOnScreen(page, "我亲戚给的宁和平压丸是什么药？");
  await shot(page, "07", "07-2c");

  // 07-6: he comes back later: today's questions are still there, the latest on top and the earlier ones as a list
  await page.reload();
  await expect(page.getByTestId("ask-earlier-turn")).toHaveCount(8);
  await page.getByTestId("ask-earlier").scrollIntoViewIfNeeded();
  await shot(page, "07", "07-6");
  // one of them opened in place
  await page.getByTestId("ask-earlier-turn").nth(5).locator("summary").click();
  await page.getByTestId("ask-earlier-turn").nth(5).scrollIntoViewIfNeeded();
  await shot(page, "07", "07-6-open");
  await context.close();

  // 22-1: Today on an example account: the one-time intro in its box and the row that leads to 「可以这样问」
  await setClock(request, SGT("2026-10-12", "07:40"));
  const judge = await phone(browser);
  await account(judge);
  const today = await judge.newPage();
  await today.goto("/p/today");
  await expect(today.locator('[data-rp="example-intro"]')).toBeVisible();
  await shot(today, "22", "22-1-intro");
  await today.locator('[data-action="example-intro-dismiss"]').click();
  await expect(today.locator('[data-rp="example-intro"]')).toHaveCount(0);
  await expect(today.locator('[data-action="example-asks-open"]')).toBeVisible();
  await shot(today, "22", "22-1");
  await judge.close();
  await setClock(request, SGT("2026-10-12", "20:15"));

  // 07-3en: the hero question in English
  const en = await phone(browser, "en-SG");
  await account(en, "example", { locale: "en" });
  await en.addCookies([{ name: "rp_lang", value: "en", url: test.info().project.use.baseURL! }]);
  const ep = await en.newPage();
  await ep.goto("/p/ask");
  await askOnScreen(ep, "My reading is 150/95 today. Can I take one more tablet?");
  await shot(ep, "07", "07-3en");
  await en.close();

  // 07-7: without his consent to AI processing
  const off = await phone(browser);
  await account(off);
  const base = new URL(test.info().project.use.baseURL!).origin;
  const consent = await off.request.post("/api/me/consent", { data: { kind: "ai_processing", on: false }, headers: { origin: base } });
  expect(consent.status(), await consent.text()).toBe(200);
  const op = await off.newPage();
  await op.goto("/p/ask");
  await expect(op.getByTestId("ask-no-ai")).toBeVisible();
  await askOnScreen(op, "今天 150/95，我能不能多吃一粒？");
  await shot(op, "07", "07-7");
  await off.close();
});

test("09 急症", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "20:15"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();
  await page.goto("/p/ask");
  // 09-1: chest pain asked as the medicine's doing: 995 first, the doctor's warning line, the leaflet's line
  await askOnScreen(page, "降压药会不会引起胸口痛？");
  await expect(page.locator('[data-testid="answer-line"][data-kind="emergency"]')).toBeVisible();
  await shot(page, "09", "09-1");
  // 09-2: one side heavy
  await askOnScreen(page, "右边身体觉得很重");
  await shot(page, "09", "09-2");
  await context.close();
});

test("10 自伤", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "21:40"));
  const context = await phone(browser);
  await account(context);
  const page = await context.newPage();
  await page.goto("/p/ask");
  await askOnScreen(page, "我觉得活着没什么意思，只会拖累孩子");
  await expect(page.locator('[data-testid="answer-line"][data-kind="hotlines"] .rpu-hotline')).toHaveCount(4);
  await shot(page, "10", "10-1");
  await context.close();
});

test("通用 今天页的状态（通用-1、通用-5a、5c、5d、通用-6）", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "07:40"));
  const base = test.info().project.use.baseURL!;
  /** a browser that was never asked about notifications (a test browser answers "denied" before anyone asked) */
  const neverAsked = () => Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
  const signedIn = async (context: BrowserContext): Promise<Page> => {
    await account(context);
    await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
    const page = await context.newPage();
    await page.goto("/p/today");
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    return page;
  };

  // 通用-5a: the reason first; 5c: he refused
  const first = await phone(browser);
  await first.addInitScript(neverAsked);
  await first.addInitScript(() => {
    Notification.requestPermission = () => Promise.resolve("denied");
  });
  const page = await signedIn(first);
  await expect(page.getByTestId("today-push")).toHaveAttribute("data-state", "ask");
  await shot(page, "通用", "通用-5a");
  await page.getByTestId("today-push-on").click();
  await expect(page.getByTestId("today-push")).toHaveAttribute("data-state", "denied");
  await shot(page, "通用", "通用-5c");

  // 通用-1: he taps 「今天」 on another page while Today's data is held on the way: the tab looks chosen at once, a line
  // over the tab bar says the draft's sentence, and after three seconds that it is slow
  await page.goto("/p/questions");
  await expect(page.locator('[data-rp="questions-open"]')).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.route(/\/p\/today\?_rsc=/, async (route) => {
    const h = route.request().headers();
    if (h["next-router-prefetch"] || h["next-router-segment-prefetch"]) return route.continue();
    await new Promise((r) => setTimeout(r, 7000));
    await route.continue();
  });
  await page.locator('[data-rp="tabbar"]:visible a[data-tab="today"]').click();
  await expect(page.getByTestId("tab-wait")).toHaveAttribute("data-slow", "false");
  await shot(page, "通用", "通用-1");
  await expect(page.getByTestId("tab-wait")).toHaveAttribute("data-slow", "true", { timeout: 6000 });
  await shot(page, "通用", "通用-1-slow");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account", { timeout: 15_000 });
  // the same line when he leaves Today: for that moment it stands over the 「按一下说」 bar
  await page.waitForLoadState("networkidle");
  await page.route(/\/p\/meds\?_rsc=/, async (route) => {
    const h = route.request().headers();
    if (h["next-router-prefetch"] || h["next-router-segment-prefetch"]) return route.continue();
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.locator('[data-rp="tabbar"]:visible a[data-tab="meds"]').click();
  await expect(page.getByTestId("tab-wait")).toHaveText("正在打开……");
  await shot(page, "通用", "通用-1-leaving-today");
  await page.waitForURL(/\/p\/meds$/, { timeout: 15_000 });
  await first.close();

  // 通用-5d: an iPhone that did not open Ripple from the Home Screen
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Singapore",
    baseURL: base,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const ip = await signedIn(iphone);
  await expect(ip.getByTestId("today-push")).toHaveAttribute("data-state", "ios");
  await shot(ip, "通用", "通用-5d");
  await iphone.close();

  // 通用-6: a filming account (his sign-in and the crew's cookie on the phone), laid out to Sat 19 Sep of the story at
  // 8:46: he answers 「吃了」, and the day is drawn as on any other day, with nothing of the crew's on it
  const film = await withCrew(await phone(browser));
  await account(film);
  expect((await film.request.post("/api/crew/filming-account")).status()).toBe(200);
  const ref = ((await (await film.request.get("/api/crew/filming-account")).json()) as { ref: string }).ref;
  const laid = await film.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "seed", day: 26, time: "08:46" } });
  expect(laid.status(), await laid.text()).toBe(200);
  const fp = await film.newPage();
  await fp.goto("/p/today");
  await expect(fp.getByTestId("page-today")).toHaveAttribute("data-day", "2026-09-19");
  await shot(fp, "通用", "通用-6-reminder");
  await fp.getByTestId("dose-taken").click();
  await expect(fp.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(fp.getByTestId("undo-toast")).toHaveCount(0, { timeout: 16_000 });
  await expect(fp.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  await shot(fp, "通用", "通用-6");
  await film.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "end" } });
  await film.close();
});

test.describe("07 按一下说（服务器接了转写才有）", () => {
  test("07-1a、07-1b、通用-4a、通用-4b、通用-4c", async ({ browser, request }) => {
    const voice = ((await (await request.get("/api/asr/health")).json()) as { provider?: string }).provider === "whisper";
    test.skip(!voice, "this server has no transcription service: the ask screen draws no microphone (real-app 2.10)");
    await setClock(request, SGT("2026-10-12", "20:15"));
    const context = await phone(browser);
    await context.grantPermissions(["microphone"]);
    await account(context);
    const page = await context.newPage();
    // what the service would hear (the picture is of the screen, not of Whisper)
    await page.route("**/api/ask/transcribe", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "这个药是做什么的？" }) }));
    await page.goto("/p/ask");
    await expect(page.getByTestId("ask-mic")).toBeVisible();
    await shot(page, "07", "07-voice-idle");
    await page.getByTestId("ask-mic").click();
    await expect(page.getByTestId("ask-mic-section")).toHaveAttribute("data-state", "listening");
    await shot(page, "07", "07-1a");
    await page.waitForTimeout(700);
    await page.getByTestId("ask-mic").click();
    await expect(page.getByTestId("ask-heard")).toHaveText("这个药是做什么的？");
    await shot(page, "07", "07-1b");
    await context.close();

    // 通用-4a: the browser's own question is up (it comes only after his tap; a test cannot draw the question itself)
    const asking = await phone(browser);
    await asking.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
    });
    await account(asking);
    const ap = await asking.newPage();
    await ap.goto("/p/ask");
    await ap.getByTestId("ask-mic").click();
    await expect(ap.locator('[data-rp="mic-stage"]')).toHaveAttribute("data-state", "starting");
    await shot(ap, "通用", "通用-4a");
    await asking.close();

    // 通用-4b: the microphone was refused
    const denied = await phone(browser);
    await denied.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await account(denied);
    const dp = await denied.newPage();
    await dp.goto("/p/ask");
    await dp.getByTestId("ask-mic").click();
    await expect(dp.getByTestId("ask-mic-note")).toHaveAttribute("data-state", "denied");
    await shot(dp, "通用", "通用-4b");
    await denied.close();

    // 通用-4c: no microphone on this phone
    const none = await phone(browser);
    await none.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await account(none);
    const np = await none.newPage();
    await np.goto("/p/ask");
    await np.getByTestId("ask-mic").click();
    await expect(np.getByTestId("ask-mic-note")).toHaveAttribute("data-state", "unavailable");
    await shot(np, "通用", "通用-4c");
    await none.close();
  });
});
