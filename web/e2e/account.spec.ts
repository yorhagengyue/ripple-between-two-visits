/**
 * Accounts and sign-in on the real pages (track A; docs/plan/real-app.md 2.1-2.4, 2.23, 8.2 「e2e real/signup.spec」):
 *   - sign-up through every step (username, a family member helping, AI refused, Mr Tan's example), the recovery code
 *     and its card, landing on today; the consent records say assisted and carry their versions;
 *   - a blank sign-up lands on the onboarding;
 *   - signed out, /p/today sends the browser to /login and back there after logging in;
 *   - one generic refusal; the sixth wrong password locks this phone with the time it opens; the recovery code resets the
 *     password, the old code stops working and every other sign-in ends;
 *   - his devices: another device signed out from this one; a new password; a new recovery code;
 *   - every account page passes the page checks (360 px, 18 px text, 48 px targets, contrast) in both languages.
 * Runs on any build with the developer tools on (the IP limits are loose there); in-memory store and identity.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { BASE_URL, logIn, signUp } from "./helpers";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";
const login = () => `e2e.${randomUUID().slice(0, 8)}`;

async function phone(browser: import("@playwright/test").Browser, opts: { locale?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, locale: opts.locale ?? "zh-CN", timezoneId: "Asia/Singapore" });
  return { context, page: await context.newPage() };
}

async function next(page: Page) {
  await page.getByTestId("signup-next").click();
}

test.describe("sign-up", () => {
  test("every step, a family member helping, AI refused, the example: the code once, its card, then today", async ({ browser }) => {
    const { context, page } = await phone(browser);
    const name = login();
    await page.goto("/signup?lang=zh-Hans");
    await expect(page.getByTestId("signup-step-name")).toBeVisible();
    await expectPageChecks(page, { side: "elder" });

    await expect(page.getByTestId("signup-step-name")).toBeVisible();
    await next(page); // empty: told what to write
    await expect(page.getByTestId("signup-name-error")).toBeVisible();
    await page.getByTestId("signup-name").fill("陈先生");
    // a family member is helping him: the toggle that replaced the old 「谁在操作」 screen
    await page.getByTestId("signup-assisted").click();
    await expect(page.getByTestId("assisted-note")).toContainText("陈先生本人");
    await expectPageChecks(page, { side: "elder" });
    await next(page);

    await expect(page.getByTestId("signup-step-account")).toBeVisible();
    await page.getByTestId("signup-login").fill("ab");
    await next(page);
    await expect(page.getByTestId("signup-login-error")).toContainText("3 到 32");
    await page.getByTestId("signup-login").fill(name);
    await expectPageChecks(page, { side: "elder" });
    await next(page);

    await expect(page.getByTestId("signup-step-password")).toBeVisible();
    await page.getByTestId("signup-password").fill("12345678");
    await next(page);
    await expect(page.getByTestId("signup-password-error")).toContainText("太常见");
    await page.getByTestId("signup-password").fill(PASSWORD);
    await page.getByTestId("signup-password-show").click();
    await expect(page.getByTestId("signup-password")).toHaveAttribute("type", "text");
    // real-app 2.4: the sign-up says what a forgotten password means, before he chooses one
    await expect(page.getByTestId("signup-step-password")).toContainText("忘了密码？用最后一步给你的恢复码重设。");
    // the 「显示密码」 button fades between two tints: let the colour settle before the contrast check
    await page.waitForTimeout(500);
    await expectPageChecks(page, { side: "elder" });
    await next(page);

    // the old 「谁在操作」 screen is the toggle on the name step now (already on): the two texts still ask his own tap
    await expect(page.getByTestId("signup-step-terms")).toBeVisible();
    await expect(page.getByTestId("signup-terms-text")).toContainText("东京");
    await expect(page.getByTestId("assisted-note")).toBeVisible();
    // the mock voice is no use to him: no 「读给我听」 on an account screen while TTS_PROVIDER is the mock (real-app 2.17)
    await expect(page.getByTestId("read-aloud")).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-agree").click();

    await expect(page.getByTestId("signup-step-ai")).toBeVisible();
    await expect(page.getByTestId("signup-ai-text")).toContainText(/腾讯云的混元模型|Tencent Cloud's Hunyuan model/);
    await expect(page.getByTestId("read-aloud")).toHaveCount(0);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-ai-decline").click();

    await expect(page.getByTestId("signup-step-space")).toBeVisible();
    await page.locator('[data-choice="example"]').click();
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-next").click();

    await expect(page.getByTestId("signup-step-code")).toBeVisible();
    const code = (await page.getByTestId("recovery-code").innerText()).trim();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    // real-app 2.4: the recovery-code screen says both limits; and no read-aloud button with the mock voice
    await expect(page.getByTestId("signup-step-code")).toContainText("换了新手机又忘了密码，只能靠这个码");
    await expect(page.getByTestId("signup-step-code")).toContainText("只能注册一个新账号");
    await expect(page.getByTestId("read-aloud")).toHaveCount(0);
    const refused = await context.request.post("/api/auth/read-aloud", { data: { screen: "recovery_code", locale: "zh-Hans" } });
    expect([refused.status(), await refused.json()]).toEqual([404, { error: "tts_unavailable" }]);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-print-card").click();
    await expect(page.getByTestId("recovery-card")).toContainText(code);
    await expect(page.getByTestId("recovery-card")).toContainText(name);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("card-back").click();
    await page.getByTestId("signup-kept").click();
    await expect(page).toHaveURL(/\/p\/today$/);

    // what was recorded: his account, the example, three consents, all assisted, with their versions
    const me = await (await context.request.get("/api/me")).json();
    expect(me.account).toMatchObject({ login: name, display_name: "陈先生", locale: "zh-Hans" });
    expect(me.scope).toMatchObject({ example_data: true, onboarding: "done" });
    expect(me.consents.map((x: { kind: string; decision: string; assisted: boolean }) => [x.kind, x.decision, x.assisted])).toEqual([
      ["terms_privacy", "granted", true],
      ["ai_processing", "declined", true],
      ["example_data", "granted", true],
    ]);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "rp_at")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(cookies.find((c) => c.name === "rp_device")).toBeTruthy();
    await context.close();
  });

  test("a blank space lands on the onboarding; English all the way", async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: "en-SG" });
    await page.goto("/signup");
    await expect(page.getByTestId("signup-step-name")).toContainText("What should we call you?");
    await page.getByTestId("signup-name").fill("Mr Tan");
    await next(page);
    await page.getByTestId("signup-login").fill(`${login()}@example.test`);
    await next(page);
    await page.getByTestId("signup-password").fill(PASSWORD);
    await next(page);
    await expect(page.getByTestId("signup-terms-text")).toContainText("Tokyo");
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-agree").click();
    await page.getByTestId("signup-ai-agree").click();
    await page.locator('[data-choice="blank"]').click();
    await next(page);
    await expect(page.getByTestId("signup-step-code")).toContainText("Your recovery code");
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("signup-kept").click();
    // track C's setting up starts at its first step (/onboard/who)
    await expect(page).toHaveURL(/\/onboard(\/who)?$/);
    await context.close();
  });
});

test.describe("log in and out", () => {
  test("signed out, /p/today goes to the login and comes back; a wrong password says nothing more", async ({ browser, request }) => {
    const name = login();
    await signUp(request, { login: name, password: PASSWORD, space: "example" });
    const { context, page } = await phone(browser);
    await page.goto("/p/today");
    await expect(page).toHaveURL(/\/login\?next=%2Fp%2Ftoday$/);
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    // the sign-up no longer carries a language step: the cookie is what 「我 › 语言」 and the front door's switch write
    await page.context().addCookies([{ name: "rp_lang", value: "zh-Hans", url: new URL(page.url()).origin }]);
    await page.reload();
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-step-password")).toBeVisible();
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("login-password").fill("not my password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText("账号或密码不对。");
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/p\/today$/);

    // log out from his devices page: /p/today sends him to the login again
    await page.goto("/p/me/devices");
    await expect(page.getByTestId("page-me-devices")).toBeVisible();
    // the list and its buttons settle a tick after the page: axe must not read a disabled button mid-swap
    await page.waitForTimeout(600);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/p/today");
    await expect(page).toHaveURL(/\/login\?next=/);
    await context.close();
  });

  test("「这不是我的手机」: the sign-in cookies end with the browser", async ({ browser, request }) => {
    const name = login();
    await signUp(request, { login: name, password: PASSWORD, space: "example" });
    const { context, page } = await phone(browser);
    await page.goto("/login");
    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    await page.getByRole("switch").click();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/p\/today$/);
    const cookies = await context.cookies();
    for (const n of ["rp_at", "rp_rt", "rp_since"]) expect(cookies.find((c) => c.name === n)?.expires, n).toBe(-1);
    await context.close();
  });

  test("the sixth wrong password locks this phone; the recovery code resets it; the old code and the old sign-ins end", async ({ browser }) => {
    const name = login();
    const tablet = await phone(browser);
    const signed = await signUp(tablet.context, { login: name, password: PASSWORD, space: "example" });
    const { context, page } = await phone(browser);
    await page.goto("/login");
    await page.context().addCookies([{ name: "rp_lang", value: "zh-Hans", url: new URL(page.url()).origin }]);
    await page.reload();
    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId("login-password").fill(`wrong guess ${i}`);
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("login-error")).toBeVisible();
    }
    await page.getByTestId("login-password").fill("wrong guess 6");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-step-locked")).toBeVisible();
    await expect(page.getByTestId("login-step-locked")).toContainText(/\d{2}:\d{2} 以后再试/);
    await expectPageChecks(page, { side: "elder" });
    // another phone is not locked
    expect((await logIn(tablet.context, { login: name, password: PASSWORD })).status).toBe(200);

    await page.getByTestId("login-locked-recover").click();
    await expect(page).toHaveURL(/\/recover\?login=/);
    await expect(page.getByTestId("recover-login")).toHaveValue(name);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("recover-next").click();
    await page.getByTestId("recover-code").fill(signed.recoveryCode.toLowerCase());
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("recover-next").click();
    await page.getByTestId("recover-password").fill(NEW_PASSWORD);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("recover-submit").click();
    await expect(page.getByTestId("recover-step-done")).toBeVisible();
    const newCode = (await page.getByTestId("recovery-code").innerText()).trim();
    expect(newCode).not.toBe(signed.recoveryCode);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("recover-kept").click();
    await expect(page).toHaveURL(/\/p\/today$/);

    // the tablet's sign-in ended: its next page goes to the login
    await tablet.page.goto("/p/today");
    await expect(tablet.page).toHaveURL(/\/login\?next=/);
    // the old code is spent
    const again = await tablet.context.request.post("/api/auth/recover", { data: { login: name, code: signed.recoveryCode, password: "another new one 9" } });
    expect(again.status()).toBe(401);
    await context.close();
    await tablet.context.close();
  });
});

test.describe("his devices, a new password, a new code", () => {
  test("another device signed out from this one; a new password; a new code", async ({ browser }) => {
    const name = login();
    const main = await phone(browser);
    await signUp(main.context, { login: name, password: PASSWORD, space: "example" });
    const tablet = await browser.newContext({ baseURL: BASE_URL, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36" });
    await logIn(tablet, { login: name, password: PASSWORD });

    await main.page.goto("/p/me/devices");
    const rows = main.page.getByTestId("device-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-current", "true");
    await expect(rows.nth(1)).toContainText("Android · Chrome");
    await rows.nth(1).getByTestId("device-sign-out").click();
    await expect(rows.nth(1)).toHaveAttribute("data-signed-in", "false");
    expect((await tablet.request.get("/api/me")).status()).toBe(401);

    await main.page.goto("/p/me/password");
    await expectPageChecks(main.page, { side: "elder" });
    await main.page.getByTestId("password-current").fill(PASSWORD);
    await main.page.getByTestId("password-new").fill(NEW_PASSWORD);
    await main.page.getByTestId("password-save").click();
    await expect(main.page.getByTestId("password-done")).toBeVisible();
    await expectPageChecks(main.page, { side: "elder" });

    await main.page.goto("/p/me/recovery");
    await expectPageChecks(main.page, { side: "elder" });
    await main.page.getByTestId("recovery-password").fill(NEW_PASSWORD);
    await main.page.getByTestId("recovery-new").click();
    await expect(main.page.getByTestId("recovery-done")).toBeVisible();
    await expect(main.page.getByTestId("recovery-code")).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expectPageChecks(main.page, { side: "elder" });
    await main.context.close();
    await tablet.close();
  });

  test("the account pages in English pass the checks too", async ({ browser, request }) => {
    const name = login();
    await signUp(request, { login: name, password: PASSWORD, space: "example", locale: "en" });
    const { context, page } = await phone(browser, { locale: "en-SG" });
    await page.goto("/login?lang=en");
    await expect(page.getByTestId("login-step-account")).toContainText("Log in");
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    await page.getByTestId("login-password").fill(PASSWORD);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/p\/today$/);
    for (const path of ["/p/me/devices", "/p/me/password", "/p/me/recovery"]) {
      await page.goto(path);
      await expect(page.locator("[data-rp-side=elder]").first()).toHaveAttribute("lang", "en");
      await expectPageChecks(page, { side: "elder" });
    }
    await page.goto("/recover?lang=en");
    await expectPageChecks(page, { side: "elder" });
    await context.close();
  });
});
