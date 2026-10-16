/**
 * Pictures of the foundation's later fixes where other groups' screens stand on them (web/progress/fe.md, 「地基后来加
 * 的」): the field whose input fills its box, on the three screens that had padded it themselves (setting up, inviting
 * family, a new password), each measured as well: the input is at least 48 high and its box keeps the draft's 64.
 * Like e2e/fe-shots.spec.ts, never part of a default run: without FE_SHOTS_DIR every test here is skipped.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3700 npx playwright test e2e/fe-shots-foundation.spec.ts
 *
 * The pictures go to FE_SHOTS_DIR/foundation/.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function phone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
}

async function shot(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, "foundation");
  mkdirSync(out, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
}

/** Every field on the screen: the input's own height and its box's. */
async function fields(page: Page): Promise<{ input: number; box: number }[]> {
  return page.locator(".rpu-f-box").evaluateAll((boxes) =>
    boxes.map((box) => ({ input: Math.round(box.querySelector<HTMLElement>(".rpu-f-input")!.getBoundingClientRect().height), box: Math.round(box.getBoundingClientRect().height) })),
  );
}

function expectFields(found: { input: number; box: number }[], where: string): void {
  expect(found.length, `${where}: the screen has a field`).toBeGreaterThan(0);
  for (const f of found) {
    expect(f.input, `${where}: the input is a target of at least 48`).toBeGreaterThanOrEqual(48);
    expect(f.box, `${where}: the box keeps the draft's 64`).toBe(64);
  }
}

test("the field on the screens that padded it themselves", async ({ browser }) => {
  // setting up (a new, blank account that has not been through it yet): the clinic's name
  const fresh = await phone(browser);
  await account(fresh, "blank", { onboarding: "started" });
  const setup = await fresh.newPage();
  await setup.goto("/onboard/clinic");
  await expect(setup.getByTestId("onboard-clinic")).toBeVisible();
  expectFields(await fields(setup), "/onboard/clinic");
  await shot(setup, "field-onboard-clinic");
  await setup.getByTestId("onboard-clinic").focus();
  expectFields(await fields(setup), "/onboard/clinic, typing");
  await fresh.close();

  // his account: inviting family, and a new password
  const context = await phone(browser);
  await account(context, "example");
  const page = await context.newPage();
  await page.goto("/p/family/invite");
  await expect(page.locator(".rpu-f-input").first()).toBeVisible();
  expectFields(await fields(page), "/p/family/invite");
  await shot(page, "field-family-invite");
  await page.goto("/p/me/password");
  await expect(page.locator(".rpu-f-input").first()).toBeVisible();
  expectFields(await fields(page), "/p/me/password");
  await shot(page, "field-me-password");
  await context.close();
});
