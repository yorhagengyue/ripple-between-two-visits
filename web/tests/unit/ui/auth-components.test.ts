/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX: the props types require `children`, so it goes in props */
/**
 * components/auth-ui rendered on the server (no DOM): the marks other tests and the page checks look for (the side, the
 * test ids and their derived names, the roles), and the few rules the CSS cannot hold by itself: the logo's sixteen
 * paths with their delays only when it draws in, 「读给我听」 drawn only with a real voice, a pending button that keeps its
 * words, a switch that says its state in words.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AuthAvatar,
  AuthCheckbox,
  AuthChoiceList,
  AuthCode,
  AuthDock,
  AuthDone,
  AuthError,
  AuthFeatureRow,
  AuthFeatures,
  AuthField,
  AuthHint,
  AuthLinks,
  AuthLogo,
  AuthMore,
  AuthNav,
  AuthNavLink,
  AuthParagraphs,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthReadAloud,
  AuthRecoveryCard,
  AuthScreen,
  AuthSecondaryButton,
  AuthSwitchRow,
  AuthText,
  AuthTextButton,
  AuthTitle,
} from "@/components/auth-ui";
import { LOGO_PATHS } from "@/components/auth-ui/logo-paths";
import { playAloud, primeInTap, type AloudElement } from "@/components/auth-ui/read-aloud-player";
import { accountCopy } from "@/lib/auth/copy";
import { AUTH_SCHEME, AUTH_TIER } from "@/lib/ui/auth-tokens";
import { READ_ALOUD_SCREENS } from "@/lib/auth/read-aloud-text";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, "");
const noop = () => undefined;

describe("the screen and its top bar", () => {
  it("marks its side for the page checks, and carries the page's own test id on its root", () => {
    const elder = html(createElement(AuthScreen, { locale: "zh-Hans", "data-testid": "front-door", children: "x" }));
    expect(elder).toMatch(/^<div [^>]*class="rpa-ios-screen"/);
    expect(elder).toMatch(/^<div [^>]*data-testid="front-door"/);
    expect(elder).toMatch(/^<div [^>]*data-rp="screen"[^>]*data-rp-side="elder"/);
    expect(elder).toMatch(/^<div [^>]*lang="zh-Hans"/);
    // the desktop layout (app/desktop.css) finds every phone page by this mark; its value is the set of colours the
    // side's screens are drawn in (lib/ui/auth-tokens.ts AUTH_SCHEME, the one switch), never written by a page
    expect(elder).toMatch(new RegExp(`^<div [^>]*data-rp-phone="${AUTH_SCHEME.elder}"`));
    const family = html(createElement(AuthScreen, { locale: "en", side: "family", children: "x" }));
    expect(family).toMatch(new RegExp(`^<div [^>]*data-rp-phone="${AUTH_SCHEME.family}"`));
    expect(family).toMatch(/^<div [^>]*data-rp="family-screen"[^>]*data-rp-side="family"/);
    expect(family).toMatch(/^<div [^>]*lang="en"/);
    expect(family).not.toContain("data-testid");
    // the door (the welcome, 「你是哪一位？」): its own set of colours, at the elder's size: an elder reads it too
    const door = html(createElement(AuthScreen, { locale: "zh-Hans", side: "door", "data-testid": "front-door", children: "x" }));
    expect(door).toMatch(/^<div [^>]*data-rp="screen"[^>]*data-rp-side="elder"/);
    expect(door).toMatch(new RegExp(`^<div [^>]*data-rp-phone="${AUTH_SCHEME.door}"`));
    expect(AUTH_TIER).toEqual({ elder: "elder", family: "family", door: "elder" });
  });

  it("back is a worded capsule: a link to a page, or a button for a step inside the flow", () => {
    const link = html(createElement(AuthNav, { "data-rp": "meta", back: { label: "返回", href: "/", testId: "step-back" } }));
    expect(link).toMatch(/^<div class="rpa-ios-nav" data-rp="meta">/);
    expect(link).toMatch(/<a [^>]*class="rpa-ios-nav-btn"[^>]*data-kind="back"[^>]*data-testid="step-back"[^>]*href="\/"/);
    expect(text(link)).toBe("返回");
    const button = html(createElement(AuthNav, { back: { label: "换一个账号", onClick: noop, testId: "step-back" } }));
    expect(button).toMatch(/<button type="button" class="rpa-ios-nav-btn" data-kind="back" data-testid="step-back">/);
    expect(text(button)).toBe("换一个账号");
    // the icon is decoration: the word is the button's name
    expect(button).toMatch(/<svg [^>]*aria-hidden="true"/);
  });

  it("the step count is words on the right; the language link keeps its marks", () => {
    const nav = html(
      createElement(AuthNav, {
        step: "第 2 步，共 9 步",
        end: createElement(AuthNavLink, { href: "/login?lang=en", "data-kind": "lang", "data-testid": "lang-switch", children: "English" }),
      }),
    );
    expect(text(nav)).toBe("第 2 步，共 9 步English");
    expect(nav).toContain('<span class="rpa-ios-step">第 2 步，共 9 步</span>');
    expect(nav).toMatch(/<a [^>]*data-tint="accent"[^>]*data-kind="lang"[^>]*data-testid="lang-switch"[^>]*href="\/login\?lang=en"/);
    // nothing to go back to: nothing tappable on the left
    expect(html(createElement(AuthNav, { step: "x" }))).not.toMatch(/data-kind="back"/);
  });
});

describe("the logo", () => {
  it("is the mark's sixteen paths; the counters are marked, and it has a name unless it sits next to the name in words", () => {
    const mark = html(createElement(AuthLogo, {}));
    expect(mark.match(/<path /g)?.length).toBe(16);
    expect(mark.match(/data-hole="true"/g)?.length).toBe(3);
    expect(mark).toMatch(/^<svg [^>]*class="rpa-ios-logo"[^>]*viewBox="97 69 409 440"[^>]*width="150"[^>]*height="150"/);
    expect(mark).toMatch(/role="img"[^>]*aria-label="Ripple"/);
    expect(mark).toContain(`d="${LOGO_PATHS[0].d}"`);
    // not drawing in: no delays, the finished mark
    expect(mark).not.toContain("data-animated");
    expect(mark).not.toContain("--rpa-logo-delay");
    const beside = html(createElement(AuthLogo, { size: "welcome", decorative: true }));
    expect(beside).toMatch(/^<svg [^>]*width="175"[^>]*height="175"/);
    expect(beside).toMatch(/aria-hidden="true"/);
    expect(beside).not.toContain("aria-label");
  });

  it("drawing in: every path carries its own delay, in the SVG's order", () => {
    const mark = html(createElement(AuthLogo, { size: "welcome", animated: true }));
    expect(mark).toMatch(/^<svg [^>]*data-animated="true"/);
    const delays = [...mark.matchAll(/--rpa-logo-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(delays).toEqual(LOGO_PATHS.map((p) => p.delay));
    expect(delays[0]).toBe(0);
    expect(delays.at(-1)).toBe(1.35);
    expect(mark.match(/pathLength="1"/g)?.length).toBe(16);
  });
});

describe("titles and text", () => {
  it("one <h1> a screen; the old marks ride along", () => {
    const title = html(createElement(AuthTitle, { size: "large", align: "centre", "data-rp": "headline", "data-variant": "status", children: "Ripple" }));
    expect(title).toBe('<h1 class="rpa-ios-title" data-size="large" data-align="centre" data-rp="headline" data-variant="status">Ripple</h1>');
    expect(html(createElement(AuthTitle, { children: "登录" }))).toBe('<h1 class="rpa-ios-title">登录</h1>');
    const lede = html(createElement(AuthText, { variant: "lede", children: "一句话。" }));
    expect(lede).toBe('<p class="rpa-ios-text" data-rp="text" data-rp-role="body" data-variant="lede">一句话。</p>');
    expect(html(createElement(AuthText, { children: "x" }))).toContain('data-variant="plain"');
  });

  it("an error is read out at once and keeps its test id; a hint has its icon tile beside the words", () => {
    expect(html(createElement(AuthError, { testId: "login-error", children: "账号或密码不对。" }))).toBe('<p class="rpa-ios-error" role="alert" data-testid="login-error">账号或密码不对。</p>');
    const hint = html(createElement(AuthHint, { testId: "assisted-note", children: "请陈先生本人看完，自己点「同意」。" }));
    expect(hint).toMatch(/^<p class="rpa-ios-hint" data-rp="hint" data-testid="assisted-note">/);
    expect(hint).toMatch(/<span class="rpa-ios-tile" aria-hidden="true">/);
    expect(text(hint)).toBe("请陈先生本人看完，自己点「同意」。");
  });

  it("the avatar shows the first character of his name, a person before he types; the finished screen has its tick", () => {
    expect(text(html(createElement(AuthAvatar, { name: " 陈先生 " })))).toBe("陈");
    expect(text(html(createElement(AuthAvatar, { name: "tan" })))).toBe("T");
    const empty = html(createElement(AuthAvatar, { name: "  " }));
    expect(text(empty)).toBe("");
    expect(empty).toContain("<svg");
    expect(empty).toMatch(/^<div class="rpa-ios-avatar" data-rp="avatar" aria-hidden="true">/);
    const done = html(createElement(AuthDone, { children: createElement(AuthTitle, { size: "large", align: "centre", children: "密码重设好了" }) }));
    expect(done).toMatch(/^<div class="rpa-ios-done" data-rp="done"><span class="rpa-ios-glyph" aria-hidden="true"><svg/);
    expect(text(done)).toBe("密码重设好了");
  });

  it("a welcome row: a chip with its icon, a headline, a footnote", () => {
    const rows = html(createElement(AuthFeatures, { children: createElement(AuthFeatureRow, { icon: "lock", title: "标题", children: "一行说明。" }) }));
    expect(rows).toMatch(/^<div class="rpa-ios-features" data-rp="features"><div class="rpa-ios-feature" data-rp="feature"><span class="rpa-ios-chip" aria-hidden="true"><svg/);
    expect(rows).toContain('<p class="rpa-ios-feature-title">标题</p><p class="rpa-ios-feature-sub">一行说明。</p>');
  });
});

describe("buttons", () => {
  it("the filled one: a link or a button, its words in a span, the shape as a mark", () => {
    const link = html(createElement(AuthPrimaryButton, { href: "/signup", shape: "hero", "data-testid": "front-door-signup", children: "注册" }));
    expect(link).toMatch(/^<a [^>]*class="rpa-ios-btn"/);
    expect(link).toMatch(/data-testid="front-door-signup"/);
    expect(link).toMatch(/data-rp="primary" data-variant="primary" data-shape="hero"/);
    expect(link).toMatch(/href="\/signup"/);
    expect(link).toContain("<span>注册</span>");
    const button = html(createElement(AuthPrimaryButton, { type: "submit", icon: "arrow", "data-testid": "login-next", children: "下一步" }));
    expect(button).toMatch(/^<button [^>]*type="submit"/);
    expect(button).toMatch(/data-testid="login-next"/);
    // the arrow comes after the words and is decoration
    expect(button).toMatch(/<span>下一步<\/span><svg [^>]*aria-hidden="true"/);
    expect(button).not.toContain("data-shape");
    expect(html(createElement(AuthPrimaryButton, { children: "x" }))).toMatch(/^<button type="button"/);
  });

  it("busy after a tap: disabled and aria-busy, and the words stay", () => {
    const busy = html(createElement(AuthPrimaryButton, { pending: true, children: "登录" }));
    expect(busy).toMatch(/disabled=""/);
    expect(busy).toMatch(/aria-busy="true"/);
    expect(text(busy)).toBe("登录");
    expect(html(createElement(AuthPrimaryButton, { children: "登录" }))).not.toMatch(/disabled|aria-busy/);
  });

  it("the second choice and the quiet words keep their marks", () => {
    const second = html(createElement(AuthSecondaryButton, { "data-testid": "login-locked-ok", children: "知道了" }));
    expect(second).toMatch(/data-rp="secondary" data-variant="secondary"/);
    const quiet = html(createElement(AuthTextButton, { href: "/demo", tint: "quiet", "data-testid": "front-door-demo", children: "评委：并排演示在 /demo" }));
    expect(quiet).toMatch(/data-rp="text-button" data-variant="text" data-tint="quiet"/);
    expect(html(createElement(AuthTextButton, { href: "/login", children: "登录" }))).not.toContain("data-tint");
  });

  it("links under a step: one text button each; a new tab when asked, so nothing typed is lost", () => {
    const nav = html(
      createElement(AuthLinks, {
        links: [
          { href: "/signup", label: "还没有账号？ 注册", testId: "login-to-signup" },
          { href: "/privacy", label: "完整的隐私说明", newTab: true },
        ],
      }),
    );
    expect(nav).toMatch(/^<nav class="rpa-ios-links" data-rp="links">/);
    expect(nav).toMatch(/<a [^>]*data-testid="login-to-signup"[^>]*href="\/signup"/);
    expect(nav).toMatch(/<a [^>]*href="\/privacy"[^>]*target="_blank"[^>]*rel="noopener"|<a [^>]*target="_blank"[^>]*rel="noopener"[^>]*href="\/privacy"|<a [^>]*rel="noopener"[^>]*target="_blank"/);
  });

  it("the dock is still found by data-rp", () => {
    expect(html(createElement(AuthDock, { children: "x" }))).toBe('<div class="rpa-ios-dock" data-rp="dock">x</div>');
    expect(html(createElement(AuthDock, { pinned: true, "data-rp": "family-dock", children: "x" }))).toBe('<div class="rpa-ios-dock" data-rp="family-dock" data-pinned="true">x</div>');
  });
});

describe("fields and choices", () => {
  it("a field: its label names it, the test id is on the input, an error gets <id>-error and is tied to the input", () => {
    const plain = html(createElement(AuthField, { label: "账号", value: "", onChange: noop, testId: "login-login", icon: "person" }));
    const id = /<label class="rpa-ios-kicker" for="([^"]+)">账号<\/label>/.exec(plain)?.[1];
    expect(id).toBeTruthy();
    expect(plain).toContain(`<input id="${id}"`);
    expect(plain).toMatch(/<input [^>]*class="rpa-ios-input"[^>]*data-rp-role="body"/);
    expect(plain).toMatch(/<input [^>]*data-testid="login-login"/);
    expect(plain).toMatch(/<div class="rpa-ios-input-box" data-icon="true"><svg/);
    expect(plain).not.toMatch(/aria-invalid|role="alert"/);
    const wrong = html(createElement(AuthField, { label: "账号", value: "ab", onChange: noop, testId: "signup-login", note: "一句说明。", error: "账号用字母、数字。" }));
    const wid = /for="([^"]+)"/.exec(wrong)?.[1];
    expect(wrong).toMatch(/<input [^>]*aria-invalid="true"/);
    expect(wrong).toContain(`aria-describedby="${wid}-note ${wid}-error"`);
    expect(wrong).toContain(`<p id="${wid}-error" class="rpa-ios-error" role="alert" data-testid="signup-login-error">账号用字母、数字。</p>`);
    expect(wrong).toContain(`id="${wid}-note"`);
  });

  it("a code field is still one input, as typed; only its box is marked", () => {
    const code = html(createElement(AuthField, { label: "恢复码", value: "abcd-efgh", onChange: noop, code: "recovery", testId: "recover-code", placeholder: "XXXX-XXXX-XXXX" }));
    expect(code.match(/<input /g)?.length).toBe(1);
    expect(code).toMatch(/<div class="rpa-ios-input-box" data-code="recovery">/);
    expect(code).toMatch(/<input [^>]*value="abcd-efgh"/);
    expect(code).toMatch(/<input [^>]*data-testid="recover-code"/);
    expect(html(createElement(AuthField, { label: "6 位数", value: "", onChange: noop, code: "digits", error: "是 6 个数字。", testId: "recover-family-code" }))).toMatch(/class="rpa-ios-error" role="alert" data-align="centre" data-testid="recover-family-code-error"/);
  });

  it("a password field hides what he types and has a worded button to show it, named <id>-show", () => {
    const c = accountCopy("zh-Hans");
    const field = html(createElement(AuthPasswordField, { copy: c, label: c.passwordLabel, value: "", onChange: noop, testId: "signup-password", newPassword: true }));
    expect(field).toMatch(/<input [^>]*type="password"/);
    expect(field).toMatch(/<input [^>]*autoComplete="new-password"|<input [^>]*autocomplete="new-password"/);
    expect(field).toMatch(/<button type="button" class="rpa-ios-btn" data-variant="text" data-fit="end" aria-pressed="false" data-testid="signup-password-show"><span>显示密码<\/span><\/button>/);
    expect(html(createElement(AuthPasswordField, { copy: c, label: c.passwordLabel, value: "", onChange: noop }))).toMatch(/autocomplete="current-password"|autoComplete="current-password"/);
  });

  it("choices are a radio group: each row a radio with data-choice, the picked one ticked", () => {
    const list = html(
      createElement(AuthChoiceList<"zh-Hans" | "en">, {
        label: "用哪种语言？",
        value: "zh-Hans",
        onChange: noop,
        testId: "signup-lang",
        options: [
          { value: "zh-Hans", title: "华语", lang: "zh-Hans" },
          { value: "en", title: "English", sub: "一行说明", lang: "en" },
        ],
      }),
    );
    expect(list).toMatch(/^<div class="rpa-ios-choices" role="radiogroup" aria-label="用哪种语言？" data-testid="signup-lang">/);
    expect(list).toMatch(/<button type="button" role="radio" aria-checked="true" class="rpa-ios-choice" data-choice="zh-Hans" lang="zh-Hans">/);
    expect(list).toMatch(/<button type="button" role="radio" aria-checked="false" class="rpa-ios-choice" data-choice="en" lang="en">/);
    // the picked row's ring holds a tick, the other's is empty: not colour alone
    expect(list.match(/<span class="rpa-ios-choice-mark" aria-hidden="true"><svg/g)?.length).toBe(1);
    expect(list).toContain('<span class="rpa-ios-choice-mark" aria-hidden="true"></span>');
    expect(list).toContain('<span class="rpa-ios-choice-sub">一行说明</span>');
  });

  it("the switch is a switch, named by its title, and says 开 or 关 in words", () => {
    const off = html(createElement(AuthSwitchRow, { locale: "zh-Hans", title: "这不是我的手机", description: "关掉浏览器就退出，最长 12 小时。", on: false, onChange: noop, name: "not_my_phone" }));
    expect(off).toMatch(/^<div class="rpa-ios-switch-row" data-rp="switch-row" data-grant="not_my_phone">/);
    const tid = /<p class="rpa-ios-switch-title" id="([^"]+)">这不是我的手机<\/p>/.exec(off)?.[1];
    expect(off).toMatch(new RegExp(`<button type="button" role="switch" class="rpa-ios-switch" aria-checked="false" aria-labelledby="${tid}" aria-describedby="[^"]+">`));
    expect(off).toContain("<span>关</span>");
    const on = html(createElement(AuthSwitchRow, { locale: "en", title: "This is not my phone", on: true, onChange: noop }));
    expect(on).toMatch(/aria-checked="true"/);
    expect(on).toContain("<span>On</span>");
    expect(on).not.toContain("aria-describedby");
  });

  it("a tick box is a real checkbox with the page's test id", () => {
    const box = html(createElement(AuthCheckbox, { checked: false, onChange: noop, testId: "her-agree", children: "我读过并同意" }));
    expect(box).toMatch(/^<label class="rpa-ios-check" data-rp="check"><input type="checkbox" data-testid="her-agree"\/>/);
    expect(text(box)).toBe("我读过并同意");
  });
});

describe("blocks", () => {
  it("a consent text: every paragraph as published, list items marked", () => {
    const block = html(createElement(AuthParagraphs, { paragraphs: ["存什么：记录。", "· 你问的话", "· 药袋的照片"], testId: "signup-terms-text" }));
    expect(block).toMatch(/^<div class="rpa-ios-card rpa-ios-paragraphs" data-rp="paragraphs" data-testid="signup-terms-text">/);
    expect(block.match(/data-item="true"/g)?.length).toBe(2);
    expect(text(block)).toBe("存什么：记录。· 你问的话· 药袋的照片");
    const more = html(createElement(AuthMore, { summary: "读条款全文", items: ["一", "二"] }));
    expect(more).toMatch(/^<details class="rpa-ios-more" data-rp="more"><summary>读条款全文<\/summary>/);
    expect(more.match(/<li>/g)?.length).toBe(2);
  });

  it("the recovery code is one piece of text, spelt out for a screen reader; the card names the account and the code", () => {
    const code = html(createElement(AuthCode, { code: "ABCD-EFGH-JKLM", label: "恢复码" }));
    expect(code).toBe('<p class="rpa-ios-code" data-rp="code" data-testid="recovery-code" aria-label="恢复码: A B C D - E F G H - J K L M">ABCD-EFGH-JKLM</p>');
    expect(html(createElement(AuthCode, { code: "ABCD-EFGH-JKLM", testId: "her-code-value" }))).toBe('<p class="rpa-ios-code" data-rp="code" data-testid="her-code-value">ABCD-EFGH-JKLM</p>');
    const c = accountCopy("zh-Hans");
    const card = html(createElement(AuthRecoveryCard, { copy: c, login: "chen.tan", code: "ABCD-EFGH-JKLM" }));
    expect(card).toMatch(/^<section class="rpa-ios-recovery-card" data-rp="recovery-card" data-testid="recovery-card" aria-label="Ripple 恢复码">/);
    for (const w of ["Ripple 恢复码", "账号", "chen.tan", "恢复码", "ABCD-EFGH-JKLM", c.cardUse]) expect(text(card), w).toContain(w);
  });

  it("「读给我听」: nothing at all without a real voice; with one, the button names its screen", () => {
    const c = accountCopy("zh-Hans");
    for (const screen of READ_ALOUD_SCREENS) expect(html(createElement(AuthReadAloud, { screen, locale: "zh-Hans", copy: c, available: false }))).toBe("");
    const button = html(createElement(AuthReadAloud, { screen: "ai_processing", locale: "zh-Hans", copy: c, available: true }));
    expect(button).toMatch(/^<div class="rpa-ios-no-print" data-rp="read-aloud"><button type="button" class="rpa-ios-read" aria-pressed="false" data-testid="read-aloud" data-screen="ai_processing" data-state="idle">/);
    expect(text(button)).toBe("读给我听");
    expect(text(html(createElement(AuthReadAloud, { screen: "recovery_code", locale: "en", copy: accountCopy("en"), available: true })))).toBe("Read it to me");
  });
});

describe("「读给我听」 plays on an element the tap made (iOS Safari refuses a play() that only comes after the network)", () => {
  /** A stand-in for <audio>: it writes down what is done to it; a sound "plays" by ending at once, hanging, or failing. */
  function fakeAudio(log: string[], how: "ends" | "hangs" | "fails" = "ends"): AloudElement {
    const call = (h: AloudElement["onended"]) => (h as unknown as (() => void) | null)?.();
    const el: AloudElement = {
      src: "",
      load: () => {
        log.push("load");
      },
      play: async () => {
        log.push(`play ${el.src}`);
        if (how === "fails") throw new Error("NotAllowedError");
        if (how === "ends") queueMicrotask(() => call(el.onended));
      },
      pause: () => {
        log.push("pause");
        call(el.onpause);
      },
      onended: null,
      onpause: null,
      onerror: null,
    };
    return el;
  }

  it("the element is primed in the tap, before anything is fetched; every part then plays on that one element, in order", async () => {
    const log: string[] = [];
    const el = fakeAudio(log);
    primeInTap(el);
    log.push("the tap is over");
    const end = await playAloud(
      el,
      async (part) => {
        log.push(`fetch ${part}`);
        return { url: `blob:${part}`, parts: 3 };
      },
      () => true,
      (url) => log.push(`release ${url}`),
    );
    expect(end).toBe("done");
    expect(log).toEqual(["load", "the tap is over", "fetch 0", "play blob:0", "release blob:0", "fetch 1", "play blob:1", "release blob:1", "fetch 2", "play blob:2", "release blob:2"]);
  });

  it("he taps again while a part plays: it stops there, and nothing more is fetched", async () => {
    const log: string[] = [];
    const el = fakeAudio(log, "hangs");
    let alive = true;
    const running = playAloud(
      el,
      async (part) => {
        log.push(`fetch ${part}`);
        return { url: `blob:${part}`, parts: 3 };
      },
      () => alive,
      (url) => log.push(`release ${url}`),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["fetch 0", "play blob:0"]);
    // what the button's stop does: the run is no longer the current one, and the element is paused
    alive = false;
    el.pause();
    expect(await running).toBe("stopped");
    expect(log).toEqual(["fetch 0", "play blob:0", "pause", "release blob:0"]);
  });

  it("he leaves while a part is still on its way: the sound that arrives is let go and never played", async () => {
    const log: string[] = [];
    let alive = true;
    const end = await playAloud(
      fakeAudio(log),
      async (part) => {
        alive = false;
        return { url: `blob:${part}`, parts: 2 };
      },
      () => alive,
      (url) => log.push(`release ${url}`),
    );
    expect(end).toBe("stopped");
    expect(log).toEqual(["release blob:0"]);
  });

  it("the server refuses, or the phone will not play: it throws, so the button can say it cannot be read", async () => {
    const log: string[] = [];
    await expect(playAloud(fakeAudio(log), async () => null, () => true, (url) => log.push(`release ${url}`))).rejects.toThrow("refused");
    expect(log).toEqual([]);
    await expect(playAloud(fakeAudio(log, "fails"), async () => ({ url: "blob:0", parts: 1 }), () => true, (url) => log.push(`release ${url}`))).rejects.toThrow("NotAllowedError");
    expect(log).toEqual(["play blob:0", "release blob:0"]);
  });

  it("the button's handler makes the element and primes it before it asks the network for anything", () => {
    const src = readFileSync(path.join(process.cwd(), "components", "auth-ui", "AuthReadAloud.tsx"), "utf8");
    const start = src.slice(src.indexOf("function start()"));
    const made = start.indexOf("new Audio()");
    const primed = start.indexOf("primeInTap(el)");
    const fetched = start.indexOf("fetch(");
    expect(made).toBeGreaterThan(0);
    expect(primed).toBeGreaterThan(made);
    expect(fetched).toBeGreaterThan(primed);
    // nothing is awaited before the element exists: start() itself is not async, and the tap's handler calls it directly
    expect(start.slice(0, made)).not.toMatch(/await|\.then\(/);
    expect(src).not.toMatch(/async function start/);
    expect(src).toMatch(/\} else start\(\);/);
  });
});

