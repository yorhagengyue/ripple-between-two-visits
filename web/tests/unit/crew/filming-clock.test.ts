/**
 * A filming account's clock in track B's medicine and blood-pressure day (C2 track J's change to lib/daily; real-app 5.4
 * 「设了偏移以后时间照常往前走。导演把钟拨到 08:44，一分钟后真推送就到演员的手机」). The slot instants are on the account's own
 * dates, so the phases, the time on Today, the page's next re-read, the job's reminders and "no reply", and the blood
 * pressure parts are read at the account's own "now" (lib/store/scope.ts scopeNow: real time plus the crew's offset).
 * Every other account is the same instant (track B's own tests keep covering them).
 *
 * Real time is the developer test clock, frozen at Mon 12 Oct 2026 15:00 and then moved on by minutes (time flowing); the
 * account's clock is offset once to Tue 13 Oct 08:40, its next morning.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accountToday } from "@/lib/daily/account-today";
import { runBpDay } from "@/lib/daily/bp-run";
import type { BpPlan } from "@/lib/daily/bp-schedule";
import { buildDoseDay } from "@/lib/daily/cells";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import type { Notice } from "@/lib/jobs/notify";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const MIN = 60_000;
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const REAL = Date.parse(SGT("2026-10-12", "15:00"));

let him: TestAccount;

/** Real time moves on (the offset stays): the account's clock moves with it. */
function realAt(ms: number): number {
  setTestClock({ at: ms, frozen: true });
  return ms;
}

async function scope(): Promise<SessionRow> {
  const s = await store.getSession(him.userId);
  if (!s) throw new Error("no scope");
  return s;
}

function collect(): { sent: Notice[]; send: (n: Notice) => Promise<{ sent: number }> } {
  const sent: Notice[] = [];
  return { sent, send: async (n) => (sent.push(n), { sent: 1 }) };
}

beforeAll(async () => {
  realAt(REAL);
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `j${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  await store.setFilmingAccount(him.userId, true);
  // the crew puts his clock on Tuesday 08:40 (17 h 40 min ahead of the real time)
  await store.setClockOffset(him.userId, Date.parse(SGT("2026-10-13", "08:40")) - REAL);
});

afterAll(() => setTestClock(null));

describe("a filming account's day runs on its own clock", () => {
  it("the account's now is Tuesday 08:40 while the real time is Monday 15:00; tracking starts at its own now", async () => {
    const s = await scope();
    expect([s.story_day, s.story_time]).toEqual([43, "08:40"]);
    expect(s.tracking_since).toBe(new Date(Date.parse(SGT("2026-10-13", "08:40"))).toISOString());
  });

  it("Today: the slot is still coming, the time on screen is the account's, the page re-reads when its 8:45 comes", async () => {
    const now = realAt(REAL);
    const s = await scope();
    const day = buildDoseDay(s, 43, await store.listMeds(s.id), [], now);
    expect(day.map((d) => [d.slot, d.phase, d.cells[0]?.tracked])).toEqual([["morning", "before", true]]);
    const t = await accountToday(store, s, now, {}, "zh-Hans");
    expect(t.time).toBe("08:40");
    expect(t.focus).toMatchObject({ why: "coming", when: "today" });
    // the page's TimeKeeper counts on the app's clock: 8:45 on his phone is five real minutes away
    expect(t.nextChangeMs! - now).toBe(5 * MIN);
  });

  it("the job: one first reminder at his 8:45, the second at 9:15, and the window settles as no reply at 9:45", async () => {
    const c = collect();
    let now = realAt(REAL + 4 * MIN);
    expect((await runDoseDay(store, await scope(), now, { send: c.send })).first).toBe(0);
    now = realAt(REAL + 5 * MIN);
    const first = await runDoseDay(store, await scope(), now, { send: c.send });
    expect(first).toMatchObject({ first: 1, settled: 0 });
    expect(c.sent.map((n) => [n.kind, n.url])).toEqual([["dose_first", "/p/today?remind=dose-morning"]]);
    expect((await runDoseDay(store, await scope(), now, { send: c.send })).first).toBe(0);
    const t = await accountToday(store, await scope(), now, {}, "zh-Hans");
    expect([t.time, t.focus?.why, t.reminder !== null]).toEqual(["08:45", "due", true]);

    now = realAt(REAL + 35 * MIN);
    expect((await runDoseDay(store, await scope(), now, { send: c.send })).second).toBe(1);
    now = realAt(REAL + 64 * MIN);
    expect((await runDoseDay(store, await scope(), now, { send: c.send })).settled).toBe(0);

    // she was linked (and confirmed) an hour ago in real time: before this window closed on his clock, so she is told
    const links = async (): Promise<LinkWithSwitch[]> => [
      { link: { id: "link-wl", family_id: randomUUID(), patient_label: "爸爸", confirmed_at: new Date(REAL - 60 * MIN).toISOString(), status: "active" }, noReplyAlert: true, locale: "zh-Hans" },
    ];
    now = realAt(REAL + 65 * MIN);
    const closed = await runDoseDay(store, await scope(), now, { send: c.send, links });
    expect(closed).toMatchObject({ settled: 1, family: 1 });
    const rows = await store.listDoses(him.userId, { fromDay: 43, toDay: 43 });
    expect(rows.map((d) => `${d.state}:${d.reason}`)).toEqual(["unconfirmed:no_reply"]);
    expect((await accountToday(store, await scope(), now, {}, "zh-Hans")).focus).toMatchObject({ why: "closed" });
  });

  it("blood pressure: the morning part is due on his clock (8:00 to 12:00), and nothing of the real Monday is 'not measured'", async () => {
    const now = realAt(REAL + 5 * MIN);
    const s = await scope();
    const plan: BpPlan = {
      words: { text: "Measure every morning and evening.", itemId: "item-x", visitId: "v2", visitDay: 8, visitDate: "2026-09-08", utteranceId: null, tStartMs: null, clipUrl: null, standIn: false, recordedAt: new Date(REAL - 86_400_000).toISOString() },
      kind: "daily",
      perWeek: null,
      parts: ["morning", "evening"],
      fromDay: 40,
      toDay: null,
    };
    const c = collect();
    const counts = await runBpDay(store, s, now, { plan, send: c.send });
    expect(counts).toEqual({ reminded: 1, notMeasured: 0, sent: 1 });
    expect(c.sent.map((n) => [n.kind, n.url])).toEqual([["bp_due", "/p/bp"]]);
    expect(await store.listBp(him.userId, { fromDay: 42, toDay: 43 })).toEqual([]);
  });
});
