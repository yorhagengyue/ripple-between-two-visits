/**
 * Dose check-in (task M4 item 1): taken / missed / unconfirmed; 没吃 asks for a reason (chips or his own words);
 * undo writes the previous answer back; no answer when the reminder window closes -> unconfirmed (no reply).
 */
import { describe, expect, it } from "vitest";
import { GET as dosesGet, POST as dosesPost } from "@/app/api/doses/route";
import { getBus } from "@/lib/bus";
import { settleNoReply, todayDoses } from "@/lib/daily/doses";
import { dt } from "@/lib/daily/i18n";
import { reasonOptions, reminderDue, reminderSchedule, windowClosed, type RoutineEntry } from "@/lib/daily/schedule";
import { templateCast, templateDefaults } from "@/lib/story/seed";
import { getMemoryStore } from "@/lib/store/memory";
import { getReq, postReq, sessionAt } from "./helpers";

const MED = "med-amlodipine";
const routine = templateCast().persona.routine as RoutineEntry[];
const d0 = templateDefaults().d0;

async function tick(sessionId: string, body: Record<string, unknown>) {
  const res = await dosesPost(postReq("/api/doses", sessionId, { medication_id: MED, slot: "morning", ...body }));
  expect(res.status, JSON.stringify(body)).toBe(200);
  return (await res.json()).dose;
}

describe("the check-in clock", () => {
  it("after breakfast (08:30 in his routine): reminders at 08:45 and 09:15, the window closes at 09:45", () => {
    const s = reminderSchedule(routine, "after_breakfast");
    expect(s).toEqual({ first: "08:45", second: "09:15", closes: "09:45" });
    expect(reminderSchedule(routine, "07:00")).toEqual({ first: "07:00", second: "07:30", closes: "08:00" });
    expect([reminderDue("08:30", s), reminderDue("08:45", s), reminderDue("09:20", s), reminderDue("09:45", s), reminderDue(null, s)]).toEqual([0, 1, 2, 0, 0]);
    expect(windowClosed(41, 42, null, s)).toBe(true);
    expect(windowClosed(42, 42, null, s)).toBe(false); // no clock time: today's window stays open
    expect(windowClosed(42, 42, "09:44", s)).toBe(false);
    expect(windowClosed(42, 42, "09:45", s)).toBe(true);
  });

  it("the dose card's reminder line says when Ripple asks, not when to take the tablet (the label says every MORNING)", () => {
    expect(dt("zh-Hans", "dose.reminderAt", { time: "上午8:45" })).toBe("Ripple 上午8:45 来问你");
    expect(dt("en", "dose.reminderAt", { time: "8:45am" })).toBe("Ripple asks you at 8:45am");
    for (const loc of ["zh-Hans", "en"] as const) {
      const line = dt(loc, "dose.reminderAt", { time: "8:45" }).toLowerCase();
      for (const w of ["早饭", "饭后", "breakfast", "take", "吃"]) expect(line, `${loc}: ${w}`).not.toContain(w);
    }
  });

  it("reason chips: 打太极 first on a tai chi day (D15 is a Tuesday), never on a Monday (D14); then the fixed ones", () => {
    expect(reasonOptions(routine, d0, 15).map((r) => r.code)).toEqual(["tai_chi_morning", "forgot", "away", "not_with_me"]);
    expect(reasonOptions(routine, d0, 15)[0].label).toEqual({ en: "Tai chi", zh: "打太极" });
    expect(reasonOptions(routine, d0, 14).map((r) => r.code)).toEqual(["forgot", "away", "not_with_me"]);
  });
});

