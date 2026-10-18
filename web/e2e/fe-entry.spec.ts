/**
 * The way in (line fe-entry; web/progress/fe-entry.md; owner 2026-10-11: the app opens as the iOS app does, then a
 * person says whether he is the elder or a son or daughter and goes into that side).
 *
 *   the cold start   SplashView over the welcome: pure black, the mark at 210 drawing itself in once, then a short
 *                    cross-fade. Once in a browser session; never when someone comes back to the door inside the app;
 *                    not at all with reduced motion; it ends by itself with no script at all; while it is up it takes
 *                    the taps, afterwards nothing lies over a control; the welcome is in the server's HTML from the start
 *   the door         "/" and 「你是哪一位？」 (/who) in the door's set of colours at the elder's size
 *   two sides        /login and /signup are the elder's or his family's, by `as`, else by what `next` implies, else the
 *                    elder's; each log-in has the small link to the other side
 *   her sign-up      the short one, step by step, to /f: an account with no space of its own
 *   her logout       lands on her log-in
 *   a computer       one 430px column on the stage of the page's set; the splash covers the column, not the window
 * Every page is held to the page checks (e2e/_checks/page-checks.ts) in BOTH sets of the colour variables: the elder's
 * floor (18px, 48px) on his pages and on the door, the family's (lib/ui/auth-tokens.ts AUTH_FLOORS: 16px, 44px) on hers.
 * What e2e/fe-auth*.spec.ts hold of the welcome and of the elder's log-in and sign-up is not repeated here.
 *
 * FE_ENTRY_SHOTS_DIR=<folder> also saves the pictures the owner looks at (390x844 at 2x, and three at 1440x900), and
 * one sheet with the splash and the welcome beside the iOS app's App Store screenshot when that file is on this
 * machine. Without the variable no picture is written.
 *
 * Runs against a server with the developer tools on (`next dev`, or scripts/record/serve.mjs); PW_PORT names it.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { LOGO_DRAW_SECONDS, LOGO_FILL_SECONDS, LOGO_PATHS } from "../components/auth-ui/logo-paths";
import { CURRENT_CONSENT_VERSIONS } from "../lib/privacy/consent-texts";
import { AUTH_FLOORS, AUTH_LOGO, AUTH_RADII, AUTH_SCHEME, AUTH_SIZES, AUTH_SPLASH, AUTH_TYPE, authThemeColor, type AuthFace } from "../lib/ui/auth-tokens";
import { SIDE_RULES, settleAnimations } from "./_checks/page-checks";
import { DOOR, DOOR_SHAPE, ELDER, FAMILY, expectChecksInBothSets, expectScales, look, newLogin, palette, phone, rgb } from "./fe-auth-kit";
import { BASE_URL } from "./helpers";
import { linkFamily, newAccount, TEST_PASSWORD } from "./journeys/_d/family";

const DIR = process.env.FE_ENTRY_SHOTS_DIR?.trim() || null;
/** The iOS app's App Store screenshot of its welcome screen (web/progress/fe-auth.md names it); only on the owner's machine. */
const APP_STORE_WELCOME = "C:/Users/Administrator/Desktop/Ripple-asc/87b5721749d33e942b0fc223406348a0.jpg";

/** The cold start's times in ms: the mark's own length (the SVG's numbers), and the fade after it. */
const DRAW_MS = Math.round((Math.max(...LOGO_PATHS.map((p) => p.delay)) + LOGO_DRAW_SECONDS + LOGO_FILL_SECONDS) * 1000);
const FADE_MS = Math.round(AUTH_SPLASH.fadeSeconds * 1000);
/** sessionStorage: this session has played the splash (components/auth-ui/splash.ts SPLASH_SEEN_KEY). */
const SEEN_KEY = "rp_splash";

const familySize = (name: string) => AUTH_SIZES.find((x) => x.name === name)!.family;
/** Her pages' shapes at the default text size when they ship in the iOS dark: the iOS numbers. In the light set the
 *  shapes that the setting-up screens share are the foundation's (fe-auth-kit shape), which her pages do not ship in. */
const HER_IOS = FAMILY.scheme === "dark";

/** A picture for the owner, when FE_ENTRY_SHOTS_DIR is set: the screen as it ships, at rest unless `moving`. */
async function picture(page: Page, name: string, opts: { moving?: boolean } = {}): Promise<void> {
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  // `next dev` draws its own badge in a corner of the page: not part of the app, kept out of the picture
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  if (!opts.moving) {
    await settleAnimations(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.screenshot({ path: path.join(DIR, `${name}.png`) });
  if (opts.moving) return;
  const taller = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 4);
  if (taller) await page.screenshot({ path: path.join(DIR, `${name}-整页.png`), fullPage: true });
}

/** The cold start's layer as the browser has it right now. */
async function splashNow(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-rp="splash"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = el.getAnimations().map((a) => {
      const t = a.effect!.getComputedTiming();
      // `at`: how far this animation is, in its own time (its delay included)
      return { name: (a as CSSAnimation).animationName, delay: Number(t.delay), duration: Number(t.duration), end: Number(t.endTime), fill: t.fill, iterations: t.iterations, state: a.playState, at: Number(a.currentTime) };
    });
    return {
      seen: el.getAttribute("data-seen"),
      ariaHidden: el.getAttribute("aria-hidden"),
      display: cs.display,
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
      position: cs.position,
      background: cs.backgroundColor,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      /** the layer's own animation while it runs; none once it has ended (it keeps nothing afterwards) */
      own,
      /** every animation in the layer: its own, and the mark's 32 (which keep their last frame) */
      moving: el.getAnimations({ subtree: true }).length,
    };
  });
}

/** What a finger at the middle of this control would touch: the control, or the cold start's layer over it. */
async function touches(page: Page, testId: string): Promise<"the control" | "the splash" | "something else"> {
  return page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === el || el.contains(hit))) return "the control";
    return hit?.closest('[data-rp="splash"]') ? "the splash" : "something else";
  });
}

/** The marks of a screen of this group: whose it is, the size it is drawn at, the set it is drawn in. */
async function expectFace(page: Page, face: AuthFace, where: string): Promise<void> {
  const set = palette(AUTH_SCHEME[face]);
  const tier = face === "family" ? "family" : "elder";
  const screen = page.locator(".rpa-ios-screen");
  await expect(screen, where).toHaveAttribute("data-rp-side", tier);
  await expect(screen, where).toHaveAttribute("data-rp", tier === "elder" ? "screen" : "family-screen");
  await expect(screen, where).toHaveAttribute("data-rp-phone", set.scheme);
  expect((await look(page, ".rpa-ios-screen")).background, where).toBe(rgb(set.background));
  await expect(page.locator('meta[name="theme-color"]'), where).toHaveAttribute("content", authThemeColor(face));
}

/** A browser nobody is signed in on, with her account and his made and linked through the app's own routes. */
async function linkedFamily(browser: Browser): Promise<{ her: BrowserContext; him: BrowserContext; link: string; herLogin: string }> {
  const mk = async () => {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", reducedMotion: "reduce" });
    await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: BASE_URL }]);
    return context;
  };
  const him = await mk();
  const her = await mk();
  await newAccount(him, { space: "example", displayName: "陈先生", prefix: "en" });
  const made = await newAccount(her, { space: "none", displayName: "Wei Ling", prefix: "en" });
  const link = await linkFamily(him, her);
  return { her, him, link, herLogin: made.login };
}

