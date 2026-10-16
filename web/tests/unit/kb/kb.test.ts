import { describe, expect, it } from "vitest";
import { DRUG_FIELD_NAMES, doNotDisplayNumbers, evidenceFor, getKb, getSource } from "@/lib/kb/load";
import { defaultMaxDistance, findDrugMentions, levenshtein, matchDrug, mentionedDrugIds, normalizeName } from "@/lib/kb/match";
import { layer1 } from "@/lib/safety/verify";

const SEVEN = ["amlodipine", "losartan", "metformin", "atorvastatin", "aspirin", "paracetamol", "ibuprofen"];

describe("kb loading", () => {
  it("loads all seven drugs, each field with a source id that resolves to a URL", () => {
    const kb = getKb();
    expect(kb.drugs.map((d) => d.id).sort()).toEqual([...SEVEN].sort());
    for (const d of kb.drugs) {
      expect(getSource(d.source_id)?.url).toMatch(/^https:\/\/www\.healthhub\.sg\//);
      for (const f of DRUG_FIELD_NAMES) {
        expect(d.fields[f].en.length, `${d.id}.${f}`).toBeGreaterThan(0);
        expect(getSource(d.fields[f].source_id)?.url, `${d.id}.${f}`).toBeTruthy();
      }
      for (const p of d.other_points) expect(getSource(p.source_id)?.url, `${d.id}/${p.topic}`).toBeTruthy();
    }
  });

  it("finds the evidence_field of every patient_text entry", () => {
    const kb = getKb();
    expect(kb.patientText.length).toBeGreaterThanOrEqual(20);
    for (const e of kb.patientText) {
      const ev = evidenceFor(e);
      expect(ev, `${e.id} -> ${e.evidence_field}`).not.toBeNull();
      expect(ev!.en.length).toBeGreaterThan(0);
      expect(getSource(e.source_id)?.url, e.id).toBeTruthy();
      expect(e.zh.length, `${e.id} zh`).toBeGreaterThan(0);
    }
  });

  it("loads referrals, screening, glossary and keeps Chinese text intact", () => {
    const kb = getKb();
    expect(kb.referrals).toHaveLength(55);
    expect(kb.screening.length).toBeGreaterThan(0);
    expect(kb.glossary.drugs.amlodipine).toContain("氨氯地平");
    expect(kb.referrals.find((r) => r.id === "B4-04")?.singapore_contact).toContain("1800-3535-800");
  });

  it("reads the do-not-display numbers from referrals.json B4-06", () => {
    const list = doNotDisplayNumbers();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const b406 = getKb().referrals.find((r) => r.id === "B4-06")!;
    for (const n of list) {
      expect(n).toMatch(/\d{3}/);
      expect(b406.singapore_contact).toContain(n);
    }
  });
});

/**
 * Known drift between patient_text.json wording and its drugs.json evidence field, found by layer 1
 * (web/PROGRESS.md "patient_text drift"). The pipeline blocks these sentences until the data is fixed.
 * The test fails if NEW drift appears; fixed entries simply drop out.
 */
const KNOWN_DRIFT = new Set(["amlodipine.food", "amlodipine.missed", "losartan.food", "losartan.missed", "ibuprofen.food"]);

describe("patient_text against its evidence (layer 1 lint)", () => {
  it("only the known entries add a slot their evidence field does not contain", () => {
    const drift: string[] = [];
    for (const e of getKb().patientText) {
      const ev = evidenceFor(e)!;
      const sourceId = `${e.source_id}:${e.id}`;
      const r = layer1(
        { speechAct: "restate", sourceId, span: ev.en, slots: {}, en: e.en, zh: e.zh, attribution: "leaflet" },
        { sourceId, kind: "patient_text", span: ev.en, attribution: "leaflet", restatement: { id: e.id, en: e.en, zh: e.zh, status: e.status } },
      );
      if (!r.pass) drift.push(e.id);
    }
    for (const id of drift) expect(KNOWN_DRIFT.has(id), `new drift: ${id}`).toBe(true);
  });
});

describe("drug matching", () => {
  it("normalises names: case, strength and dosage form words", () => {
    expect(normalizeName("AMLODIPINE 5MG TABLET")).toBe("amlodipine");
    expect(normalizeName("Losartan Potassium 50 mg tablets")).toBe("losartan potassium");
    expect(normalizeName("5 glucophage")).toBe("glucophage");
  });

  it("matches exact names and aliases in English and Chinese", () => {
    expect(matchDrug("Amlodipine")).toMatchObject({ drugId: "amlodipine", how: "exact" });
    expect(matchDrug("Norvasc 5mg")).toMatchObject({ drugId: "amlodipine", how: "alias" });
    expect(matchDrug("氨氯地平")).toMatchObject({ drugId: "amlodipine", how: "alias" });
    expect(matchDrug("Panadol")).toMatchObject({ drugId: "paracetamol" });
    expect(matchDrug("布洛芬")).toMatchObject({ drugId: "ibuprofen" });
  });

  it("matches near misses within the edit-distance threshold, which is configurable", () => {
    expect(levenshtein("amlodipin", "amlodipine")).toBe(1);
    expect(matchDrug("amlodipin")).toMatchObject({ drugId: "amlodipine", how: "fuzzy", distance: 1 });
    expect(matchDrug("amlodipin", { maxDistance: 0 })).toBeNull();
    expect(matchDrug("losartn")).toMatchObject({ drugId: "losartan", how: "fuzzy" });
    expect(defaultMaxDistance({ KB_FUZZY_MAX_DISTANCE: "3" })).toBe(3);
    expect(defaultMaxDistance({})).toBe(2);
  });

  it("does not identify unknown names", () => {
    expect(matchDrug("Xyzoprilane 10")).toBeNull();
    expect(matchDrug("amlo-dee-pin")).toBeNull();
    expect(matchDrug("降压药")).toBeNull();
    expect(matchDrug("")).toBeNull();
  });

  it("finds drug mentions in free text without fuzzy matching", () => {
    expect(mentionedDrugIds("What is amlodipine for?")).toEqual(["amlodipine"]);
    expect(mentionedDrugIds("布洛芬是什么药？")).toEqual(["ibuprofen"]);
    expect(mentionedDrugIds("We keep amlodipine at 5 milligrams, and I'll add losartan 50 milligrams")).toEqual(["amlodipine", "losartan"]);
    expect(findDrugMentions("the amlodipine besylate tablet")).toHaveLength(1);
    expect(mentionedDrugIds("this pill")).toEqual([]);
  });
});
