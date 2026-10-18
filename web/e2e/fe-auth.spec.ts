/**
 * The welcome, log-in, sign-up and recovery screens, derived from the owner's iOS app (fe-auth; web/progress/fe-auth.md;
 * components/auth-ui, app/ripple-auth.css). What e2e/account.spec.ts and e2e/a-family-reset.spec.ts already walk (the
 * steps, the refusals) is not repeated here. These files hold what is about the look:
 *   - the welcome screen: WelcomeView's parts, the numbers as the browser computes them, the page checks in both
 *     languages, the mark drawing itself in once on the cold start's black screen and not at all for reduced motion
 *     (how the cold start behaves, and the way from the door to each side, is e2e/fe-entry.spec.ts);
 *   - every screen at Mr Tan's size: the iOS screens one text size up (18px and 48px floors);
 *   - the colours of the set his pages ship in (ELDER, from the one switch in lib/ui/auth-tokens.ts) and of the set the
 *     door ships in (DOOR, the same switch's value for the welcome), and the page checks of every state in BOTH sets of
 *     the colour variables;
 *   - the phone's text size: at a 200% root font the text doubles and nothing scrolls sideways; zoom is never blocked;
 *     the iOS Dynamic Type hook is in the built CSS;
 *   - a computer's window: one 430px column in the middle.
 *
 * This file: the welcome screen, the log-in, the phone's text size, a computer. The sign-up is in
 * fe-auth-signup.spec.ts, recovery in fe-auth-recover.spec.ts, the switch between the two sets in
 * fe-auth-scheme.spec.ts, the join with the setting-up screens in fe-auth-seam.spec.ts.
 *
 * FE_AUTH_SHOTS_DIR=<folder> also saves two pictures of every state there, one in each set (390x844 at 2x:
 * <name>-light.png and <name>-dark.png), for a person to judge the look; a screen longer than the phone gets a
 * whole-page one as well. Runs against a server with the developer tools on (`next dev`, or scripts/record/serve.mjs);
 * PW_PORT names it.
 */
import { expect, test } from "@playwright/test";
import { checkZoomAllowed, settleAnimations } from "./_checks/page-checks";
import { DOOR, DOOR_SHAPE, ELDER, SHAPE, expectChecksInBothSets, expectScales, look, newLogin, phone, rgb, shot } from "./fe-auth-kit";
import { BASE_URL } from "./helpers";

