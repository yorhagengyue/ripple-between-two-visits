/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX: the props types require `children`, so it goes in props */
/**
 * The way in (line fe-entry; web/progress/fe-entry.md): the cold start over the welcome, 「你是哪一位？」, and each
 * side's log-in and sign-up. What a browser cannot show cheaply is held here, from the sources:
 * - whose page an address is (`as`, else what `next` implies, else the elder's) and the addresses between these pages;
 * - the words of 「你是哪一位？」, as the owner's brief has them, in both languages;
 * - the cold start: its length is the mark's own, its two colours are its own, it is drawn only by its animation and
 *   only without reduced motion, it covers its screen and no more, and its one script marks a second visit;
 * - what the server sends for it (the layer is in the HTML, hidden from assistive technology, after the welcome);
 * - the pages: the door leads to /who and its mark is still, the log-in plays its mark once and has the small link to
 *   the other side, her sign-up makes an account with no space of its own, her logout lands on her log-in.
 * The colours, sizes and marks of the set of parts are in auth-contrast.test.ts and auth-components.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AuthSplash,
  AuthWay,
  SPLASH_DRAW_SECONDS,
  SPLASH_FADE_SECONDS,
  SPLASH_GATE,
  SPLASH_SEEN_KEY,
  doParam,
  entryCopy,
  entryHref,
  entrySide,
  otherSide,
  sideParam,
  sideTitle,
} from "@/components/auth-ui";
import { LOGO_DRAW_SECONDS, LOGO_FILL_SECONDS, LOGO_PATHS } from "@/components/auth-ui/logo-paths";
import { safeNext } from "@/lib/auth/next";
import { AUTH_FLOORS, AUTH_LOGO, AUTH_SCHEME, AUTH_SIZES, AUTH_SPLASH, AUTH_TYPE } from "@/lib/ui/auth-tokens";

const WEB = process.cwd();
const source = (...parts: string[]) => readFileSync(path.join(WEB, ...parts), "utf8");
/** The code of a file: what a comment says about it is not the code. */
const code = (...parts: string[]) => source(...parts).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("whose page an address is", () => {
  it("`as` decides when the address says it; else what `next` implies; else the elder's", () => {
    expect(entrySide("family")).toBe("family");
    expect(entrySide("elder")).toBe("elder");
    // said in the address, it wins over where he was on his way to
    expect(entrySide("elder", "/f")).toBe("elder");
    expect(entrySide("family", "/p/today")).toBe("family");
    // her page and the pages under it, and an invitation's: family
    for (const next of ["/f", "/f?link=abc", "/f/week", "/f/me?link=abc", "/invite/tok", "/invite/tok/join"]) expect(entrySide(undefined, next), next).toBe("family");
    // his own pages, and anything else: the elder
    for (const next of ["/p/today", "/p", "/onboard", "/onboard/who", "/privacy", "/family", "/foo", "/invitation"]) expect(entrySide(undefined, next), next).toBe("elder");
    // the bare address is the elder's page, as it was before there were two
    expect(entrySide(undefined)).toBe("elder");
    expect(entrySide(undefined, null)).toBe("elder");
    // a word that is neither side is not a side
    for (const as of ["", "Family", "daughter", "door", "1"]) expect(entrySide(as), as).toBe("elder");
    expect(entrySide(["family", "elder"])).toBe("family");
    expect([sideParam("elder"), sideParam("family"), sideParam("door"), sideParam(undefined), sideParam(["family"])]).toEqual(["elder", "family", null, null, "family"]);
    expect([otherSide("elder"), otherSide("family")]).toEqual(["family", "elder"]);
  });

  it("the proxy's own way to the log-in gives each side its page: /f means hers, /p and /onboard his", () => {
    // (lib/auth/next.ts loginUrl writes /login?next=<page>; app/login/page.tsx reads it back with safeNext)
    expect(entrySide(undefined, safeNext("/f?link=abc"))).toBe("family");
    expect(entrySide(undefined, safeNext("/p/today"))).toBe("elder");
    expect(entrySide(undefined, safeNext("/onboard"))).toBe("elder");
    // a `next` that is not a page of this site is no hint at all
    expect(entrySide(undefined, safeNext("//evil.example/f"))).toBe("elder");
    expect(entrySide(undefined, safeNext("https://evil.example/f"))).toBe("elder");
  });

  it("「你是哪一位？」 is on the way to signing up unless the address says logging in", () => {
    expect([doParam("login"), doParam("signup"), doParam(undefined), doParam(""), doParam("Login"), doParam(["login", "signup"])]).toEqual(["login", "signup", "signup", "signup", "signup", "login"]);
  });

  it("the addresses between these pages carry only what is given", () => {
    expect(entryHref("/")).toBe("/");
    expect(entryHref("/", { lang: null })).toBe("/");
    expect(entryHref("/", { lang: "en" })).toBe("/?lang=en");
    expect(entryHref("/who", { do: "signup" })).toBe("/who?do=signup");
    expect(entryHref("/who", { do: "login", lang: "en" })).toBe("/who?do=login&lang=en");
    expect(entryHref("/signup", { as: "elder" })).toBe("/signup?as=elder");
    expect(entryHref("/signup", { as: "family", lang: "zh-Hans" })).toBe("/signup?as=family&lang=zh-Hans");
    expect(entryHref("/login", { as: "family" })).toBe("/login?as=family");
    // the bare address when nothing is said
    expect(entryHref("/login", { as: null, next: null, lang: null })).toBe("/login");
    // the way back is kept, written as the proxy writes it
    expect(entryHref("/login", { as: "family", next: "/f?link=abc" })).toBe("/login?as=family&next=%2Ff%3Flink%3Dabc");
    expect(entryHref("/login", { next: "/p/today", lang: "en" })).toBe("/login?next=%2Fp%2Ftoday&lang=en");
  });
});