test.describe("the cold start (SplashView), then the welcome", () => {
  test("the black screen with the mark drawing itself in: once in a browser session, never on coming back inside the app", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser);
    await page.goto("/");

    // ---- it is there from the first frame, over the welcome, which is on the page all the while
    const first = (await splashNow(page))!;
    expect(first, "the layer is in the page the server sent").not.toBeNull();
    // its length is the mark's own, then a short fade: one animation, played once, that keeps nothing afterwards
    expect(first.own.length).toBe(1);
    expect(first.own[0]).toMatchObject({ name: "rpa-ios-splash-out", delay: DRAW_MS, duration: FADE_MS, end: DRAW_MS + FADE_MS, fill: "backwards", iterations: 1, state: "running" });
    expect([DRAW_MS, FADE_MS]).toEqual([3250, 350]);
    expect(first.own[0].at, "looked at while the mark is still drawing").toBeLessThan(DRAW_MS);
    expect([first.display, first.visibility, first.opacity, first.seen]).toEqual(["block", "visible", 1, null]);
    // SplashView: Color.black, over the whole screen, nothing else on it
    expect([first.background, first.position, first.box]).toEqual([rgb(AUTH_SPLASH.ground), "absolute", [0, 0, 390, 844]]);
    expect(first.ariaHidden).toBe("true");
    // every path of the mark draws and fills, and the layer fades: 33 animations, none of them endless
    expect(first.moving).toBe(33);
    // the mark: RippleAnimatedLogo(size: 210) in the middle of the screen, white, its counters the black of the ground
    const mark = await page.locator('[data-rp="splash-logo"]').evaluate((svg) => {
      const r = svg.getBoundingClientRect();
      const fills = [...new Set([...svg.querySelectorAll("path")].map((p) => `${p.getAttribute("data-hole") ? "hole" : "ink"} ${getComputedStyle(p).fill}`))].sort();
      return { box: [r.width, r.height], middle: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)], fills, animated: svg.getAttribute("data-animated"), hidden: svg.getAttribute("aria-hidden") };
    });
    expect(mark).toEqual({ box: [AUTH_LOGO.splash, AUTH_LOGO.splash], middle: [195, 422], fills: [`hole ${rgb(AUTH_SPLASH.ground)}`, `ink ${rgb(AUTH_SPLASH.mark)}`], animated: "true", hidden: "true" });
    expect(AUTH_LOGO.splash).toBe(210);
    // the welcome under it: on the page, named, readable by a screen reader, and still (its mark does not draw)
    await expect(page.getByRole("heading", { level: 1, name: "Ripple" })).toBeVisible();
    await expect(page.getByRole("link", { name: "注册" })).toBeVisible();
    await expect(page.locator('[data-rp="logo"]')).toHaveCount(1);
    expect(await page.locator('[data-rp="logo"]').evaluate((svg) => svg.getAnimations({ subtree: true }).length)).toBe(0);
    // while it is up it takes the taps: nobody presses a button he cannot see
    for (const id of ["front-door-signup", "front-door-login", "front-door-demo"]) expect(await touches(page, id), id).toBe("the splash");

    // ---- it plays in its own time and ends by itself: all there while the mark draws, fading after, then gone
    const phases: string[] = [];
    for (;;) {
      const s = (await splashNow(page))!;
      const at = s.own[0]?.at ?? null;
      const phase = at === null ? "over" : at < DRAW_MS ? "drawing" : "fading";
      phases.push(phase);
      if (phase === "drawing") expect([s.visibility, s.opacity], `at ${at}ms`).toEqual(["visible", 1]);
      if (phase === "fading") {
        expect(s.visibility, `at ${at}ms`).toBe("visible");
        expect(s.opacity, `at ${at}ms`).toBeLessThanOrEqual(1);
      }
      if (phase === "over") {
        // at rest again: not there for the eye; its own animation is gone, the mark's 32 keep their last frame
        expect([s.display, s.visibility, s.opacity, s.moving]).toEqual(["block", "hidden", 0, 32]);
        break;
      }
      await page.waitForTimeout(300);
    }
    expect(phases[0]).toBe("drawing");
    expect(phases.filter((p) => p === "drawing").length, "seen more than once while the mark drew: it was not skipped").toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-rp="splash"]')).toBeHidden();
    // once it has ended nothing invisible lies over a control
    for (const id of ["front-door-signup", "front-door-login", "front-door-demo"]) expect(await touches(page, id), id).toBe("the control");
    // the session's note is left
    expect(await page.evaluate((k) => window.sessionStorage.getItem(k), SEEN_KEY)).toBe("1");

    // ---- on into the app and back to the door by its own links: no document is loaded, and no splash is drawn
    await page.getByTestId("front-door-signup").click();
    await expect(page).toHaveURL(/\/who\?do=signup$/);
    await page.getByTestId("step-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("front-door")).toBeVisible();
    await expect(page.locator('[data-rp="splash"]')).toHaveCount(0);
    expect(await touches(page, "front-door-login")).toBe("the control");
    // the browser's own back and forward: the same
    await page.getByTestId("front-door-login").click();
    await expect(page).toHaveURL(/\/who\?do=login$/);
    await page.goBack();
    await expect(page.getByTestId("front-door")).toBeVisible();
    await expect(page.locator('[data-rp="splash"]')).toHaveCount(0);

    // ---- the door loaded again in the same session (typed again, reloaded): the layer is marked and not drawn
    for (const again of ["a second load", "a reload"] as const) {
      if (again === "a reload") await page.reload();
      else await page.goto("/");
      const s = (await splashNow(page))!;
      expect(s, again).not.toBeNull();
      expect([s.seen, s.display, s.own.length, s.moving], again).toEqual(["true", "none", 0, 0]);
      await expect(page.locator('[data-rp="splash"]'), again).toBeHidden();
      expect(await touches(page, "front-door-signup"), again).toBe("the control");
    }
    await context.close();

    // ---- another browser session: it plays again
    const later = await phone(browser);
    await later.page.goto("/");
    const again = (await splashNow(later.page))!;
    expect([again.seen, again.display, again.visibility, again.own.length]).toEqual([null, "block", "visible", 1]);
    await later.context.close();
  });

  test("with reduced motion asked for there is no splash and no drawing: the welcome at once", async ({ browser }) => {
    const { context, page } = await phone(browser, { reducedMotion: true });
    await page.goto("/");
    await expect(page.getByTestId("front-door")).toBeVisible();
    const s = (await splashNow(page))!;
    expect([s.display, s.own.length, s.moving]).toEqual(["none", 0, 0]);
    await expect(page.locator('[data-rp="splash"]')).toBeHidden();
    // nothing on the screen moves, and the buttons are his from the first moment
    expect(await page.getByTestId("front-door").evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    for (const id of ["front-door-signup", "front-door-login", "front-door-demo"]) expect(await touches(page, id), id).toBe("the control");
    const mark = await page.locator('[data-rp="logo"]').evaluate((svg) => [...new Set([...svg.querySelectorAll("path")].map((p) => `${getComputedStyle(p).fillOpacity}/${getComputedStyle(p).strokeWidth}`))]);
    expect(mark).toEqual(["1/0px"]);
    await page.getByTestId("front-door-login").click();
    await expect(page).toHaveURL(/\/who\?do=login$/);
    // the log-in's mark does not draw either
    await page.getByTestId("who-elder").click();
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    expect(await page.locator(".rpa-ios-screen").evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await context.close();
  });

  test("it ends by itself when no script runs at all, and the welcome is in the server's HTML from the start", async ({ browser, request }) => {
    test.setTimeout(60_000);
    // ---- the HTML as the server sends it: the welcome with its buttons, then the layer, hidden from assistive technology
    const html = await (await request.get("/", { headers: { cookie: "rp_lang=zh-Hans" } })).text();
    const at = (needle: string) => html.indexOf(needle);
    for (const needle of ['data-testid="front-door"', ">Ripple</h1>", "看医生时把医生的话留下来，回家听得懂、记得住。", 'data-testid="front-door-signup"', 'data-testid="front-door-login"', 'data-testid="front-door-demo"']) expect(at(needle), needle).toBeGreaterThan(0);
    expect(html).toMatch(/<a [^>]*data-testid="front-door-signup"[^>]*href="\/who\?do=signup"/);
    expect(html).toMatch(/<a [^>]*data-testid="front-door-login"[^>]*href="\/who\?do=login"/);
    expect(html).toMatch(/<div class="rpa-ios-splash" data-rp="splash" aria-hidden="true"[^>]*><script>/);
    expect(at('data-rp="splash"'), "the layer comes after the whole welcome").toBeGreaterThan(at('data-testid="front-door-demo"'));
    expect(at('data-rp="splash-logo"')).toBeGreaterThan(at('data-rp="logo"'));

    // ---- a browser that runs no script: CSS alone draws the layer, and CSS alone ends it
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, locale: "zh-CN", javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    const splash = page.locator('[data-rp="splash"]');
    await expect(splash).toBeVisible();
    await expect(page.getByRole("link", { name: "注册" })).toBeVisible();
    await expect(splash).toBeHidden({ timeout: 15_000 });
    // the welcome's buttons are plain links: they work without a script too
    await page.getByTestId("front-door-signup").click();
    await expect(page).toHaveURL(/\/who\?do=signup$/);
    await expect(page.getByTestId("who-family")).toBeVisible();
    // (with no script nothing can note that the session has seen it: it plays on every load, and ends every time)
    await page.goto("/");
    await expect(splash).toBeVisible();
    await expect(splash).toBeHidden({ timeout: 15_000 });
    await context.close();
  });

  test("pictures of the cold start, and the sheet beside the iOS app's own welcome", async ({ browser }) => {
    test.skip(!DIR, "FE_ENTRY_SHOTS_DIR is not set: no picture is written");
    test.setTimeout(120_000);
    const { context, page } = await phone(browser);
    await page.goto("/");
    await expect(page.locator('[data-rp="splash"]')).toBeVisible();
    // every animation of the page held at one moment of the page's own time
    const hold = (ms: number) =>
      page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
      }, ms);
    await hold(1500);
    await picture(page, "01-开屏-1-画到一半", { moving: true });
    await hold(DRAW_MS - 10);
    await picture(page, "01-开屏-2-画完", { moving: true });
    await hold(DRAW_MS + FADE_MS / 2);
    await picture(page, "01-开屏-3-淡出一半", { moving: true });
    await picture(page, "02-欢迎屏");
    // the welcome in English
    await page.goto("/?lang=en");
    await picture(page, "02-欢迎屏-英文");

    // ---- one sheet: the splash, the welcome, and the iOS app's App Store screenshot of its welcome
    if (existsSync(APP_STORE_WELCOME)) {
      const img = (file: string, type: string) => `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
      const cell = (src: string, label: string) => `<figure><img src="${src}"><figcaption>${label}</figcaption></figure>`;
      const sheet = await context.newPage();
      await sheet.setViewportSize({ width: 1760, height: 960 });
      await sheet.setContent(
        `<html><body style="margin:0;background:#1b1d21;color:#d7dade;font:16px/1.4 system-ui,sans-serif"><style>
          main{display:flex;gap:28px;justify-content:center;align-items:flex-start;padding:28px}
          figure{margin:0;text-align:center} img{display:block;height:844px;width:auto;border-radius:18px} figcaption{margin-top:10px}
        </style><main>
          ${cell(img(path.join(DIR!, "01-开屏-1-画到一半.png"), "png"), "网页：开屏，标志画到一半")}
          ${cell(img(path.join(DIR!, "01-开屏-2-画完.png"), "png"), "网页：开屏，标志画完")}
          ${cell(img(path.join(DIR!, "02-欢迎屏.png"), "png"), "网页：欢迎屏")}
          ${cell(img(APP_STORE_WELCOME, "jpeg"), "iOS：App Store 上架截图（WelcomeView）")}
        </main></body></html>`,
      );
      await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      await sheet.screenshot({ path: path.join(DIR!, "对照-开屏和欢迎屏-上架截图.png") });
      await sheet.close();
    }
    await context.close();
  });
});

test.describe("from the door to each side", () => {
  test("「注册」 and 「登录」 lead to 「你是哪一位？」, and its two ways to that side's page; the page at the elder's floor", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser, { reducedMotion: true });
    await page.goto("/");
    await page.getByTestId("front-door-signup").click();
    await expect(page).toHaveURL(/\/who\?do=signup$/);

    // ---- the page: still the door (its set of colours, the elder's size), one question, two ways
    const who = page.getByTestId("who");
    await expect(who).toBeVisible();
    await expectFace(page, "door", "/who");
    await expect(who).toHaveAttribute("lang", "zh-Hans");
    await expect(who.getByRole("heading", { level: 1 })).toHaveText("你是哪一位？");
    // on the right of the top bar: which of the two he is on his way to; on the left the way back to the welcome
    await expect(page.locator(".rpa-ios-step")).toHaveText("注册");
    await expect(page.getByTestId("step-back")).toHaveText("返回");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/");
    await expect(page.locator('[data-rp="way"]')).toHaveCount(2);
    await expect(page.getByTestId("who-elder")).toHaveText("我是长辈 记看医生、吃药、量血压");
    await expect(page.getByTestId("who-family")).toHaveText("我是子女 看看爸爸妈妈今天好不好");
    await expect(page.getByRole("link", { name: "我是长辈 记看医生、吃药、量血压" })).toHaveAttribute("href", "/signup?as=elder");
    await expect(page.getByRole("link", { name: "我是子女 看看爸爸妈妈今天好不好" })).toHaveAttribute("href", "/signup?as=family");

    // SignInView's layout: the mark at 150 (still) and a centred title in the free space, the two ways at the bottom
    const logo = await look(page, '[data-rp="logo"]');
    expect([logo.width, logo.height]).toEqual([AUTH_LOGO.login, AUTH_LOGO.login]);
    await expect(page.locator('[data-rp="logo"]')).not.toHaveAttribute("data-animated", "true");
    await expect(page.locator('[data-rp="logo"]')).toHaveAttribute("aria-label", "Ripple");
    const title = await look(page, '[data-rp="headline"]');
    expect([title.fontSize, title.fontWeight, title.textAlign, title.color]).toEqual([AUTH_TYPE.elder.title, 700, "center", rgb(DOOR.textPrimary)]);
    // a way: a whole card (RippleCard: surface, radius 20), at least two targets tall, as wide as the screen's column
    const way = await look(page, '[data-testid="who-elder"]');
    expect([way.background, way.radius, way.width]).toEqual([rgb(DOOR.surface), AUTH_RADII.card, 390 - 2 * DOOR_SHAPE.gutter]);
    expect(way.height).toBeGreaterThanOrEqual(2 * AUTH_FLOORS.elder.target);
    // an elder reads it: the title of a way is 24, its line 18, whatever the side he will choose
    const wayTitle = await look(page, '[data-testid="who-elder"] .rpa-ios-way-title');
    expect([wayTitle.fontSize, wayTitle.color]).toEqual([AUTH_TYPE.elder.title3, rgb(DOOR.textPrimary)]);
    const wayLine = await look(page, '[data-testid="who-family"] .rpa-ios-way-sub');
    expect([wayLine.fontSize, wayLine.color]).toEqual([AUTH_TYPE.elder.footnote, rgb(DOOR.textSecondary)]);
    expect(AUTH_TYPE.elder.footnote).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.text);
    // the ways stand at the bottom of the phone, one under another, the elder's first
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { title: box('[data-rp="headline"]').bottom, elder: box('[data-testid="who-elder"]').top, elderBottom: box('[data-testid="who-elder"]').bottom, family: box('[data-testid="who-family"]').top, familyBottom: box('[data-testid="who-family"]').bottom };
    });
    expect(boxes.title).toBeLessThan(boxes.elder);
    expect(boxes.elderBottom).toBeLessThan(boxes.family);
    expect(boxes.familyBottom).toBeLessThanOrEqual(844);
    expect(boxes.familyBottom).toBeGreaterThan(844 - 60);
    await expectChecksInBothSets(page, "elder");
    await expectScales(page);
    await picture(page, "03-你是哪一位-注册");

    // ---- each way leads to that side's sign-up
    await page.getByTestId("who-elder").click();
    await expect(page).toHaveURL(/\/signup\?as=elder$/);
    await expect(page.getByTestId("signup-step-name")).toContainText("第 1 步，共 7 步");
    await expectFace(page, "elder", "/signup?as=elder");
    await page.goBack();
    await expect(page.getByTestId("who")).toBeVisible();
    await page.getByTestId("who-family").click();
    await expect(page).toHaveURL(/\/signup\?as=family$/);
    await expect(page.getByTestId("signup-step-name")).toContainText("第 1 步，共 6 步");
    await expectFace(page, "family", "/signup?as=family");
    // the first step's 「返回」 is the way back to the welcome, on both sides
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/");
    await page.getByTestId("step-back").click();
    await expect(page.getByTestId("front-door")).toBeVisible();

    // ---- 「登录」: the same question, on the way to logging in
    await page.getByTestId("front-door-login").click();
    await expect(page).toHaveURL(/\/who\?do=login$/);
    await expect(page.locator(".rpa-ios-step")).toHaveText("登录");
    await expect(page.getByTestId("who-elder")).toHaveAttribute("href", "/login?as=elder");
    await expect(page.getByTestId("who-family")).toHaveAttribute("href", "/login?as=family");
    await expectChecksInBothSets(page, "elder");
    await picture(page, "03-你是哪一位-登录");
    await page.getByTestId("who-family").click();
    await expect(page).toHaveURL(/\/login\?as=family$/);
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expectFace(page, "family", "/login?as=family");
    await page.goBack();
    await page.getByTestId("who-elder").click();
    await expect(page).toHaveURL(/\/login\?as=elder$/);
    await expectFace(page, "elder", "/login?as=elder");

    // ---- an address that does not say which: signing up
    for (const address of ["/who", "/who?do=", "/who?do=else"]) {
      await page.goto(address);
      await expect(page.locator(".rpa-ios-step"), address).toHaveText("注册");
      await expect(page.getByTestId("who-family"), address).toHaveAttribute("href", "/signup?as=family");
    }
    await context.close();
  });

  test("in English, and the language chosen at the door goes on with him: door, 「Who are you?」, that side's page", async ({ browser }) => {
    test.setTimeout(90_000);
    // a 华语 phone that switches the door to English: only the address says so, and the next pages keep it
    const { context, page } = await phone(browser, { reducedMotion: true });
    await context.clearCookies({ name: "rp_lang" });
    await page.goto("/");
    await page.getByRole("link", { name: "切换语言：English" }).click();
    await expect(page).toHaveURL(/\/\?lang=en$/);
    await expect(page.getByTestId("front-door-signup")).toHaveText("Sign up");
    await page.getByTestId("front-door-signup").click();
    await expect(page).toHaveURL(/\/who\?do=signup&lang=en$/);
    const who = page.getByTestId("who");
    await expect(who).toHaveAttribute("lang", "en");
    await expect(who.getByRole("heading", { level: 1 })).toHaveText("Who are you?");
    await expect(page.locator(".rpa-ios-step")).toHaveText("Sign up");
    await expect(page.getByTestId("who-elder")).toHaveText("I am the elder My visits, medicine and readings");
    await expect(page.getByTestId("who-family")).toHaveText("I am the son or daughter See how my parent is doing today");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/?lang=en");
    await expectChecksInBothSets(page, "elder");
    await expectScales(page);
    await picture(page, "03-你是哪一位-注册-英文");
    // her sign-up has no language step: it is in the door's language
    await page.getByTestId("who-family").click();
    await expect(page).toHaveURL(/\/signup\?as=family&lang=en$/);
    await expect(page.getByTestId("signup-step-name")).toContainText("Step 1 of 6");
    await expect(page.locator(".rpa-ios-screen")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("signup-to-login")).toHaveAttribute("href", "/login?as=family&lang=en");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/?lang=en");
    // his sign-up starts on its language step, with the door's language picked
    await page.goBack();
    await page.getByTestId("who-elder").click();
    await expect(page).toHaveURL(/\/signup\?as=elder&lang=en$/);
    await expect(page.locator('[data-choice="en"]')).toHaveAttribute("aria-checked", "true");
    // and logging in: the same
    await page.goto("/who?do=login&lang=en");
    await expect(page.locator(".rpa-ios-step")).toHaveText("Log in");
    await page.getByTestId("who-family").click();
    await expect(page).toHaveURL(/\/login\?as=family&lang=en$/);
    await expect(page.getByTestId("login-step-account")).toContainText("Log in");
    await expect(page.getByTestId("login-as-elder")).toHaveText("I am the elder");
    await expect(page.getByTestId("login-as-elder")).toHaveAttribute("href", "/login?as=elder&lang=en");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/?lang=en");
    await context.close();
  });

  test("whose page: `as` when the address says it, else what `next` implies, else the elder's; the links keep the side", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser, { reducedMotion: true });
    const cases: [string, AuthFace, string][] = [
      // the bare addresses are the elder's pages, as they always were
      ["/login", "elder", "login-step-account"],
      ["/signup", "elder", "signup-step-name"],
      // said in the address
      ["/login?as=family", "family", "login-step-account"],
      ["/login?as=elder", "elder", "login-step-account"],
      ["/signup?as=family", "family", "signup-step-name"],
      ["/signup?as=elder", "elder", "signup-step-name"],
      // implied by where he was on his way to: her pages mean family, his own mean the elder
      ["/login?next=%2Ff", "family", "login-step-account"],
      ["/login?next=%2Ff%2Fweek%3Flink%3Dabc", "family", "login-step-account"],
      ["/login?next=%2Finvite%2Fabc", "family", "login-step-account"],
      ["/login?next=%2Fp%2Ftoday", "elder", "login-step-account"],
      ["/login?next=%2Fonboard", "elder", "login-step-account"],
      ["/login?next=%2Fprivacy", "elder", "login-step-account"],
      // said and implied: what is said wins
      ["/login?as=elder&next=%2Ff", "elder", "login-step-account"],
      ["/login?as=family&next=%2Fp%2Ftoday", "family", "login-step-account"],
      // a word that is no side, and a `next` that is no page of this site: the elder's
      ["/login?as=daughter", "elder", "login-step-account"],
      ["/login?next=%2F%2Fevil.example%2Ff", "elder", "login-step-account"],
    ];
    for (const [address, face, ready] of cases) {
      await page.goto(address);
      await expect(page.getByTestId(ready), address).toBeVisible();
      await expectFace(page, face, address);
      // behind the screen: that set's page colour
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), address).toBe(rgb(palette(AUTH_SCHEME[face]).page));
    }

    // ---- nobody signed in opens her page, or his: the proxy sends each to the log-in of that side
    await page.goto("/f");
    await expect(page).toHaveURL(/\/login\?next=%2Ff$/);
    await expectFace(page, "family", "/f, signed out");
    // the side that was only implied is said in the links to this side's other pages; the way back is kept
    await expect(page.getByTestId("login-to-signup")).toHaveAttribute("href", "/signup?as=family");
    await expect(page.getByTestId("login-as-elder")).toHaveText("我是长辈");
    await expect(page.getByTestId("login-as-elder")).toHaveAttribute("href", "/login?as=elder&next=%2Ff");
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("href", "/login?next=%2Ff&lang=en");
    await page.goto("/p/today");
    await expect(page).toHaveURL(/\/login\?next=%2Fp%2Ftoday$/);
    await expectFace(page, "elder", "/p/today, signed out");
    await expect(page.getByTestId("login-to-signup")).toHaveAttribute("href", "/signup");
    await expect(page.getByTestId("login-as-family")).toHaveAttribute("href", "/login?as=family&next=%2Fp%2Ftoday");
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("href", "/login?next=%2Fp%2Ftoday&lang=en");

    // ---- the small link takes him to the other side's log-in and back, the same page in the other look
    await page.goto("/login");
    await expect(page.getByTestId("login-as-elder")).toHaveCount(0);
    await page.getByTestId("login-as-family").click();
    await expect(page).toHaveURL(/\/login\?as=family$/);
    await expectFace(page, "family", "by the small link");
    await expect(page.getByTestId("login-step-account")).toContainText("登录");
    await expect(page.getByTestId("login-as-family")).toHaveCount(0);
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("href", "/login?as=family&lang=en");
    await page.getByTestId("login-as-elder").click();
    await expect(page).toHaveURL(/\/login\?as=elder$/);
    await expectFace(page, "elder", "and back");
    // said in the address, the elder's side is said on in its links too
    await expect(page.getByTestId("login-to-signup")).toHaveAttribute("href", "/signup?as=elder");
    // the language switch keeps the side
    await page.goto("/login?as=family");
    await page.getByTestId("lang-switch").click();
    await expect(page).toHaveURL(/\/login\?as=family&lang=en$/);
    await expectFace(page, "family", "in English");
    await expect(page.getByTestId("lang-switch")).toHaveAttribute("href", "/login?as=family&lang=zh-Hans");
    await context.close();
  });
});

test.describe("his family's log-in (SignInView's head over EmailEntryView's form, at the iOS sizes)", () => {
  test("the account screen and the password screen in the iOS dark; logging in lands on her page", async ({ browser }) => {
    test.setTimeout(120_000);
    // the page checks' floors for her pages are the tokens' own
    expect(SIDE_RULES.family).toEqual({ minText: AUTH_FLOORS.family.text, minTarget: AUTH_FLOORS.family.target });
    expect(SIDE_RULES.elder).toEqual({ minText: AUTH_FLOORS.elder.text, minTarget: AUTH_FLOORS.elder.target });

    const { context, page } = await phone(browser);
    const name = newLogin("wl");
    const made = await context.request.post("/api/dev/accounts", { data: { login: name, password: TEST_PASSWORD, space: "none", display_name: "Wei Ling", locale: "zh-Hans" } });
    expect(made.status(), await made.text()).toBe(201);
    await context.clearCookies({ name: /^rp_(at|rt|since)$/ });

    await page.goto("/login?as=family");
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expectFace(page, "family", "/login?as=family");
    // SignInView's head: the mark at 150, drawing itself in once at the entry, a centred title and line
    const logo = page.locator('[data-rp="logo"]');
    await expect(logo).toHaveAttribute("data-animated", "true");
    const drawing = await logo.evaluate((svg) => {
      const all = svg.getAnimations({ subtree: true }) as CSSAnimation[];
      return { names: [...new Set(all.map((a) => a.animationName))].sort(), count: all.length, end: Math.round(Math.max(...all.map((a) => Number(a.effect!.getComputedTiming().endTime)))) };
    });
    expect(drawing).toEqual({ names: ["rpa-ios-logo-draw", "rpa-ios-logo-fill"], count: 32, end: DRAW_MS });
    expect([(await look(page, '[data-rp="logo"]')).width, (await look(page, '[data-rp="logo"]')).height]).toEqual([AUTH_LOGO.login, AUTH_LOGO.login]);
    await settleAnimations(page);
    expect(await logo.evaluate((svg) => [...new Set([...svg.querySelectorAll("path")].map((p) => `${p.getAttribute("data-hole") ? "hole" : "ink"} ${getComputedStyle(p).fill}`))].sort())).toEqual([`hole ${rgb(FAMILY.background)}`, `ink ${rgb(FAMILY.logo)}`]);
    // the same words as his page
    await expect(page.locator('[data-rp="headline"]')).toHaveText("登录");
    await expect(page.locator('[data-rp="text"]').first()).toHaveText("注册时设的账号：手机号、名字拼音或者邮箱。");
    await expect(page.getByLabel("账号")).toBeFocused();
    await expect(page.getByTestId("step-back")).toHaveText("返回");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("lang-switch")).toHaveText("English");
    await expect(page.getByTestId("login-to-signup")).toHaveText("还没有账号？ 注册");
    await expect(page.getByTestId("login-to-signup")).toHaveAttribute("href", "/signup?as=family");
    await expect(page.getByTestId("login-to-recover")).toHaveText("忘记密码？用恢复码");
    await expect(page.getByTestId("login-as-elder")).toHaveText("我是长辈");
    if (HER_IOS) {
      // the iOS numbers themselves: .title.bold 28, .callout 16, the field 58 with its icon, .body 17, the button 52 / 14
      const title = await look(page, '[data-rp="headline"]');
      expect([title.fontSize, title.fontWeight, title.textAlign, title.color]).toEqual([AUTH_TYPE.family.title, 700, "center", rgb(FAMILY.textPrimary)]);
      const lede = await look(page, '[data-rp="text"]');
      expect([lede.fontSize, lede.color, lede.textAlign]).toEqual([AUTH_TYPE.family.callout, rgb(FAMILY.textSecondary), "center"]);
      const box = await look(page, ".rpa-ios-input-box");
      expect([box.background, box.radius, box.height]).toEqual([rgb(FAMILY.surface), AUTH_RADII.control, familySize("--rpa-h-field-icon")]);
      const input = await look(page, '[data-testid="login-login"]');
      expect([input.fontSize, input.color]).toEqual([AUTH_TYPE.family.body, rgb(FAMILY.textPrimary)]);
      const next = await look(page, '[data-testid="login-next"]');
      expect([next.background, next.color, next.fontSize, next.fontWeight, next.radius, next.height, next.shadow, next.width]).toEqual([rgb(FAMILY.accent), rgb(FAMILY.onAccent), AUTH_TYPE.family.headline, 600, AUTH_RADII.control, familySize("--rpa-h-action"), "none", 390 - 2 * 16]);
      // the top bar's capsules and the text links: 44, the family's target
      expect((await look(page, '[data-testid="step-back"]')).height).toBe(familySize("--rpa-hit"));
      const link = await look(page, '[data-testid="login-to-signup"]');
      expect([link.color, link.fontSize, link.fontWeight, link.height]).toEqual([rgb(FAMILY.accentLight), AUTH_TYPE.family.subheadline, 500, familySize("--rpa-h-text-btn")]);
      // the link to the other side is the quiet one
      expect((await look(page, '[data-testid="login-as-elder"]')).color).toBe(rgb(FAMILY.textSecondary));
      // the iOS kicker over a field: small, semibold, in capitals where there are any
      const label = await look(page, ".rpa-ios-kicker");
      expect([label.fontSize, label.fontWeight, label.color, label.textTransform]).toEqual([AUTH_TYPE.family.caption, 600, rgb(FAMILY.textSecondary), "uppercase"]);
    }
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "04-子女登录-1-账号");

    // nothing typed: said under the field
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-login-error")).toHaveText("写一个账号。");
    expect((await look(page, '[data-testid="login-login-error"]')).color).toBe(rgb(FAMILY.warning));
    await expectChecksInBothSets(page, "family");
    await picture(page, "04-子女登录-1-账号-没写");

    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-step-password")).toBeVisible();
    await expectFace(page, "family", "the password screen");
    await expect(page.locator('[data-rp="headline"]')).toHaveText("输入密码");
    await expect(page.locator('[data-rp="text"]').first()).toHaveText(`账号：${name}`);
    expect(await page.locator('[data-rp="text"] b').first().evaluate((b) => [b.textContent, getComputedStyle(b).color])).toEqual([name, rgb(FAMILY.accentLight)]);
    await expect(page.getByTestId("step-back")).toHaveText("换一个账号");
    const toggle = page.getByRole("switch", { name: "这不是我的手机" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toHaveText("关");
    await page.getByTestId("login-password").fill("not her password");
    await expectChecksInBothSets(page, "family");
    await picture(page, "04-子女登录-2-密码");
    // back on the account screen the mark is simply there
    await page.getByTestId("step-back").click();
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expect(logo).not.toHaveAttribute("data-animated", "true");
    expect(await logo.evaluate((svg) => svg.getAnimations({ subtree: true }).length)).toBe(0);
    await page.getByTestId("login-next").click();

    // a wrong password says nothing more; the right one lands on her page, whatever page she logged in on
    await page.getByTestId("login-password").fill("not her password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText("账号或密码不对。");
    expect((await look(page, '[data-testid="login-error"]')).color).toBe(rgb(FAMILY.warning));
    await expectChecksInBothSets(page, "family");
    await picture(page, "04-子女登录-2-密码-写错");
    await page.getByTestId("login-password").fill(TEST_PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/f$/);
    const me = (await (await context.request.get("/api/me")).json()) as { account: { login: string }; scope: unknown };
    expect([me.account.login, me.scope]).toEqual([name, null]);
    await context.close();
  });

  test("in English, at a 200% text size nothing scrolls sideways; the lock screen at her size", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser, { locale: "en", reducedMotion: true });
    const name = newLogin("wl");
    const made = await context.request.post("/api/dev/accounts", { data: { login: name, password: TEST_PASSWORD, space: "none", display_name: "Wei Ling", locale: "en" } });
    expect(made.status(), await made.text()).toBe(201);
    await context.clearCookies({ name: /^rp_(at|rt|since)$/ });
    await page.goto("/login?as=family");
    await expect(page.getByTestId("login-step-account")).toContainText("Log in");
    await expect(page.getByTestId("lang-switch")).toHaveText("华语");
    await expect(page.getByTestId("login-as-elder")).toHaveText("I am the elder");
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "04-子女登录-1-账号-英文");
    // six wrong passwords: this phone is locked, with the two ways on, as on his side
    await page.getByTestId("login-login").fill(name);
    await page.getByTestId("login-next").click();
    for (let i = 1; i <= 6; i++) {
      await page.getByTestId("login-password").fill(`wrong guess ${i}`);
      await page.getByTestId("login-submit").click();
      if (i < 6) await expect(page.getByTestId("login-error")).toBeVisible();
    }
    await expect(page.getByTestId("login-step-locked")).toBeVisible();
    await expectFace(page, "family", "the lock screen");
    if (HER_IOS) {
      // the second choice is SignInView's Continue with Email: white 8% with a thin edge, 52 tall
      const ok = await look(page, '[data-testid="login-locked-ok"]');
      expect([ok.background, ok.color, ok.border, ok.borderWidth, ok.radius, ok.height]).toEqual([rgb(FAMILY.fill2), rgb(FAMILY.textPrimary), rgb(FAMILY.stroke2), 1, AUTH_RADII.control, familySize("--rpa-h-secondary")]);
    }
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "04-子女登录-3-试错太多次-英文");
    await context.close();
  });
});

test.describe("her short sign-up", () => {
  test("six steps to /f: every step at her size and in both sets; an account with no space of its own", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await phone(browser, { reducedMotion: true });
    const name = newLogin("wl");
    const next = () => page.getByTestId("signup-next").click();
    await page.goto("/signup?as=family");

    // ---- 1 称呼: ProfileSetupView's screen, at the iOS sizes; no language step before it
    const step1 = page.getByTestId("signup-step-name");
    await expect(step1).toContainText("第 1 步，共 6 步");
    await expect(step1).toHaveAttribute("data-flow", "family");
    await expectFace(page, "family", "her sign-up");
    await expect(page.locator('[data-rp="headline"]')).toHaveText("怎么称呼你？");
    await expect(page.getByTestId("step-back")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("signup-name")).toHaveAttribute("placeholder", "例如：Wei Ling");
    // what this account is, in the words her sign-up on the way into an invitation uses
    await expect(page.getByTestId("signup-family-note")).toHaveText("你只是来帮家人看：这个账号不建你自己的记录，只存你的名字和账号。");
    await expect(page.getByTestId("signup-to-login")).toHaveText("已经有账号？ 登录");
    await expect(page.getByTestId("signup-to-login")).toHaveAttribute("href", "/login?as=family");
    for (const id of ["signup-space", "signup-assisted"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // nothing typed: the circle holds a person, and 「下一步」 says under the field what is missing
    await expect(page.locator('[data-rp="avatar"] svg')).toHaveCount(1);
    await next();
    await expect(page.getByTestId("signup-name-error")).toHaveText("写一个称呼，例如「Wei Ling」。");
    expect((await look(page, '[data-testid="signup-name-error"]')).color).toBe(rgb(FAMILY.warning));
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-1-称呼-没写");
    // what she types takes the place of what was wrong: the sentence goes as she writes
    await page.getByTestId("signup-name").fill("Wei Ling");
    await expect(page.getByTestId("signup-name-error")).toHaveCount(0);
    await expect(page.locator('[data-rp="avatar"]')).toHaveText("W");
    if (HER_IOS) {
      const title = await look(page, '[data-rp="headline"]');
      expect([title.fontSize, title.fontWeight, title.textAlign]).toEqual([AUTH_TYPE.family.title, 700, "start"]);
      const count = await look(page, ".rpa-ios-step");
      expect([count.fontSize, count.color]).toEqual([AUTH_TYPE.family.subheadline, rgb(FAMILY.textSecondary)]);
      const circle = await look(page, '[data-rp="avatar"]');
      expect([circle.width, circle.height, circle.fontSize, circle.color]).toEqual([familySize("--rpa-avatar"), familySize("--rpa-avatar"), AUTH_TYPE.family.avatar, rgb(FAMILY.accentLight)]);
      const field = await look(page, ".rpa-ios-input-box");
      expect([field.height, field.radius, field.background]).toEqual([familySize("--rpa-h-field"), AUTH_RADII.control, rgb(FAMILY.surface)]);
      const go = await look(page, '[data-testid="signup-next"]');
      expect([go.height, go.radius, go.shadow, go.width]).toEqual([familySize("--rpa-h-action"), AUTH_RADII.control, "none", 390 - 2 * 16]);
      const note = await look(page, '[data-testid="signup-family-note"]');
      expect([note.fontSize, note.color]).toEqual([AUTH_TYPE.family.caption, rgb(FAMILY.textTertiary)]);
    }
    // the bottom of the phone: the filled button over the quiet line (ProfileSetupView's Spacer)
    expect(await page.getByTestId("signup-to-login").evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThan(844 - 60);
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "05-子女注册-1-称呼");
    await next();

    // ---- 2 账号
    await expect(page.getByTestId("signup-step-account")).toContainText("第 2 步，共 6 步");
    await expect(page.locator('[data-rp="headline"]')).toHaveText("给自己设一个账号");
    await expect(page.getByTestId("signup-login")).toHaveAttribute("placeholder", "例如：weiling88");
    await page.getByTestId("signup-login").fill("ab");
    await next();
    await expect(page.getByTestId("signup-login-error")).toContainText("3 到 32");
    await expect(page.getByTestId("signup-login")).toHaveAttribute("aria-invalid", "true");
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-2-账号-写错");
    await page.getByTestId("signup-login").fill(name);
    await expect(page.getByTestId("signup-login-error")).toHaveCount(0);
    // 「返回」 keeps what she wrote
    await page.getByTestId("step-back").click();
    await expect(page.getByTestId("signup-name")).toHaveValue("Wei Ling");
    await next();
    await expect(page.getByTestId("signup-login")).toHaveValue(name);
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-2-账号");
    await next();

    // ---- 3 密码 (the step before asked the server whether the name is free: allow it its time on a cold server)
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("signup-step-password")).toContainText("第 3 步，共 6 步");
    await page.getByTestId("signup-password").fill("12345678");
    await next();
    await expect(page.getByTestId("signup-password-error")).toHaveText("这个密码太常见，容易被猜到，换一个。");
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-3-密码-太常见");
    await page.getByTestId("signup-password").fill(TEST_PASSWORD);
    await expect(page.getByTestId("signup-password-error")).toHaveCount(0);
    await page.getByTestId("signup-password-show").click();
    await expect(page.getByTestId("signup-password")).toHaveAttribute("type", "text");
    await expect(page.getByTestId("signup-password-show")).toHaveText("隐藏密码");
    await page.getByTestId("signup-password-show").click();
    // real-app 2.4: the sign-up says what a forgotten password means before she chooses one
    await expect(page.getByTestId("signup-step-password")).toContainText("换了新手机又忘了密码，只能用恢复码");
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-3-密码");
    await next();

    // ---- 4 条款: the same text as his, at the same version; nobody is tapping for her, so no 「请本人点」
    await expect(page.getByTestId("signup-step-terms")).toContainText("第 4 步，共 6 步");
    await expect(page.getByTestId("signup-terms-text")).toContainText("东京");
    await expect(page.getByTestId("signup-terms-text")).toContainText("90 天");
    await expect(page.getByRole("link", { name: "完整的隐私说明" })).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("assisted-note")).toHaveCount(0);
    await expect(page.getByTestId("read-aloud")).toHaveCount(0);
    if (HER_IOS) {
      const card = await look(page, '[data-testid="signup-terms-text"]');
      expect([card.background, card.radius]).toEqual([rgb(FAMILY.surface), AUTH_RADII.card]);
      const para = await look(page, '[data-testid="signup-terms-text"] p');
      expect([para.fontSize, para.color]).toEqual([AUTH_TYPE.family.body, rgb(FAMILY.textPrimary)]);
    }
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-4-条款");
    await page.getByTestId("signup-agree").click();

    // ---- 5 AI: either answer makes the account; she refuses here
    await expect(page.getByTestId("signup-step-ai")).toContainText("第 5 步，共 6 步");
    await expect(page.getByTestId("signup-ai-text")).toContainText(/腾讯云的混元模型|Tencent Cloud's Hunyuan model/);
    await expect(page.getByTestId("signup-ai-agree")).toHaveText("同意");
    await expect(page.getByTestId("signup-ai-decline")).toHaveText("不同意，也继续用");
    if (HER_IOS) {
      expect((await look(page, '[data-testid="signup-ai-agree"]')).height).toBe(familySize("--rpa-h-action"));
      const decline = await look(page, '[data-testid="signup-ai-decline"]');
      expect([decline.height, decline.background, decline.color, decline.borderWidth]).toEqual([familySize("--rpa-h-secondary"), rgb(FAMILY.fill2), rgb(FAMILY.textPrimary), 1]);
    }
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-5-AI");
    // the sign-up limit (real-app 3.5), answered in the server's place for this one tap: she is told, and is still here
    await page.route("**/api/auth/signup", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "too_many", until: "2026-10-11T12:35:00.000Z" }) }), { times: 1 });
    await page.getByTestId("signup-ai-decline").click();
    await expect(page.getByTestId("signup-error")).toHaveText("这台设备今天注册太多次了，20:35 以后再试。");
    await expect(page.getByTestId("signup-step-ai")).toBeVisible();
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-5-AI-注册太多次");
    // what goes to the server: her own taps, the page's language, both consents at their versions, no space of her own
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/auth/signup") && r.method() === "POST");
    await page.getByTestId("signup-ai-decline").click();
    expect((await sent).postDataJSON()).toEqual({
      login: name,
      password: TEST_PASSWORD,
      display_name: "Wei Ling",
      locale: "zh-Hans",
      assisted: false,
      consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
      space: "none",
    });

    // ---- 6 恢复码: one card, shown once; no back (the account exists)
    const step6 = page.getByTestId("signup-step-code");
    await expect(step6).toBeVisible({ timeout: 30_000 });
    await expect(step6).toContainText("第 6 步，共 6 步");
    await expect(step6).toHaveAttribute("data-flow", "family");
    await expect(page.getByTestId("step-back")).toHaveCount(0);
    const code = (await page.getByTestId("recovery-code").innerText()).trim();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(step6).toContainText("换了新手机又忘了密码，只能靠这个码");
    await expect(step6).toContainText("只能注册一个新账号");
    if (HER_IOS) {
      const shown = await look(page, '[data-testid="recovery-code"]');
      expect([shown.background, shown.radius, shown.fontSize, shown.fontWeight, shown.textAlign]).toEqual([rgb(FAMILY.surface), AUTH_RADII.card, AUTH_TYPE.family.code, 600, "center"]);
    }
    const tops = await page.evaluate(() => ["signup-kept", "signup-print-card"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));
    expect(tops[0]).toBeLessThan(tops[1]);
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "05-子女注册-6-恢复码");
    await page.getByTestId("signup-print-card").click();
    await expect(page.getByTestId("recovery-card")).toContainText(code);
    await expect(page.getByTestId("recovery-card")).toContainText(name);
    await expectFace(page, "family", "the card");
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-6-恢复码-打印卡");
    await page.getByTestId("card-back").click();

    // ---- 「我记下了」: where the server says, which for an account with no space of its own is her page
    await page.getByTestId("signup-kept").click();
    await expect(page).toHaveURL(/\/f$/);
    const me = (await (await context.request.get("/api/me")).json()) as { account: Record<string, unknown>; scope: unknown; links: { as_family: unknown[]; as_patient: unknown[] }; consents: { kind: string; decision: string; assisted: boolean; version: string }[] };
    expect(me.account).toMatchObject({ login: name, display_name: "Wei Ling", locale: "zh-Hans", login_kind: "username" });
    expect(me.scope, "no space of her own").toBeNull();
    expect([me.links.as_family, me.links.as_patient]).toEqual([[], []]);
    expect(me.consents.map((c) => [c.kind, c.decision, c.assisted, c.version])).toEqual([
      ["terms_privacy", "granted", false, CURRENT_CONSENT_VERSIONS.terms_privacy],
      ["ai_processing", "declined", false, CURRENT_CONSENT_VERSIONS.ai_processing],
    ]);
    // (what /f shows a daughter who follows nobody yet is the family side's own; here only that it is her page)
    await picture(page, "06-注册以后到了她的页");
    // signed in, the door and both sign-in pages send her straight on to her page
    for (const address of ["/", "/who?do=login", "/login?as=family", "/signup?as=family"]) {
      await page.goto(address);
      await expect(page, address).toHaveURL(/\/f$/);
    }
    await context.close();
  });

  test("in English, agreeing to AI: the longest lines of the flow at her size; a name that is taken is said on the account step", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser, { locale: "en", reducedMotion: true });
    const name = newLogin("wl");
    // an account of that name exists already (made on another phone)
    const other = await browser.newContext({ baseURL: BASE_URL });
    const taken = await other.request.post("/api/dev/accounts", { data: { login: `${name}x`, password: TEST_PASSWORD, space: "none", display_name: "Mei", locale: "en" } });
    expect(taken.status(), await taken.text()).toBe(201);
    await other.close();

    const next = () => page.getByTestId("signup-next").click();
    await page.goto("/signup?as=family");
    await expect(page.getByTestId("signup-step-name")).toContainText("Step 1 of 6");
    await expect(page.locator('[data-rp="headline"]')).toHaveText("What should we call you?");
    await expect(page.getByTestId("signup-name")).toHaveAttribute("placeholder", "e.g. Wei Ling");
    await expect(page.getByTestId("signup-family-note")).toHaveText("You are here to look in on a family member: this account keeps no records of your own, only your name and login.");
    await next();
    await expect(page.getByTestId("signup-name-error")).toHaveText("Write a name, e.g. Wei Ling.");
    await page.getByTestId("signup-name").fill("Wei Ling");
    await expect(page.getByTestId("signup-name-error")).toHaveCount(0);
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "05-子女注册-1-称呼-英文");
    await next();
    await expect(page.getByTestId("signup-login")).toHaveAttribute("placeholder", "e.g. weiling88");
    // the name someone already uses: said here, before a password is asked for
    await page.getByTestId("signup-login").fill(`${name}x`);
    await next();
    await expect(page.getByTestId("signup-login-error")).toHaveText("Someone already uses that name. Choose another.", { timeout: 30_000 });
    await expect(page.getByTestId("signup-step-account")).toBeVisible();
    await page.getByTestId("signup-login").fill(name);
    await next();
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("signup-password").fill(TEST_PASSWORD);
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-3-密码-英文");
    await next();
    await expect(page.getByTestId("signup-terms-text")).toContainText("Tokyo");
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "05-子女注册-4-条款-英文");
    await page.getByTestId("signup-agree").click();
    await expect(page.getByTestId("signup-ai-text")).toContainText(/腾讯云的混元模型|Tencent Cloud's Hunyuan model/);
    await expectChecksInBothSets(page, "family");
    await picture(page, "05-子女注册-5-AI-英文");
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/auth/signup") && r.method() === "POST");
    await page.getByTestId("signup-ai-agree").click();
    expect((await sent).postDataJSON()).toMatchObject({ login: name, locale: "en", assisted: false, space: "none", consents: { ai_processing: { decision: "granted" } } });
    await expect(page.getByTestId("signup-step-code")).toContainText("Step 6 of 6", { timeout: 30_000 });
    await expectChecksInBothSets(page, "family");
    await expectScales(page);
    await picture(page, "05-子女注册-6-恢复码-英文");
    await page.getByTestId("signup-kept").click();
    await expect(page).toHaveURL(/\/f$/);
    await context.close();
  });
});

test.describe("her logout", () => {
  test("lands on her log-in, the family's page, and her page asks for that log-in again", async ({ browser }) => {
    test.setTimeout(120_000);
    const { her, him, link } = await linkedFamily(browser);
    const page = await her.newPage();
    // 「退出登录」 is a row of her 「我的」
    await page.goto(`/f/me?link=${link}`);
    await expect(page.getByTestId("me-logout")).toBeVisible();
    await page.getByTestId("me-logout").click();
    await expect(page).toHaveURL(/\/login\?as=family$/);
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expectFace(page, "family", "after her logout");
    expect((await her.request.get("/api/me")).status()).toBe(401);
    // her page, signed out: the log-in of her side again (by where she was on her way to)
    await page.goto(`/f?link=${link}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/f?link=${link}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expectFace(page, "family", "her page, signed out");
    // his logout is not changed: his own log-in, the bare address
    const his = await him.newPage();
    await his.goto("/p/me/devices");
    await his.getByTestId("logout").click();
    await expect(his).toHaveURL(/\/login$/);
    await expectFace(his, "elder", "after his logout");
    await her.close();
    await him.close();
  });
});

