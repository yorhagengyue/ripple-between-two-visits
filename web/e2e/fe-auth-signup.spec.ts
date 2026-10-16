/**
 * The sign-up in the iOS app's look (fe-auth; web/progress/fe-auth.md): every step is ProfileSetupView's screen at Mr
 * Tan's size, built from components/auth-ui. e2e/account.spec.ts walks the steps and their refusals; this file holds the
 * look: the numbers the browser computes against the iOS ones, the page checks on every step, the one sentence about
 * the example account's clock, the recovery code and its card on screen and on paper.
 *
 * FE_AUTH_SHOTS_DIR=<folder> also saves a picture of every step there (e2e/fe-auth-kit.ts).
 */
import { expect, test } from "@playwright/test";
import { ELDER, SHAPE, expectChecksInBothSets, expectScales, look, newLogin, phone, rgb, shot } from "./fe-auth-kit";

test.describe("the sign-up (ProfileSetupView's screen, step after step)", () => {
  test("every step at Mr Tan's size, from the iOS parts; the recovery code, its card, and the card on paper", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await phone(browser);
    const name = newLogin();
    const next = () => page.getByTestId("signup-next").click();
    await page.goto("/signup");

    // ---- 1 语言: the top bar (back, the step count), a bold title on the left, the choices, the button at the bottom
    await expect(page.getByTestId("signup-step-lang")).toContainText("第 1 步，共 9 步");
    const count = await look(page, ".rpa-ios-step");
    expect([count.fontSize, count.color]).toEqual([18, rgb(ELDER.textSecondary)]);
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/");
    const title = await look(page, '[data-rp="headline"]');
    expect([title.fontSize, title.fontWeight, title.textAlign]).toEqual([34, 700, "start"]);
    await expect(page.getByRole("radiogroup", { name: "用哪种语言？" }).getByRole("radio")).toHaveCount(2);
    await page.locator('[data-choice="zh-Hans"]').click();
    await expect(page.locator('[data-choice="zh-Hans"]')).toHaveAttribute("aria-checked", "true");
    // a row: surface, radius 14, 54 -> 64 tall; the picked one has the tick in its ring, the other an empty ring
    const row = await look(page, '[data-choice="zh-Hans"]');
    expect([row.background, row.radius]).toEqual([rgb(ELDER.surface), 14]);
    expect(row.height).toBeGreaterThanOrEqual(64);
    await expect(page.locator('[data-choice="zh-Hans"] svg')).toHaveCount(1);
    await expect(page.locator('[data-choice="en"] svg')).toHaveCount(0);
    expect(await page.locator('[data-choice="zh-Hans"]').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(rgb(ELDER.focus));
    // the button sits at the bottom of the phone (ProfileSetupView's Spacer): 64 tall, radius 14, no glow
    const go = await look(page, '[data-testid="signup-next"]');
    expect([go.height, go.radius, go.shadow]).toEqual([SHAPE.primary.height, SHAPE.primary.radius, "none"]);
    expect(await page.getByTestId("signup-to-login").evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThan(844 - 60);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-1-语言");
    await next();

    // ---- 2 称呼: ProfileSetupView's circle shows his initial as he types
    await expect(page.getByTestId("signup-step-name")).toBeVisible();
    const avatar = page.locator('[data-rp="avatar"]');
    await expect(avatar.locator("svg")).toHaveCount(1);
    // nothing typed yet: the circle holds a person, and 「下一步」 says under the field what is missing
    await next();
    await expect(page.getByTestId("signup-name-error")).toHaveText("写一个称呼，例如「陈先生」。");
    await expect(page.getByTestId("signup-step-name")).toBeVisible();
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-2-称呼-没写");
    // (the sentence stays until the next tap on 「下一步」; back and on again, so the next picture is the step at rest)
    await page.getByTestId("step-back").click();
    await next();
    await expect(page.getByTestId("signup-name-error")).toHaveCount(0);
    await page.getByTestId("signup-name").fill("陈先生");
    await expect(avatar).toHaveText("陈");
    const circle = await look(page, '[data-rp="avatar"]');
    expect([circle.width, circle.height, circle.fontSize, circle.color]).toEqual([116, 116, 48, rgb(ELDER.accentLight)]);
    const field = await look(page, ".rpa-ios-input-box");
    expect([field.height, field.radius, field.background]).toEqual([64, 14, rgb(ELDER.surface)]);
    // its small label: .caption.weight(.semibold) in textSecondary, 12 -> 18, not in capitals on his side
    await expect(page.locator(".rpa-ios-kicker")).toHaveText("称呼");
    const label = await look(page, ".rpa-ios-kicker");
    expect([label.fontSize, label.fontWeight, label.color, label.textTransform]).toEqual([18, 600, rgb(ELDER.textSecondary), "none"]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-2-称呼");
    await next();

    // ---- 3 账号: what is wrong is said under the field, in amber
    await expect(page.getByTestId("signup-step-account")).toBeVisible();
    await page.getByTestId("signup-login").fill(name);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-3-账号");
    await page.getByTestId("signup-login").fill("ab");
    await next();
    await expect(page.getByTestId("signup-login-error")).toContainText("3 到 32");
    expect((await look(page, '[data-testid="signup-login-error"]')).color).toBe(rgb(ELDER.warning));
    await expect(page.getByTestId("signup-login")).toHaveAttribute("aria-invalid", "true");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-3-账号-写错");
    await page.getByTestId("signup-login").fill(name);
    await next();

    // ---- 4 密码 (the step before asked the server whether the name is free: allow it its time on a cold server)
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    // a password everyone uses is refused on this phone, before anything is sent
    await page.getByTestId("signup-password").fill("12345678");
    await next();
    await expect(page.getByTestId("signup-password-error")).toHaveText("这个密码太常见，容易被猜到，换一个。");
    expect((await look(page, '[data-testid="signup-password-error"]')).color).toBe(rgb(ELDER.warning));
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-4-密码-太常见");
    await page.getByTestId("step-back").click();
    await next();
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("signup-password-error")).toHaveCount(0);
    await page.getByTestId("signup-password").fill("plum blossom tea");
    await expect(page.getByTestId("signup-step-password")).toContainText("换了新手机又忘了密码，只能用恢复码");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-4-密码");
    await next();

    // ---- 5 谁在操作: family helping, so the hint says whose tap the next two pages need
    await expect(page.getByTestId("signup-step-helper")).toBeVisible();
    // neither picked: both rings empty, and 「下一步」 asks for one
    await next();
    await expect(page.getByTestId("signup-error")).toHaveText("选一个。");
    await expect(page.locator('[data-testid="signup-helper"] svg')).toHaveCount(0);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-5-谁在操作-没选");
    await page.locator('[data-choice="family"]').click();
    await expect(page.getByTestId("assisted-note")).toHaveText("接下来两页的「同意」，请陈先生本人点。");
    const hint = await look(page, '[data-testid="assisted-note"]');
    expect([hint.background, hint.radius, hint.fontSize]).toEqual([rgb(ELDER.surface), 14, 18]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-5-谁在操作");
    await next();

    // ---- 6 条款: the text as published, in a card (RippleCard: surface, radius 20); the full notice opens beside it
    await expect(page.getByTestId("signup-step-terms")).toBeVisible();
    await expect(page.getByTestId("signup-terms-text")).toContainText("东京");
    const card = await look(page, '[data-testid="signup-terms-text"]');
    expect([card.background, card.radius]).toEqual([rgb(ELDER.surface), 20]);
    const para = await look(page, '[data-testid="signup-terms-text"] p');
    expect([para.fontSize, para.color]).toEqual([20, rgb(ELDER.textPrimary)]);
    await expect(page.getByRole("link", { name: "完整的隐私说明" })).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("assisted-note")).toHaveText("请陈先生本人看完，自己点「同意」。");
    await expect(page.getByTestId("read-aloud")).toHaveCount(0);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-6-条款");
    await page.getByTestId("signup-agree").click();

    // ---- 7 AI: agree is the filled button, the refusal the second one, both after the text
    await expect(page.getByTestId("signup-step-ai")).toBeVisible();
    await expect(page.getByTestId("signup-ai-text")).toContainText(/腾讯云的混元模型|Tencent Cloud's Hunyuan model/);
    expect((await look(page, '[data-testid="signup-ai-agree"]')).height).toBe(SHAPE.primary.height);
    const decline = await look(page, '[data-testid="signup-ai-decline"]');
    expect([decline.height, decline.background, decline.color]).toEqual([SHAPE.secondary.height, rgb(ELDER.fill2), rgb(ELDER.textPrimary)]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-7-AI");
    await page.getByTestId("signup-ai-agree").click();

    // ---- 8 从哪里开始: under the example's row, the one sentence about its clock (real-app 3.11)
    await expect(page.getByTestId("signup-step-space")).toBeVisible();
    await expect(page.getByTestId("signup-example-clock")).toHaveText("示例账号按新加坡时间走，提醒也按新加坡时间发；人在别处也一样。");
    const order = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { example: box('[data-choice="example"]').bottom, clock: box('[data-testid="signup-example-clock"]').top, button: box('[data-testid="signup-next"]').top };
    });
    expect(order.clock).toBeGreaterThanOrEqual(order.example);
    expect(order.button).toBeGreaterThan(order.clock);
    // the row's own small print is the example_data consent text, word for word
    await expect(page.locator('[data-choice="example"]')).toContainText("陈先生是虚构的人物。他六周的记录按今天的日期铺好，最后一天就是今天。");
    await page.locator('[data-choice="example"]').click();
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-8-从哪里开始");
    // the sign-up limit (real-app 3.5), answered in the server's place for this one tap: the screen says what happened
    // and when to come back, and he is still on this step with what he chose
    await page.route("**/api/auth/signup", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "too_many", until: "2026-10-11T12:35:00.000Z" }) }), { times: 1 });
    await next();
    await expect(page.getByTestId("signup-error")).toHaveText("这台设备今天注册太多次了，20:35 以后再试。");
    await expect(page.locator('[data-choice="example"]')).toHaveAttribute("aria-checked", "true");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-8-从哪里开始-注册太多次");
    await next();

    // ---- 9 恢复码: one card, large and evenly spaced; no back (the account exists)
    await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("signup-step-code")).toContainText("第 9 步，共 9 步");
    await expect(page.getByTestId("step-back")).toHaveCount(0);
    const code = (await page.getByTestId("recovery-code").innerText()).trim();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const shown = await look(page, '[data-testid="recovery-code"]');
    expect([shown.background, shown.radius, shown.fontSize, shown.fontWeight, shown.textAlign]).toEqual([rgb(ELDER.surface), 20, 31, 600, "center"]);
    expect(shown.family).toMatch(/^ui-monospace/);
    // the whole code on one line at this width: the card is one line of text and its padding
    expect(shown.height).toBeLessThan(31 * 1.25 + 44 + 2 + 8);
    await expect(page.getByTestId("recovery-code")).toHaveAttribute("aria-label", `恢复码: ${code.split("").join(" ")}`);
    // the filled button first, 「打印这张卡」 under it
    const tops = await page.evaluate(() => ["signup-kept", "signup-print-card"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));
    expect(tops[0]).toBeLessThan(tops[1]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-9-恢复码");

    // ---- the card
    await page.getByTestId("signup-print-card").click();
    await expect(page.getByTestId("recovery-card")).toContainText(code);
    await expect(page.getByTestId("recovery-card")).toContainText(name);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-9-恢复码-打印卡");
    // on paper: only the card, black on white (the same variables with paper's values)
    await page.emulateMedia({ media: "print" });
    const paper = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-testid="recovery-card"]')!);
      const gone = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!.closest(".rpa-ios-no-print")!).display;
      return {
        color: cs.color,
        ground: cs.backgroundColor,
        screen: getComputedStyle(document.querySelector('[data-rp="screen"]')!).backgroundColor,
        back: gone("step-back"),
        print: gone("card-print"),
      };
    });
    expect(paper).toEqual({ color: "rgb(0, 0, 0)", ground: "rgb(255, 255, 255)", screen: "rgb(255, 255, 255)", back: "none", print: "none" });
    await shot(page, "老人版-03-注册-9-恢复码-纸上");
    await page.emulateMedia({ media: "screen" });
    expect((await look(page, '[data-testid="recovery-card"]')).background).toBe(rgb(ELDER.surface));

    await page.getByTestId("card-back").click();
    await page.getByTestId("signup-kept").click();
    await expect(page).toHaveURL(/\/p\/today$/);
    await context.close();
  });

  test("in English, and at a 200% text size the screens still do not scroll sideways", async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: "en" });
    await page.goto("/signup");
    await expect(page.getByTestId("signup-step-lang")).toContainText("Step 1 of 9");
    await expectChecksInBothSets(page, "elder");
    await expectScales(page);
    await page.locator('[data-choice="en"]').click();
    await page.getByTestId("signup-next").click();
    await page.getByTestId("signup-name").fill("Mr Tan");
    await expect(page.locator('[data-rp="avatar"]')).toHaveText("M");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-2-称呼-英文");
    await expectScales(page);
    // on through the two texts he agrees to and the choice of data, in English: the longest lines of the flow
    const next = () => page.getByTestId("signup-next").click();
    await next();
    await page.getByTestId("signup-login").fill(newLogin());
    await next();
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("signup-password").fill("plum blossom tea");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-4-密码-英文");
    await next();
    await page.locator('[data-choice="family"]').click();
    await expect(page.getByTestId("assisted-note")).toHaveText("On the next two pages, Mr Tan should tap to agree.");
    await next();
    await expect(page.getByTestId("signup-terms-text")).toContainText("Tokyo");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-6-条款-英文");
    await page.getByTestId("signup-agree").click();
    await expect(page.getByTestId("signup-ai-text")).toContainText(/腾讯云的混元模型|Tencent Cloud's Hunyuan model/);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-7-AI-英文");
    await page.getByTestId("signup-ai-decline").click();
    await expect(page.getByTestId("signup-example-clock")).toHaveText("An example account runs on Singapore time, and its reminders come at Singapore time, wherever you are.");
    await page.locator('[data-choice="blank"]').click();
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-8-从哪里开始-英文");
    await expectScales(page);
    await next();
    await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("signup-step-code")).toContainText("Step 9 of 9");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-03-注册-9-恢复码-英文");
    await expectScales(page);
    await context.close();
  });
});
