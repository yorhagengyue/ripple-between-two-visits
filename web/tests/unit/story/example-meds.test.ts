/**
 * The example account's three more medicines (lib/story/example-meds.ts; scene 3 of the owner's film, 10-15): metformin,
 * atorvastatin and aspirin beside his amlodipine, label confirmed, with their doses laid out on the past days. Off for
 * the rest of the suite (RIPPLE_EXAMPLE_MEDS=off in vitest.config.mts): here it is turned on before anything is laid out.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDoseDay } from "@/lib/daily/cells";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { doseSlotsOf } from "@/lib/daily/slots";
import { MemoryStore } from "@/lib/store/memory";
import type { DoseLogRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { buildExampleSpace, EXAMPLE_TODAY_DAY, seedAccount } from "@/lib/story/example";
import { exampleMedsOn, exampleMedsTables, templateMissedMornings } from "@/lib/story/example-meds";
import { loadTemplate } from "@/lib/story/seed";
import { scopeDoseSummary } from "@/lib/summary/scope-doses";
import { zonedTimeToUtcMs } from "@/lib/time/clock";

const NEW = ["x-med-metformin", "x-med-atorvastatin", "x-med-aspirin"];
const TAI_CHI = [15, 17, 24, 36];

describe("the example account's three more medicines (lib/story/example-meds.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on unless RIPPLE_EXAMPLE_MEDS=off, and off in this suite", () => {
    expect(exampleMedsOn({})).toBe(true);
    expect(exampleMedsOn({ RIPPLE_EXAMPLE_MEDS: "off" })).toBe(false);
    expect(exampleMedsOn()).toBe(false);
    // off: the example is the template's, as every other test reads it
    const t = buildExampleSpace("scope-x", { today: "2026-10-15", nowIso: "2026-10-15T02:00:00.000Z" }).tables;
    expect(t.medications.map((m) => m.id).sort()).toEqual(["med-amlodipine", "med-ibuprofen", "med-relative-box"]);
    expect(t.dose_logs).toHaveLength(33);
  });

  it("lays out the three beside amlodipine: the labels' own lines, amlodipine's clinic and dispensing date, from day 9", () => {
    vi.stubEnv("RIPPLE_EXAMPLE_MEDS", "on");
    const space = buildExampleSpace("scope-x", { today: "2026-10-15", nowIso: "2026-10-15T02:00:00.000Z" });
    const meds = space.tables.medications;
    expect(meds.map((m) => m.id).sort()).toEqual(["med-amlodipine", "med-ibuprofen", "med-relative-box", ...NEW].sort());
    const aml = meds.find((m) => m.id === "med-amlodipine")!;
    // amlodipine's bag is dispensed on day 8 of the account (v2), and so are the three
    expect(aml.label?.dispensed).toBe(storyDate(space.d0, 8));
    const lines: Record<string, [string, string, string]> = {
      "x-med-metformin": ["metformin", "500 mg", "Take TWO tablets twice a day AFTER breakfast and dinner"],
      "x-med-atorvastatin": ["atorvastatin", "20 mg", "Take ONE tablet at BEDTIME"],
      "x-med-aspirin": ["aspirin", "100 mg", "Take ONE tablet every MORNING AFTER breakfast"],
    };
    for (const id of NEW) {
      const m = meds.find((x) => x.id === id)!;
      const [drug, strength, directions] = lines[id];
      expect(m).toMatchObject({ drug_id: drug, origin: "prescription", status: "label_confirmed", start_day: 9, prescribed_visit_id: null, session_id: "scope-x" });
      expect(m.label).toMatchObject({ drug, strength, directions, clinic: "Blossom Family Clinic (fictional)", dispensed: aml.label?.dispensed });
      expect(m.label?.text).toBe(`${drug.toUpperCase()} ${strength.replace(" ", "").toUpperCase()} TABLET\n${directions}`);
    }
    // when he takes each, as every account screen reads it: metformin morning and evening (his choice: the label's
    // words name breakfast and dinner, the closed table only breakfast), the other two from the label's own words
    const slots = (id: string) => doseSlotsOf({ kind: "account" }, meds.find((m) => m.id === id)!);
    expect(slots("x-med-metformin")).toEqual({ slots: ["morning", "evening"], source: "patient" });
    expect(slots("x-med-atorvastatin")).toEqual({ slots: ["night"], source: "label" });
    expect(slots("x-med-aspirin")).toEqual({ slots: ["morning"], source: "label" });
    expect(slots("med-amlodipine")).toEqual({ slots: ["morning"], source: "label" });
  });

  it("lays out one answer for every slot of every day 9 to 41: taken, but the four tai chi mornings missed for every morning medicine", () => {
    vi.stubEnv("RIPPLE_EXAMPLE_MEDS", "on");
    const t = buildExampleSpace("scope-x", { today: "2026-10-15", nowIso: "2026-10-15T02:00:00.000Z" }).tables;
    // the template's own missed mornings are the tai chi ones, with his reason
    expect(templateMissedMornings()).toEqual(TAI_CHI.map((day) => ({ day, reason: "tai_chi_morning", reason_text: "打太极，忘了" })));
    const mine = t.dose_logs.filter((d) => NEW.includes(d.medication_id));
    // metformin 2 slots, atorvastatin 1, aspirin 1: 4 a day for 33 days
    expect(mine).toHaveLength(4 * 33);
    expect(t.dose_logs).toHaveLength(33 + 4 * 33);
    const key = (d: Pick<DoseLogRow, "medication_id" | "day" | "slot">) => `${d.medication_id}|${d.day}|${d.slot}`;
    expect(new Set(t.dose_logs.map(key)).size).toBe(t.dose_logs.length);
    expect(new Set(t.dose_logs.map((d) => d.id)).size).toBe(t.dose_logs.length);
    const want: [string, string][] = [
      ["x-med-metformin", "morning"],
      ["x-med-metformin", "evening"],
      ["x-med-atorvastatin", "night"],
      ["x-med-aspirin", "morning"],
    ];
    for (const [med, slot] of want) {
      for (let day = 9; day < EXAMPLE_TODAY_DAY; day++) {
        const row = mine.find((d) => key(d) === `${med}|${day}|${slot}`);
        expect(row, `${med} day ${day} ${slot}`).toBeTruthy();
        expect(row!.id.startsWith("x-dose-")).toBe(true);
        expect(row!.pre_tracking).toBe(true);
        if (slot === "morning" && TAI_CHI.includes(day)) expect(row).toMatchObject({ state: "missed", reason: "tai_chi_morning", reason_text: "打太极，忘了" });
        else expect(row).toMatchObject({ state: "taken", reason: null, reason_text: null });
      }
    }
    // nothing before the start day, nothing on today or after
    expect(mine.every((d) => d.day >= 9 && d.day < EXAMPLE_TODAY_DAY)).toBe(true);
    // a space laid out on an earlier day stops the day before its own today
    expect(exampleMedsTables("scope-x", { d0: "2026-09-03", beforeDay: 20, nowIso: "2026-10-15T02:00:00.000Z" }).dose_logs.every((d) => d.day < 20)).toBe(true);
    // amlodipine's own rows are the template's, untouched
    expect(t.dose_logs.filter((d) => d.medication_id === "med-amlodipine")).toHaveLength(loadTemplate("mr-tan").dose_log.length);
  });

  it("on a seeded account: every past dose cell is answered, the missed ones are the four tai chi mornings, the pattern stays at 4", async () => {
    vi.stubEnv("RIPPLE_EXAMPLE_MEDS", "on");
    const nowMs = zonedTimeToUtcMs("2026-10-15", "10:00");
    const store = new MemoryStore({ now: () => new Date(nowMs) });
    const userId = randomUUID();
    const scope = await seedAccount(store, { userId, space: "example", nowMs });
    const meds = await store.listMeds(userId);
    const doses = await store.listDoses(userId);
    expect(meds).toHaveLength(6);

    // the calendar reads cells: no past cell is left without his answer from the day the medicines start
    const missedDays = new Set<number>();
    for (let day = 9; day < EXAMPLE_TODAY_DAY; day++) {
      for (const slot of buildDoseDay(scope, day, meds, doses, nowMs)) {
        for (const c of slot.cells) {
          expect(c.state, `day ${day} ${slot.slot} ${c.medicationId}`).not.toBeNull();
          expect(c.counted).toBe(true);
          if (c.state === "missed") {
            expect(slot.slot).toBe("morning");
            missedDays.add(day);
          } else expect(c.state).toBe("taken");
        }
      }
    }
    expect([...missedDays].sort((a, b) => a - b)).toEqual(TAI_CHI);

    // the summaries count every cell: 33 mornings of amlodipine and 4 more doses a day, 3 missed on each tai chi morning
    const s = await scopeDoseSummary(store, scope, { fromDay: 0, toDay: EXAMPLE_TODAY_DAY - 1, nowMs });
    expect({ due: s.due, taken: s.taken, missed: s.missed, unconfirmed: s.unconfirmed }).toEqual({ due: 33 * 5, taken: 33 * 5 - 12, missed: 12, unconfirmed: 0 });
    expect(s.missedDays).toEqual(TAI_CHI);

    // the pattern question counts missed mornings by day: still the four tai chi mornings
    await syncPatternQuestions(store, scope);
    const q = (await store.listQuestions(userId)).find((x) => x.id === "q-tai-chi")!;
    expect(q.evidence).toContain("漏吃的 4 个早上里，4 个在打太极的日子");
  });
});
