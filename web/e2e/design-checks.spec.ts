/**
 * The automatic page checks (e2e/_checks/page-checks.ts) on every /design page: the elder gallery, the daughter
 * gallery, the page frames, the composed screens in 华语 and English, and the first gallery's Today states.
 * Each page: no sideways scroll at 360px, text at least 18px (elder) / 16px (daughter), targets at least 48x48 /
 * 44x44, zero axe colour-contrast violations. A few screens also prove the text-size claim: at a 200% root font the
 * text doubles and nothing scrolls sideways; and no page blocks pinch zoom.
 *
 * Screenshots for the owner (not a test of looks): only when DESIGN_SHOTS_DIR is set, e.g.
 *   DESIGN_SHOTS_DIR=D:/ripple-c2/shots/f2 PW_PORT=3420 npx playwright test e2e/design-checks.spec.ts -g shots --output <outside web/>
 * writes 390x844 @2x PNGs of every composed screen, each gallery block at 390 wide, and the galleries at 1440.
 * Without the variable those tests are skipped, so a full e2e run never writes anywhere.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { checkTextScaling, checkZoomAllowed, expectPageChecks, fontsReady } from "./_checks/page-checks";

const SCREENS = [
  "elder-today-pending",
  "elder-today-done",
  "elder-today-reason",
  "elder-hero",
  "elder-bp",
  "elder-review",
  "elder-consent",
  "elder-recording",
  "family-home",
  "family-recorder",
  "family-noreply",
  "family-shared",
  "family-invite",
] as const;

const GALLERIES = [
  { path: "/design", side: "elder" as const },
  { path: "/design/family", side: "family" as const },
  { path: "/design/frames", side: "elder" as const },
  { path: "/design/screens", side: "elder" as const },
];

/** The Next dev-tools badge sits on the tab bar in screenshots. */
async function hideDevBadge(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function open(page: Page, url: string) {
  const res = await page.goto(url);
  expect(res?.status(), url).toBe(200);
  await fontsReady(page);
}

test.describe("page checks", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const g of GALLERIES) {
    test(`${g.path}: 360 no sideways scroll, text, targets, contrast`, async ({ page }) => {
      test.setTimeout(180_000);
      await open(page, g.path);
      const r = await expectPageChecks(page, { side: g.side });
      expect(r.checkedText, "the gallery has text to check").toBeGreaterThan(100);
      expect(r.checkedTargets, "the gallery has targets to check").toBeGreaterThan(20);
    });
  }

  for (const name of SCREENS) {
    for (const lang of ["zh", "en"] as const) {
      test(`/design/screens/${name} (${lang})`, async ({ page }) => {
        test.setTimeout(90_000);
        await open(page, `/design/screens/${name}${lang === "en" ? "?lang=en" : ""}`);
        const r = await expectPageChecks(page, { side: name.startsWith("family") ? "family" : "elder" });
        expect(r.checkedText).toBeGreaterThan(5);
      });
    }
  }

  for (const state of ["m1", "m2", "m3"]) {
    test(`/design/today/${state}`, async ({ page }) => {
      await open(page, `/design/today/${state}`);
      await expectPageChecks(page, { side: "elder" });
    });
  }
});

test.describe("text follows the phone's text size", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const name of ["elder-today-pending", "elder-hero", "elder-bp", "family-home"] as const) {
    test(`${name}: at a 200% root font, text doubles and nothing scrolls sideways at 360`, async ({ page }) => {
      await open(page, `/design/screens/${name}`);
      const s = await checkTextScaling(page, { factor: 2 });
      expect(s.count, "sampled text").toBeGreaterThan(3);
      expect(s.minRatio, "every sampled text grew with the root").toBeGreaterThanOrEqual(1.95);
      expect(s.overflow.doc, `sideways scroll at 200%: ${s.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
    });
  }

  test("the iOS text-size hook survives the CSS build", async ({ page }) => {
    await open(page, "/design/screens/elder-today-pending");
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
          // a cross-origin sheet (fonts) cannot be read; it holds no rule of ours
        }
      }
      return {
        supports: texts.some((t) => /^@supports\s*\(\s*font:\s*-apple-system-body\s*\)/.test(t)),
        unit: texts.some((t) => /:has\(\.rpu-screen/.test(t) && /--rp-u\s*:/.test(t)),
      };
    });
    expect(hook).toEqual({ supports: true, unit: true });
  });

  test("no page blocks pinch zoom", async ({ page }) => {
    await open(page, "/design/screens/elder-today-pending");
    const z = await checkZoomAllowed(page);
    expect(z.blocked, `viewport meta: ${z.content}`).toBe(false);
  });
});

test.describe("shots", () => {
  const DIR = process.env.DESIGN_SHOTS_DIR?.trim();
  test.skip(!DIR, "DESIGN_SHOTS_DIR is not set: no screenshots are written");

  test("composed screens at 390x844 @2x, 华语 and English", async ({ browser }) => {
    test.setTimeout(600_000);
    const out = path.join(DIR!, "screens");
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      for (const name of SCREENS) {
        for (const lang of ["zh", "en"] as const) {
          await open(page, `/design/screens/${name}${lang === "en" ? "?lang=en" : ""}`);
          await hideDevBadge(page);
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(out, `${name}${lang === "en" ? "-en" : ""}-390x844@2x.png`), animations: "disabled" });
        }
      }
    } finally {
      await context.close();
    }
  });

  test("every gallery block at 390 wide (the component sheets)", async ({ browser }) => {
    test.setTimeout(900_000);
    const out = path.join(DIR!, "components");
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      for (const g of [
        { path: "/design", prefix: "elder" },
        { path: "/design/family", prefix: "family" },
        { path: "/design/frames", prefix: "frames" },
      ]) {
        await open(page, g.path);
        await hideDevBadge(page);
        const blocks = page.locator(".rpd-component, .rpd-section");
        const n = await blocks.count();
        for (let i = 0; i < n; i++) {
          const block = blocks.nth(i);
          const id = (await block.getAttribute("id")) ?? `block-${i}`;
          // a section that holds component blocks is shot block by block instead
          if ((await block.locator(".rpd-component").count()) > 0) continue;
          await block.scrollIntoViewIfNeeded();
          await block.screenshot({ path: path.join(out, `${g.prefix}-${id}.png`), animations: "disabled" });
        }
      }
    } finally {
      await context.close();
    }
  });

  test("the galleries as whole pages at 1440", async ({ browser }) => {
    test.setTimeout(600_000);
    const out = path.join(DIR!, "pages");
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      for (const g of GALLERIES) {
        await open(page, g.path);
        await hideDevBadge(page);
        await page.waitForTimeout(300);
        const name = g.path === "/design" ? "design-elder" : `design-${g.path.split("/").pop()}`;
        await page.screenshot({ path: path.join(out, `${name}-1440-full.png`), fullPage: true, animations: "disabled" });
      }
    } finally {
      await context.close();
    }
  });
});