describe("the words of 「你是哪一位？」", () => {
  it("are the brief's, in both languages", () => {
    expect(entryCopy("zh-Hans")).toMatchObject({ whoTitle: "你是哪一位？", elderTitle: "我是长辈", elderLine: "记录就诊、服药和血压", familyTitle: "我是子女", familyLine: "看看爸爸妈妈今天好不好" });
    expect(entryCopy("en")).toMatchObject({
      whoTitle: "Who are you?",
      elderTitle: "I am the elder",
      elderLine: "My visits, medicine and readings",
      familyTitle: "I am the son or daughter",
      familyLine: "See how my parent is doing today",
    });
    // the small link from one side's log-in to the other's says the same words
    expect([sideTitle("elder", "zh-Hans"), sideTitle("family", "zh-Hans"), sideTitle("elder", "en"), sideTitle("family", "en")]).toEqual(["我是长辈", "我是子女", "I am the elder", "I am the son or daughter"]);
    // both languages have every word
    expect(Object.keys(entryCopy("en")).sort()).toEqual(Object.keys(entryCopy("zh-Hans")).sort());
    for (const w of [...Object.values(entryCopy("en")), ...Object.values(entryCopy("zh-Hans"))]) expect(w.trim()).not.toBe("");
  });

  it("a way is one link: its chip, a title, one line, and a chevron; the icons are decoration", () => {
    const way = html(createElement(AuthWay, { href: "/signup?as=family", icon: "people", title: "我是子女", "data-testid": "who-family", children: "看看爸爸妈妈今天好不好" }));
    expect(way).toMatch(/^<a [^>]*class="rpa-ios-way"/);
    expect(way).toMatch(/^<a [^>]*data-rp="way"[^>]*data-testid="who-family"/);
    expect(way).toMatch(/^<a [^>]*href="\/signup\?as=family"/);
    expect(way.match(/<a /g)?.length).toBe(1);
    expect(way).toContain('<span class="rpa-ios-chip" aria-hidden="true"><svg');
    expect(way).toContain('<span class="rpa-ios-way-title">我是子女</span> <span class="rpa-ios-way-sub">看看爸爸妈妈今天好不好</span>');
    expect(way.match(/<svg [^>]*aria-hidden="true"/g)?.length).toBe(2);
    // the link's name is its two lines of words
    expect(way.replace(/<[^>]+>/g, "")).toBe("我是子女 看看爸爸妈妈今天好不好");
  });

  it("an elder reads that page: the way's words are his sizes, and a way is at least two targets tall", () => {
    const css = source("app", "ripple-auth.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (selector: string) => new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".rpa-ios-way")).toMatch(/min-height:\s*calc\(2 \* var\(--rpa-hit\)\);/);
    expect(rule(".rpa-ios-way")).toMatch(/border-radius:\s*20px;/);
    expect(rule(".rpa-ios-way")).toMatch(/background:\s*var\(--rpa-surface\);/);
    expect(rule(".rpa-ios-way-title")).toMatch(/font-size:\s*var\(--rpa-fs-title3\);/);
    expect(rule(".rpa-ios-way-sub")).toMatch(/font-size:\s*var\(--rpa-fs-footnote\);[^}]*color:\s*var\(--rpa-text-2\);/);
    expect(AUTH_TYPE.elder.title3).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.text);
    expect(AUTH_TYPE.elder.footnote).toBeGreaterThanOrEqual(AUTH_FLOORS.elder.text);
    expect(2 * AUTH_SIZES.find((s) => s.name === "--rpa-hit")!.elder).toBeGreaterThanOrEqual(2 * AUTH_FLOORS.elder.target);
    // and the page is the door's, which is drawn at his size (app/who/page.tsx)
    expect(code("app", "who", "page.tsx")).toMatch(/<AuthScreen locale=\{locale\} side="door" data-testid="who">/);
  });
});

