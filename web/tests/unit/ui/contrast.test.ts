/**
 * Ripple UI tokens (app/ripple-ui.css), read from the shipped stylesheet:
 * - elder side (the timeline draft's values, web/progress/fe.md): every text colour reaches 4.5:1 on paper, on white
 *   and on the two tints text sits on; the secondary button's border is ink; #8592A3 is never a text colour; the
 *   hairlines are decoration and never text; there are no speaker colours (the old names are aliases);
 * - fill pairs (white on accent, on ink, on red; the second line on ink; words on the tinted and grey boxes) reach 4.5:1;
 * - daughter side (Zicheng's dark v1, C2 track D): fills as Zicheng's, text steps at 4.5:1 on every ground they sit
 *   on, and the solid hairlines are exactly v1's rgba over the ground;
 * - the CSS and lib/ui/tokens.ts agree; nothing collides with globals.css;
 * - sizes: written as calc(N * var(--rp-u)) so they follow the phone's text size; nothing on the elder side under
 *   18, nothing on the daughter side under 16; filming lifts body text 21 -> 23;
 * - red (--rp-urgent) appears only on 995, deleting and errors; someone else's words are serif at weight 400.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, relativeLuminance } from "@/lib/ui/contrast";
import { COLOURS, FAMILY_BG, FAMILY_COLOURS, FAMILY_PAIRS, FAMILY_TYPE_SCALE, FAMILY_WASHES, FILL_PAIRS, NODE_KINDS, NODE_OF_SOURCE, PAPER, SOURCE_COLOUR, TARGETS, TINTS, TYPE_SCALE } from "@/lib/ui/tokens";

const WEB = process.cwd();
const css = readFileSync(path.join(WEB, "app", "ripple-ui.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function rootBlock(): string {
  const m = /:root\s*\{([\s\S]*?)\n\}/.exec(cssNoComments);
  if (!m) throw new Error(":root block not found in ripple-ui.css");
  return m[1];
}

function hexVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rootBlock().matchAll(/(--rpf?-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}

const vars = hexVars();
const value = (name: string) => {
  const v = vars[name];
  if (!v) throw new Error(`${name} is not a #RRGGBB variable in ripple-ui.css :root`);
  return v;
};

/** fg (hex) at alpha over bg (hex), rounded like a browser */
function over(fg: string, alpha: number, bg: string): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return `#${f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

describe("WCAG maths", () => {
  it("matches the reference points", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(relativeLuminance("#FFFFFF")).toBe(1);
  });
});

describe("elder colours (the timeline draft)", () => {
  it("are the values of lib/ui/tokens.ts and of the draft", () => {
    for (const t of [...COLOURS, ...TINTS]) expect(value(t.name), t.name).toBe(t.value.toUpperCase());
    expect(value("--rp-paper")).toBe(PAPER);
    // D:/ripple-c2/frontend/elder-timeline (Ripple 老人端 · 时间线.dc.html), verbatim
    expect(vars).toMatchObject({
      "--rp-paper": "#F2F5F9",
      "--rp-white": "#FFFFFF",
      "--rp-ink": "#18202C",
      "--rp-ink-2": "#2C3644",
      "--rp-ink-3": "#475263",
      "--rp-line": "#D5DCE5",
      "--rp-line-2": "#C3CCD8",
      "--rp-tint": "#E1E7EE",
      "--rp-edge": "#8592A3",
      "--rp-accent": "#6A4C93",
      "--rp-accent-press": "#4E3672",
      "--rp-accent-soft": "#EEE8F5",
      "--rp-accent-halo": "#E3DAF0",
      "--rp-urgent": "#A4262C",
      "--rp-rec": "#E5484D",
    });
  });

  const textTokens = COLOURS.filter((t) => t.role === "text");
  it.each(textTokens.map((t) => [t.name, t.value] as const))("%s (%s) reaches 4.5:1 on paper, on white and on the two tints", (name) => {
    for (const ground of ["--rp-paper", "--rp-white", "--rp-tint", "--rp-accent-soft"]) {
      expect(contrastRatio(value(name), value(ground)), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the secondary button's border is ink; the light borders belong to small buttons and idle options", () => {
    const rule = (sel: string) => [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");
    expect(rule('.rpu-btn[data-variant="secondary"]')).toMatch(/border-color:\s*var\(--rp-ink\)/);
    expect(contrastRatio(value("--rp-ink"), value("--rp-paper"))).toBeGreaterThanOrEqual(3);
    expect(rule(".rpu-btn")).toMatch(/border:\s*2px solid transparent/);
  });

  it("#8592A3 (--rp-edge) is for lines only: never a text colour, 3:1 against the white it encloses", () => {
    expect(COLOURS.find((t) => t.name === "--rp-edge")?.role).toBe("rule");
    expect(contrastRatio(value("--rp-edge"), value("--rp-white"))).toBeGreaterThanOrEqual(3);
    // too light for text on any ground: no rule may use it as one (svg marks take it through `color`, on .rpu-row svg and the like)
    expect(contrastRatio(value("--rp-edge"), value("--rp-paper"))).toBeLessThan(4.5);
    const asText = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /(?<![-\w])color\s*:\s*var\(--rp-edge\)/.test(m[2])).map((m) => m[1].trim());
    expect(asText.filter((sel) => !/ svg$/.test(sel))).toEqual([]);
    expect(cssNoComments.replace(/--rp-edge:\s*#8592A3/i, "")).not.toMatch(/#8592A3/i);
  });

  it("the hairlines are decoration only and nothing uses them for text", () => {
    for (const name of ["--rp-line", "--rp-line-2"]) {
      expect(COLOURS.find((t) => t.name === name)?.role).toBe("decor");
      expect(contrastRatio(value(name), value("--rp-paper"))).toBeLessThan(3);
      expect(cssNoComments).not.toMatch(new RegExp(`(?<![-\\w])color\\s*:\\s*var\\(${name}\\)`));
    }
  });

  it.each(FILL_PAIRS.map((p) => [p.fg, p.bg, p.use] as const))("%s on %s (%s) reaches 4.5:1", (fg, bg) => {
    const ratio = contrastRatio(value(fg), value(bg));
    expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("there are no speaker colours: the old names are aliases of the accent and of ink, and every kind maps to one of the two", () => {
    const root = rootBlock();
    expect(root).toMatch(/--rp-doctor:\s*var\(--rp-accent\);/);
    expect(root).toMatch(/--rp-pharmacist:\s*var\(--rp-accent\);/);
    expect(root).toMatch(/--rp-family:\s*var\(--rp-ink\);/);
    for (const name of ["--rp-doctor", "--rp-family", "--rp-pharmacist"]) expect(vars[name], `${name} has no colour of its own`).toBeUndefined();
    expect(new Set(Object.values(SOURCE_COLOUR))).toEqual(new Set(["--rp-accent", "--rp-ink"]));
    expect(COLOURS.map((c) => c.name)).not.toEqual(expect.arrayContaining(["--rp-doctor"]));
  });

  it("who said it is a node: every node of the draft has its shape, and every source kind has a node", () => {
    expect(NODE_KINDS).toHaveLength(14);
    for (const node of NODE_KINDS) {
      if (node === "miss" || node === "doc" || node === "unc" || node === "dau") continue; // the default size, set by the border alone
      expect(cssNoComments, node).toContain(`.rpu-node[data-node="${node}"]`);
    }
    for (const node of ["doc", "unc", "dau", "miss"]) expect(cssNoComments, node).toMatch(new RegExp(`\\.rpu-node\\[data-node="${node}"\\] \\{ border:`));
    for (const kind of Object.keys(NODE_OF_SOURCE)) expect(NODE_KINDS).toContain(NODE_OF_SOURCE[kind as keyof typeof NODE_OF_SOURCE]);
  });
});

describe("red is only for 995, deleting and errors", () => {
  it("every rule that uses --rp-urgent is one of them", () => {
    // (10-16: the 995 side of a follow-up question's answers, red-edged and never filled: rpu-act danger-outline)
    const allowed =
      /rpu-emergency|rpu-btn\[data-variant="danger(-outline|-solid)?"\]|rpu-act\[data-variant="danger(-outline)?"\]|rpu-call\[data-urgent|data-node="sos"|data-mk="sos"|rpu-box\[data-variant="red"\]|rpu-f\[data-error="true"\]|rpu-f-error/;
    const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /var\(--rp-urgent\)/.test(m[2]));
    expect(rules.length).toBeGreaterThan(8);
    for (const [, selector] of rules) expect(selector.trim(), selector.trim()).toMatch(allowed);
  });

  it("the recording dot has its own red and nothing else uses it", () => {
    const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /var\(--rp-rec(-halo)?\)/.test(m[2]));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector] of rules) expect(selector.trim(), selector.trim()).toMatch(/rpu-rec|^(0%, 100%|50%)$/);
  });

  it("readings and the blood-pressure fields carry no red", () => {
    for (const sel of [".rpu-reading-num", ".rpu-lcd-val", ".rpu-lcd-row", '.rpu-tl-title[data-size="reading"]']) {
      const block = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes(sel)).map((m) => m[2]).join(";");
      expect(block, sel).not.toMatch(/--rp-urgent|--rp-rec|--rpf-rec/);
    }
  });
});

describe("daughter colours (dark v1, AA)", () => {
  it("are the values of lib/ui/tokens.ts; the fills are Zicheng's v1", () => {
    for (const t of [...FAMILY_COLOURS, ...FAMILY_WASHES]) expect(value(t.name), t.name).toBe(t.value.toUpperCase());
    expect(value("--rpf-bg")).toBe(FAMILY_BG);
    // Ripple C2 进度/素材/2026-10-10-女儿端黑色第二稿.html :root, verbatim
    expect(vars).toMatchObject({ "--rpf-bg": "#0A0C0F", "--rpf-surface": "#15181C", "--rpf-ink": "#F2F5F6", "--rpf-ink-2": "#9AA1A6", "--rpf-teal": "#37C2BA", "--rpf-teal-ink": "#5FD4CC", "--rpf-chk": "#E6B45A", "--rpf-on-teal": "#06201E", "--rpf-on-chk": "#2A1E06", "--rpf-page": "#05070A" });
  });

  it("the hairlines and rules are v1's rgba over the ground, as solid colours axe can measure", () => {
    expect(value("--rpf-hair")).toBe(over("#FFFFFF", 0.07, "#0A0C0F"));
    expect(value("--rpf-hair-2")).toBe(over("#FFFFFF", 0.12, "#0A0C0F"));
    expect(value("--rpf-teal-line")).toBe(over("#37C2BA", 0.45, "#0A0C0F"));
    expect(value("--rpf-doc-line")).toBe(over("#4CB3E6", 0.45, "#0A0C0F"));
    expect(value("--rpf-chk-line")).toBe(over("#E6B45A", 0.45, "#0A0C0F"));
  });

  it("v1's weakest text step failed AA and is the one lightened (and says so)", () => {
    expect(contrastRatio("#6A7176", "#0A0C0F")).toBeLessThan(4.5); // v1 --t3
    expect(FAMILY_COLOURS.find((c) => c.name === "--rpf-ink-3")?.note).toMatch(/AA/);
  });

  it.each(FAMILY_PAIRS.map((p) => [p.fg, p.bg, p.use] as const))("%s on %s (%s) reaches 4.5:1", (fg, bg) => {
    const ratio = contrastRatio(value(fg), value(bg));
    expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("every daughter text colour reaches 4.5:1 on the page and on the raised ground", () => {
    for (const t of FAMILY_COLOURS.filter((c) => c.role === "text")) {
      for (const g of ["--rpf-bg", "--rpf-surface"]) expect(contrastRatio(value(t.name), value(g)), `${t.name} on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the outline of inputs and the dashed rings are seen (3:1)", () => {
    expect(contrastRatio(value("--rpf-edge"), value("--rpf-bg"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(value("--rpf-teal"), value("--rpf-bg"))).toBeGreaterThanOrEqual(3);
  });
});