describe("POST /api/doses: answers, reasons, undo", () => {
  it("taken, missed with a chip or his own words, later; every answer publishes dose.logged", async () => {
    const s = await sessionAt(42, "08:50");
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ medication_id: MED, state: null });
    await tick(s.id, { state: "taken" });
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: "taken", reason: null });
    await tick(s.id, { state: "missed" });
    await tick(s.id, { state: "missed", reason: "tai_chi_morning", reason_text: "打太极" });
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: "missed", reason: "tai_chi_morning", reason_text: "打太极" });
    await tick(s.id, { state: "missed", reason: "own_words", reason_text: "早上去医院看朋友" });
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: "missed", reason: "own_words", reason_text: "早上去医院看朋友" });
    await tick(s.id, { state: "unconfirmed", reason: "later" });
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: "unconfirmed", reason: "later" });
    const events = getBus().recent(s.id).filter((e) => e.type === "dose.logged");
    expect(events).toHaveLength(5);
    expect(events[3].say).toContain("早上去医院看朋友");
  });

  it("undo: back to the previous answer, or to no answer at all ('undone' reads as not recorded)", async () => {
    const s = await sessionAt(42, "08:50");
    await tick(s.id, { state: "missed" });
    await tick(s.id, { state: "unconfirmed", reason: "undone" }); // there was no answer before
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: null, reason: null });
    expect(getBus().recent(s.id).at(-1)!.say).toContain("undid his answer");
    // the seed's D29 answer was taken: 没吃, then undo, puts taken back
    const t = await sessionAt(29);
    await tick(t.id, { state: "missed" });
    await tick(t.id, { state: "taken", reason: null });
    expect((await todayDoses(getMemoryStore(), t))[0]).toMatchObject({ state: "taken" });
  });

  it("rejects what M0's schema rejects (unknown fields, bad state)", async () => {
    const s = await sessionAt(42);
    expect((await dosesPost(postReq("/api/doses", s.id, { medication_id: MED, slot: "morning", state: "maybe" }))).status).toBe(400);
    expect((await dosesPost(postReq("/api/doses", s.id, { medication_id: MED, slot: "morning", state: "taken", extra: 1 }))).status).toBe(400);
    expect((await dosesPost(postReq("/api/doses", s.id, { medication_id: "nope", slot: "morning", state: "taken" }))).status).toBe(404);
  });
});

describe("no answer after the reminder window -> unconfirmed (no reply)", () => {
  it("D42 at 09:50: today's dose with no answer is recorded unconfirmed / no_reply, once", async () => {
    const s = await sessionAt(42, "09:50");
    const written = await settleNoReply(getMemoryStore(), s);
    expect(written.map((d) => [d.day, d.state, d.reason])).toEqual([[42, "unconfirmed", "no_reply"]]);
    expect(await settleNoReply(getMemoryStore(), s)).toEqual([]);
    expect((await todayDoses(getMemoryStore(), s))[0]).toMatchObject({ state: "unconfirmed", reason: "no_reply" });
    expect(getBus().recent(s.id).filter((e) => e.type === "dose.logged").map((e) => e.say)[0]).toContain("No reply after two reminders");
  });

  it("inside the window, or with no clock time, today is left alone; earlier days with no answer are settled", async () => {
    const early = await sessionAt(42, "09:00");
    expect(await settleNoReply(getMemoryStore(), early)).toEqual([]);
    const noTime = await sessionAt(43);
    const written = await settleNoReply(getMemoryStore(), noTime);
    expect(written.map((d) => [d.medication_id, d.day])).toEqual([[MED, 42]]); // D43 (amlodipine, losartan) stays open
  });

  it("an answer (or 等下) before the window closes is never overwritten; an undone answer is settled", async () => {
    const s = await sessionAt(42, "08:50");
    await tick(s.id, { state: "unconfirmed", reason: "later" });
    await getMemoryStore().setStoryDay(s.id, 42, "10:00");
    const later = (await getMemoryStore().getSession(s.id))!;
    expect(await settleNoReply(getMemoryStore(), later)).toEqual([]);
    await tick(s.id, { state: "unconfirmed", reason: "undone" });
    expect((await settleNoReply(getMemoryStore(), later)).map((d) => d.reason)).toEqual(["no_reply"]);
  });

  it("GET /api/doses settles first; the seed's days are never touched", async () => {
    const s = await sessionAt(29);
    const res = await dosesGet(getReq("/api/doses", s.id));
    const doses = (await res.json()).doses as { day: number; state: string }[];
    expect(doses).toHaveLength(33);
    expect(getBus().recent(s.id)).toHaveLength(0);
  });
});
