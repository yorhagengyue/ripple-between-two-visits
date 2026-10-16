/**
 * Who a scope reads its routine, clinic, day 0, time zone and reminder times from (docs/plan/real-app.md 8.4 「单元
 * profile/read」, line 1442: 「演示的作息、诊所、d0 和现在的模板读出完全一样（快照比对）；账号读范围行」; the rule itself is
 * lib/store/scope.ts, C2 foundation item D in web/progress/f1.md: 「先看空间再看模板……demo 读到的值和以前一样，账号从不读模板」).
 *
 * The readers under test, each through its own function:
 *   lib/store/scope.ts            scopeD0, scopeTz, scopeRoutine, scopeClinic, scopeReminderTime
 *   lib/daily/doses.ts            d0Of, routineOf, scheduleFor (the morning reminder: first, second, window close)
 *   lib/daily/reminders.ts        remindersView (the schedule the reminder plays by, the clip and its words)
 *   lib/daily/cells.ts            scopeSlotSchedule, ownFirstReminder (every part of the day, accounts)
 *   lib/profile/reminder-times.ts slotTimes, slotTimeKnown (what 「我」 shows and where each time comes from)
 *   lib/profile/view.ts           profileView (clinic, breakfast, the morning reminder, the weekly habits)
 *   lib/visit/pipeline.ts         startVisit (the place of a visit he starts: his clinic)
 *
 * What is guarded:
 *   - a demo session, a judge's sandbox and the crew's filming session alike, reads exactly the template's values. The
 *     read is kept as a snapshot (the template as it is now: a change to web/fixtures/timeline.seed.json or to a
 *     reader shows up as a snapshot difference) AND compared with what the template module itself exports
 *     (lib/story/seed.ts), so the snapshot cannot be regenerated into something that is not the template;
 *   - an account reads its own scope row and never the template: with values of its own (another clinic, breakfast
 *     07:30, tai chi on Tue/Thu at another time, a reminder at 07:45, its own time zone and day 0) every reader gives
 *     those; an example account reads the routine written into its row when it was laid out (moved to its own
 *     weekdays), and once he takes his clinic and habits off, nothing: not the template's again;
 *   - a blank account with nothing set reads the documented defaults (no routine, no clinic, day 0 = the day he signed
 *     up, Asia/Singapore, breakfast 08:30 so 08:45 / 09:15 / 09:45, lunch 12:30, dinner 18:30, bed 22:00:
 *     lib/daily/schedule.ts), each marked as the app's own time, never Mr Tan's routine or clinic.
 * tests/unit/profile/settings.test.ts has the writers (setting up, 「我」); this file is the reading side.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopeSlotSchedule, ownFirstReminder } from "@/lib/daily/cells";
import { d0Of, routineOf, scheduleFor } from "@/lib/daily/doses";
import { remindersView } from "@/lib/daily/reminders";
import { REMINDER_SLOTS, slotTimeKnown, slotTimes } from "@/lib/profile/reminder-times";
import { profileView } from "@/lib/profile/view";
import { MemoryStore } from "@/lib/store/memory";
import { scopeClinic, scopeD0, scopeReminderTime, scopeRoutine, scopeTz, type ScopeLike } from "@/lib/store/scope";
import type { ScopeRoutineEntry, SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { seedAccount } from "@/lib/story/example";
import { loadTemplate, templateCast, templateDefaults } from "@/lib/story/seed";
import { DEFAULT_TZ, zonedTimeToUtcMs } from "@/lib/time/clock";
import { startVisit } from "@/lib/visit/pipeline";

/** Wed 18 Nov 2026, 10:00 in Singapore: not one of the template's own dates (its day 0 is Mon 24 Aug 2026). */
const NOW = zonedTimeToUtcMs("2026-11-18", "10:00");
let clock = NOW;
const store = new MemoryStore({ now: () => new Date(clock) });
const saved = { ...process.env };

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => {
  process.env = saved;
});

const TEMPLATE_CLINIC = "Blossom Family Clinic (fictional)";
const TEMPLATE_D0 = "2026-08-24";

/** What a scope reads about itself, through every reader that a demo session and an account share. */
async function read(scope: SessionRow) {
  const reminders = await remindersView(store, scope);
  const profile = await profileView(store, scope);
  // the two entry points of lib/daily say what lib/store/scope.ts says
  expect(d0Of(scope)).toBe(scopeD0(scope));
  expect(routineOf(scope)).toEqual(scopeRoutine(scope));
  return {
    d0: scopeD0(scope),
    tz: scopeTz(scope),
    routine: scopeRoutine(scope),
    clinic: scopeClinic(scope),
    reminder_time: scopeReminderTime(scope),
    morning: await scheduleFor(store, scope),
    reminders: { schedule: reminders.schedule, clips: reminders.clips.map((c) => ({ id: c.id, text: c.text, plays_at: c.plays_at })) },
    profile: { clinic: profile.clinic, breakfast: profile.breakfast, reminderAt: profile.reminderAt, habits: profile.habits },
    today: storyDate(scopeD0(scope), scope.story_day),
  };
}

