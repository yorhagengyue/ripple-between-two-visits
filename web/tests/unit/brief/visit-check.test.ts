/**
 * The visit check card counts as the brief does (C2 track B for track F; real-app 4.4 「核对卡和简报用同一口径」): the
 * same window (after the last clinic visit that happened), the visit day's cell by the same rule as of the moment the
 * visit started, the same readings and target, the same three questions.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { answerDose } from "@/lib/daily/doses";
import { MemoryStore } from "@/lib/store/memory";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { visitCheckSummary } from "@/lib/summary/visit-check";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
afterAll(() => setTestClock(null));

async function example(laidOutAt: string): Promise<string> {
  setTestClock({ at: laidOutAt, frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `v${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return a.userId;
}

async function scopeAt(id: string, at: string) {
  setTestClock({ at, frozen: true });
  return (await store.getSession(id))!;
}

describe("the check card of the visit on Mon 12 Oct (the example's v3)", () => {
  it("laid out at 10:00, the visit starts at 10:00: what the brief says at that moment", async () => {
    const id = await example("2026-10-12T10:00:00+08:00");
    const scope = await scopeAt(id, "2026-10-12T10:00:00+08:00");
    const v3 = (await store.listVisits(id)).find((v) => v.status === "planned")!;
    expect(v3).toMatchObject({ day: 42 });
    const start = Date.parse("2026-10-12T10:00:00+08:00");
    const card = await visitCheckSummary(store, scope, { visit: v3, startedMs: start, locale: "zh-Hans" });
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs: start, translate: "cache" });
    expect(card.window).toMatchObject({ fromDay: 9, toDay: 42, fromDate: "2026-09-09", toDate: "2026-10-12", lastVisit: { id: "v2", date: "2026-09-08" } });
    expect(card.window).toEqual(brief.window);
    expect(card.doses).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    expect(card.doses).toEqual(brief.doses);
    expect(card.bp).toEqual(brief.bp);
    expect(card.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
    expect(card.target).toMatchObject({ kind: "target", systolic: 135, diastolic: 85, text: "At home, we want it below 135 over 85." });
    expect(card.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(card.questions).toEqual(brief.questions);
  });

  it("laid out at 07:00 and 吃了 at 08:52: 34 and 30 on both; a reading after the visit started is not on the card", async () => {
    const id = await example("2026-10-12T07:00:00+08:00");
    let scope = await scopeAt(id, "2026-10-12T08:52:00+08:00");
    await answerDose(store, scope, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, Date.parse("2026-10-12T08:52:00+08:00"));
    scope = await scopeAt(id, "2026-10-12T10:30:00+08:00");
    await store.addBp(id, { day: 42, slot: "morning", systolic: 150, diastolic: 95 });
    const v3 = (await store.listVisits(id)).find((v) => v.status === "planned")!;
    const card = await visitCheckSummary(store, scope, { visit: v3, startedMs: Date.parse("2026-10-12T10:00:00+08:00"), locale: "zh-Hans" });
    expect(card.doses).toMatchObject({ due: 34, taken: 30, missed: 4, unconfirmed: 0 });
    expect(card.bp.count).toBe(10);
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs: Date.parse("2026-10-12T10:30:00+08:00"), translate: "cache" });
    expect(brief.doses).toMatchObject({ due: 34, taken: 30 });
    expect(brief.bp.count).toBe(11);
  });
});
