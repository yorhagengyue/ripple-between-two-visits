/**
 * lib/summary: the counts shared by Wei Ling's view (M6) and the visit brief (M7), on the seed timeline.
 *
 * Expected at D41 (task card M7, visits-script D42): "10 readings, average 140/85, 9 not below the doctor's 135/85
 * of 24 Aug" (the D29 evening 150/95 included) and "29 of 33 doses, the 4 missed all on Tuesdays and Thursdays".
 * The numbers below are computed from the store and pinned; they agree with the expectation (no open difference).
 */
import { describe, expect, it } from "vitest";
import { d0Of, routineOf } from "@/lib/daily/doses";
import { answerMoment, openQuestionCount } from "@/lib/daily/questions";
import { buildBpCheck, buildMedCheck } from "@/lib/visit/checks";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { notBelowTarget, summarizeBp } from "@/lib/summary/bp";
import { summarizeDoses } from "@/lib/summary/doses";
import { medsForBrief } from "@/lib/summary/meds";
import { notesInWindow } from "@/lib/summary/notes";
import { briefQuestions, waitingQuestions } from "@/lib/summary/questions";
import { lastClinicVisit, sinceLastVisit, thisWeek } from "@/lib/summary/window";

const R1 = { systolic: 135, diastolic: 85 };

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

async function rows(s: SessionRow) {
  const store = getMemoryStore();
  const [visits, readings, doses, meds, notes, questions] = await Promise.all([
    store.listVisits(s.id),
    store.listBp(s.id, { toDay: s.story_day }),
    store.listDoses(s.id, { toDay: s.story_day }),
    store.listMeds(s.id),
    store.listNotes(s.id, { toDay: s.story_day }),
    store.listQuestions(s.id),
  ]);
  // the story moment the waiting questions are counted at (10-10: an answer counts once it has been said)
  const moment = await answerMoment(store, s, visits, questions);
  return { visits, readings, doses, meds, notes, questions, moment, d0: d0Of(s), routine: routineOf(s) };
}

describe("windows", () => {
  it("since the last clinic visit before the story day (the D12 pharmacy is not a boundary)", async () => {
    const { visits, d0 } = await rows(await sessionAt(41));
    expect(sinceLastVisit(visits, 41, d0)).toMatchObject({ fromDay: 9, toDay: 41, fromDate: "2026-09-02", toDate: "2026-10-04", lastVisit: { id: "v2", day: 8 } });
    expect(sinceLastVisit(visits, 12, d0)).toMatchObject({ fromDay: 9, lastVisit: { id: "v2" } });
    expect(sinceLastVisit(visits, 13, d0).lastVisit?.id).toBe("v2");
    // on a visit day the visit is not "before the story day"
    expect(sinceLastVisit(visits, 42, d0)).toMatchObject({ fromDay: 9, toDay: 42, lastVisit: { id: "v2" } });
    expect(sinceLastVisit(visits, 8, d0)).toMatchObject({ fromDay: 1, toDay: 8, lastVisit: { id: "v1" } });
    expect(sinceLastVisit(visits, 43, d0)).toMatchObject({ fromDay: 43, toDay: 43, lastVisit: { id: "v3" } });
    expect(sinceLastVisit(visits, 0, d0)).toMatchObject({ fromDay: 0, toDay: 0, lastVisit: null });
    expect(lastClinicVisit(visits, 0)).toBeNull();
  });

  it("this week runs from Monday to the story day (D0 is a Monday)", async () => {
    const d0 = d0Of(await sessionAt(29));
    expect(thisWeek(29, d0)).toMatchObject({ fromDay: 28, toDay: 29, fromDate: "2026-09-21", toDate: "2026-09-22" }); // Mon, Tue
    expect(thisWeek(41, d0)).toMatchObject({ fromDay: 35, toDay: 41 }); // D41 is a Sunday
    expect(thisWeek(42, d0)).toMatchObject({ fromDay: 42, toDay: 42 }); // a Monday
    expect(thisWeek(0, d0)).toMatchObject({ fromDay: 0, toDay: 0 });
  });
});

