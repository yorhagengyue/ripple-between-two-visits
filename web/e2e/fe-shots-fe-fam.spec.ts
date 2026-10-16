/**
 * Screenshots for the owner of his family screens rebuilt after the timeline draft's 16-20 (web/progress/fe-fam.md):
 * one PNG per screen state at 390x844 @2x in 华语, named by the draft's screen id where the draft drew the state, in
 * FE_SHOTS_DIR/16-20/. Not a test of looks, and never part of a default run: without FE_SHOTS_DIR the test here is
 * skipped, so nothing is written anywhere (the approach of e2e/fe-shots.spec.ts).
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3830 npx playwright test e2e/fe-shots-fe-fam.spec.ts
 *
 * The walk itself is e2e/fe-fam-walk.ts (the page checks use the same one: e2e/fe-fam-pages.spec.ts). A screen longer
 * than the phone is also saved whole as <id>-full.png. FE_SHOTS_LANG=en takes the English ones (files end in -en).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { clearClock, walkHisFamily, type WalkLang } from "./fe-fam-walk";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const LANG: WalkLang = process.env.FE_SHOTS_LANG?.trim() === "en" ? "en" : "zh-Hans";
const GROUP = "16-20";

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, GROUP);
  mkdirSync(out, { recursive: true });
  const name = LANG === "en" ? `${id}-en` : id;
  // the Next dev badge sits in the corner
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) await page.screenshot({ path: path.join(out, `${name}-full.png`), fullPage: true });
}

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

test("16-20 家人（他这一边）", async ({ browser, request, baseURL }) => {
  await walkHisFamily(browser, request, baseURL!, { lang: LANG, scale: 2, at: shot });
});
