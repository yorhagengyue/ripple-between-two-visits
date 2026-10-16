/**
 * The site-wide pieces of front-end line fe-12, without a browser: the words of the not-found page, of the screen for
 * a page that could not be drawn and of the mark that shows a page is on its way (one plain sentence each: never a
 * code, never a fault's own text, never an apology); the fault screen rendered on the server (what it says for a store
 * fault and for any other, that it leans on nothing of the app, the elder floor of 18px text and 48px targets); where
 * its second button leads; which pages get the navigation mark and which page changes start it; that no loading
 * boundary covers a whole side of the app; and the offline note's sentence split without a changed character. (The
 * same screen as the proxy sends it is tests/unit/site/proxy-page.test.ts.)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { titleAndLine } from "@/components/offline/OfflineNote";
import { allSiteWords, SITE_WORDS, siteWords } from "@/components/site/copy";
import { FaultScreen, isStoreFault, STORE_FAULT_DIGEST, wayOn } from "@/components/site/FaultScreen";
import { NAV_START_EVENT } from "@/components/site/nav-event";
import { GIVE_UP_MS, NOT_PHONE_PAGES, routedDestination, SHOW_AFTER_MS } from "@/components/site/NavProgress";
import { offlineCopy } from "@/lib/offline/copy";
import { STORE_UNAVAILABLE_WORDS, StoreUnavailable } from "@/lib/subject/unavailable";

const WEB = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");
const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** What none of these screens may say: a code, the machinery's words, an apology, a clinical word. */
const NEVER = /\b[45]\d\d\b|错误|出错|故障|异常|代码|抱歉|对不起|不好意思|sorry|apolog|\berror\b|\bfailed\b|oops|exception|not found|找不到|不存在|does not exist|药|血压|medicine/i;

describe("the words", () => {
  it("are plain: no code, no machinery, no apology, nothing clinical, in either language", () => {
    const words = allSiteWords();
    expect(words).toHaveLength(16);
    for (const w of words) {
      expect(w, w).not.toMatch(NEVER);
      expect(w.trim(), w).toBe(w);
      expect(w.length, w).toBeGreaterThan(1);
    }
  });

  it("the not-found sentence says nothing of what was asked for, and does not say whether it exists (real-app 2.25 line 351)", () => {
    expect(SITE_WORDS["zh-Hans"].notFound).toBe("这个地址打不开。");
    expect(SITE_WORDS.en.notFound).toBe("This address cannot be opened.");
    // no place for an address, an id or a name to be put in: the sentence is the whole of it
    for (const l of ["zh-Hans", "en"] as const) expect(SITE_WORDS[l].notFound).not.toMatch(/[{}%$<>]|\d/);
  });

  it("an unknown language reads as 华语, like the rest of the app", () => {
    expect(siteWords("en")).toBe(SITE_WORDS.en);
    for (const l of ["zh-Hans", "zh", "fr", "", null, undefined]) expect(siteWords(l)).toBe(SITE_WORDS["zh-Hans"]);
  });
});

