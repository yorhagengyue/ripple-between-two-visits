/**
 * The auth screens' tokens (app/ripple-auth.css: the welcome, log-in, sign-up and recovery pages in the iOS app's
 * look), read from the shipped stylesheet:
 * - two sets of the colour variables: dark is the iOS app's (RippleColor.swift), light is the elder side's ground and
 *   ink (the foundation's tokens in app/ripple-ui.css, value for value); lib/ui/auth-tokens.ts agrees with the CSS;
 * - in both sets every pair that carries text reaches 4.5:1, and rings and the action colour reach 3:1; the one iOS
 *   colour that does not reach it as text (textTertiary) is lightened when it is text and kept as it is for rings;
 * - no rule names a colour: every colour is a variable of the two set blocks, and which set a screen is drawn in is
 *   one value (AUTH_SCHEME), which the screen's mark, the page behind it and the browser's bar all follow;
 * - both sizes of the one set: Wei Ling's is the iOS scale with nothing under 16, Mr Tan's about 1.2 times it with
 *   nothing under 18, targets 48; every text size is written in --rp-u (the phone's text size);
 * - only --rpa-* variables and .rpa-ios-* classes, none shared with the older components/account/account.css;
 * - the logo's paths are the owner's SVG, unchanged, and its draw-in is not played for reduced motion.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOGO_DRAW_SECONDS, LOGO_PATHS, LOGO_VIEW_BOX } from "@/components/auth-ui/logo-paths";
import {
  AUTH_COLOURS,
  AUTH_FLOORS,
  AUTH_LOGO,
  AUTH_PAIRS,
  AUTH_RADII,
  AUTH_RULES,
  AUTH_SCHEME,
  AUTH_SEAM,
  AUTH_SIZES,
  AUTH_TYPE,
  AUTH_TYPE_VAR,
  IOS_TYPE,
  authColour,
  authThemeColor,
  type AuthScheme,
  type AuthSide,
  type AuthTextStyle,
} from "@/lib/ui/auth-tokens";
import { contrastRatio, hexToRgb } from "@/lib/ui/contrast";

const WEB = process.cwd();
const css = readFileSync(path.join(WEB, "app", "ripple-auth.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const SCHEMES: readonly AuthScheme[] = ["dark", "light"];

/** The selector of each set's block, as it is written in the stylesheet. */
const SET_SELECTOR: Record<AuthScheme, RegExp> = {
  dark: /(?:^|\n):root,\s*\.rpa-ios-screen\[data-rp-phone="dark"\]\s*\{([\s\S]*?)\n\}/,
  light: /(?:^|\n)\.rpa-ios-screen\[data-rp-phone="light"\],\s*html:has\(\.rpa-ios-screen\[data-rp-phone="light"\]\)\s*\{([\s\S]*?)\n\}/,
};
/** The paper set at the end, inside @media print: the same elements as the two sets, after them. */
const PAPER_SELECTOR = /@media print\s*\{\s*:root,\s*html:has\(\.rpa-ios-screen\[data-rp-phone\]\),\s*\.rpa-ios-screen\[data-rp-phone\]\s*\{([^}]*)\}/;

/** One set's block: its variables. */
function setBlock(scheme: AuthScheme): string {
  const m = SET_SELECTOR[scheme].exec(cssNoComments);
  if (!m) throw new Error(`the ${scheme} set's block is not in ripple-auth.css`);
  return m[1];
}

function paperBlock(): string {
  const m = PAPER_SELECTOR.exec(cssNoComments);
  if (!m) throw new Error("the paper set's block is not in ripple-auth.css");
  return m[1];
}

const norm = (v: string) => v.replace(/\s+/g, " ").trim().toUpperCase();

function colourVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--rpa-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6}|rgba\([^)]*\))\s*;/g)) out[m[1]] = norm(m[2]);
  return out;
}

const vars: Record<AuthScheme, Record<string, string>> = { dark: colourVars(setBlock("dark")), light: colourVars(setBlock("light")) };
const value = (name: string, scheme: AuthScheme) => {
  const v = vars[scheme][name];
  if (!v) throw new Error(`${name} is not a colour variable of the ${scheme} set in ripple-auth.css`);
  return v;
};

/** fg at alpha over bg, rounded like a browser */
function over(fg: [number, number, number], alpha: number, bg: string): string {
  const b = hexToRgb(bg);
  return `#${fg.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** A variable as the solid colour it is on a ground (an rgba() wash is laid over that ground). */
function solid(name: string, scheme: AuthScheme, ground?: string): string {
  const v = value(name, scheme);
  if (v.startsWith("#")) return v;
  const m = /^RGBA\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(v);
  if (!m) throw new Error(`${name}: ${v} is neither #RRGGBB nor rgba(r, g, b, a)`);
  if (!ground) throw new Error(`${name} is a wash: say which ground it lies on`);
  return over([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), solid(ground, scheme));
}

