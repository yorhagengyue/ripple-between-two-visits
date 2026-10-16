import { describe, expect, it } from "vitest";
import { BEATS, currentBeat, findBeat, nextBeat, prevBeat } from "@/lib/session/beats";
import { doseKey, dueDoses, medName } from "@/lib/session/today";
import { buildSeedTables } from "@/lib/story/seed";

describe("story beats", () => {
  it("are in story order with valid times", () => {
    const positions = BEATS.map((b) => b.day * 1440 + Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3)));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length);
    expect(BEATS.map((b) => b.day)).toEqual(expect.arrayContaining([0, 8, 12, 29, 42]));
  });

  it("next and previous step around the current clock", () => {
    expect(nextBeat(29, null)?.id).toBe("d29-hero"); // no time = start of the day
    expect(nextBeat(29, "20:15")?.id).toBe("d37-ankle");
    expect(prevBeat(29, "20:15")?.id).toBe("d15-tai-chi");
    expect(prevBeat(0, "09:30")).toBeNull();
    expect(nextBeat(42, "09:30")).toBeNull();
    expect(nextBeat(-1, null)?.id).toBe("d0-visit");
  });

  it("finds a beat by id and by exact position", () => {
    expect(findBeat("d8-visit")).toMatchObject({ day: 8, time: "10:00" });
    expect(findBeat("nope")).toBeNull();
    expect(currentBeat(8, "10:00")?.id).toBe("d8-visit");
    expect(currentBeat(8, "10:01")).toBeNull();
  });
});

describe("today's due doses", () => {
  const t = buildSeedTables("s", "2026-10-09T00:00:00.000Z");

  it("nothing is due before the first tablet (D9)", () => {
    expect(dueDoses(t.medications, t.dose_logs, 8)).toEqual([]);
  });

  it("amlodipine every morning from D9, with the seeded answer of the day", () => {
    const d15 = dueDoses(t.medications, t.dose_logs, 15);
    expect(d15).toEqual([
      {
        medication_id: "med-amlodipine",
        day: 15,
        slot: "morning",
        name: "Amlodipine",
        strength: "5 mg",
        label_confirmed: true,
        state: "missed",
      },
    ]);
    expect(dueDoses(t.medications, t.dose_logs, 29)[0].state).toBe("taken");
  });

  it("self-bought and relatives' medicines are never due; losartan starts on D43 without a label", () => {
    const d43 = dueDoses(t.medications, t.dose_logs, 43);
    expect(d43.map((d) => d.medication_id)).toEqual(["med-amlodipine", "med-losartan"]);
    expect(d43.every((d) => d.state === null)).toBe(true);
    expect(d43[1]).toMatchObject({ name: "Losartan", strength: null, label_confirmed: false });
  });

  it("names come from the label, then the kb id", () => {
    expect(medName({ id: "m", drug_id: "losartan", label: null })).toBe("Losartan");
    expect(medName({ id: "med-x", drug_id: null, label: null })).toBe("Med-x");
    expect(doseKey("a", 3, "morning")).toBe("a|3|morning");
  });
});
