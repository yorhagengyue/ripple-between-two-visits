/**
 * Her own account's three small screens under 「我的」 (the fe-d track; components/family/HerSecurity.tsx): a new
 * password, the devices she signed in on, a new recovery code. Each is in her look and passes her page checks
 * (e2e/_checks/page-checks.ts: no sideways scroll at 360px, no text under 16px, no target under 44x44, AA contrast), in
 * 华语 and in English, and each does what his does: a password that is too common is stopped on the spot with the
 * reason, a wrong current password is said, another device's sign-in is ended from here, every sign-in at once, and
 * the new code is shown once while the code before it stops working.
 *
 * And they stay within reach once her link has ended (the fe-d2 follow-up): the screen that says so, whichever page
 * of hers was open, keeps 「我的」 at the top right, and 「我的」 then shows her own account's rows alone.
 *
 * With FE_D_SHOTS_DIR set, a picture of each screen is written there (G-password.png, G-password-done.png,
 * G-devices.png, G-recovery.png, G-recovery-code.png), 390x844 at 2x.
 *
 * Needs a server with the developer tools on (dev accounts).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { linkFamily, newAccount, TEST_PASSWORD } from "./journeys/_d/family";

const DIR = process.env.FE_D_SHOTS_DIR?.trim() || null;
const NEW_PASSWORD = "jasmine tea 2026";
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function phone(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: baseURL }]);
  return context;
}

/** Mr Tan's example account and Wei Ling's (no space of her own), linked and confirmed; her first-visit steps done. */
async function pair(browser: Browser, baseURL: string): Promise<{ him: BrowserContext; her: BrowserContext; dp: Page; linkId: string; herLogin: string; q: string }> {
  const him = await phone(browser, baseURL);
  const her = await phone(browser, baseURL);
  await newAccount(him, { space: "example", displayName: "陈先生", prefix: "ah" });
  const { login } = await newAccount(her, { space: "none", displayName: "Wei Ling", prefix: "aw" });
  const linkId = await linkFamily(him, her);
  const q = `link=${encodeURIComponent(linkId)}`;
  const dp = await her.newPage();
  await dp.goto(`/f?${q}`);
  await dp.evaluate((id) => {
    localStorage.setItem(`rp_f_welcomed_${id}`, "1");
    localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
  }, linkId);
  return { him, her, dp, linkId, herLogin: login, q };
}

async function shot(page: Page, name: string): Promise<void> {
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: true, animations: "disabled" });
}

/** The same screen in English passes her page checks too; then back to 华语. */
async function alsoInEnglish(her: BrowserContext, page: Page, baseURL: string, testId: string, headline: string): Promise<void> {
  await her.addCookies([{ name: "rp_lang", value: "en", url: baseURL }]);
  await page.reload();
  await expect(page.getByTestId(testId)).toBeVisible();
  await expect(page.getByTestId("family-headline")).toHaveText(headline);
  await expectPageChecks(page, { side: "family" });
  await her.addCookies([{ name: "rp_lang", value: "zh-Hans", url: baseURL }]);
  await page.reload();
  await expect(page.getByTestId(testId)).toBeVisible();
}