describe("blood pressure", () => {
  it("D41: 10 readings since 2 Sep, average 140/85, 9 not below R1's 135/85 (D29 evening 150/95 included)", async () => {
    const r = await rows(await sessionAt(41));
    const s = summarizeBp(r.readings, 9, 41, R1);
    expect(s).toEqual({ fromDay: 9, toDay: 41, count: 10, unconfirmed: 0, avgSystolic: 140, avgDiastolic: 85, notBelow: 9, target: R1 });
    expect(r.readings.some((x) => x.day === 29 && x.slot === "evening" && x.systolic === 150 && x.diastolic === 95)).toBe(true);
  });

  it("'not below' mirrors R1: below 135 over 85 needs both numbers under it (D21's 126/82 is the only one below)", () => {
    expect(notBelowTarget({ systolic: 126, diastolic: 82 }, R1)).toBe(false);
    expect(notBelowTarget({ systolic: 135, diastolic: 80 }, R1)).toBe(true);
    expect(notBelowTarget({ systolic: 120, diastolic: 85 }, R1)).toBe(true);
    expect(notBelowTarget({ systolic: 134, diastolic: 84 }, R1)).toBe(false);
  });

  it("D8: 13 readings and 1 not confirmed since D0, average 144/92, all 13 not below R1 (visits-script D1-D7)", async () => {
    const r = await rows(await sessionAt(8));
    expect(summarizeBp(r.readings, 1, 8, R1)).toMatchObject({ count: 13, unconfirmed: 1, avgSystolic: 144, avgDiastolic: 92, notBelow: 13 });
  });

  it("without the doctor's number there is no comparison at all", async () => {
    const r = await rows(await sessionAt(41));
    expect(summarizeBp(r.readings, 9, 41, null)).toMatchObject({ count: 10, notBelow: null, target: null });
  });

  it("matches M2's check card (lib/visit/checks.ts) for the same window", async () => {
    const r = await rows(await sessionAt(42));
    const check = buildBpCheck(r.readings, 9, 41, r.d0, { ...R1, quote: "", date: "2026-08-24", visitId: "v1", display: "doctor_said" as never, tStartMs: null });
    const s = summarizeBp(r.readings, 9, 41, R1);
    expect([s.count, s.avgSystolic, s.avgDiastolic, s.notBelow]).toEqual([check!.recorded, check!.avgSystolic, check!.avgDiastolic, check!.notBelow]);
  });
});