describe("the pages are on the one set", () => {
  const source = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

  it("every page of the group takes its parts from components/auth-ui, none from the paper side or the older family parts", () => {
    for (const file of [
      ["app", "page.tsx"],
      ["app", "who", "page.tsx"],
      ["app", "login", "LoginFlow.tsx"],
      ["app", "signup", "SignupFlow.tsx"],
      ["app", "signup", "FamilySignupFlow.tsx"],
      ["app", "recover", "RecoverFlow.tsx"],
    ]) {
      const src = source(...file);
      expect(src, file.join("/")).toMatch(/from "@\/components\/auth-ui"/);
      expect(src, file.join("/")).not.toMatch(/from "@\/components\/(?:ui|account\/AccountUi|family-ui|family\/HerAccount)"/);
    }
    // Wei Ling's two pages on the way into an invitation are the daughter's line's (her own draft), not this set's
    for (const page of ["join", "login"]) expect(source("app", "invite", "[token]", page, "page.tsx"), page).not.toMatch(/components\/auth-ui/);
  });

  it("each of those pages gives the browser's bar the ground of its face's set of colours, and names no colour itself", () => {
    // the door's two pages and his recovery are one face each: a fixed export
    for (const [face, ...file] of [
      ["door", "app", "page.tsx"],
      ["door", "app", "who", "page.tsx"],
      ["elder", "app", "recover", "page.tsx"],
    ]) {
      expect(source(...file), file.join("/")).toContain(`export const viewport: Viewport = { themeColor: authThemeColor("${face}") };`);
    }
    // the log-in and the sign-up are his or his family's, by the address: the bar follows the side the page is drawn for
    for (const file of [
      ["app", "login", "page.tsx"],
      ["app", "signup", "page.tsx"],
    ]) {
      const src = source(...file);
      expect(src, file.join("/")).toMatch(/export async function generateViewport\(\{ searchParams \}: PageProps<"\/(?:login|signup)">\): Promise<Viewport> \{\s*return \{ themeColor: authThemeColor\((?:read|sideOf)\(await searchParams\)(?:\.side)?\) \};/);
      expect(src, file.join("/")).not.toMatch(/export const viewport\b/);
      // and that side is what the address says: `as`, else what `next` implies, else the elder's (components/auth-ui entrySide)
      expect(src, file.join("/")).toMatch(/entrySide\(q\.as, /);
    }
    for (const file of [
      ["app", "page.tsx"],
      ["app", "who", "page.tsx"],
      ["app", "login", "page.tsx"],
      ["app", "signup", "page.tsx"],
      ["app", "recover", "page.tsx"],
    ]) {
      expect(source(...file), file.join("/")).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("whose screen each page is: the door's two, his own (the default), and the family's by the address", () => {
    // every screen tag of a file (the code, not what a comment says), and the side it names, if it names one
    const code = (...file: string[]) => source(...file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const sides = (...file: string[]) => [...code(...file).matchAll(/<(?:AuthScreen|Screen) [^>]*>/g)].map((m) => /\sside=(\{side\}|"[a-z]+")/.exec(m[0])?.[1] ?? "(elder)");
    expect(sides("app", "page.tsx")).toEqual(['"door"']);
    expect(sides("app", "who", "page.tsx")).toEqual(['"door"']);
    // one flow for both sides of the log-in: every screen of it takes the side the page was asked for
    expect(sides("app", "login", "LoginFlow.tsx")).toEqual(["{side}", "{side}"]);
    // his nine steps and his recovery are his: no screen of them names a side
    expect([...new Set(sides("app", "signup", "SignupFlow.tsx"))]).toEqual(["(elder)"]);
    expect([...new Set(sides("app", "recover", "RecoverFlow.tsx"))]).toEqual(["(elder)"]);
    // her short sign-up is hers on every screen
    expect([...new Set(sides("app", "signup", "FamilySignupFlow.tsx"))]).toEqual(['"family"']);
    expect(sides("app", "signup", "FamilySignupFlow.tsx").length).toBe(3);
    expect(source("app", "signup", "page.tsx")).toMatch(/if \(sideOf\(q\) === "family"\) return <FamilySignupFlow /);
  });

  it("the sign-up says, under the example choice, that an example account runs on Singapore time (real-app 3.11), in both languages", () => {
    expect(accountCopy("zh-Hans").spaceExampleClock).toBe("示例账号按新加坡时间走，提醒也按新加坡时间发；人在别处也一样。");
    expect(accountCopy("en").spaceExampleClock).toBe("An example account runs on Singapore time, and its reminders come at Singapore time, wherever you are.");
    const src = source("app", "signup", "SignupFlow.tsx");
    const space = src.slice(src.indexOf('step === "space"'));
    // after the choices, before the button
    expect(space.indexOf("c.spaceExampleClock")).toBeGreaterThan(space.indexOf('testId="signup-space"'));
    expect(space.indexOf("c.spaceExampleClock")).toBeLessThan(space.indexOf("nextButton(c.finish)"));
  });
});
