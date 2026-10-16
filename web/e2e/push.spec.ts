/**
 * 「我 › 提醒和通知」 and the web app's install pieces (C2 track I; real-app 2.6, 2.23, 8.10; the elder brief's 通用状态):
 *   - never asked: 「开提醒」 asks (on the tap), subscribes, 「提醒已经开好了」 reaches the phone's push service; 「发一条试试」
 *     sends one; 「关掉这台手机的提醒」 removes it on the server; in both languages, every state passes the page checks
 *     (360 px, 18 px text, 48 px targets, contrast);
 *   - refused: no asking again, how to allow it in the settings, 「再试一次」;
 *   - an iPhone outside the Home Screen: the three steps; a browser without push: what still works;
 *   - the manifest (standalone, start at Today, the icons) is linked from the page and every icon is there.
 * The phone's push service is tests/support/push-service.ts (headless Chromium has none): it checks VAPID and opens
 * each message like a real one. Needs the developer tools (dev accounts, local push endpoints): next dev, or a build
 * started with RIPPLE_DEV_TOOLS=1.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startPushService, type PushService } from "../tests/support/push-service";
import { expectPageChecks } from "./_checks/page-checks";
import { BASE_URL } from "./helpers";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

const PASSWORD = "plum blossom tea";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

let service: PushService;
test.beforeAll(async () => {
  service = await startPushService();
});
test.afterAll(async () => {
  await service.close();
});

async function phone(
  browser: Browser,
  opts: { locale?: "zh-Hans" | "en"; userAgent?: string; init?: (context: BrowserContext) => Promise<unknown> } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: opts.locale === "en" ? "en-SG" : "zh-CN",
    timezoneId: "Asia/Singapore",
    ...(opts.userAgent ? { userAgent: opts.userAgent, isMobile: true, hasTouch: true } : {}),
  });
  if (opts.locale === "en") await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  if (opts.init) await opts.init(context);
  const made = await context.request.post("/api/dev/accounts", { data: { login: `push.${randomUUID().slice(0, 8)}`, password: PASSWORD, space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  return { context, page: await context.newPage() };
}

const screen = (page: Page) => page.getByTestId("page-me-notifications");

for (const lang of ["zh-Hans", "en"] as const) {
  const zh = lang === "zh-Hans";
  test(`never asked: 开提醒 subscribes and the welcome arrives; 发一条试试; 关掉 (${lang})`, async ({ browser }) => {
    const sub = service.newPhone({ label: `page-${lang}` });
    const { context, page } = await phone(browser, {
      locale: lang,
      init: async (c) => {
        await answerPermissionPrompt(c, "granted");
        await stubPushSubscription(c, sub);
      },
    });
    await page.goto("/p/me/notifications");
    await expect(screen(page)).toHaveAttribute("data-state", "default");
    await expect(page.locator('[data-rp="headline"]')).toHaveText(zh ? "提醒还没开。" : "Reminders are off.");
    await expect(page.getByTestId("page-me-notifications")).toContainText(zh ? "不写药名" : "never the medicine's name");
    await expect(page.locator("link[rel=manifest]")).toHaveAttribute("href", "/manifest.webmanifest");
    await expectPageChecks(page, { side: "elder" });

    const welcome = service.next(sub.id);
    await page.getByTestId("push-on").click();
    await expect(screen(page)).toHaveAttribute("data-state", "on");
    const m = await welcome;
    expect(m.payload).toMatchObject({ kind: "welcome", title: zh ? "提醒已经开好了" : "Reminders are on", url: "/p/me/notifications" });
    await expect(page.getByTestId("push-result")).toHaveText(zh ? "提醒已经开好了。刚才发了一条试试，手机顶上应该出现了。" : "Reminders are on. A test was just sent: it should be at the top of your phone.");
    expect(await page.evaluate(() => (window as unknown as { __rpSubscribedWith?: string }).__rpSubscribedWith)).toBe(m.vapidKey);
    // the example has a morning medicine: its reminder times are listed
    await expect(screen(page)).toContainText(zh ? "早上的药" : "Morning medicine");
    await expect(screen(page)).toContainText(zh ? "8:45，没回 9:15 再问一次" : "8:45, and 9:15 if there is no answer");
    await expectPageChecks(page, { side: "elder" });

    const test1 = service.next(sub.id);
    await page.getByTestId("push-test").click();
    expect((await test1).payload).toMatchObject({ kind: "test" });
    await expect(page.getByTestId("push-result")).toHaveText(zh ? "发出去了，看一下手机顶上。" : "Sent. Look at the top of your phone.");

    // a reload reads the same state back from the phone and the server
    await page.reload();
    await expect(screen(page)).toHaveAttribute("data-state", "on");

    await page.getByTestId("push-off").click();
    await expect(screen(page)).toHaveAttribute("data-state", "off");
    await expect(page.getByTestId("push-result")).toHaveText(zh ? "这台手机的提醒关掉了。" : "Reminders are off on this phone.");
    const status = await context.request.get(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
    expect(await status.json()).toMatchObject({ subscribed: false, devices: 0 });
    await expectPageChecks(page, { side: "elder" });
    await context.close();
  });
}

test("headless Chromium after a grant reads permission 'denied': the page still sees it allowed and 开提醒 turns it on", async ({ browser }) => {
  const sub = service.newPhone({ label: "granted-shell" });
  const { context, page } = await phone(browser, {
    init: async (c) => {
      await c.grantPermissions(["notifications"], { origin: BASE_URL });
      await stubPushSubscription(c, sub);
    },
  });
  await page.goto("/p/me/notifications");
  // allowed, not subscribed yet on this phone
  await expect(screen(page)).toHaveAttribute("data-state", "off");
  const welcome = service.next(sub.id);
  await page.getByTestId("push-on").click();
  await expect(screen(page)).toHaveAttribute("data-state", "on");
  expect((await welcome).payload).toMatchObject({ kind: "welcome" });
  await context.close();
});

test("refused: no asking again; how to allow it in the settings; 再试一次 says it is still off", async ({ browser }) => {
  const { context, page } = await phone(browser, {
    init: (c) =>
      c.addInitScript(() => {
        Object.defineProperty(Notification, "permission", { get: () => "denied" });
        Notification.requestPermission = async () => "denied";
      }),
  });
  await page.goto("/p/me/notifications");
  await expect(screen(page)).toHaveAttribute("data-state", "denied");
  await expect(page.locator('[data-rp="headline"]')).toContainText("打开 app 时才看得到");
  await expect(screen(page)).toContainText("网站设置");
  await expect(page.getByTestId("push-on")).toHaveCount(0);
  await page.getByTestId("push-retry").click();
  await expect(page.getByTestId("push-result")).toContainText("还是没开");
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

for (const lang of ["zh-Hans", "en"] as const) {
  test(`an iPhone outside the Home Screen: the three steps (${lang})`, async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: lang, userAgent: IPHONE_UA });
    await page.goto("/p/me/notifications");
    await expect(screen(page)).toHaveAttribute("data-state", "needs_home_screen");
    const steps = page.getByTestId("push-ios-steps").locator('[data-rp="row"]');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(1)).toContainText(lang === "zh-Hans" ? "添加到主屏幕" : "Add to Home Screen");
    // each step with its picture (real-app 2.6 三步图文)
    await expect(page.getByTestId("push-ios-steps").locator('[data-rp="step-picture"]')).toHaveCount(3);
    await expect(page.getByTestId("push-on")).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });
    await context.close();
  });
}

test("a browser without push: reminders still show on Today", async ({ browser }) => {
  const { context, page } = await phone(browser, { init: (c) => c.addInitScript(() => delete (window as unknown as { PushManager?: unknown }).PushManager) });
  await page.goto("/p/me/notifications");
  await expect(screen(page)).toHaveAttribute("data-state", "unsupported");
  await expect(screen(page)).toContainText("「今天」页");
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

test("「我」 links here; the web app manifest and its icons are served", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto("/p/me");
  const entry = page.locator('[data-entry="notifications"]');
  await expect(entry).toHaveAttribute("href", "/p/me/notifications");
  await expect(entry).not.toContainText("待建");
  const res = await context.request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as { display: string; start_url: string; scope: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/p/today", scope: "/" });
  expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const src of [...manifest.icons.map((i) => i.src), "/icons/apple-touch-icon.png", "/icons/badge-72.png", "/sw.js"]) {
    const r = await context.request.get(src);
    expect(r.status(), src).toBe(200);
  }
  await context.close();
});