describe("doses", () => {
  it("D41: 29 of 33 taken, 4 missed (all Tue/Thu tai chi mornings), 0 not confirmed", async () => {
    const r = await rows(await sessionAt(41));
    const s = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 9, toDay: 41, storyDay: 41, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect({ due: s.due, taken: s.taken, missed: s.missed, unconfirmed: s.unconfirmed }).toEqual({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
    expect(s.missedDays).toEqual([15, 17, 24, 36]);
    expect(s.days.filter((d) => d.missed > 0).map((d) => d.weekday)).toEqual(["Tue", "Thu", "Thu", "Tue"]);
    expect(s.routine).toEqual({ label: "Tai chi", labelZh: "打太极", weekdays: ["Tue", "Thu"], onRoutine: [15, 17, 24, 36], all: true });
    expect(s.meds).toEqual([{ id: "med-amlodipine", name: "Amlodipine", strength: "5 mg" }]);
    expect(s.daysAllTaken).toBe(29);
  });

  it("matches M2's check card for the same window", async () => {
    const r = await rows(await sessionAt(42));
    const check = buildMedCheck(r.meds, r.doses, 9, 41, r.d0, r.routine, (id) => id);
    const s = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 9, toDay: 41, storyDay: 42, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect([s.due, s.taken, s.missed, s.unconfirmed, s.missedDays]).toEqual([check!.total, check!.taken, check!.missed, check!.unconfirmed, check!.missedDays]);
  });

  it("a due day with no answer counts as not confirmed; today counts only once answered or its window closed", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(43); // the seed's log stops at D41: D42 has no row, D43 is today
    const r = await rows(s);
    const open = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 42, toDay: 43, storyDay: 43, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect(open.days.map((d) => [d.day, d.due, d.unconfirmed])).toEqual([[42, 1, 1]]); // losartan starts D43, but today is not due yet
    const closed = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 42, toDay: 43, storyDay: 43, todayWindowClosed: true, d0: r.d0, routine: r.routine });
    expect(closed.days.map((d) => [d.day, d.due, d.unconfirmed])).toEqual([
      [42, 1, 1],
      [43, 2, 2],
    ]);
    await store.logDose(s.id, { medication_id: "med-amlodipine", day: 43, slot: "morning", state: "taken" });
    await store.logDose(s.id, { medication_id: "med-losartan", day: 43, slot: "morning", state: "unconfirmed", reason: "undone" }); // undone = no answer
    const r2 = await rows(s);
    const answered = summarizeDoses({ meds: r2.meds, doses: r2.doses, fromDay: 43, toDay: 43, storyDay: 43, todayWindowClosed: false, d0: r2.d0, routine: r2.routine });
    expect(answered.days).toEqual([{ day: 43, date: "2026-10-06", weekday: "Tue", due: 1, taken: 1, missed: 0, unconfirmed: 0 }]);
  });

  it("nothing after the story day", async () => {
    const r = await rows(await sessionAt(20));
    const s = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 9, toDay: 41, storyDay: 20, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect(s.toDay).toBe(20);
    expect(s.due).toBe(12);
    expect(s.missedDays).toEqual([15, 17]);
  });

  it("missed mornings off the routine are reported as some, or not matched", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(41);
    await store.logDose(s.id, { medication_id: "med-amlodipine", day: 30, slot: "morning", state: "missed", reason: "forgot" }); // a Wednesday
    const r = await rows(s);
    const sum = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 9, toDay: 41, storyDay: 41, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect(sum.routine).toMatchObject({ onRoutine: [15, 17, 24, 36], all: false });
    const none = summarizeDoses({ meds: r.meds, doses: r.doses, fromDay: 30, toDay: 30, storyDay: 41, todayWindowClosed: false, d0: r.d0, routine: r.routine });
    expect(none.routine).toBeNull();
  });
});

