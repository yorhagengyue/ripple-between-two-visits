/**
 * Automatic page checks for Ripple's phone pages (架构审核 「每个页面自动查」): run them on any page a track builds.
 *
 *   import { expectPageChecks } from "./_checks/page-checks";     // from e2e/<file>.spec.ts
 *   await page.goto("/p/today");
 *   await expectPageChecks(page, { side: "elder" });
 *
 * What it asserts:
 * 1. no horizontal scroll at 360px wide (the viewport is narrowed for the check and put back);
 * 2. every visible text is at least the side's minimum: elder (Mr Tan) 18px, family (Wei Ling) 16px — inputs and
 *    placeholders included;
 * 3. every interactive target (links, buttons, inputs, switches, anything focusable) is at least 48x48 (elder) or
 *    44x44 (family);
 * 4. zero axe-core colour-contrast violations (WCAG AA).
 *
 * The side of each element is the nearest [data-rp-side] ancestor ("elder" | "family"; components/ui Screen and
 * components/family-ui FamilyScreen set it), else `options.side`. Exceptions are explicit: pass selectors in
 * `allow` (skipped by checks 2 and 3, and by axe) and say why next to them; anything inside
 * [data-check-allow] is skipped too (the /design gallery marks its fake phone status bar so).
 *
 * Extra checks for pages that claim to follow the phone's text size: checkTextScaling (root font at 200%: text
 * grows with it and nothing scrolls sideways) and checkZoomAllowed (the viewport meta never blocks pinch zoom).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Side = "elder" | "family";

export const SIDE_RULES: Record<Side, { minText: number; minTarget: number }> = {
  elder: { minText: 18, minTarget: 48 },
  family: { minText: 16, minTarget: 44 },
};

/** Always skipped: Next's dev overlay (development only, outside the app's DOM tree) and marked exceptions. */
export const ALWAYS_ALLOW = ["nextjs-portal", "[data-check-allow]"] as const;

export interface PageCheckOptions {
  /** the side for elements outside any [data-rp-side]; default "elder" */
  side?: Side;
  /** selectors exempt from the text, target and contrast checks (say why at the call site) */
  allow?: readonly string[];
  /** only check inside this selector (all checks but the overflow one) */
  scope?: string;
  /** the width for the sideways-scroll check; default 360 */
  overflowWidth?: number;
  /** skip axe (only for a page whose contrast another check already covers) */
  axe?: boolean;
}

export interface PageCheckReport {
  overflow: { width: number; doc: number; body: number; offenders: string[] };
  smallText: string[];
  smallTargets: string[];
  contrast: string[];
  /** axe could not decide (text over images or gradients); listed for a human, not failed */
  contrastIncomplete: string[];
  checkedText: number;
  checkedTargets: number;
}

const allowList = (options: PageCheckOptions) => [...ALWAYS_ALLOW, ...(options.allow ?? [])].join(", ");

/** Sideways scroll at `width`px: how far the page is wider than the viewport, and the widest offenders. */
export async function horizontalOverflow(page: Page, width = 360) {
  const before = page.viewportSize();
  await page.setViewportSize({ width, height: before?.height ?? 844 });
  // let layout (and container queries) settle at the new width
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    return await page.evaluate((w) => {
      const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const body = document.body.scrollWidth - document.documentElement.clientWidth;
      const offenders: string[] = [];
      if (doc > 0 || body > 0) {
        const clipped = (el: Element | null): boolean => {
          for (let p = el?.parentElement; p; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true;
          }
          return false;
        };
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right > w + 0.5 && r.width > 0 && !clipped(el)) {
            const words = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
            offenders.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")} "${words}" right=${r.right.toFixed(0)}`);
            if (offenders.length >= 12) break;
          }
        }
      }
      return { width: w, doc, body, offenders };
    }, width);
  } finally {
    if (before) await page.setViewportSize(before);
  }
}

/** Visible text (and inputs) smaller than its side's minimum. */
export async function textBelowMinimum(page: Page, options: PageCheckOptions = {}) {
  return page.evaluate(
    ({ rules, fallback, allow, scope }) => {
      const out: string[] = [];
      let checked = 0;
      const root = scope ? document.querySelector(scope) : document.body;
      if (!root) return { checked, out: [`scope ${scope} not found`] };
      const sideOf = (el: Element) => ((el.closest("[data-rp-side]")?.getAttribute("data-rp-side") as "elder" | "family" | null) ?? fallback);
      const describe = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const el = node.parentElement;
        if (!el || el.closest("script, style, noscript, template, title, svg")) continue;
        if (el.closest(allow)) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const box = el.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue; // visually hidden (screen-reader text)
        const range = document.createRange();
        range.selectNodeContents(node);
        if (![...range.getClientRects()].some((r) => r.width > 0 && r.height > 0)) continue;
        checked++;
        const px = parseFloat(cs.fontSize);
        const min = rules[sideOf(el)].minText;
        if (px < min - 0.01) out.push(`${px}px < ${min} ${describe(el)} "${text.slice(0, 32)}"`);
      }
      for (const input of root.querySelectorAll("input:not([type=hidden]), textarea, select")) {
        if (input.closest(allow)) continue;
        const cs = getComputedStyle(input);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        checked++;
        const px = parseFloat(cs.fontSize);
        const min = rules[sideOf(input)].minText;
        if (px < min - 0.01) out.push(`${px}px < ${min} ${input.tagName.toLowerCase()} "${(input as HTMLInputElement).placeholder ?? ""}"`);
      }
      return { checked, out };
    },
    { rules: SIDE_RULES, fallback: options.side ?? "elder", allow: allowList(options), scope: options.scope ?? null },
  );
}

