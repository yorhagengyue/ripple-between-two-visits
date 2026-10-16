/**
 * Screenshots for the owner of the setting-up screens and 「我的档案」 rebuilt after the timeline draft's 01-5a to 01-5f
 * and 01-6 (web/progress/fe-01.md): one PNG per screen state at 390x844 @2x in 华语, named by the draft's screen id, in
 * FE_SHOTS_DIR/01/. Not a test of looks, and never part of a default run: without FE_SHOTS_DIR every test here is
 * skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3900 npx playwright test e2e/fe-shots-01.spec.ts
 *
 * Each test makes its own blank account through the developer helper and walks the screens the way a person would;
 * what the draft shows as sample content is typed in here (Blossom Family Clinic, breakfast 8:30, a walk every day at
 * 6:30, tai chi on Tuesday and Thursday at 7:30), so the pictures can be laid next to the draft. A screen longer than
 * the phone is also saved whole as <id>-full.png.
 *
 * The draft's six screens are eleven here (one question a screen): 01-5b is the breakfast question (01-5b-1) and then
 * the routine list (01-5b); 01-5d is three questions (01-5d-1 age, -2 conditions, -3 allergies). 「谁在填」 before the
 * six and 「建好了」 after them are 01-5-who and 01-5-done.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const GROUP = "01";

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function phone(browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", ...extra });
}

async function account(context: BrowserContext, space: "example" | "blank", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `o${randomUUID().slice(0, 12)}`, password: "a long test password", space, display_name: "陈先生", ...extra } });
  expect(res.status(), await res.text()).toBe(201);
}

async function answer(context: BrowserContext, data: Record<string, unknown>): Promise<void> {
  const res = await context.request.post("/api/profile/onboard", { data });
  expect(res.status(), await res.text()).toBe(200);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, GROUP);
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the dock
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page with the dock where the page ends (on the phone-sized picture it stays at the foot of the screen)
    const flat = await page.addStyleTag({ content: ".rpo-dock { position: static !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await flat.evaluate((el) => (el as Element).remove());
  }
}

async function open(page: Page, url: string, ready: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator(ready).first()).toBeVisible();
}

test("01-5a to 01-5f 建档六项（他自己填）", async ({ browser }) => {
  const context = await phone(browser);
  await account(context, "blank", { onboarding: "started" });
  const page = await context.newPage();

  // before the six items: who is filling it in (not in the draft; sign-up's 01-2d asks the same)
  await open(page, "/onboard/who", '[data-testid="onboard-who-self"]');
  await shot(page, "01-5-who");
  await answer(context, { step: "who", by: "self" });

  // 01-5a: his clinic; and a save that did not go through
  await open(page, "/onboard/clinic", '[data-testid="onboard-clinic"]');
  await shot(page, "01-5a-empty");
  await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
  await shot(page, "01-5a");
  await page.route("**/api/profile/onboard", (route) => route.abort());
  await page.getByTestId("onboard-next").click();
  await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
  await shot(page, "01-5a-failed");
  await page.unroute("**/api/profile/onboard");
  await answer(context, { step: "clinic", clinic: "Blossom Family Clinic" });

  // 01-5b, first question: breakfast
  await open(page, "/onboard/breakfast", '[data-testid="onboard-breakfast-08:30"]');
  await shot(page, "01-5b-1-breakfast-empty");
  await page.getByTestId("onboard-breakfast-08:30").click();
  await expect(page.getByTestId("onboard-reminder-at")).toBeVisible();
  await shot(page, "01-5b-1-breakfast");
  await page.getByTestId("onboard-breakfast-other").click();
  await shot(page, "01-5b-1-breakfast-other");
  await answer(context, { step: "breakfast", time: "08:30" });

  // 01-5b: the routine as a list. Nothing weekly yet, so the question about the week is open under it
  await open(page, "/onboard/habits", '[data-testid="onboard-habit-add"]');
  await shot(page, "01-5b-first");
  await page.getByTestId("onboard-habit-tai-chi").click();
  await page.getByTestId("onboard-day-Tue").click();
  await page.getByTestId("onboard-day-Thu").click();
  await page.getByTestId("onboard-habit-time-07:30").click();
  await shot(page, "01-5b-adding");
  await page.getByTestId("onboard-habit-add").click();
  await expect(page.locator('[data-rp="habit"][data-habit="Tai chi"]')).toBeVisible();
  // a walk every day, as the draft has it: 「＋ 加一项」, all seven days
  await page.getByTestId("onboard-habit-new").click();
  await page.getByTestId("onboard-habit-morning-walk").click();
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await page.getByTestId(`onboard-day-${d}`).click();
  await page.getByTestId("onboard-habit-time-06:30").click();
  await page.getByTestId("onboard-habit-add").click();
  await expect(page.locator('[data-rp="habit"]')).toHaveCount(2);
  await shot(page, "01-5b");
  // 「改」 on an entry, and 「改」 on breakfast
  await page.locator('[data-rp="habit"][data-habit="Tai chi"]').click();
  await expect(page.locator('[data-action="habit-remove"]')).toBeVisible();
  await shot(page, "01-5b-change-entry");
  await page.getByTestId("onboard-habit-cancel").click();
  await page.getByTestId("onboard-breakfast-change").click();
  await expect(page.getByTestId("onboard-breakfast-save")).toBeVisible();
  await shot(page, "01-5b-change-breakfast");
  await answer(context, {
    step: "habits",
    habits: [
      { label: "Morning walk", label_zh: "散步", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], time: "06:30" },
      { label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" },
    ],
  });

  // 01-5c: the medicines he takes
  await open(page, "/onboard/meds", '[data-testid="onboard-meds-photo"]');
  await shot(page, "01-5c");
  await answer(context, { step: "meds", choice: "later" });

  // 01-5d: about him, one question a screen
  await open(page, "/onboard/age", '[data-testid="onboard-age"]');
  await page.getByTestId("onboard-age").fill("67");
  await shot(page, "01-5d-1-age");
  await page.getByTestId("onboard-age").fill("130");
  await shot(page, "01-5d-1-age-error");
  await answer(context, { step: "age", age: 67 });
  await open(page, "/onboard/conditions", '[data-testid="onboard-conditions-own"]');
  await page.getByTestId("onboard-conditions-high-blood-pressure").click();
  await shot(page, "01-5d-2-conditions");
  await answer(context, { step: "conditions", items: ["高血压"] });
  await open(page, "/onboard/allergies", '[data-testid="onboard-allergies-none"]');
  await shot(page, "01-5d-3-allergies");
  await answer(context, { step: "allergies", items: null });

  // 01-5e: family
  await open(page, "/onboard/family", '[data-testid="onboard-family-invite"]');
  await shot(page, "01-5e");
  await answer(context, { step: "family", choice: "later" });

  // 01-5f: when the reminders come (what the back end computes from his breakfast), 「改时间」, and 「开提醒」
  await open(page, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
  await shot(page, "01-5f");
  await page.getByTestId("onboard-remind-change").click();
  await expect(page.getByTestId("onboard-remind-save")).toBeVisible();
  await shot(page, "01-5f-change-time");
  // a time outside the morning is refused in words, in the dock
  await page.getByTestId("onboard-remind-time-other").click();
  await page.getByTestId("onboard-remind-time-input").fill("12:30");
  await page.getByTestId("onboard-remind-save").click();
  await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
  await shot(page, "01-5f-change-time-refused");
  await open(page, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
  await page.getByTestId("onboard-reminders-on").click();
  await expect(page.locator('[data-rp="reminders-result"]')).toBeVisible();
  await shot(page, "01-5f-result");
  await answer(context, { step: "reminders", result: "later" });

  // after the six items
  await open(page, "/onboard/done", '[data-testid="onboard-done"]');
  await shot(page, "01-5-done");
  await answer(context, { step: "done" });

  // 「我 › 我的档案」 with what he wrote himself, and screens opened from it to change something
  await open(page, "/p/profile", '[data-rp="fact-value"]');
  await shot(page, "profile-own");
  await open(page, "/onboard/clinic?return=/p/profile", '[data-testid="onboard-clinic"]');
  await shot(page, "01-5a-change");
  await open(page, "/onboard/habits?return=/p/profile", '[data-rp="habit"]');
  await shot(page, "01-5b-change");
  await open(page, "/onboard/conditions?return=/p/profile", '[data-testid="onboard-conditions-own"]');
  await shot(page, "01-5d-2-conditions-change");
  await context.close();
});

