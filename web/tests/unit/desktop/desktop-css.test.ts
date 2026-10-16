/**
 * The phone pages on a computer (app/desktop.css, components/desktop; owner 2026-10-11), read from the shipped files:
 * - nothing changes below 720px, on paper, or on a page made for a computer: every rule but the one that hides the
 *   note sits inside `@media screen and (min-width: …)`, and every rule of the 720px block is scoped to a document
 *   that holds a phone column;
 * - the stylesheet and components/desktop/column.ts (which the note and e2e/fe-desk.spec.ts read) say the same:
 *   the selectors, the two widths, the column's 430 units, the note's place;
 * - no vw (a classic scrollbar is inside 100vw), no rule that styles or asks about Wei Ling's .rpf-* classes, only
 *   .rpdesk-* classes of its own, only tokens that app/ripple-ui.css defines;
 * - the note's greys are readable on both stages (AA);
 * - the note's words repeat nothing a page says (the list in components/desktop/copy.ts), in both languages;
 * - app/layout.tsx imports the stylesheet right after the foundation's and mounts the note once.
 *
 * The measuring is e2e/fe-desk.spec.ts; this file is the part that needs no browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESK_COLUMN,
  DESK_COLUMN_DARK,
  DESK_COLUMN_UNITS,
  DESK_FAMILY_COLUMN,
  DESK_FIXED_BARS,
  DESK_FIXED_MARK,
  DESK_MEDIA,
  DESK_MIN_WIDTH,
  DESK_NOTE_GAP,
  DESK_NOTE_MEDIA,
  DESK_NOTE_MIN_WIDTH,
  DESK_NOTE_UNITS,
  DESK_PHONE_PAGE,
  DESK_STRIP,
} from "@/components/desktop/column";
import { DESK_COPY, DESK_COPY_AVOIDS, deskCopy, deskLocale, type DeskLocale } from "@/components/desktop/copy";
import { contrastRatio } from "@/lib/ui/contrast";

const WEB = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(WEB, ...parts), "utf8");
const css = read("app", "desktop.css").replace(/\/\*[\s\S]*?\*\//g, "");
const foundation = read("app", "ripple-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The statements at one level of a stylesheet: what stands before each `{` and what is between it and its `}`. */
function blocks(text: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let head = "";
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) {
        head = squash(text.slice(start, i));
        open = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push({ head, body: text.slice(open, i) });
        start = i + 1;
      }
    }
  }
  expect(depth, "braces balance").toBe(0);
  expect(squash(text.slice(start)), "nothing after the last block").toBe("");
  return out;
}

const top = blocks(css);
const media = (query: string) => {
  const found = top.filter((b) => b.head === `@media ${query}`);
  expect(found.length, `one @media ${query} block`).toBe(1);
  return blocks(found[0].body);
};
const declarations = (body: string) =>
  Object.fromEntries(
    body
      .split(";")
      .map((d) => squash(d))
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );

