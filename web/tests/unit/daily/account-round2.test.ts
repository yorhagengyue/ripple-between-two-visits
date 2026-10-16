/**
 * Track B, second round (C2; real-app 4.4, 6.5, 2.7, 2.24): what the read-only check of the code against the design found.
 *
 *   4.4    signing up after 09:45: this morning's cell is untracked, and an answer he writes on it later that day is
 *          never counted: the brief, her view, the visit check card and the pattern question keep 「33 个早上，吃了 29 个」
 *   6.5    the settling covers every tracked cell whose window closed since tracking began (not only yesterday and
 *          today); her alert goes out at the window's close only, never for an old cell (no burst of old alerts)
 *   2.7    the reasons after 没吃 come from his own routine for every slot of the day
 *   cells  a cell he answered stays a cell when the medicine's times change; choosing a time of day for a medicine
 *          that had none starts its cells then (no earlier day becomes "no reply")
 *
 * Example account: d0 Mon 31 Aug 2026 when laid out on Mon 12 Oct (story day 42), tai chi on Tue and Thu. The clock is
 * the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { layoutAtMoment } from "@/lib/crew/filming-account";
import { accountToday } from "@/lib/daily/account-today";
import { buildDoseDay, countedDoseRows, firstTrackedDay, openClosedCells } from "@/lib/daily/cells";
import { answerDose, settleAccountNoReply, undoDose } from "@/lib/daily/doses";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import { DELIVERY, FAMILY_ALERT_FRESH_MS, familyNoReplyAlerts } from "@/lib/daily/no-reply";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { questionsView } from "@/lib/daily/questions";
import { reasonOptions, routineAroundSlot, slotSchedule, type RoutineEntry } from "@/lib/daily/schedule";
import { todayDoseData, reasonsFor } from "@/lib/daily/today-view";
import { answerCounts, answerPreTracking } from "@/lib/daily/tracking";
import { familyWeek } from "@/lib/care/home";
import type { Notice } from "@/lib/jobs/notify";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { reseedExample } from "@/lib/story/example";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { scopeDoseSummary } from "@/lib/summary/scope-doses";
import { visitCheckSummary } from "@/lib/summary/visit-check";
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

async function account(laidOutAt: string, space: "example" | "blank" = "example"): Promise<TestAccount> {
  setClock(laidOutAt);
  return createAccountWithSpace(store, auth, { login: `r${randomUUID().slice(0, 10)}`, password: "a long test password", space });
}

function collect(): { sent: Notice[]; send: (n: Notice) => Promise<{ sent: number }> } {
  const sent: Notice[] = [];
  return { sent, send: async (n) => (sent.push(n), { sent: 1 }) };
}

afterAll(() => setTestClock(null));

describe("real-app 4.4: signed up after 09:45, this morning's cell is never counted, answered or not", () => {
  it("answerCounts: a tracked cell always; an untracked one by what its row is, not by when it was written", () => {
    const since = at(SGT("2026-10-12", "10:00"));
    const close = at(SGT("2026-10-12", "09:45"));
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(answerCounts(null, close, null)).toBe(true); // a demo row: no bound
    expect(answerCounts(since, at(SGT("2026-10-13", "09:45")), null)).toBe(true);
    expect(answerCounts(since, close, null)).toBe(false);
    // laid out with the example (or a correction of such a row): it says so, and counts whenever it was written
    expect(answerCounts(since, close, { created_at: iso(since), pre_tracking: true })).toBe(true);
    expect(answerCounts(since, close, { created_at: iso(since + 30 * 60_000), pre_tracking: true })).toBe(true);
    // his own answer on a window that was not his: at 10:05, and in the very millisecond tracking began
    expect(answerCounts(since, close, { created_at: iso(since + 5 * 60_000), pre_tracking: false })).toBe(false);
    expect(answerCounts(since, close, { created_at: iso(since), pre_tracking: false })).toBe(false);
    // his answer while the window was his, before a filming account's clock moved on: strictly earlier
    expect(answerCounts(since, close, { created_at: iso(since - 1), pre_tracking: false })).toBe(true);
    // a row from before the mark existed (a database without 0018): the rule as it was
    expect(answerCounts(since, close, { created_at: iso(since) })).toBe(true);
    expect(answerCounts(since, close, { created_at: iso(since), pre_tracking: null })).toBe(true);
    expect(answerCounts(since, close, { created_at: iso(since + 5 * 60_000) })).toBe(false);
    expect(answerCounts(since, close, { created_at: "not a time", pre_tracking: false })).toBe(false);
  });

  it("answerPreTracking: true only for an answer that replaces one that counted on a cell outside tracking", () => {
    expect(answerPreTracking({ tracked: true, counted: true })).toBe(false); // a tracked cell: a plain answer
    expect(answerPreTracking({ tracked: false, counted: false })).toBe(false); // nothing that counted was there: his note
    expect(answerPreTracking({ tracked: false, counted: true })).toBe(true); // a correction of his laid-out history
  });

  it("the example's laid-out mornings say what they are; a demo row and a blank account carry no such mark", async () => {
    const him = await account(SGT("2026-10-12", "10:00"));
    const rows = await store.listDoses(him.userId);
    expect(rows).toHaveLength(33);
    expect(rows.every((r) => r.pre_tracking === true)).toBe(true);
    // 「重新铺一遍」 lays them out the same way
    setClock(SGT("2026-10-12", "11:00"));
    await reseedExample(store, await scope(him.userId));
    expect((await store.listDoses(him.userId)).map((r) => r.pre_tracking)).toEqual(Array.from({ length: 33 }, () => true));
    // the demo's rows are as they always were (no key at all)
    const demo = await store.createSession({ story_day: 42, ttl_hours: 1 });
    const demoRows = await store.listDoses(demo.id);
    expect(demoRows).toHaveLength(33);
    expect(demoRows.some((r) => "pre_tracking" in r)).toBe(false);
    const ticked = await store.logDose(demo.id, { medication_id: AML, day: 42, slot: "morning", state: "taken" });
    expect("pre_tracking" in ticked).toBe(false);
    // a filming account's layout is laid-out history too (each dose stamped with its own story moment, before "now")
    const lay = layoutAtMoment("scope-x", { day: 29, time: "20:15" });
    expect(lay.tables.dose_logs.length).toBeGreaterThan(0);
    expect(lay.tables.dose_logs.every((d) => d.pre_tracking === true && Date.parse(d.created_at) < lay.at)).toBe(true);
  });

  it("a correction of a laid-out morning keeps the morning in every count; undo with and without the earlier answer", async () => {
    const him = await account(SGT("2026-10-12", "10:00"));
    const count = async (now: number) => {
      const b = await buildAccountBrief(store, await scope(him.userId), "zh-Hans", { nowMs: now, translate: "cache" });
      return [b.doses.due, b.doses.taken, b.doses.missed, b.doses.unconfirmed];
    };
    let now = setClock(SGT("2026-10-12", "10:30"));
    expect(await count(now)).toEqual([33, 29, 4, 0]);
    // yesterday (day 41) was laid out as taken; he says it was not
    const fixed = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "missed", reason: "forgot", when: "yesterday" }, now);
    expect(fixed).toMatchObject({ day: 41, state: "missed", pre_tracking: true, created_at: new Date(now).toISOString() });
    expect(await count(now)).toEqual([33, 28, 5, 0]);
    // her view and the rows the pattern question reads agree
    expect(await scopeDoseSummary(store, await scope(him.userId), { fromDay: 9, toDay: 42, nowMs: now })).toMatchObject({ due: 33, taken: 28, missed: 5 });
    const rows = await store.listDoses(him.userId, { toDay: 42 });
    expect(countedDoseRows(await scope(him.userId), await store.listMeds(him.userId), rows)).toHaveLength(33);

    // the undo bar puts the answer he had before back: still that morning, taken again
    now = setClock(SGT("2026-10-12", "10:31"));
    const back = await undoDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", when: "yesterday", restore: { state: "taken" } }, now);
    expect(back).toMatchObject({ day: 41, state: "taken", pre_tracking: true });
    expect(await count(now)).toEqual([33, 29, 4, 0]);

    // an undo with nothing to put back removes the record of that morning: it is no longer an answered morning ...
    now = setClock(SGT("2026-10-12", "10:32"));
    expect(await undoDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", when: "yesterday" }, now)).toBeNull();
    expect(await count(now)).toEqual([32, 28, 4, 0]);
    // ... and an answer written on it afterwards is his note on a window that was not his
    const note = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken", when: "yesterday" }, now);
    expect(note.pre_tracking).toBe(false);
    expect(await count(now)).toEqual([32, 28, 4, 0]);
  });

  it("this morning's untracked cell: his answer, a change of mind and an undo all stay his own note", async () => {
    const him = await account(SGT("2026-10-12", "10:00"));
    // the same millisecond as the sign-up (a frozen clock)
    let now = at(SGT("2026-10-12", "10:00"));
    const first = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(first).toMatchObject({ day: 42, state: "taken", pre_tracking: false, created_at: new Date(now).toISOString() });
    const brief = async () => (await buildAccountBrief(store, await scope(him.userId), "zh-Hans", { nowMs: now, translate: "cache" })).doses;
    expect(await brief()).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    now = setClock(SGT("2026-10-12", "10:02"));
    const changed = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "missed", reason: "forgot" }, now);
    expect(changed.pre_tracking).toBe(false);
    expect(await brief()).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    const back = await undoDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", restore: { state: "taken" } }, now);
    expect(back).toMatchObject({ state: "taken", pre_tracking: false });
    expect(await brief()).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
  });

  it("a filming account: an answer given while the window was his still counts after the clock moves on, and so does its correction", async () => {
    // laid out at 07:00: this morning's window (closes 09:45) is his
    const him = await account(SGT("2026-10-12", "07:00"));
    let now = setClock(SGT("2026-10-12", "08:52"));
    const row = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(row.pre_tracking).toBe(false);
    // tracking moves on past the window (what a filming account's clock move does to tracking_since)
    await store.updateScope(him.userId, { tracking_since: SGT("2026-10-12", "14:00") });
    now = setClock(SGT("2026-10-12", "14:00"));
    const cellNow = async () => buildDoseDay(await scope(him.userId), 42, await store.listMeds(him.userId), await store.listDoses(him.userId, { fromDay: 42, toDay: 42 }), now)[0].cells[0];
    expect(await cellNow()).toMatchObject({ state: "taken", tracked: false, counted: true });
    // 「改一下」 afterwards, even in the very millisecond tracking moved to: the morning stays, with the new answer
    const fixed = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "missed", reason: "forgot" }, now);
    expect(fixed).toMatchObject({ state: "missed", pre_tracking: true });
    expect(await cellNow()).toMatchObject({ state: "missed", tracked: false, counted: true });
    expect((await buildAccountBrief(store, await scope(him.userId), "zh-Hans", { nowMs: now, translate: "cache" })).doses).toMatchObject({ due: 34, taken: 29, missed: 5 });
  });

  it("laid out at 10:00, 吃了 at 10:05 on the untracked cell: Today shows his answer; 33 / 29 everywhere, all day", async () => {
    const him = await account(SGT("2026-10-12", "10:00"));
    let now = setClock(SGT("2026-10-12", "10:05"));
    const row = await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    expect(row).toMatchObject({ day: 42, slot: "morning", state: "taken" });

    // his own screen keeps what he logged
    const today = await accountToday(store, await scope(him.userId), now, {}, "zh-Hans");
    const cell = today.slots[0].cells[0];
    expect(cell).toMatchObject({ state: "taken", tracked: false, counted: false });

    for (const hhmm of ["10:06", "15:00", "23:50"]) {
      now = setClock(SGT("2026-10-12", hhmm));
      const s = await scope(him.userId);
      // 1. the brief
      const brief = await buildAccountBrief(store, s, "zh-Hans", { nowMs: now, translate: "cache" });
      expect(brief.doses).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
      // 2. her view counts with the same function (lib/care/home.ts familyWeek, familyHome)
      expect(await scopeDoseSummary(store, s, { fromDay: 9, toDay: 42, nowMs: now })).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
      // this week on her page: Monday (today) has nothing to count
      const week = await familyWeek(store, s, now, 0);
      expect(week.daysDue).toBe(0);
      // 3. the visit check card
      const v3 = (await store.listVisits(him.userId)).find((v) => v.status === "planned")!;
      const card = await visitCheckSummary(store, s, { visit: v3, startedMs: now, locale: "zh-Hans" });
      expect(card.doses).toEqual(brief.doses);
    }
  });

  it("the pattern question: 没吃 on the untracked morning of a tai chi day adds nothing to 「漏吃的 4 个早上」", async () => {
    // laid out on Tue 13 Oct at 10:00 (a tai chi morning; the window closed at 09:45)
    const him = await account(SGT("2026-10-13", "10:00"));
    const before = (await store.getQuestion(him.userId, "q-tai-chi"))!;
    expect(before.text).toContain("4");
    const now = setClock(SGT("2026-10-13", "10:05"));
    const s = await scope(him.userId);
    await answerDose(store, s, { medication_id: AML, slot: "morning", state: "missed", reason: "tai_chi_morning", reason_text: "打太极" }, now);
    await syncPatternQuestions(store, await scope(him.userId));
    const after = (await store.getQuestion(him.userId, "q-tai-chi"))!;
    expect(after.text).toBe(before.text);
    expect(after.evidence).toBe(before.evidence);
    // the list's own wording and the brief's use the same rows
    const list = await questionsView(store, await scope(him.userId), "zh-Hans");
    expect(list.doctor.find((q) => q.id === "q-tai-chi")?.text).toBe(before.text);
    const brief = await buildAccountBrief(store, await scope(him.userId), "zh-Hans", { nowMs: now, translate: "cache" });
    expect(brief.questions.shown.find((q) => q.id === "q-tai-chi")?.text).toBe(before.text);
    expect(brief.doses).toMatchObject({ due: 33, taken: 29, missed: 4 });
    // the rows themselves: the example's 33 stay, his late answer is the one left out
    const rows = await store.listDoses(him.userId, { toDay: 43 });
    const counted = countedDoseRows(await scope(him.userId), await store.listMeds(him.userId), rows);
    expect(rows.length - counted.length).toBe(1);
    expect(counted.some((d) => d.day === 43)).toBe(false);
  });

  it("the next morning is his: tracked, counted once answered or once closed", async () => {
    const him = await account(SGT("2026-10-12", "10:00"));
    let now = setClock(SGT("2026-10-13", "08:52"));
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    now = setClock(SGT("2026-10-13", "09:00"));
    expect(await scopeDoseSummary(store, await scope(him.userId), { fromDay: 9, toDay: 43, nowMs: now })).toMatchObject({ due: 34, taken: 30 });
  });
});

describe("real-app 6.5: the settling covers every tracked cell since tracking began; her alert only at the window's close", () => {
  it("three days with no run (the server was down): Mon to Thu each get their row; nothing before he started; her alert only for today's", async () => {
    // laid out Mon 12 Oct 07:00: Monday's window (09:45) is already his
    const him = await account(SGT("2026-10-12", "07:00"));
    const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite(
      { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
      { dose_summary: true, no_reply_alert: true },
    );
    if (!inv.ok) throw new Error(inv.code);
    const linkId = inv.link.id;
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(linkId, him.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    const links = async (): Promise<LinkWithSwitch[]> => [{ link: (await store.getCareLink(linkId))!, noReplyAlert: true, locale: "zh-Hans" }];

    const s0 = await scope(him.userId);
    expect(firstTrackedDay(s0, await store.listMeds(him.userId))).toBe(42);

    // Thu 15 Oct 12:00, the first run since Monday morning
    const now = setClock(SGT("2026-10-15", "12:00"));
    const s = await scope(him.userId);
    expect(s.story_day).toBe(45);
    const open = openClosedCells(s, await store.listMeds(s.id), await store.listDoses(s.id, { fromDay: 42, toDay: 45 }), 42, 45, now);
    expect(open.map((c) => [c.day, c.slot])).toEqual([
      [42, "morning"],
      [43, "morning"],
      [44, "morning"],
      [45, "morning"],
    ]);

    const box = collect();
    const counts = await runDoseDay(store, s, now, { send: box.send, links });
    expect(counts).toMatchObject({ settled: 4, family: 1 });
    const rows = await store.listDoses(him.userId, { fromDay: 42, toDay: 45 });
    expect(rows.map((d) => [d.day, d.state, d.reason])).toEqual([
      [42, "unconfirmed", "no_reply"],
      [43, "unconfirmed", "no_reply"],
      [44, "unconfirmed", "no_reply"],
      [45, "unconfirmed", "no_reply"],
    ]);
    // the example's own history is untouched: 33 rows before day 42, none of them rewritten
    expect((await store.listDoses(him.userId, { toDay: 41 })).length).toBe(33);

    // her alert: one, for this morning (closed 2 h 15 min ago); the three old mornings are in his record only
    const toHer = box.sent.filter((n) => n.kind === DELIVERY.familyNoReply);
    expect(toHer).toHaveLength(1);
    expect(toHer[0].tag).toBe("no-reply-2026-10-15-morning");
    expect((await familyNoReplyAlerts(store, s, linkId)).map((a) => a.day)).toEqual([45]);

    // idempotent: another run writes nothing and sends nothing
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links })).toMatchObject({ settled: 0, family: 0 });
    expect(await settleAccountNoReply(store, await scope(him.userId), now)).toEqual([]);

    // the summary and the record agree: 33 + 4, four of them not confirmed
    expect(await scopeDoseSummary(store, await scope(him.userId), { fromDay: 9, toDay: 45, nowMs: now })).toMatchObject({ due: 37, taken: 29, missed: 4, unconfirmed: 4 });
  });

  it("the first run comes more than six hours after the window closed: the cell is settled, she is not told", async () => {
    const him = await account(SGT("2026-10-12", "07:00"));
    const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
    const inv = await store.createInvite(
      { patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" },
      { dose_summary: true, no_reply_alert: true },
    );
    if (!inv.ok) throw new Error(inv.code);
    const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
    if (!acc.ok) throw new Error(acc.code);
    const ok = await store.confirmLink(inv.link.id, him.userId, true);
    if (!ok.ok) throw new Error(ok.code);
    const links = async (): Promise<LinkWithSwitch[]> => [{ link: (await store.getCareLink(inv.link.id))!, noReplyAlert: true, locale: "zh-Hans" }];

    expect(FAMILY_ALERT_FRESH_MS).toBe(6 * 60 * 60 * 1000);
    // 15:44 is 5 h 59 min after 09:45: still hers; a second account's first run at 15:46 is not
    const box = collect();
    let now = setClock(SGT("2026-10-12", "15:46"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links })).toMatchObject({ settled: 1, family: 0 });
    expect(box.sent.filter((n) => n.kind === DELIVERY.familyNoReply)).toEqual([]);
    // and never later either
    now = setClock(SGT("2026-10-12", "21:00"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links })).toMatchObject({ settled: 0, family: 0 });

    // the next morning at 15:44 (5 h 59 min after the close): she is told
    now = setClock(SGT("2026-10-13", "15:44"));
    expect(await runDoseDay(store, await scope(him.userId), now, { send: box.send, links })).toMatchObject({ settled: 1, family: 1 });
    expect(box.sent.filter((n) => n.kind === DELIVERY.familyNoReply).map((n) => n.tag)).toEqual(["no-reply-2026-10-13-morning"]);
  });
});

describe("real-app 2.7: the reasons after 没吃 come from his own routine, for every slot", () => {
  const routine: RoutineEntry[] = [
    { label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:30" },
    { label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" },
    { label: "Mahjong", label_zh: "打麻将", days: ["Tue", "Fri"], time: "19:30" },
    { label: "Market", label_zh: "买菜", days: ["Tue"], time: "11:00" },
  ];
  const d0 = "2026-08-31"; // a Monday: day 1 is a Tuesday

  it("a routine counts for a slot when it falls from three hours before the first reminder to an hour after the close", () => {
    const morning = slotSchedule(routine, "morning"); // 08:45 / 09:15 / 09:45
    expect(routineAroundSlot({ time: "07:30" }, morning)).toBe(true);
    expect(routineAroundSlot({ time: "05:45" }, morning)).toBe(true);
    expect(routineAroundSlot({ time: "05:44" }, morning)).toBe(false);
    expect(routineAroundSlot({ time: "10:45" }, morning)).toBe(true);
    expect(routineAroundSlot({ time: "10:46" }, morning)).toBe(false);
    expect(routineAroundSlot({ time: "after lunch" }, morning)).toBe(false);
  });

  it("Tuesday: tai chi for the morning, the market for midday, mahjong for the evening and for bedtime; the fixed three after them", () => {
    const codes = (slot: "morning" | "midday" | "evening" | "night") => reasonOptions(routine, d0, 1, { slot, schedule: slotSchedule(routine, slot) }).map((r) => r.code);
    expect(codes("morning")).toEqual(["tai_chi_morning", "forgot", "away", "not_with_me"]);
    expect(codes("midday")).toEqual(["market_midday", "forgot", "away", "not_with_me"]);
    expect(codes("evening")).toEqual(["mahjong_evening", "forgot", "away", "not_with_me"]);
    expect(codes("night")).toEqual(["mahjong_night", "forgot", "away", "not_with_me"]);
    // Wednesday: nothing of his falls on it
    expect(reasonOptions(routine, d0, 2, { slot: "evening", schedule: slotSchedule(routine, "evening") }).map((r) => r.code)).toEqual(["forgot", "away", "not_with_me"]);
    // the demo's call (no slot) is as before
    expect(reasonOptions(routine, d0, 1).map((r) => r.code)).toEqual(["tai_chi_morning", "mahjong_morning", "market_morning", "forgot", "away", "not_with_me"]);
  });

  it("Today's data carries each slot's own reasons, today's and yesterday's", async () => {
    // laid out on Mon 12 Oct: Tue 13 Oct is a tai chi day
    const him = await account(SGT("2026-10-12", "10:00"));
    const s0 = await scope(him.userId);
    await store.updateScope(him.userId, { settings: { ...s0.settings, routine: [...(s0.settings.routine ?? []), { label: "Mahjong", label_zh: "打麻将", days: ["Tue"], time: "19:30" }] } });
    await store.updateMed(him.userId, AML, { dose_slots: ["morning", "evening"], dose_slots_source: "patient" });
    const now = setClock(SGT("2026-10-13", "08:50"));
    const s = await scope(him.userId);
    const today = await accountToday(store, s, now, {}, "zh-Hans");
    const data = todayDoseData(today, "zh-Hans", "Asia/Singapore");
    expect(reasonsFor(data, { slot: "morning", when: "today" }).map((r) => r.label)).toEqual(["打太极", "忘记服用", "外出", "药物不在身边"]);
    expect(reasonsFor(data, { slot: "evening", when: "today" }).map((r) => r.label)).toEqual(["打麻将", "忘记服用", "外出", "药物不在身边"]);
    expect(reasonsFor(data, { slot: "evening", when: "today" })[0].code).toBe("mahjong_evening");
    // yesterday was a Monday: only the fixed ones
    expect(reasonsFor(data, { slot: "evening", when: "yesterday" }).map((r) => r.label)).toEqual(["忘记服用", "外出", "药物不在身边"]);
  });
});

describe("cells: his record stays when a medicine's times change", () => {
  it("a cell he answered is still a cell after the medicine's time of day changed; an unanswered one of the old time is gone", async () => {
    const him = await account(SGT("2026-10-12", "07:00"));
    let now = setClock(SGT("2026-10-12", "08:52"));
    await answerDose(store, await scope(him.userId), { medication_id: AML, slot: "morning", state: "taken" }, now);
    // the label is read again as an evening medicine
    await store.updateMed(him.userId, AML, { dose_slots: ["evening"], dose_slots_source: "patient" });
    now = setClock(SGT("2026-10-12", "12:00"));
    const s = await scope(him.userId);
    const meds = await store.listMeds(s.id);
    const day = buildDoseDay(s, 42, meds, await store.listDoses(s.id, { fromDay: 42, toDay: 42 }), now);
    expect(day.map((d) => [d.slot, d.cells.map((c) => c.state)])).toEqual([
      ["morning", ["taken"]],
      ["evening", [null]],
    ]);
    expect(await scopeDoseSummary(store, s, { fromDay: 9, toDay: 42, nowMs: now })).toMatchObject({ due: 34, taken: 30 });
    // tomorrow has no morning cell any more
    expect(buildDoseDay(s, 43, meds, [], at(SGT("2026-10-13", "12:00"))).map((d) => d.slot)).toEqual(["evening"]);
  });
});
