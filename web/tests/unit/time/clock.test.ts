/**
 * "Today" for a scope (lib/time/clock.ts): an account's day is the Singapore date minus d0, computed with an explicit
 * time zone, so the Singapore midnight is the boundary on any machine (C2 F1; real-app 8.1). A filming account adds
 * the crew's offset first; a demo row keeps its stored story clock.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { accountMoment, DEFAULT_TZ, localDate, localHHMM, localParts, projectScope, scopeNowMs, zonedTimeToUtcMs, zoneOffsetMs, type ScopeClockRow } from "@/lib/time/clock";

const BEFORE_MIDNIGHT = Date.parse("2026-10-09T15:59:59.999Z"); // 23:59:59.999 in Singapore
const MIDNIGHT = Date.parse("2026-10-09T16:00:00.000Z"); // 00:00 on 10 October in Singapore

const account = (over: Partial<ScopeClockRow> = {}): ScopeClockRow => ({
  kind: "account",
  story_day: null,
  story_time: null,
  d0: "2026-08-28",
  tz: "Asia/Singapore",
  filming: false,
  clock_offset_ms: null,
  ...over,
});

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("local date and time in Singapore", () => {
  it("the day changes at Singapore midnight, not UTC midnight", () => {
    expect(localDate(BEFORE_MIDNIGHT)).toBe("2026-10-09");
    expect(localHHMM(BEFORE_MIDNIGHT)).toBe("23:59");
    expect(localDate(MIDNIGHT)).toBe("2026-10-10");
    expect(localHHMM(MIDNIGHT)).toBe("00:00");
    // UTC midnight is 08:00 in Singapore, the same day
    expect(localParts(Date.parse("2026-10-10T00:00:00Z"))).toMatchObject({ date: "2026-10-10", time: "08:00" });
    expect(localParts(MIDNIGHT).weekday).toBe(6); // Saturday 10 October 2026
    expect(DEFAULT_TZ).toBe("Asia/Singapore");
  });

  it("the offset is +8 h and a local time maps back to its instant", () => {
    expect(zoneOffsetMs(MIDNIGHT)).toBe(8 * 3_600_000);
    expect(new Date(zonedTimeToUtcMs("2026-10-10", "09:45")).toISOString()).toBe("2026-10-10T01:45:00.000Z");
    expect(new Date(zonedTimeToUtcMs("2026-10-10", "00:00")).toISOString()).toBe("2026-10-09T16:00:00.000Z");
    expect(new Date(zonedTimeToUtcMs("2026-07-01", "09:00", "America/New_York")).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("projectScope", () => {
  it("an account's day is the Singapore date minus d0, across midnight", () => {
    expect(projectScope(account(), BEFORE_MIDNIGHT)).toMatchObject({ story_day: 42, story_time: "23:59" });
    expect(projectScope(account(), MIDNIGHT)).toMatchObject({ story_day: 43, story_time: "00:00" });
    expect(accountMoment(account(), MIDNIGHT)).toEqual({ day: 43, time: "00:00", date: "2026-10-10" });
  });

  it("d0 later than today gives a negative day (a visit entered from before he started)", () => {
    expect(projectScope(account({ d0: "2026-10-12" }), MIDNIGHT).story_day).toBe(-2);
    expect(projectScope(account({ d0: "2026-10-10" }), MIDNIGHT).story_day).toBe(0);
  });

  it("a filming account adds the crew's offset first; a plain account ignores a stray offset", () => {
    const day29 = Date.parse("2026-09-22T12:15:00Z"); // 20:15 in Singapore on Day 29 of d0 2026-08-24
    const offset = day29 - MIDNIGHT;
    const filming = account({ d0: "2026-08-24", filming: true, clock_offset_ms: offset });
    expect(projectScope(filming, MIDNIGHT)).toMatchObject({ story_day: 29, story_time: "20:15" });
    expect(projectScope(filming, MIDNIGHT + 60_000)).toMatchObject({ story_day: 29, story_time: "20:16" });
    expect(scopeNowMs(filming, MIDNIGHT)).toBe(day29);
    expect(projectScope(account({ clock_offset_ms: offset }), MIDNIGHT).story_day).toBe(43);
  });

  it("a demo row keeps its stored story clock, as the same object", () => {
    const demo: ScopeClockRow = { kind: "sandbox", story_day: 29, story_time: "20:15", d0: null, tz: "Asia/Singapore", filming: false, clock_offset_ms: null };
    expect(projectScope(demo, MIDNIGHT)).toBe(demo);
    const filmingSession: ScopeClockRow = { ...demo, kind: "filming", story_day: 8, story_time: null };
    expect(projectScope(filmingSession, MIDNIGHT)).toMatchObject({ story_day: 8, story_time: null });
  });

  it("the same answers whatever the machine's own time zone is (in this process)", () => {
    const answers = () => [projectScope(account(), BEFORE_MIDNIGHT), projectScope(account(), MIDNIGHT), localParts(MIDNIGHT)];
    const expected = JSON.stringify(answers());
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Singapore", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      expect(JSON.stringify(answers()), tz).toBe(expected);
    }
  });

  it("the same answers in a fresh process started with TZ=UTC (a server on UTC)", () => {
    const web = process.cwd();
    const script = [
      `import { projectScope, localParts } from ${JSON.stringify(pathToFileURL(path.join(web, "lib", "time", "clock.ts")).href)};`,
      `const row = { kind: "account", story_day: null, story_time: null, d0: "2026-08-28", tz: "Asia/Singapore", filming: false, clock_offset_ms: null };`,
      `console.log(JSON.stringify([projectScope(row, ${BEFORE_MIDNIGHT}), projectScope(row, ${MIDNIGHT}), localParts(${MIDNIGHT}), new Date(${MIDNIGHT}).getHours()]));`,
    ].join("\n");
    const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: web,
      env: { ...process.env, TZ: "UTC" },
      encoding: "utf8",
    });
    const [before, after, parts, machineHour] = JSON.parse(out.trim().split("\n").pop()!);
    expect(machineHour).toBe(16); // the child really runs on UTC
    expect(before).toMatchObject({ story_day: 42, story_time: "23:59" });
    expect(after).toMatchObject({ story_day: 43, story_time: "00:00" });
    expect(parts).toMatchObject({ date: "2026-10-10", time: "00:00" });
  }, 30_000);
});