test.describe("the welcome screen (WelcomeView)", () => {
  test("its parts, in the iOS colours and one text size up", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await page.goto("/");
    const door = page.getByTestId("front-door");
    await expect(door).toHaveAttribute("data-rp", "screen");
    // the door is drawn at the elder's size: an elder reads it too
    await expect(door).toHaveAttribute("data-rp-side", "elder");
    // the desktop layout's mark: a phone page, and which set of colours it is drawn in (the one switch: the door's value)
    await expect(door).toHaveAttribute("data-rp-phone", DOOR.scheme);
    await expect(door).toHaveAttribute("lang", "zh-Hans");
    await expect(door.getByRole("heading", { level: 1 })).toHaveText("Ripple");
    await expect(door).toContainText("看医生时把医生的话留下来，回家听得懂、记得住。");
    await expect(page.getByTestId("front-door-signup")).toHaveText("注册");
    await expect(page.getByTestId("front-door-login")).toHaveText("登录");
    // both lead to 「你是哪一位？」, which leads to that side's page
    await expect(page.getByTestId("front-door-signup")).toHaveAttribute("href", "/who?do=signup");
    await expect(page.getByTestId("front-door-login")).toHaveAttribute("href", "/who?do=login");
    await expect(page.getByTestId("front-door-demo")).toHaveText("评委：并排演示在 /demo");
    await expect(page.getByRole("link", { name: "切换语言：English" })).toHaveText("中/EN");
    // one page: no page dots; and no rows of what the app does until the owner gives their words
    await expect(page.locator('[data-rp="features"]')).toHaveCount(0);
    // (the cold start's black screen is over the welcome for its first seconds: measured once it has played)
    await settleAnimations(page);
    await expect(page.locator('[data-rp="splash"]')).toBeHidden();

    // the ground, and the browser's own bar in the same colour
    expect((await look(page, '[data-testid="front-door"]')).background).toBe(rgb(DOOR.background));
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", DOOR.background);
    // the system font, as the app
    expect((await look(page, '[data-testid="front-door"]')).family).toMatch(DOOR_SHAPE.font);

    // the mark at 175, centred, and still: WelcomeView draws RippleLogoMark, the splash before it has played it
    const logo = await look(page, '[data-rp="logo"]');
    expect([logo.width, logo.height]).toEqual([175, 175]);
    await expect(page.locator('[data-rp="logo"]')).toHaveCount(1);
    await expect(page.locator('[data-rp="logo"]')).not.toHaveAttribute("data-animated", "true");
    // .largeTitle.bold one size up: 40, textPrimary, centred
    const title = await look(page, '[data-rp="headline"]');
    expect([title.fontSize, title.fontWeight, title.color, title.textAlign]).toEqual([40, 700, rgb(DOOR.textPrimary), "center"]);
    // .subheadline in textSecondary: 15 on iOS, 18 here
    const lede = await look(page, '[data-rp="text"]');
    expect([lede.fontSize, lede.color, lede.textAlign]).toEqual([18, rgb(DOOR.textSecondary), "center"]);
    // RipplePrimaryButtonStyle: teal, onAccent, .headline (17 -> 20), radius 16, 54 -> 64 tall, the glow
    const primary = await look(page, '[data-testid="front-door-signup"]');
    expect([primary.background, primary.color, primary.fontSize, primary.fontWeight, primary.radius, primary.height]).toEqual([rgb(DOOR.accent), rgb(DOOR.onAccent), DOOR_SHAPE.primary.fontSize, DOOR_SHAPE.primary.fontWeight, DOOR_SHAPE.hero.radius, DOOR_SHAPE.primary.height]);
    expect(primary.shadow).toBe(DOOR_SHAPE.hero.glow ? `${rgb(DOOR.soft)} 0px 6px 18px 0px` : "none");
    expect(primary.width).toBe(390 - 2 * DOOR_SHAPE.gutter);
    // RippleTextButtonStyle(tint: accentLight): .subheadline.weight(.medium), the whole line tappable, 44 -> 48
    const second = await look(page, '[data-testid="front-door-login"]');
    expect([second.color, second.fontSize, second.fontWeight, second.height, second.width]).toEqual([rgb(DOOR.accentLight), 18, DOOR_SHAPE.words.fontWeight, 48, 390 - 2 * DOOR_SHAPE.gutter]);
    // the judges' line is small print
    const small = await look(page, '[data-testid="front-door-demo"]');
    expect([small.color, small.fontSize, small.fontWeight]).toEqual([rgb(DOOR.textTertiary), 18, 400]);
    expect(small.height).toBeGreaterThanOrEqual(48);

    // the bottom area sits at the bottom of the phone, the filled button over the quiet ones (WelcomeView's inset)
    const boxes = await page.evaluate(() => {
      const top = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      return { signup: top("front-door-signup").top, login: top("front-door-login").top, demo: top("front-door-demo").bottom, logo: document.querySelector('[data-rp="logo"]')!.getBoundingClientRect().bottom };
    });
    expect(boxes.logo).toBeLessThan(boxes.signup);
    expect(boxes.signup).toBeLessThan(boxes.login);
    expect(boxes.demo).toBeLessThanOrEqual(844);
    expect(boxes.demo).toBeGreaterThan(844 - 40);

    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-01-欢迎屏");
    await context.close();
  });

  test("in English: the page checks, the same parts", async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: "en" });
    await page.goto("/");
    const door = page.getByTestId("front-door");
    await expect(door).toHaveAttribute("lang", "en");
    await expect(door).toContainText("Keep what the doctor said at the visit, and understand and remember it at home.");
    await expect(page.getByTestId("front-door-signup")).toHaveText("Sign up");
    await expect(page.getByTestId("front-door-login")).toHaveText("Log in");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-01-欢迎屏-英文");
    // the language link leads to the other language and back
    await page.getByRole("link", { name: "Switch language: 中文" }).click();
    await expect(page).toHaveURL(/\/\?lang=zh-Hans$/);
    await expect(page.getByTestId("front-door-signup")).toHaveText("注册");
    await context.close();
  });

  test("the mark draws itself in once, on the cold start's black screen; with reduced motion it is simply there", async ({ browser }) => {
    const moving = await phone(browser);
    await moving.page.goto("/");
    // the drawing is SplashView's: the mark at 210 over the welcome. The welcome's own mark under it is still.
    const drawing = moving.page.locator('[data-rp="splash-logo"]');
    await expect(drawing).toHaveAttribute("data-animated", "true");
    expect((await look(moving.page, '[data-rp="splash-logo"]')).width).toBe(210);
    const playing = await drawing.evaluate((svg) => {
      const all = svg.getAnimations({ subtree: true }) as CSSAnimation[];
      const timing = all.map((a) => a.effect!.getComputedTiming());
      return {
        names: [...new Set(all.map((a) => a.animationName))].sort(),
        count: all.length,
        paths: svg.querySelectorAll("path").length,
        once: timing.every((t) => t.iterations === 1),
        // the last path starts at 1.35s, draws for 1.4s, then fills for 0.5s
        end: Math.round(Math.max(...timing.map((t) => Number(t.endTime)))),
      };
    });
    expect(playing).toEqual({ names: ["rpa-ios-logo-draw", "rpa-ios-logo-fill"], count: 32, paths: 16, once: true, end: 3250 });
    const logo = moving.page.locator('[data-rp="logo"]');
    await expect(logo).not.toHaveAttribute("data-animated", "true");
    expect(await logo.evaluate((svg) => svg.getAnimations({ subtree: true }).length)).toBe(0);
    // when it has played, every path is filled and has no outline left: the finished mark, there as on the welcome
    await settleAnimations(moving.page);
    for (const mark of [drawing, logo]) {
      const done = await mark.evaluate((svg) => [...svg.querySelectorAll("path")].map((p) => `${getComputedStyle(p).fillOpacity}/${getComputedStyle(p).strokeWidth}`));
      expect([...new Set(done)]).toEqual(["1/0px"]);
    }
    // the counters of p, p and e are the ground showing through
    const holes = await logo.evaluate((svg) => [...svg.querySelectorAll('path[data-hole="true"]')].map((p) => getComputedStyle(p).fill));
    expect(holes).toEqual([rgb(DOOR.background), rgb(DOOR.background), rgb(DOOR.background)]);
    await moving.context.close();

    const still = await phone(browser, { reducedMotion: true });
    await still.page.goto("/");
    // no black screen and no drawing: the welcome, with its finished mark, at once
    await expect(still.page.locator('[data-rp="splash"]')).toBeHidden();
    const calm = await still.page.locator('[data-rp="logo"]').evaluate((svg) => ({
      // nothing on the whole screen moves: neither mark, nor the layer
      animations: svg.closest('[data-rp="screen"]')!.getAnimations({ subtree: true }).length,
      paths: [...new Set([...svg.querySelectorAll("path")].map((p) => `${getComputedStyle(p).fillOpacity}/${getComputedStyle(p).strokeWidth}`))],
    }));
    expect(calm).toEqual({ animations: 0, paths: ["1/0px"] });
    await expectChecksInBothSets(still.page, "elder");
    await still.context.close();
  });

  test("beside the phone column a wide screen is the page colour, and the column is 430 wide", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("front-door")).toBeVisible();
    // the door's own set: beside its column the stage of that set
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(DOOR.page));
    expect((await look(page, '[data-testid="front-door"]')).width).toBe(430);
    // the column is in the middle of the window, as tall as the window, and the bottom area is at the window's bottom
    const column = await page.getByTestId("front-door").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), height: Math.round(r.height) };
    });
    expect(Math.abs(column.left - column.right)).toBeLessThanOrEqual(1);
    expect(column.height).toBeGreaterThanOrEqual(800);
    expect(await page.getByTestId("front-door-demo").evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeGreaterThan(800 - 40);
    // nothing of this group is measured against the window: no sideways scroll, and the judges' line leads to /demo
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("front-door-demo")).toHaveAttribute("href", "/demo");
    await shot(page, "电脑-01-欢迎屏");
    for (const [path, ready, name] of [
      ["/login", "login-step-account", "电脑-02-登录"],
      ["/signup", "signup-step-name", "电脑-03-注册"],
      ["/recover", "recover-step-account", "电脑-04-找回"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      expect((await look(page, '[data-rp="screen"]')).width, path).toBe(430);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe(rgb(ELDER.page));
      await shot(page, name);
    }
    await context.close();
  });
});

