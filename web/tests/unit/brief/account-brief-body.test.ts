/**
 * The account's brief as it is drawn in the timeline design (components/brief/AccountBrief.tsx BriefBody; design group
 * 14: 14-3 English with his words translated, 14-4 华语, 14-5 his words not translated), rendered to markup and read as
 * text. What the new layout must keep (real-app 2.18 and 12; lib/summary/i18n.ts):
 *
 *   - the dictionary's sentences stay whole: a count sentence is one row's words; a sentence that ends in a list is the
 *     row's two lines and still reads as the sentence it was;
 *   - the line that mirrors the doctor's number sits next to that number quoted word for word, with who said it and when;
 *   - a reading next to the doctor's warning line is a row of its own under the line's own sentence, and the line is
 *     quoted; with no such reading there is no such block;
 *   - his words stay his: read in English they carry the checked English under them, labelled as a translation; without
 *     one they are marked as not translated (a recorded summary is never called his own words); in 华语 neither;
 *   - no judging word in what Ripple itself says, in either language.
 * The translated state cannot be reached end to end on an offline server (the stand-in model translates nothing): here
 * the view is given the English a model would have returned.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { BriefBody, BriefWindow, briefWindowLine } from "@/components/brief/AccountBrief";
import { splitAtColon } from "@/components/brief/words";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import type { Locale } from "@/lib/i18n";
import { judgementHits } from "@/lib/safety/judgement";
import { MemoryStore } from "@/lib/store/memory";
import { buildAccountBrief, type AccountBriefView } from "@/lib/summary/account-brief";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
afterAll(() => setTestClock(null));

const NOTE_20 = "我今天好累。";
const NOTE_37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const ENGLISH: Record<string, string> = {
  [NOTE_20]: "I am very tired today.",
  [NOTE_37]: "Walked around Toa Payoh Central today. My ankle is a bit swollen.",
  "读数高的时候（例如 150/95）可以多吃一粒吗？": "When my reading is high (e.g. 150/95), can I take an extra tablet?",
  "膝盖止痛药还可以吃吗？": "Can I still take my knee painkiller?",
};

/** The example account laid out on Mon 12 Oct 2026 10:00, read at 10:05 (v2 on 8 Sep is the last clinic visit). */
async function exampleBrief(locale: Locale, before?: (userId: string) => Promise<void>): Promise<AccountBriefView> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `b${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  if (before) await before(a.userId);
  const at = "2026-10-12T10:05:00+08:00";
  setTestClock({ at, frozen: true });
  return buildAccountBrief(store, (await store.getSession(a.userId))!, locale, { nowMs: Date.parse(at), translate: "cache" });
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The words of an element as a browser reads them (textContent): tags dropped, nothing put between them. */
const wordsOf = (html: string) => decode(html.replace(/<[^>]+>/g, ""));
const count = (html: string, piece: string) => html.split(piece).length - 1;
const body = (view: AccountBriefView, locale: Locale, listen = false) => renderToStaticMarkup(createElement(BriefBody, { view, locale, listen }));

/** One row of a list card by a hook on it (a row holds no other row). */
function row(html: string, hook: string): string {
  const m = new RegExp(`<div[^>]*${hook}[^>]*>([\\s\\S]*?)</div>`).exec(html);
  expect(m, `a row with ${hook}`).not.toBeNull();
  return m![1];
}

/** What Ripple itself says on the page: everything except quoted words, their translations and the line mirroring the doctor's number. */
function ownWords(html: string): string {
  return textOf(
    html
      .replace(/<blockquote[\s\S]*?<\/blockquote>/g, " ")
      .replace(/<p[^>]*data-rp="said-translation"[\s\S]*?<\/p>/g, " ")
      .replace(/<p[^>]*data-verbatim="[^"]*"[\s\S]*?<\/p>/g, " ")
      .replace(/<(p|span)[^>]*data-testid="brief-english"[\s\S]*?<\/\1>/g, " ")
      .replace(/<span[^>]*data-(verbatim|recorded)="[^"]*"[\s\S]*?<\/span>/g, " ")
      .replace(/<div[^>]*data-mirror="R1"[\s\S]*?<\/div>/g, " "),
  );
}

describe("the example account's brief in the timeline design", () => {
  it("华语: whole sentences as rows, the doctor's number quoted next to its mirror, his notes in his words, three numbered questions", async () => {
    const view = await exampleBrief("zh-Hans");
    const html = body(view, "zh-Hans", true);
    const text = textOf(html);
    expect(text).toContain("记了 10 次，平均 140/85");
    expect(text).toContain("9月9日 – 10月12日");
    expect(wordsOf(row(html, 'data-testid="brief-bp-mirror"'))).toBe("其中 9 次不低于医生 8月31日 说的 135/85");
    // the doctor's own number, word for word, with who said it, the visit's date and where in the recording
    const target = /data-testid="brief-target"[^>]*data-state="confirmed"|data-state="confirmed"[^>]*data-testid="brief-target"/.test(html);
    expect(target).toBe(true);
    expect(text).toContain("医生说 · 2026年8月31日 · 0:49");
    expect(text).toContain("“At home, we want it below 135 over 85.”");
    expect(html).toMatch(/data-node="doc"/);
    // doses: the headline whole, the four counts under it, the missed mornings as the sentence it was
    expect(text).toContain("33 次中已服药 29 次");
    expect(text).toContain("应服药 33 · 已服药 29 · 未服药 4 · 未确认 0");
    expect(wordsOf(row(html, 'data-testid="brief-doses-missed"'))).toBe("未服药的 4 次都在周二、周四（打太极的早上）：9月15日、9月17日、9月24日、10月6日");
    expect(text).toContain("药：Amlodipine 5 mg");
    // his notes: his words, quoted; nothing about translation on his own page
    expect(count(html, 'data-verbatim="note"')).toBe(2);
    expect(text).toContain(`「${NOTE_20}」`);
    expect(text).toContain(`「${NOTE_37}」`);
    expect(text).toContain("本人说 · 10月7日 · 语音");
    expect(count(html, 'data-testid="brief-english"')).toBe(0);
    expect(text).not.toContain("翻译（核对过两次）");
    expect(text).not.toContain("没有翻译");
    // both notes are on topics new since the last visit: said in words, on the note
    expect(count(html, 'data-changed="true"')).toBe(2);
    expect(count(text, "上次就诊后新出现")).toBe(2);
    // the same three questions, numbered, each with where it came from
    expect([...html.matchAll(/data-testid="brief-question"[^>]*data-question="([^"]+)"/g)].map((m) => m[1])).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(wordsOf(row(html, 'data-question="q-extra-tablet"'))).toContain("记录的摘要，不是他的原话");
    expect(html).toMatch(/data-mk="num"[^>]*>1</);
    // no reading next to the warning line: no such block
    expect(html).not.toContain('data-testid="brief-above"');
    // no clip on the page for the doctor; his own page offers the doctor's recording
    expect(html).toContain('data-rp="listen"');
    expect(body(view, "zh-Hans")).not.toContain('data-rp="listen"');
  });

  it("English, his words not translated (14-5): the notes say so; a recorded summary is never called his own words", async () => {
    const view = await exampleBrief("en");
    expect(view.english).toEqual({});
    const html = body(view, "en");
    const text = textOf(html);
    expect(text).toContain("10 readings, average 140/85");
    expect(wordsOf(row(html, 'data-testid="brief-bp-mirror"'))).toBe("9 of them not below the doctor's 135/85 of 31 Aug");
    expect(text).toContain("29 of 33 doses taken");
    expect(wordsOf(row(html, 'data-testid="brief-doses-missed"'))).toBe("The 4 missed were all on Tuesdays and Thursdays (tai chi mornings): 15 Sep, 17 Sep, 24 Sep, 6 Oct");
    expect(text).toContain("Doctor said · 31 Aug 2026 · 0:49");
    // his words stay Chinese; two notes and his own question are marked as not translated
    expect(count(html, 'data-verbatim="note"')).toBe(2);
    expect(count(text, "his own words, not translated")).toBe(3);
    expect(count(html, 'data-testid="brief-english"')).toBe(0);
    const summary = wordsOf(row(html, 'data-question="q-extra-tablet"'));
    expect(summary).toContain("Recorded summary, not his own words");
    expect(summary).toContain("not translated");
    expect(summary).not.toContain("his own words, not translated");
    // the pattern is Ripple's wording in the page's language: nothing to translate
    expect(wordsOf(row(html, 'data-question="q-tai-chi"'))).not.toContain("translat");
  });

  it("English, his words translated (14-3): the checked English under his words, labelled as a translation", async () => {
    const view = { ...(await exampleBrief("en")), english: ENGLISH };
    const html = body(view, "en");
    const text = textOf(html);
    expect(count(html, 'data-testid="brief-english"')).toBe(4);
    expect(count(html, 'data-translated="true"')).toBe(2);
    // his words first, the English after them, then the label
    expect(text).toMatch(new RegExp(`「${NOTE_37}」 ${ENGLISH[NOTE_37].replace(/[.]/g, "\\.")} Translation, checked twice · his own words are what counts`));
    expect(count(text, "Translation, checked twice · his own words are what counts")).toBe(3);
    expect(count(text, "Translation, checked twice · the recorded words are what count")).toBe(1);
    expect(text).not.toContain("not translated");
    // in a row: its number, his own words, then the English
    const knee = wordsOf(row(html, 'data-question="q-knee-2"'));
    expect(knee.startsWith("3膝盖止痛药还可以吃吗？Can I still take my knee painkiller?")).toBe(true);
  });

  it("a reading next to the doctor's warning line: a row of its own under the line's sentence, and the line quoted", async () => {
    const view = await exampleBrief("zh-Hans", async (id) => {
      setTestClock({ at: "2026-10-12T10:02:00+08:00", frozen: true });
      await store.addBp(id, { day: 42, slot: "morning", systolic: 185, diastolic: 112 });
    });
    const html = body(view, "zh-Hans");
    expect(html).toMatch(/data-testid="brief-above"[^>]*data-count="1"|data-count="1"[^>]*data-testid="brief-above"/);
    expect(textOf(html)).toContain("医生说过的线（8月31日）：上面的数 180。放在它旁边的读数：");
    const reading = row(html, 'data-reading="185/112"');
    expect(textOf(reading)).toBe("185/112 10月12日 早上 10:02");
    // the line itself, in the doctor's words
    expect(count(html, 'data-rp="said"')).toBe(2);
    expect(view.above!.line.text.length).toBeGreaterThan(10);
    expect(textOf(html)).toContain(`“${view.above!.line.text}”`);
  });

  it("no judging word in what Ripple itself says, in 华语 and in English, with and without the reading next to the warning line", async () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const plain = await exampleBrief(locale);
      const withAbove = await exampleBrief(locale, async (id) => {
        setTestClock({ at: "2026-10-12T10:02:00+08:00", frozen: true });
        await store.addBp(id, { day: 42, slot: "morning", systolic: 185, diastolic: 112 });
      });
      for (const view of [plain, { ...plain, english: ENGLISH }, withAbove]) {
        expect(judgementHits(ownWords(body(view, locale))), locale).toEqual([]);
      }
    }
  });
});

describe("the brief's sentences on two lines", () => {
  it("splitAtColon: the sentence as it was, letter for letter; a clock time's colon is not a break", () => {
    for (const s of ["未服药的 4 次都在周二、周四（打太极的早上）：9月15日、9月17日", "The 4 missed were all on Tuesdays (tai chi mornings): 15 Sep, 17 Sep", "10月12日 早上 10:05：185/112", "12 Oct, 10:05 am: 185/112", "Medicine: Amlodipine 5 mg"]) {
      const parts = splitAtColon(s)!;
      expect(parts.head + parts.tail).toBe(s);
      expect(parts.lead).not.toMatch(/[:：]\s*$/);
    }
    expect(splitAtColon("12 Oct, 10:05 am: 185/112")).toMatchObject({ lead: "12 Oct, 10:05 am", tail: "185/112" });
    expect(splitAtColon("10月12日 早上 10:05：185/112")).toMatchObject({ lead: "10月12日 早上 10:05", tail: "185/112" });
    expect(splitAtColon("29 of 33 doses taken")).toBeNull();
    expect(splitAtColon("At 10:05")).toBeNull();
  });

  it("the period in a header reads exactly as briefWindowLine says it, in both languages", async () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const view = await exampleBrief(locale);
      const html = renderToStaticMarkup(createElement(BriefWindow, { view, locale, testId: "brief-window" }));
      expect(wordsOf(html)).toBe(briefWindowLine(view, locale));
    }
    expect(briefWindowLine(await exampleBrief("zh-Hans"), "zh-Hans")).toBe("上次就诊（9月8日）之后：9月9日到10月12日");
  });
});