describe("questions", () => {
  it("D41: at most three for the doctor, refused > pattern > his own", async () => {
    const s = await sessionAt(41);
    const r = await rows(s);
    const waiting = waitingQuestions({ ...r, day: 41, locale: "zh-Hans" });
    const brief = briefQuestions(waiting);
    expect(brief.shown.map((q) => [q.id, q.origin])).toEqual([
      ["q-extra-tablet", "refused_question"],
      ["q-tai-chi", "pattern"],
      ["q-knee-2", "own"],
    ]);
    expect(brief.more).toBe(0);
    // the pattern question is worded from his log, never as advice
    expect(brief.shown[1].text).toBe("我漏吃的 4 个早上都在打太极的日子（周二、周四）：9月8日、9月10日、9月17日、9月29日。");
    const en = briefQuestions(waitingQuestions({ ...r, day: 41, locale: "en" }));
    expect(en.shown[1].text).toBe("All 4 mornings I missed were tai chi days (Tue, Thu): 8 Sep, 10 Sep, 17 Sep, 29 Sep.");
  });

  it("the order holds and the rest is counted when there are more than three", () => {
    const q = (id: string, origin: string, f: "doctor" | "pharmacist" = "doctor") => ({ id, for: f, origin, text: id, lang: null, createdDay: 1, wording: "own_words" as const, summary: null });
    const out = briefQuestions([q("a", "own"), q("b", "before_you_go"), q("c", "pattern"), q("d", "refused_question"), q("e", "own"), q("p", "unidentified_medicine", "pharmacist")]);
    expect(out.shown.map((x) => x.id)).toEqual(["d", "c", "a"]);
    expect(out.more).toBe(2); // e and b (the pharmacist's question is not on the doctor's brief)
  });

  it("the waiting count is Today's count (lib/daily) on every story day, and on the visit days before the visit", async () => {
    for (const [day, time] of [[0, null], [8, null], [10, null], [12, null], [29, null], [30, null], [41, null], [43, null], [0, "08:00"], [8, "09:00"], [12, "10:00"], [42, "08:45"]] as const) {
      const s = await sessionAt(day, time);
      const r = await rows(s);
      expect(waitingQuestions({ ...r, day, locale: "zh-Hans" }).length, `D${day} ${time}`).toBe(await openQuestionCount(getMemoryStore(), s));
    }
    // D42 before the visit: Dr Lim's answer has not been said, so the refused question still waits (10-10)
    const r = await rows(await sessionAt(42, "08:45"));
    expect(waitingQuestions({ ...r, day: 42, locale: "zh-Hans" }).map((q) => q.id)).toContain("q-extra-tablet");
  });
});

describe("notes", () => {
  it("D41: every note in the window word for word; a new topic since the last visit is marked", async () => {
    const r = await rows(await sessionAt(41));
    const notes = notesInWindow({ notes: r.notes, fromDay: 9, toDay: 41, d0: r.d0, before: { notes: r.notes.filter((n) => n.day <= 8), questions: [] } });
    expect(notes.map((n) => [n.day, n.date, n.text, n.newTopic])).toEqual([
      [20, "2026-09-13", "我今天好累。", true],
      [37, "2026-09-30", "今天在大巴窑中心走了一圈，脚踝有点肿。", true],
    ]);
    expect(notes[1].topics).toEqual(["ankle", "swelling"]);
  });

  it("a topic he already raised by the last visit is not marked; nothing after the story day", async () => {
    const r = await rows(await sessionAt(41));
    const notes = notesInWindow({ notes: r.notes, fromDay: 9, toDay: 41, d0: r.d0, before: { notes: [{ text: "脚踝有点肿" }], questions: [] } });
    expect(notes.find((n) => n.day === 37)?.newTopic).toBe(false);
    const r29 = await rows(await sessionAt(29));
    expect(notesInWindow({ notes: r29.notes, fromDay: 9, toDay: 29, d0: r29.d0, before: { notes: [], questions: [] } }).map((n) => n.day)).toEqual([20]);
  });
});

describe("medicines", () => {
  it("D41: on the list, none new since D8 (amlodipine was prescribed at that visit; losartan is not on the list yet)", async () => {
    const r = await rows(await sessionAt(41));
    const meds = medsForBrief(r.meds, r.visits, 41, 8, "en");
    expect(meds.map((m) => [m.id, m.newSinceLastVisit])).toEqual([
      ["med-amlodipine", false],
      ["med-ibuprofen", false],
      ["med-relative-box", false],
    ]);
  });

  it("a medicine added after the last visit is new; one prescribed at the last visit is not", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(43);
    await store.upsertMed(s.id, { id: "med-new", drug_id: "paracetamol", origin: "self_bought", status: "label_confirmed", start_day: 43, label: { text: "Paracetamol 500 mg", drug: "paracetamol", strength: "500 mg" } });
    const r = await rows(s);
    const meds = medsForBrief(r.meds, r.visits, 43, 42, "en");
    expect(meds.find((m) => m.id === "med-new")?.newSinceLastVisit).toBe(true);
    expect(meds.find((m) => m.id === "med-losartan")?.newSinceLastVisit).toBe(false);
  });
});
