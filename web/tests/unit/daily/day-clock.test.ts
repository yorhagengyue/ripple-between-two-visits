/**
 * The day's clock for every account page (C2 track B, second round; real-app 2.7, 6.3, 6.5): what app/p/layout.tsx
 * hands to the open page: his date, the next moment the day changes by itself, and the slot that asks for him now
 * (with her clip). After 等一下 the slot is quiet until the second reminder. A filming account's clock offset is part of
 * the clock the page keeps. And where the reminder strip keeps off.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { dueReminderHidden } from "@/components/daily/elder/DueReminder";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accountToday } from "@/lib/daily/account-today";
import { asksNow, doseDay } from "@/lib/daily/cells";
import { accountDayClock } from "@/lib/daily/day-clock";
import { answerDose } from "@/lib/daily/doses";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const AML = "med-amlodipine";
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const ms = (iso: string) => Date.parse(iso);

function setClock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return ms(iso);
}

async function example(laidOutAt: string): Promise<TestAccount> {
  setClock(laidOutAt);
  return createAccountWithSpace(store, getAuthProvider(), { login: `c${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
}

const scope = async (id: string): Promise<SessionRow> => (await store.getSession(id))!;

afterAll(() => setTestClock(null));

describe("accountDayClock: the date, the next moment, the slot that asks now", () => {
  it("Tuesday: before 08:45 the next moment is 08:45; then 09:15, 09:45, his midnight", async () => {
    const him = await example(SGT("2026-10-12", "10:00"));
    const at = async (hhmm: string) => {
      const now = setClock(SGT("2026-10-13", hhmm));
      return accountDayClock(store, await scope(him.userId), now);
    };
    const early = await at("08:40");
    expect(early).toMatchObject({ date: "2026-10-13", tz: "Asia/Singapore", nowMs: ms(SGT("2026-10-13", "08:40")), due: null });
    expect(early.nextAtMs).toBe(ms(SGT("2026-10-13", "08:45")));

    const first = await at("08:45");
    expect(first.nextAtMs).toBe(ms(SGT("2026-10-13", "09:15")));
    expect(first.due).toMatchObject({ slot: "morning", stretch: 1, at: "08:45" });
    // her clip (the example's stand-in), as Today's reminder has it
    expect(first.due?.clip).toMatchObject({ by_label: "Wei Ling（示例）", stand_in: true });
    expect(first.due?.clip?.audio_url).toBeTruthy();

    const second = await at("09:20");
    expect(second.due).toMatchObject({ slot: "morning", stretch: 2, at: "09:15" });
    expect(second.nextAtMs).toBe(ms(SGT("2026-10-13", "09:45")));

    const closed = await at("09:45");
    expect(closed.due).toBeNull();
    expect(closed.nextAtMs).toBe(ms(SGT("2026-10-14", "00:00")));
  });

  it("answered: nothing is due; 等一下: quiet until the second reminder, which asks again; 等一下 to the second one: quiet", async () => {
    const him = await example(SGT("2026-10-12", "10:00"));
    let now = setClock(SGT("2026-10-13", "08:50"));
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "unconfirmed", reason: "later" }, now);
    expect((await accountDayClock(store, await scope(him.userId), now)).due).toBeNull();
    // Today's own reminder follows the same rule: no clip again after 等一下 (he opened the notice: then it shows)
    expect((await accountToday(store, await scope(him.userId), now, {}, "zh-Hans")).reminder).toBeNull();
    expect((await accountToday(store, await scope(him.userId), now, { remind: "dose-morning" }, "zh-Hans")).reminder).not.toBeNull();

    now = setClock(SGT("2026-10-13", "09:16"));
    const again = await accountDayClock(store, await scope(him.userId), now);
    expect(again.due).toMatchObject({ slot: "morning", stretch: 2 });
    expect((await accountToday(store, await scope(him.userId), now, {}, "zh-Hans")).reminder).not.toBeNull();
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "unconfirmed", reason: "later" }, now);
    expect((await accountDayClock(store, await scope(him.userId), now)).due).toBeNull();
    const [slot] = await doseDay(store, await scope(him.userId), 43, now);
    expect(asksNow(slot)).toBe(false);

    now = setClock(SGT("2026-10-13", "09:20"));
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect((await accountDayClock(store, await scope(him.userId), now)).due).toBeNull();
  });

  it("an untracked window never asks: laid out at 09:00, the first stretch is running but the cell is his (tracked); at 10:00 nothing", async () => {
    const early = await example(SGT("2026-10-13", "09:00"));
    let now = setClock(SGT("2026-10-13", "09:05"));
    expect((await accountDayClock(store, await scope(early.userId), now)).due).toMatchObject({ slot: "morning", stretch: 1 });
    const late = await example(SGT("2026-10-13", "10:00"));
    now = setClock(SGT("2026-10-13", "10:05"));
    expect((await accountDayClock(store, await scope(late.userId), now)).due).toBeNull();
  });

  it("a blank account with no medicine: only his midnight", async () => {
    setClock(SGT("2026-10-12", "21:00"));
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `c${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const c = await accountDayClock(store, await scope(a.userId), ms(SGT("2026-10-12", "21:00")));
    expect(c).toMatchObject({ date: "2026-10-12", due: null });
    expect(c.nextAtMs).toBe(ms(SGT("2026-10-13", "00:00")));
  });

  it("a filming account: the page keeps the account's own clock (the offset is in nowMs, the date is the account's)", async () => {
    const him = await example(SGT("2026-10-12", "10:00"));
    await store.setFilmingAccount(him.userId, true);
    // the crew moves the account three days ahead, to Thu 15 Oct 08:46
    const real = setClock(SGT("2026-10-12", "10:30"));
    await store.setClockOffset(him.userId, ms(SGT("2026-10-15", "08:46")) - real);
    const c = await accountDayClock(store, await scope(him.userId), real);
    expect(c.date).toBe("2026-10-15");
    expect(c.nowMs).toBe(ms(SGT("2026-10-15", "08:46")));
    // on that clock, the next moment is the account's own 09:15 (the first reminder stretch is running)
    expect(c.nextAtMs).toBe(ms(SGT("2026-10-15", "09:15")));
    expect(c.due).toMatchObject({ slot: "morning", stretch: 1 });
  });

  it("every read has its own stamp (the page measures its clock again at each server render, also on a clock that stands still)", async () => {
    const him = await example(SGT("2026-10-12", "10:00"));
    const now = setClock(SGT("2026-10-12", "10:05"));
    const a = await accountDayClock(store, await scope(him.userId), now);
    const b = await accountDayClock(store, await scope(him.userId), now);
    expect(b.nowMs).toBe(a.nowMs);
    expect(b.stamp).not.toBe(a.stamp);
  });

  it("a demo session has no such clock", async () => {
    const demo = await store.createSession({ story_day: 43, story_time: "08:50", ttl_hours: 1 });
    await expect(accountDayClock(store, demo, Date.now())).rejects.toThrow();
  });
});

describe("where the due reminder keeps off", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("Today, the visit pages, the brief, adding a medicine, asking, and blood pressure while a reading is typed; his other pages may show it", () => {
    expect(dueReminderHidden("/p/today", q(""))).toBe(true);
    expect(dueReminderHidden("/p/today", q("remind=dose-morning"))).toBe(true);
    expect(dueReminderHidden("/p/visit", q(""))).toBe(true);
    expect(dueReminderHidden("/p/visit/abc/review", q(""))).toBe(true);
    expect(dueReminderHidden("/p/brief", q("show=doctor"))).toBe(true);
    expect(dueReminderHidden("/p/brief", q("shown=brief-1"))).toBe(true);
    // owner's tidy of 10-13: the reminder is a passing pop-up, and it keeps off wherever it would stand over what he is doing
    expect(dueReminderHidden("/p/brief", q(""))).toBe(true);
    for (const path of ["/p/ask", "/p/chat", "/p/meds/add", "/p/meds/add/x"]) expect(dueReminderHidden(path, q(""))).toBe(true);
    expect(dueReminderHidden("/p/bp", q("do=record"))).toBe(true);
    expect(dueReminderHidden("/p/bp", q("when=yesterday"))).toBe(true);
    for (const path of ["/p/bp", "/p/questions", "/p/meds", "/p/meds/med-1", "/p/me", "/p/family", "/p/visitors"]) expect(dueReminderHidden(path, q(""))).toBe(false);
  });
});
