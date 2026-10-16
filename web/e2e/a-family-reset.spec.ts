/**
 * Family-assisted password reset, the whole path with two accounts on two phones (track A; docs/plan/real-app.md 2.4
 * 「家人协助（默认关）」, 3.6):
 *   1. his switch on 「我 → 忘记密码时让家人帮我」 is off until he turns it on himself;
 *   2. signed out on his phone, /recover → 「请家人帮忙」: a request bound to this phone;
 *   3. her /f asks 「爸爸在重设密码，要帮他吗？」; 「帮」 shows her a 6-digit number;
 *   4. the number is no use on her phone; typed on his, with a new password, it signs him in;
 *   5. his other sign-in is over, the old password no longer works, the switch is as he left it, and his Today page
 *      says once that Wei Ling helped (gone after 「知道了」).
 * Every screen of the path passes the page checks. With the mock voice no 「读给我听」 button is on the account screens.
 * Runs on any build with the developer tools on; in-memory store and identity.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { BASE_URL, logIn, logOut, signUp } from "./helpers";
import { linkFamily } from "./journeys/_d/family";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";
const login = (p: string) => `${p}.${randomUUID().slice(0, 8)}`;

async function phone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  return { context, page: await context.newPage() };
}

test("he turns family help on, forgets his password, she reads him the code, he resets on his own phone", async ({ browser }) => {
  test.setTimeout(180_000);
  const his = await phone(browser);
  const tablet = await phone(browser);
  const hers = await phone(browser);
  const hisLogin = login("tan");
  await signUp(his.context, { login: hisLogin, password: PASSWORD, space: "example" });
  await signUp(hers.context, { login: login("wl"), password: PASSWORD, space: "none", displayName: "Wei Ling", ai: "declined" });
  const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });
  // he is signed in on a tablet too
  await logIn(tablet.context, { login: hisLogin, password: PASSWORD });

  // ---- 1. his switch: off to start with; before that, asking for help is refused in one sentence
  const hp = his.page;
  await hp.goto("/p/me");
  await expect(hp.locator('[data-entry="reset-help"]')).toBeVisible();
  await hp.locator('[data-entry="reset-help"]').click();
  await expect(hp.getByTestId("page-me-reset-help")).toBeVisible();
  await expect(hp.getByTestId("reset-help-text")).toContainText("6 位数");
  const toggle = hp.getByRole("switch");
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectPageChecks(hp, { side: "elder" });
  const early = await his.context.request.post("/api/auth/recover/help", { data: { login: hisLogin } });
  expect([early.status(), await early.json()]).toEqual([403, { error: "help_unavailable" }]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).not.toHaveAttribute("aria-busy", "true");
  await hp.reload();
  await expect(hp.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  // the way there from 「我 → 家人 → Wei Ling」 as well
  await hp.goto(`/p/family/${linkId}`);
  await expect(hp.getByTestId("link-reset-help")).toContainText("Wei Ling");

  // her page shows nothing about it while he is not asking
  const wp = hers.page;
  await wp.goto(`/f?link=${linkId}`);
  await expect(wp.getByTestId("family-app")).toBeVisible();
  await expect(wp.getByTestId("family-app")).not.toHaveAttribute("data-state", "reset_help");

  // ---- 2. he forgot his password: signed out on his phone, /recover, 「请家人帮忙」
  await logOut(his.context);
  await hp.goto(`/recover?login=${encodeURIComponent(hisLogin)}`);
  await expect(hp.getByTestId("recover-step-account")).toBeVisible();
  await expect(hp.getByTestId("recover-step-account")).toContainText("换了新手机又忘了密码，只能用恢复码");
  await expect(hp.getByTestId("recover-step-account")).toContainText("只能注册一个新账号");
  await expectPageChecks(hp, { side: "elder" });
  await hp.getByTestId("recover-family").click();
  await expect(hp.getByTestId("recover-step-family")).toBeVisible();
  await expect(hp.getByTestId("recover-step-family")).toContainText("请 Wei Ling 帮忙");
  await expect(hp.getByTestId("recover-step-family")).toContainText("只能在这台手机上输入");
  await expectPageChecks(hp, { side: "elder" });

  // ---- 3. her phone asks; she taps 帮 and sees six digits
  await expect(wp.getByTestId("family-app")).toHaveAttribute("data-state", "reset_help", { timeout: 15_000 });
  await expect(wp.getByTestId("family-headline")).toHaveText("爸爸在重设密码，要帮他吗？");
  await expectPageChecks(wp, { side: "family" });
  await wp.getByTestId("reset-help-yes").click();
  const shown = wp.getByTestId("reset-help-code");
  await expect(shown).toBeVisible();
  const code = ((await shown.textContent()) ?? "").trim();
  expect(code).toMatch(/^\d{6}$/);
  await expect(wp.getByTestId("family-headline")).toHaveText("把这 6 个数字念给爸爸");
  await expectPageChecks(wp, { side: "family" });

  // ---- 4. the number is no use on her phone (with his login), nor on a browser he never used
  const onHers = await hers.context.request.post("/api/auth/recover/family", { data: { login: hisLogin, code, password: NEW_PASSWORD } });
  expect([onHers.status(), await onHers.json()]).toEqual([401, { error: "invalid_family_code" }]);
  const stranger = await phone(browser);
  const onNew = await stranger.context.request.post("/api/auth/recover/family", { data: { login: hisLogin, code, password: NEW_PASSWORD } });
  expect(onNew.status()).toBe(401);
  expect((await hers.context.request.get("/api/me")).status()).toBe(200); // she is still herself
  expect(((await (await hers.context.request.get("/api/me")).json()) as { account: { display_name: string } }).account.display_name).toBe("Wei Ling");

  // on his phone: a wrong number first, then hers, then a new password
  await hp.getByTestId("recover-family-code").fill("12 34");
  await hp.getByTestId("recover-family-next").click();
  await expect(hp.getByTestId("recover-family-code-error")).toBeVisible();
  const wrong = code === "000000" ? "000001" : "000000";
  await hp.getByTestId("recover-family-code").fill(wrong);
  await hp.getByTestId("recover-family-next").click();
  await expect(hp.getByTestId("recover-step-family-password")).toBeVisible();
  await hp.getByTestId("recover-family-password").fill(NEW_PASSWORD);
  await hp.getByTestId("recover-family-submit").click();
  await expect(hp.getByTestId("recover-step-family")).toBeVisible();
  await expect(hp.getByTestId("recover-family-code-error")).toContainText("这 6 位数不对");
  await hp.getByTestId("recover-family-code").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await hp.getByTestId("recover-family-next").click();
  await expectPageChecks(hp, { side: "elder" });
  await hp.getByTestId("recover-family-password").fill(NEW_PASSWORD);
  await hp.getByTestId("recover-family-submit").click();
  await expect(hp.getByTestId("recover-step-family-done")).toBeVisible();
  await expect(hp.getByTestId("recover-step-family-done")).toContainText("Wei Ling");
  await expectPageChecks(hp, { side: "elder" });

  // ---- 5. what the reset did
  // his tablet's sign-in is over; the old password is refused, the new one works; her sign-in is untouched
  expect((await tablet.context.request.get("/api/me")).status()).toBe(401);
  await logIn(stranger.context, { login: hisLogin, password: PASSWORD, status: 401 });
  await logIn(stranger.context, { login: hisLogin, password: NEW_PASSWORD });
  expect((await hers.context.request.get("/api/me")).status()).toBe(200);
  // the switch is as he left it
  const helpers = (await (await his.context.request.get("/api/auth/recover/helper")).json()) as { helpers: { link_id: string; on: boolean }[] };
  expect(helpers.helpers).toEqual([expect.objectContaining({ link_id: linkId, on: true })]);
  // her screen goes back to her home by itself once he is done
  await expect(wp.getByTestId("family-app")).not.toHaveAttribute("data-state", "reset_help", { timeout: 15_000 });
  // the same number does nothing a second time
  const again = await his.context.request.post("/api/auth/recover/family", { data: { login: hisLogin, code, password: "something else 12" } });
  expect(again.status()).toBe(401);

  // his Today page says who helped, once
  await hp.getByTestId("recover-family-go").click();
  await hp.waitForURL(/\/p\/today/);
  const notice = hp.getByTestId("reset-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-method", "family_assisted");
  await expect(notice).toContainText(/你的密码在 \d+月\d+日 \d{2}:\d{2} 由 Wei Ling 协助重设。/);
  await expectPageChecks(hp, { side: "elder" });
  await hp.reload();
  await expect(hp.getByTestId("reset-notice")).toBeVisible(); // still there until he says he has seen it
  await hp.getByTestId("reset-notice-ok").click();
  await expect(hp.getByTestId("reset-notice")).toHaveCount(0);
  await hp.reload();
  await expect(hp.getByTestId("page-today")).toBeVisible();
  await expect(hp.getByTestId("reset-notice")).toHaveCount(0);
});

test("after a recovery-code reset his Today page says so, once", async ({ browser }) => {
  const his = await phone(browser);
  const name = login("rc");
  const signed = await signUp(his.context, { login: name, password: PASSWORD, space: "example" });
  await his.page.goto("/p/today");
  await expect(his.page.getByTestId("page-today")).toBeVisible();
  await expect(his.page.getByTestId("reset-notice")).toHaveCount(0); // nothing to say on an ordinary day
  const reset = await his.context.request.post("/api/auth/recover", { data: { login: name, code: signed.recoveryCode, password: NEW_PASSWORD } });
  expect(reset.status()).toBe(200);
  await his.page.goto("/p/today");
  const notice = his.page.getByTestId("reset-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-method", "recovery_code");
  await expect(notice).toContainText(/你的密码在 \d+月\d+日 \d{2}:\d{2} 用恢复码重设过。/);
  await expectPageChecks(his.page, { side: "elder" });
  await his.page.getByTestId("reset-notice-ok").click();
  await expect(his.page.getByTestId("reset-notice")).toHaveCount(0);
  await his.page.reload();
  await expect(his.page.getByTestId("page-today")).toBeVisible();
  await expect(his.page.getByTestId("reset-notice")).toHaveCount(0);
});

test("nobody confirmed yet: the switch page says so and points to 家人; English passes the checks too", async ({ browser }) => {
  const his = await phone(browser);
  await signUp(his.context, { login: login("solo"), password: PASSWORD, space: "example" });
  await his.page.goto("/p/me/reset-help");
  await expect(his.page.getByTestId("page-me-reset-help")).toBeVisible();
  await expect(his.page.getByRole("switch")).toHaveCount(0);
  await expect(his.page.getByTestId("reset-help-to-family")).toBeVisible();
  await expectPageChecks(his.page, { side: "elder" });
  await his.page.goto("/p/me/reset-help?lang=en");
  await expect(his.page.getByTestId("page-me-reset-help")).toContainText("Family help with a forgotten password");
  await expectPageChecks(his.page, { side: "elder" });
  // signed out, the page sends him to the login and back
  const nobody = await phone(browser);
  await nobody.page.goto("/p/me/reset-help");
  await nobody.page.waitForURL(/\/login\?next=%2Fp%2Fme%2Freset-help/);
});

test("signed out, a page under /f goes to the login and comes back to that very page; the response headers are there", async ({ browser }) => {
  const his = await phone(browser);
  const hers = await phone(browser);
  await signUp(his.context, { login: login("tan"), password: PASSWORD, space: "example" });
  const herLogin = login("wl");
  await signUp(hers.context, { login: herLogin, password: PASSWORD, space: "none", displayName: "Wei Ling", ai: "declined" });
  const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });

  // another phone of hers, signed out: she opens a page under /f (her own page; it needs none of his switches)
  const other = await phone(browser);
  const first = await other.context.request.get(`/f/me?link=${linkId}`, { maxRedirects: 0 });
  expect(first.status()).toBe(307);
  expect(new URL(first.headers().location, BASE_URL).pathname).toBe("/login");
  expect(new URL(first.headers().location, BASE_URL).searchParams.get("next")).toBe(`/f/me?link=${linkId}`);
  // real-app 3.4: the response headers ride on every answer
  expect(first.headers()["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(first.headers()["referrer-policy"]).toBe("no-referrer");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["permissions-policy"]).toBe("microphone=(self), camera=(self)");

  await other.page.goto(`/f/me?link=${linkId}`);
  await other.page.waitForURL(/\/login\?next=/);
  await other.page.getByTestId("login-login").fill(herLogin);
  await other.page.getByTestId("login-next").click();
  await other.page.getByTestId("login-password").fill(PASSWORD);
  await other.page.getByTestId("login-submit").click();
  await other.page.waitForURL((u) => u.pathname === "/f/me" && u.searchParams.get("link") === linkId);
  await expect(other.page.getByTestId("family-me")).toBeVisible();

  // a signed-in answer is private, no-store; another site's write is refused before it reaches a route
  const me = await other.context.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect(me.headers()["cache-control"]).toBe("private, no-store");
  const foreign = await other.context.request.post("/api/auth/logout", { data: {}, headers: { origin: "https://evil.example" } });
  expect([foreign.status(), await foreign.json()]).toEqual([403, { error: "bad_origin" }]);
  expect((await other.context.request.get("/api/me")).status()).toBe(200); // still signed in
});
