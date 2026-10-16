/**
 * The motion pass (owner 2026-10-14: 「我需要添加大量的切换动画、Hover 动画、点击动画等等……你仿 iOS 的做就可以了」), read from
 * the shipped files. What the owner's users need from it, held here:
 * - calm: no transition or animation longer than 400 ms (the recording dot's slow breath is the one thing that moves by
 *   itself), nothing grows past 1.04, and the press dips are small;
 * - less motion: prefers-reduced-motion turns every dip off and every slide into a fade;
 * - hover only where there is a real pointer;
 * - every phone screen moves between pages without a line of its own: the three screen shells wrap a page's screen in
 *   <PageTransition>, and a link says its way through `nav` (next/link transitionTypes), never as an attribute of a
 *   plain <a>;
 * - app/layout.tsx loads the stylesheet after the foundation's.
 * The motion itself is seen in a browser (videos of the pass); this file is the part that needs none.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UiLink } from "@/components/ui/UiLink";
import { NAV_TYPE, navTypes, SCREEN_NAME, SCREEN_SHARE } from "@/lib/ui/nav-motion";

const WEB = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(WEB, ...parts), "utf8");
const css = read("app", "motion.css").replace(/\/\*[\s\S]*?\*\//g, "");
const explainCss = read("components", "explain", "explain.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every time written in a stylesheet, in ms, with the rule it is in. */
function times(source: string): { ms: number; rule: string }[] {
  const out: { ms: number; rule: string }[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const t of m[2].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) out.push({ ms: t[2] === "s" ? Number(t[1]) * 1000 : Number(t[1]), rule: m[1].trim() });
  }
  return out;
}

describe("calm", () => {
  it("no transition or animation lasts longer than 400 ms, but the breath of her 「正在录」 dot", () => {
    // explain.css: the sheet's own motion (the hold's half-second ring and the coach's demo are the gesture, not the pass's)
    const sheet = times(explainCss).filter((t) => /rpx-(sheet|ground|root)/.test(t.rule));
    expect(sheet.length).toBeGreaterThan(0);
    const long = [...times(css), ...sheet].filter((t) => t.ms > 400);
    expect(long.map((t) => t.rule)).toEqual([".rpf-live i"]);
    // the variables the rules use
    for (const v of ["--rpmo-push", "--rpmo-tab", "--rpmo-sheet", "--rpmo-press-in", "--rpmo-press-out"]) {
      const m = new RegExp(`${v}:\\s*(\\d+)ms`).exec(css);
      expect(m, v).not.toBeNull();
      expect(Number(m![1]), v).toBeLessThanOrEqual(400);
    }
  });

  it("nothing grows past 1.04, and a press only dips a little", () => {
    const scales = [...css.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(scales.length).toBeGreaterThan(0);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.04);
    for (const v of ["--rpmo-dip", "--rpmo-dip-row", "--rpmo-dip-small"]) {
      const m = new RegExp(`${v}:\\s*([\\d.]+);`).exec(css);
      expect(Number(m![1]), v).toBeGreaterThanOrEqual(0.94);
      expect(Number(m![1]), v).toBeLessThan(1);
    }
  });

  it("with less motion nothing dips, and a page that changes fades instead of sliding", () => {
    const reduce = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
    expect(reduce).toMatch(/--rpmo-dip: 1; --rpmo-dip-row: 1; --rpmo-dip-small: 1;/);
    expect(reduce).toMatch(/::view-transition-new\(\.rpmo-pop\) \{ animation: 150ms ease-out both rpmo-fade-in; \}/);
    // the press dips go through the variables only: nothing sets a scale that less motion would not turn off
    expect(css).not.toMatch(/(?<![-\w])scale:\s*\.?\d/);
  });

  it("hover only where there is a real pointer", () => {
    const start = css.indexOf("@media (hover: hover) and (pointer: fine) {");
    expect(start).toBeGreaterThan(0);
    // the block's end: the brace that closes the one the media query opens
    let depth = 0;
    let end = -1;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const hovers = [...css.matchAll(/:hover/g)].map((m) => m.index!);
    expect(hovers.length).toBeGreaterThan(0);
    for (const at of hovers) expect(at > start && at < end, css.slice(Math.max(0, at - 60), at + 6)).toBe(true);
  });
});

describe("between pages", () => {
  it("each way a link goes is a transition type, and a link without one has none", () => {
    expect(navTypes("forward")).toEqual(["nav-forward"]);
    expect(navTypes("back")).toEqual(["nav-back"]);
    expect(navTypes("tab")).toEqual(["nav-tab"]);
    expect(navTypes(undefined)).toBeUndefined();
    // every type has a class the stylesheet animates, and anything else is "none"
    expect(SCREEN_SHARE.default).toBe("none");
    for (const type of Object.values(NAV_TYPE)) {
      const cls = SCREEN_SHARE[type as keyof typeof SCREEN_SHARE];
      expect(css, type).toContain(`::view-transition-new(.${cls})`);
    }
  });

  it("the three screen shells wrap a page's screen (not a /design phone's) in the transition, under one name", () => {
    for (const file of [["components", "ui", "Screen.tsx"], ["components", "family-ui", "FamilyScreen.tsx"], ["components", "auth-ui", "AuthScreen.tsx"]]) {
      expect(read(...file), file.join("/")).toMatch(/return fill === "viewport" \? <PageTransition>\{screen\}<\/PageTransition> : screen;/);
    }
    expect(read("components", "ui", "PageTransition.tsx")).toMatch(/<ViewTransition name=\{SCREEN_NAME\} share=\{SCREEN_SHARE\} default="none"/);
    expect(SCREEN_NAME).toBe("rpmo-screen");
  });

  it("the bottom bars stand still: a name of their own, no animation", () => {
    expect(css).toMatch(/\.rpu-tabs\[data-placement="fixed"\] \{ view-transition-name: rpmo-tabs; \}/);
    expect(css).toMatch(/\.rpf-screen\[data-fill="viewport"\] > \.rpf-tabs \{ view-transition-name: rpmo-ftabs; \}/);
    expect(css).toMatch(/::view-transition-group\(rpmo-tabs\),\s*::view-transition-group\(rpmo-ftabs\) \{ animation: none; z-index: 100; \}/);
    expect(css).toMatch(/::view-transition \{ pointer-events: none; \}/);
  });

  it("a link's way never lands on a plain <a> (tel:, an API address)", () => {
    expect(renderToStaticMarkup(createElement(UiLink, { href: "tel:995", nav: "forward" }, "995"))).toBe('<a href="tel:995">995</a>');
    expect(renderToStaticMarkup(createElement(UiLink, { href: "/p/bp", nav: "forward" }, "血压"))).toBe('<a href="/p/bp">血压</a>');
  });

  it("app/layout.tsx loads the stylesheet once, after the foundation's", () => {
    const imports = read("app", "layout.tsx")
      .split("\n")
      .map((l) => /^import\s+"(\.\/.+\.css)";/.exec(l.trim())?.[1])
      .filter((s): s is string => !!s);
    expect(imports.filter((s) => s === "./motion.css")).toHaveLength(1);
    expect(imports.indexOf("./motion.css")).toBeGreaterThan(imports.indexOf("./ripple-ui.css"));
    expect(imports.indexOf("./motion.css")).toBeGreaterThan(imports.indexOf("./ripple-auth.css"));
  });
});
