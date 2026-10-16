/**
 * Label text -> fields. The text comes from the vision cassettes (what a model transcribes off the PNGs); the
 * fields are parsed by app code and compared with web/fixtures/labels/*.expected.json (read here only).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalClinic, labelSlots, parseLabelDate, parseLabelText, parseStrength } from "@/lib/meds/parse-label";
import { getMemoryStore } from "@/lib/store/memory";
import { readLabelText } from "@/lib/vision";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const expected = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, "labels", `${name}.expected.json`), "utf8"));
const png = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, "labels", `${name}.png`)));

async function transcribed(name: string): Promise<string> {
  return (await readLabelText({ bytes: png(name), mime: "image/png" }, { env: { LLM_PROVIDER: "mock" } })).text;
}

async function knownClinics(): Promise<string[]> {
  const store = getMemoryStore();
  const s = await store.createSession({ ttl_hours: 1 });
  return [...new Set((await store.listVisits(s.id)).map((v) => v.place))];
}

const FIELDS = ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"] as const;

describe("parseLabelText on the transcribed label photos", () => {
  it("amlodipine.png: drug_text, drug_id, strength, directions, slots, dispensed and clinic equal amlodipine.expected.json", async () => {
    const fields = parseLabelText(await transcribed("amlodipine"), { knownClinics: await knownClinics() });
    const want = expected("amlodipine");
    for (const k of FIELDS) expect(fields[k], k).toEqual(want[k]);
    expect(fields.match).toBe("exact");
    expect(fields.indication).toBe(want.indication_on_label);
  });

  it("ibuprofen.png: identified, strength read, no directions (\"Take with or after food.\" has no dose)", async () => {
    const fields = parseLabelText(await transcribed("ibuprofen"), { knownClinics: await knownClinics() });
    const want = expected("ibuprofen");
    expect(fields.drug_text).toBe(want.drug_text);
    expect(fields.drug_id).toBe(want.drug_id);
    expect(fields.strength).toBe(want.strength);
    expect(fields.directions).toBe(want.directions);
    expect(fields.slots).toBeNull();
    expect(fields.clinic).toBeNull();
    expect(fields.dispensed).toBeNull();
  });

  it("relative_box.png: the product name, not identified, and the printed dosing is never a field", async () => {
    const text = await transcribed("relative_box");
    const fields = parseLabelText(text, { knownClinics: await knownClinics() });
    const want = expected("relative_box");
    expect(fields.drug_text).toBe(want.drug_text);
    expect(fields.drug_id).toBeNull();
    expect(fields.match).toBeNull();
    expect(fields.directions).toBeNull();
    expect(fields.slots).toBeNull();
    expect(fields.strength).toBeNull();
    expect(fields.indication).toBeNull();
    for (const banned of want.must_not_relay as string[]) {
      expect(text).toContain(banned); // it is printed on the box ...
      expect(JSON.stringify(fields)).not.toContain(banned); // ... and never leaves the parser
    }
  });
});

describe("parser rules", () => {
  it("strength: number and lower-case unit", () => {
    expect(parseStrength("AMLODIPINE 5MG TABLET")).toBe("5 mg");
    expect(parseStrength("Losartan 50 mg")).toBe("50 mg");
    expect(parseStrength("Aspirin 100mg")).toBe("100 mg");
    expect(parseStrength("宁和平压丸")).toBeNull();
  });

  it("slots: every morning is once daily; explicit frequencies win", () => {
    expect(labelSlots("Take ONE tablet every MORNING")).toEqual({ quantity: "1", unit: "tablet", time: "morning", frequency: "once_daily" });
    expect(labelSlots("Take ONE tablet TWICE A DAY")).toEqual({ quantity: "1", unit: "tablet", frequency: "twice_daily" });
    expect(labelSlots("Take 2 tablets at night")).toEqual({ quantity: "2", unit: "tablet", time: "night" });
  });

  it("dates are day/month/year and must exist", () => {
    expect(parseLabelDate("01", "09", "2026")).toBe("2026-09-01");
    expect(parseLabelDate("5", "10", "26")).toBe("2026-10-05");
    expect(parseLabelDate("31", "02", "2026")).toBeNull();
    expect(parseLabelDate("13", "13", "2026")).toBeNull();
  });

  it("clinic: a clinic he has visited keeps the visit record's spelling; otherwise capitals become Title Case", () => {
    expect(canonicalClinic("BLOSSOM FAMILY CLINIC (FICTIONAL)", ["Blossom Family Clinic (fictional)"])).toBe("Blossom Family Clinic (fictional)");
    expect(canonicalClinic("SUNRISE MEDICAL CLINIC")).toBe("Sunrise Medical Clinic");
    expect(canonicalClinic("Sunrise Medical Clinic")).toBe("Sunrise Medical Clinic");
  });

  it("an expiry date is not the dispensed date; a typo in the name is still recognised", () => {
    const f = parseLabelText("AMLODIPNE 5MG TABLET\nTake ONE tablet every MORNING\nEXP: 01/09/2028\nDate: 02/09/2026");
    expect(f.drug_id).toBe("amlodipine");
    expect(f.match).toBe("fuzzy");
    expect(f.dispensed).toBe("2026-09-02");
  });

  it("directions only for an identified medicine", () => {
    const f = parseLabelText("XYZOPRILANE 10MG TABLET\nTake ONE tablet every MORNING");
    expect(f.drug_id).toBeNull();
    expect(f.drug_text).toBe("XYZOPRILANE 10MG TABLET");
    expect(f.strength).toBe("10 mg");
    expect(f.directions).toBeNull();
  });
});
