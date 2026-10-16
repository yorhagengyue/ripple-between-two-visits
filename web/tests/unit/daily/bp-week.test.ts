/**
 * The week of blood pressure readings as the week view and Today's cell count it (components/bp/week.ts), and the
 * screens' own words (components/bp/copy.ts): design group 03 of the timeline draft. Pure functions, no store.
 */
import { describe, expect, it } from "vitest";
import { allBpStrings, bpc, weekCountWords } from "@/components/bp/copy";
import { addDays, earliestMonday, mondayOf, plotModel, weekSoFar, weekView, weeksBetween, type WeekReading } from "@/components/bp/week";
import { judgementHits } from "@/lib/safety/judgement";

let n = 0;
function reading(date: string, part: "morning" | "evening", systolic: number | null, diastolic: number | null, time = part === "morning" ? "08:10" : "20:10"): WeekReading {
  const recorded = systolic !== null && diastolic !== null;
  return { id: `r${++n}`, date, part, time, systolic, diastolic, pulse: null, state: recorded ? "recorded" : "unconfirmed", editable: false };
}

describe("a week is Monday to Sunday of the calendar", () => {
  it("mondayOf: every day of a week gives its Monday, across a month's end", () => {
    // Mon 14 Sep 2026 ... Sun 20 Sep 2026
    for (const d of ["2026-09-14", "2026-09-16", "2026-09-19", "2026-09-20"]) expect(mondayOf(d)).toBe("2026-09-14");
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
    // Thu 1 Oct 2026 is in the week of Mon 28 Sep
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(addDays("2026-09-28", 6)).toBe("2026-10-04");
    expect(weeksBetween("2026-08-31", "2026-10-12")).toBe(6);
  });

  it("the earliest week is the one of his first row; the current week when he has none", () => {
    expect(earliestMonday([], "2026-10-13")).toBe("2026-10-12");
    expect(earliestMonday([reading("2026-09-01", "morning", 137, 93), reading("2026-10-12", "morning", 126, 82)], "2026-10-13")).toBe("2026-08-31");
    // a row dated after today never moves the start forward
    expect(earliestMonday([reading("2026-10-13", "morning", 126, 82)], "2026-10-13")).toBe("2026-10-12");
  });
});

describe("weekView", () => {
  const rows = [
    reading("2026-09-14", "morning", 126, 82),
    reading("2026-09-18", "morning", 142, 85),
    reading("2026-09-18", "evening", 150, 95),
    reading("2026-09-17", "evening", null, null),
    reading("2026-09-21", "morning", 148, 85),
  ];

  it("holds only the week's rows, newest first; a reading not taken is counted apart and never averaged", () => {
    const w = weekView(rows, "2026-09-14");
    expect(w.sunday).toBe("2026-09-20");
    expect(w.rows.map((r) => `${r.date} ${r.part} ${r.state}`)).toEqual(["2026-09-18 evening recorded", "2026-09-18 morning recorded", "2026-09-17 evening unconfirmed", "2026-09-14 morning recorded"]);
    expect(w.recorded.map((r) => r.systolic)).toEqual([126, 142, 150]);
    expect(w.facts).toEqual({ count: 3, unconfirmed: 1, avgSystolic: 139, avgDiastolic: 87, topSystolic: 150 });
  });

  it("no reading is counted against the doctor's number on this screen (that count is the brief's)", () => {
    expect(Object.keys(weekView(rows, "2026-09-14").facts).sort()).toEqual(["avgDiastolic", "avgSystolic", "count", "topSystolic", "unconfirmed"]);
  });

  it("an empty week has no average and no highest number", () => {
    expect(weekView(rows, "2026-09-07").facts).toEqual({ count: 0, unconfirmed: 0, avgSystolic: null, avgDiastolic: null, topSystolic: null });
  });
});

