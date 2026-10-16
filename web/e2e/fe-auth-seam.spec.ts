/**
 * The join between his sign-up and setting up (fe-auth; web/progress/fe-auth.md). A blank account goes from the last
 * sign-up screen straight into /onboard, the foundation's screens (the timeline look, another line's pages). In the
 * light set, what both have is the foundation's own: the ground, the typeface, the gutter, the back word and where it
 * sits, the two buttons and where the last one sits. tests/unit/ui/auth-contrast.test.ts holds that for the
 * stylesheet; this file measures both sides in the browser and holds them to each other, so a change on either side
 * that breaks the join is seen.
 *
 * In the dark set his pages are the iOS app's own look and there is no such join: the test says so and stops.
 *
 * FE_AUTH_SHOTS_DIR=<folder> also saves the screens on both sides of the join there (「老人版-05-接上建档-…」).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ELDER, SHOTS, newLogin, phone, rgb } from "./fe-auth-kit";

/** What the browser draws of one control: its box, its type, its colours. */
async function drawn(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const icon = el.querySelector("svg")?.getBoundingClientRect();
      const half = (n: number) => Math.round(n * 2) / 2;
      return {
        left: half(r.left),
        right: half(window.innerWidth - r.right),
        top: half(r.top),
        bottom: half(window.innerHeight - r.bottom),
        height: half(r.height),
        middle: half(r.top + r.height / 2),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        family: cs.fontFamily,
        color: cs.color,
        background: cs.backgroundColor,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        icon: icon ? { left: half(icon.left), width: half(icon.width) } : null,
      };
    });
}

/** A picture of one side of the join, as it is (these screens are not all this line's: nothing is changed on them). */
async function picture(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test.describe("his sign-up and the setting-up screens after it are one product", () => {
  test("the ground, the typeface, the gutter, the back word and the two buttons are the same on both sides of the join", async ({ browser }) => {
    test.skip(ELDER.scheme !== "light", "his pages are in the dark set (the iOS app's own look): there is no join with the light setting-up screens to hold");
    test.setTimeout(240_000);
    const { context, page } = await phone(browser);
    const next = () => page.getByTestId("signup-next").click();

    // ---- his side: a blank sign-up, to the step before the account is made (it has the back word and one filled button)
    await page.goto("/signup");
    await next();
    await page.getByTestId("signup-name").fill("陈先生");
    await next();
    await page.getByTestId("signup-login").fill(newLogin("seam"));
    await next();
    await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("signup-password").fill("plum blossom tea");
    await next();
    await page.locator('[data-choice="self"]').click();
    await next();
    await page.getByTestId("signup-agree").click();
    await page.getByTestId("signup-ai-agree").click();
    await expect(page.getByTestId("signup-step-space")).toBeVisible();
    await page.locator('[data-choice="blank"]').click();
    const his = {
      screen: await drawn(page, '[data-rp="screen"]'),
      back: await drawn(page, '[data-testid="step-back"]'),
      primary: await drawn(page, '[data-testid="signup-next"]'),
      title: await drawn(page, '[data-rp="headline"]'),
    };
    await picture(page, "老人版-05-接上建档-1-注册第8步");
    await next();
    // the last sign-up screen: his recovery code, the filled button over the second one
    await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 30_000 });
    const last = {
      primary: await drawn(page, '[data-testid="signup-kept"]'),
      secondary: await drawn(page, '[data-testid="signup-print-card"]'),
    };
    await picture(page, "老人版-05-接上建档-2-注册最后一屏");

    // ---- the other side: 「我记下了」 leads a blank account into setting up
    await page.getByTestId("signup-kept").click();
    await page.waitForURL(/\/onboard\/who$/);
    await expect(page.locator(".rpu-headline")).toBeVisible();
    const who = {
      screen: await drawn(page, ".rpu-screen"),
      title: await drawn(page, ".rpu-headline"),
      secondary: await drawn(page, '[data-testid="onboard-skip"]'),
    };
    await picture(page, "老人版-05-接上建档-3-建档第一屏");
    await page.locator('[data-testid^="onboard-who-"]').first().click();
    await page.waitForURL(/\/onboard\/clinic$/);
    await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
    await expect(page.getByTestId("onboard-next")).toBeEnabled();
    const clinic = {
      back: await drawn(page, ".rpu-back"),
      primary: await drawn(page, '[data-testid="onboard-next"]'),
    };
    await picture(page, "老人版-05-接上建档-4-建档第二屏");

    // ---- the same ground and ink, the same typeface, the same gutter
    expect(his.screen.background).toBe(who.screen.background);
    expect(his.screen.background).toBe(rgb(ELDER.background));
    expect(his.screen.color).toBe(who.screen.color);
    expect(his.screen.family).toBe(who.screen.family);
    expect(his.title.left).toBe(who.title.left);
    expect(his.title.family).toBe(who.title.family);

    // ---- the back word: the same bare word in the action colour, at the same place
    const word = (b: typeof his.back) => ({ left: b.left, middle: b.middle, height: b.height, fontSize: b.fontSize, fontWeight: b.fontWeight, color: b.color, background: b.background, border: b.border.split(" ")[0], icon: b.icon });
    expect(word(his.back)).toEqual(word(clinic.back));

    // ---- the filled button: the same shape and label, and on a step the same foot under it
    const filled = (b: typeof his.primary) => ({ height: b.height, radius: b.radius, background: b.background, color: b.color, fontSize: b.fontSize, fontWeight: b.fontWeight, shadow: b.shadow });
    expect(filled(his.primary)).toEqual(filled(clinic.primary));
    expect(filled(last.primary)).toEqual(filled(clinic.primary));
    expect(his.primary.bottom).toBe(clinic.primary.bottom);
    expect(his.primary.left).toBe(who.secondary.left);
    expect(his.primary.right).toBe(who.secondary.right);

    // ---- the second button: the same white button with its ink edge, as wide and at the same foot
    const second = (b: typeof last.secondary) => ({ left: b.left, right: b.right, bottom: b.bottom, height: b.height, radius: b.radius, background: b.background, color: b.color, border: b.border, fontSize: b.fontSize, fontWeight: b.fontWeight });
    expect(second(last.secondary)).toEqual(second(who.secondary));
    await context.close();
  });
});
