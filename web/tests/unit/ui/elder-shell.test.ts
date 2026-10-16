/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX */
/**
 * His screens' frame after the owner's decision of 2026-10-14 (the elder side had a lot of the same thing twice):
 *   - the bottom bar: four places, each an icon over its word, 今天 / 就诊 / 记录 / 我 (Today / Visits / Records / Me), the
 *     current one bold and purple under a 4px bar; the pages that were tabs mark the place they belong to now;
 *   - no 「按一下说 / 打字」 strip on any of his pages (the ask screen keeps its own field);
 *   - Today: his month at the top, each day marked by its doses, visit days in red, today outlined; a day he taps is
 *     listed under it; the visit's box, the blood pressure entry and 「今天说过的话」 are gone from it.
 *     Owner 10-15: every day he taps, today's too, opens as a sheet over Today (today's line stays under it).
 * Rendered on the server, no DOM; the example account is laid out in memory.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OwnDay, OwnMonth } from "@/components/daily/elder/OwnMonth";
import { SayBarLinks } from "@/components/daily/elder/SayBarLinks";
import { Screen, TabBar } from "@/components/ui";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { judgementHits } from "@/lib/safety/judgement";
import { allDailyStrings } from "@/lib/daily/i18n";
import { ownMonth } from "@/lib/daily/month";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { nowMs, setTestClock } from "@/lib/time/now";
import { contrastRatio } from "@/lib/ui/contrast";
import { TAB_HREFS, TAB_KEYS, TAB_OF, uiCopy } from "@/lib/ui/copy";

const WEB = path.resolve(__dirname, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(WEB, file), "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const labels = (out: string) => [...out.matchAll(/class="rpu-tab-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
const current = (out: string) => /<a [^>]*data-tab="(\w+)"[^>]*aria-current="page"/.exec(out)?.[1] ?? null;
/** A source file without its comments: only what it does is scanned. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(WEB, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(WEB, rel)).isDirectory()) files(rel, out);
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("his bottom bar: four places, an icon over its word", () => {
  it("今天 / 就诊 / 记录 / 我 and Today / Visits / Records / Me, each with its icon and its page", () => {
    const zh = html(createElement(TabBar, { locale: "zh-Hans", active: "today" }));
    const en = html(createElement(TabBar, { locale: "en", active: "me" }));
    expect(labels(zh)).toEqual(["今天", "就诊", "记录", "我"]);
    expect(labels(en)).toEqual(["Today", "Visits", "Records", "Me"]);
    expect(TAB_KEYS).toEqual(["today", "visit", "records", "me"]);
    expect(TAB_HREFS).toEqual({ today: "/p/today", visit: "/p/visit", records: "/p/records", me: "/p/me" });
    for (const out of [zh, en]) {
      // in each place the icon comes first, then the word; the icon is hidden from a screen reader (the word says it)
      const places = [...out.matchAll(/<a [^>]*class="rpu-tab"[^>]*data-tab="(\w+)"[^>]*>(.*?)<\/a>/g)];
      expect(places.map((m) => m[1])).toEqual(["today", "visit", "records", "me"]);
      expect(places.map((m) => /^<svg[^>]*aria-hidden="true"[^>]*data-icon="(\w+)"/.exec(m[2])?.[1])).toEqual(["home", "steth", "doc", "user"]);
      for (const key of TAB_KEYS) expect(out).toContain(`href="${TAB_HREFS[key]}"`);
      expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1);
    }
    expect(current(zh)).toBe("today");
    expect(current(en)).toBe("me");
    expect(uiCopy("en").tabs).toEqual({ today: "Today", visit: "Visits", records: "Records", me: "Me" });
  });

  it("the pages that were tabs until 10-14 mark the place they belong to now", () => {
    expect(TAB_OF).toMatchObject({ questions: "visit", bp: "records", meds: "records" });
    expect(current(html(createElement(TabBar, { locale: "zh-Hans", active: "questions" })))).toBe("visit");
    expect(current(html(createElement(TabBar, { locale: "zh-Hans", active: "bp" })))).toBe("records");
    expect(current(html(createElement(TabBar, { locale: "en", active: "meds" })))).toBe("records");
    // nothing marked where the page names no place
    expect(html(createElement(TabBar, { locale: "zh-Hans" }))).not.toContain('aria-current="page"');
  });

  it("the place he is on is told by more than colour; the places are at least 48 high; four to a line at his sizes", () => {
    const css = read("app/ripple-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");
    expect(rule(".rpu-tabs")).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).not.toMatch(/\.rpu-tabs \{ grid-template-columns: repeat\(5/);
    const tab = rule(".rpu-tab");
    expect(tab).toContain("flex-direction: column");
    expect(tab).toContain("min-height: var(--rp-tabbar-h)");
    expect(tab).toContain("font-size: min(var(--rp-fs-min), 24px)");
    expect(css).toMatch(/--rp-tabbar-h: calc\(68 \* var\(--rp-u\)\);/);
    expect(68).toBeGreaterThanOrEqual(48);
    // bold, purple and under a 4px bar: never colour alone
    expect(rule('.rpu-tab[aria-current="page"]')).toBe(" font-weight: 800; color: var(--rp-accent); box-shadow: inset 0 4px 0 var(--rp-accent); ");
    expect(rule(".rpu-tab svg")).toContain("width: min(calc(28 * var(--rp-u)), 36px)");
  });

  it("「我」 is a place of the bar: his 「我」 page carries the bar with 「我」 chosen and has no way back", () => {
    const me = code(read("app/p/me/page.tsx"));
    expect(me).toContain('tabBar={<TabBar active="me" locale={locale} />}');
    expect(me).not.toMatch(/back=\{\{ href: "\/p\/today"/);
    expect(code(read("app/p/today/page.tsx"))).toContain('tabBar={<TabBar active="today" locale={locale} />}');
  });
});

describe("no 「按一下说 / 打字」 strip on his pages", () => {
  it("no page or component of his draws the strip; the one his pages still hand to a screen draws nothing", () => {
    const sources = [...files("app/p"), ...files("components")].filter((f) => f !== "components/ui/SayBar.tsx");
    const drawing = sources.filter((f) => /<SayBar\b/.test(code(read(f))));
    expect(drawing).toEqual([]);
    expect(html(createElement(SayBarLinks, { locale: "zh-Hans" }))).toBe("");
    expect(code(read("components/daily/elder/TodayAccount.tsx"))).not.toMatch(/sayBar=|SayBar|AskSection|AskDock/);
    // a screen handed that strip keeps no room for it: the room is reserved only while a strip is on the screen
    const screen = html(createElement(Screen, { locale: "zh-Hans", tabBar: createElement(TabBar, { locale: "zh-Hans" }), tabBarPlacement: "fixed", sayBar: createElement(SayBarLinks, { locale: "zh-Hans" }), children: "x" }));
    expect(screen).not.toContain("rpu-say");
    const css = read("app/ripple-ui.css");
    expect(css).toContain('.rpu-screen[data-tabbar="fixed"][data-saybar="fixed"]:has(> .rpu-say) { --rpu-bottom: calc(var(--rp-tabbar-h) + var(--rp-saybar-h) + env(safe-area-inset-bottom)); }');
    // the ask screen keeps its own field
    expect(code(read("app/p/ask/page.tsx"))).toContain('mode="screen"');
  });
});

describe("Today: his month at the top, today's line under it", () => {
  const store = new MemoryStore();
  let scope: SessionRow;

  beforeAll(async () => {
    // the example's visits are on its days 0, 8 and 12 and the planned one on day 42, today: on 31 October one of the past
    // ones (1 October) and the planned one are in the same month
    setTestClock({ at: "2026-10-31T10:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `m${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    scope = (await store.getSession(a.userId))!;
  });
  afterAll(() => setTestClock(null));

  it("the example account's month: each day's doses marked, visit days in red, today outlined", async () => {
    const month = await ownMonth(store, scope, null, nowMs());
    expect(month.ym).toBe("2026-10");
    expect(month.day.date).toBe("2026-10-31");
    expect(month.day.isToday).toBe(true);
    const cell = (date: string) => month.cells.find((c) => c.date === date)!;
    expect(cell("2026-10-01").visit).toBe("past");
    expect(cell("2026-10-31").visit).toBe("planned");
    expect(cell("2026-10-31").isToday).toBe(true);
    const past = month.cells.filter((c) => !c.future && !c.isToday).map((c) => c.dose);
    expect(past.filter((m) => m === "taken").length).toBeGreaterThan(10);
    expect(past.some((m) => m === "missed" || m === "no_reply")).toBe(true);

    for (const locale of ["zh-Hans", "en"] as const) {
      const out = html(createElement(OwnMonth, { month, locale }));
      const day = (date: string) => new RegExp(`<a [^>]*data-testid="own-month-day-${date}"[^>]*>`).exec(out)?.[0] ?? "";
      expect(day("2026-10-01")).toContain('data-visit="past"');
      expect(day("2026-10-31")).toContain('data-visit="planned"');
      expect(day("2026-10-31")).toContain('data-today="true"');
      expect(day("2026-10-31")).toContain('aria-current="true"');
      // owner 10-15: today opens its sheet too
      expect(day("2026-10-31")).toContain('href="/p/today?d=2026-10-31"');
      expect(day("2026-10-02")).toContain('href="/p/today?d=2026-10-02"');
      expect((out.match(/data-mark="taken"/g) ?? []).length).toBeGreaterThan(10);
      // 31 days, Thursday the 1st: three empty places before it (Monday first)
      expect((out.match(/data-testid="own-month-day-/g) ?? []).length).toBe(31);
      expect((out.match(/<li aria-hidden="true"><\/li>/g) ?? []).length).toBe(3);
      // the legend says each mark the month has in words
      expect(out).toMatch(/data-legend="taken"/);
      expect(out).toMatch(/data-legend="visit"/);
      expect(out).toMatch(/data-legend="planned"/);
    }
    const zh = html(createElement(OwnMonth, { month, locale: "zh-Hans" }));
    expect(zh).toContain("2026年10月");
    expect(zh).toContain("10月1日 周四 就诊");
    expect(zh).toContain("10月31日 周六 今天 预约就诊");
    expect(zh).toContain("全部已服药");
  });

  it("red is the visit days' (the owner's red), the marks are shape and colour, each readable on his paper", () => {
    const css = read("components/daily/elder/month.css");
    expect(css).toContain("--rpu-month-visit: var(--rp-urgent);");
    // the chosen day's rows sit outside the month's section: both carry the colours
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).toMatch(/\.rpu-month,\s*\.rpu-month-day \{[^}]*--rpu-month-taken:[^}]*--rpu-month-check:[^}]*--rpu-month-visit:/);
    expect(css).toMatch(/\.rpu-month-cell\[data-visit="past"\] \.rpu-month-num \{ background: var\(--rpu-month-visit\); color: var\(--rp-white\);/);
    expect(css).toMatch(/\.rpu-month-cell\[data-visit="planned"\] \.rpu-month-num \{ box-shadow: inset 0 0 0 2\.5px var\(--rpu-month-visit\); color: var\(--rpu-month-visit\);/);
    expect(css).toMatch(/\.rpu-month-cell\[data-today="true"\] \{ border-color: var\(--rp-ink\);/);
    const taken = /--rpu-month-taken: (#[0-9A-F]{6});/i.exec(css)![1];
    const check = /--rpu-month-check: (#[0-9A-F]{6});/i.exec(css)![1];
    for (const ground of ["#F2F5F9", "#FFFFFF", "#EEE8F5"]) {
      expect(contrastRatio(taken, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(check, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#A4262C", ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio("#FFFFFF", taken)).toBeGreaterThanOrEqual(4.5);
    // not colour alone: a filled disc, a ring, a ring with a bell, a dashed ring
    expect(css).toMatch(/\[data-mark="taken"\] \{ background:/);
    expect(css).toMatch(/\[data-mark="missed"\] \{ border: 2\.5px solid/);
    expect(css).toMatch(/\[data-mark="pending"\],\s*\.rpu-month-mark\[data-mark="waiting"\] \{ border: 2px dashed/);
    // his sizes: a day 60 high at the default text size, its number 20
    expect(css).toMatch(/\.rpu-month-cell \{[^}]*min-height: calc\(60 \* var\(--rp-u\)\);/);
    expect(css).toMatch(/\.rpu-month-num \{[^}]*font-size: var\(--rp-fs-small\);/);
  });

  it("a day he taps opens as a sheet over Today: its visit, its doses with their marks and times; 关闭 goes back", async () => {
    const month = await ownMonth(store, scope, "2026-10-01", nowMs());
    expect(month.day.date).toBe("2026-10-01");
    expect(month.day.isToday).toBe(false);
    const out = html(createElement(OwnDay, { month, locale: "zh-Hans", tz: "Asia/Singapore" }));
    expect(out).toContain('data-testid="own-day"');
    expect(out).toMatch(/role="dialog" aria-modal="true"/);
    expect(out).toContain("10月1日 周四");
    expect(out).toMatch(/data-testid="own-day-visit" data-state="past"/);
    expect(out).toMatch(/data-testid="own-day-dose" data-mark="(taken|missed|no_reply)"/);
    // the way back is Today without a day, in place of this address
    expect(out).toMatch(/<a hidden="" tabindex="-1" aria-hidden="true" data-testid="own-day-today" href="\/p\/today">/);
    expect(out).toContain('data-testid="own-day-close"');
    expect(out).toContain("关闭");
    // a day of another month, or not a date, is today
    expect((await ownMonth(store, scope, "2026-09-20", nowMs())).day.date).toBe("2026-10-31");
    expect((await ownMonth(store, scope, "soon", nowMs())).day.date).toBe("2026-10-31");
  });

  it("the page puts the month first and opens the day he chose as a sheet over it; the removed cards are not on it", () => {
    const page = code(read("app/p/today/page.tsx"));
    expect(page).toContain("ownMonth(store, session, one(sp.d), nowMs)");
    expect(page).toContain("month={<OwnMonth month={month} locale={locale} />}");
    // owner 10-15: the day named in the address (today's too) is a sheet over Today, not in the line's place
    expect(page).toContain("const opened = one(sp.d) === month.day.date ? month.day.date : null;");
    expect(page).toContain("{opened ? <OwnDay key={opened} month={month} locale={locale} tz={scopeTz(session)} /> : null}");
    expect(page).not.toContain("otherDay=");
    for (const gone of ["CountdownSection", "BpSection", "ChatSection", "AskSection", "chatToday", "askVoiceAvailable"]) expect(page, gone).not.toContain(gone);
    const account = code(read("components/daily/elder/TodayAccount.tsx"));
    expect(account).toContain('{overview && month ? <section data-today-section="month">{month}</section> : null}');
    expect(account).toContain("{dayShown ? otherDay : null}");
    expect(account).not.toMatch(/data-today-section="(countdown|bp|chat|diet|watch)"/);
    // the dose card is the core: its buttons and its words are where they were
    for (const hook of ['data-testid="dose-taken"', 'data-testid="dose-missed"', 'data-testid="dose-later"', 'data-testid="dose-reasons"', 'data-testid="undo-toast"']) expect(account).toContain(hook);
  });

  it("the month's words judge nothing, in both languages, and use the app's professional words", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const month = allDailyStrings(locale).filter(([key]) => key.startsWith("today.month."));
      expect(month.length).toBe(16);
      for (const [key, s] of month) {
        expect(judgementHits(s), `${locale} ${key}: ${s}`).toEqual([]);
        expect(s, `${locale} ${key}`).not.toMatch(/吃了|没吃|看诊/);
      }
    }
  });
});
