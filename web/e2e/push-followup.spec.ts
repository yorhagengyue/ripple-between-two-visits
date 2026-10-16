/**
 * Track I's follow-up round (real-app 2.6, 2.19, 2.21, 2.24), each on real accounts in a browser:
 *
 *   「我」 itself says where this phone's reminders stand: 提醒还没开 with 「开提醒」 right there, 提醒开着 after the
 *       welcome went out; after a refusal 「提醒没开：打开 app 时才看得到」 with 「再试一次」 (no asking again);
 *   turning reminders on counts only when 「提醒已经开好了」 could be sent: a push service that does not take it leaves
 *       nothing on (the notifications page and setting up both say so, no row on the server, no subscription left in
 *       the browser), and the next try can succeed;
 *   「装到主屏」: Android's offer made on a page without the button is still there on 「我」 and on 「提醒和通知」, and is
 *       used once;
 *   the iPhone's three steps come with pictures and before any tap, in setting up as well; the manual (/how) prints
 *       the same sentences in both languages;
 *   his invitation screen: 「发给她」 opens the phone's share sheet (the WhatsApp address without one), 「复制」, a QR code;
 *   her home offers 「开通知：爸爸没回时告诉你」 only while his no-reply switch is on and her phone has no push;
 *   signing out removes this phone's subscription on the server first and ends it in the browser.
 *
 * The phone's push service is tests/support/push-service.ts (headless Chromium has none). Needs the developer tools
 * (dev accounts, local push endpoints): a build started with RIPPLE_DEV_TOOLS=1, or next dev.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startPushService, type PushService } from "../tests/support/push-service";
import { expectPageChecks } from "./_checks/page-checks";
import { BASE_URL } from "./helpers";
import { linkFamily, setSwitches } from "./journeys/_d/family";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

const PASSWORD = "plum blossom tea";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const STUB_KEY = "__rpTestPushSubscription";

let service: PushService;
test.beforeAll(async () => {
  service = await startPushService();
});
test.afterAll(async () => {
  await service.close();
});

interface PhoneOptions {
  locale?: "zh-Hans" | "en";
  userAgent?: string;
  space?: "example" | "blank" | "none";
  onboarding?: "started";
  name?: string;
  init?: (context: BrowserContext) => Promise<unknown>;
}

async function phone(browser: Browser, opts: PhoneOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: opts.locale === "en" ? "en-SG" : "zh-CN",
    timezoneId: "Asia/Singapore",
    ...(opts.userAgent ? { userAgent: opts.userAgent, isMobile: true, hasTouch: true } : {}),
  });
  if (opts.locale === "en") await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  if (opts.init) await opts.init(context);
  const made = await context.request.post("/api/dev/accounts", {
    data: { login: `pf.${randomUUID().slice(0, 8)}`, password: PASSWORD, space: opts.space ?? "example", display_name: opts.name ?? "陈先生", ...(opts.onboarding ? { onboarding: opts.onboarding } : {}) },
  });
  expect(made.status(), await made.text()).toBe(201);
  return { context, page: await context.newPage() };
}

const meStatus = (page: Page) => page.getByTestId("me-push-status");

for (const lang of ["zh-Hans", "en"] as const) {
  const zh = lang === "zh-Hans";
  test(`「我」 says this phone's real state: 提醒还没开, 「开提醒」 there, then 提醒开着 (${lang})`, async ({ browser }) => {
    const sub = service.newPhone({ label: `me-${lang}` });
    const { context, page } = await phone(browser, {
      locale: lang,
      init: async (c) => {
        await answerPermissionPrompt(c, "granted");
        await stubPushSubscription(c, sub);
      },
    });
    await page.goto("/p/me");
    await expect(meStatus(page)).toHaveAttribute("data-state", "default");
    await expect(meStatus(page)).toHaveText(zh ? "提醒还没开" : "Reminders are off");
    await expect(page.locator('[data-entry="notifications"]').first()).toHaveAttribute("href", "/p/me/notifications");
    const on = page.getByTestId("me-push-on");
    await expect(on).toHaveText(zh ? "开提醒" : "Turn on reminders");
    await expectPageChecks(page, { side: "elder" });

    const welcome = service.next(sub.id);
    await on.click();
    expect((await welcome).payload).toMatchObject({ kind: "welcome", title: zh ? "提醒已经开好了" : "Reminders are on" });
    await expect(meStatus(page)).toHaveAttribute("data-state", "on");
    await expect(meStatus(page)).toHaveText(zh ? "提醒开着" : "Reminders are on");
    await expect(page.getByTestId("me-push-result")).toHaveText(zh ? "提醒已经开好了。刚才发了一条试试，手机顶上应该出现了。" : "Reminders are on. A test was just sent: it should be at the top of your phone.");
    await expect(on).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });

    // read again from the phone and the server: on, and nothing left to do from 「我」
    await page.reload();
    await expect(meStatus(page)).toHaveAttribute("data-state", "on");
    await expect(page.locator('[data-rp="me-entry-more"]')).toHaveCount(0);
    await context.close();
  });
}

test("「我」 after a refusal: 「提醒没开：打开 app 时才看得到」 with 「再试一次」, and no asking again", async ({ browser }) => {
  const { context, page } = await phone(browser, {
    init: (c) =>
      c.addInitScript(() => {
        Object.defineProperty(Notification, "permission", { get: () => "denied" });
        (window as unknown as { __rpAsked: number }).__rpAsked = 0;
        Notification.requestPermission = async () => {
          (window as unknown as { __rpAsked: number }).__rpAsked += 1;
          return "denied";
        };
      }),
  });
  await page.goto("/p/me");
  await expect(meStatus(page)).toHaveAttribute("data-state", "denied");
  await expect(meStatus(page)).toHaveText("提醒没开：打开 app 时才看得到");
  await expect(page.getByTestId("me-push-on")).toHaveCount(0);
  const retry = page.getByTestId("me-push-retry");
  await expect(retry).toHaveText("再试一次");
  await expectPageChecks(page, { side: "elder" });
  await retry.click();
  await expect(page.getByTestId("me-push-result")).toContainText("还是没开");
  // still refused: the browser was not asked again
  expect(await page.evaluate(() => (window as unknown as { __rpAsked: number }).__rpAsked)).toBe(0);
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

test("his list of recent reminders names 「家人接受了邀请」, and says when he opened it", async ({ browser }) => {
  const sub = service.newPhone({ label: "recent" });
  const his = await phone(browser, {
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  const hers = await phone(browser, { space: "none", name: "Wei Ling" });
  const page = his.page;
  await page.goto("/p/me/notifications");
  const welcome = service.next(sub.id);
  await page.getByTestId("push-on").click();
  await welcome;
  await expect(page.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "on");

  // she accepts his invitation: his phone is told
  const invited = await his.context.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
  expect(invited.status(), await invited.text()).toBe(201);
  const invitation = (await invited.json()) as { path: string; link: { id: string } };
  const told = service.next(sub.id);
  const accepted = await hers.context.request.post("/api/family/invites/accept", { data: { token: invitation.path.replace(/^\/invite\//, "") } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  const notice = await told;
  expect(notice.payload).toMatchObject({ kind: "family_accepted", title: "Wei Ling 已经接受", url: "/p/today?confirm=1", tag: `family-accepted-${invitation.link.id}` });

  // the page lists it, not opened yet
  await page.reload();
  const recent = page.getByTestId("push-recent");
  await expect(recent).toContainText("家人接受了邀请");
  await expect(recent).toContainText("没点开");
  await expect(recent).toHaveAttribute("data-opened", "0");
  await expect(recent).not.toContainText("undefined");
  await expectPageChecks(page, { side: "elder" });

  // his tap (what the service worker posts from the notification): the page says when
  const opened = await his.context.request.post("/api/push/opened", { data: { delivery: notice.payload?.delivery } });
  expect(await opened.json()).toMatchObject({ recorded: true });
  await page.reload();
  await expect(recent).toHaveAttribute("data-opened", "1");
  await expect(recent).toContainText("点开了");
  await his.context.close();
  await hers.context.close();
});

test("a welcome the push service does not take: reminders are not on anywhere, and the next try succeeds", async ({ browser }) => {
  const sub = service.newPhone({ label: "flaky" });
  sub.answer = 500;
  const { context, page } = await phone(browser, {
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  await page.goto("/p/me/notifications");
  const screen = page.getByTestId("page-me-notifications");
  await expect(screen).toHaveAttribute("data-state", "default");
  await page.getByTestId("push-on").click();
  await expect(page.getByTestId("push-result")).toHaveText("没开成：试发的那一条提醒没有到这台手机。再点一次「开提醒」。");
  await expect(page.getByTestId("push-result")).toHaveAttribute("data-tone", "problem");
  await expect(screen).not.toHaveAttribute("data-state", "on");
  // nothing half-on: no row on the server, no subscription left in the browser
  expect(await (await context.request.get(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`)).json()).toMatchObject({ subscribed: false, devices: 0 });
  expect(await page.evaluate((k) => localStorage.getItem(k), STUB_KEY)).toBeNull();
  await page.goto("/p/me");
  await expect(meStatus(page)).toHaveText("提醒还没开");

  // the push service is back: the same tap turns them on
  sub.answer = 201;
  const welcome = service.next(sub.id);
  await page.getByTestId("me-push-on").click();
  expect((await welcome).payload).toMatchObject({ kind: "welcome" });
  await expect(meStatus(page)).toHaveAttribute("data-state", "on");
  expect(await (await context.request.get(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`)).json()).toMatchObject({ subscribed: true, devices: 1 });
  await context.close();
});

test("setting up: 「开提醒」 is not recorded as on when the welcome could not be sent; 「再试一次」 then works", async ({ browser }) => {
  const sub = service.newPhone({ label: "onboard" });
  sub.answer = 500;
  const { context, page } = await phone(browser, {
    space: "blank",
    onboarding: "started",
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  await page.goto("/onboard/reminders");
  await page.getByTestId("onboard-reminders-on").click();
  const result = page.locator('[data-rp="reminders-result"]');
  await expect(result).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("onboard-reminders-on")).toHaveText("再试一次");
  expect(new URL(page.url()).pathname).toBe("/onboard/reminders");
  expect(await (await context.request.get("/api/push")).json()).toMatchObject({ devices: 0 });
  await expectPageChecks(page, { side: "elder" });

  sub.answer = 201;
  const welcome = service.next(sub.id);
  await page.getByTestId("onboard-reminders-on").click();
  expect((await welcome).payload).toMatchObject({ kind: "welcome", title: "提醒已经开好了" });
  await page.waitForURL("**/onboard/done");
  expect(await (await context.request.get("/api/push")).json()).toMatchObject({ devices: 1 });
  await context.close();
});

