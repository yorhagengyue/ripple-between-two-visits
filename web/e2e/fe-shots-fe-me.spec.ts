/**
 * Screenshots for the owner of 「我」 and the screens under it, rebuilt after the timeline draft (line fe-me;
 * web/progress/fe-me.md): one PNG per screen state at 390x844 @2x in 华语, named by the draft's screen id (or, for a
 * screen the draft did not draw, by what it is), in FE_SHOTS_DIR/<group>/. The approach is e2e/fe-shots.spec.ts's. Not a
 * test of looks, and never part of a default run: without FE_SHOTS_DIR every test here is skipped.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3840 npx playwright test e2e/fe-shots-fe-me.spec.ts -g "我-1"
 *
 * Each test makes its own account on the developer test clock and walks to the states. A screen longer than the phone
 * is also saved whole as <id>-full.png. Needs the developer tools (dev accounts, the test clock, local push endpoints)
 * and, for the recordings, SPEECH_PROVIDER=devfake.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startPushService, type PushService } from "../tests/support/push-service";
import { BASE_URL, logIn, signUp, withCrew } from "./helpers";
import { linkFamily, setSwitches } from "./journeys/_d/family";
import { fixtureWav, recordVisit, tickRetention } from "./journeys/_h/my-data";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const PASSWORD = "a long test password";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", ...extra });
}

async function account(context: BrowserContext, space: "example" | "blank" | "none" = "example", extra: Record<string, unknown> = {}): Promise<string> {
  const login = `s${randomUUID().slice(0, 12)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return login;
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, group: string, id: string): Promise<void> {
  const out = path.join(DIR!, group);
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits in a corner
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
}

let service: PushService;
test.beforeAll(async () => {
  service = await startPushService();
});
test.afterAll(async ({ request }) => {
  await service.close();
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("我-1 「我」页，21-1 拍摄组的手机多一项", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  // the example account, signed up through the real route (his device is on record): the rows, the example's two rows
  const context = await phone(browser);
  await signUp(context, { login: `s${randomUUID().slice(0, 12)}`, password: PASSWORD, displayName: "陈先生（示例）", space: "example" });
  const page = await context.newPage();
  await page.goto("/p/me");
  await expect(page.locator('[data-entry="logout"]')).toBeVisible();
  await expect(page.getByTestId("me-push-status")).not.toHaveAttribute("data-state", "checking");
  await shot(page, "我", "我-1");

  // his own (blank) account, reminders never asked: 「开提醒」 right there
  const sub = service.newPhone({ label: "shots-me" });
  const own = await phone(browser);
  await answerPermissionPrompt(own, "granted");
  await stubPushSubscription(own, sub);
  await account(own, "blank", { display_name: "陈先生" });
  const op = await own.newPage();
  await op.goto("/p/me");
  await expect(op.getByTestId("me-push-status")).toHaveAttribute("data-state", "default");
  await shot(op, "我", "我-1-blank");
  await own.close();

  // English
  await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.goto("/p/me");
  await expect(page.locator('[data-entry="logout"]')).toBeVisible();
  await expect(page.getByTestId("me-push-status")).not.toHaveAttribute("data-state", "checking");
  await shot(page, "我", "我-1-en");
  await context.close();

  // 21-1: a phone that carries the film crew's cookie has one more row; 21-2: the screen behind it, not marked and marked
  const crew = await phone(browser);
  await withCrew(crew);
  await account(crew, "example", { display_name: "陈先生（示例）" });
  const cp = await crew.newPage();
  await cp.goto("/p/me");
  await expect(cp.locator('[data-entry="filming"]')).toBeVisible();
  await expect(cp.getByTestId("me-push-status")).not.toHaveAttribute("data-state", "checking");
  await cp.locator('[data-entry="logout"]').scrollIntoViewIfNeeded();
  await shot(cp, "21", "21-1");
  await cp.locator('[data-entry="filming"]').click();
  await expect(cp.getByTestId("filming-page")).toHaveAttribute("data-filming", "false");
  await shot(cp, "21", "21-2");
  await cp.getByTestId("filming-mark").click();
  await expect(cp.getByTestId("filming-page")).toHaveAttribute("data-filming", "true");
  await shot(cp, "21", "21-2-marked");
  await cp.getByTestId("filming-end").click();
  await expect(cp.getByTestId("filming-page")).toHaveAttribute("data-filming", "false");
  await crew.close();
});

test("15 我的数据：导出、删除账号、录音留多久、AI 处理、家人什么时候看过", async ({ browser, request }) => {
  await setClock(request, SGT("2026-08-24", "09:30"));
  const context = await phone(browser);
  await account(context, "blank", { display_name: "陈先生" });
  const api = context.request;
  const v1 = await recordVisit(api, { fixture: "v1", wav: fixtureWav("v1-u08") });
  await setClock(request, SGT("2026-09-01", "10:30"));
  const v2 = await recordVisit(api, { fixture: "v2", wav: fixtureWav("v2-u08") });
  await setClock(request, SGT("2026-09-19", "21:41"));
  const page = await context.newPage();

  // 15-1a, 15-1b: before an export, after it, none left today
  await page.goto("/p/me/export");
  await expect(page.getByTestId("export-button")).toBeVisible();
  await shot(page, "15", "15-1a");
  for (const id of ["15-1b", null, "15-1b-none-left"]) {
    const dl = page.waitForEvent("download");
    await page.getByTestId("export-button").click();
    await dl;
    await expect(page.getByTestId("export-done")).toBeVisible();
    if (id) {
      if (id === "15-1b-none-left") await expect(page.getByTestId("export-none-left")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "15", id);
    }
  }

  // 家人什么时候看过: nobody yet, then her look
  await page.goto("/p/me/export/access");
  await expect(page.getByTestId("page-access")).toBeVisible();
  await shot(page, "15", "15-access-empty");
  const her = await browser.newContext({ baseURL: BASE_URL });
  await account(her, "none", { display_name: "Wei Ling" });
  const linkId = await linkFamily(context, her, { label: "Wei Ling", calls: "爸爸" });
  await setSwitches(context, linkId, { dose_summary: true, bp_summary: true });
  const hp = await her.newPage();
  await hp.goto(`/f?link=${linkId}`);
  await expect(hp.getByTestId("family-app")).toBeVisible();
  await page.goto("/p/me/export/access");
  await expect(page.getByTestId("access-row").first()).toBeVisible();
  await shot(page, "15", "15-access");
  await page.goto("/p/me/export");
  await expect(page.getByTestId("export-button")).toBeVisible();
  await shot(page, "15", "15-1a-with-a-look");

  // 15-4: both kept until their date, one kept for good, then 91 days on one is deleted
  await page.goto("/p/me/export/recordings");
  await expect(page.getByTestId("recording")).toHaveCount(2);
  await shot(page, "15", "15-4");
  await page.locator(`[data-testid="recording"][data-visit="${v2.id}"]`).getByRole("switch").click();
  await expect(page.locator(`[data-testid="recording"][data-visit="${v2.id}"]`)).toHaveAttribute("data-state", "kept_forever");
  await shot(page, "15", "15-4-kept");
  await setClock(request, SGT("2026-11-24", "10:00"));
  await tickRetention(request);
  await page.goto("/p/me/export/recordings");
  await expect(page.locator(`[data-testid="recording"][data-visit="${v1.id}"]`)).toHaveAttribute("data-state", "deleted");
  await shot(page, "15", "15-4-deleted");

  // 15-5: on, then switched off (what just changed is said under the switch), someone helping
  await page.goto("/p/me/ai");
  await expect(page.getByTestId("page-ai")).toHaveAttribute("data-on", "true");
  await shot(page, "15", "15-5");
  await page.getByTestId("page-ai").locator('[data-grant="ai_processing"]').getByRole("switch").click();
  await expect(page.getByTestId("page-ai")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("ai-notice")).toBeVisible();
  await shot(page, "15", "15-5-off");

  // 15-2, 15-3: what goes (Wei Ling stops seeing), the password, a wrong password, done
  await page.goto("/p/me/delete");
  await expect(page.getByTestId("delete-step-what")).toBeVisible();
  await shot(page, "15", "15-2");
  await page.getByTestId("delete-continue").click();
  await expect(page.getByTestId("delete-step-password")).toBeVisible();
  await shot(page, "15", "15-3");
  await page.getByTestId("delete-password").fill("not the password");
  await page.getByTestId("delete-submit").click();
  await expect(page.getByTestId("delete-error")).toBeVisible();
  await shot(page, "15", "15-3-wrong-password");
  await page.getByTestId("delete-password").fill(PASSWORD);
  await page.getByTestId("delete-submit").click();
  await expect(page.getByTestId("delete-done")).toBeVisible({ timeout: 20_000 });
  await shot(page, "15", "15-3-done");
  await her.close();
  await context.close();
});

test("15-6 隐私说明", async ({ browser }) => {
  const context = await phone(browser);
  const page = await context.newPage();
  await page.goto("/privacy?lang=zh-Hans");
  await expect(page.getByTestId("page-privacy")).toBeVisible();
  await shot(page, "15", "15-6");
  await page.getByTestId("privacy-consents").locator("summary").first().scrollIntoViewIfNeeded();
  await page.getByTestId("privacy-consents").locator("summary").first().click();
  await shot(page, "15", "15-6-consents");
  await page.goto("/privacy?lang=en");
  await expect(page.getByTestId("page-privacy")).toHaveAttribute("data-locale", "en");
  await shot(page, "15", "15-6-en");
  await context.close();
});

test("22-3 「我」→ 示例资料", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context, "example", { display_name: "陈先生（示例）" });
  const page = await context.newPage();
  await page.goto("/p/me/example");
  await expect(page.locator('[data-rp="example-actions"]')).toBeVisible();
  await shot(page, "22", "22-3");
  await page.goto("/p/me/example?do=reseed");
  await expect(page.locator('[data-rp="example-actions"][data-only="reseed"]')).toBeVisible();
  await shot(page, "22", "22-3-reseed");
  await page.goto("/p/me/example?do=clear");
  await expect(page.locator('[data-rp="example-actions"][data-only="clear"]')).toBeVisible();
  await shot(page, "22", "22-3-clear");
  await context.close();
  // an account on his own data just says so
  const own = await phone(browser);
  await account(own, "blank", { display_name: "陈先生" });
  const op = await own.newPage();
  await op.goto("/p/me/example");
  await expect(op.locator('[data-rp="page-title"]')).toBeVisible();
  await shot(op, "22", "22-3-not-example");
  await own.close();
});

test("我 › 提醒和通知：没问过、开着、被拒、iPhone、不支持", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));

  // refused
  const denied = await phone(browser);
  await denied.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Notification.requestPermission = async () => "denied";
  });
  await account(denied, "example");
  const dp = await denied.newPage();
  await dp.goto("/p/me/notifications");
  await expect(dp.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "denied");
  await shot(dp, "我", "通知-被拒");
  await dp.getByTestId("push-retry").click();
  await expect(dp.getByTestId("push-result")).toBeVisible();
  await shot(dp, "我", "通知-被拒-再试一次");
  await dp.goto("/p/me");
  await expect(dp.getByTestId("me-push-status")).toHaveAttribute("data-state", "denied");
  await dp.getByTestId("me-push-retry").click();
  await expect(dp.getByTestId("me-push-result")).toBeVisible();
  await shot(dp, "我", "我-1-提醒被拒");
  await denied.close();

  // an iPhone outside the Home Screen: the three pictured steps
  const iphone = await phone(browser, { userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
  await account(iphone, "example");
  const ip = await iphone.newPage();
  await ip.goto("/p/me/notifications");
  await expect(ip.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "needs_home_screen");
  await expect(ip.getByTestId("push-ios-steps").locator("img")).toBeVisible();
  await shot(ip, "我", "通知-iPhone");
  await iphone.close();

  // a browser without push
  const none = await phone(browser);
  await none.addInitScript(() => delete (window as unknown as { PushManager?: unknown }).PushManager);
  await account(none, "example");
  const np = await none.newPage();
  await np.goto("/p/me/notifications");
  await expect(np.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "unsupported");
  await shot(np, "我", "通知-不支持");
  await none.close();

  // never asked, then on (the welcome reaches the phone's push service), recent reminders, off on this phone
  const sub = service.newPhone({ label: "shots-page" });
  const context = await phone(browser);
  await answerPermissionPrompt(context, "granted");
  await stubPushSubscription(context, sub);
  await account(context, "example", { display_name: "陈先生（示例）" });
  const page = await context.newPage();
  const screen = page.getByTestId("page-me-notifications");
  await page.goto("/p/me/notifications");
  await expect(screen).toHaveAttribute("data-state", "default");
  await shot(page, "我", "通知-没开");
  const welcome = service.next(sub.id);
  await page.getByTestId("push-on").click();
  await welcome;
  await expect(screen).toHaveAttribute("data-state", "on");
  await shot(page, "我", "通知-开着");
  // the 8:45 and 9:15 reminders of the next morning go out, he opens neither, and the window closes at 9:45
  for (const at of ["08:45", "09:15", "09:46"]) {
    await setClock(request, SGT("2026-10-13", at));
    expect((await request.post("/api/dev/tick", { data: {} })).status()).toBe(200);
  }
  await page.goto("/p/me/notifications");
  await expect(screen).toHaveAttribute("data-state", "on");
  if ((await page.getByTestId("push-recent").count()) > 0) await shot(page, "我", "通知-开着-最近的提醒");
  await page.getByTestId("push-off").click();
  await expect(screen).toHaveAttribute("data-state", "off");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "我", "通知-这台手机关着");
  await context.close();
});

test("我 › 登录和设备、改密码、恢复码、让家人帮我", async ({ browser, request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
  const login = `s${randomUUID().slice(0, 12)}`;
  const context = await phone(browser, { userAgent: IPHONE_UA });
  await signUp(context, { login, password: PASSWORD, displayName: "陈先生", space: "example" });
  const tablet = await browser.newContext({ baseURL: BASE_URL, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36" });
  await logIn(tablet, { login, password: PASSWORD, notMyPhone: true });
  const page = await context.newPage();

  await page.goto("/p/me/devices");
  await expect(page.getByTestId("device-row")).toHaveCount(2);
  await shot(page, "我", "登录和设备");
  await page.goto("/p/me");
  await expect(page.locator('[data-entry="account"]')).toBeVisible();
  await page.locator('[data-entry="account"]').scrollIntoViewIfNeeded();
  await shot(page, "我", "我-1-两台设备");

  await page.goto("/p/me/password");
  await expect(page.getByTestId("password-save")).toBeVisible();
  await shot(page, "我", "改密码");
  await page.getByTestId("password-current").fill("not the password");
  await page.getByTestId("password-new").fill("12345678");
  await page.getByTestId("password-save").click();
  await expect(page.getByTestId("password-error")).toBeVisible();
  await shot(page, "我", "改密码-新密码太常见");
  await page.getByTestId("password-new").fill("a new long password");
  await page.getByTestId("password-save").click();
  await expect(page.getByTestId("password-error")).toBeVisible();
  await shot(page, "我", "改密码-密码不对");
  await page.getByTestId("password-current").fill(PASSWORD);
  await page.getByTestId("password-new").fill("a new long password");
  await page.getByTestId("password-save").click();
  await expect(page.getByTestId("password-done")).toBeVisible();
  await shot(page, "我", "改密码-改好了");

  await page.goto("/p/me/recovery");
  await expect(page.getByTestId("recovery-new")).toBeVisible();
  await shot(page, "我", "恢复码");
  await page.getByTestId("recovery-password").fill("a new long password");
  await page.getByTestId("recovery-new").click();
  await expect(page.getByTestId("recovery-done")).toBeVisible();
  await shot(page, "我", "恢复码-新的");
  await page.getByTestId("recovery-print-card").click();
  await expect(page.getByTestId("recovery-card")).toBeVisible();
  await shot(page, "我", "恢复码-卡片");

  // nobody confirmed yet, then Wei Ling confirmed: her switch
  await page.goto("/p/me/reset-help");
  await expect(page.getByTestId("page-me-reset-help")).toBeVisible();
  await shot(page, "我", "让家人帮我-还没有家人");
  const her = await browser.newContext({ baseURL: BASE_URL });
  await account(her, "none", { display_name: "Wei Ling" });
  await linkFamily(context, her, { label: "Wei Ling", calls: "爸爸" });
  await page.goto("/p/me/reset-help");
  await expect(page.getByTestId("reset-help-switches")).toBeVisible();
  await page.getByTestId("reset-help-switches").getByRole("switch").click();
  await expect(page.getByTestId("reset-help-switches").getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await shot(page, "我", "让家人帮我");
  await her.close();
  await tablet.close();
  await context.close();
});

test("我 › 称呼、语言、早饭时间和提醒", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context, "blank", { display_name: "陈先生" });
  const page = await context.newPage();
  await page.goto("/p/profile/name");
  await expect(page.getByTestId("me-name-input")).toBeVisible();
  await shot(page, "我", "称呼");
  await page.getByTestId("me-name-input").fill("陈".repeat(41));
  await page.getByTestId("me-name-save").click();
  await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
  await shot(page, "我", "称呼-太长");

  await page.goto("/p/profile/language");
  await expect(page.getByTestId("me-lang-zh-Hans")).toHaveAttribute("data-current", "true");
  await shot(page, "我", "语言");

  await page.goto("/p/profile/times");
  await expect(page.locator('[data-rp="slot-times"]')).toBeVisible();
  await shot(page, "我", "早饭时间和提醒");
  await page.goto("/p/profile/times/midday");
  await expect(page.getByTestId("slot-time-save")).toBeVisible();
  await page.getByTestId("slot-time-12:00").click();
  await shot(page, "我", "提醒时间-中午");
  await page.getByTestId("slot-time-save").click();
  await page.waitForURL("**/p/profile/times");
  await page.goto("/p/profile/times/night");
  await page.getByTestId("slot-time-other").click();
  await page.getByTestId("slot-time-input").fill("23:40");
  await page.getByTestId("slot-time-save").click();
  await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
  await shot(page, "我", "提醒时间-睡前-出了范围");
  await page.goto("/p/profile/times/midday");
  await expect(page.getByTestId("slot-time-clear")).toBeVisible();
  await shot(page, "我", "提醒时间-中午-自己定的");
  await context.close();
});