describe("nothing changes below 720px, on paper, or on a page made for a computer", () => {
  it("the stylesheet is the rule that hides the note and two screen-and-min-width blocks", () => {
    expect(top.map((b) => b.head)).toEqual([".rpdesk-note", `@media ${DESK_MEDIA}`, `@media ${DESK_NOTE_MEDIA}`]);
    expect(declarations(top[0].body)).toEqual({ display: "none" });
    expect(DESK_MEDIA).toBe("screen and (min-width: 720px)");
    expect(DESK_NOTE_MEDIA).toBe("screen and (min-width: 1100px)");
    expect([DESK_MIN_WIDTH, DESK_NOTE_MIN_WIDTH]).toEqual([720, 1100]);
  });

  it("every rule of the 720px block is scoped to a document that holds a column, and they are exactly the contract's", () => {
    const has = `html:has(${DESK_COLUMN})`;
    const rules = media(DESK_MEDIA);
    expect(rules.map((r) => r.head)).toEqual([
      `${has} body`,
      `html:has(${DESK_COLUMN_DARK}) body`,
      DESK_COLUMN,
      DESK_COLUMN_DARK,
      `${has} ${DESK_STRIP}`,
      `${has} ${DESK_FIXED_BARS}`,
      `${has} ${DESK_FIXED_MARK}`,
    ]);
    // no rule is left that could match on a page without a column
    for (const r of rules) expect(r.head.includes(DESK_COLUMN) || r.head.includes(DESK_COLUMN_DARK), r.head).toBe(true);
  });

  it("the 1100px block styles only the note's own classes", () => {
    for (const r of media(DESK_NOTE_MEDIA)) expect(r.head, r.head).toMatch(/^\.rpdesk-note(?:-[a-z]+)?(?:\[data-stage="dark"\](?: \.rpdesk-note-[a-z]+)?)?$/);
  });

  it("a column is the foundation's screen or a marked root, never a container's screen or one inside the old demo frame", () => {
    expect(DESK_COLUMN).toBe(':is(.rpu-screen, [data-rp-phone]):not([data-fill="container"]):not(.rp-patient *)');
    expect(DESK_COLUMN_DARK).toBe('[data-rp-phone="dark"]:not([data-fill="container"]):not(.rp-patient *)');
    expect(DESK_PHONE_PAGE).toBe(`${DESK_COLUMN}, ${DESK_FAMILY_COLUMN}`);
    // the bars are the four the foundation fixes to the bottom of the phone; its static and absolute variants stay out
    for (const sel of ['.rpu-tabs:not([data-placement="absolute"], [data-placement="static"])', '.rpu-say[data-placement="fixed"]', ".rpu-typedock", '.rpu-toast[data-placement="fixed"]']) {
      expect(DESK_FIXED_BARS.includes(sel), sel).toBe(true);
    }
    // … and every one of them is still fixed in the foundation (a rename there must be followed here)
    for (const cls of [".rpu-tabs", ".rpu-typedock", '.rpu-say[data-placement="fixed"]', '.rpu-toast[data-placement="fixed"]']) {
      const rule = [...foundation.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").some((s) => squash(s) === cls));
      expect(rule.some((m) => /position:\s*fixed/.test(m[2])), `${cls} is position: fixed in app/ripple-ui.css`).toBe(true);
    }
  });
});

describe("the column, the bars and the note are one geometry", () => {
  const rules = Object.fromEntries(media(DESK_MEDIA).map((r) => [r.head, declarations(r.body)]));
  const note = Object.fromEntries(media(DESK_NOTE_MEDIA).map((r) => [r.head, declarations(r.body)]));
  const units = `calc(${DESK_COLUMN_UNITS} * var(--rp-u))`;

  it("the column is 430 units wide, never wider than the window, in the middle; the strip above it the same", () => {
    for (const sel of [DESK_COLUMN, `html:has(${DESK_COLUMN}) ${DESK_STRIP}`]) {
      expect(rules[sel].width, sel).toBe(units);
      expect(rules[sel]["max-width"], sel).toBe("100%");
      expect(rules[sel]["margin-inline"], sel).toBe("auto");
    }
  });

  it("the fixed bars keep left 0 and right 0 and get the column's width with auto margins (the same box, no vw)", () => {
    const bars = rules[`html:has(${DESK_COLUMN}) ${DESK_FIXED_BARS}`];
    expect(bars).toEqual({ left: "0", right: "0", width: "auto", "max-width": units, "margin-inline": "auto" });
    const marked = rules[`html:has(${DESK_COLUMN}) ${DESK_FIXED_MARK}`];
    expect(marked).toEqual({ left: "0 !important", right: "0 !important", width: "auto !important", "max-width": `${units} !important`, "margin-inline": "auto !important" });
  });

  it("the stages are the foundation's light tint and her page colour; the edge is a one-pixel line in each", () => {
    expect(rules[`html:has(${DESK_COLUMN}) body`]).toEqual({ background: "var(--rp-tint)" });
    expect(rules[`html:has(${DESK_COLUMN_DARK}) body`]).toEqual({ background: "var(--rpf-page)" });
    expect(rules[DESK_COLUMN]["box-shadow"]).toBe("0 0 0 1px var(--rp-line)");
    expect(rules[DESK_COLUMN_DARK]).toEqual({ "box-shadow": "0 0 0 1px var(--rpf-hair-2)" });
  });

  it("the note stands half a column and the gap to the right of the middle, as wide as DeskNote.tsx reckons", () => {
    expect(note[".rpdesk-note"].position).toBe("fixed");
    expect(note[".rpdesk-note"].left).toBe(`calc(50% + ${DESK_COLUMN_UNITS / 2} * var(--rp-u) + ${DESK_NOTE_GAP}px)`);
    expect(note[".rpdesk-note"].width).toBe(`calc(${DESK_NOTE_UNITS} * var(--rp-u))`);
    // the app's smallest text size, never smaller (the page checks hold every phone page to 18px)
    expect(note[".rpdesk-note"]["font-size"]).toBe("var(--rp-fs-min)");
  });
});

describe("what the stylesheet may not do", () => {
  it("no viewport units for widths (100vw includes a classic scrollbar)", () => {
    expect(css).not.toMatch(/\d(?:\.\d+)?\s*(?:d|s|l)?v(?:w|i|min|max)\b/);
  });

  it("no rule styles or asks about her .rpf-* classes; no .rpu-* class is declared beyond the contract's", () => {
    expect(css).not.toMatch(/\.rpf\b|\.rpf-/);
    const classes = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));
    // (decimals such as .5 never appear; what is left are class names)
    expect([...classes].sort()).toEqual(["rp-due", "rp-patient", "rpdesk-note", "rpdesk-note-lead", "rpdesk-note-qr", "rpdesk-note-text", "rpu-say", "rpu-screen", "rpu-tabs", "rpu-toast", "rpu-typedock"]);
  });

  it("declares no variable of the foundation's, and uses only tokens app/ripple-ui.css defines", () => {
    const declared = [...css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(declared.filter((v) => !v.startsWith("--rpdesk-"))).toEqual([]);
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const v of used) expect(new RegExp(`(?<![\\w-])${v}\\s*:`).test(foundation), `${v} is defined in app/ripple-ui.css`).toBe(true);
  });

  it("important only on an element another line marked for it", () => {
    for (const r of [...media(DESK_MEDIA), ...media(DESK_NOTE_MEDIA)]) {
      if (r.head.endsWith(DESK_FIXED_MARK)) continue;
      expect(r.body, r.head).not.toContain("!important");
    }
  });
});

