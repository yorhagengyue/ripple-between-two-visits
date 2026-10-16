/**
 * 01 注册和建档, the sign-up / log-in / log-out / recovery half (track A; track C records the onboarding half).
 * Two devices side by side: 陈先生的手机 (an iPhone) and 家里的平板 (an Android tablet the family shares).
 *
 *   sign-up      language, how to address him, a username (no e-mail), a password (a common one refused, then shown
 *                once to check), Wei Ling helping (so both consents say his own tap), the terms in plain words, AI with
 *                DeepSeek in China (refusable), Mr Tan's example data; the recovery code shown once and its card
 *   two devices  the tablet logs in with 「这不是我的手机」; his phone lists both devices
 *   log out      his phone logs out; /p/today sends him to the login
 *   lockout      a wrong password says only "账号或密码不对"; the sixth locks this phone with the time it opens; the
 *                tablet is not affected
 *   recovery     the code on his card resets the password; the old code is spent and a new one shown; the tablet's
 *                sign-in has ended; the old code tried again is refused
 *
 * Real accounts through the real pages (no developer helper); every step checks the page and, where it matters, the
 * account itself (GET /api/me, the cookies). The login name gets four random digits so the journey can run again on
 * the same server.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, journey } from "./_kit";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** The device the server sees (his devices page names it by its browser). Chromium only, through DevTools. */
async function deviceIs(page: Page, userAgent: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setUserAgentOverride", { userAgent });
}

async function me(context: BrowserContext): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await context.request.get("/api/me");
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

