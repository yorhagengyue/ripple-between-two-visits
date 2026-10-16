/**
 * Pictures of track I's follow-up screens for a person to judge the look (not a check): only with I_SHOTS_DIR set.
 *   I_SHOTS_DIR=D:/ripple-c2/tmp/i/shots PW_PORT=3600 npx playwright test e2e/push-shots.spec.ts
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startPushService } from "../tests/support/push-service";
import { BASE_URL } from "./helpers";
import { linkFamily, setSwitches } from "./journeys/_d/family";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

const SHOTS = process.env.I_SHOTS_DIR?.trim() || null;
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

test.skip(!SHOTS, "set I_SHOTS_DIR to save pictures");

async function phone(browser: Browser, opts: { userAgent?: string; space?: string; onboarding?: string; name?: string; init?: (c: BrowserContext) => Promise<unknown> } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", ...(opts.userAgent ? { userAgent: opts.userAgent, isMobile: true, hasTouch: true } : {}) });
  if (opts.init) await opts.init(context);
  const made = await context.request.post("/api/dev/accounts", { data: { login: `ps.${randomUUID().slice(0, 8)}`, password: "plum blossom tea", space: opts.space ?? "example", display_name: opts.name ?? "陈先生", ...(opts.onboarding ? { onboarding: opts.onboarding } : {}) } });
  expect(made.status(), await made.text()).toBe(201);
  return { context, page: await context.newPage() };
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS!, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS!, `${name}.png`), fullPage: true });
}

test("pictures", async ({ browser }) => {
  test.setTimeout(120_000);
  const service = await startPushService();
  try {
    // 「我」: never asked, with Android's install offer; then on
    const sub = service.newPhone({ label: "shots" });
    const a = await phone(browser, {
      init: async (c) => {
        await answerPermissionPrompt(c, "granted");
        await stubPushSubscription(c, sub);
      },
    });
    await a.page.goto("/p/me");
    await expect(a.page.getByTestId("me-push-on")).toBeVisible();
    await a.page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => undefined;
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(e);
    });
    await expect(a.page.getByTestId("me-install")).toBeVisible();
    await shot(a.page, "me-off-install");
    await a.page.getByTestId("me-push-on").click();
    await expect(a.page.getByTestId("me-push-status")).toHaveAttribute("data-state", "on");
    await shot(a.page, "me-on");

    // his invitation
    await a.page.goto("/p/family/invite");
    await a.page.getByTestId("invite-name").fill("Wei Ling");
    await a.page.getByTestId("invite-make").click();
    await expect(a.page.getByTestId("invite-qr")).toBeVisible();
    await shot(a.page, "invite-made");
    await a.context.close();

    // 「我」 after a refusal
    const b = await phone(browser, {
      init: (c) =>
        c.addInitScript(() => {
          Object.defineProperty(Notification, "permission", { get: () => "denied" });
          Notification.requestPermission = async () => "denied";
        }),
    });
    await b.page.goto("/p/me");
    await expect(b.page.getByTestId("me-push-retry")).toBeVisible();
    await shot(b.page, "me-denied");
    await b.context.close();

    // iPhone: setting up and the notifications page
    const i = await phone(browser, { userAgent: IPHONE_UA, space: "blank", onboarding: "started" });
    await i.page.goto("/onboard/reminders");
    await expect(i.page.getByTestId("onboard-ios-steps")).toBeVisible();
    await shot(i.page, "onboard-iphone");
    // C2 track L: his other pages open once setting up is finished (real-app 3.7: until then /p goes back to /onboard)
    expect((await i.context.request.post("/api/profile/onboard", { data: { step: "done" } })).ok()).toBe(true);
    await i.page.goto("/p/me/notifications");
    await expect(i.page.getByTestId("push-ios-steps")).toBeVisible();
    await shot(i.page, "notifications-iphone");
    await i.context.close();

    // her home with the offer
    const his = await phone(browser);
    const hers = await phone(browser, { space: "none", name: "Wei Ling", init: (c) => answerPermissionPrompt(c, "granted") });
    const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });
    await setSwitches(his.context, linkId, { dose_summary: true, no_reply_alert: true });
    await hers.page.goto(`/f?link=${encodeURIComponent(linkId)}`);
    await hers.page.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await hers.page.reload();
    await expect(hers.page.getByTestId("push-nudge-on")).toBeVisible();
    await shot(hers.page, "her-home-nudge");
    await his.context.close();
    await hers.context.close();

    // the manual
    const m = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto("/how");
    await mp.getByTestId("how-install").scrollIntoViewIfNeeded();
    mkdirSync(SHOTS!, { recursive: true });
    await mp.getByTestId("how-install").screenshot({ path: path.join(SHOTS!, "how-install.png") });
    await m.close();
  } finally {
    await service.close();
  }
});
