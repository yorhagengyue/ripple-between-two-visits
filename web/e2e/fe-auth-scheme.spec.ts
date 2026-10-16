/**
 * The one switch (fe-auth; web/progress/fe-auth.md). His pages ship in one set of the colour variables
 * (lib/ui/auth-tokens.ts AUTH_SCHEME.elder: light, the elder side's ground and ink) and the other set (dark, the iOS
 * app's own) is one value away. The same table says it for the two other faces (line fe-entry): the door everyone
 * comes through (AUTH_SCHEME.door: the welcome and 「你是哪一位？」) and his family's log-in and sign-up
 * (AUTH_SCHEME.family). tests/unit/ui/auth-contrast.test.ts holds that for the sources; this file holds it for what the
 * browser draws:
 *   - as shipped, the screen's mark, its colours, the page behind it and the browser's own bar all say the same set,
 *     the set of that page's face, on every page of the group;
 *   - with the screen's mark changed to the other set (which is all the switch changes in the page), nothing on the
 *     screen is still drawn in a colour that only the shipped set has (text, grounds, edges, the logo's paths, a
 *     shadow), and changed back, nothing of the other set is left.
 * The floors and the contrast of every screen in both sets are in the other fe-auth specs and in fe-entry.spec.ts
 * (expectChecksInBothSets).
 */
import { expect, test, type Page } from "@playwright/test";
import { AUTH_SCHEME, AUTH_TIER, authThemeColor, type AuthFace, type AuthScheme } from "../lib/ui/auth-tokens";
import { settleAnimations } from "./_checks/page-checks";
import { drawnIn, look, lookOf, newLogin, onlyIn, other, palette, phone, rgb, setLook } from "./fe-auth-kit";

/** One screen: drawn in the set its face ships in, then wholly in the other by its mark alone, then wholly back. */
async function expectSwitches(page: Page, name: string, face: AuthFace = "elder"): Promise<void> {
  const shipped: AuthScheme = AUTH_SCHEME[face];
  await settleAnimations(page);
  expect(await lookOf(page), `${name}: the mark as shipped`).toBe(shipped);
  expect(await drawnIn(page, onlyIn(other(shipped))), `${name}: as shipped, something is drawn in the ${other(shipped)} set's colours`).toEqual([]);
  await setLook(page, other(shipped));
  expect(await drawnIn(page, onlyIn(shipped)), `${name}: with the mark at ${other(shipped)}, still drawn in the ${shipped} set's colours`).toEqual([]);
  expect((await look(page, ".rpa-ios-screen")).background, name).toBe(rgb(palette(other(shipped)).background));
  await setLook(page, shipped);
  expect(await drawnIn(page, onlyIn(other(shipped))), `${name}: back at ${shipped}, something of the ${other(shipped)} set is left`).toEqual([]);
}

