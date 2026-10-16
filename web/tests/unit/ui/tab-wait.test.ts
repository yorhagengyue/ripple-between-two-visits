/**
 * The tab bar while a tapped tab's page is on its way (components/ui/TabWait.tsx; the timeline design's 通用-1):
 * what the server draws (nothing new: the bar's markup is what it always was), the words, the two moments, and the
 * rules that make the tapped tab look chosen. What a tap does in the browser is in e2e/real-daily.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TabBar } from "@/components/ui";
import { TAB_WAIT_SHOW_MS, TAB_WAIT_SLOW_MS, TabProbe, TabWaitScope } from "@/components/ui/TabWait";
import { TAB_HREFS, TAB_KEYS, uiCopy } from "@/lib/ui/copy";

const WEB = path.resolve(__dirname, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(WEB, file), "utf8");

describe("TabBar: a tapped tab whose page is on its way", () => {
  it("idle, the bar is four links, each its icon and its word and nothing else", () => {
    const out = renderToStaticMarkup(createElement(TabBar, { locale: "zh-Hans", active: "today" }));
    expect(out).not.toMatch(/tab-wait|tab-going|role="status"/);
    const links = [...out.matchAll(/<a [^>]*class="rpu-tab"[^>]*>(.*?)<\/a>/g)];
    expect(links.map((m) => m[1].replace(/<svg[\s\S]*?<\/svg>/, "<svg/>"))).toEqual(TAB_KEYS.map((key) => `<svg/><span class="rpu-tab-label">${uiCopy("zh-Hans").tabs[key]}</span>`));
    for (const key of TAB_KEYS) expect(out).toContain(`href="${TAB_HREFS[key]}"`);
    expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it("the scope and the probe draw nothing by themselves", () => {
    const scope = renderToStaticMarkup(createElement(TabWaitScope, { opening: { today: "x" }, slow: "y" }, createElement("i", null, "kept")));
    expect(scope).toBe("<i>kept</i>");
    expect(renderToStaticMarkup(createElement(TabProbe, { tab: "today" }))).toBe("");
  });

  it("the words: Today's own first sentence (the draft's), the other tabs' short one, and the slow sentence", () => {
    const zh = uiCopy("zh-Hans");
    expect([zh.tabOpeningToday, zh.tabOpening, zh.tabSlow]).toEqual(["正在打开今天的记录…", "正在打开……", "还在打开，网络有点慢。"]);
    const en = uiCopy("en");
    expect([en.tabOpeningToday, en.tabOpening, en.tabSlow]).toEqual(["Opening today's record…", "Opening…", "Still opening. The network is a little slow."]);
    const bar = read("components/ui/TabBar.tsx");
    expect(bar).toContain('key === "today" ? copy.tabOpeningToday : copy.tabOpening');
    expect(bar).toContain("<TabWaitScope opening={opening} slow={copy.tabSlow}>");
    expect(bar).toContain("<TabProbe tab={key} />");
  });

  it("nothing is said for a page that arrives within 300 ms; from three seconds on the line says it is slow", () => {
    expect(TAB_WAIT_SHOW_MS).toBe(300);
    expect(TAB_WAIT_SLOW_MS).toBe(3000);
  });

  it("only the slow sentence is announced (the site's own mark already says 「正在打开……」 to a screen reader)", () => {
    const src = read("components/ui/TabWait.tsx");
    expect(src).toContain('{stage === "slow" ? <span role="status">{slow}</span> : <span aria-hidden="true">{opening}</span>}');
  });

  it("the rules: the tapped tab looks chosen, the page he is leaving no longer, and the line stands over the bar at 18px", () => {
    const css = read("app/ripple-ui.css");
    expect(css).toContain(".rpu-tab-going { display: none; }");
    expect(css).toContain(".rpu-tab:has(> .rpu-tab-going) { font-weight: 800; color: var(--rp-accent); box-shadow: inset 0 4px 0 var(--rp-accent); }");
    expect(css).toContain('.rpu-tabs:has(.rpu-tab-going) .rpu-tab[aria-current="page"]:not(:has(> .rpu-tab-going)) { font-weight: 500; color: var(--rp-ink-3); box-shadow: none; }');
    const line = /\.rpu-tabs-wait \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(line).toContain("position: absolute;");
    expect(line).toContain("bottom: 100%;");
    expect(line).toContain("font-size: var(--rp-fs-min);");
    // no fixed element of its own: it lives inside the bar, which the computer layout already keeps in the column
    expect(line).not.toMatch(/position:\s*fixed|vw/);
    // Today's 「按一下说」 bar stands where the line goes: for that moment it gives the place up, whole
    expect(css).toContain('.rpu-screen:has(> .rpu-tabs > .rpu-tabs-wait) .rpu-say[data-placement="fixed"] { visibility: hidden; }');
  });
});