describe("no collision with globals.css", () => {
  it("declares only --rp-*, --rpu-* and --rpf-* variables", () => {
    const declared = [...cssNoComments.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(40);
    expect(declared.filter((d) => !/^--rp[uf]?-/.test(d))).toEqual([]);
  });

  it("styles only .rpu / .rpu-* and .rpf / .rpf-* classes", () => {
    const selectors = cssNoComments.replace(/\{[^{}]*\}/g, "{}");
    const classes = [...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(60);
    expect([...new Set(classes.filter((c) => !/^rp[uf](-|$)/.test(c)))]).toEqual([]);
  });

  it("globals.css does not define any --rp- variable or .rpu / .rpf class", () => {
    const globals = readFileSync(path.join(WEB, "app", "globals.css"), "utf8");
    expect(globals).not.toMatch(/--rp[uf]?-/);
    expect(globals).not.toMatch(/\.rp[uf]\b|\.rp[uf]-/);
  });

  it("does not pull in Tailwind a second time", () => {
    expect(cssNoComments).not.toMatch(/@import\s+["']tailwindcss/);
  });
});

describe("sizes follow the phone's text size", () => {
  const root = rootBlock();
  const tokenN = (name: string): number => {
    const m = new RegExp(`${name}:\\s*calc\\((\\d+(?:\\.\\d+)?) \\* var\\(--rp-u\\)\\)`).exec(root);
    if (!m) throw new Error(`${name} is not calc(N * var(--rp-u)) in :root`);
    return Number(m[1]);
  };

  /** The design px of a font-size value, or null when it is not one of the written forms. */
  function designPx(v: string): number | null {
    let m = /^var\((--rpf?-fs-[\w-]+)\)$/.exec(v);
    if (m) return tokenN(m[1]);
    m = /^calc\((\d+(?:\.\d+)?) \* var\(--rp-u\)\)$/.exec(v);
    if (m) return Number(m[1]);
    m = /^min\(var\((--rpf?-fs-[\w-]+)\), (\d+)px\)$/.exec(v); // capped (tab bar): the smaller of the two
    if (m) return Math.min(tokenN(m[1]), Number(m[2]));
    return null;
  }

  it("the unit is 1px at the default text size, capped at 2.5px, and follows iOS Dynamic Type on touch screens", () => {
    expect(root).toMatch(/--rp-u:\s*min\(0\.0625rem, 2\.5px\);/);
    expect(cssNoComments).toMatch(/@supports \(font: -apple-system-body\)\s*\{\s*@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*html:has\(\.rpu-screen, \.rpf-screen\)\s*\{[^}]*font: -apple-system-body;[^}]*--rp-u: min\(calc\(1rem \/ 17\), 2\.5px\);/);
  });

  it("the type tokens are the draft's scale (elder) and v3 at 16+ (daughter)", () => {
    const names: Record<Exclude<keyof typeof TYPE_SCALE, "filmingBody">, string> = {
      min: "--rp-fs-min",
      sub: "--rp-fs-sub",
      small: "--rp-fs-small",
      body: "--rp-fs-body",
      row: "--rp-fs-row",
      secondary: "--rp-fs-secondary",
      saidEn: "--rp-fs-said-en",
      saidZh: "--rp-fs-said-zh",
      node: "--rp-fs-node",
      action: "--rp-fs-action",
      drug: "--rp-fs-drug",
      ask: "--rp-fs-ask",
      question: "--rp-fs-question",
      headline: "--rp-fs-headline",
      title: "--rp-fs-title",
      reading: "--rp-fs-reading",
    };
    for (const [key, name] of Object.entries(names)) expect(tokenN(name), name).toBe(TYPE_SCALE[key as keyof typeof names]);
    // the draft: primary 72 high and 26, secondary 64 and 23, the play pill and a row of actions 56; targets at least 48
    expect(tokenN("--rp-h-primary")).toBe(TARGETS.primary);
    expect(tokenN("--rp-h-secondary")).toBe(TARGETS.secondary);
    expect(tokenN("--rp-h-source")).toBe(TARGETS.source);
    expect([TARGETS.primary, TARGETS.secondary, TARGETS.source]).toEqual([72, 64, 56]);
    expect([TYPE_SCALE.action, TYPE_SCALE.secondary]).toEqual([26, 23]);
    expect(tokenN("--rp-hit")).toBe(48);
    expect(root).toMatch(/--rp-gutter:\s*20px;/);
    expect(root).toMatch(/--rp-block-gap:\s*18px;/);
    expect(root).toMatch(/--rp-radius-btn:\s*16px;/);
    expect(tokenN("--rpf-fs-min")).toBe(FAMILY_TYPE_SCALE.min);
    expect(tokenN("--rpf-hit")).toBe(44);
  });

  it("every font-size is written in the unit; none under 18 on the elder side or 16 on the daughter side", () => {
    const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    let counted = 0;
    for (const [, selector, body] of rules) {
      for (const m of body.matchAll(/(?<![-\w])font-size:\s*([^;]+);/g)) {
        const v = m[1].trim();
        if (v === "inherit") continue;
        const px = designPx(v);
        expect(px, `${selector.trim()} { font-size: ${v} } is not written in --rp-u`).not.toBeNull();
        const min = /\.rpf/.test(selector) ? 16 : 18;
        expect(px!, `${selector.trim()}: ${v}`).toBeGreaterThanOrEqual(min);
        counted++;
      }
    }
    expect(counted).toBeGreaterThan(60);
    for (const m of root.matchAll(/(--rp-fs-[\w-]+):\s*calc\((\d+(?:\.\d+)?) /g)) expect(Number(m[2]), m[1]).toBeGreaterThanOrEqual(18);
    for (const m of root.matchAll(/(--rpf-fs-[\w-]+):\s*calc\((\d+(?:\.\d+)?) /g)) expect(Number(m[2]), m[1]).toBeGreaterThanOrEqual(16);
  });

  it("filming lifts body text from 21 to 23 and the default scope puts it back", () => {
    const on = /\[data-filming="true"\]\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
    expect(on).toMatch(/--rp-fs-body:\s*calc\(23 \* var\(--rp-u\)\)/);
    const off = /\[data-filming="false"\]\s*\{([^}]*)\}/.exec(cssNoComments)?.[1] ?? "";
    expect(off).toMatch(/--rp-fs-body:\s*calc\(21 \* var\(--rp-u\)\)/);
  });

  it("the sans and serif stacks keep next/font first (Latin, then Chinese); the mono face is the system's", () => {
    expect(root).toMatch(/--rp-font-sans:\s*var\(--rp-ff-sans,\s*"Noto Sans"\),\s*var\(--rp-ff-sans-zh,\s*"Noto Sans SC"\),\s*"PingFang SC"/);
    expect(root).toMatch(/--rp-font-serif:\s*var\(--rp-ff-serif,\s*"Noto Serif"\),\s*var\(--rp-ff-serif-zh,\s*"Noto Serif SC"\),\s*"Songti SC",\s*serif;/);
    expect(root).toMatch(/--rp-font-mono:\s*ui-monospace,\s*Menlo,\s*Consolas,\s*monospace;/);
  });

  it("loads exactly the draft's weights: sans 400/700/900, serif 400/600 (500 and 800 fall back as they do in the draft)", () => {
    const fonts = readFileSync(path.join(WEB, "lib", "ui", "fonts.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const weights = (family: string) => new RegExp(`${family}\\(\\{\\s*weight:\\s*\\[([^\\]]*)\\]`).exec(fonts)?.[1].replace(/[\s"]/g, "");
    expect(weights("Noto_Sans")).toBe("400,700,900");
    expect(weights("Noto_Sans_SC")).toBe("400,700,900");
    expect(weights("Noto_Serif")).toBe("400,600");
    expect(weights("Noto_Serif_SC")).toBe("400,600");
    // the two Chinese families are not preloaded
    expect((fonts.match(/preload:\s*false/g) ?? []).length).toBe(2);
    expect(fonts).not.toMatch(/Atkinson|Literata/);
  });

  it("someone else's exact words are serif at weight 400 (owner, 10-11)", () => {
    const blocks = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.rpu-said(-zh)?(\[|\s|$)/.test(m[1].trim()));
    expect(blocks.length).toBeGreaterThan(2);
    const base = blocks.find((m) => m[1].trim() === ".rpu-said")?.[2] ?? "";
    expect(base).toMatch(/font-family:\s*var\(--rp-font-serif\)/);
    expect(base).toMatch(/font-weight:\s*400;/);
    for (const [, sel, body] of blocks) {
      const w = /font-weight:\s*(\d+)/.exec(body)?.[1];
      if (w !== undefined) expect(w, sel.trim()).toBe("400");
    }
  });
});