/** Every part of the day on an account: its three times, where the first one comes from, whether his own data says it. */
function readSlots(scope: SessionRow) {
  return Object.fromEntries(
    REMINDER_SLOTS.map((slot) => {
      const s = scopeSlotSchedule(scope, slot);
      const t = slotTimes(scope).find((x) => x.slot === slot)!;
      expect({ first: t.first, second: t.second }).toEqual({ first: s.first, second: s.second });
      return [slot, { ...s, source: t.source, own: ownFirstReminder(scope, slot), known: slotTimeKnown(scope, slot) }];
    }),
  );
}

const plus = (hhmm: string, min: number): string => {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + min;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** The same read, worked out from what the template module exports and nothing else. */
function fromTemplate(storyDay: number) {
  const tpl = loadTemplate("mr-tan");
  const { persona } = templateCast("mr-tan");
  const routine = persona.routine ?? [];
  const breakfast = routine.find((r) => r.label === "Breakfast")!.time;
  const schedule = { first: plus(breakfast, 15), second: plus(breakfast, 45), closes: plus(breakfast, 75) };
  return {
    d0: templateDefaults("mr-tan").d0,
    tz: DEFAULT_TZ,
    routine,
    clinic: persona.healthier_sg_clinic ?? null,
    reminder_time: null,
    morning: schedule,
    reminders: { schedule, clips: tpl.reminder_clips.map((c) => ({ id: c.id, text: c.text_zh ?? c.text ?? null, plays_at: c.plays_at })) },
    profile: { clinic: persona.healthier_sg_clinic ?? null, breakfast, reminderAt: schedule.first, habits: routine.filter((r) => r.label !== "Breakfast") },
    today: storyDate(tpl.meta.d0, storyDay),
  };
}

async function blankAccount(opts: { tz?: string; nowMs?: number } = {}): Promise<SessionRow> {
  return seedAccount(store, { userId: randomUUID(), space: "blank", nowMs: opts.nowMs ?? clock, onboarding: "done", ...(opts.tz ? { tz: opts.tz } : {}) });
}
async function exampleAccount(): Promise<SessionRow> {
  return seedAccount(store, { userId: randomUUID(), space: "example", nowMs: clock });
}

describe("the template itself, as the demo reads it today", () => {
  it("day 0 is Mon 24 Aug 2026, the clinic is Blossom Family Clinic, tai chi is on Tue and Thu at 07:30, breakfast at 08:30", () => {
    const tpl = loadTemplate("mr-tan");
    expect(templateDefaults("mr-tan")).toEqual({ d0: TEMPLATE_D0, story_day: 29, story_time: null });
    expect(tpl.meta.d0).toBe(TEMPLATE_D0);
    expect(templateCast("mr-tan").persona.healthier_sg_clinic).toBe(TEMPLATE_CLINIC);
    expect(templateCast("mr-tan").persona.routine).toEqual([
      { label: "Morning walk in the park", label_zh: "公园散步", days: "daily", time: "06:30" },
      { label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" },
      { label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:30" },
    ]);
    expect(tpl.reminder_clips.map((c) => c.plays_at)).toEqual(["after_breakfast"]);
  });
});

describe("a demo session reads exactly the template", () => {
  it.each([
    { name: "a judge's sandbox", opts: { ttl_hours: 1 } },
    { name: "the crew's filming session", opts: { kind: "filming" as const, filming_mode: true } },
    { name: "a sandbox on another story day", opts: { ttl_hours: 1, story_day: 42, story_time: "09:30" } },
  ])("$name: the routine, the clinic, day 0, the zone and the reminder times are the template's (snapshot and the module's own exports)", async ({ opts }) => {
    const s = await store.createSession(opts);
    expect(s).toMatchObject({ template: "mr-tan", d0: null, settings: {}, kind: "kind" in opts ? "filming" : "sandbox" });
    const got = await read(s);
    expect(got).toMatchSnapshot();
    expect(got).toEqual(fromTemplate(s.story_day));
    expect(got).toMatchObject({ d0: TEMPLATE_D0, clinic: TEMPLATE_CLINIC, tz: "Asia/Singapore", morning: { first: "08:45", second: "09:15", closes: "09:45" } });
    // a visit started in the demo on a day without one takes place at the template's clinic
    if (s.story_day === 29) {
      const visit = await startVisit(store, s, { mode: "record", consent: { given: true } });
      expect(visit.place).toBe(TEMPLATE_CLINIC);
    }
  });

  it("the scope row first, then the template: a demo row that carries a value of its own reads that value", () => {
    const row: ScopeLike = { template: "mr-tan", kind: "sandbox", d0: "2026-01-05", tz: "Asia/Tokyo", settings: { clinic: "Another Clinic", routine: [], reminder_time: "07:00" } };
    expect([scopeD0(row), scopeTz(row), scopeClinic(row), scopeRoutine(row), scopeReminderTime(row)]).toEqual(["2026-01-05", "Asia/Tokyo", "Another Clinic", [], "07:00"]);
    // and each value it does not carry is the template's
    const bare: ScopeLike = { template: "mr-tan" };
    expect([scopeD0(bare), scopeTz(bare), scopeClinic(bare), scopeRoutine(bare), scopeReminderTime(bare)]).toEqual([TEMPLATE_D0, "Asia/Singapore", TEMPLATE_CLINIC, templateCast("mr-tan").persona.routine, null]);
  });
});

describe("an account reads its own scope row", () => {
  const HIS_ROUTINE: ScopeRoutineEntry[] = [
    { label: "Breakfast", label_zh: "早饭", days: "daily", time: "07:30" },
    { label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "06:45" },
    { label: "Swimming", label_zh: "游泳", days: ["Sat"], time: "10:00" },
  ];

  it("another clinic, breakfast 07:30, tai chi on Tue/Thu at 06:45, a reminder at 07:45: every reader gives his values, none the template's", async () => {
    const start = await blankAccount();
    const scope = await store.updateScope(start.id, { settings: { clinic: "Bedok Polyclinic", routine: HIS_ROUTINE, reminder_time: "07:45", reminder_times: { evening: "19:30" } } });
    const got = await read(scope);
    expect(got).toEqual({
      d0: "2026-11-18",
      tz: "Asia/Singapore",
      routine: HIS_ROUTINE,
      clinic: "Bedok Polyclinic",
      reminder_time: "07:45",
      morning: { first: "07:45", second: "08:15", closes: "08:45" },
      reminders: { schedule: { first: "07:45", second: "08:15", closes: "08:45" }, clips: [] },
      profile: { clinic: "Bedok Polyclinic", breakfast: "07:30", reminderAt: "07:45", habits: HIS_ROUTINE.slice(1) },
      today: "2026-11-18",
    });
    expect(readSlots(scope)).toEqual({
      morning: { first: "07:45", second: "08:15", closes: "08:45", source: "own", own: "07:45", known: true },
      midday: { first: "12:45", second: "13:15", closes: "13:45", source: "app", own: null, known: false },
      evening: { first: "19:30", second: "20:00", closes: "20:30", source: "own", own: "19:30", known: true },
      night: { first: "21:30", second: "22:00", closes: "22:30", source: "app", own: null, known: false },
    });
    // nothing of the template in it: not its day 0, not its clinic, not one entry of its routine
    const template = fromTemplate(0);
    expect(got.d0).not.toBe(template.d0);
    expect(got.clinic).not.toBe(template.clinic);
    for (const entry of template.routine) expect(got.routine).not.toContainEqual(entry);
    expect(got.morning).not.toEqual(template.morning);
    // the visit he starts takes place at his clinic
    expect((await startVisit(store, scope, { mode: "record", consent: { given: true } })).place).toBe("Bedok Polyclinic");

    // without a reminder time of his own the morning hangs on HIS breakfast (07:30 + 15 min), not the template's 08:30
    const later = await store.updateScope(scope.id, { settings: { reminder_time: null, routine: [{ ...HIS_ROUTINE[0], time: "07:10" }, ...HIS_ROUTINE.slice(1)] } });
    expect(await scheduleFor(store, later)).toEqual({ first: "07:25", second: "07:55", closes: "08:25" });
    expect(readSlots(later).morning).toEqual({ first: "07:25", second: "07:55", closes: "08:25", source: "routine", own: null, known: true });
    expect((await profileView(store, later)).reminderAt).toBe("07:25");
  });

  it("its own time zone and day 0: laid out at 23:30 in Singapore for someone in Tokyo, day 0 is Tokyo's date", async () => {
    const at = zonedTimeToUtcMs("2026-11-18", "23:30");
    clock = at;
    try {
      const tokyo = await blankAccount({ tz: "Asia/Tokyo", nowMs: at });
      const singapore = await blankAccount({ nowMs: at });
      expect([scopeTz(tokyo), scopeD0(tokyo), d0Of(tokyo)]).toEqual(["Asia/Tokyo", "2026-11-19", "2026-11-19"]);
      expect([scopeTz(singapore), scopeD0(singapore)]).toEqual(["Asia/Singapore", "2026-11-18"]);
    } finally {
      clock = NOW;
    }
  });

  it("an example account: the routine written into its row when it was laid out (tai chi moved to Thu and Sat), day 0 = today - 42", async () => {
    const scope = await exampleAccount();
    expect(scope).toMatchObject({ kind: "account", template: "mr-tan", example_data: true, story_day: 42 });
    const got = await read(scope);
    const moved: ScopeRoutineEntry[] = [
      { label: "Morning walk in the park", label_zh: "公园散步", days: "daily", time: "06:30" },
      { label: "Tai chi", label_zh: "打太极", days: ["Thu", "Sat"], time: "07:30" },
      { label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:30" },
    ];
    expect(got).toMatchObject({ d0: "2026-10-07", tz: "Asia/Singapore", routine: moved, clinic: TEMPLATE_CLINIC, reminder_time: null, morning: { first: "08:45", second: "09:15", closes: "09:45" }, today: "2026-11-18" });
    expect(scope.settings.routine).toEqual(moved); // it is the row's
    expect(got.routine).not.toEqual(templateCast("mr-tan").persona.routine);
    expect(got.d0).not.toBe(TEMPLATE_D0);

    // he changes his clinic and takes his habits off: the row says so, and the template's never come back
    const emptied = await store.updateScope(scope.id, { settings: { clinic: null, routine: [] } });
    expect(emptied.template).toBe("mr-tan");
    expect(await read(emptied)).toMatchObject({ d0: "2026-10-07", routine: [], clinic: null, profile: { clinic: null, breakfast: null, habits: [] }, morning: { first: "08:45", second: "09:15", closes: "09:45" } });
    expect(readSlots(emptied).morning).toMatchObject({ source: "app", known: false });
    const other = await store.updateScope(scope.id, { settings: { clinic: "Toa Payoh Polyclinic" } });
    expect(scopeClinic(other)).toBe("Toa Payoh Polyclinic");
  });

  it("an account row never falls back on the template, whatever its template column says", () => {
    for (const template of ["mr-tan", "blank"] as const) {
      const row: ScopeLike = { template, kind: "account", d0: "2026-10-07", settings: {} };
      expect([scopeD0(row), scopeTz(row), scopeClinic(row), scopeRoutine(row), scopeReminderTime(row)], template).toEqual(["2026-10-07", "Asia/Singapore", null, [], null]);
      // an account without a day 0 is an error, never the template's 24 Aug
      expect(() => scopeD0({ template, kind: "account" }), template).toThrow("an account scope has no d0");
    }
    // the same row as a demo row would read the template: the kind is what decides
    expect(scopeClinic({ template: "mr-tan", kind: "sandbox", settings: {} })).toBe(TEMPLATE_CLINIC);
  });
});

describe("a blank account with nothing set reads the documented defaults", () => {
  it("no routine, no clinic, day 0 the day he signed up, Asia/Singapore, the app's own times for every part of the day", async () => {
    const scope = await blankAccount();
    expect(scope).toMatchObject({ kind: "account", template: "blank", settings: {} });
    expect(await read(scope)).toEqual({
      d0: "2026-11-18",
      tz: "Asia/Singapore",
      routine: [],
      clinic: null,
      reminder_time: null,
      morning: { first: "08:45", second: "09:15", closes: "09:45" },
      reminders: { schedule: { first: "08:45", second: "09:15", closes: "09:45" }, clips: [] },
      profile: { clinic: null, breakfast: null, reminderAt: "08:45", habits: [] },
      today: "2026-11-18",
    });
    // breakfast 08:30 (+15), lunch 12:30 (+15), dinner 18:30 (+15), bed 22:00 (-30): the app's own, and marked so
    expect(readSlots(scope)).toEqual({
      morning: { first: "08:45", second: "09:15", closes: "09:45", source: "app", own: null, known: false },
      midday: { first: "12:45", second: "13:15", closes: "13:45", source: "app", own: null, known: false },
      evening: { first: "18:45", second: "19:15", closes: "19:45", source: "app", own: null, known: false },
      night: { first: "21:30", second: "22:00", closes: "22:30", source: "app", own: null, known: false },
    });
    // never Mr Tan's: no tai chi, no walk, not his clinic, and a visit he starts is at "Clinic", not at Blossom
    const text = JSON.stringify(await read(scope));
    expect(text).not.toMatch(/Tai chi|打太极|Morning walk|公园散步|Blossom/);
    expect(JSON.stringify(fromTemplate(0))).toMatch(/Tai chi.*Blossom|Blossom.*Tai chi/); // the pattern finds them in the template's read
    expect((await startVisit(store, scope, { mode: "record", consent: { given: true } })).place).toBe("Clinic");
  });
});
