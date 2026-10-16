/**
 * The store-unavailable page as the proxy sends it (lib/subject/unavailable.ts storeUnavailablePage; 503, before any of
 * the app's CSS), in the timeline design's look (front-end line fe-12; the same screen as components/site/FaultScreen):
 * track A's sentences and answer are unchanged, the first look's black on white is gone, every colour is one of the
 * foundation's own values, nothing is under 18px, and the way back is still only a page of this site.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STORE_UNAVAILABLE_WORDS, storeUnavailablePage } from "@/lib/subject/unavailable";

const WEB = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the same screen as the proxy sends it (503, before any of the app's CSS)", () => {
  const page = (locale: "zh-Hans" | "en", href = "/p/today?remind=dose-morning") => storeUnavailablePage(locale, href).text();

  it("track A's sentences and hooks in the timeline design's look: no colour of the first look, nothing under 18px", async () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const out = await page(locale);
      const w = STORE_UNAVAILABLE_WORDS[locale];
      expect(out).toContain(`<html lang="${locale}">`);
      expect(out).toContain('<main data-testid="store-unavailable" data-rp-side="elder">');
      expect(out).toContain(`<h1>${w.title}</h1>`);
      expect(out).toContain(`<p class="say">${w.body}</p>`);
      expect(out).toContain(`<a class="btn" href="/p/today?remind=dose-morning" data-testid="store-unavailable-retry">${w.retry}</a>`);
      expect(text(out.slice(out.indexOf("<body>")))).toBe(`Ripple ${w.title} ${w.body} ${w.retry}`);
      const css = /<style>([\s\S]*?)<\/style>/.exec(out)![1];
      // the first look's black on white is gone
      expect(css).not.toMatch(/#1a1a1a|#fff\b/i);
      // sizes follow the phone's text size, and none is under 18px at the default
      expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
      const sizes = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
      expect(sizes).toHaveLength(4);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(18);
      // the one button is the draft's filled one, 72 high
      expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*4\.5rem/);
      expect(css).toMatch(/\.btn\s*\{[^}]*background:\s*#6A4C93/);
    }
  });

  it("every colour in it is one of the foundation's own values", async () => {
    const css = read("app/ripple-ui.css");
    const value = (name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1].toUpperCase();
    const tokens = ["--rp-paper", "--rp-ink", "--rp-urgent", "--rp-accent", "--rp-accent-press", "--rp-ink-2", "--rp-white", "--rp-tint", "--rp-line"].map(value);
    expect(tokens).not.toContain(undefined);
    const used = new Set([...(await page("zh-Hans")).matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
    expect([...used].sort()).toEqual([...new Set(tokens as string[])].sort());
  });

  it("still leads back only to a page of this site, and never carries markup from the address", async () => {
    expect(await page("zh-Hans", "//evil.example/x")).toContain('<a class="btn" href="/" ');
    expect(await page("zh-Hans", "https://evil.example/x")).toContain('<a class="btn" href="/" ');
    expect(await page("en", '/p/today?x="><script>alert(1)</script>')).not.toContain("<script>");
  });
});
