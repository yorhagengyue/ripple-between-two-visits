/**
 * 「记录」 (/p/records; owner's decision of 2026-10-14: the elder's four tabs are 今天 / 就诊 / 记录 / 我, and 记录 holds his
 * medicines, his blood pressure and everything else he keeps). The page is a server component: here it is called as
 * one, with the page's subject stood in, and what it returns is rendered to HTML (no browser).
 *
 * On the example account laid out on Thu 15 Oct 2026 (day 42; its last reading, day 39, falls on Monday of this week),
 * in both languages: his medicines, each with when he takes it in the slot words and where that comes from; this
 * week's readings in short (the latest with its day, the week's count, the doctor's number); 「记录一次血压」 and the ways
 * on; his notes as a row of their own and their screen; what he said to Ripple once there is some; the old pages under
 * it go back to it; a demo session is sent to its Today. No label says 吃了 / 没吃 / 量血压, and none of the screen's own
 * words judges anything.
 */
import { randomUUID } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { allRecordsStrings } from "@/lib/records/copy";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import { pageSubjectFor, selfSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";

const page = vi.hoisted(() => ({ ctx: null as unknown, locale: "zh-Hans" as "zh-Hans" | "en" }));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  getPageSubject: async () => page.ctx,
}));
vi.mock("@/lib/session/server", () => ({ getPatientLocale: async () => page.locale }));
// client components on these screens ask for the router (the page re-reads itself at the doctor's plan's moments);
// a server render has none
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));

import RecordsPage from "@/app/p/records/page";
import MedsPage from "@/app/p/meds/page";
import BpPage from "@/app/p/bp/page";

const store = getMemoryStore();
let him: TestAccount;

beforeAll(async () => {
  setTestClock({ at: "2026-10-15T10:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `rec${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
});
afterAll(() => {
  setTestClock(null);
  page.ctx = null;
});

/** His own account as a page has it, read now. */
async function asHim(locale: "zh-Hans" | "en"): Promise<void> {
  const scope = (await store.getSession(him.userId))!;
  page.ctx = pageSubjectFor(selfSubject(store, scope, him.userId));
  page.locale = locale;
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The words of the screen as a reader meets them: tags dropped, runs of space as one. */
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * A page rendered as the server would, without the server: what it returns, and when that is an async server component
 * (/p/meds hands its screen to AccountMedsPage, /p/bp to AccountBp), what that component returns, until a screen of
 * plain and client components is left for the markup.
 */
async function render(Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement | null>, query: Record<string, string> = {}): Promise<string> {
  let el = await Page({ searchParams: Promise.resolve(query) });
  while (el && typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") {
    el = await (el.type as (props: unknown) => Promise<ReactElement | null>)(el.props);
  }
  return el ? renderToStaticMarkup(el) : "";
}
const records = (query: Record<string, string> = {}) => render(RecordsPage as never, query);

/** The element that carries a test hook, with everything inside it (a hook on a <section>, a row's <a> or <div>). */
function part(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(open))![1];
  // the element ends where its own closing tag balances the ones of the same name opened inside it
  let depth = 0;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = open;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open, re.lastIndex);
  }
  return html.slice(open);
}
const hrefOf = (html: string) => decode(/ href="([^"]*)"/.exec(html)?.[1] ?? "");

/** A label in the old words: 吃了 / 没吃 / 量血压 (测量血压 is the professional word and allowed). */
const OLD_WORDS = /吃了|没吃|(?<!测)量血压/;
/** The bar's place 「记录」 marked as the one in use. */
const CURRENT_RECORDS = /data-tab="records" aria-current="page"/;

