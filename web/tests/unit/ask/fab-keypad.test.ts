/**
 * The round Ask button and what is at a page's foot (10-15, found while filming scene 2): standing above the tab bar it
 * covered the blood pressure keypad's bottom-right key, and the screen after a reading's "See this week". The keypad
 * marks itself data-fab="off" and the button's placement (components/ask/AskFab.tsx standOn) draws nothing while such a
 * part is on the page; while it is drawn the page keeps room for it at its foot (ask-fab.css); the screen after a reading
 * no longer has its own "Ask something" (the round button is the way to ask). Rendered on the server, no DOM.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BpKeypad } from "@/components/ui/BpKeypad";

describe("the Ask button and the blood pressure keypad", () => {
  it("the keypad marks itself as a place the button does not float over, in both languages", () => {
    for (const locale of ["en", "zh-Hans"] as const) {
      const html = renderToStaticMarkup(createElement(BpKeypad, { locale }));
      expect(html).toMatch(/data-rp="bp-keypad"[^>]*data-fab="off"/);
    }
  });

  it("the button's placement draws nothing while such a part is on the page", () => {
    const src = readFileSync(path.join(process.cwd(), "components", "ask", "AskFab.tsx"), "utf8");
    const standOn = src.slice(src.indexOf("function standOn()"), src.indexOf("export function AskFab"));
    expect(standOn).toContain(`document.querySelector('[data-fab="off"]')`);
    expect(standOn).toMatch(/return null/);
  });

  it("while the button is drawn, a page with the fixed tab bar keeps room for it at its foot", () => {
    const src = readFileSync(path.join(process.cwd(), "components", "ask", "AskFab.tsx"), "utf8");
    expect(src).toContain(`document.documentElement.setAttribute("data-ask-fab", "shown")`);
    const css = readFileSync(path.join(process.cwd(), "components", "ask", "ask-fab.css"), "utf8");
    expect(css).toMatch(/:root\[data-ask-fab="shown"\] \.rpu-screen\[data-tabbar="fixed"\][^{]*> \.rpu-page \{\s*padding-bottom: calc\(var\(--rpu-bottom\) \+ 18px \+ 72px\);/);
  });

  it("the screen after a reading has no ask button of its own", () => {
    const src = readFileSync(path.join(process.cwd(), "components", "daily", "elder", "BpAccount.tsx"), "utf8");
    expect(src).not.toContain('data-testid="bp-ask"');
    expect(src).toContain('data-testid="bp-back"');
  });

  it("the card after a reading outside the target keeps the button away too: its own hold button is the one to use", () => {
    const src = readFileSync(path.join(process.cwd(), "components", "bp", "BpOutsideTarget.tsx"), "utf8");
    expect(src).toMatch(/data-rp="bp-outside" data-fab="off"/);
  });
});
