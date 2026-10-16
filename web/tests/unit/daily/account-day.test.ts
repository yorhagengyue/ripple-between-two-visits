/**
 * An account's medicine day (C2 track B, journey 02; real-app 2.7, 2.8, 4.4, 8.3 jobs/dose): the slots from the label's
 * own time words or his choice, each slot's reminder times from his routine, which cells are his (tracked), his answers
 * written as fresh rows and undone by deleting them, the settling of "no reply", the job's reminders (once each), and
 * her alert only while his switch is on. The demo is never touched.
 *
 * Example account laid out on Mon 12 Oct 2026 (story day 42, d0 Mon 31 Aug, so tai chi stays on Tue and Thu); the
 * clock is the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accountToday } from "@/lib/daily/account-today";
import { buildDoseDay, doseDay, scopeSlotSchedule } from "@/lib/daily/cells";
import { answerDose, DoseAnswerError, settleAccountNoReply, settleNoReply, undoDose } from "@/lib/daily/doses";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import { DELIVERY, familyNoReplyAlerts, noReplyCells } from "@/lib/daily/no-reply";
import { slotSchedule } from "@/lib/daily/schedule";
import { doseSlotsOf, slotsFromLabel } from "@/lib/daily/slots";
import type { Notice } from "@/lib/jobs/notify";
import { MemoryStore } from "@/lib/store/memory";
import type { MedicationRow, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const auth = getAuthProvider();
const AML = "med-amlodipine";
const at = (iso: string) => Date.parse(iso);
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

function setClock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return at(iso);
}

async function scope(userId: string): Promise<SessionRow> {
  const s = await store.getSession(userId);
  if (!s) throw new Error("no scope");
  return s;
}

async function exampleAccount(laidOutAt: string): Promise<TestAccount> {
  setClock(laidOutAt);
  return createAccountWithSpace(store, auth, { login: `b${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
}

function collect(): { sent: Notice[]; send: (n: Notice) => Promise<{ sent: number }> } {
  const sent: Notice[] = [];
  return { sent, send: async (n) => (sent.push(n), { sent: 1 }) };
}

afterAll(() => setTestClock(null));

describe("slots: the label's own time words (closed list), or his choice", () => {
  it("reads morning / night / evening from the label; 'twice daily after food' names no slot", () => {
    expect(slotsFromLabel("Take ONE tablet every MORNING")).toEqual(["morning"]);
    expect(slotsFromLabel("Take 1 tablet at night")).toEqual(["night"]);
    expect(slotsFromLabel("Take 1 tablet every evening")).toEqual(["evening"]);
    expect(slotsFromLabel("每天早上和睡前各一粒")).toEqual(["morning", "night"]);
    expect(slotsFromLabel("Take 1 tablet twice daily after food")).toBeNull();
    expect(slotsFromLabel("")).toBeNull();
  });

  it("an account: his dose_slots first (his choice says so), else the label, else none; the demo: one morning slot", () => {
    const med = { label: { text: "AMLODIPINE 5MG TABLET\nTake ONE tablet every MORNING", directions: "Take ONE tablet every MORNING" } } as Pick<MedicationRow, "label">;
    expect(doseSlotsOf({ kind: "sandbox" }, med)).toEqual({ slots: ["morning"], source: "demo" });
    expect(doseSlotsOf({ kind: "account" }, med)).toEqual({ slots: ["morning"], source: "label" });
    expect(doseSlotsOf({ kind: "account" }, { ...med, dose_slots: ["night", "morning"], dose_slots_source: "patient" })).toEqual({ slots: ["morning", "night"], source: "patient" });
    expect(doseSlotsOf({ kind: "account" }, { label: { text: "Take 1 tablet twice daily" } })).toEqual({ slots: [], source: null });
  });
});

describe("each slot's reminder times come from his routine", () => {
  it("after breakfast 08:30: 08:45 / 09:15 / 09:45; no lunch in the routine: 12:45; bedtime 22:00: 21:30 / 22:00 / 22:30", () => {
    const routine = [{ label: "Breakfast", label_zh: "早饭", days: "daily" as const, time: "08:30" }];
    expect(slotSchedule(routine, "morning")).toEqual({ first: "08:45", second: "09:15", closes: "09:45" });
    expect(slotSchedule(routine, "midday")).toEqual({ first: "12:45", second: "13:15", closes: "13:45" });
    expect(slotSchedule(routine, "night")).toEqual({ first: "21:30", second: "22:00", closes: "22:30" });
    expect(slotSchedule([{ label: "早饭", label_zh: "早饭", days: "daily", time: "07:30" }], "morning").first).toBe("07:45");
    expect(slotSchedule(routine, "morning", "08:00")).toEqual({ first: "08:00", second: "08:30", closes: "09:00" });
  });
});

describe("which cells are his (real-app 4.4)", () => {
  let him: TestAccount;
  beforeAll(async () => {
    him = await exampleAccount(SGT("2026-10-12", "10:00"));
  });

  it("laid out at 10:00: this morning's window (closed 09:45) is not tracked; tomorrow's is, with its own times", async () => {
    const now = setClock(SGT("2026-10-12", "10:05"));
    const s = await scope(him.userId);
    expect(s.story_day).toBe(42);
    const today = await doseDay(store, s, 42, now);
    expect(today.map((d) => [d.slot, d.cells.map((c) => [c.medicationId, c.tracked, c.state])])).toEqual([["morning", [[AML, false, null]]]]);
    expect(today[0].cells[0]).toMatchObject({ name: "Amlodipine", strength: "5 mg", labelWords: "Take ONE tablet every MORNING", labelZh: "药品标签：每天早上服用一片。", slotSource: "label" });
    expect(scopeSlotSchedule(s, "morning")).toEqual({ first: "08:45", second: "09:15", closes: "09:45" });
    // nothing is settled for an untracked window, by a read or by the job
    expect(await settleAccountNoReply(store, s, now)).toEqual([]);
    expect(await settleNoReply(store, s)).toEqual([]);
    const tomorrow = buildDoseDay(s, 43, await store.listMeds(s.id), [], at(SGT("2026-10-13", "08:40")));
    expect(tomorrow[0]).toMatchObject({ slot: "morning", date: "2026-10-13", phase: "before" });
    expect(tomorrow[0].cells[0].tracked).toBe(true);
  });

  it("Today: a window that closed before he started is a calm focus he may log (never 「没记」), and never yesterday's row", async () => {
    const now = setClock(SGT("2026-10-12", "10:05"));
    const t = await accountToday(store, await scope(him.userId), now, {}, "zh-Hans");
    expect(t.focus).toMatchObject({ why: "untracked", when: "today" });
    expect(t.focus?.slotDay.slot).toBe("morning");
    const tue = setClock(SGT("2026-10-13", "08:40"));
    const next = await accountToday(store, await scope(him.userId), tue, {}, "zh-Hans");
    expect(next.focus).toMatchObject({ why: "coming", when: "today" });
    expect(next.yesterday).toEqual([]);
  });

  it("the phases of a window: before 08:45, first, second from 09:15, closed from 09:45", async () => {
    const s = await scope(him.userId);
    const meds = await store.listMeds(s.id);
    const phase = (hhmm: string) => buildDoseDay(s, 43, meds, [], at(SGT("2026-10-13", hhmm)))[0].phase;
    expect([phase("08:44"), phase("08:45"), phase("09:14"), phase("09:15"), phase("09:44"), phase("09:45")]).toEqual(["before", "first", "first", "second", "second", "closed"]);
  });

  it("a medicine he confirmed at 09:00 starts with the next window: today's morning cell is not his", async () => {
    const s = await scope(him.userId);
    const med = { ...(await store.getMed(s.id, AML))!, start_at: new Date(at(SGT("2026-10-13", "09:00"))).toISOString() };
    expect(buildDoseDay(s, 43, [med], [], at(SGT("2026-10-13", "09:30")))).toEqual([]);
    expect(buildDoseDay(s, 44, [med], [], at(SGT("2026-10-14", "08:40")))[0].cells).toHaveLength(1);
  });
});

describe("his answers: a fresh row each time, undo deletes it, the day is today or yesterday", () => {
  let him: TestAccount;
  beforeAll(async () => {
    him = await exampleAccount(SGT("2026-10-12", "10:00"));
  });

  it("吃了 at 08:52 is written at 08:52; undo leaves no row; 吃了 again is a new row", async () => {
    const now = setClock(SGT("2026-10-13", "08:52"));
    const s = await scope(him.userId);
    const first = await answerDose(store, s, { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(first).toMatchObject({ day: 43, slot: "morning", state: "taken", created_at: "2026-10-13T00:52:00.000Z" });
    expect(await undoDose(store, s, { medication_id: AML, slot: "morning" }, now)).toBeNull();
    expect(await store.listDoses(s.id, { fromDay: 43, toDay: 43 })).toEqual([]);
    const again = await answerDose(store, s, { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(again.id).not.toBe(first.id);
    expect((await store.listDoses(s.id, { fromDay: 43, toDay: 43 })).map((d) => d.id)).toEqual([again.id]);
  });

  it("a change and its undo: the earlier answer is put back", async () => {
    const now = setClock(SGT("2026-10-13", "08:55"));
    const s = await scope(him.userId);
    await answerDose(store, s, { medication_id: AML, slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" }, now);
    const back = await undoDose(store, s, { medication_id: AML, slot: "morning", restore: { state: "taken" } }, now);
    expect(back).toMatchObject({ state: "taken", reason: null });
    expect((await store.listDoses(s.id, { fromDay: 43, toDay: 43 })).map((d) => d.state)).toEqual(["taken"]);
  });

  it("yesterday may be answered; anything not his medicine in that slot is refused", async () => {
    const now = setClock(SGT("2026-10-14", "08:30"));
    const s = await scope(him.userId);
    expect(s.story_day).toBe(44);
    const y = await answerDose(store, s, { medication_id: AML, slot: "morning", state: "taken", when: "yesterday" }, now);
    expect(y.day).toBe(43);
    await expect(answerDose(store, s, { medication_id: AML, slot: "night", state: "taken" }, now)).rejects.toBeInstanceOf(DoseAnswerError);
    await expect(answerDose(store, s, { medication_id: "med-ibuprofen", slot: "morning", state: "taken" }, now)).rejects.toMatchObject({ code: "not_due" });
    await expect(answerDose(store, s, { medication_id: "nope", slot: "morning", state: "taken" }, now)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the job's pass (runDoseDay): reminders once, no reply at 09:45, her alert only with his switch on", () => {
  let him: TestAccount;
  let her: TestAccount;
  let linkId: string;
  const links = (noReplyAlert: boolean): (() => Promise<LinkWithSwitch[]>) => async () => {
    const link = (await store.getCareLink(linkId))!;
    return [{ link, noReplyAlert, locale: "zh-Hans" }];
  };

  beforeAll(async () => {
    him = await exampleAccount(SGT("2026-10-12", "10:00"));
    her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite(
      { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
      { dose_summary: true, no_reply_alert: true },
    );
    if (!inv.ok) throw new Error(inv.code);
    linkId = inv.link.id;
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(linkId, him.userId, true);
    if (!ok.ok) throw new Error(ok.code);
  });

  it("08:44 nothing; 08:45 the first reminder, once however often it runs; 09:15 the second; the words name no medicine", async () => {
    const box = collect();
    let now = setClock(SGT("2026-10-13", "08:44"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send })).toMatchObject({ first: 0, second: 0, settled: 0 });
    now = setClock(SGT("2026-10-13", "08:45"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send })).toMatchObject({ first: 1, second: 0 });
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send })).toMatchObject({ first: 0, second: 0 });
    now = setClock(SGT("2026-10-13", "09:15"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send })).toMatchObject({ first: 0, second: 1 });
    expect(box.sent.map((n) => [n.kind, n.title, n.body, n.url, n.to.role])).toEqual([
      ["dose_first", "早间药物", "尚未记录", "/p/today?remind=dose-morning", "patient"],
      ["dose_second", "早间药物", "尚未记录", "/p/today?remind=dose-morning", "patient"],
    ]);
    expect(box.sent[0].tag).toBe(box.sent[1].tag);
    for (const n of box.sent) expect(`${n.title} ${n.body}`).not.toMatch(/amlodipine|5 ?mg/i);
  });

  it("09:45 with no answer: unconfirmed / no_reply by the system, and her alert once (switch on)", async () => {
    const box = collect();
    const now = setClock(SGT("2026-10-13", "09:45"));
    const c = await runDoseDay(store, await scope(him.userId), now, { send: box.send, links: links(true) });
    expect(c).toMatchObject({ settled: 1, family: 1 });
    const rows = await store.listDoses(him.userId, { fromDay: 43, toDay: 43 });
    expect(rows.map((d) => [d.state, d.reason])).toEqual([["unconfirmed", "no_reply"]]);
    expect(box.sent.map((n) => [n.kind, n.title, n.body, n.to.role, n.url])).toEqual([
      ["family_no_reply", "爸爸尚未回应早间药物提醒", "8:45 和 9:15 两次提醒均未回应。", "family", `/f?link=${encodeURIComponent(linkId)}`],
    ]);
    // another run, a restart: nothing new
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links: links(true) })).toMatchObject({ settled: 0, family: 0, first: 0, second: 0 });
    expect(box.sent).toHaveLength(1);
    expect((await noReplyCells(store, await scope(him.userId))).map((x) => [x.day, x.slot, x.closes, x.name])).toEqual([[43, "morning", "09:45", "Amlodipine"]]);
  });

  it("he answers at 10:20: written at 10:20; her alert now says he answered since", async () => {
    const now = setClock(SGT("2026-10-13", "10:20"));
    const s = await scope(him.userId);
    const row = await answerDose(store, s, { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(row.created_at).toBe("2026-10-13T02:20:00.000Z");
    expect(await noReplyCells(store, s)).toEqual([]);
    const alerts = await familyNoReplyAlerts(store, s, linkId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ day: 43, slot: "morning", closes: "09:45", answeredSince: true });
    expect(alerts[0].cells).toEqual([{ medicationId: AML, name: "Amlodipine", state: "taken", reason: null, reasonText: null, answeredAt: "2026-10-13T02:20:00.000Z" }]);
  });

  it("with his switch off nothing reaches her; 等一下 is an answer: the second reminder still comes, no 'no reply' at 09:45", async () => {
    const box = collect();
    let now = setClock(SGT("2026-10-14", "08:50"));
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "unconfirmed", reason: "later" }, now);
    now = setClock(SGT("2026-10-14", "09:15"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links: links(false) })).toMatchObject({ second: 1 });
    now = setClock(SGT("2026-10-14", "09:46"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links: links(false) })).toMatchObject({ settled: 0, family: 0 });
    expect((await store.listDoses(him.userId, { fromDay: 44, toDay: 44 })).map((d) => [d.state, d.reason])).toEqual([["unconfirmed", "later"]]);
    // a no-reply day with the switch off: settled, nothing to her
    now = setClock(SGT("2026-10-15", "09:50"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links: links(false) })).toMatchObject({ settled: 1, family: 0 });
    expect(box.sent.filter((n) => n.kind === DELIVERY.familyNoReply)).toEqual([]);
  });

  it("signed up at 09:20: only the second reminder is due, and the window is his (settled at 09:45); at 10:00: nothing that day", async () => {
    const box = collect();
    const late = await exampleAccount(SGT("2026-10-13", "09:20"));
    let now = at(SGT("2026-10-13", "09:20"));
    expect(await runDoseDay(store, await scope(late.userId), now, { send: box.send })).toMatchObject({ first: 0, second: 1 });
    now = setClock(SGT("2026-10-13", "09:45"));
    expect(await runDoseDay(store, await scope(late.userId), now, { send: box.send })).toMatchObject({ settled: 1 });

    const later = await exampleAccount(SGT("2026-10-13", "10:00"));
    now = setClock(SGT("2026-10-13", "10:01"));
    expect(await runDoseDay(store, await scope(later.userId), now, { send: box.send })).toMatchObject({ first: 0, second: 0, settled: 0 });
  });

  it("a demo session is never touched", async () => {
    const demo = await store.createSession({ story_day: 43, story_time: "09:50", ttl_hours: 1 });
    const before = await store.listDoses(demo.id);
    expect(await runDoseDay(store, demo, Date.now())).toEqual({ settled: 0, first: 0, second: 0, family: 0, sent: 0 });
    expect(await store.listDoses(demo.id)).toEqual(before);
  });
});
