/**
 * The brief's period in words (components/brief/AccountBrief.tsx briefWindowLine; real-app 2.18 「时间段：从上次诊所看诊的
 * 第二天到今天，按真实日期显示」), on his page and on the page he hands the doctor.
 *
 * On the day of a visit the period after it has no day yet: it starts tomorrow (lib/summary/account-brief.ts
 * sinceLastHappenedVisit, a recorded decision: fromDay = toDay + 1, and every count of that day is 0). The line used to
 * be the usual 「X到Y」 sentence with those two dates, which read backwards: 「10月12日到10月11日」, "12 Oct to 11 Oct".
 */
import { describe, expect, it } from "vitest";
import { briefWindowLine } from "@/components/brief/AccountBrief";
import type { VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { sinceLastHappenedVisit } from "@/lib/summary/account-brief";

const D0 = "2026-08-30";
const visit = (id: string, day: number): VisitRow => ({ id, day, date: storyDate(D0, day), kind: "follow_up", place: "Blossom Family Clinic", status: "confirmed" }) as VisitRow;

describe("briefWindowLine", () => {
  it("the day of a visit: the line says when the period starts, in both languages; never a later date before an earlier one", () => {
    // v3 happened today (day 42, 11 Oct): the window is day 43 to day 42
    const window = sinceLastHappenedVisit([visit("v1", 0), visit("v2", 8), visit("v3", 42)], 42, D0);
    expect(window).toMatchObject({ fromDay: 43, toDay: 42, fromDate: "2026-10-12", toDate: "2026-10-11", lastVisit: { id: "v3", date: "2026-10-11" } });
    const zh = briefWindowLine({ window }, "zh-Hans");
    const en = briefWindowLine({ window }, "en");
    expect(zh).toBe("上次就诊（10月11日）之后：从10月12日开始算");
    expect(en).toBe("Since the visit on 11 Oct: counting starts on 12 Oct");
    expect(zh).not.toContain("到10月11日");
    expect(en).not.toContain("to 11 Oct");
    // statements, not questions (the brief asks him nothing)
    for (const line of [zh, en]) expect(line).not.toMatch(/[?？]/);
  });

  it("the next day the usual sentence is back, one day long", () => {
    const window = sinceLastHappenedVisit([visit("v1", 0), visit("v2", 8), visit("v3", 42)], 43, D0);
    expect(briefWindowLine({ window }, "zh-Hans")).toBe("上次就诊（10月11日）之后：10月12日到10月12日");
    expect(briefWindowLine({ window }, "en")).toBe("Since the visit on 11 Oct: 12 Oct to 12 Oct");
  });

  it("days after a visit, and before any visit: unchanged", () => {
    const after = sinceLastHappenedVisit([visit("v1", 0), visit("v2", 8)], 42, D0);
    expect(briefWindowLine({ window: after }, "zh-Hans")).toBe("上次就诊（9月7日）之后：9月8日到10月11日");
    expect(briefWindowLine({ window: after }, "en")).toBe("Since the visit on 7 Sep: 8 Sep to 11 Oct");
    const none = sinceLastHappenedVisit([], 3, D0);
    expect(none.lastVisit).toBeNull();
    expect(briefWindowLine({ window: none }, "zh-Hans")).toBe("到目前为止：8月30日到9月2日");
    expect(briefWindowLine({ window: none }, "en")).toBe("So far: 30 Aug to 2 Sep");
  });
});