test("「装到主屏」: an offer Android made on another page is still there on 「我」 and on 「提醒和通知」, and is used once", async ({ browser }) => {
  const { context, page } = await phone(browser);
  // a page with no install button of its own
  await page.goto("/p/me/devices");
  await expect(page.getByTestId("page-me-devices")).toBeVisible();
  const prevented = await page.evaluate(() => {
    const w = window as unknown as { __rpPrompted: number };
    w.__rpPrompted = 0;
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => {
      w.__rpPrompted += 1;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  // caught by the app (the browser's own banner is held back), though nothing on this page shows a button
  expect(prevented).toBe(true);
  await expect(page.getByTestId("push-install")).toHaveCount(0);

  // on to 「我」 without a reload: the button is there
  await page.locator('a[href="/p/me"]').first().click();
  await page.waitForURL("**/p/me");
  const onMe = page.getByTestId("me-install");
  await expect(onMe).toHaveText("装到主屏");
  await expectPageChecks(page, { side: "elder" });

  // and on 「提醒和通知」
  await page.locator('[data-entry="notifications"]').first().click();
  await page.waitForURL("**/p/me/notifications");
  const install = page.getByTestId("push-install");
  await expect(install).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
  await install.click();
  await expect(page.getByTestId("push-result")).toHaveText("装好了。以后从主屏幕上的 Ripple 图标打开。");
  expect(await page.evaluate(() => (window as unknown as { __rpPrompted: number }).__rpPrompted)).toBe(1);
  await expect(install).toHaveCount(0);
  await page.locator('a[href="/p/me"]').first().click();
  await page.waitForURL("**/p/me");
  await expect(page.getByTestId("me-install")).toHaveCount(0);
  await context.close();
});

for (const lang of ["zh-Hans", "en"] as const) {
  test(`an iPhone outside the Home Screen: three pictured steps before any tap, in setting up too (${lang})`, async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: lang, userAgent: IPHONE_UA, space: "blank", onboarding: "started" });
    await page.goto("/onboard/reminders");
    const first = page.locator('[data-rp="reminders-home-first"]');
    await expect(first.locator('[data-rp="row"]')).toHaveCount(3);
    await expect(first.locator('[data-rp="step-picture"]')).toHaveCount(3);
    await expect(first.locator('[data-rp="row"]').nth(1)).toContainText(lang === "zh-Hans" ? "添加到主屏幕" : "Add to Home Screen");
    // nothing was tapped: no result yet, and the screen's own buttons are as before
    await expect(page.locator('[data-rp="reminders-result"]')).toHaveCount(0);
    await expect(page.getByTestId("onboard-reminders-on")).toBeVisible();
    await expectPageChecks(page, { side: "elder" });
    // the pictures are drawn (the icon loads, the glyphs have a size)
    const sizes = await first.locator('[data-rp="step-picture"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    for (const w of sizes) expect(w).toBeGreaterThanOrEqual(56);
    expect(await first.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    // C2 track L: his other pages open once setting up is finished (real-app 3.7: until then /p goes back to /onboard)
    expect((await context.request.post("/api/profile/onboard", { data: { step: "done" } })).ok()).toBe(true);
    await page.goto("/p/me/notifications");
    await expect(page.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "needs_home_screen");
    await expect(page.getByTestId("push-ios-steps").locator('[data-rp="step-picture"]')).toHaveCount(3);
    await page.goto("/p/me");
    await expect(meStatus(page)).toHaveText(lang === "zh-Hans" ? "iPhone 要先把 Ripple 加到主屏幕" : "On an iPhone, add Ripple to the Home Screen first");
    await expect(page.getByTestId("me-push-on")).toHaveCount(0);
    await context.close();
  });
}

test("the manual (/how) prints the same instructions, in both languages, and nothing scrolls sideways", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto("/how");
  const section = page.getByTestId("how-install");
  await expect(section).toBeVisible();
  const en = page.getByTestId("how-install-en");
  const zh = page.getByTestId("how-install-zh");
  await expect(en).toContainText("iPhones only deliver notifications to a web app that was added to the Home Screen");
  await expect(zh).toContainText("苹果手机只给放在主屏幕上的网页 app 发通知");
  await expect(en.getByTestId("how-install-steps").locator("li")).toHaveCount(3);
  await expect(zh.getByTestId("how-install-steps").locator("li")).toHaveCount(3);
  // the very sentences the phone shows
  await expect(zh.getByTestId("how-install-steps").locator("li").nth(1)).toHaveText("往下找，点「添加到主屏幕」，再点「添加」。");
  await expect(en.getByTestId("how-install-steps").locator("li").nth(1)).toHaveText("Scroll down, tap “Add to Home Screen”, then “Add”.");
  await expect(zh).toContainText("装到主屏");
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
  const box = (await section.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await context.close();
});

for (const lang of ["zh-Hans", "en"] as const) {
  test(`his invitation: 「发给她」 opens the share sheet, 「复制」, and the link as a QR code (${lang})`, async ({ browser }) => {
    const { context, page } = await phone(browser, {
      locale: lang,
      init: async (c) => {
        await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
        await c.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, "share", {
            configurable: true,
            value: async (data: ShareData) => {
              (window as unknown as { __rpShared?: ShareData }).__rpShared = data;
            },
          });
        });
      },
    });
    await page.goto("/p/family");
    await page.getByTestId("family-invite").click();
    await page.getByTestId("invite-name").fill("Wei Ling");
    await page.getByTestId("invite-make").click();
    const made = page.getByTestId("invite-made");
    await expect(made).toBeVisible();
    const url = (await made.getAttribute("data-url"))!;

    // the QR code: a real code (a few hundred dark modules), big enough for a camera
    const qr = page.getByTestId("invite-qr").locator("svg");
    await expect(qr).toHaveAttribute("role", "img");
    expect(((await qr.locator("path").getAttribute("d")) ?? "").split("M").length).toBeGreaterThan(300);
    expect((await qr.boundingBox())!.width).toBeGreaterThanOrEqual(190);

    // 「发给她」: full width, the phone's share sheet gets the sentence with the link; the address stays WhatsApp's
    const send = page.getByTestId("invite-whatsapp");
    await expect(send).toHaveText(lang === "zh-Hans" ? "发给她" : "Send it to her");
    await expect(send).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    const sendBox = (await send.boundingBox())!;
    expect(sendBox.width).toBeGreaterThan(300);
    await send.click();
    const shared = await page.evaluate(() => (window as unknown as { __rpShared?: ShareData }).__rpShared ?? null);
    expect(shared?.text).toContain(url);
    expect(page.url()).toContain("/p/family");

    // 「复制」
    const copy = page.getByTestId("invite-copy");
    await expect(copy).toHaveText(lang === "zh-Hans" ? "复制" : "Copy");
    await copy.click();
    await expect(page.getByTestId("invite-copied")).toHaveText(lang === "zh-Hans" ? "复制好了。" : "Copied.");
    await expectPageChecks(page, { side: "elder" });
    await context.close();
  });
}

