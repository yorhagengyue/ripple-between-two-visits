/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX */
/**
 * Owner 10-15, the demo video: both calendars mark a day with a reading outside the target his doctor set (the one rule of
 * lib/daily/bp-target.ts, the same as her 「留意」 and the blood pressure page's card), every day opens as a sheet, and the
 * sheet lists the day's doses, readings (the one outside the target highlighted with what he said that day under it),
 * notes and visit (time, clinic, doctor). Hers follows his switches: no readings without bp_summary, no words of his
 * without notes. The words judge nothing.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OwnDay, OwnMonth } from "@/components/daily/elder/OwnMonth";
import { MonthDaySheet } from "@/components/family-ui/MonthDaySheet";
import { OutsideMark } from "@/components/family-ui/MonthGrid";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { herRecord } from "@/lib/care/record";
import { familyMonth, monthShown } from "@/lib/care/month";
import { mc, monthKeys } from "@/lib/care/month-copy";
import { saveReadingReason } from "@/lib/daily/bp-reason";
import { outsideTarget } from "@/lib/daily/bp-target";
import { allDayStrings } from "@/lib/daily/day-copy";
import { ownMonth } from "@/lib/daily/month";
import { NO_GRANTS } from "@/lib/family/types";
import { judgementHits } from "@/lib/safety/judgement";
import { MemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems, SessionRow } from "@/lib/store/types";
import { nowMs, setTestClock } from "@/lib/time/now";

const WORDS = "今天打太极，所以没怎么吃午饭。";
const TODAY = "2026-10-15";
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the calendars on the example account, after 152/96 and his words about the day", () => {
  const store = new MemoryStore();
  let scope: SessionRow;
  let readingId: string;

  beforeAll(async () => {
    // the example's today is its story day 42 (d0 3 Sep); R1 135/85 was given at v1 on 3 Sep; v3 is today at 10:30
    setTestClock({ at: "2026-10-15T09:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `m${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    scope = (await store.getSession(a.userId))!;
    setTestClock({ at: "2026-10-15T09:20:00+08:00", frozen: true });
    readingId = (await store.addBp(scope.id, { day: 42, slot: "morning", systolic: 152, diastolic: 96, state: "recorded" })).id;
    await store.addBp(scope.id, { day: 42, slot: "morning", systolic: 128, diastolic: 80, state: "recorded" });
    await saveReadingReason(store, scope, { readingId, text: WORDS }, { locale: "en", llm: null, publish: () => undefined as never });
    await store.addNote(scope.id, { day: 42, text: "早上喝了一杯咖啡。", source: "typed", lang: "zh-Hans" });
  });
  afterAll(() => setTestClock(null));

  it("her month: the day is marked, the reading outside the target carries his words, the visit its time and doctor", async () => {
    const month = await familyMonth(store, scope, ALL, { d: TODAY }, nowMs());
    expect(month.target).toMatchObject({ systolic: 135, diastolic: 85, date: "2026-09-03", doctor: { short: "Dr Lim" } });
    const today = month.cells.find((c) => c.date === TODAY)!;
    expect(today).toMatchObject({ bp: true, bpAbove: true, visit: "planned", isToday: true });
    // the template's readings this month, by the same rule (148/85 on 1 Oct is outside: 148 is over 135)
    expect(month.cells.find((c) => c.date === "2026-10-01")?.bpAbove).toBe(true);
    const day = month.day;
    expect(day.bp?.map((r) => [r.systolic, r.diastolic, r.above])).toEqual([
      [152, 96, true],
      [128, 80, false],
    ]);
    expect(day.bp?.[0].reason).toMatchObject({ text: WORDS, lang: "zh-Hans" });
    expect(day.bp?.[1].reason).toBeNull();
    // his other note of the day is a note; what he said about the reading stands under it, not twice
    expect(day.notes?.map((n) => n.text)).toEqual(["早上喝了一杯咖啡。"]);
    expect(day.visits).toEqual([expect.objectContaining({ id: "v3", state: "planned", time: "10:30", place: "Blossom Family Clinic (fictional)", doctor: expect.objectContaining({ name: "Dr Lim Wei Ming (fictional)" }) })]);
    expect(day.questions?.find((q) => q.origin === "reading")?.text).toContain(WORDS);
    expect(monthShown(ALL)).toContain("notes");
  });

  it("her switches decide: no readings and no mark without bp_summary, none of his words without notes", async () => {
    const noNotes = await familyMonth(store, scope, { ...ALL, notes: false }, { d: TODAY }, nowMs());
    expect(noNotes.day.bp?.[0]).toMatchObject({ above: true, reason: null });
    expect(noNotes.day.notes).toBeNull();
    expect(noNotes.shown).not.toContain("notes");
    const noBp = await familyMonth(store, scope, { ...ALL, bp_summary: false }, { d: TODAY }, nowMs());
    expect(noBp.day.bp).toBeNull();
    expect(noBp.target).toBeNull();
    expect(noBp.cells.some((c) => c.bp || c.bpAbove)).toBe(false);
    // with his readings off, what he said about one is one of the day's notes (his words, under the notes switch)
    expect(noBp.day.notes?.map((n) => n.text)).toContain(WORDS);
    const visitsOnly = await familyMonth(store, scope, { ...NO_GRANTS, questions_count: true }, { d: TODAY }, nowMs());
    expect(visitsOnly.day.visits?.[0]).toMatchObject({ time: "10:30" });
    expect(visitsOnly.day.notes).toBeNull();
    expect(visitsOnly.day.bp).toBeNull();
    // notes alone make no calendar
    expect(monthShown({ ...NO_GRANTS, notes: true })).toEqual([]);
  });

  it("her 留意 and both calendars mark the same days (one rule)", async () => {
    const month = await familyMonth(store, scope, ALL, { d: TODAY }, nowMs());
    const rule = month.target ? { systolic: month.target.systolic, diastolic: month.target.diastolic, since: 0 } : null;
    const readings = await store.listBp(scope.id, { fromDay: 28, toDay: 42 });
    const days = new Set(readings.filter((r) => outsideTarget(r, rule)).map((r) => r.day));
    expect(month.cells.filter((c) => c.bpAbove).length).toBe(days.size);
    const his = await ownMonth(store, scope, TODAY, nowMs());
    expect(his.cells.map((c) => c.bpAbove)).toEqual(month.cells.map((c) => c.bpAbove));
    // her 留意 says today's reading is above the doctor's target too
    const record = await herRecord(store, scope, { link: { id: "no-such-link" }, grants: ALL, acknowledged: true, locale: "en" }, nowMs());
    // (the days fold into one item, the newest day's: today's 152/96 leads it)
    expect(record.entries.find((e) => e.id === `bp:${readingId}`)).toMatchObject({ attention: true, attn: "bp_high", title: expect.stringMatching(/^Blood pressure above the doctor's target of 135\/85 on \d+ days in the last 14$/) });
  });

  it("his month: today marked; today's sheet lists the visit at 10:30 with Dr Lim, the reading with his words, his medicine, notes and the question", async () => {
    const month = await ownMonth(store, scope, TODAY, nowMs());
    const grid = html(createElement(OwnMonth, { month, locale: "en" }));
    const cell = new RegExp(`<a [^>]*data-testid="own-month-day-${TODAY}"[^>]*>`).exec(grid)?.[0] ?? "";
    expect(cell).toContain('data-outside="true"');
    expect(cell).toContain(`href="/p/today?d=${TODAY}"`);
    expect(grid).toContain('data-legend="outside"');
    expect(grid).toContain("Reading outside your doctor&#x27;s target");
    expect(grid).toMatch(/data-mark="outside"/);

    const sheet = html(createElement(OwnDay, { month, locale: "en", tz: "Asia/Singapore" }));
    expect(sheet).toContain("Thu 15 Oct · Today");
    expect(sheet).toMatch(/data-testid="own-day-visit" data-state="planned" data-time="10:30"/);
    expect(sheet).toContain("Planned visit · 10:30 am");
    expect(sheet).toContain("Blossom Family Clinic (fictional)");
    expect(sheet).toContain("Dr Lim Wei Ming (fictional)");
    expect(sheet).toMatch(/data-testid="own-day-bp" data-outside="true" data-reading="152\/96"/);
    expect(sheet).toContain("Outside the target Dr Lim set: 135/85 (3 Sep)");
    expect(sheet).toContain(`Noted: “${WORDS}”`);
    expect(sheet).toMatch(/data-testid="own-day-bp" data-reading="128\/80"/);
    expect(sheet).toContain("早上喝了一杯咖啡。");
    expect(sheet).toMatch(/data-testid="own-day-question" data-origin="reading"/);
    expect(sheet).toContain("From a blood pressure reading");
    expect(sheet).toContain('data-testid="own-day-dose"');
    // in Chinese the same
    const zh = html(createElement(OwnDay, { month, locale: "zh-Hans", tz: "Asia/Singapore" }));
    expect(zh).toContain("超出了林医生定的目标：135/85（9月3日）");
    expect(zh).toContain(`记下了：「${WORDS}」`);
    expect(zh).toContain("林伟明医生（虚构）");
    expect(zh).toContain("预约就诊 · 早上 10:30");
  });

  it("her sheet's frame and mark render on their own (the rows are the page's)", () => {
    const out = html(createElement(MonthDaySheet, { date: TODAY, title: "10月15日 周四", today: "今天", closeHref: "/f/month?link=l1", closeLabel: mc("zh-Hans", "close"), children: createElement("ul", { className: "rpf-month-rows" }) }));
    expect(out).toMatch(/data-testid="month-sheet" data-date="2026-10-15"/);
    expect(out).toContain('data-testid="month-sheet-close"');
    expect(out).toMatch(/data-testid="month-sheet-back" href="\/f\/month\?link=l1"/);
    expect(html(createElement(OutsideMark, { label: mc("en", "lg_bpAbove") }))).toContain('aria-label="Blood pressure above the doctor&#x27;s target"');
  });
});

describe("the words", () => {
  it("his sheet's words judge nothing, in both languages (a reading is outside his doctor's target, never high)", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const [key, s] of allDayStrings(locale)) {
        expect(judgementHits(s), `${locale} ${key}: ${s}`).toEqual([]);
        expect(s, `${locale} ${key}`).not.toMatch(/偏高|偏低|正常|异常|危险|\bhigh\b|\blow\b|\bnormal\b|\babnormal\b|danger/i);
      }
    }
  });

  it("her new words name the doctor's target as her 「留意」 does, with nothing that judges", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const key of ["lg_bpAbove", "bpAbove", "bpReason", "noteSub", "fromReading", "close"] as const) {
        expect(monthKeys()).toContain(key);
        const s = mc(locale, key, { dad: "Mum", doctor: "Dr Lim", target: "135/85", date: "3 Sep", words: WORDS });
        expect(s, `${locale} ${key}`).not.toMatch(/偏高|正常|异常|危险|\bhigh\b|\bnormal\b|\babnormal\b|danger/i);
      }
    }
    expect(mc("en", "bpAbove", { doctor: "Dr Lim", target: "135/85", date: "3 Sep" })).toBe("Above the target Dr Lim set: 135/85 (3 Sep)");
    expect(mc("zh-Hans", "bpReason", { dad: "爸爸", words: WORDS })).toBe(`爸爸记下：「${WORDS}」`);
  });
});