test.describe("which set of colours each face's pages are drawn in is one value", () => {
  test("as shipped: the mark, the screen's colours, the page behind it and the browser's bar say the same set on every page", async ({ browser }) => {
    const { context, page } = await phone(browser);
    for (const [path, ready, face] of [
      ["/", "front-door", "door"],
      ["/who?do=signup", "who", "door"],
      ["/login", "login-step-account", "elder"],
      ["/signup", "signup-step-lang", "elder"],
      ["/recover", "recover-step-account", "elder"],
      ["/login?as=family", "login-step-account", "family"],
      ["/signup?as=family", "signup-step-name", "family"],
    ] as const) {
      const set = palette(AUTH_SCHEME[face]);
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      const screen = page.locator(".rpa-ios-screen");
      await expect(screen, path).toHaveAttribute("data-rp-phone", set.scheme);
      // the size it is drawn at: the door's is the elder's
      await expect(screen, path).toHaveAttribute("data-rp-side", AUTH_TIER[face]);
      await expect(screen, path).toHaveAttribute("data-rp", AUTH_TIER[face] === "elder" ? "screen" : "family-screen");
      const drawn = await screen.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { ground: cs.backgroundColor, ink: cs.color, scheme: cs.colorScheme, behind: getComputedStyle(document.body).backgroundColor };
      });
      expect(drawn, path).toEqual({ ground: rgb(set.background), ink: rgb(set.textPrimary), scheme: set.scheme, behind: rgb(set.page) });
      await expect(page.locator('meta[name="theme-color"]'), path).toHaveAttribute("content", authThemeColor(face));
      expect(authThemeColor(face)).toBe(set.background);
    }
    await context.close();
  });

  test("the mark alone changes the set: every screen is wholly in the other set, and wholly back", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await phone(browser);
    const SHIPPED = AUTH_SCHEME.elder;
    const ELDER = palette(SHIPPED);

    // ---- the welcome screen (the door's set): the ground, the mark and the counters of its letters all follow; the
    // cold start's layer over it has played and keeps its own two colours, which are neither set's
    const DOOR = palette(AUTH_SCHEME.door);
    const NOT_DOOR = palette(other(AUTH_SCHEME.door));
    await page.goto("/");
    await expect(page.getByTestId("front-door")).toBeVisible();
    await settleAnimations(page);
    // the check is not blind: as shipped it does find the shipped set
    expect((await drawnIn(page, onlyIn(DOOR.scheme))).length).toBeGreaterThan(5);
    const inks = () => page.locator('[data-rp="logo"]').evaluate((svg) => [...new Set([...svg.querySelectorAll("path")].map((p) => `${p.getAttribute("data-hole") ? "hole" : "ink"} ${getComputedStyle(p).fill}`))].sort());
    expect(await inks()).toEqual([`hole ${rgb(DOOR.background)}`, `ink ${rgb(DOOR.logo)}`]);
    await setLook(page, NOT_DOOR.scheme);
    expect(await inks()).toEqual([`hole ${rgb(NOT_DOOR.background)}`, `ink ${rgb(NOT_DOOR.logo)}`]);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(NOT_DOOR.page));
    expect((await look(page, '[data-rp="headline"]')).color).toBe(rgb(NOT_DOOR.textPrimary));
    expect((await look(page, '[data-testid="front-door-signup"]')).background).toBe(rgb(NOT_DOOR.accent));
    expect(await page.locator('[data-rp="screen"]').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(NOT_DOOR.scheme);
    await setLook(page, DOOR.scheme);
    await expectSwitches(page, "welcome", "door");

    // ---- 「你是哪一位？」 (the door's set): the mark, the title, the two cards with their chips
    await page.goto("/who?do=login");
    await expect(page.getByTestId("who-family")).toBeVisible();
    await expectSwitches(page, "who", "door");

    // ---- the log-in: the head, a field with its icon, an error; the password screen with its switch on
    await page.goto("/login");
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-login-error")).toBeVisible();
    expect((await look(page, '[data-testid="login-login-error"]')).color).toBe(rgb(ELDER.warning));
    await expectSwitches(page, "log-in, the account");
    await page.getByTestId("login-login").fill("someone");
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-step-password")).toBeVisible();
    await page.getByRole("switch").click();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => page.locator(".rpa-ios-switch-track").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(ELDER.accent));
    await page.getByTestId("login-password").fill("a password");
    await expectSwitches(page, "log-in, the password");

    // ---- his family's log-in (the family's set, the iOS sizes): the same screen by its own value
    await page.goto("/login?as=family");
    await page.getByTestId("login-next").click();
    await expect(page.getByTestId("login-login-error")).toBeVisible();
    await expectSwitches(page, "the family's log-in, the account", "family");

    // ---- the sign-up, step after step, to the recovery code and its card
    await page.goto("/signup");
    await page.locator('[data-choice="zh-Hans"]').click();
    await expectSwitches(page, "sign-up, the language");
    await page.getByTestId("signup-next").click();
    await page.getByTestId("signup-name").fill("陈先生");
    await expectSwitches(page, "sign-up, the name");
    await page.getByTestId("signup-next").click();
    await page.getByTestId("signup-login").fill(newLogin());
    await page.getByTestId("signup-next").click();
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("signup-password").fill("plum blossom tea");
    await expectSwitches(page, "sign-up, the password");
    await page.getByTestId("signup-next").click();
    await page.locator('[data-choice="family"]').click();
    await expect(page.getByTestId("assisted-note")).toBeVisible();
    await expectSwitches(page, "sign-up, who is tapping");
    await page.getByTestId("signup-next").click();
    await expect(page.getByTestId("signup-terms-text")).toBeVisible();
    await expectSwitches(page, "sign-up, the terms");
    await page.getByTestId("signup-agree").click();
    await expect(page.getByTestId("signup-ai-text")).toBeVisible();
    await expectSwitches(page, "sign-up, AI");
    await page.getByTestId("signup-ai-agree").click();
    await page.locator('[data-choice="example"]').click();
    await expectSwitches(page, "sign-up, where to start");
    await page.getByTestId("signup-next").click();
    await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 30_000 });
    await expectSwitches(page, "sign-up, the recovery code");
    await page.getByTestId("signup-print-card").click();
    await expect(page.getByTestId("recovery-card")).toBeVisible();
    await expectSwitches(page, "sign-up, the card");

    // ---- recovery: the code field (VerifyCodeView's look) with its error
    await context.clearCookies({ name: /^rp_(at|rt|since)$/ });
    await page.goto("/recover?login=someone");
    await expectSwitches(page, "recovery, the account");
    await page.getByTestId("recover-next").click();
    await page.getByTestId("recover-code").fill("abcd");
    await page.getByTestId("recover-next").click();
    await expect(page.getByTestId("recover-code-error")).toBeVisible();
    await expectSwitches(page, "recovery, the code");
    await context.close();
  });
});
