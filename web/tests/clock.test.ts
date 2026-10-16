import { describe, expect, it } from "vitest";
import {
  dayOfDate,
  formatClockTime,
  isClockTime,
  storyDate,
  storyDayLabel,
  weekdayShort,
} from "@/lib/story/clock";
import { loadTemplate, templateDefaults } from "@/lib/story/seed";

const D0 = "2026-08-24";

describe("story dates", () => {
  it("takes d0 from the seed", () => {
    expect(templateDefaults()).toEqual({ d0: D0, story_day: 29, story_time: null });
  });

  it("counts days from d0 in UTC, matching visits-script.md", () => {
    expect([storyDate(D0, 0), weekdayShort(D0, 0)]).toEqual(["2026-08-24", "Mon"]);
    expect([storyDate(D0, 8), weekdayShort(D0, 8)]).toEqual(["2026-09-01", "Tue"]);
    expect([storyDate(D0, 12), weekdayShort(D0, 12)]).toEqual(["2026-09-05", "Sat"]);
    expect([storyDate(D0, 29), weekdayShort(D0, 29)]).toEqual(["2026-09-22", "Tue"]);
    expect([storyDate(D0, 37), weekdayShort(D0, 37)]).toEqual(["2026-09-30", "Wed"]);
    expect([storyDate(D0, 42), weekdayShort(D0, 42)]).toEqual(["2026-10-05", "Mon"]);
    expect(weekdayShort(D0, 29, "zh-Hans")).toBe("周二");
    expect(dayOfDate(D0, "2026-09-22")).toBe(29);
  });

  it("agrees with every dated row in the seed", () => {
    const seed = loadTemplate();
    for (const v of seed.visits) expect(storyDate(D0, v.day)).toBe(v.date);
    for (const b of seed.bp_readings) {
      const date = (b as { date?: string }).date;
      if (date) expect(storyDate(D0, b.day)).toBe(date);
    }
  });
});

describe("clock time", () => {
  it("formats 12-hour time by hand", () => {
    expect(formatClockTime("07:40")).toBe("7:40am");
    expect(formatClockTime("00:05")).toBe("12:05am");
    expect(formatClockTime("12:00")).toBe("12:00pm");
    expect(formatClockTime("20:15")).toBe("8:15pm");
    expect(formatClockTime("07:40", "zh-Hans")).toBe("上午7:40");
    expect(formatClockTime("14:30", "zh-Hans")).toBe("下午2:30");
    expect(formatClockTime("20:15", "zh-Hans")).toBe("晚上8:15");
    expect(formatClockTime("05:10", "zh-Hans")).toBe("凌晨5:10");
  });

  it("rejects malformed times", () => {
    expect(isClockTime("7:40")).toBe(true);
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("07:60")).toBe(false);
    expect(isClockTime("morning")).toBe(false);
    expect(() => formatClockTime("7.40")).toThrow();
  });
});

describe("day label", () => {
  it("renders 'Day N · Ddd h:mmam' from d0 + day", () => {
    expect(storyDayLabel({ d0: D0, day: 22, time: "07:40" })).toBe("Day 22 · Tue 7:40am");
    expect(storyDayLabel({ d0: D0, day: 23, time: "07:40" })).toBe("Day 23 · Wed 7:40am");
    expect(storyDayLabel({ d0: D0, day: 29, time: "20:15" })).toBe("Day 29 · Tue 8:15pm");
    expect(storyDayLabel({ d0: D0, day: 29 })).toBe("Day 29 · Tue");
    expect(storyDayLabel({ d0: D0, day: 0, time: null })).toBe("Day 0 · Mon");
  });

  it("has a zh-Hans form", () => {
    expect(storyDayLabel({ d0: D0, day: 29, time: "20:15", locale: "zh-Hans" })).toBe("第29天 · 周二 晚上8:15");
    expect(storyDayLabel({ d0: D0, day: 8, locale: "zh-Hans" })).toBe("第8天 · 周二");
  });
});
