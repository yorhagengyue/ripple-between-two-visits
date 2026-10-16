/**
 * The brief on an account (C2 track B, journey 14; real-app 2.18, 4.4): the window starts after the last clinic visit
 * that happened (never a planned visit or an empty recording), real dates, the numbers of the example data with today's
 * cell counted only when it is his (the 4.4 table), readings next to the doctor's warning line on their own lines, no
 * scope id, and the same counts from scopeDoseSummary (her view and the check card use it).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { answerDose } from "@/lib/daily/doses";
import { MemoryStore } from "@/lib/store/memory";
import { buildAccountBrief, nextPlannedVisit } from "@/lib/summary/account-brief";
import { scopeDoseSummary } from "@/lib/summary/scope-doses";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
afterAll(() => setTestClock(null));

async function example(laidOutAt: string) {
  setTestClock({ at: laidOutAt, frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `k${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return a.userId;
}

async function brief(userId: string, at: string) {
  setTestClock({ at, frozen: true });
  const scope = (await store.getSession(userId))!;
  return { scope, view: await buildAccountBrief(store, scope, "zh-Hans", { nowMs: Date.parse(at), translate: "cache" }) };
}

describe("the example account's brief (laid out on Mon 12 Oct; v2 on 8 Sep is the last clinic visit; v3 is planned today)", () => {
  it("laid out at 10:00: 9 Sep to 12 Oct, 10 readings averaging 140/85 (9 not below the target), 33 doses, 29 taken; today's cell is not his", async () => {
    const id = await example("2026-10-12T10:00:00+08:00");
    const { scope, view } = await brief(id, "2026-10-12T10:05:00+08:00");
    expect(view.window).toMatchObject({ fromDay: 9, toDay: 42, fromDate: "2026-09-09", toDate: "2026-10-12", lastVisit: { id: "v2", date: "2026-09-08" } });
    expect(view.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
    expect(view.targetLine).toMatchObject({ kind: "target", text: "At home, we want it below 135 over 85.", systolic: 135, diastolic: 85, date: "2026-08-31", state: "confirmed" });
    expect(view.doses).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    expect(view.doses.routine).toMatchObject({ weekdays: ["Tue", "Thu"], all: true });
    expect(view.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(view.notes.map((n) => n.date)).toEqual(["2026-09-20", "2026-10-07"]);
    expect(view.nextVisit).toEqual({ date: "2026-10-12", days: 0, place: "Blossom Family Clinic (fictional)" });
    // track K's diet check: nothing answered in the window, so no line at all
    expect(view.diet).toBeNull();
    // the same counts wherever they are read
    expect(await scopeDoseSummary(store, scope, { fromDay: 9, toDay: 42, nowMs: Date.parse("2026-10-12T10:05:00+08:00") })).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    // nothing in it names the scope
    expect(JSON.stringify(view)).not.toContain(id);
  });

  it("laid out at 07:00 (real-app 4.4): before 09:45 today does not count; taken at 08:52 it does; no answer at 09:46 counts as not confirmed", async () => {
    const quiet = await example("2026-10-12T07:00:00+08:00");
    expect((await brief(quiet, "2026-10-12T09:00:00+08:00")).view.doses).toMatchObject({ due: 33, taken: 29 });
    expect((await brief(quiet, "2026-10-12T09:46:00+08:00")).view.doses).toMatchObject({ due: 34, taken: 29, missed: 4, unconfirmed: 1 });

    const took = await example("2026-10-12T07:00:00+08:00");
    setTestClock({ at: "2026-10-12T08:52:00+08:00", frozen: true });
    await answerDose(store, (await store.getSession(took))!, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, Date.parse("2026-10-12T08:52:00+08:00"));
    expect((await brief(took, "2026-10-12T09:00:00+08:00")).view.doses).toMatchObject({ due: 34, taken: 30, missed: 4, unconfirmed: 0 });
  });

  it("his diet check answers in the window: track K's line over the brief's own window (counts only)", async () => {
    const id = await example("2026-10-12T10:00:00+08:00");
    await store.setDietCheck(id, { day: 5, item: "soup", answer: "yes", source_ref: "v1:v1-u07" }); // before the window
    await store.setDietCheck(id, { day: 40, item: "soup", answer: "no", source_ref: "v1:v1-u07" });
    await store.setDietCheck(id, { day: 41, item: "soup", answer: "yes", source_ref: "v1:v1-u07" });
    const { view } = await brief(id, "2026-10-12T10:05:00+08:00");
    expect(view.diet).toMatchObject({ item: "soup", days: 34, answered: 2, yes: 1, no: 1, fromDate: "2026-09-09", toDate: "2026-10-12", doctor: { visitId: "v1" } });
    expect(view.diet?.text).toContain("饮食核对（问的是医生 8月31日 说的话），9月9日–10月12日：34 天里答了 2 天；");
  });

  it("a reading above the doctor's warning line he confirmed is listed on its own line, with its date and time", async () => {
    const id = await example("2026-10-12T07:00:00+08:00");
    setTestClock({ at: "2026-10-12T08:15:00+08:00", frozen: true });
    await store.addBp(id, { day: 42, slot: "morning", systolic: 185, diastolic: 112 });
    const { view } = await brief(id, "2026-10-12T08:20:00+08:00");
    expect(view.above?.line).toMatchObject({ kind: "threshold", systolic: 180, state: "confirmed" });
    expect(view.above?.readings).toEqual([expect.objectContaining({ date: "2026-10-12", time: "08:15", systolic: 185, diastolic: 112 })]);
    expect(view.bp.count).toBe(11);
  });
});

describe("the window starts after the last clinic visit that happened", () => {
  it("a planned visit and an empty recording are not boundaries; a visit with a transcript is (its day included)", async () => {
    setTestClock({ at: "2026-10-12T09:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const sid = a.userId;
    setTestClock({ at: "2026-10-20T09:00:00+08:00", frozen: true });
    await store.upsertVisit(sid, { id: "planned", kind: "follow_up", place: "Clinic", day: 5, status: "planned" });
    await store.upsertVisit(sid, { id: "empty", kind: "follow_up", place: "Clinic", day: 6, status: "review" });
    let view = (await brief(sid, "2026-10-20T09:00:00+08:00")).view;
    expect(view.window).toMatchObject({ fromDay: 0, toDay: 8, lastVisit: null });
    await store.upsertVisit(sid, { id: "real", kind: "follow_up", place: "Clinic", day: 7, status: "review" });
    await store.addUtterances(sid, "real", [{ t_start_ms: 0, t_end_ms: 1000, text: "Sure, no problem.", role: "doctor", role_state: "inferred" }]);
    view = (await brief(sid, "2026-10-20T09:00:00+08:00")).view;
    expect(view.window).toMatchObject({ fromDay: 8, toDay: 8, lastVisit: { id: "real", day: 7 } });
  });

  it("the next planned visit within reach: today is 0 days, a past one is not next", () => {
    const visits = [
      { status: "planned" as const, date: "2026-10-01", place: "A" },
      { status: "planned" as const, date: "2026-10-15", place: "B" },
      { status: "confirmed" as const, date: "2026-10-13", place: "C" },
    ];
    expect(nextPlannedVisit(visits, "2026-10-12", "2026-08-31")).toEqual({ date: "2026-10-15", days: 3, place: "B" });
    expect(nextPlannedVisit(visits, "2026-10-16", "2026-08-31")).toBeNull();
  });
});