describe("weekSoFar (Today's 「本周 2 次」)", () => {
  it("counts readings with both numbers from Monday to today, and names each day once", () => {
    const rows = [
      reading("2026-09-13", "morning", 130, 80), // last week's Sunday
      reading("2026-09-14", "morning", 126, 82),
      reading("2026-09-18", "morning", 142, 85),
      reading("2026-09-18", "evening", 150, 95),
      reading("2026-09-16", "evening", null, null), // not taken: not a reading
    ];
    expect(weekSoFar(rows, "2026-09-19")).toEqual({ count: 3, days: ["2026-09-14", "2026-09-18"] });
    expect(weekSoFar(rows, "2026-09-14")).toEqual({ count: 1, days: ["2026-09-14"] });
    expect(weekSoFar([], "2026-09-19")).toEqual({ count: 0, days: [] });
  });
});

describe("plotModel", () => {
  const today = "2026-09-19";
  it("the draft's week: 70 to 160, one bar on Monday and one on Friday, each with its reading written", () => {
    const w = weekView([reading("2026-09-14", "morning", 126, 82), reading("2026-09-18", "morning", 142, 85)], "2026-09-14");
    const m = plotModel(w, today, [135, 85]);
    expect([m.low, m.high]).toEqual([70, 160]);
    expect(m.labelled).toBe(true);
    expect(m.days.map((d) => d.bars.length)).toEqual([1, 0, 0, 0, 1, 0, 0]);
    expect(m.days.map((d) => d.today)).toEqual([false, false, false, false, false, true, false]);
  });

  it("a reading outside the scale widens it by tens: no bar is cut short", () => {
    const w = weekView([reading("2026-09-18", "evening", 186, 96), reading("2026-09-15", "morning", 104, 62)], "2026-09-14");
    const m = plotModel(w, today, [135, 85]);
    expect(m.high).toBeGreaterThanOrEqual(190);
    expect(m.high % 10).toBe(0);
    expect(m.low).toBeLessThanOrEqual(60);
    expect(m.low % 10).toBe(0);
  });

  it("two readings on a day stand side by side, the morning first, and then no bar carries its numbers", () => {
    const w = weekView([reading("2026-09-15", "evening", 141, 94), reading("2026-09-15", "morning", 137, 93)], "2026-09-14");
    const m = plotModel(w, today, []);
    expect(m.days[1].bars.map((b) => b.part)).toEqual(["morning", "evening"]);
    expect(m.labelled).toBe(false);
  });

  it("neighbouring days whose readings would be written over each other get no numbers either", () => {
    const close = weekView([reading("2026-09-15", "morning", 140, 90), reading("2026-09-16", "morning", 142, 88)], "2026-09-14");
    expect(plotModel(close, today, []).labelled).toBe(false);
    const apart = weekView([reading("2026-09-15", "morning", 120, 80), reading("2026-09-16", "morning", 150, 88)], "2026-09-14");
    expect(plotModel(apart, today, []).labelled).toBe(true);
  });
});

describe("the blood pressure screens' own words", () => {
  it("no word in either language judges a reading", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const [key, s] of allBpStrings(locale)) {
        expect(judgementHits(s), `${locale} ${key}: ${s}`).toEqual([]);
        expect(s, `${locale} ${key}`).not.toMatch(/偏高|偏低|正常|危险|太高|太低|达标|\bhigh\b|\blow\b|\bnormal\b|\bgood\b|\bbad\b|danger/i);
      }
    }
  });

  it("both languages have every sentence, and every value of the Chinese one has its place in the English one", () => {
    const zh = new Map(allBpStrings("zh-Hans"));
    const en = new Map(allBpStrings("en"));
    expect([...en.keys()].sort()).toEqual([...zh.keys()].sort());
    for (const [key, s] of zh) {
      const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(en.get(key) ?? ""), key).toEqual(names(s));
    }
  });

  it("counts read naturally", () => {
    expect(weekCountWords("zh-Hans", 2)).toBe("本周 2 次");
    expect(weekCountWords("en", 1)).toBe("1 this week");
    expect(weekCountWords("en", 2)).toBe("2 this week");
    expect(weekCountWords("zh-Hans", 13, true, 1)).toBe("记录 13 次，未确认 1 次");
    expect(weekCountWords("zh-Hans", 13, true)).toBe("记录 13 次");
    expect(bpc("zh-Hans", "capTwo", { date: "8月24日", s: 135, d: 85, at: bpc("zh-Hans", "capAt", { time: "0:49" }) })).toBe("两条虚线是医生 8月24日说的 135/85（录音 0:49）。");
  });
});
