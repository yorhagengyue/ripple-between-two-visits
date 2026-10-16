/**
 * Today's general states as the server draws them (the timeline design's 通用-1 and 通用-5):
 *   - this phone's reminders (components/today/PushPrompt.tsx): nothing at all from the server, because only the
 *     browser knows whether the phone was ever asked;
 *   - Today while it opens: no loading file of its own. The words for a page that is on its way are the tab bar's
 *     (components/ui/TabWait.tsx, tests/unit/ui/tab-wait.test.ts): with app/p/today/loading.tsx the page arrived in
 *     two parts and what was under the boundary answered taps later than its frame did.
 * What the browser does with them is in e2e/real-daily.spec.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PushPrompt } from "@/components/today/PushPrompt";

const WEB = path.resolve(__dirname, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(WEB, file), "utf8");

describe("Today while it opens (通用-1)", () => {
  it("has no loading boundary of its own: the page comes whole, so every part of it answers a tap as soon as its frame does", () => {
    for (const name of ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"]) expect(existsSync(path.join(WEB, "app", "p", "today", name)), name).toBe(false);
  });

  it("its page still neither redirects nor says not-found by itself", () => {
    expect(read("app/p/today/page.tsx")).not.toMatch(/\b(redirect|permanentRedirect|notFound)\(/);
  });
});

describe("this phone's reminders, offered on Today (通用-5a to 5d)", () => {
  it("the server draws nothing: whether the phone was asked is known only in the browser", () => {
    expect(renderToStaticMarkup(createElement(PushPrompt, { locale: "zh-Hans", time: "8:45" }))).toBe("");
    expect(renderToStaticMarkup(createElement(PushPrompt, { locale: "en", time: "8:45" }))).toBe("");
  });

  it("Today offers it on his own phone only, for the first reminder of the day, and not while the example's intro is up", () => {
    const page = read("app/p/today/page.tsx");
    expect(page).toContain("{selfId && firstReminder && !introUp ? <PushPrompt locale={locale} time={shortTime(firstReminder)} /> : null}");
  });

  it("asks the browser only through the tap on 「开提醒」, by the same path as 「我 › 提醒和通知」, and fetches nothing to decide what to show", () => {
    const src = read("components/today/PushPrompt.tsx");
    const code = src.slice(src.indexOf("*/") + 2);
    expect(code).toContain('import { blockedState, enablePush } from "@/lib/push/client";');
    expect(code).not.toMatch(/requestPermission|fetch\(/);
    expect((code.match(/enablePush\(/g) ?? []).length).toBe(1);
    expect(code).toContain("onClick={() => void turnOn()}");
  });
});