journey("01 注册和建档（注册、登录、退出、恢复）", async ({ kit }) => {
  const login = `chen.tan${Math.floor(1000 + Math.random() * 9000)}`;
  const { elder, tablet } = await kit.phones({ elder: "陈先生的手机", tablet: "家里的平板" });
  const pp = elder.page;
  const tp = tablet.page;
  await deviceIs(pp, IPHONE);
  await deviceIs(tp, TABLET);
  await pp.goto("/signup");
  await tp.goto("/login");

  // ------------------------------------------------------------ sign-up, one step a screen
  await kit.step(pp, "陈先生第一次打开 Ripple 的注册页，先选用哪种语言");
  await expect(pp.getByTestId("signup-step-lang")).toBeVisible();
  await expect(pp.getByTestId("signup-step-lang")).toContainText("第 1 步，共 9 步");
  await pp.locator('[data-choice="zh-Hans"]').click();
  await expect(pp.locator('[data-choice="zh-Hans"]')).toHaveAttribute("aria-checked", "true");
  await pp.getByTestId("signup-next").click();

  await kit.step(pp, "怎么称呼他：写「陈先生」");
  await expect(pp.getByTestId("signup-step-name")).toBeVisible();
  await kit.type(pp.getByTestId("signup-name"), "陈先生");
  await pp.getByTestId("signup-next").click();

  await kit.step(pp, "账号用名字拼音加四个数字，不用邮箱；点下一步时先查有没有人用");
  await expect(pp.getByTestId("signup-step-account")).toBeVisible();
  await kit.type(pp.getByTestId("signup-login"), login);
  await pp.getByTestId("signup-next").click();
  await expect(pp.getByTestId("signup-step-password")).toBeVisible();
  await kit.pause(700);

  await kit.step(pp, "他先试 12345678：太常见，会被拒");
  await kit.type(pp.getByTestId("signup-password"), "12345678");
  await pp.getByTestId("signup-next").click();
  await expect(pp.getByTestId("signup-password-error")).toHaveText("这个密码太常见，容易被猜到，换一个。");

  await kit.step(pp, "换一个自己记得住的，点「显示密码」核对一遍");
  await kit.type(pp.getByTestId("signup-password"), PASSWORD);
  await pp.getByTestId("signup-password-show").click();
  await expect(pp.getByTestId("signup-password")).toHaveAttribute("type", "text");
  await kit.pause(800);
  await pp.getByTestId("signup-next").click();

  await kit.step(pp, "女儿 Wei Ling 在旁边帮忙，选「家人帮我操作」");
  await expect(pp.getByTestId("signup-step-helper")).toBeVisible();
  await pp.locator('[data-choice="family"]').click();
  await expect(pp.getByTestId("assisted-note")).toContainText("请陈先生本人点");
  await pp.getByTestId("signup-next").click();

  await kit.step(pp, "条款是白话：资料存在东京、录音留 90 天、谁能看；要陈先生本人点同意");
  await expect(pp.getByTestId("signup-step-terms")).toBeVisible();
  await expect(pp.getByTestId("signup-terms-text")).toContainText("东京");
  await expect(pp.getByTestId("signup-terms-text")).toContainText("90 天");
  await expect(pp.getByTestId("assisted-note")).toBeVisible();
  await kit.show(pp.getByTestId("signup-agree"));
  await pp.getByTestId("signup-agree").click();

  await kit.step(pp, "AI 这一页写明 DeepSeek、在中国处理；不同意也照样能用，他点同意");
  await expect(pp.getByTestId("signup-step-ai")).toBeVisible();
  await expect(pp.getByTestId("signup-ai-text")).toContainText("DeepSeek");
  await expect(pp.getByTestId("signup-ai-text")).toContainText("处理在中国");
  await expect(pp.getByTestId("signup-ai-decline")).toHaveText("不同意，也继续用");
  await kit.show(pp.getByTestId("signup-ai-agree"));
  await pp.getByTestId("signup-ai-agree").click();

  await kit.step(pp, "从哪里开始：选陈先生的示例资料，六周的记录按今天的日期铺好");
  await expect(pp.getByTestId("signup-step-space")).toBeVisible();
  await pp.locator('[data-choice="example"]').click();
  await expect(pp.locator('[data-choice="example"]')).toHaveAttribute("aria-checked", "true");
  await pp.getByTestId("signup-next").click();

  await kit.step(pp, "账号建好了。恢复码只显示这一次：换了手机又忘了密码，只能靠它");
  await expect(pp.getByTestId("signup-step-code")).toBeVisible();
  await kit.pause(700);
  const code = (await pp.getByTestId("recovery-code").innerText()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const signedUp = await me(elder.context);
  expect(signedUp.status).toBe(200);
  expect(signedUp.body).toMatchObject({ account: { login, display_name: "陈先生", login_kind: "username" }, scope: { example_data: true, onboarding: "done" } });
  expect((signedUp.body.consents as { kind: string; decision: string; assisted: boolean; version: string }[]).map((c) => [c.kind, c.decision, c.assisted])).toEqual([
    ["terms_privacy", "granted", true],
    ["ai_processing", "granted", true],
    ["example_data", "granted", true],
  ]);

  await kit.step(pp, "「打印这张卡」：账号、恢复码和用法印在一张卡上，可以交给家人");
  await pp.getByTestId("signup-print-card").click();
  await expect(pp.getByTestId("recovery-card")).toContainText(code);
  await expect(pp.getByTestId("recovery-card")).toContainText(login);
  await kit.pause(1200);
  await pp.getByTestId("card-back").click();

  await kit.step(pp, "他点「我记下了」，进到今天页：示例资料，真实日期");
  await pp.getByTestId("signup-kept").click();
  await expect(pp).toHaveURL(/\/p\/today$/);
  await expect(pp.getByTestId("page-today")).toBeVisible();
  const atCookie = (await elder.context.cookies()).find((c) => c.name === "rp_at");
  expect(atCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(atCookie!.expires * 1000 - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5000); // the app keeps a token 15 minutes

  // ------------------------------------------------------------ a second device, then log out
  await kit.step(tp, "家里的平板也登录同一个账号，打开「这不是我的手机」");
  await expect(tp.getByTestId("login-step-account")).toBeVisible();
  await kit.type(tp.getByTestId("login-login"), login);
  await tp.getByTestId("login-next").click();
  await expect(tp.getByTestId("login-step-password")).toBeVisible();
  await tp.getByRole("switch").click();
  await expect(tp.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await kit.type(tp.getByTestId("login-password"), PASSWORD);
  await tp.getByTestId("login-submit").click();
  await expect(tp).toHaveURL(/\/p\/today$/);
  const tabletCookies = await tablet.context.cookies();
  for (const n of ["rp_at", "rp_rt", "rp_since"]) expect(tabletCookies.find((c) => c.name === n)?.expires, n).toBe(-1); // gone when the browser closes

  await kit.step(pp, "手机上打开「我」里的登录和设备：这台手机和平板都在");
  await pp.goto("/p/me/devices");
  await expect(pp.getByTestId("page-me-devices")).toBeVisible();
  const rows = pp.getByTestId("device-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("iPhone · Safari");
  await expect(rows.nth(0)).toContainText("这台设备 · 正在用");
  await expect(rows.nth(1)).toContainText("Android · Chrome");
  await expect(rows.nth(1)).toContainText("这不是我的手机");
  await kit.pause(1000);

  await kit.step(pp, "他点「退出登录」，回到登录页");
  await kit.show(pp.getByTestId("logout"));
  await pp.getByTestId("logout").click();
  await expect(pp).toHaveURL(/\/login$/);
  expect((await me(elder.context)).status).toBe(401);
  await kit.pause(700);

  await kit.step(pp, "再打开今天页：没登录，先被送去登录页，登录后会回到这里");
  await pp.goto("/p/today");
  await expect(pp).toHaveURL(/\/login\?next=%2Fp%2Ftoday$/);
  await expect(pp.getByTestId("login-step-account")).toBeVisible();
  await kit.pause(700);

  // ------------------------------------------------------------ a forgotten password: the lock, then the code
  await kit.step(pp, "他记错了密码：只说「账号或密码不对」，不说是哪一个错");
  await kit.type(pp.getByTestId("login-login"), login);
  await pp.getByTestId("login-next").click();
  await kit.type(pp.getByTestId("login-password"), "plum blossom");
  await pp.getByTestId("login-submit").click();
  await expect(pp.getByTestId("login-error")).toHaveText("账号或密码不对。");

  await kit.step(pp, "连错到第六次，这台手机先锁 15 分钟，屏上写明几点以后再试");
  for (let i = 2; i <= 6; i++) {
    await pp.getByTestId("login-password").fill(`plum blossom ${i}`);
    await pp.getByTestId("login-submit").click();
    if (i < 6) await expect(pp.getByTestId("login-error")).toBeVisible();
  }
  await expect(pp.getByTestId("login-step-locked")).toBeVisible();
  await kit.pause(700);
  await expect(pp.getByTestId("login-step-locked")).toContainText(/这台手机 \d{2}:\d{2} 以后再试/);
  await expect(pp.getByTestId("login-locked-recover")).toHaveText("用恢复码重设密码");

  await kit.step(tp, "锁的只是那台手机：平板上的登录照常能用");
  await tp.reload();
  await expect(tp.getByTestId("page-today")).toBeVisible();
  expect((await me(tablet.context)).status).toBe(200);

  await kit.step(pp, "他点「用恢复码重设密码」，账号已经填好，输入卡上的恢复码");
  await pp.getByTestId("login-locked-recover").click();
  await expect(pp).toHaveURL(/\/recover\?login=/);
  await expect(pp.getByTestId("recover-login")).toHaveValue(login);
  await pp.getByTestId("recover-next").click();
  await kit.type(pp.getByTestId("recover-code"), code);
  await pp.getByTestId("recover-next").click();
  await expect(pp.getByTestId("recover-step-password")).toBeVisible();
  await kit.pause(700);

  await kit.step(pp, "设一个新密码：重设好了，用过的恢复码作废，换一个新的");
  await kit.type(pp.getByTestId("recover-password"), NEW_PASSWORD);
  await pp.getByTestId("recover-submit").click();
  await expect(pp.getByTestId("recover-step-done")).toBeVisible();
  const newCode = (await pp.getByTestId("recovery-code").innerText()).trim();
  expect(newCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  expect(newCode).not.toBe(code);
  await expect(pp.getByTestId("recover-step-done")).toContainText("其他手机上的登录都已经退出");
  await kit.pause(700);

  await kit.step(tp, "平板上的旧登录已经退出：再点一下，就回到登录页");
  await tp.reload();
  await expect(tp).toHaveURL(/\/login\?next=%2Fp%2Ftoday$/);
  expect((await me(tablet.context)).status).toBe(401);
  await kit.pause(700);

  await kit.step(tp, "旧恢复码再试一次：不对，一个恢复码只能用一次");
  await tp.goto(`/recover?login=${encodeURIComponent(login)}`);
  await tp.getByTestId("recover-next").click();
  await kit.type(tp.getByTestId("recover-code"), code);
  await tp.getByTestId("recover-next").click();
  await kit.type(tp.getByTestId("recover-password"), "lantern festival 8");
  await tp.getByTestId("recover-submit").click();
  await expect(tp.getByTestId("recover-step-code")).toBeVisible();
  await expect(tp.getByTestId("recover-code-error")).toHaveText("账号或恢复码不对。");

  await kit.step(pp, "陈先生点「我记下了」，回到今天页，用的是新密码的登录");
  await pp.getByTestId("recover-kept").click();
  await expect(pp).toHaveURL(/\/p\/today$/);
  await expect(pp.getByTestId("page-today")).toBeVisible();
  expect((await me(elder.context)).status).toBe(200);

  await kit.step(pp, "今天页顶上说一句：密码在什么时候用恢复码重设过。不是他自己做的，他就知道了");
  await expect(pp.getByTestId("reset-notice")).toBeVisible();
  await expect(pp.getByTestId("reset-notice")).toContainText(/你的密码在 \d+月\d+日 \d{2}:\d{2} 用恢复码重设过。/);
  await kit.pause(900);

  await kit.step(pp, "他点「知道了」，这句话说过一次，就不再出现");
  await pp.getByTestId("reset-notice-ok").click();
  await expect(pp.getByTestId("reset-notice")).toHaveCount(0);
  await pp.reload();
  await expect(pp.getByTestId("page-today")).toBeVisible();
  await expect(pp.getByTestId("reset-notice")).toHaveCount(0);

  await kit.finish();
});