describe("the cold start (SplashView over the welcome)", () => {
  const css = source("components", "auth-ui", "splash.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("is as long as the mark takes to draw itself, and no longer: the SVG's own numbers, then the fade", () => {
    const lastDelay = Math.max(...LOGO_PATHS.map((p) => p.delay));
    expect([lastDelay, LOGO_DRAW_SECONDS, LOGO_FILL_SECONDS]).toEqual([1.35, 1.4, 0.5]);
    expect(SPLASH_DRAW_SECONDS).toBe(3.25);
    expect(SPLASH_FADE_SECONDS).toBe(AUTH_SPLASH.fadeSeconds);
    // short: a cross-fade, not a hold
    expect(SPLASH_FADE_SECONDS).toBeGreaterThan(0);
    expect(SPLASH_FADE_SECONDS).toBeLessThanOrEqual(0.5);
    // the stylesheet's fallbacks are the same two numbers
    expect(css).toMatch(/animation:\s*rpa-ios-splash-out var\(--rpa-splash-fade, \.35s\) ease var\(--rpa-splash-draw, 3\.25s\) backwards;/);
    expect(Number(`0${/--rpa-splash-fade, (\.\d+)s/.exec(css)![1]}`)).toBe(SPLASH_FADE_SECONDS);
    expect(Number(/--rpa-splash-draw, ([\d.]+)s/.exec(css)![1])).toBe(SPLASH_DRAW_SECONDS);
    // the mark there is SplashView's: 210
    expect(AUTH_LOGO.splash).toBe(210);
  });

  it("is drawn only by its animation: hidden at rest, held from the first frame, faded, then hidden again by itself", () => {
    // outside the query nothing draws it
    expect(css).toMatch(/(?:^|\})\s*\.rpa-ios-splash\s*\{\s*display:\s*none;\s*\}/);
    const inQuery = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const layer = /\.rpa-ios-splash\s*\{([^}]*)\}/.exec(inQuery)?.[1] ?? "";
    expect(layer).toMatch(/display:\s*block;/);
    // at rest: not there for the eye, and not there for a finger
    expect(layer).toMatch(/visibility:\s*hidden;/);
    expect(layer).toMatch(/opacity:\s*0;/);
    // the one animation holds it visible over its delay (backwards) and does not keep its last frame (no forwards)
    expect(layer).toMatch(/animation:[^;]*\bbackwards;/);
    expect(layer).not.toMatch(/forwards|infinite/);
    expect(css).toMatch(/@keyframes rpa-ios-splash-out\s*\{\s*from\s*\{\s*visibility:\s*visible;\s*opacity:\s*1;\s*\}\s*to\s*\{\s*visibility:\s*hidden;\s*opacity:\s*0;\s*\}\s*\}/);
    expect([...css.matchAll(/@keyframes ([\w-]+)/g)].map((k) => k[1])).toEqual(["rpa-ios-splash-out"]);
    // nothing lets a tap through it while it is seen, and nothing keeps it there afterwards
    expect(css).not.toMatch(/pointer-events/);
    // a session that has seen it does not get it drawn
    expect(inQuery).toMatch(/\.rpa-ios-splash\[data-seen="true"\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it("with reduced motion asked for there is no splash: every rule that draws it is inside the no-preference query", () => {
    const queries = [...css.matchAll(/@media\s+([^{]+)\{/g)].map((m) => m[1].trim());
    expect(queries).toEqual(["(prefers-reduced-motion: no-preference)"]);
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/animation\s*:/);
    expect(outside).not.toMatch(/display:\s*block/);
    // the mark's own draw-in is inside the same query in app/ripple-auth.css (auth-contrast.test.ts holds that)
    expect(source("app", "ripple-auth.css")).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.rpa-ios-logo\[data-animated="true"\] path/);
  });

  it("is pure black under the white mark, whatever set the door is drawn in; the mark's counters are that black", () => {
    expect(AUTH_SPLASH).toMatchObject({ ground: "#000000", mark: "#FFFFFF" });
    const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    expect(hexes.sort()).toEqual([AUTH_SPLASH.ground, AUTH_SPLASH.mark].sort());
    // given to the mark through the screen's own variables, so the mark's own rules draw it
    expect(css).toMatch(new RegExp(`--rpa-bg:\\s*${AUTH_SPLASH.ground};`));
    expect(css).toMatch(new RegExp(`--rpa-logo:\\s*${AUTH_SPLASH.mark};`));
    expect(css).toMatch(/background:\s*var\(--rpa-bg\);/);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    const auth = source("app", "ripple-auth.css");
    expect(auth).toMatch(/\.rpa-ios-logo path\s*\{[^}]*fill:\s*var\(--rpa-logo\);/);
    expect(auth).toMatch(/\.rpa-ios-logo path\[data-hole="true"\]\s*\{\s*fill:\s*var\(--rpa-bg\);/);
    // the component names no colour
    expect(code("components", "auth-ui", "AuthSplash.tsx")).not.toMatch(/#[0-9a-fA-F]{6}\b|\brgba?\(/);
  });

  it("covers the screen it is in and no more: the phone, and on a computer the 430px column (app/desktop.css)", () => {
    expect(css).toMatch(/\.rpa-ios-screen:has\(\.rpa-ios-splash\)\s*\{\s*position:\s*relative;\s*\}/);
    expect(css).toMatch(/position:\s*absolute;\s*inset:\s*0;/);
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/\d(?:vw|vh|vmin|vmax)\b/);
    expect(css).not.toMatch(/@container|min-width|max-width/);
    // the mark stands in the middle of the phone's screen (dvh, as the screen itself is measured)
    expect(css).toMatch(/\.rpa-ios-splash-stage\s*\{[^}]*position:\s*sticky;[^}]*place-items:\s*center;[^}]*height:\s*100dvh;/);
    // only this layer's own classes and the screen's variables
    const classes = [...new Set([...css.replace(/\{[^{}]*\}/g, "{}").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
    expect(classes.sort()).toEqual(["rpa-ios-screen", "rpa-ios-splash", "rpa-ios-splash-stage"]);
    const declared = [...new Set([...css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]))];
    expect(declared.sort()).toEqual(["--rpa-bg", "--rpa-logo"]);
  });

  it("what the server sends: the layer with its mark and its times, hidden from assistive technology, its script first", () => {
    const layer = html(createElement(AuthSplash));
    expect(layer).toMatch(/^<div class="rpa-ios-splash" data-rp="splash" aria-hidden="true" style="--rpa-splash-draw:3\.25s;--rpa-splash-fade:0\.35s">/);
    // the script is the layer's first child: it runs before the rest of the layer is read
    expect(layer).toMatch(/^<div [^>]*><script>/);
    expect(layer).toContain(`<script>${SPLASH_GATE}</script>`);
    // the mark: SplashView's 210, drawing itself in, with a name of its own so the welcome's mark stays the page's one
    expect(layer).toMatch(/<div class="rpa-ios-splash-stage"><svg class="rpa-ios-logo"[^>]*width="210"[^>]*height="210"[^>]*data-rp="splash-logo"/);
    expect(layer).toMatch(/<svg [^>]*data-animated="true"/);
    expect(layer).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(layer).not.toContain('data-rp="logo"');
    expect(layer.match(/<path /g)?.length).toBe(16);
    // nothing in it can be tapped or read
    expect(layer).not.toMatch(/<a |<button|role=|aria-label/);
    // (a screen React makes in the browser draws no layer at all: that is e2e/fe-entry.spec.ts, in a browser)
    const src = code("components", "auth-ui", "AuthSplash.tsx");
    expect(src).toMatch(/useSyncExternalStore\(\s*never,\s*\(\) => false,\s*\(\) => true,?\s*\)/);
    expect(src).toMatch(/if \(!cold\) return null;/);
    expect(src).toMatch(/suppressHydrationWarning/);
  });

  it("its script marks the layer when this session has seen the splash, and leaves the note when it has not", () => {
    const run = (store: Map<string, string> | "refused") => {
      const marks: [string, string][] = [];
      const sessionStorage =
        store === "refused"
          ? {
              getItem: () => {
                throw new Error("SecurityError");
              },
              setItem: () => {
                throw new Error("SecurityError");
              },
            }
          : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
      const document = { currentScript: { parentNode: { setAttribute: (name: string, value: string) => void marks.push([name, value]) } } };
      // the script as the page runs it: its only names from outside are sessionStorage and document
      new Function("sessionStorage", "document", SPLASH_GATE)(sessionStorage, document);
      return marks;
    };
    const session = new Map<string, string>();
    // the first load of a session: the splash plays, and the note is left
    expect(run(session)).toEqual([]);
    expect([...session]).toEqual([[SPLASH_SEEN_KEY, "1"]]);
    // every later load: the layer is marked, and nothing else is written
    expect(run(session)).toEqual([["data-seen", "true"]]);
    expect(run(session)).toEqual([["data-seen", "true"]]);
    expect([...session]).toEqual([[SPLASH_SEEN_KEY, "1"]]);
    // storage refused: nothing is marked (the splash plays), and nothing is thrown at the page
    expect(run("refused")).toEqual([]);
    // it touches its own parent only: no other element, no cookie, no request
    expect(SPLASH_GATE).not.toMatch(/cookie|fetch|XMLHttpRequest|localStorage|innerHTML|appendChild|querySelector/);
    expect(SPLASH_SEEN_KEY).toBe("rp_splash");
    // an inline script is allowed by the headers every answer carries: they hold frame-ancestors only (lib/guard/headers.ts)
    const headers = source("lib", "guard", "headers.ts");
    expect(headers).toMatch(/\["Content-Security-Policy", "frame-ancestors 'self'"\]/);
    expect(headers).not.toMatch(/script-src|default-src/);
  });
});

describe("the pages of the way in", () => {
  it("the front door: the door's own set of colours, a still mark, the two buttons lead to 「你是哪一位？」, the splash last", () => {
    const src = code("app", "page.tsx");
    expect(src).toMatch(/<Screen locale=\{locale\} side="door" data-testid="front-door">/);
    expect(["dark", "light"]).toContain(AUTH_SCHEME.door);
    // WelcomeView draws RippleLogoMark still: the splash before it has just played it
    expect(src).toMatch(/<AuthLogo size="welcome" decorative \/>/);
    // (the motion pass, 10-14: both open 「你是哪一位？」 as the page under the door, so they say nav="forward")
    expect(src).toMatch(/<AuthPrimaryButton href=\{entryHref\("\/who", \{ do: "signup", lang \}\)\} nav="forward" shape="hero" data-testid="front-door-signup">/);
    expect(src).toMatch(/<AuthTextButton href=\{entryHref\("\/who", \{ do: "login", lang \}\)\} nav="forward" data-testid="front-door-login">/);
    // no way to /demo from the front door any more (owner, 10-14: the judges are given two accounts)
    expect(src).not.toMatch(/href="\/demo"/);
    // the layer is the screen's last child: over the whole welcome, and after the welcome's mark in the page
    expect(src).toMatch(/<AuthSplash \/>\s*<\/Screen>/);
    expect(src.indexOf("<AuthSplash />")).toBeGreaterThan(src.indexOf("</AuthDock>"));
    // someone signed in never sees any of it
    expect(src).toMatch(/const home = await signedInHome\(\);\s*if \(home\) redirect\(home\);/);
  });

  it("「你是哪一位？」: two ways, to that side's sign-up or log-in, and the way back to the welcome", () => {
    const src = code("app", "who", "page.tsx");
    expect(src).toMatch(/const page = what === "login" \? "\/login" : "\/signup";/);
    expect(src).toMatch(/<AuthWay href=\{entryHref\(page, \{ as: "elder", lang \}\)\} icon="person" title=\{w\.elderTitle\} data-testid="who-elder">/);
    expect(src).toMatch(/<AuthWay href=\{entryHref\(page, \{ as: "family", lang \}\)\} icon="people" title=\{w\.familyTitle\} data-testid="who-family">/);
    expect(src).toMatch(/back=\{\{ label: c\.back, href: entryHref\("\/", \{ lang \}\), testId: "step-back" \}\}/);
    expect(src).toMatch(/const home = await signedInHome\(\);\s*if \(home\) redirect\(home\);/);
    // its mark is still: the log-in after it plays it
    expect(src).toMatch(/<AuthLogo size="login" \/>/);
  });

  it("the log-in plays its mark once at the entry (SignInView), on both sides, and has no link to the other side or to sign-up", () => {
    const src = code("app", "login", "LoginFlow.tsx");
    expect(src).toMatch(/<AuthLogo size="login" animated=\{!markDrawn\} \/>/);
    // drawn once: leaving the account screen settles it
    expect(src).toMatch(/if \(s !== "account"\) setMarkDrawn\(true\);/);
    // owner's tidy of 10-13: the side was chosen one screen before, and the welcome screen has sign-up
    expect(src).not.toMatch(/login-as-/);
    expect(src).not.toMatch(/login-to-signup/);
    // the bare address stays bare
    expect(entryHref("/signup", { as: null, lang: null })).toBe("/signup");
  });

  it("her short sign-up: an account with no space of its own, her own taps, the page's language, both consents at their versions", () => {
    const src = code("app", "signup", "FamilySignupFlow.tsx");
    expect(src).toMatch(/const ORDER: Step\[\] = \["name", "account", "password", "terms", "ai", "code"\];/);
    expect(src).toMatch(/space: "none",/);
    expect(src).toMatch(/assisted: false,/);
    expect(src).toMatch(/display_name: name\.trim\(\),\s*locale,/);
    expect(src).toMatch(/terms_privacy: \{ version: CURRENT_CONSENT_VERSIONS\.terms_privacy \},\s*ai_processing: \{ decision: ai, version: CURRENT_CONSENT_VERSIONS\.ai_processing \},/);
    // the same two texts as his, and the recovery code said in the same sentences
    expect(src).toMatch(/currentConsentText\("terms_privacy", locale\)/);
    expect(src).toMatch(/currentConsentText\("ai_processing", locale\)/);
    expect(src).toMatch(/readAloudLines\("recovery_code", locale\)/);
    // then where the server says (/f for an account that only looks)
    expect(src).toMatch(/window\.location\.assign\(result\.next\)/);
    // none of the three steps that are his
    expect(src).not.toMatch(/rememberLanguage|helper|spaceTitle|example_data|signup-lang|signup-helper|signup-space/);
    // his own flow is not this file's business: it is imported nowhere here
    expect(src).not.toMatch(/SignupFlow"/);
  });

  it("her logout lands on her log-in", () => {
    expect(source("components", "family", "HerBits.tsx")).toMatch(/window\.location\.assign\("\/login\?as=family"\);/);
    expect(entrySide("family")).toBe("family");
  });
});