test("01-6 家人帮忙填的项，等他认", async ({ browser }) => {
  const context = await phone(browser);
  // sign-up said 「家人帮我操作」: what is entered this round is a family member's and waits for him
  await account(context, "blank", { onboarding: "started", assisted: true });
  const page = await context.newPage();
  await open(page, "/onboard/who", '[data-testid="onboard-who-family"]');
  await shot(page, "01-5-who-helped");
  await answer(context, { step: "who", by: null });
  await open(page, "/onboard/clinic", '[data-testid="onboard-clinic"]');
  await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
  await shot(page, "01-5a-helped");
  await answer(context, { step: "clinic", clinic: "Blossom Family Clinic" });
  await open(page, "/onboard/breakfast", '[data-testid="onboard-breakfast-08:30"]');
  await page.getByTestId("onboard-breakfast-08:30").click();
  await shot(page, "01-5b-1-breakfast-helped");
  await answer(context, { step: "breakfast", time: "08:30" });
  await answer(context, { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" }] });
  await open(page, "/onboard/habits", '[data-testid="onboard-next"]');
  await shot(page, "01-5b-helped");
  await answer(context, { step: "meds", choice: "later" });
  await answer(context, { step: "age", age: 67 });
  await open(page, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
  await shot(page, "01-5f-helped");
  await open(page, "/onboard/done", '[data-testid="onboard-done"]');
  await shot(page, "01-5-done-helped");
  await answer(context, { step: "done" });

  // he looks at them himself, one at a time
  await open(page, "/p/profile", '[data-rp="confirm-fact"]');
  await shot(page, "01-6");
  await page.getByTestId("confirm-fact-yes").click();
  await expect(page.locator('[data-rp="confirm-fact"]')).not.toContainText("Blossom Family Clinic");
  await shot(page, "01-6-second");
  await page.getByTestId("confirm-fact-change").click();
  await expect(page.getByTestId("confirm-fact-words")).toBeVisible();
  await shot(page, "01-6-change");
  await page.getByTestId("confirm-fact-keep").click();
  // 对 for the rest: his profile then says who wrote each line
  for (let i = 0; i < 3; i++) {
    const fact = await page.locator('[data-rp="confirm-fact"]').getAttribute("data-fact");
    await page.getByTestId("confirm-fact-yes").click();
    await expect(page.locator(`[data-rp="confirm-fact"][data-fact="${fact}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-rp="page-title"]')).toBeVisible();
  await shot(page, "profile-after-01-6");
  await context.close();
});

test("我的档案：示例账号", async ({ browser }) => {
  const context = await phone(browser);
  await account(context, "example");
  const page = await context.newPage();
  await open(page, "/p/profile", '[data-rp="fact-value"]');
  await shot(page, "profile-example");
  await context.close();
});

test("01-5 English，和小屏幕", async ({ browser, baseURL }) => {
  const context = await phone(browser, { locale: "en-SG" });
  await context.addCookies([{ name: "rp_lang", value: "en", url: baseURL! }]);
  await account(context, "blank", { onboarding: "started" });
  const page = await context.newPage();
  await answer(context, { step: "who", by: "self" });
  await answer(context, { step: "clinic", clinic: "Blossom Family Clinic" });
  await answer(context, { step: "breakfast", time: "08:30" });
  await answer(context, { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" }] });
  await open(page, "/onboard/habits", '[data-rp="habit"]');
  await shot(page, "01-5b-en");
  await open(page, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
  await shot(page, "01-5f-en");
  await context.close();

  // a short, narrow phone: the dock stays at the foot and the page scrolls under it
  const small = await phone(browser, { viewport: { width: 360, height: 640 } });
  await account(small, "blank", { onboarding: "started" });
  const sp = await small.newPage();
  await answer(small, { step: "who", by: "self" });
  await answer(small, { step: "clinic", clinic: null });
  await answer(small, { step: "breakfast", time: "08:30" });
  await open(sp, "/onboard/habits", '[data-testid="onboard-habit-add"]');
  await shot(sp, "small-01-5b");
  await open(sp, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
  await shot(sp, "small-01-5f");
  await small.close();

  // an iPhone that did not open Ripple from the Home Screen: the three pictured steps (the push line's piece) under the line
  const iphone = await phone(browser, {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  await account(iphone, "blank", { onboarding: "started" });
  const ip = await iphone.newPage();
  await answer(iphone, { step: "who", by: "self" });
  await answer(iphone, { step: "breakfast", time: "08:30" });
  await open(ip, "/onboard/reminders", '[data-testid="onboard-ios-steps"]');
  await shot(ip, "01-5f-iphone");
  await iphone.close();
});
