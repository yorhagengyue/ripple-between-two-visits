/**
 * Screenshots of track C's round-2 screens, for a person to look at (the automatic checks only measure sizes and
 * contrast). Skipped unless C_SHOTS_DIR names a folder outside web/:
 *   C_SHOTS_DIR=D:/ripple-c2/shots/c PW_PORT=3530 npx playwright test e2e/c-shots.spec.ts --output D:/ripple-c2/pw/c
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const DIR = process.env.C_SHOTS_DIR?.trim();
test.skip(!DIR, "set C_SHOTS_DIR to write screenshots");
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";

async function account(page: Page, space: "example" | "blank", extra: Record<string, unknown> = {}) {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `s${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
}

async function shot(page: Page, url: string, name: string, fullPage = true) {
  await page.goto(url);
  // the screen itself: the first and last screens of setting up have no header line since the timeline layout
  await expect(page.locator('[data-rp="screen"]').first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR!, `${name}.png`), fullPage });
}

for (const locale of ["zh-Hans", "en"] as const) {
  test(`shots (${locale})`, async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    await account(page, "example", { display_name: "陈先生" });
    const s = (url: string, name: string, full = true) => shot(page, url, `${locale}-${name}`, full);
    await s("/p/me", "me");
    await s("/p/profile/name", "name");
    await s("/p/profile/language", "language");
    await s("/p/profile/times", "times");
    await s("/p/profile/times/midday", "times-midday");
    await s("/p/profile", "profile");
    await s("/p/today", "today-example", false);
    await s("/p/bp", "bp-example", false);
    await s("/p/visit", "visit-example", false);
    await s("/p/meds", "meds-example", false);
    await s("/p/meds/add", "meds-add-example", false);
    await s("/p/questions", "questions-example", false);
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    await account(page, "blank", { onboarding: "started", assisted: true });
    await s("/onboard/who", "who-assisted");
    await page.request.post("/api/profile/onboard", { data: { step: "done" } });
    await s("/p/today", "today-blank", false);
    await s("/p/questions", "questions-empty");
    await s("/p/profile", "profile-empty");
    await page.request.patch("/api/profile", { data: { clinic: "Blossom Family Clinic", breakfast: "07:30", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }], reminder_times: { midday: "12:00" } } });
    await s("/p/profile", "profile-own");
    await s("/p/profile/times", "times-own");
  });
}