test("a browser without a share sheet: 「发给她」 is the WhatsApp link", async ({ browser }) => {
  const { context, page } = await phone(browser, {
    init: (c) =>
      c.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
      }),
  });
  await page.goto("/p/family/invite");
  await page.getByTestId("invite-name").fill("Mei");
  await page.getByTestId("invite-make").click();
  const send = page.getByTestId("invite-whatsapp");
  await expect(send).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*${encodeURIComponent("邀请你看他的 Ripple")}`));
  // the tap follows the link itself (not followed here: it leaves the app)
  const went = page.waitForRequest((r) => r.url().startsWith("https://wa.me/"), { timeout: 5000 }).catch(() => null);
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>wa</body></html>" }));
  await send.click();
  expect(await went).not.toBeNull();
  await context.close();
});

test("her home: 「开通知：爸爸没回时告诉你」 only while his no-reply switch is on and her phone has no push", async ({ browser }) => {
  const sub = service.newPhone({ label: "her home" });
  const his = await phone(browser, { name: "陈先生" });
  const hers = await phone(browser, {
    space: "none",
    name: "Wei Ling",
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });
  await setSwitches(his.context, linkId, { dose_summary: true });
  const dp = hers.page;
  await dp.goto(`/f?link=${encodeURIComponent(linkId)}`);
  await dp.evaluate((id) => {
    localStorage.setItem(`rp_f_welcomed_${id}`, "1");
    localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
  }, linkId);
  await dp.reload();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
  // his switch is off: nothing is offered
  await expect(dp.getByTestId("record-new")).toBeVisible();
  await expect(dp.getByTestId("push-nudge")).toHaveCount(0);

  // his switches screen says nothing about her phone while that switch is off
  const hp = his.page;
  await hp.goto(`/p/family/${encodeURIComponent(linkId)}`);
  await expect(hp.getByTestId("link-switches")).toBeVisible();
  await expect(hp.getByTestId("her-push-off")).toHaveCount(0);

  // he switches it on (on his screen): her open page follows by itself, and his screen says she cannot be told yet
  await hp.locator('[data-grant="no_reply_alert"] [role="switch"]').click();
  await expect(hp.getByTestId("her-push-off")).toHaveText("Wei Ling 还没打开通知，现在收不到。她在自己的手机上打开以后才会收到。");
  await expectPageChecks(hp, { side: "elder" });
  const on = dp.getByTestId("push-nudge-on");
  await expect(on).toHaveText("开通知：爸爸没回时告诉你", { timeout: 10_000 });
  await expectPageChecks(dp, { side: "family" });

  const welcome = service.next(sub.id);
  await on.click();
  expect((await welcome).payload).toMatchObject({ kind: "welcome", title: "通知已经开好了", url: "/f" });
  await expect(dp.getByTestId("push-nudge-said")).toHaveText("通知开好了。");
  await expect(on).toHaveCount(0);
  await expectPageChecks(dp, { side: "family" });
  // her phone has push now: nothing is offered any more, and his screen no longer says she cannot be told
  await dp.reload();
  await expect(dp.getByTestId("record-new")).toBeVisible();
  await expect(dp.getByTestId("push-nudge")).toHaveCount(0);
  await hp.reload();
  await expect(hp.getByTestId("link-switches")).toBeVisible();
  await expect(hp.locator('[data-grant="no_reply_alert"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
  await expect(hp.getByTestId("her-push-off")).toHaveCount(0);
  await his.context.close();
  await hers.context.close();
});

test("her home after she refused notifications: no asking again", async ({ browser }) => {
  const his = await phone(browser, { name: "陈先生" });
  const hers = await phone(browser, {
    space: "none",
    name: "Wei Ling",
    init: (c) =>
      c.addInitScript(() => {
        Object.defineProperty(Notification, "permission", { get: () => "denied" });
        Notification.requestPermission = async () => "denied";
      }),
  });
  const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });
  await setSwitches(his.context, linkId, { no_reply_alert: true });
  const dp = hers.page;
  await dp.goto(`/f?link=${encodeURIComponent(linkId)}`);
  await dp.evaluate((id) => localStorage.setItem(`rp_f_welcomed_${id}`, "1"), linkId);
  await dp.reload();
  await expect(dp.getByTestId("record-new")).toBeVisible();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
  // the line says notifications are off (the v3 draft's I4) and leads to 「我的」, which says how to turn them on;
  // nothing on her home asks the browser again
  await expect(dp.getByTestId("push-nudge")).toHaveAttribute("data-state", "denied");
  await expect(dp.getByTestId("push-nudge")).toContainText("通知关着，爸爸没回时你收不到。");
  await expect(dp.getByTestId("push-nudge-on")).toHaveCount(0);
  await expect(dp.getByTestId("push-nudge-open")).toHaveAttribute("href", new RegExp(`^/f/me.*link=${linkId}`));
  await his.context.close();
  await hers.context.close();
});

test("「退出登录」 takes this phone's subscription away first: the server row goes, the browser's subscription ends", async ({ browser }) => {
  const sub = service.newPhone({ label: "logout" });
  const { context, page } = await phone(browser, {
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  await page.goto("/p/me/notifications");
  const welcome = service.next(sub.id);
  await page.getByTestId("push-on").click();
  await welcome;
  await expect(page.getByTestId("page-me-notifications")).toHaveAttribute("data-state", "on");
  expect(await (await context.request.get(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`)).json()).toMatchObject({ subscribed: true, devices: 1 });

  await page.goto("/p/me/devices");
  // what the page sends, in order, with the answers (read here: the page leaves for the login right after)
  const seen: { what: string; status: number; body: unknown }[] = [];
  await context.route("**/api/push/subscribe", async (route) => {
    const response = await route.fetch();
    seen.push({ what: `${route.request().method()} push`, status: response.status(), body: await response.json().catch(() => null) });
    await route.fulfill({ response });
  });
  await context.route("**/api/auth/logout", async (route) => {
    seen.push({ what: "logout", status: 0, body: null });
    await route.continue();
  });
  await page.getByTestId("logout").click();
  await page.waitForURL("**/login**");
  // the removal was answered before the sign-out was sent (it needs his sign-in)
  expect(seen).toEqual([
    { what: "DELETE push", status: 200, body: { removed: true } },
    { what: "logout", status: 0, body: null },
  ]);
  expect(await page.evaluate((k) => localStorage.getItem(k), STUB_KEY)).toBeNull();
  // a push for that phone now has no row to go to: a test push as him is not possible (signed out), and the phone's
  // push service got nothing after the welcome
  expect(service.messages.filter((m) => m.phone === sub.id)).toHaveLength(1);
  await context.close();
});