test("「我的 → 改密码」: a common password is stopped with the reason, a wrong current one is said, then the new one works and the old one does not", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { him, her, dp, herLogin, q } = await pair(browser, baseURL!);
  try {
    await dp.goto(`/f/me?${q}`);
    await dp.getByTestId("me-password").click();
    await expect(dp.getByTestId("her-password")).toHaveAttribute("data-state", "form");
    await expect(dp.getByTestId("family-headline")).toHaveText("改密码");
    await expectPageChecks(dp, { side: "family" });
    await shot(dp, "G-password");

    // what never reaches the server: no current password; a new one that is too short; one that is too common
    let asked = 0;
    dp.on("request", (r) => {
      if (r.url().includes("/api/auth/password")) asked += 1;
    });
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password-error")).toHaveText("密码不对。");
    await dp.getByTestId("her-password-current").fill(TEST_PASSWORD);
    await dp.getByTestId("her-password-new").fill("short");
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password-error")).toHaveText("至少要 8 个字。");
    await dp.getByTestId("her-password-new").fill("12345678");
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password-error")).toHaveText("这个密码太常见，容易被猜到，换一个。");
    expect(asked).toBe(0);
    await expectPageChecks(dp, { side: "family" });
    // 「显示密码」 shows what she typed, 「隐藏密码」 hides it again
    await dp.getByTestId("her-password-new-show").click();
    await expect(dp.getByTestId("her-password-new")).toHaveAttribute("type", "text");
    await expect(dp.getByTestId("her-password-new-show")).toHaveText("隐藏密码");
    await dp.getByTestId("her-password-new-show").click();
    await expect(dp.getByTestId("her-password-new")).toHaveAttribute("type", "password");

    // a wrong current password: the server says so, and the field is emptied
    await dp.getByTestId("her-password-current").fill("not her password 1");
    await dp.getByTestId("her-password-new").fill(NEW_PASSWORD);
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password-error")).toHaveText("密码不对。");
    await expect(dp.getByTestId("her-password-current")).toHaveValue("");
    expect(asked).toBe(1);

    // the right one: done, and this phone stays signed in
    await dp.getByTestId("her-password-current").fill(TEST_PASSWORD);
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password")).toHaveAttribute("data-state", "done");
    await expect(dp.getByTestId("family-headline")).toHaveText("密码改好了");
    await expectPageChecks(dp, { side: "family" });
    await shot(dp, "G-password-done");
    await dp.getByTestId("her-password-done-ok").click();
    await expect(dp.getByTestId("family-me")).toBeVisible();

    // the new password signs her in elsewhere; the old one does not any more
    const other = await browser.newContext();
    expect((await other.request.post("/api/auth/login", { data: { login: herLogin, password: TEST_PASSWORD, not_my_phone: false } })).status()).toBe(401);
    expect((await other.request.post("/api/auth/login", { data: { login: herLogin, password: NEW_PASSWORD, not_my_phone: false } })).status()).toBe(200);
    await other.close();

    await dp.goto(`/f/me/password?${q}`);
    await alsoInEnglish(her, dp, baseURL!, "her-password", "Change password");
  } finally {
    await him.close();
    await her.close();
  }
});

test("「我的 → 登录和设备」: this phone first, another device signed out from here, then every device at once", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { him, her, dp, herLogin, q } = await pair(browser, baseURL!);
  const tablet = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36" });
  try {
    // the developer route that made her account signs this phone in without the device record a real sign-in leaves:
    // she signs in on it through the real route (as her sign-up or her login does), then on a second device
    expect((await her.request.post("/api/auth/login", { data: { login: herLogin, password: TEST_PASSWORD, not_my_phone: false } })).status()).toBe(200);
    expect((await tablet.request.post("/api/auth/login", { data: { login: herLogin, password: TEST_PASSWORD, not_my_phone: false } })).status()).toBe(200);

    await dp.goto(`/f/me?${q}`);
    await dp.getByTestId("me-devices").click();
    await expect(dp.getByTestId("her-devices")).toBeVisible();
    await expect(dp.getByTestId("family-headline")).toHaveText("登录和设备");
    const rows = dp.getByTestId("her-device-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-current", "true");
    await expect(rows.nth(0)).toContainText("这台设备 · 正在用");
    await expect(rows.nth(0).getByTestId("her-device-sign-out")).toHaveCount(0);
    await expect(rows.nth(1)).toContainText("Android · Chrome");
    await expect(rows.nth(1)).toHaveAttribute("data-signed-in", "true");
    await expectPageChecks(dp, { side: "family" });
    await shot(dp, "G-devices");
    await alsoInEnglish(her, dp, baseURL!, "her-devices", "Sign-in and devices");

    // 「退出这台」: the other device's sign-in ends; this one stays
    await rows.nth(1).getByTestId("her-device-sign-out").click();
    await expect(rows.nth(1)).toHaveAttribute("data-signed-in", "false");
    await expect(rows.nth(1).getByTestId("her-device-sign-out")).toHaveCount(0);
    // (the account's own route answers the signed-in person, with or without a space of their own)
    expect((await tablet.request.get("/api/auth/devices")).status()).toBe(401);
    expect((await her.request.get("/api/auth/devices")).status()).toBe(200);
    await expectPageChecks(dp, { side: "family" });

    // 「退出所有设备」: this phone too
    await dp.getByTestId("her-logout-everywhere").click();
    await dp.waitForURL((u) => !u.pathname.startsWith("/f"));
    expect((await her.request.get("/api/auth/devices")).status()).toBe(401);
  } finally {
    await him.close();
    await her.close();
    await tablet.close();
  }
});