describe("the screen for a page that could not be drawn", () => {
  const store = html(createElement(FaultScreen, { fault: new StoreUnavailable("getPageSubject") }));
  const other = html(createElement(FaultScreen, { fault: Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:5432 password=hunter2"), { digest: "2847561093" }) }));

  it("knows the store's fault by the digest track A gave it, and by nothing else", () => {
    expect(new StoreUnavailable("x").digest).toBe(STORE_FAULT_DIGEST);
    expect(isStoreFault(new StoreUnavailable("x"))).toBe(true);
    // what the browser gets of a server fault in production: a generic Error with the digest
    expect(isStoreFault(Object.assign(new Error("An error occurred in the Server Components render."), { digest: STORE_FAULT_DIGEST }))).toBe(true);
    for (const f of [new Error("boom"), new TypeError("x is not a function"), Object.assign(new Error("x"), { digest: "123" }), { digest: "" }, null, undefined]) expect(isStoreFault(f)).toBe(false);
  });

  it("the records could not be read: track A's fixed sentences, word for word", () => {
    const w = STORE_UNAVAILABLE_WORDS["zh-Hans"];
    expect(store).toContain('data-fault="store"');
    expect(store).toMatch(new RegExp(`<h1[^>]*>${w.title}</h1>`));
    expect(store).toContain(`>${w.body}</p>`);
    expect(store).toMatch(new RegExp(`data-testid="store-unavailable-retry"[^>]*>${w.retry}</button>`));
    expect(text(store)).toBe(`Ripple ${w.title} ${w.body} ${w.retry} ${SITE_WORDS["zh-Hans"].toFront}`);
  });

  it("any other fault: this line's own plain sentence, never 「读不到资料」 and never the fault's own text or digest", () => {
    const w = SITE_WORDS["zh-Hans"];
    expect(other).toContain('data-fault="page"');
    expect(text(other)).toBe(`Ripple ${w.fault.title} ${w.fault.body} ${w.fault.retry} ${w.toFront}`);
    expect(other).not.toContain(STORE_UNAVAILABLE_WORDS["zh-Hans"].title);
    expect(other).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.7|2847561093/);
    expect(store).not.toMatch(/getPageSubject|RIPPLE_STORE/);
    // no fault at all handed over (it should not happen): still the plain sentence
    expect(html(createElement(FaultScreen, {}))).toContain('data-fault="page"');
  });

  it("keeps track A's two hooks, and has a second way on", () => {
    for (const out of [store, other]) {
      expect(out).toMatch(/<main[^>]*data-testid="store-unavailable"/);
      expect(out).toMatch(/<button[^>]*data-testid="store-unavailable-retry"/);
      expect(out).toMatch(/<a href="\/"[^>]*data-testid="fault-way-on"[^>]*data-way="front"/);
    }
  });

  it("the second button: his pages lead to Today, anything else to the front door (which sends a signed-in person on)", () => {
    for (const p of ["/p/today", "/p/visit/v1/review", "/p", "/onboard", "/onboard/clinic"]) expect(wayOn(p), p).toEqual({ way: "today", href: "/p/today" });
    for (const p of ["/", "/f", "/f/week", "/login", "/signup", "/privacy", "/demo", "/pp", "/people", "/onboarding-tips"]) expect(wayOn(p), p).toEqual({ way: "front", href: "/" });
  });

  it("leans on nothing of the app: no class, no app component's hook, every size and colour written on the element", () => {
    for (const out of [store, other]) {
      expect(out).not.toMatch(/\sclass="/);
      expect(out).not.toMatch(/data-rp="/);
      // six styled elements and the screen itself
      expect((out.match(/\sstyle="/g) ?? []).length).toBe(7);
      // every colour is a foundation token with the draft's own value behind it
      const colours = [...out.matchAll(/var\((--rp-[a-z0-9-]+), (#[0-9A-F]{6})\)/g)].map((m) => `${m[1]} ${m[2]}`);
      expect(new Set(colours)).toEqual(
        new Set(["--rp-paper #F2F5F9", "--rp-ink #18202C", "--rp-white #FFFFFF", "--rp-urgent #A4262C", "--rp-ink-2 #2C3644", "--rp-accent #6A4C93", "--rp-on-accent #FFFFFF"]),
      );
      // and no colour outside that list (the first look's #1a1a1a, a bare #fff)
      expect(out.replace(/var\(--rp-[a-z0-9-]+, #[0-9A-F]{6}\)/g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });

  it("the tokens it falls back to are the foundation's own values", () => {
    const css = read("app/ripple-ui.css");
    const value = (name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1].toUpperCase();
    expect([value("--rp-paper"), value("--rp-ink"), value("--rp-white"), value("--rp-urgent"), value("--rp-ink-2"), value("--rp-accent"), value("--rp-on-accent")]).toEqual(["#F2F5F9", "#18202C", "#FFFFFF", "#A4262C", "#2C3644", "#6A4C93", "#FFFFFF"]);
  });

  it("holds the elder floor by itself: no text under 18, both targets 48 or more, sizes that follow the phone's text size", () => {
    for (const out of [store, other]) {
      expect(out).toContain('data-rp-side="elder"');
      const sizes = [...out.matchAll(/font-size:calc\((\d+) \* var\(--rp-u, 0\.0625rem\)\)/g)].map((m) => Number(m[1]));
      expect(sizes.sort((a, b) => a - b)).toEqual([19, 22, 23, 26, 36]);
      expect(out).not.toMatch(/font-size:\s*\d+px/);
      const heights = [...out.matchAll(/min-height:calc\((\d+) \* var\(--rp-u, 0\.0625rem\)\)/g)].map((m) => Number(m[1]));
      expect(heights).toEqual([72, 64]);
    }
  });

  it("is a phone page on a computer too (the desktop column), and says what it is to a screen reader", () => {
    expect(store).toMatch(/<main lang="zh-Hans"[^>]*data-rp-phone=""/);
    expect(store).toMatch(/<div role="alert"/);
    expect((store.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("app/error.tsx and app/global-error.tsx draw it, and 「再试一次」 asks the server again (retry), not only redraws (reset)", () => {
    const boundary = read("app/error.tsx");
    const global = read("app/global-error.tsx");
    for (const src of [boundary, global]) {
      expect(src.startsWith('"use client";')).toBe(true);
      expect(src).toContain("<FaultScreen fault={error} retry={retry ?? reset} />");
    }
    // the one above the root layout brings its own document; the one inside it must not
    expect(global).toMatch(/<html[\s\S]*<body[\s\S]*<FaultScreen/);
    expect(boundary.slice(boundary.lastIndexOf("*/"))).not.toMatch(/<html|<body/);
  });
});

describe("the mark that shows the next page is on its way", () => {
  it("only on the phone pages: none of the pages made for a computer", () => {
    for (const p of ["/demo", "/demo/try", "/how", "/eval", "/director", "/backstage", "/backstage/crew", "/design", "/design/today/taken"]) expect(NOT_PHONE_PAGES.test(p), p).toBe(true);
    for (const p of ["/", "/p/today", "/p/watch", "/f", "/f/week", "/onboard/clinic", "/login", "/signup", "/recover", "/invite/abc", "/privacy", "/designer", "/however", "/demonstration"]) expect(NOT_PHONE_PAGES.test(p), p).toBe(false);
  });

  it("nothing for a page that arrives within 300 ms; gone after 8 s whatever happened", () => {
    expect(SHOW_AFTER_MS).toBe(300);
    expect(GIVE_UP_MS).toBe(8000);
  });

  it("is mounted once, from the root layout, and carries the mark the desktop column looks for", () => {
    const layout = read("app/layout.tsx");
    expect((layout.match(/<NavProgress \/>/g) ?? []).length).toBe(1);
    expect(layout).toContain('import { NavProgress } from "@/components/site/NavProgress";');
    expect(read("components/site/NavProgress.tsx")).toContain("data-rp-phone-fixed");
  });

  it("it stands in for a loading boundary, which would cost a page its 307 and 404: none covers a whole side of the app, and a route has one only when its page neither redirects nor says not-found", () => {
    // a page under a loading boundary sends its redirect() and notFound() after the first bytes: the answer is 200
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(WEB, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (/^loading\.(tsx|ts|jsx|js)$/.test(entry.name)) found.push(`${dir}/${entry.name}`);
      }
    };
    walk("app");
    // the root, his pages, her pages, setting up: a boundary there covers every page under it
    const sides = ["app", "app/p", "app/f", "app/onboard"];
    expect(found.filter((f) => sides.includes(path.posix.dirname(f)))).toEqual([]);
    // a route's own (the prevention and diet screens have one each): its page must not call either itself
    for (const file of found) {
      const page = read(`${path.posix.dirname(file)}/page.tsx`);
      expect(page, `${file}: its page calls redirect() or notFound()`).not.toMatch(/\b(redirect|permanentRedirect|notFound)\(/);
    }
  });

  it("a page change that code starts (router.push after a button, the browser's back) starts it too: another page, not another query", () => {
    const here = new URL("https://ripple.example/p/today?remind=dose-morning");
    // another page of this site
    expect(routedDestination("/p/ask", here, "/p/today")?.pathname).toBe("/p/ask");
    expect(routedDestination("/p/visit/v1/review?from=flow", here, "/p/today")?.pathname).toBe("/p/visit/v1/review");
    expect(routedDestination("https://ripple.example/p/bp", here, "/p/today")?.pathname).toBe("/p/bp");
    // the same page with another query (an undo bar, a language), the same page again
    expect(routedDestination("/p/today", here, "/p/today")).toBeNull();
    expect(routedDestination("/p/today?lang=en", here, "/p/today")).toBeNull();
    expect(routedDestination("?done=skipped", here, "/p/today")).toBeNull();
    // another site, an address that is none
    expect(routedDestination("https://example.org/p/ask", here, "/p/today")).toBeNull();
    expect(routedDestination("http://[", here, "/p/today")).toBeNull();
    // the browser's back: the address is already the page he goes to, the page drawn says where he comes from
    const back = new URL("https://ripple.example/p/today");
    expect(routedDestination("https://ripple.example/p/today", back, "/p/bp")?.pathname).toBe("/p/today");
    expect(routedDestination("https://ripple.example/p/today", back, "/p/today")).toBeNull();
    // the page drawn is not known (it should not happen): the address stands in
    expect(routedDestination("/p/bp", back, null)?.pathname).toBe("/p/bp");
    expect(routedDestination("/p/today", back, null)).toBeNull();
  });

  it("the router's own word reaches it through web/instrumentation-client.ts, which stays one function and one import", () => {
    const src = read("instrumentation-client.ts");
    expect(src).toContain('export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse"): void');
    expect(src).toContain("window.dispatchEvent(new CustomEvent<NavStartDetail>(NAV_START_EVENT, { detail }))");
    // part of every page's first code: nothing of the app but the event's name
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/components/site/nav-event"]);
    expect(read("components/site/nav-event.ts")).not.toMatch(/^import /m);
    expect(NAV_START_EVENT).toBe("rp:nav-start");
    expect(read("components/site/NavProgress.tsx")).toContain("window.addEventListener(NAV_START_EVENT, onRouted)");
  });

  it("the strip takes no room and no tap, and stays in the phone's column", () => {
    const css = read("components/site/nav-progress.css");
    const strip = /\.rp12-nav\s*\{([^}]*)\}/.exec(css)![1];
    expect(strip).toMatch(/position:\s*fixed/);
    expect(strip).toMatch(/left:\s*0/);
    expect(strip).toMatch(/right:\s*0/);
    expect(strip).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe("the offline note's sentence, as a box's title and its line", () => {
  it("is split without a changed character, in both languages", () => {
    for (const l of ["zh-Hans", "en"] as const) {
      const sentence = offlineCopy(l).noNetwork;
      const [title, line] = titleAndLine(sentence);
      expect(title + line).toBe(sentence);
      expect(line.trim().length).toBeGreaterThan(5);
    }
    expect(titleAndLine(offlineCopy("zh-Hans").noNetwork)[0]).toBe("现在没有网络。");
    expect(titleAndLine(offlineCopy("en").noNetwork)[0]).toBe("No connection right now.");
    // a sentence of one stays whole
    expect(titleAndLine("要连上网才能问。")).toEqual(["要连上网才能问。", ""]);
  });
});