test.describe("the elder's log-in, for comparison", () => {
  test("unchanged but for the mark that draws itself in once and the small link to the other side", async ({ browser }) => {
    const { context, page } = await phone(browser);
    await page.goto("/login");
    await expect(page.getByTestId("login-step-account")).toBeVisible();
    await expectFace(page, "elder", "/login");
    await expect(page.locator('[data-rp="logo"]')).toHaveAttribute("data-animated", "true");
    // the three links under the button, in this order, each at least his target
    const links = await page.locator('[data-rp="links"] a').evaluateAll((all) => all.map((a) => [a.getAttribute("data-testid"), a.textContent, Math.round(a.getBoundingClientRect().height)]));
    expect(links.map((l) => l.slice(0, 2))).toEqual([
      ["login-to-signup", "还没有账号？ 注册"],
      ["login-to-recover", "忘记密码？用恢复码"],
      ["login-as-family", "我是子女"],
    ]);
    for (const l of links) expect(l[2] as number, String(l[0])).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.target);
    expect((await look(page, '[data-testid="login-as-family"]')).color).toBe(rgb(ELDER.textSecondary));
    await expectChecksInBothSets(page, "elder");
    await expectScales(page);
    await picture(page, "07-老人登录-账号（对照）");
    await context.close();
  });
});

