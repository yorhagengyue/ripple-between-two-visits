/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX */
/**
 * The account header (track C; real-app 2.23 line 306, 4.7 line 993): inside the account's provider every MetaBar
 * carries the language switch 「中 EN」 and the line under the header; outside it (the demo, the filming session,
 * /design, sign-up) a MetaBar is exactly what its props say. Rendered on the server, no DOM.
 *
 * 「中 EN」 is the owner's decision of 2026-10-14 (his draft has no switch in the elder's header): at the top right of
 * every screen, one link back to the same address. The 「我」 circle that stood right of it is gone from his headers
 * (owner, 10-14: 「我」 is the fourth place of his bottom bar, components/ui/TabBar.tsx).
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExampleBanner, ExampleHeaderLine, ExampleLine } from "@/components/today/ExampleBanner";
import { MetaBar, PageHeader } from "@/components/ui";
import { AccountHeaderProvider } from "@/components/ui/AccountHeader";
import type { UiLocale } from "@/lib/ui/tokens";

/** The address on screen (no router in a server render: null, as without this mock). */
const nav = vi.hoisted(() => ({ path: null as string | null, query: "" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => nav.path,
  useSearchParams: () => (nav.path === null ? null : new URLSearchParams(nav.query)),
}));
const at = (path: string | null, query = "") => Object.assign(nav, { path, query });
afterEach(() => void at(null));

const html = (el: ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string) => s.split(needle).length - 1;
const account = (children: ReactElement, example = false, locale: UiLocale = "zh-Hans") =>
  createElement(AccountHeaderProvider, { locale, under: example ? createElement(ExampleHeaderLine, { locale: "zh-Hans" }) : null, children });
/** An account's 「中 EN」 (its own hook: ElderMeta catches taps on the first header's [data-kind="lang"] chip). */
const LANG = 'data-testid="elder-lang"';
/** The switch as it is drawn: the whole <a>, or "" when the header has none. */
const lang = (s: string) => /<a [^>]*data-testid="elder-lang"[^>]*>.*?<\/a>/.exec(s)?.[0] ?? "";

describe("the header of an account's screens", () => {
  it("has nothing at the top right on his account: no 「中 EN」 (owner 10-15: the language is 「我 › 语言」) and no 「我」 (a place of the bar)", () => {
    const bar = createElement(MetaBar, { story: "10月10日 周六 · 早上 9:30", locale: "zh-Hans" });
    const demo = html(bar);
    expect(demo).not.toContain('data-kind="me"');
    expect(demo).not.toContain(LANG);
    expect(demo).not.toContain("example-line");
    const his = html(account(bar));
    expect(his).not.toContain('data-kind="me"');
    expect(his).not.toContain(">我<");
    expect(his).not.toContain(LANG);
    expect(his).not.toContain('data-kind="lang"');
  });

  it("no screen of his has the switch, in either language, wherever it goes back to", () => {
    for (const [path, props, locale] of [
      ["/p/today", { title: "今天" }, "zh-Hans"],
      ["/p/me", { title: "我" }, "zh-Hans"],
      ["/p/profile/language", { title: "语言", back: { href: "/p/me", label: "我" } }, "zh-Hans"],
      ["/p/meds/med-amlodipine", { title: "Amlodipine", back: { href: "/p/meds" } }, "en"],
    ] as const) {
      at(path);
      const out = html(account(createElement(PageHeader, { ...props, locale }), false, locale));
      expect(out, path).not.toContain('data-kind="me"');
      expect(lang(out), path).toBe("");
      expect(out, path).not.toContain("/api/profile/lang");
    }
  });

  it("a header that leaves 「我」 out on purpose has no 「中 EN」 either (the page the doctor reads, a visit being recorded)", () => {
    at("/p/brief");
    const out = html(account(createElement(PageHeader, { title: "简报", back: { href: "/p/questions" }, me: false, locale: "zh-Hans" })));
    expect(out).not.toContain('data-kind="me"');
    expect(out).not.toContain(LANG);
  });

  it("inside the provider no header draws 「我」, even where the page asks; outside it a page's own meHref still decides", () => {
    const back = createElement(MetaBar, { back: { href: "/p/me", label: "我" }, locale: "zh-Hans" });
    expect(html(account(back))).not.toContain('data-kind="me"');
    const elsewhere = createElement(MetaBar, { back: { href: "/p/meds" }, locale: "zh-Hans" });
    expect(html(account(elsewhere))).not.toContain('data-kind="me"');
    const asked = createElement(MetaBar, { locale: "zh-Hans", meHref: "/p/me" });
    expect(html(account(asked))).not.toContain('data-kind="me"');
    expect(count(html(account(asked)), LANG)).toBe(0);
    // outside the provider 「我」 comes as the page asks, without a switch (/design, the demo)
    expect(count(html(asked), 'data-kind="me"')).toBe(1);
    expect(html(asked)).not.toContain(LANG);
  });

  it("on the example account the line sits right under the header, once, whatever the page places itself", () => {
    const page = createElement("div", null, createElement(MetaBar, { back: { href: "/p/today" }, locale: "zh-Hans" }), createElement(ExampleLine, { locale: "zh-Hans" }), createElement(ExampleBanner, { locale: "zh-Hans", introDismissed: true }));
    const his = html(account(page, true));
    expect(count(his, 'data-rp="example-line"')).toBe(1);
    expect(his).toContain("示例资料：陈先生（虚构人物）");
    // under the header: the line follows the top line directly
    expect(his.indexOf('data-rp="example-line"')).toBeGreaterThan(his.indexOf('data-rp="meta"'));
    expect(his.indexOf('data-rp="example-line"')).toBeLessThan(his.indexOf('data-rp="example-banner"'));
    // his own data: no line; and a page outside the provider that places the line itself still shows it (once)
    expect(html(account(createElement(MetaBar, { back: { href: "/p/today" }, locale: "zh-Hans" }), false))).not.toContain('data-rp="example-line"');
    expect(count(html(createElement("div", null, createElement(ExampleLine, { locale: "zh-Hans" }))), 'data-rp="example-line"')).toBe(1);
  });

  it("the example line is under Today's header too (owner 10-14: Today opens on his month), not on the page it leads to", () => {
    const today = createElement(PageHeader, { title: "今天", subtitle: "10月14日 周三 · 早上 9:30", locale: "zh-Hans" });
    at("/p/today");
    expect(count(html(account(today, true)), 'data-rp="example-line"')).toBe(1);
    at("/p/me/example");
    expect(html(account(today, true))).not.toContain('data-rp="example-line"');
  });
});