describe("「记录」 on the example account", () => {
  it("华语: his medicines with when he takes them, this week's readings in short, 「记录一次血压」, his notes; the bar shows 「记录」", async () => {
    await asHim("zh-Hans");
    const html = await records();
    expect(html).toContain('data-testid="page-records"');
    expect(textOf(html)).toContain("记录");

    // 药物: one row each, opening its card; the slot words and where they come from
    const meds = part(html, "records-meds");
    expect(meds).toContain(">药物<");
    const aml = part(meds, "records-med-med-amlodipine");
    expect(textOf(aml)).toContain("Amlodipine 5 mg");
    expect(textOf(aml)).toContain("氨氯地平");
    expect(textOf(aml)).toContain("早间服用 · 依药品标签");
    expect(hrefOf(aml)).toBe("/p/meds/med-amlodipine");
    const ibu = part(meds, "records-med-med-ibuprofen");
    expect(textOf(ibu)).toContain("Ibuprofen 200 mg");
    expect(textOf(ibu)).toContain("布洛芬");
    // the box nobody identified says so, and the medicine prescribed at today's planned visit is not there yet
    expect(textOf(part(meds, "records-med-med-relative-box"))).toMatch(/认不出|未在服用|带去给医生看/);
    expect(meds).not.toContain("records-med-med-losartan");
    expect(hrefOf(part(meds, "records-meds-add"))).toBe("/p/meds/add?next=/p/records");
    expect(textOf(part(meds, "records-meds-add"))).toBe("拍药袋新增药物");
    expect(hrefOf(part(meds, "records-meds-all"))).toBe("/p/meds");

    // 血压: the latest reading with its day, this week's count, the doctor's number; the record action and 「看全部」
    const bp = part(html, "records-bp");
    expect(bp).toContain(">血压<");
    const latest = part(bp, "records-bp-latest");
    expect(latest).toContain('data-reading="138/82"');
    expect(textOf(latest)).toContain("138/82");
    // an earlier day's reading: its day and its part of the day, as the week's rows say it (not the time it was laid out)
    expect(textOf(latest)).toContain("最近一次 · 10月12日 早间");
    const week = part(bp, "records-bp-week");
    expect(week).toContain('data-count="1"');
    expect(textOf(week)).toBe("本周 1 次");
    const target = part(bp, "records-bp-target");
    expect(textOf(target)).toContain("医生说过的数字");
    expect(target).toMatch(/data-target="\d+\/\d+"/);
    const record = part(bp, "records-bp-record");
    expect(hrefOf(record)).toBe("/p/bp?do=record");
    expect(textOf(record)).toBe("记录一次血压");
    expect(hrefOf(part(bp, "records-bp-all"))).toBe("/p/bp");
    expect(textOf(part(bp, "records-bp-all"))).toBe("看全部");

    // 其他记录: his two notes; no conversation with Ripple yet, so no row for it
    const other = part(html, "records-other");
    expect(other).toContain(">其他记录<");
    const notes = part(other, "records-notes");
    expect(notes).toContain('data-count="2"');
    expect(textOf(notes)).toBe("笔记 2 条");
    expect(hrefOf(notes)).toBe("/p/records?view=notes");
    expect(other).not.toContain("records-chat");

    // the bar: 「记录」 is the place in use
    expect(html).toMatch(CURRENT_RECORDS);
    // the screen's own words: no label in the old words
    expect(textOf(html)).not.toMatch(OLD_WORDS);
  });

  it("English: the same screen in English words", async () => {
    await asHim("en");
    const html = await records();
    const meds = part(html, "records-meds");
    expect(meds).toContain(">Medicines<");
    const aml = textOf(part(meds, "records-med-med-amlodipine"));
    expect(aml).toContain("Amlodipine 5 mg");
    expect(aml).toContain("Morning · as the label says");
    expect(textOf(part(meds, "records-med-med-ibuprofen"))).toContain("Ibuprofen 200 mg");
    expect(textOf(part(meds, "records-meds-add"))).toBe("Photograph a label to add");

    const bp = part(html, "records-bp");
    expect(bp).toContain(">Blood pressure<");
    expect(textOf(part(bp, "records-bp-latest"))).toContain("Latest · 12 Oct Morning");
    expect(textOf(part(bp, "records-bp-week"))).toBe("1 this week");
    expect(textOf(part(bp, "records-bp-target"))).toContain("The number the doctor gave");
    expect(textOf(part(bp, "records-bp-record"))).toBe("Record a reading");
    expect(textOf(part(bp, "records-bp-all"))).toBe("See all");
    expect(part(bp, "records-bp-all")).toContain('aria-label="See all blood pressure readings"');

    expect(textOf(part(html, "records-notes"))).toBe("Notes 2");
    // ?lang= renders the screen in that language whatever the cookie says
    page.locale = "zh-Hans";
    expect(textOf(part(await records({ lang: "en" }), "records-bp-record"))).toBe("Record a reading");
  });

  it("his notes: their own screen, newest first, the day and how he left each, and the way back to 「记录」", async () => {
    await asHim("zh-Hans");
    const html = await records({ view: "notes" });
    const view = part(html, "records-notes-view");
    expect(view).toContain('data-count="2"');
    const words = textOf(view);
    // the seed's two notes: day 37 spoken, day 20 typed
    expect(words.indexOf("今天在大巴窑中心走了一圈，脚踝有点肿。")).toBeGreaterThan(-1);
    expect(words.indexOf("今天在大巴窑中心走了一圈，脚踝有点肿。")).toBeLessThan(words.indexOf("我今天好累。"));
    expect(words).toContain("语音");
    expect(words).toContain("打字");
    expect(html).toMatch(/<a [^>]*href="\/p\/records"[^>]*data-rp="back"|<a [^>]*data-rp="back"[^>]*href="\/p\/records"/);
  });

  it("a reading he records today: the latest, with the time he recorded it, and one more in the week's count", async () => {
    await asHim("zh-Hans");
    const scope = (await store.getSession(him.userId))!;
    const today = await store.addBp(him.userId, { day: scope.story_day, slot: "morning", systolic: 131, diastolic: 84, created_at: "2026-10-15T08:05:00+08:00" });
    const bp = part(await records(), "records-bp");
    const latest = part(bp, "records-bp-latest");
    expect(latest).toContain(`data-id="${today.id}"`);
    expect(textOf(latest)).toBe("131/84 最近一次 · 今天 早上 8:05");
    expect(part(bp, "records-bp-week")).toContain('data-count="2"');
    expect(textOf(part(bp, "records-bp-week"))).toBe("本周 2 次");
    await asHim("en");
    const en = part(await records(), "records-bp");
    expect(textOf(part(en, "records-bp-latest"))).toBe("131/84 Latest · Today 8:05 am");
    expect(textOf(part(en, "records-bp-week"))).toBe("2 this week");
    // nothing said about the numbers: no word judges them, in either language
    expect(judgementHits(textOf(bp))).toEqual([]);
    expect(judgementHits(textOf(en))).toEqual([]);
  });

  it("what he said to Ripple is a row once there is some, with its count, opening /p/chat", async () => {
    await asHim("zh-Hans");
    const scope = (await store.getSession(him.userId))!;
    await store.addChatMessage(him.userId, { day: scope.story_day, role: "patient", text: "今天会下雨吗？" });
    const chat = part(await records(), "records-chat");
    expect(chat).toContain('data-count="1"');
    expect(textOf(chat)).toBe("和 Ripple 说过的话 1 句");
    expect(hrefOf(chat)).toBe("/p/chat");
  });

  it("the old pages are under it: /p/meds and the blood pressure week go back to 「记录」, with 「记录」 in the bar", async () => {
    await asHim("zh-Hans");
    const meds = await render(MedsPage as never);
    expect(meds).toMatch(/<a [^>]*href="\/p\/records"[^>]*data-rp="back"|<a [^>]*data-rp="back"[^>]*href="\/p\/records"/);
    expect(meds).toMatch(CURRENT_RECORDS);
    const bp = await render(BpPage as never);
    expect(bp).toContain('data-mode="week"');
    expect(bp).toMatch(/<a [^>]*href="\/p\/records"[^>]*data-rp="back"|<a [^>]*data-rp="back"[^>]*href="\/p\/records"/);
    expect(bp).toMatch(CURRENT_RECORDS);
  });

  it("a demo session (the judges' sandbox) keeps its own tabs: it is sent to its Today", async () => {
    const demo = await store.createSession({ ttl_hours: 1 });
    page.ctx = { subject: { kind: "demo", relation: "demo", userId: null }, session: demo, store };
    let to = "";
    try {
      await records();
    } catch (err) {
      const digest = String((err as { digest?: unknown }).digest ?? "");
      if (!digest.startsWith("NEXT_REDIRECT;")) throw err;
      to = digest.split(";")[2] ?? "";
    }
    expect(to).toBe("/p/today");
  });
});

describe("the screen's own words", () => {
  it("both languages have every word; none is in the old words or judges anything", () => {
    const zh = new Map(allRecordsStrings("zh-Hans"));
    const en = new Map(allRecordsStrings("en"));
    expect([...en.keys()].sort()).toEqual([...zh.keys()].sort());
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const [key, s] of allRecordsStrings(locale)) {
        expect(s, `${locale} ${key}`).not.toMatch(OLD_WORDS);
        // every word of the screen is free of the list (「拍药袋新增药物」: 「加药」 is the word list's dose change)
        const hits = judgementHits(s);
        expect(hits, `${locale} ${key}: ${s}`).toEqual([]);
        expect(s, `${locale} ${key}`).not.toMatch(/偏高|偏低|正常|危险|太高|太低|达标|\bhigh\b|\blow\b|\bnormal\b|\bgood\b|\bbad\b|danger/i);
      }
    }
  });
});