test("「我的 → 换一个恢复码」: after her password a new code, shown once; the code before it stops working", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { him, her, dp, herLogin, q } = await pair(browser, baseURL!);
  try {
    await dp.goto(`/f/me?${q}`);
    await dp.getByTestId("me-recovery").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "form");
    await expect(dp.getByTestId("family-headline")).toHaveText("换一个恢复码");
    await expect(dp.getByTestId("family-lede")).toHaveText("旧的恢复码会作废。先输入你的密码。");
    await expectPageChecks(dp, { side: "family" });
    await shot(dp, "G-recovery");
    await alsoInEnglish(her, dp, baseURL!, "her-recovery", "Make a new recovery code");

    // no password, then a wrong one: said, nothing made
    await dp.getByTestId("her-recovery-new").click();
    await expect(dp.getByTestId("her-recovery-error")).toHaveText("密码不对。");
    await dp.getByTestId("her-recovery-password").fill("not her password 1");
    await dp.getByTestId("her-recovery-new").click();
    await expect(dp.getByTestId("her-recovery-error")).toHaveText("密码不对。");
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "form");

    // her password: the new code, on the screen this once
    await dp.getByTestId("her-recovery-password").fill(TEST_PASSWORD);
    await dp.getByTestId("her-recovery-new").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "code");
    await expect(dp.getByTestId("family-headline")).toHaveText("这是你的恢复码");
    const first = (await dp.getByTestId("her-recovery-code").innerText()).trim();
    expect(first).toMatch(CODE);
    await expect(dp.locator("body")).toContainText("换了新手机又忘了密码，只能靠这个码。");
    await expectPageChecks(dp, { side: "family" });
    await shot(dp, "G-recovery-code");
    await dp.getByTestId("her-recovery-kept").click();
    await expect(dp.getByTestId("family-me")).toBeVisible();
    // gone from the screen: opening the page again shows the form, not the code
    await dp.getByTestId("me-recovery").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "form");
    await expect(dp.getByTestId("her-recovery-code")).toHaveCount(0);

    // one more code: a different one, and the first no longer resets her password
    await dp.getByTestId("her-recovery-password").fill(TEST_PASSWORD);
    await dp.getByTestId("her-recovery-new").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "code");
    const second = (await dp.getByTestId("her-recovery-code").innerText()).trim();
    expect(second).toMatch(CODE);
    expect(second).not.toBe(first);
    const other = await browser.newContext();
    expect((await other.request.post("/api/auth/recover", { data: { login: herLogin, code: first, password: "another new one 9" } })).status()).toBe(401);
    await other.close();
  } finally {
    await him.close();
    await her.close();
  }
});

test("after he stopped sharing her own account stays within reach: 「我的」 on the screen that says so, and the three screens under it", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { him, her, dp, linkId, herLogin, q } = await pair(browser, baseURL!);
  try {
    // two other pages of hers are open when he stops (what he shares, and the no-reply screen, which follows him by
    // itself): each says so at once, and keeps 「我的」 (the v3 draft's H1)
    await dp.goto(`/f/shared?${q}`);
    await expect(dp.getByTestId("her-live")).toHaveAttribute("data-live", "open");
    const ap = await her.newPage();
    await ap.goto(`/f/alert?${q}`);
    await expect(ap.getByTestId("family-alert")).toHaveAttribute("data-live", "open");
    const stopped = await him.request.post(`/api/family/links/${linkId}/revoke`, { data: {} });
    expect(stopped.ok(), await stopped.text()).toBe(true);
    await expect(ap.getByTestId("family-alert")).toHaveAttribute("data-state", "ended", { timeout: 5000 });
    await expect(ap.getByTestId("open-me")).toHaveAttribute("href", `/f/me?${q}`);
    await expectPageChecks(ap, { side: "family" });
    await ap.close();
    await expect(dp.getByTestId("her-live")).toHaveAttribute("data-state", "ended", { timeout: 5000 });
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸停止了分享。");
    await expectPageChecks(dp, { side: "family" });
    await dp.getByTestId("open-me").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
    await expect(dp.getByTestId("me-name")).toContainText("Wei Ling");
    await expect(dp.getByTestId("me-sign-in")).toContainText(herLogin);
    await expect(dp.getByTestId("me-leave-open")).toHaveCount(0);
    await expectPageChecks(dp, { side: "family" });

    // a new password, with no link in force
    await dp.getByTestId("me-password").click();
    await expect(dp.getByTestId("her-password")).toHaveAttribute("data-state", "form");
    await expectPageChecks(dp, { side: "family" });
    await dp.getByTestId("her-password-current").fill(TEST_PASSWORD);
    await dp.getByTestId("her-password-new").fill(NEW_PASSWORD);
    await dp.getByTestId("her-password-save").click();
    await expect(dp.getByTestId("her-password")).toHaveAttribute("data-state", "done");
    await dp.getByTestId("her-password-done-ok").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
    const other = await browser.newContext();
    expect((await other.request.post("/api/auth/login", { data: { login: herLogin, password: NEW_PASSWORD, not_my_phone: false } })).status()).toBe(200);
    await other.close();

    // her devices; the way back is 「我的」
    await dp.getByTestId("me-devices").click();
    await expect(dp.getByTestId("her-devices")).toBeVisible();
    await expect(dp.getByTestId("family-headline")).toHaveText("登录和设备");
    await expectPageChecks(dp, { side: "family" });
    await dp.getByTestId("family-back").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");

    // a new recovery code
    await dp.getByTestId("me-recovery").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "form");
    await expectPageChecks(dp, { side: "family" });
    await dp.getByTestId("her-recovery-password").fill(NEW_PASSWORD);
    await dp.getByTestId("her-recovery-new").click();
    await expect(dp.getByTestId("her-recovery")).toHaveAttribute("data-state", "code");
    expect((await dp.getByTestId("her-recovery-code").innerText()).trim()).toMatch(CODE);
    await dp.getByTestId("her-recovery-kept").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");

    // deleting her account opens from here, and 「不删了」 comes back here
    await dp.getByTestId("me-delete").click();
    await expect(dp.getByTestId("her-delete-what")).toBeVisible();
    await dp.getByTestId("her-delete-keep").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");

    // what needs him stays closed: its address leads back to the sentence, and nothing of his is read
    await dp.goto(`/f/me/notifications?${q}`);
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "ended");
    expect((await her.request.get(`/api/family/view?${q}`)).status()).toBe(403);
  } finally {
    await him.close();
    await her.close();
  }
});