test.describe("a computer's window", () => {
  test("the door, 「你是哪一位？」 and her pages are one 430px column on the stage of their set; the splash covers the column, not the window", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
    await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: BASE_URL }]);
    const page = await context.newPage();
    const column = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right), top: Math.round(r.top), height: Math.round(r.height) };
      });
    /** Nothing of the screen is fixed to the window, nothing shown crosses the column's edges, and the page does not scroll sideways. */
    const inside = (where: string) =>
      page.evaluate((w) => {
        const root = document.querySelector(".rpa-ios-screen")!;
        const c = root.getBoundingClientRect();
        const out: string[] = [];
        for (const el of root.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") out.push(`${w}: fixed ${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width > 1 && r.height > 1 && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) out.push(`${w}: outside ${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
        }
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`${w}: the page scrolls sideways`);
        return out;
      }, where);

    // ---- the cold start: the black is the column's, like the phone it stands for; beside it the stage stays
    await page.goto("/");
    const splash = (await splashNow(page))!;
    expect(splash.visibility).toBe("visible");
    expect(await column('[data-testid="front-door"]')).toEqual({ left: 425, width: 430, right: 425, top: 0, height: 800 });
    expect(splash.box).toEqual([425, 0, 430, 800]);
    expect(splash.position).toBe("absolute");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(DOOR.page));
    // at the stage beside the column a finger touches no layer of the splash; in the column it does
    const hits = await page.evaluate(() => [100, 640, 1180].map((x) => !!document.elementFromPoint(x, 400)?.closest('[data-rp="splash"]')));
    expect(hits).toEqual([false, true, false]);
    expect(await inside("the splash")).toEqual([]);
    // the mark stands in the middle of the column
    const mark = await column('[data-rp="splash-logo"]');
    expect([mark.left + mark.width / 2, mark.top + mark.height / 2]).toEqual([640, 400]);
    await settleAnimations(page);
    await expect(page.locator('[data-rp="splash"]')).toBeHidden();
    expect(await inside("the welcome")).toEqual([]);
    expect(await page.getByTestId("front-door-demo").evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBeGreaterThan(800 - 40);

    // ---- 「你是哪一位？」 and each side's pages
    for (const [address, ready, face] of [
      ["/who?do=signup", "who", "door"],
      ["/login?as=family", "login-step-account", "family"],
      ["/signup?as=family", "signup-step-name", "family"],
      ["/login?as=elder", "login-step-account", "elder"],
    ] as const) {
      await page.goto(address);
      await expect(page.getByTestId(ready), address).toBeVisible();
      await settleAnimations(page);
      const c = await column(".rpa-ios-screen");
      expect([c.left, c.width, c.right, c.top], address).toEqual([425, 430, 425, 0]);
      expect(c.height, address).toBeGreaterThanOrEqual(800);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), address).toBe(rgb(palette(AUTH_SCHEME[face]).page));
      expect(await inside(address), address).toEqual([]);
    }
    // the ways of 「你是哪一位？」 stand at the bottom of the window, inside the column
    await page.goto("/who?do=signup");
    const way = await column('[data-testid="who-family"]');
    expect([way.left, way.width]).toEqual([425 + DOOR_SHAPE.gutter, 430 - 2 * DOOR_SHAPE.gutter]);
    expect(way.top + way.height).toBeGreaterThan(800 - 60);
    await context.close();
  });

  test("pictures at 1440x900: the cold start, the welcome, 「你是哪一位？」, her log-in", async ({ browser }) => {
    test.skip(!DIR, "FE_ENTRY_SHOTS_DIR is not set: no picture is written");
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
    await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: BASE_URL }]);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator('[data-rp="splash"]')).toBeVisible();
    // the note beside the column draws itself a moment after the page is up
    await expect(page.getByTestId("desk-note")).toBeVisible();
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 1500;
      }
    });
    await picture(page, "电脑-00-开屏-画到一半", { moving: true });
    await picture(page, "电脑-01-欢迎屏");
    await page.goto("/who?do=signup");
    await expect(page.getByTestId("desk-note")).toBeVisible();
    await picture(page, "电脑-02-你是哪一位");
    await page.goto("/login?as=family");
    await expect(page.getByTestId("desk-note")).toBeVisible();
    await picture(page, "电脑-03-子女登录");
    await page.goto("/signup?as=family");
    await expect(page.getByTestId("desk-note")).toBeVisible();
    await picture(page, "电脑-04-子女注册");
    await context.close();
  });
});
