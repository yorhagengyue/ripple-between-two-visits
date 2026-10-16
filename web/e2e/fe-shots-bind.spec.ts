/**
 * Pictures for the owner of the three places of binding by account (line bind; web/progress/bind.md): one PNG per state
 * of the walk at 390x844 @2x, and the three places themselves once more at 1440x900 (the computer layout: the page sits
 * in the 430 px column, web/app/desktop.css), into FE_SHOTS_DIR. Not a test of looks, and never part of a default run:
 * without FE_SHOTS_DIR the test here is skipped, so nothing is written anywhere (the approach of e2e/fe-shots.spec.ts).
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/bind PW_PORT=3900 npx playwright test e2e/fe-shots-bind.spec.ts
 *
 * The walk itself is e2e/bind-walk.ts (the checks use the same one: e2e/bind.spec.ts). A screen longer than the phone is
 * also saved whole as <id>-full.png. FE_SHOTS_LANG=en takes the English ones (files end in -en).
 * A later round: FE_SHOTS_SUFFIX=-r2 FE_SHOTS_ONLY=f-removed,link-removed,... saves only those states, as <id>-r2.png.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { clearClock, walkBinding, type WalkLang } from "./bind-walk";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const LANG: WalkLang = process.env.FE_SHOTS_LANG?.trim() === "en" ? "en" : "zh-Hans";
/** FE_SHOTS_SUFFIX=-r2 names a later round's pictures <id>-r2.png, beside the earlier ones. */
const SUFFIX = process.env.FE_SHOTS_SUFFIX?.trim() ?? "";
/** FE_SHOTS_ONLY=f-removed,link-removed: only these states of the walk are saved (a round that changed a few screens). */
const ONLY = new Set((process.env.FE_SHOTS_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));

/** The three places, each also taken at a computer's width. */
const WIDE = new Set(["f-form", "invite-direct", "today-bound"]);

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, id: string): Promise<void> {
  if (ONLY.size && !ONLY.has(id)) return;
  mkdirSync(DIR!, { recursive: true });
  const name = `${LANG === "en" ? `${id}-en` : id}${SUFFIX}`;
  // the Next dev badge sits in the corner
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(DIR!, `${name}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) await page.screenshot({ path: path.join(DIR!, `${name}-full.png`), fullPage: true });
  if (WIDE.has(id)) {
    const phone = page.viewportSize()!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(DIR!, `${name}-1440.png`) });
    await page.setViewportSize(phone);
    await page.waitForTimeout(150);
  }
}

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

test("binding by account: the three places", async ({ browser, request, baseURL }) => {
  await walkBinding(browser, request, baseURL!, { lang: LANG, scale: 2, at: (page, id) => shot(page, id) });
});
