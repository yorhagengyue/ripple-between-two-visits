/**
 * How often to measure, as the doctor said (C2 track B, journey 03; real-app 2.9, 8.3 bp/schedule): the frequency is read
 * only from a measuring instruction he confirmed, through a closed list of patterns; the reminders go out once per due
 * part of the day; a due part that passes with no reading is recorded once as not measured; without the doctor's words
 * nothing at all happens.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { accountBpView } from "@/lib/daily/bp";
import { runBpDay } from "@/lib/daily/bp-run";
import { bpDueParts, bpPartTimes, bpPlanFor, bpPlanFrom, parseBpFrequency } from "@/lib/daily/bp-schedule";
import type { Notice } from "@/lib/jobs/notify";
import { MemoryStore } from "@/lib/store/memory";
import type { VisitItemRow, VisitRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const V1_U05 = "Many people feel fine. One reading in the clinic is not enough. I want you to measure at home for one week, morning and evening.";
const V2_U09 = "Keep measuring, twice a week is enough now. Come back in five weeks.";

afterAll(() => setTestClock(null));

describe("the doctor's words, through a closed list", () => {
  it("v1: every day, morning and evening, for one week; v2: twice a week, mornings, until told otherwise", () => {
    expect(parseBpFrequency(V1_U05)).toEqual({ kind: "daily", perWeek: null, parts: ["morning", "evening"], days: 7 });
    expect(parseBpFrequency(V2_U09)).toEqual({ kind: "weekly", perWeek: 2, parts: ["morning"], days: null });
  });

  it("Mandarin and other ways of saying it; words with no frequency give nothing", () => {
    expect(parseBpFrequency("每天早晚量一次，量两周")).toEqual({ kind: "daily", perWeek: null, parts: ["morning", "evening"], days: 14 });
    expect(parseBpFrequency("一周两次就可以了")).toEqual({ kind: "weekly", perWeek: 2, parts: ["morning"], days: null });
    expect(parseBpFrequency("Measure once a week in the evening.")).toEqual({ kind: "weekly", perWeek: 1, parts: ["evening"], days: null });
    expect(parseBpFrequency("At home, we want it below 135 over 85.")).toBeNull();
    expect(parseBpFrequency("Come back in about a week with your readings.")).toBeNull();
    expect(parseBpFrequency("Sit down, rest five minutes first.")).toBeNull();
  });

  it("which days: every day of the plan's days; twice a week the 1st and 4th of every 7 from the day after the visit", () => {
    const daily = { kind: "daily" as const, perWeek: null, parts: ["morning" as const, "evening" as const], fromDay: 1, toDay: 7 };
    expect([0, 1, 7, 8].map((d) => bpDueParts(daily, d))).toEqual([[], ["morning", "evening"], ["morning", "evening"], []]);
    const weekly = { kind: "weekly" as const, perWeek: 2, parts: ["morning" as const], fromDay: 9, toDay: null };
    expect([9, 10, 11, 12, 13, 16, 19, 23].filter((d) => bpDueParts(weekly, d).length)).toEqual([9, 12, 16, 19, 23]);
  });

  it("the parts' times hang on his routine: half an hour before breakfast until noon, 20:00 (dinner + 90 min) until 23:00", () => {
    expect(bpPartTimes([{ label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:30" }], "morning")).toEqual({ remind: "08:00", closes: "12:00" });
    expect(bpPartTimes([], "evening")).toEqual({ remind: "20:00", closes: "23:00" });
  });
});

function visit(id: string, day: number): VisitRow {
  return { id, session_id: "s", kind: "follow_up", place: "Clinic", day, date: `2026-10-${String(10 + day).padStart(2, "0")}`, consent_utterance_id: null, status: "confirmed", audio_path: null, script_section: null, audio_fixture: null, created_at: "2026-10-10T01:00:00.000Z" };
}

function item(id: string, visitId: string, text: string, confirmed: boolean): VisitItemRow {
  return { id, session_id: "s", visit_id: visitId, type: "instruction", text, utterance_ids: [], slots: { variant: "measure_home" }, confirmed_by: confirmed ? "patient" : null, required_line: null, speaker: "doctor", created_at: "2026-10-10T02:00:00.000Z" };
}

describe("only a measuring instruction he confirmed counts; the latest wins", () => {
  it("unconfirmed: no plan; confirmed: the plan from the day after the visit; a later visit's words replace it", () => {
    const v1 = visit("v1", 0);
    const v2 = visit("v2", 8);
    const none = bpPlanFrom({ visits: [v1], items: [item("i1", "v1", V1_U05, false)], transcripts: new Map() });
    expect(none).toBeNull();
    const first = bpPlanFrom({ visits: [v1], items: [item("i1", "v1", V1_U05, true)], transcripts: new Map() });
    expect(first).toMatchObject({ kind: "daily", parts: ["morning", "evening"], fromDay: 1, toDay: 7, words: { text: V1_U05, visitId: "v1" } });
    const later = bpPlanFrom({ visits: [v1, v2], items: [item("i1", "v1", V1_U05, true), item("i2", "v2", V2_U09, true)], transcripts: new Map() });
    expect(later).toMatchObject({ kind: "weekly", perWeek: 2, fromDay: 9, toDay: null, words: { visitId: "v2" } });
    const disputed = item("i2", "v2", V2_U09, true);
    disputed.slots = { variant: "measure_home", disputed: true };
    expect(bpPlanFrom({ visits: [v1, v2], items: [item("i1", "v1", V1_U05, true), disputed], transcripts: new Map() })?.words.visitId).toBe("v1");
  });
});

describe("the job's pass (runBpDay)", () => {
  const store = new MemoryStore();
  const collect = () => {
    const sent: Notice[] = [];
    return { sent, send: async (n: Notice) => (sent.push(n), { sent: 1 }) };
  };

  it("the example account (no frequency from the doctor): nothing, ever", async () => {
    setTestClock({ at: "2026-10-12T08:05:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const scope = (await store.getSession(a.userId))!;
    expect(await bpPlanFor(store, scope)).toBeNull();
    expect(await runBpDay(store, scope, Date.parse("2026-10-12T08:05:00+08:00"))).toEqual({ reminded: 0, notMeasured: 0, sent: 0 });
  });

  it("with the doctor's 'one week, morning and evening' he confirmed: reminded once at 08:00, quiet once measured, not measured once at 23:00", async () => {
    setTestClock({ at: "2026-10-12T09:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const sid = a.userId;
    await store.upsertVisit(sid, { id: "visit-1", kind: "healthier_sg_check_in", place: "Clinic", day: 0, status: "confirmed" });
    await store.addVisitItems(sid, "visit-1", [{ type: "instruction", text: V1_U05, slots: { variant: "measure_home" }, confirmed_by: "patient", speaker: "doctor" }]);
    const box = collect();
    // the visit day itself is not in the plan (from the day after)
    setTestClock({ at: "2026-10-12T20:30:00+08:00", frozen: true });
    expect(await runBpDay(store, (await store.getSession(sid))!, Date.parse("2026-10-12T20:30:00+08:00"), { send: box.send })).toEqual({ reminded: 0, notMeasured: 0, sent: 0 });

    const at = async (hhmm: string) => {
      const iso = `2026-10-13T${hhmm}:00+08:00`;
      setTestClock({ at: iso, frozen: true });
      return runBpDay(store, (await store.getSession(sid))!, Date.parse(iso), { send: box.send });
    };
    expect(await at("07:59")).toMatchObject({ reminded: 0 });
    expect(await at("08:00")).toMatchObject({ reminded: 1 });
    expect(await at("08:30")).toMatchObject({ reminded: 0 });
    expect(box.sent.map((n) => [n.kind, n.title, n.url])).toEqual([["bp_due", "该测量血压了", "/p/bp"]]);
    await store.addBp(sid, { day: 1, slot: "morning", systolic: 142, diastolic: 88 });
    expect(await at("12:05")).toMatchObject({ notMeasured: 0 });
    expect(await at("20:00")).toMatchObject({ reminded: 1 });
    expect(await at("23:00")).toMatchObject({ notMeasured: 1 });
    expect(await at("23:30")).toMatchObject({ notMeasured: 0 });
    const day1 = await store.listBp(sid, { fromDay: 1, toDay: 1 });
    expect(day1.map((r) => [r.slot, r.state])).toEqual([
      ["morning", "recorded"],
      ["evening", "unconfirmed"],
    ]);
  });

  it("today's parts as the screens say them: later, due, measured, and not measured once a part passed without a reading", async () => {
    setTestClock({ at: "2026-10-12T09:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const sid = a.userId;
    await store.upsertVisit(sid, { id: "visit-1", kind: "healthier_sg_check_in", place: "Clinic", day: 0, status: "confirmed" });
    await store.addVisitItems(sid, "visit-1", [{ type: "instruction", text: V1_U05, slots: { variant: "measure_home" }, confirmed_by: "patient", speaker: "doctor" }]);
    const at = async (hhmm: string) => {
      const iso = `2026-10-13T${hhmm}:00+08:00`;
      setTestClock({ at: iso, frozen: true });
      const view = await accountBpView(store, (await store.getSession(sid))!, "zh-Hans", Date.parse(iso));
      return view.plan!.today.map((p) => `${p.part}:${p.state}`);
    };
    expect(await at("07:30")).toEqual(["morning:later", "evening:later"]);
    expect(await at("08:00")).toEqual(["morning:due", "evening:later"]);
    // the morning passed with nothing (the job has not run yet): not measured, never "from 8:00" again
    expect(await at("12:01")).toEqual(["morning:not_measured", "evening:later"]);
    await store.addBp(sid, { day: 1, slot: "evening", systolic: 138, diastolic: 82 });
    expect(await at("20:30")).toEqual(["morning:not_measured", "evening:measured"]);
  });
});
