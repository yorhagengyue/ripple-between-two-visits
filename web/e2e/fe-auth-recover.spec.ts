/**
 * Recovery in the iOS app's look (fe-auth; web/progress/fe-auth.md): every step of /recover at Mr Tan's size, built
 * from components/auth-ui. e2e/account.spec.ts and e2e/a-family-reset.spec.ts walk the two ways and their refusals; this
 * file holds the look: the code screens as VerifyCodeView (one centred field, large and evenly spaced, and what he types
 * stays as typed), the screen after her help as AllSetView, the numbers the browser computes, the page checks.
 *
 * FE_AUTH_SHOTS_DIR=<folder> also saves a picture of every step there (e2e/fe-auth-kit.ts).
 */
import { expect, test } from "@playwright/test";
import { ELDER, SHAPE, expectChecksInBothSets, expectScales, look, newLogin, phone, rgb, shot } from "./fe-auth-kit";
import { logOut, signUp } from "./helpers";
import { linkFamily } from "./journeys/_d/family";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";

test.describe("recovery (EmailEntryView's screen; the codes as VerifyCodeView)", () => {
  test("with the recovery code: his account, the code, a new password, the new code", async ({ browser }) => {
    test.setTimeout(240_000);
    const name = newLogin();
    const other = await phone(browser);
    const signed = await signUp(other.context, { login: name, password: PASSWORD, space: "example" });
    await other.context.close();
    const { context, page } = await phone(browser);

    // ---- 1 账号
    await page.goto(`/recover?login=${encodeURIComponent(name)}`);
    await expect(page.getByTestId("recover-step-account")).toBeVisible();
    await expect(page.getByTestId("recover-login")).toHaveValue(name);
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/login");
    await expect(page.getByTestId("lang-switch")).toHaveText("English");
    const title = await look(page, '[data-rp="headline"]');
    expect([title.fontSize, title.fontWeight, title.textAlign]).toEqual([34, 700, "start"]);
    // EmailEntryView's field with its icon, 58 -> 68
    expect((await look(page, ".rpa-ios-input-box")).height).toBe(68);
    await expect(page.locator(".rpa-ios-input-box > svg")).toHaveCount(1);
    // both limits are said before he chooses a way
    await expect(page.getByTestId("recover-step-account")).toContainText("换了新手机又忘了密码，只能用恢复码");
    await expect(page.getByTestId("recover-step-account")).toContainText("只能注册一个新账号");
    // the two ways, the filled one first, at the bottom of the phone
    const ways = await page.evaluate(() => ["recover-next", "recover-family"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()).map((r) => [Math.round(r.top), Math.round(r.height)]));
    expect(ways[0][1]).toBe(SHAPE.primary.height);
    expect(ways[1][1]).toBe(SHAPE.secondary.height);
    expect(ways[0][0]).toBeLessThan(ways[1][0]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-1-账号");
    // 「请家人帮忙」 when he never turned it on under 「我」: one sentence under his account, which names the other way
    await page.getByTestId("recover-family").click();
    await expect(page.getByTestId("recover-login-error")).toHaveText("这台手机现在用不了家人帮忙：要在你登录过的手机上，而且事先在「我」里打开过。可以用恢复码。", { timeout: 30_000 });
    expect((await look(page, '[data-testid="recover-login-error"]')).color).toBe(rgb(ELDER.warning));
    await expect(page.getByTestId("recover-step-account")).toBeVisible();
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-1-账号-家人帮不了");
    await page.getByTestId("recover-next").click();

    // ---- 2 恢复码: VerifyCodeView's look, as one field
    await expect(page.getByTestId("recover-step-code")).toBeVisible();
    const box = await look(page, '.rpa-ios-input-box[data-code="recovery"]');
    expect([box.background, box.radius, box.height]).toEqual([rgb(ELDER.surface), 13, 72]);
    const input = await look(page, '[data-testid="recover-code"]');
    expect([input.fontSize, input.fontWeight, input.textAlign, input.textTransform]).toEqual([31, 600, "center", "uppercase"]);
    expect(input.family).toMatch(/^ui-monospace/);
    await expect(page.getByTestId("recover-code")).toHaveAttribute("placeholder", "XXXX-XXXX-XXXX");
    await expect(page.getByLabel("恢复码")).toBeFocused();
    // while he is in it the box has the teal edge
    expect(await page.locator('.rpa-ios-input-box[data-code="recovery"]').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(rgb(ELDER.focus));
    // typed in small letters, one key at a time: the field shows capitals, and keeps exactly what he typed
    const typed = signed.recoveryCode.toLowerCase();
    await page.getByTestId("recover-code").pressSequentially(typed);
    await expect(page.getByTestId("recover-code")).toHaveValue(typed);
    // the whole code fits the box
    const fits = await page.getByTestId("recover-code").evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth + 1);
    expect(fits, "the 14 characters fit the field").toBe(true);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-2-恢复码");
    // not a code: said under the field, centred, in amber
    await page.getByTestId("recover-code").fill("abcd");
    await page.getByTestId("recover-next").click();
    await expect(page.getByTestId("recover-code-error")).toHaveText("恢复码是 12 个字母和数字，再看一下卡上写的。");
    const wrong = await look(page, '[data-testid="recover-code-error"]');
    expect([wrong.color, wrong.textAlign, wrong.fontSize]).toEqual([rgb(ELDER.warning), "center", SHAPE.error.fontSize]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-2-恢复码-写错");
    await page.getByTestId("recover-code").fill(typed);
    await page.getByTestId("recover-next").click();

    // ---- 3 新密码
    await expect(page.getByTestId("recover-step-password")).toBeVisible();
    await page.getByTestId("recover-password").fill(NEW_PASSWORD);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-3-新密码");
    await page.getByTestId("recover-submit").click();

    // ---- 4 重设好了: the new code in its card; no back
    await expect(page.getByTestId("recover-step-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("recover-step-done")).toContainText("其他手机上的登录都已经退出");
    await expect(page.getByTestId("step-back")).toHaveCount(0);
    const fresh = (await page.getByTestId("recovery-code").innerText()).trim();
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(fresh).not.toBe(signed.recoveryCode);
    const tops = await page.evaluate(() => ["recover-kept", "recover-print-card"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));
    expect(tops[0]).toBeLessThan(tops[1]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-4-重设好了");
    await page.getByTestId("recover-print-card").click();
    await expect(page.getByTestId("recovery-card")).toContainText(fresh);
    await expect(page.getByTestId("recovery-card")).toContainText(name);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-4-重设好了-打印卡");
    await page.getByTestId("card-back").click();
    await page.getByTestId("recover-kept").click();
    await expect(page).toHaveURL(/\/p\/today$/);
    await context.close();
  });

  test("with family's help: the six digits she reads to him, a new password, then AllSetView's screen", async ({ browser }) => {
    test.setTimeout(240_000);
    const his = await phone(browser);
    const hers = await phone(browser);
    const name = newLogin("tan");
    await signUp(his.context, { login: name, password: PASSWORD, space: "example" });
    await signUp(hers.context, { login: newLogin("wl"), password: PASSWORD, space: "none", displayName: "Wei Ling", ai: "declined" });
    const linkId = await linkFamily(his.context, hers.context, { label: "Wei Ling", calls: "爸爸" });
    // he turned her help on beforehand, on this phone; then he is signed out and has forgotten his password
    const on = await his.context.request.post("/api/auth/recover/helper", { data: { link_id: linkId, on: true } });
    expect(on.status(), await on.text()).toBe(200);
    await logOut(his.context);
    const page = his.page;

    await page.goto(`/recover?login=${encodeURIComponent(name)}`);
    await page.getByTestId("recover-family").click();

    // ---- 家人 1 六位数: VerifyCodeView's look for the digits
    await expect(page.getByTestId("recover-step-family")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-rp="headline"]')).toHaveText("请 Wei Ling 帮忙");
    await expect(page.getByTestId("recover-step-family")).toContainText("只能在这台手机上输入");
    const digits = await look(page, '[data-testid="recover-family-code"]');
    expect([digits.fontSize, digits.fontWeight, digits.textAlign]).toEqual([31, 600, "center"]);
    // spaced wide, like six boxes
    expect(await page.getByTestId("recover-family-code").evaluate((el) => parseFloat(getComputedStyle(el).letterSpacing))).toBeCloseTo(31 * 0.3, 1);
    await expect(page.getByTestId("recover-family-code")).toHaveAttribute("inputmode", "numeric");
    // she is given the number on her phone
    const given = await hers.context.request.post(`/api/family/links/${encodeURIComponent(linkId)}/reset-code`, { data: {} });
    expect(given.status(), await given.text()).toBe(200);
    const code = ((await given.json()) as { code: string }).code;
    expect(code).toMatch(/^\d{6}$/);
    // typed with a space in the middle, as read out: kept as typed
    const typed = `${code.slice(0, 3)} ${code.slice(3)}`;
    await page.getByTestId("recover-family-code").pressSequentially(typed);
    await expect(page.getByTestId("recover-family-code")).toHaveValue(typed);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-家人-1-六位数");
    await page.getByTestId("recover-family-next").click();

    // ---- 家人 2 新密码
    await expect(page.getByTestId("recover-step-family-password")).toBeVisible();
    await page.getByTestId("recover-family-password").fill(NEW_PASSWORD);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-家人-2-新密码");
    await page.getByTestId("recover-family-submit").click();

    // ---- 家人 3 重设好了: AllSetView (the tick on its teal disc, .largeTitle centred, the rounded button with its glow)
    await expect(page.getByTestId("recover-step-family-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("recover-step-family-done")).toContainText("Wei Ling");
    const glyph = await look(page, ".rpa-ios-glyph");
    expect([glyph.width, glyph.height, glyph.color]).toEqual([125, 125, rgb(ELDER.accent)]);
    const done = await look(page, '[data-rp="headline"]');
    expect([done.fontSize, done.fontWeight, done.textAlign]).toEqual([40, 700, "center"]);
    const lede = await look(page, '[data-rp="text"]');
    expect([lede.fontSize, lede.color, lede.textAlign]).toEqual([19, rgb(ELDER.textSecondary), "center"]);
    const go = await look(page, '[data-testid="recover-family-go"]');
    expect([go.radius, go.height, go.background]).toEqual([SHAPE.pill.radius, SHAPE.primary.height, rgb(ELDER.accent)]);
    expect(go.shadow).toBe(SHAPE.pill.glow ? `${rgb(ELDER.soft)} 0px 6px 18px 0px` : "none");
    // the tick and the title sit in the middle of the free space, the button at the bottom
    const place = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { above: box('[data-rp="done"]').top, below: box('[data-testid="recover-family-go"]').top - box('[data-rp="done"]').bottom, button: box('[data-testid="recover-family-go"]').bottom };
    });
    // (the top padding of the page and of the button's area are the only difference between the two)
    expect(Math.abs(place.above - place.below)).toBeLessThan(30);
    expect(place.button).toBeGreaterThan(844 - 60);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-家人-3-重设好了");
    await page.getByTestId("recover-family-go").click();
    await page.waitForURL(/\/p\/today/);
    await his.context.close();
    await hers.context.close();
  });

  test("in English, and at a 200% text size the screens still do not scroll sideways", async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: "en" });
    await page.goto("/recover");
    await expect(page.getByTestId("recover-step-account")).toContainText("Reset your password");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-1-账号-英文");
    await expectScales(page);
    await page.getByTestId("recover-login").fill("someone");
    await page.getByTestId("recover-next").click();
    await expect(page.getByTestId("recover-step-code")).toContainText("Enter your recovery code");
    await page.getByTestId("recover-code").fill("ABCD-EFGH-JKLM");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-04-找回-2-恢复码-英文");
    await expectScales(page);
    await context.close();
  });
});