test.describe("the log-in (SignInView's head over EmailEntryView's form)", () => {
  test("the account screen, the password screen and the lock, at Mr Tan's size", async ({ browser }) => {
    const { context, page } = await phone(browser);
    const name = newLogin();
    const made = await context.request.post("/api/dev/accounts", { data: { login: name, password: "plum blossom tea", space: "example", display_name: "陈先生", locale: "zh-Hans" } });
    expect(made.status(), await made.text()).toBe(201);
    await context.clearCookies({ name: /^rp_(at|rt|since)$/ });

    await page.goto("/login");
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    // SignInView's head: the mark at 150, drawing itself in once at the entry as it does there, .title.bold, .callout
    const logo = page.locator('[data-rp="logo"]');
    await expect(logo).toHaveAttribute("data-animated", "true");
    const drawing = await logo.evaluate((svg) => {
      const all = svg.getAnimations({ subtree: true }) as CSSAnimation[];
      return { names: [...new Set(all.map((a) => a.animationName))].sort(), count: all.length, once: all.every((a) => a.effect!.getComputedTiming().iterations === 1) };
    });
    expect(drawing).toEqual({ names: ["rpa-ios-logo-draw", "rpa-ios-logo-fill"], count: 32, once: true });
    await expect(logo).toHaveAttribute("aria-label", "Ripple");
    expect([(await look(page, '[data-rp="logo"]')).width, (await look(page, '[data-rp="logo"]')).height]).toEqual([150, 150]);
    const title = await look(page, '[data-rp="headline"]');
    expect([title.fontSize, title.fontWeight, title.textAlign]).toEqual([34, 700, "center"]);
    const lede = await look(page, '[data-rp="text"]');
    expect([lede.fontSize, lede.color, lede.textAlign]).toEqual([19, rgb(ELDER.textSecondary), "center"]);
    // EmailEntryView's field: surface, radius 14, an icon in front, 58 -> 68 tall; what he types is .body (17 -> 20)
    const box = await look(page, ".rpa-ios-input-box");
    expect([box.background, box.radius, box.height]).toEqual([rgb(ELDER.surface), 14, 68]);
    const input = await look(page, '[data-testid="login-login"]');
    expect([input.fontSize, input.color]).toEqual([20, rgb(ELDER.textPrimary)]);
    await expect(page.getByLabel("账号")).toBeFocused();
    // its button: RipplePrimaryButtonStyle(cornerRadius: 14, minHeight: 52, glow: false), 64 here, with the arrow
    const next = await look(page, '[data-testid="login-next"]');
    expect([next.background, next.color, next.radius, next.height, next.shadow]).toEqual([rgb(ELDER.accent), rgb(ELDER.onAccent), SHAPE.primary.radius, SHAPE.primary.height, "none"]);
    await expect(page.getByTestId("login-next").locator("svg")).toHaveCount(1);
    // back and the language are worded capsules in the top bar
    await expect(page.getByTestId("step-back")).toHaveText("返回");
    await expect(page.getByTestId("lang-switch")).toHaveText("English");
    expect((await look(page, '[data-testid="lang-switch"]')).color).toBe(rgb(ELDER.accentLight));
    expect((await look(page, '[data-testid="step-back"]')).height).toBe(48);
    // under the two links that were there, one small one to the other side's log-in, quieter than they are
    await expect(page.getByTestId("login-to-signup")).toHaveAttribute("href", "/signup");
    await expect(page.getByTestId("login-as-family")).toHaveText("我是子女");
    await expect(page.getByTestId("login-as-family")).toHaveAttribute("href", "/login?as=family");
    expect((await look(page, '[data-testid="login-as-family"]')).color).toBe(rgb(ELDER.textSecondary));
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-1-账号");

    // nothing typed: said under the field, in the palette's amber (never red)
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-login-error")).toHaveText("写一个账号。");
    const error = await look(page, '[data-testid="login-login-error"]');
    expect([error.color, error.fontSize, error.fontWeight]).toEqual([rgb(ELDER.warning), SHAPE.error.fontSize, SHAPE.error.fontWeight]);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-1-账号-没写");

    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-step-password")).toBeVisible();
    // EmailEntryView's own head: .title.bold on the left, and the account's name in teal as VerifyCodeView writes the address
    const head = await look(page, '[data-rp="headline"]');
    expect([head.fontSize, head.textAlign]).toEqual([34, "start"]);
    await expect(page.locator('[data-rp="text"]').first()).toHaveText(`账号：${name}`);
    expect(await page.locator('[data-rp="text"] b').first().evaluate((b) => [b.textContent, getComputedStyle(b).color])).toEqual([name, rgb(ELDER.accentLight)]);
    await expect(page.getByTestId("step-back")).toHaveText("换一个账号");
    // back on the account screen the mark is simply there: SignInView plays it once, at the entry
    await page.getByTestId("step-back").click();
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expect(logo).not.toHaveAttribute("data-animated", "true");
    expect(await logo.evaluate((svg) => svg.getAnimations({ subtree: true }).length)).toBe(0);
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-step-password")).toBeVisible();
    // the switch: a switch, off, saying so in words
    const toggle = page.getByRole("switch", { name: "这不是我的手机" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveText("关");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveText("开");
    await expect.poll(() => page.locator(".rpa-ios-switch-track").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(ELDER.accent));
    await toggle.click();
    await page.getByTestId("login-password").fill("not my password");
    await expect(page.getByTestId("login-password")).toHaveAttribute("type", "password");
    await expect(page.getByTestId("login-password-show")).toHaveText("显示密码");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-2-密码");
    await page.getByTestId("login-password-show").click();
    await expect(page.getByTestId("login-password")).toHaveAttribute("type", "text");
    await expect(page.getByTestId("login-password-show")).toHaveText("隐藏密码");
    await expect(page.getByTestId("login-password-show")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText("账号或密码不对。");
    expect((await look(page, '[data-testid="login-error"]')).color).toBe(rgb(ELDER.warning));
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-2-密码-写错");

    // five more wrong ones: this phone is locked, with the two ways on
    for (let i = 2; i <= 6; i++) {
      await page.getByTestId("login-password").fill(`wrong guess ${i}`);
      await page.getByTestId("login-submit").click();
      if (i < 6) await expect(page.getByTestId("login-error")).toBeVisible();
    }
    await expect(page.getByTestId("login-step-locked")).toBeVisible();
    await expect(page.getByTestId("login-step-locked")).toContainText(/这台手机 \d{2}:\d{2} 以后再试/);
    // the second choice is SignInView's Continue with Email: white 8% with a thin edge, 52 -> 60 tall
    const ok = await look(page, '[data-testid="login-locked-ok"]');
    expect([ok.background, ok.color, ok.border, ok.borderWidth, ok.radius, ok.height]).toEqual([rgb(ELDER.fill2), rgb(ELDER.textPrimary), rgb(ELDER.stroke2), SHAPE.secondary.border, SHAPE.secondary.radius, SHAPE.secondary.height]);
    expect((await look(page, '[data-testid="login-locked-recover"]')).height).toBe(SHAPE.primary.height);
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-3-试错太多次");
    await context.close();
  });

  test("in English, and at a 200% text size nothing scrolls sideways", async ({ browser }) => {
    const { context, page } = await phone(browser, { locale: "en" });
    await page.goto("/login");
    await expect(page.getByTestId("login-step-account")).toContainText("Log in");
    await expect(page.getByTestId("lang-switch")).toHaveText("华语");
    await expectChecksInBothSets(page, "elder");
    await shot(page, "老人版-02-登录-1-账号-英文");
    await expectScales(page);
    await context.close();
  });
});

test.describe("the phone's text size and zoom", () => {
  test("the welcome screen: at a 200% root font the text doubles and nothing scrolls sideways; zoom is not blocked", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await page.goto("/");
    await settleAnimations(page);
    await expectScales(page);
    // the mark is an image: it does not grow with the text (as on iOS)
    await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
    expect((await look(page, '[data-rp="logo"]')).width).toBe(175);
    await shot(page, "老人版-01-欢迎屏-大字");
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    // the same on a form screen and on a step with choices: pictures for the owner of what a doubled text size does
    for (const [path, ready, name] of [
      ["/login", "login-step-account", "老人版-02-登录-1-账号-大字"],
      ["/signup", "signup-step-name", "老人版-03-注册-1-称呼-大字"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at 200%`).toBe(true);
      await shot(page, name);
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    }
    await page.goto("/");
    const z = await checkZoomAllowed(page);
    expect(z.blocked, `viewport meta: ${z.content}`).toBe(false);
    await context.close();
  });

  test("the iOS text-size hook for these screens survives the CSS build", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await page.goto("/");
    const hook = await page.evaluate(() => {
      const texts: string[] = [];
      const walk = (list: CSSRuleList) => {
        for (const r of [...list]) {
          texts.push(r.cssText);
          if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of [...document.styleSheets]) {
        try {
          walk(sheet.cssRules);
        } catch {
          // a cross-origin sheet cannot be read; it holds no rule of ours
        }
      }
      return {
        supports: texts.some((t) => /^@supports\s*\(\s*font:\s*-apple-system-body\s*\)/.test(t) && /:has\(\.rpa-ios-screen\)/.test(t)),
        unit: texts.some((t) => /:has\(\.rpa-ios-screen\)/.test(t) && /--rp-u\s*:/.test(t)),
      };
    });
    expect(hook).toEqual({ supports: true, unit: true });
    await context.close();
  });
});