describe("the note is readable on both stages", () => {
  const hex = (name: string) => {
    const m = new RegExp(`(?<![\\w-])${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(foundation);
    if (!m) throw new Error(`${name} is not a #RRGGBB variable in app/ripple-ui.css`);
    return m[1];
  };
  it("light: --rp-ink-3 on --rp-tint; dark: --rpf-ink-2 on --rpf-page (AA)", () => {
    expect(hex("--rp-tint").toUpperCase()).toBe("#E1E7EE");
    expect(hex("--rpf-page").toUpperCase()).toBe("#05070A");
    expect(contrastRatio(hex("--rp-ink-3"), hex("--rp-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex("--rpf-ink-2"), hex("--rpf-page"))).toBeGreaterThanOrEqual(4.5);
    // the column's line is seen against both the stage and the paper next to it, as a line (not text)
    expect(hex("--rp-line").toUpperCase()).toBe("#D5DCE5");
  });
});

describe("the note's words", () => {
  const locales: DeskLocale[] = ["zh-Hans", "en"];

  it("both languages say the same four things", () => {
    expect(Object.keys(DESK_COPY["zh-Hans"]).sort()).toEqual(Object.keys(DESK_COPY.en).sort());
    for (const l of locales) for (const v of Object.values(DESK_COPY[l])) expect(v.trim().length, `${l}: ${v}`).toBeGreaterThan(3);
    expect(deskCopy("en").lead).toBe(DESK_COPY.en.lead);
  });

  it("repeat nothing a page says: none of the pages' short words, no address, no number", () => {
    for (const l of locales) {
      for (const [key, v] of Object.entries(DESK_COPY[l])) {
        const text = v.toLowerCase();
        for (const word of DESK_COPY_AVOIDS[l]) expect(text.includes(word.toLowerCase()), `${l}.${key} contains 「${word}」`).toBe(false);
        expect(text, `${l}.${key}`).not.toMatch(/ripple|https?:|www\.|\d/);
      }
    }
  });

  it("the language is the page's own lang attribute; anything else is 华语", () => {
    expect(deskLocale("en")).toBe("en");
    expect(deskLocale("en-SG")).toBe("en");
    expect(deskLocale("zh-Hans")).toBe("zh-Hans");
    expect(deskLocale("zh-CN")).toBe("zh-Hans");
    expect(deskLocale(null)).toBe("zh-Hans");
    expect(deskLocale(undefined)).toBe("zh-Hans");
  });
});

describe("how it is mounted", () => {
  const layout = read("app", "layout.tsx");
  const noteSource = read("components", "desktop", "DeskNote.tsx");

  it("app/layout.tsx imports the stylesheet once, after the foundation's, and mounts the note once, after the page", () => {
    const imports = layout
      .split("\n")
      .map((l) => /^import\s+"(\.\/.+\.css)";/.exec(l.trim())?.[1])
      .filter((s): s is string => !!s);
    expect(imports.slice(0, 2)).toEqual(["./globals.css", "./ripple-ui.css"]);
    expect(imports.filter((s) => s === "./desktop.css")).toHaveLength(1);
    // Another line may import a stylesheet of its own beside it (the sign-in pages' ./ripple-auth.css), before or after:
    // either order is right. The rules here are outside every layer and each names the column in full, so a page
    // root's own width and ground (in @layer components, or a plain class) lose to them wherever they stand.
    expect(imports.indexOf("./desktop.css")).toBeGreaterThan(imports.indexOf("./ripple-ui.css"));
    expect(layout.match(/<DeskNote\s*\/>/g)?.length).toBe(1);
    expect(layout.indexOf("{children}")).toBeLessThan(layout.indexOf("<DeskNote"));
  });

  it("the note is a client component that reads the page, not the request: no search params (they would make every page wait), no cookies, no fetch", () => {
    expect(noteSource.trimStart().startsWith('"use client";')).toBe(true);
    const code = noteSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/useSearchParams|document\.cookie|fetch\(|localStorage|sessionStorage/);
    // the code's address is the site's origin plus "/", never the page's path
    expect(code).toContain("`${window.location.origin}/`");
    expect(code).not.toMatch(/location\.(?:href|pathname|search|hash)/);
  });
});