/** Interactive targets smaller than their side's minimum. */
export async function targetsBelowMinimum(page: Page, options: PageCheckOptions = {}) {
  return page.evaluate(
    ({ rules, fallback, allow, scope }) => {
      const out: string[] = [];
      let checked = 0;
      const root = scope ? document.querySelector(scope) : document.body;
      if (!root) return { checked, out: [`scope ${scope} not found`] };
      const selector =
        "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=link], [role=checkbox], [role=tab], [role=menuitem], [tabindex]:not([tabindex='-1'])";
      for (const el of root.querySelectorAll(selector)) {
        if (el.closest(allow)) continue;
        if (el.closest("[aria-hidden=true]")) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        checked++;
        const side = (el.closest("[data-rp-side]")?.getAttribute("data-rp-side") as "elder" | "family" | null) ?? fallback;
        const min = rules[side].minTarget;
        if (r.width < min - 0.5 || r.height < min - 0.5) {
          const label = (el.textContent ?? el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
          out.push(`${r.width.toFixed(1)}x${r.height.toFixed(1)} < ${min} ${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")} "${label}"`);
        }
      }
      return { checked, out };
    },
    { rules: SIDE_RULES, fallback: options.side ?? "elder", allow: allowList(options), scope: options.scope ?? null },
  );
}

/** axe-core's colour-contrast rule (WCAG 2 AA) on the page or the scope. */
export async function contrastViolations(page: Page, options: PageCheckOptions = {}) {
  let builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (options.scope) builder = builder.include(options.scope);
  for (const sel of [...ALWAYS_ALLOW, ...(options.allow ?? [])]) builder = builder.exclude(sel);
  const result = await builder.analyze();
  const lines = (list: typeof result.violations) =>
    list.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${(n.any[0]?.message ?? n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 160)}`));
  return { violations: lines(result.violations), incomplete: lines(result.incomplete) };
}

/**
 * Let entrance animations end before measuring: a card fading in has its text half transparent, which axe reads as
 * low contrast. Finite animations jump to their end; endless ones (skeleton breathing) carry no text and stay.
 */
export async function settleAnimations(page: Page) {
  // a page's entrance transition starts a frame after navigation: wait for it, then jump it to its end, then let the
  // style settle one more frame (2026-10-18: axe read a page at half opacity and called every muted line low contrast)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const timing = a.effect?.getComputedTiming();
      if (timing && timing.endTime !== Infinity) a.finish();
    }
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

/** All four checks; returns the report without asserting. */
export async function runPageChecks(page: Page, options: PageCheckOptions = {}): Promise<PageCheckReport> {
  await settleAnimations(page);
  const overflow = await horizontalOverflow(page, options.overflowWidth ?? 360);
  const text = await textBelowMinimum(page, options);
  const targets = await targetsBelowMinimum(page, options);
  const contrast = options.axe === false ? { violations: [], incomplete: [] } : await contrastViolations(page, options);
  return {
    overflow,
    smallText: text.out,
    smallTargets: targets.out,
    contrast: contrast.violations,
    contrastIncomplete: contrast.incomplete,
    checkedText: text.checked,
    checkedTargets: targets.checked,
  };
}

/** All four checks, asserted with messages that name each offender. */
export async function expectPageChecks(page: Page, options: PageCheckOptions = {}): Promise<PageCheckReport> {
  const r = await runPageChecks(page, options);
  expect(r.overflow.doc, `page scrolls sideways at ${r.overflow.width}px: ${r.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
  expect(r.overflow.body, `body wider than ${r.overflow.width}px: ${r.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
  expect(r.smallText, "text under the side's minimum (elder 18px, family 16px)").toEqual([]);
  expect(r.smallTargets, "targets under the side's minimum (elder 48x48, family 44x44)").toEqual([]);
  expect(r.contrast, "axe colour-contrast violations (WCAG AA)").toEqual([]);
  return r;
}

/**
 * The phone's text size: with the root font at `factor` x 16px, text on the page grows by the same factor (sizes
 * are calc(N * var(--rp-u)), and --rp-u follows the root) and the page still does not scroll sideways at 360px.
 * `sample` picks the elements whose growth is measured; the tab bar caps its words at 26px on purpose (five items
 * must fit), so it is left out of the default sample.
 */
export async function checkTextScaling(page: Page, { factor = 2, sample = "[data-rp-side] *", width = 360 } = {}) {
  // elements that hold text themselves (a non-empty text node child), outside the capped tab bar
  const sizes = () =>
    page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter(
            (el) =>
              !el.closest(".rpu-tabs, [data-check-allow], nextjs-portal, svg") &&
              el.getBoundingClientRect().height > 0 &&
              [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""),
          )
          .slice(0, 80)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      sample,
    );
  const base = await sizes();
  await page.evaluate((f) => {
    document.documentElement.style.fontSize = `${16 * f}px`;
  }, factor);
  try {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const scaled = await sizes();
    const ratios = base.map((b, i) => scaled[i] / b);
    const overflow = await horizontalOverflow(page, width);
    return { count: base.length, minRatio: Math.min(...ratios), maxRatio: Math.max(...ratios), overflow };
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
  }
}

/** The viewport meta never blocks pinch zoom (no user-scalable=no, no maximum-scale under 2). */
export async function checkZoomAllowed(page: Page) {
  const content = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
  const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(content);
  return {
    content,
    blocked: /user-scalable\s*=\s*(no|0)/i.test(content) || (max !== null && Number(max[1]) < 2),
  };
}

/** Wait until web fonts settled (Noto Serif SC arrives in unicode-range slices). */
export async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.fonts].every((f) => f.status !== "loading"), undefined, { timeout: 30_000 });
}
