/**
 * Blood pressure on an account, second round (C2 track B; real-app 2.9, 6.2, 12): POST /api/bp takes `when` like his dose
 * answers; a reading is the morning's before noon and the evening's from noon on (so a 14:00 reading stops the evening
 * reminder); a corrected or deleted reading keeps a record of the change (the row and its history), and the undo bar puts
 * the same reading back; the job writes "not measured" for every part of the plan that passed since he started.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as bpDelete, GET as bpGet, PATCH as bpPatch, POST as bpPost } from "@/app/api/bp/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accountBpView } from "@/lib/daily/bp";
import { accountPartAt, accountPartOf, readingPlace } from "@/lib/daily/bp-changes";
import { runBpDay } from "@/lib/daily/bp-run";
import type { Notice } from "@/lib/jobs/notify";
import { getMemoryStore } from "@/lib/store/memory";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const V1_U05 = "I want you to measure at home for one week, morning and evening.";
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

function req(path: string, method: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function clock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return Date.parse(iso);
}

async function blankWithPlan(laidOutAt: string): Promise<TestAccount> {
  clock(laidOutAt);
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  await store.upsertVisit(a.userId, { id: "visit-1", kind: "healthier_sg_check_in", place: "Clinic", day: 0, status: "confirmed" });
  await store.addVisitItems(a.userId, "visit-1", [{ type: "instruction", text: V1_U05, slots: { variant: "measure_home" }, confirmed_by: "patient", speaker: "doctor" }]);
  return a;
}

afterAll(() => setTestClock(null));

describe("the part of the day: morning or evening, by his real clock (real-app 2.9)", () => {
  it("before noon morning, from noon evening; no third part", () => {
    expect(["00:10", "08:00", "11:59"].map(accountPartAt)).toEqual(["morning", "morning", "morning"]);
    expect(["12:00", "14:00", "17:59", "18:00", "23:30"].map(accountPartAt)).toEqual(["evening", "evening", "evening", "evening", "evening"]);
    // rows written before this rule (midday, night) count for the evening
    expect((["morning", "midday", "evening", "night"] as const).map((slot) => accountPartOf({ slot }))).toEqual(["morning", "evening", "evening", "evening"]);
    expect(readingPlace({ story_day: 5, story_time: "14:00" }, {})).toEqual({ day: 5, part: "evening" });
    expect(readingPlace({ story_day: 5, story_time: "09:00" }, { when: "yesterday" })).toEqual({ day: 4, part: "evening" });
    expect(readingPlace({ story_day: 5, story_time: "09:00" }, { when: "yesterday", part: "morning" })).toEqual({ day: 4, part: "morning" });
  });

  it("a reading at 14:00 is the day's evening reading: no evening reminder at 20:00, nothing 'not measured' at 23:00", async () => {
    const him = await blankWithPlan(SGT("2026-10-12", "09:00"));
    const t = him.tokens.access_token;
    const sent: Notice[] = [];
    const send = async (n: Notice) => (sent.push(n), { sent: 1 });
    const run = async (hhmm: string) => {
      const now = clock(SGT("2026-10-13", hhmm));
      return runBpDay(store, (await store.getSession(him.userId))!, now, { send });
    };
    expect(await run("08:00")).toMatchObject({ reminded: 1 });
    clock(SGT("2026-10-13", "08:10"));
    expect((await (await bpPost(req("/api/bp", "POST", t, { systolic: 142, diastolic: 88 }))).json()).reading).toMatchObject({ day: 1, slot: "morning" });
    clock(SGT("2026-10-13", "14:00"));
    const afternoon = await (await bpPost(req("/api/bp", "POST", t, { systolic: 138, diastolic: 84 }))).json();
    expect(afternoon.reading).toMatchObject({ day: 1, slot: "evening", systolic: 138 });
    // the screens say the same: the evening part is measured
    const view = await accountBpView(store, (await store.getSession(him.userId))!, "zh-Hans", Date.parse(SGT("2026-10-13", "14:01")));
    expect(view.plan!.today.map((p) => `${p.part}:${p.state}`)).toEqual(["morning:measured", "evening:measured"]);
    expect(view.readings.filter((r) => r.day === 1).map((r) => [r.part, r.time])).toEqual([
      ["morning", "08:10"],
      ["evening", "14:00"],
    ]);
    expect(await run("20:00")).toMatchObject({ reminded: 0 });
    expect(await run("23:00")).toMatchObject({ notMeasured: 0 });
    expect(sent.map((n) => n.tag)).toEqual(["bp-2026-10-13-morning"]);
  });
});

describe("POST /api/bp takes `when` (real-app 6.2), like POST /api/doses", () => {
  let him: TestAccount;
  beforeAll(async () => {
    clock(SGT("2026-10-12", "10:00"));
    him = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    clock(SGT("2026-10-13", "08:52"));
  });

  it("when: today is today; when: yesterday writes yesterday (its evening, or the part he names); a day, a slot, or a part for today: 400", async () => {
    const t = him.tokens.access_token;
    const today = await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, when: "today" }));
    expect(today.status).toBe(201);
    expect((await today.json()).reading).toMatchObject({ day: 43, slot: "morning" });
    const y = await bpPost(req("/api/bp", "POST", t, { systolic: 136, diastolic: 82, when: "yesterday" }));
    expect(y.status).toBe(201);
    expect((await y.json()).reading).toMatchObject({ day: 42, slot: "evening", systolic: 136, diastolic: 82, state: "recorded" });
    const ym = await bpPost(req("/api/bp", "POST", t, { systolic: 134, diastolic: 80, when: "yesterday", part: "morning" }));
    expect((await ym.json()).reading).toMatchObject({ day: 42, slot: "morning" });
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, when: "last week" }))).status).toBe(400);
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, part: "evening" }))).status).toBe(400);
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, day: 42 }))).status).toBe(400);
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, slot: "evening" }))).status).toBe(400);
    // 「这次没量」 for yesterday too
    const skipped = await bpPost(req("/api/bp", "POST", t, { state: "unconfirmed", when: "yesterday", part: "morning" }));
    expect((await skipped.json()).reading).toMatchObject({ day: 42, slot: "morning", state: "unconfirmed" });
    // the answer never names the scope
    expect(JSON.stringify(await (await bpGet(req("/api/bp", "GET", t))).json())).not.toContain(him.userId);
  });

  it("a reading that waited on his phone (track O's `at`) is dated by the tap: its day, its part by the same rule; `at` with `when` is refused", async () => {
    const t = him.tokens.access_token;
    // tapped yesterday at 14:00, sent this morning
    const late = await bpPost(req("/api/bp", "POST", t, { id: randomUUID(), systolic: 137, diastolic: 83, at: SGT("2026-10-12", "14:00") }));
    expect(late.status).toBe(201);
    expect((await late.json()).reading).toMatchObject({ day: 42, slot: "evening", created_at: "2026-10-12T06:00:00.000Z" });
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 137, diastolic: 83, at: SGT("2026-10-12", "14:00"), when: "yesterday" }))).status).toBe(400);
  });

  it("yesterday's reading can be written, not changed: PATCH and DELETE stay today's only", async () => {
    const t = him.tokens.access_token;
    const y = (await store.listBp(him.userId, { fromDay: 42, toDay: 42 })).find((r) => r.systolic === 136)!;
    expect((await bpPatch(req("/api/bp", "PATCH", t, { id: y.id, systolic: 130, diastolic: 80 }))).status).toBe(404);
    expect((await bpDelete(req("/api/bp", "DELETE", t, { id: y.id }))).status).toBe(404);
  });
});

describe("a corrected or deleted reading keeps a record of the change (real-app 12)", () => {
  let him: TestAccount;
  beforeAll(async () => {
    clock(SGT("2026-10-12", "10:00"));
    him = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  });

  it("PATCH: the new numbers on the reading, the old ones in its history with the moment of the change", async () => {
    const t = him.tokens.access_token;
    clock(SGT("2026-10-13", "08:10"));
    const id = randomUUID();
    await bpPost(req("/api/bp", "POST", t, { id, systolic: 185, diastolic: 112, pulse: 80 }));
    clock(SGT("2026-10-13", "08:12"));
    const patched = await (await bpPatch(req("/api/bp", "PATCH", t, { id, systolic: 135, diastolic: 82 }))).json();
    expect(patched.reading).toMatchObject({ id, systolic: 135, diastolic: 82, state: "recorded", created_at: "2026-10-13T00:10:00.000Z" });
    expect(patched.reading.history).toEqual([{ at: "2026-10-13T00:12:00.000Z", action: "edit", systolic: 185, diastolic: 112, pulse: 80, state: "recorded" }]);
    clock(SGT("2026-10-13", "08:13"));
    const again = await (await bpPatch(req("/api/bp", "PATCH", t, { id, systolic: 136, diastolic: 82, pulse: 70 }))).json();
    expect(again.reading.history.map((h: { action: string; systolic: number; pulse: number | null }) => [h.action, h.systolic, h.pulse])).toEqual([
      ["edit", 185, 80],
      ["edit", 135, null],
    ]);
    // a reading never changed has no history at all (the column is only there once set)
    const plain = await (await bpPost(req("/api/bp", "POST", t, { systolic: 139, diastolic: 83 }))).json();
    expect("history" in plain.reading).toBe(false);
    expect("deleted_at" in plain.reading).toBe(false);
  });

  it("DELETE: no list shows it, the brief does not count it, the row stays with its history; the undo bar puts the same reading back", async () => {
    const t = him.tokens.access_token;
    clock(SGT("2026-10-13", "09:00"));
    const id = randomUUID();
    await bpPost(req("/api/bp", "POST", t, { id, systolic: 150, diastolic: 95 }));
    const scope = async () => (await store.getSession(him.userId))!;
    const countBefore = (await buildAccountBrief(store, await scope(), "zh-Hans", { translate: "cache" })).bp.count;

    clock(SGT("2026-10-13", "09:02"));
    const del = await bpDelete(req("/api/bp", "DELETE", t, { id }));
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: id });
    expect((await store.listBp(him.userId, { fromDay: 43, toDay: 43 })).some((r) => r.id === id)).toBe(false);
    const view = await (await bpGet(req("/api/bp", "GET", t))).json();
    expect(view.readings.some((r: { id: string }) => r.id === id)).toBe(false);
    expect((await buildAccountBrief(store, await scope(), "zh-Hans", { translate: "cache" })).bp.count).toBe(countBefore - 1);
    const kept = (await store.listBp(him.userId, { fromDay: 43, toDay: 43, includeDeleted: true })).find((r) => r.id === id)!;
    expect(kept).toMatchObject({ systolic: 150, diastolic: 95, deleted_at: "2026-10-13T01:02:00.000Z" });
    expect(kept.history).toEqual([{ at: "2026-10-13T01:02:00.000Z", action: "delete", systolic: 150, diastolic: 95, pulse: null, state: "recorded" }]);
    // deleting it twice, or changing a deleted reading: not there
    expect((await bpDelete(req("/api/bp", "DELETE", t, { id }))).status).toBe(404);
    expect((await bpPatch(req("/api/bp", "PATCH", t, { id, systolic: 151, diastolic: 95 }))).status).toBe(404);
    // a resend of the same uuid (his phone was offline) never brings it back as a new reading
    const resend = await bpPost(req("/api/bp", "POST", t, { id, systolic: 150, diastolic: 95 }));
    expect(resend.status).toBe(200);
    expect((await store.listBp(him.userId, { fromDay: 43, toDay: 43 })).some((r) => r.id === id)).toBe(false);

    clock(SGT("2026-10-13", "09:02"));
    const back = await bpPatch(req("/api/bp", "PATCH", t, { id, restore: true }));
    expect(back.status).toBe(200);
    const restored = (await back.json()).reading;
    expect(restored).toMatchObject({ id, systolic: 150, diastolic: 95, slot: "morning", created_at: "2026-10-13T01:00:00.000Z" });
    expect("deleted_at" in restored).toBe(false);
    expect(restored.history.map((h: { action: string }) => h.action)).toEqual(["delete", "restore"]);
    expect((await buildAccountBrief(store, await scope(), "zh-Hans", { translate: "cache" })).bp.count).toBe(countBefore);
    // putting back a reading that is not deleted changes nothing; one that never existed: 404
    expect((await (await bpPatch(req("/api/bp", "PATCH", t, { id, restore: true }))).json()).reading.history).toHaveLength(2);
    expect((await bpPatch(req("/api/bp", "PATCH", t, { id: randomUUID(), restore: true }))).status).toBe(404);
  });

  it("「这次没量」, then he measures in the same part of the day: the part was measured, the 'not measured' row is kept as a deleted row", async () => {
    const t = him.tokens.access_token;
    clock(SGT("2026-10-14", "08:00"));
    const skipped = (await (await bpPost(req("/api/bp", "POST", t, { state: "unconfirmed" }))).json()).reading;
    clock(SGT("2026-10-14", "09:30"));
    await bpPost(req("/api/bp", "POST", t, { systolic: 141, diastolic: 86 }));
    expect((await store.listBp(him.userId, { fromDay: 44, toDay: 44 })).map((r) => [r.slot, r.state])).toEqual([["morning", "recorded"]]);
    const kept = (await store.listBp(him.userId, { fromDay: 44, toDay: 44, includeDeleted: true })).find((r) => r.id === skipped.id)!;
    expect(kept.deleted_at).toBe("2026-10-14T01:30:00.000Z");
    expect(kept.history?.map((h) => h.action)).toEqual(["delete"]);
    // an evening reading leaves the morning's alone
    clock(SGT("2026-10-15", "08:00"));
    await bpPost(req("/api/bp", "POST", t, { state: "unconfirmed" }));
    clock(SGT("2026-10-15", "19:00"));
    await bpPost(req("/api/bp", "POST", t, { systolic: 139, diastolic: 84 }));
    expect((await store.listBp(him.userId, { fromDay: 45, toDay: 45 })).map((r) => [r.slot, r.state])).toEqual([
      ["morning", "unconfirmed"],
      ["evening", "recorded"],
    ]);
  });
});

describe("the job writes 'not measured' for every part of the doctor's plan that passed since he started (real-app 3.11)", () => {
  it("three days with no run: each passed part once, nothing before the plan began, nothing twice", async () => {
    // the visit on Mon 12 Oct (day 0): the plan is one week from Tue 13 Oct, morning and evening
    const him = await blankWithPlan(SGT("2026-10-12", "09:00"));
    const run = async (iso: string) => {
      const now = clock(iso);
      return runBpDay(store, (await store.getSession(him.userId))!, now, { send: async () => ({ sent: 1 }) });
    };
    // he measured on Tuesday morning; then the server was down until Thu 15 Oct 12:30
    clock(SGT("2026-10-13", "08:10"));
    await store.addBp(him.userId, { day: 1, slot: "morning", systolic: 142, diastolic: 88 });
    expect(await run(SGT("2026-10-15", "12:30"))).toMatchObject({ notMeasured: 4, reminded: 0 });
    const rows = await store.listBp(him.userId);
    expect(rows.map((r) => [r.day, r.slot, r.state])).toEqual([
      [1, "morning", "recorded"],
      [1, "evening", "unconfirmed"],
      [2, "morning", "unconfirmed"],
      [2, "evening", "unconfirmed"],
      [3, "morning", "unconfirmed"],
    ]);
    expect(await run(SGT("2026-10-15", "12:31"))).toMatchObject({ notMeasured: 0 });
    // he deletes one of them: it is not written again
    const gone = rows.find((r) => r.day === 3 && r.state === "unconfirmed")!;
    await store.updateBp(him.userId, gone.id, { deleted_at: "2026-10-15T04:40:00.000Z" });
    expect(await run(SGT("2026-10-15", "12:45"))).toMatchObject({ notMeasured: 0 });
    expect((await store.listBp(him.userId, { fromDay: 3, toDay: 3 })).length).toBe(0);
  });
});