test("she left, or he said it was not her: the screen that says so keeps 「我的」 too", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { him, her, dp, q } = await pair(browser, baseURL!);
  const him2 = await phone(browser, baseURL!);
  const her2 = await phone(browser, baseURL!);
  try {
    // H2: she leaves from 「我的」
    await dp.goto(`/f/me/leave?${q}`);
    await dp.getByTestId("me-leave").click();
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "left", { timeout: 10_000 });
    await expectPageChecks(dp, { side: "family" });
    await dp.getByTestId("open-me").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "left");
    await expect(dp.getByTestId("family-headline")).toHaveText("你已经不再看爸爸的 Ripple。");
    for (const row of ["me-password", "me-devices", "me-recovery", "me-logout", "me-delete"]) await expect(dp.getByTestId(row), row).toBeVisible();
    for (const row of ["me-notifications-open", "me-phone", "open-facts", "me-install", "me-leave-open"]) await expect(dp.getByTestId(row), row).toHaveCount(0);
    await expectPageChecks(dp, { side: "family" });
    await alsoInEnglish(her, dp, baseURL!, "family-me", "You no longer follow 爸爸's Ripple.");
    await dp.getByTestId("family-back").click();
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "left");

    // he says the person who accepted is not her
    await newAccount(him2, { space: "blank", displayName: "陈先生", prefix: "ah" });
    await newAccount(her2, { space: "none", displayName: "Wei Ling", prefix: "aw" });
    const made = await him2.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
    expect(made.status(), await made.text()).toBe(201);
    const invite = (await made.json()) as { path: string; link: { id: string } };
    expect((await her2.request.post("/api/family/invites/accept", { data: { token: invite.path.replace(/^\/invite\//, "") } })).ok()).toBe(true);
    expect((await him2.request.post(`/api/family/links/${invite.link.id}/confirm`, { data: { yes: false } })).ok()).toBe(true);
    const dp2 = await her2.newPage();
    await dp2.goto("/f");
    await expect(dp2.getByTestId("family-app")).toHaveAttribute("data-state", "declined");
    await expectPageChecks(dp2, { side: "family" });
    await dp2.getByTestId("open-me").click();
    await expect(dp2.getByTestId("family-me")).toHaveAttribute("data-state", "declined");
    await expect(dp2.getByTestId("family-headline")).toHaveText("爸爸没有确认是你。");
    await expect(dp2.getByTestId("me-password")).toBeVisible();
    await expectPageChecks(dp2, { side: "family" });
  } finally {
    await him.close();
    await her.close();
    await him2.close();
    await her2.close();
  }
});