/** The foundation's tokens (app/ripple-ui.css, its first block), for the light set to be held to. */
function foundationTokens(): Record<string, string> {
  const ui = readFileSync(path.join(WEB, "app", "ripple-ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(ui)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/(--rp-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}

describe("two sets of the colour variables", () => {
  it.each(SCHEMES)("%s: the stylesheet's values are those of lib/ui/auth-tokens.ts, and nothing is in the block that the table does not know", (scheme) => {
    for (const t of AUTH_COLOURS) expect(value(t.name, scheme), `${scheme} ${t.name}`).toBe(norm(t[scheme]));
    expect(Object.keys(vars[scheme]).sort()).toEqual(AUTH_COLOURS.map((t) => t.name).sort());
    expect(authColour("--rpa-bg", scheme)).toBe(value("--rpa-bg", scheme));
    // the block names itself: the screen takes its color-scheme (form controls, scrollbars) from it
    expect(/--rpa-scheme:\s*(\w+);/.exec(setBlock(scheme))?.[1]).toBe(scheme);
  });

  it("the two blocks hold the same variables: a set is the other with other values", () => {
    expect(Object.keys(vars.light).sort()).toEqual(Object.keys(vars.dark).sort());
    expect(Object.keys(vars.dark).length).toBeGreaterThan(20);
    // a dark ground and a light one
    expect(contrastRatio(value("--rpa-bg", "dark"), "#FFFFFF")).toBeGreaterThan(15);
    expect(contrastRatio(value("--rpa-bg", "light"), "#000000")).toBeGreaterThan(15);
  });

  it("dark is RippleColor.swift's, verbatim (ripple-ios RippleApp/DesignSystem)", () => {
    expect(vars.dark).toMatchObject({
      "--rpa-bg": "#0A0C0F", // background
      "--rpa-surface": "#15181C", // surface
      "--rpa-hairline": "RGBA(255, 255, 255, 0.06)", // hairline: white 6%
      "--rpa-field-line": "RGBA(255, 255, 255, 0.06)", // a field's edge at rest is the hairline too
      "--rpa-text": "#F2F5F6", // textPrimary
      "--rpa-text-2": "#9AA1A6", // textSecondary
      "--rpa-dim": "#6A7176", // textTertiary, as it is
      "--rpa-accent": "#37C2BA", // accent
      "--rpa-accent-light": "#5FD4CC", // accentLight
      "--rpa-accent-muted": "RGBA(55, 194, 186, 0.16)", // accentMuted: accent 16%
      "--rpa-on-accent": "#06201E", // onAccent
      "--rpa-warning": "#E6B45A", // warning
    });
    // the views' own numbers: Continue with Email (white 8%, edge white 14%), the code boxes' edge (white 10%), the
    // focused field (accent 75%), the glow and the avatar's ring (accent 35%), AllSetView's tile
    expect(vars.dark).toMatchObject({
      "--rpa-fill-2": "RGBA(255, 255, 255, 0.08)",
      "--rpa-stroke-2": "RGBA(255, 255, 255, 0.14)",
      "--rpa-stroke": "RGBA(255, 255, 255, 0.1)",
      "--rpa-accent-focus": "RGBA(55, 194, 186, 0.75)",
      "--rpa-accent-soft": "RGBA(55, 194, 186, 0.35)",
      "--rpa-surface-2": "#1B1F26",
    });
  });

  it("light is the elder side's own: every value is the foundation's token the table names (app/ripple-ui.css)", () => {
    const ui = foundationTokens();
    expect(Object.keys(ui).length).toBeGreaterThan(15);
    for (const t of AUTH_COLOURS) {
      const token = /--rp-[\w-]+/.exec(t.from)?.[0];
      expect(token, `${t.name}: lib/ui/auth-tokens.ts names no foundation token`).toBeTruthy();
      expect(ui[token!], `${t.name}: ${token} is not a colour of the foundation`).toBeTruthy();
      expect(value(t.name, "light"), `${t.name} mirrors ${token}`).toBe(ui[token!]);
    }
    // what the owner named: paper, ink, and the purple as the action colour
    expect(vars.light).toMatchObject({ "--rpa-bg": "#F2F5F9", "--rpa-text": "#18202C", "--rpa-accent": "#6A4C93", "--rpa-surface": "#FFFFFF", "--rpa-on-accent": "#FFFFFF" });
    // and nothing in it is see-through: on paper every colour is the foundation's solid one
    for (const v of Object.values(vars.light)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });

  describe.each(SCHEMES)("%s", (scheme) => {
    it.each(AUTH_PAIRS.map((p) => [p.fg, p.over ? `${p.bg} over ${p.over}` : p.bg, p.use, p] as const))("%s on %s (%s) reaches 4.5:1", (_fg, _bg, _use, p) => {
      const ground = solid(p.bg, scheme, p.over);
      const ratio = contrastRatio(solid(p.fg, scheme, ground), ground);
      expect(ratio, `${scheme}: ${p.fg} on ${p.bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it("every text colour reaches 4.5:1 on the screen and on the surface", () => {
      for (const t of AUTH_COLOURS.filter((c) => c.role === "text" && c.name !== "--rpa-on-accent")) {
        for (const g of ["--rpa-bg", "--rpa-surface"]) expect(contrastRatio(value(t.name, scheme), value(g, scheme)), `${scheme}: ${t.name} on ${g}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it.each(AUTH_RULES.map((p) => [p.fg, p.bg, p.use] as const))("%s on %s (%s) is seen (3:1)", (fg, bg) => {
      expect(contrastRatio(solid(fg, scheme, bg), value(bg, scheme))).toBeGreaterThanOrEqual(3);
    });
  });

  it("the iOS textTertiary fails AA as text: the dark set's text step is lightened and says so, the iOS value stays for rings", () => {
    expect(contrastRatio("#6A7176", value("--rpa-bg", "dark"))).toBeLessThan(4.5);
    expect(contrastRatio("#6A7176", value("--rpa-surface", "dark"))).toBeLessThan(4.5);
    expect(AUTH_COLOURS.find((c) => c.name === "--rpa-text-3")?.note).toMatch(/AA/);
    expect(AUTH_COLOURS.find((c) => c.name === "--rpa-dim")?.role).toBe("rule");
  });

  it("a ring that is not text sits on a surface in both sets: the tick box has the surface's fill (on paper its ring would not reach 3:1)", () => {
    const box = /\.rpa-ios-check-box\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
    expect(box).toMatch(/border:\s*1\.5px solid var\(--rpa-dim\)/);
    expect(box).toMatch(/background:\s*var\(--rpa-surface\)/);
    expect(contrastRatio(value("--rpa-dim", "light"), value("--rpa-bg", "light"))).toBeLessThan(3);
    expect(contrastRatio(value("--rpa-dim", "light"), value("--rpa-surface", "light"))).toBeGreaterThanOrEqual(3);
  });

  it("no line, wash or ring colour is used for text", () => {
    const notText = AUTH_COLOURS.filter((c) => c.role === "decor" || c.role === "rule" || c.role === "ground").map((c) => c.name);
    for (const name of notText) expect(cssNoComments, name).not.toMatch(new RegExp(`(?<![-\\w])color\\s*:\\s*var\\(${name}\\)`));
  });

  it("what went wrong: the iOS palette's amber in the dark set, the elder side's own error colour in the light one", () => {
    const rule = /\.rpa-ios-error\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
    expect(rule).toMatch(/color:\s*var\(--rpa-warning\)/);
    // dark: amber, and nothing in the set is a red
    const [r, g, b] = hexToRgb(value("--rpa-warning", "dark"));
    expect(r > b && g > b, "amber").toBe(true);
    const isRed = (v: string) => {
      const [rr, gg, bb] = hexToRgb(v);
      return rr > 150 && gg < 120 && bb < 120;
    };
    for (const [name, v] of Object.entries(vars.dark)) if (v.startsWith("#")) expect(isRed(v), `dark ${name} ${v} is a red`).toBe(false);
    // light: the foundation's --rp-urgent, which its own fields say an error in; and it is the only red of the set
    expect(value("--rpa-warning", "light")).toBe(foundationTokens()["--rp-urgent"]);
    expect(Object.entries(vars.light).filter(([, v]) => isRed(v)).map(([name]) => name)).toEqual(["--rpa-warning"]);
  });
});

describe("no rule names a colour", () => {
  const withoutSets = cssNoComments.replace(SET_SELECTOR.dark, "\n").replace(SET_SELECTOR.light, "\n").replace(PAPER_SELECTOR, "@media print {");

  it("the three set blocks are found, and taken out for this check", () => {
    expect(withoutSets.length).toBeLessThan(cssNoComments.length - 1500);
    expect(withoutSets).not.toMatch(/--rpa-bg\s*:/);
  });

  it("outside the set blocks there is no hex, rgb(), hsl() or colour word", () => {
    expect(withoutSets).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutSets).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/);
    expect(withoutSets).not.toMatch(/:\s*(?:white|black|red|gray|grey|teal|purple)\b/);
  });

  it("the paper set for printing only gives the same variables other values, on whichever set the screen is drawn in", () => {
    const paper = paperBlock();
    const names = [...paper.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(3);
    for (const n of names) expect(Object.keys(vars.dark).includes(n) || n === "--rpa-scheme", n).toBe(true);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeGreaterThan(20);
    expect(paper).toMatch(/--rpa-text:\s*#000000/);
    expect(paper).toMatch(/--rpa-bg:\s*#FFFFFF/);
    // it comes after both sets, on the same elements, so its values are the ones that hold on paper
    expect(cssNoComments.indexOf("@media print")).toBeGreaterThan(cssNoComments.search(SET_SELECTOR.light));
  });

  it("the components carry no colour of their own", () => {
    const dir = path.join(WEB, "components", "auth-ui");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(6);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, f).not.toMatch(/\brgba?\(/);
    }
  });
});

describe("only --rpa-* variables and .rpa-ios-* classes", () => {
  const selectors = cssNoComments.replace(/\{[^{}]*\}/g, "{}");
  const classes = [...new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];

  it("every class is .rpa-ios-*", () => {
    expect(classes.length).toBeGreaterThan(40);
    expect(classes.filter((c) => !/^rpa-ios-/.test(c))).toEqual([]);
  });

  it("no class is shared with components/account/account.css (the pages under 「我」 keep their older .rpa-* names)", () => {
    const account = readFileSync(path.join(WEB, "components", "account", "account.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const theirs = new Set([...account.replace(/\{[^{}]*\}/g, "{}").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    expect(theirs.size).toBeGreaterThan(10);
    expect(classes.filter((c) => theirs.has(c))).toEqual([]);
    // their names never start with rpa-ios-, so a class added there later cannot land on one of these
    expect([...theirs].filter((c) => c.startsWith("rpa-ios-"))).toEqual([]);
  });

  it("declares only --rpa-* variables, and --rp-u once: the unit on an iPhone", () => {
    const declared = [...cssNoComments.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(60);
    const others = declared.filter((d) => !d.startsWith("--rpa-"));
    expect(others).toEqual(["--rp-u"]);
  });

  it("app/ripple-ui.css and app/globals.css define none of these", () => {
    for (const f of ["ripple-ui.css", "globals.css"]) {
      const other = readFileSync(path.join(WEB, "app", f), "utf8");
      expect(other, f).not.toMatch(/--rpa-/);
      expect(other, f).not.toMatch(/\.rpa-ios-/);
    }
  });

  it("does not pull in Tailwind a second time, and its component rules sit in @layer components", () => {
    expect(cssNoComments).not.toMatch(/@import\s+["']tailwindcss/);
    expect(cssNoComments).toMatch(/@layer components\s*\{/);
  });
});

describe("two sizes of one set", () => {
  const family = /(?:^|\n)\.rpa-ios-screen\s*\{([^}]*--rpa-fs-large-title[^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
  const elder = /(?:^|\n)\.rpa-ios-screen\[data-rp-side="elder"\]\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
  const blocks: Record<AuthSide, string> = { family, elder };
  const tokenN = (side: AuthSide, name: string): number => {
    const m = new RegExp(`${name}:\\s*calc\\((\\d+(?:\\.\\d+)?) \\* var\\(--rp-u\\)\\)`).exec(blocks[side]);
    if (!m) throw new Error(`${name} is not calc(N * var(--rp-u)) in the ${side} block`);
    return Number(m[1]);
  };

  it("both blocks are there", () => {
    expect(family).toContain("--rpa-h-primary");
    expect(elder).toContain("--rpa-h-primary");
  });

  it.each(["family", "elder"] as const)("%s: the type scale is the table's, written in the unit, and nothing is under the floor", (side) => {
    for (const style of Object.keys(IOS_TYPE) as AuthTextStyle[]) {
      const n = tokenN(side, AUTH_TYPE_VAR[style]);
      expect(n, `${side} ${style}`).toBe(AUTH_TYPE[side][style]);
      expect(n, `${side} ${style}`).toBeGreaterThanOrEqual(AUTH_FLOORS[side].text);
    }
    // every --rpa-fs-* of the block is one of the table's
    const declared = [...blocks[side].matchAll(/(--rpa-fs-[\w-]+)\s*:/g)].map((m) => m[1]).sort();
    expect(declared).toEqual(Object.values(AUTH_TYPE_VAR).sort());
  });

  it("Wei Ling's is the iOS scale; only the three styles under 16 are lifted, to 16", () => {
    for (const style of Object.keys(IOS_TYPE) as AuthTextStyle[]) expect(AUTH_TYPE.family[style], style).toBe(Math.max(IOS_TYPE[style], 16));
    expect((Object.keys(IOS_TYPE) as AuthTextStyle[]).filter((s) => AUTH_TYPE.family[s] !== IOS_TYPE[s])).toEqual(["subheadline", "footnote", "caption"]);
  });

  it("Mr Tan's is one size up: about 1.2 times the iOS scale and never under 18", () => {
    for (const style of Object.keys(IOS_TYPE) as AuthTextStyle[]) {
      const want = Math.max(IOS_TYPE[style] * 1.2, 18);
      expect(Math.abs(AUTH_TYPE.elder[style] - want), `${style}: ${AUTH_TYPE.elder[style]} against ${want.toFixed(1)}`).toBeLessThanOrEqual(1);
    }
    expect(AUTH_TYPE.elder).toMatchObject({ largeTitle: 40, title: 34, headline: 20, body: 20, callout: 19, subheadline: 18, footnote: 18, caption: 18 });
  });

  it.each(["family", "elder"] as const)("%s: heights and boxes are the table's; what he taps is at least the floor", (side) => {
    for (const s of AUTH_SIZES) expect(tokenN(side, s.name), `${side} ${s.name}`).toBe(s[side]);
    for (const name of ["--rpa-hit", "--rpa-h-text-btn", "--rpa-h-primary", "--rpa-h-action", "--rpa-h-secondary", "--rpa-h-field", "--rpa-h-field-icon", "--rpa-h-row", "--rpa-h-code"]) {
      expect(tokenN(side, name), `${side} ${name}`).toBeGreaterThanOrEqual(AUTH_FLOORS[side].target);
    }
  });

  it("Wei Ling's heights are the iOS numbers; Mr Tan's primary is 64, his secondary 60, his text button 48", () => {
    for (const s of AUTH_SIZES) expect(s.family, s.name).toBe(s.iosPt);
    const elderOf = (name: string) => AUTH_SIZES.find((s) => s.name === name)?.elder;
    expect([elderOf("--rpa-h-primary"), elderOf("--rpa-h-action"), elderOf("--rpa-h-secondary"), elderOf("--rpa-h-text-btn"), elderOf("--rpa-hit")]).toEqual([64, 64, 60, 48, 48]);
    for (const s of AUTH_SIZES) expect(s.elder, s.name).toBeGreaterThanOrEqual(s.family);
  });

  it("every font-size is one of the scale's variables; none is a bare px or em", () => {
    const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    let counted = 0;
    for (const [, selector, body] of rules) {
      for (const m of body.matchAll(/(?<![-\w])font-size:\s*([^;]+);/g)) {
        const v = m[1].trim();
        counted++;
        // the light set's own rules take the foundation's sizes for what the setting-up screens have too (below)
        if (/\[data-rp-phone="light"\]/.test(selector) && /^var\(--rp-fs-[\w-]+\)$/.test(v)) continue;
        expect(v, `${selector.trim()} { font-size: ${v} }`).toMatch(/^var\(--rpa-fs-[\w-]+\)$/);
        expect(Object.values(AUTH_TYPE_VAR), v).toContain(v.slice(4, -1));
      }
      // the `font` shorthand would carry a size of its own
      for (const m of body.matchAll(/(?<![-\w])font:\s*([^;]+);/g)) expect(["inherit", "-apple-system-body"], `${selector.trim()} { font: ${m[1]} }`).toContain(m[1].trim());
    }
    expect(counted).toBeGreaterThan(25);
  });

  it("the unit follows iOS Dynamic Type on these screens too", () => {
    expect(cssNoComments).toMatch(/@supports \(font: -apple-system-body\)\s*\{\s*@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*html:has\(\.rpa-ios-screen\)\s*\{[^}]*font: -apple-system-body;[^}]*--rp-u: min\(calc\(1rem \/ 17\), 2\.5px\);/);
  });

  it("the corners are the iOS ones", () => {
    const radius = (selector: string) => {
      const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`(?:^|[\\s,}])${esc}\\s*\\{([^}]*)\\}`).exec(cssNoComments);
      return /border-radius:\s*([\d.]+)px/.exec(m?.[1] ?? "")?.[1];
    };
    expect(radius(".rpa-ios-btn")).toBe(String(AUTH_RADII.control));
    expect(radius('.rpa-ios-btn[data-shape="hero"]')).toBe(String(AUTH_RADII.hero));
    expect(radius('.rpa-ios-btn[data-shape="pill"]')).toBe(String(AUTH_RADII.pill));
    expect(radius(".rpa-ios-input-box")).toBe(String(AUTH_RADII.control));
    expect(radius(".rpa-ios-input-box[data-code]")).toBe(String(AUTH_RADII.code));
    expect(radius(".rpa-ios-choice")).toBe(String(AUTH_RADII.control));
    expect(radius(".rpa-ios-card")).toBe(String(AUTH_RADII.card));
    expect(radius(".rpa-ios-chip")).toBe(String(AUTH_RADII.chip));
    expect(radius(".rpa-ios-tile")).toBe(String(AUTH_RADII.tile));
  });
});

describe("the light set is the elder side's: what the setting-up screens have too is the foundation's own", () => {
  const ui = readFileSync(path.join(WEB, "app", "ripple-ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const uiRoot = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(ui)?.[1] ?? "";
  /** A foundation token's number: `Npx`, or the N of calc(N * var(--rp-u)). */
  const px = (token: string): number => {
    const v = new RegExp(`${token}:\\s*([^;]+);`).exec(uiRoot)?.[1].trim() ?? "";
    const m = /^(?:calc\(([\d.]+) \* var\(--rp-u\)\)|([\d.]+)px)$/.exec(v);
    if (!m) throw new Error(`${token} is not a number in app/ripple-ui.css (${v || "missing"})`);
    return Number(m[1] ?? m[2]);
  };
  /** The body of the rule whose whole selector is this one (not one of a list). */
  const rule = (selector: string): string => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|[{}])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(cssNoComments);
    if (!m) throw new Error(`no rule ${selector} in ripple-auth.css`);
    return m[1];
  };
  const LIGHT = '.rpa-ios-screen[data-rp-phone="light"]';

  it("the table's numbers are the foundation's tokens' (app/ripple-ui.css), at the default text size", () => {
    expect(px(AUTH_SEAM.gutter.token)).toBe(AUTH_SEAM.gutter.px);
    expect(px(AUTH_SEAM.back.size.token)).toBe(AUTH_SEAM.back.size.px);
    for (const b of [AUTH_SEAM.primary, AUTH_SEAM.secondary]) {
      expect(px(b.height.token)).toBe(b.height.px);
      expect(px(b.size.token)).toBe(b.size.px);
      expect(px(b.radius.token)).toBe(b.radius.px);
    }
    expect(px(AUTH_SEAM.error.size.token)).toBe(AUTH_SEAM.error.size.px);
    // the elder floor holds: nothing he reads under 18, nothing he taps under 48
    for (const n of [AUTH_SEAM.back.size.px, AUTH_SEAM.primary.size.px, AUTH_SEAM.secondary.size.px, AUTH_SEAM.error.size.px]) expect(n).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.text);
    for (const n of [AUTH_SEAM.primary.height.px, AUTH_SEAM.secondary.height.px]) expect(n).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.target);
  });

  it("the typeface, the gutter, where the top bar and the last button sit, and the two buttons' heights are the foundation's", () => {
    const vars = rule(LIGHT);
    expect(vars).toMatch(new RegExp(`--rpa-font:\\s*var\\(${AUTH_SEAM.font}\\);`));
    expect(vars).toMatch(new RegExp(`--rpa-gutter:\\s*var\\(${AUTH_SEAM.gutter.token}\\);`));
    expect(vars).toMatch(new RegExp(`--rpa-h-primary:\\s*var\\(${AUTH_SEAM.primary.height.token}\\);`));
    expect(vars).toMatch(new RegExp(`--rpa-h-action:\\s*var\\(${AUTH_SEAM.primary.height.token}\\);`));
    expect(vars).toMatch(new RegExp(`--rpa-h-secondary:\\s*var\\(${AUTH_SEAM.secondary.height.token}\\);`));
    // the page's own padding (app/ripple-ui.css .rpu-page: 4px over the header row) and the foot its dock leaves
    // under the last button (app/onboard/[step]/onboard.css .rpo-dock)
    expect(vars).toMatch(/--rpa-top:\s*4px;/);
    expect(ui).toMatch(/\.rpu-page\s*\{[^}]*padding:\s*4px var\(--rp-gutter\) 18px;/);
    expect(vars).toMatch(/--rpa-foot:\s*max\(34px, calc\(14px \+ env\(safe-area-inset-bottom, 0px\)\)\);/);
    const onboard = readFileSync(path.join(WEB, "app", "onboard", "[step]", "onboard.css"), "utf8");
    expect(onboard).toMatch(/\.rpo-dock\s*\{[^}]*padding:\s*14px var\(--rp-gutter\) max\(34px, calc\(14px \+ env\(safe-area-inset-bottom\)\)\);/);
    // and the page really takes them
    expect(cssNoComments).toMatch(/\.rpa-ios-page\s*\{[^}]*padding:\s*calc\(var\(--rpa-top\) \+ env\(safe-area-inset-top, 0px\)\) var\(--rpa-gutter\) var\(--rpa-foot\);/);
    expect(cssNoComments).toMatch(/\.rpa-ios-screen\s*\{[^}]*font-family:\s*var\(--rpa-font\);/);
  });

  it("the back word is the foundation's (.rpu-back): a bare word in the action colour, its 48px area 6px over the rows around it", () => {
    const back = rule(`${LIGHT} .rpa-ios-nav-btn[data-kind="back"]`);
    expect(back).toMatch(new RegExp(`font-size:\\s*var\\(${AUTH_SEAM.back.size.token}\\);`));
    expect(back).toMatch(new RegExp(`font-weight:\\s*${AUTH_SEAM.back.weight};`));
    expect(back).toMatch(/margin-block:\s*-6px;/);
    expect(back).toMatch(/padding:\s*0 12px 0 0;/);
    expect(back).toMatch(/border:\s*0;/);
    expect(back).toMatch(/background:\s*none;/);
    expect(back).toMatch(/color:\s*var\(--rpa-accent-light\);/);
    expect(rule(`${LIGHT} .rpa-ios-nav`)).toMatch(/min-height:\s*calc\(var\(--rpa-hit\) - 12px\);/);
    // the foundation's own rule, so that a change there is seen here
    const theirs = /\.rpu-back\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "";
    expect(theirs).toMatch(/min-height:\s*var\(--rp-hit\);/);
    expect(theirs).toMatch(/margin:\s*-6px 0;/);
    expect(theirs).toMatch(/padding-right:\s*12px;/);
    expect(theirs).toMatch(/font-size:\s*var\(--rp-fs-small\);/);
    expect(theirs).toMatch(/font-weight:\s*700;/);
    expect(theirs).toMatch(/color:\s*var\(--rp-accent\);/);
  });

  it("the two buttons are the foundation's (.rpu-btn): its corners and its labels, a 2px edge on the second one, no glow", () => {
    const both = /\.rpa-ios-screen\[data-rp-phone="light"\] \.rpa-ios-btn\[data-variant="primary"\],\s*\.rpa-ios-screen\[data-rp-phone="light"\] \.rpa-ios-btn\[data-variant="secondary"\]\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
    expect(both).toMatch(new RegExp(`border-radius:\\s*var\\(${AUTH_SEAM.primary.radius.token}\\);`));
    expect(both).toMatch(/box-shadow:\s*none;/);
    const first = rule(`${LIGHT} .rpa-ios-btn[data-variant="primary"]`);
    expect(first).toMatch(new RegExp(`font-size:\\s*var\\(${AUTH_SEAM.primary.size.token}\\);\\s*font-weight:\\s*${AUTH_SEAM.primary.weight};`));
    const second = rule(`${LIGHT} .rpa-ios-btn[data-variant="secondary"]`);
    expect(second).toMatch(new RegExp(`border-width:\\s*${AUTH_SEAM.secondary.border}px;\\s*font-size:\\s*var\\(${AUTH_SEAM.secondary.size.token}\\);\\s*font-weight:\\s*${AUTH_SEAM.secondary.weight};`));
    // the foundation's own rules
    const theirs = /\.rpu-btn\[data-variant="primary"\]\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "";
    expect(theirs).toMatch(/min-height:\s*var\(--rp-h-primary\);\s*font-size:\s*var\(--rp-fs-action\);\s*font-weight:\s*800;/);
    const base = /\.rpu-btn\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "";
    expect(base).toMatch(/min-height:\s*var\(--rp-h-secondary\);/);
    expect(base).toMatch(/border-radius:\s*var\(--rp-radius-btn\);/);
    expect(base).toMatch(/border:\s*2px solid transparent;/);
    expect(base).toMatch(/font-size:\s*var\(--rp-fs-secondary\);\s*font-weight:\s*700;/);
  });

  it("an error under a field is said as the foundation's fields say it: bold, in its size, the field's edge in its colour", () => {
    const error = rule(`${LIGHT} .rpa-ios-error`);
    expect(error).toMatch(new RegExp(`font-size:\\s*var\\(${AUTH_SEAM.error.size.token}\\);\\s*font-weight:\\s*${AUTH_SEAM.error.weight};`));
    expect(rule(`${LIGHT} .rpa-ios-input-box:has(> .rpa-ios-input[aria-invalid="true"])`)).toMatch(/border-color:\s*var\(--rpa-warning\);/);
    expect(rule(`${LIGHT} .rpa-ios-input-box`)).toMatch(/border-width:\s*1\.5px;/);
    expect(/\.rpu-f-error\s*\{([^}]*)\}/.exec(ui)?.[1] ?? "").toMatch(/font-size:\s*var\(--rp-fs-sub\);[^}]*font-weight:\s*800;\s*color:\s*var\(--rp-urgent\);/);
  });

  it("only rules keyed by the light mark use a foundation token: the dark set stays the iOS app's own", () => {
    const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    let counted = 0;
    for (const [, selector, body] of rules) {
      const tokens = [...body.matchAll(/var\((--rp-(?!u\))[\w-]+)\)/g)].map((m) => m[1]);
      if (!tokens.length) continue;
      counted++;
      expect(selector, `${selector.trim()} uses ${tokens.join(", ")}`).toMatch(/\[data-rp-phone="light"\]/);
    }
    expect(counted).toBeGreaterThan(5);
  });
});

describe("a phone column in a wide window (the desktop layout, app/desktop.css)", () => {
  it("nothing is measured against the window: no vw / vh, no media query on the window's width", () => {
    expect(cssNoComments).not.toMatch(/\d(?:vw|vh|vmin|vmax)\b/);
    const queries = [...cssNoComments.matchAll(/@media\s+([^{]+)\{/g)].map((m) => m[1].trim());
    expect(queries.sort()).toEqual(["(hover: none) and (pointer: coarse)", "(prefers-reduced-motion: no-preference)", "print"]);
    expect(cssNoComments).not.toMatch(/@container/);
    // the screen is as tall as the phone in dvh, and never wider than the column
    expect(cssNoComments).toMatch(/\.rpa-ios-screen\s*\{[^}]*max-width:\s*430px;[^}]*min-height:\s*100dvh;/);
  });

  it("which set a screen is drawn in is one value: the screen's mark comes from AUTH_SCHEME; the page behind it and the browser's bar follow", () => {
    // every face (his side, his family's, and the door both come through) is drawn in a set that is written (the value
    // is not pinned here: changing it is the switch)
    expect(Object.keys(AUTH_SCHEME).sort()).toEqual(["door", "elder", "family"]);
    for (const face of ["elder", "family", "door"] as const) expect(SCHEMES, face).toContain(AUTH_SCHEME[face]);
    // the component takes the mark from that table, and no page writes one
    const screen = readFileSync(path.join(WEB, "components", "auth-ui", "AuthScreen.tsx"), "utf8");
    expect(screen).toMatch(/data-rp-phone=\{AUTH_SCHEME\[side\]\}/);
    for (const page of [
      ["app", "page.tsx"],
      ["app", "who", "page.tsx"],
      ["app", "login", "page.tsx"],
      ["app", "login", "LoginFlow.tsx"],
      ["app", "signup", "page.tsx"],
      ["app", "signup", "SignupFlow.tsx"],
      ["app", "signup", "FamilySignupFlow.tsx"],
      ["app", "recover", "RecoverFlow.tsx"],
    ]) {
      expect(readFileSync(path.join(WEB, ...page), "utf8"), page.join("/")).not.toMatch(/data-rp-phone/);
    }
    // the stylesheet knows a set only by that mark: every selector that names a set names it as data-rp-phone="…"
    const marks = [...cssNoComments.matchAll(/\[data-rp-phone(?:="(\w+)")?\]/g)].map((m) => m[1] ?? "any");
    expect([...new Set(marks)].sort()).toEqual(["any", "dark", "light"]);
    expect(cssNoComments).not.toMatch(/prefers-color-scheme/);
    // behind a screen the page takes that screen's own set's page colour (the document that holds a light screen has
    // the light set too)
    expect(cssNoComments).toMatch(/html:has\(\.rpa-ios-screen\[data-rp-phone\]\) body\s*\{\s*background:\s*var\(--rpa-page\);/);
    // the browser's own bar: the ground of the face's set
    for (const face of ["elder", "family", "door"] as const) expect(authThemeColor(face), face).toBe(value("--rpa-bg", AUTH_SCHEME[face]));
    // and the screen's own colours are the set's: its ground, its ink, its color-scheme
    expect(cssNoComments).toMatch(/\.rpa-ios-screen\s*\{[^}]*background:\s*var\(--rpa-bg\);[^}]*color:\s*var\(--rpa-text\);[^}]*color-scheme:\s*var\(--rpa-scheme\);/);
  });

  it("nothing is position: fixed; the welcome's bottom area is sticky, inside the column", () => {
    expect(cssNoComments).not.toMatch(/position:\s*fixed/);
    expect(cssNoComments).toMatch(/\.rpa-ios-dock\[data-pinned="true"\]\s*\{\s*position:\s*sticky;\s*bottom:\s*0;/);
  });

  it("the logo's side is its own px and at most its container's width", () => {
    expect(cssNoComments).toMatch(/\.rpa-ios-logo\s*\{[^}]*max-width:\s*100%;/);
  });

  it("no component mounts a layer on document.body", () => {
    const dir = path.join(WEB, "components", "auth-ui");
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      // the code, not what a comment says about it
      const src = readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/createPortal|document\.body/);
    }
  });
});

describe("the logo", () => {
  const svg = readFileSync(path.join(WEB, "components", "auth-ui", "assets", "ripple-logo-animated.svg"), "utf8");

  it("its paths are the owner's SVG: the same data, in the same order, with the same delays", () => {
    const paths = [...svg.matchAll(/<path pathLength="1" d="([^"]+)" fill="(#[0-9A-Fa-f]{6})" stroke="#[0-9A-Fa-f]{6}" style="animation-delay:([\d.]+)s,([\d.]+)s"\/>/g)];
    expect(paths.length).toBe(16);
    expect(LOGO_PATHS.length).toBe(16);
    paths.forEach((m, i) => {
      expect(LOGO_PATHS[i].d, `path ${i}`).toBe(m[1]);
      expect(LOGO_PATHS[i].hole, `path ${i}`).toBe(m[2].toUpperCase() === "#000000");
      expect(LOGO_PATHS[i].delay, `path ${i}`).toBe(Number(m[3]));
      expect(Number(m[4]) - Number(m[3]), `path ${i}`).toBeCloseTo(LOGO_DRAW_SECONDS, 6);
    });
    expect(LOGO_VIEW_BOX).toBe(/viewBox="([^"]+)"/.exec(svg)?.[1]);
    // the three counters (p, p, e) come last, over the white letters
    expect(LOGO_PATHS.map((p) => p.hole).lastIndexOf(false)).toBe(12);
  });

  it("is drawn in the scheme's colours: white paths, and the counters in the ground colour", () => {
    expect(cssNoComments).toMatch(/\.rpa-ios-logo path\s*\{[^}]*fill:\s*var\(--rpa-logo\);[^}]*stroke:\s*var\(--rpa-logo\);/);
    expect(cssNoComments).toMatch(/\.rpa-ios-logo path\[data-hole="true"\]\s*\{\s*fill:\s*var\(--rpa-bg\);\s*stroke:\s*var\(--rpa-bg\);/);
  });

  it("draws in with the SVG's own timings, once, and not at all for reduced motion", () => {
    const m = /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.rpa-ios-logo\[data-animated="true"\] path\s*\{([^}]*)\}/.exec(cssNoComments);
    expect(m, "the draw-in is inside a no-preference query").not.toBeNull();
    expect(m![1]).toMatch(/animation:\s*rpa-ios-logo-draw 1\.4s ease forwards, rpa-ios-logo-fill \.5s ease forwards;/);
    expect(m![1]).toMatch(/animation-delay:\s*var\(--rpa-logo-delay, 0s\), calc\(var\(--rpa-logo-delay, 0s\) \+ 1\.4s\);/);
    expect(m![1]).not.toMatch(/infinite/);
    // outside that query a path is the finished mark
    expect(cssNoComments).toMatch(/\.rpa-ios-logo path\s*\{[^}]*fill-opacity:\s*1;[^}]*stroke-width:\s*0;/);
    expect(cssNoComments).toMatch(/@keyframes rpa-ios-logo-draw\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*0;/);
    expect(cssNoComments).toMatch(/@keyframes rpa-ios-logo-fill\s*\{\s*to\s*\{\s*fill-opacity:\s*1;\s*stroke-width:\s*0;/);
    // no other animation in the file
    expect([...cssNoComments.matchAll(/@keyframes ([\w-]+)/g)].map((k) => k[1])).toEqual(["rpa-ios-logo-draw", "rpa-ios-logo-fill"]);
  });

  it("is 210 on the cold start's black screen, 175 on the welcome screen and 150 above a log-in, as SplashView, WelcomeView and SignInView", () => {
    expect(AUTH_LOGO).toEqual({ splash: 210, welcome: 175, login: 150 });
  });
});
