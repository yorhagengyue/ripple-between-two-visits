/**
 * Is a label reading trustworthy? (10-09 DeepSeek fixer, defect 4 of the round-1 check: deepseek-flash invented a
 * whole label from a rotated, blurred photo; the cropped clinic header gave the address as the medicine name.)
 *
 * The transcripts here are what the live model returned for the degraded photos (the check's run and the fixer's
 * own run on fixtures/labels/amlodipine.png rotated 90 degrees with a radius-4 blur); the photos themselves are not
 * kept. Two reads that disagree on the medicine or the dose make the photo unreadable; a date or clinic they do not
 * both read is left empty; an implausible date and a near-miss of his clinic are left empty; nothing is guessed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmClient } from "@/lib/llm/types";
import { MedsError } from "@/lib/meds/errors";
import { parseLabelText } from "@/lib/meds/parse-label";
import { readLabel } from "@/lib/meds/write";
import { FIELDS_SYSTEM, readLabelText, type SecondRead } from "@/lib/vision";
import { assessLabelReading, readDate, sameReading, similarity } from "@/lib/vision/check";
import { setup, type Ctx } from "../meds/helpers";

const KNOWN = ["Blossom Family Clinic (fictional)"];
const TODAY = "2026-09-22"; // D29

const GOOD_TEXT = [
  "BLOSSOM FAMILY CLINIC (FICTIONAL)",
  "Blk 000 Demo Ave, Singapore 000000  Tel 6000 0000",
  "Patient: TAN (DEMO)    Date: 01/09/2026",
  "AMLODIPINE 5MG TABLET",
  "Take ONE tablet every MORNING",
  "For: high blood pressure",
  "Qty: 35 tablets",
].join("\n");
const GOOD_SECOND: SecondRead = { medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every MORNING", date: "01/09/2026", clinic: "BLOSSOM FAMILY CLINIC (FICTIONAL)" };

/** deepseek-flash on the rotated + blurred photo (fixer's run, current prompt) and its field read of the same photo. */
const ROTATED_TEXT = [
  "BLOSSOM FAMILY CLINIC (PETITIONAL)",
  "Dr. 123 Main Ave, Springfield",
  "Patient: Tan (Mr)",
  "Date: 01/05/2024",
  "AMLODIPINE 5MG TABLET",
  "Take ONE tablet every MORNING",
  "For high blood pressure",
  "Do 30 tablets",
].join("\n");
const ROTATED_SECOND: SecondRead = { medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every morning", date: "01/05/2026", clinic: "BLOSSOM FAMILY CLINIC (PETITIONAL)" };

/** The round-1 check's run on the same kind of photo. */
const GHANA_TEXT = [
  "Blossom Family Clinic (Petitional)",
  "Dr. G. M. Amoah-Agyeman (MBChB)",
  "P.O. Box 1234, Accra, Ghana",
  "Patient: Tina Mensah",
  "Date: 05/05/2024",
  "AMLODIPINE 5MG TABLET",
  "Take ONE tablet every MORNING",
  "For high blood pressure",
  "Qty: 30 tablets",
].join("\n");

const assess = (text: string, second: SecondRead | null | undefined) => assessLabelReading(parseLabelText(text, { knownClinics: KNOWN }), second, { today: TODAY, knownClinics: KNOWN });

describe("assessLabelReading", () => {
  it("a good photo: both reads agree, every field kept, no warning", () => {
    const a = assess(GOOD_TEXT, GOOD_SECOND);
    expect(a.reject).toBeNull();
    expect(a.warnings).toEqual([]);
    expect(a.fields).toMatchObject({ drug_id: "amlodipine", strength: "5 mg", directions: "Take ONE tablet every MORNING", dispensed: "2026-09-01", clinic: "Blossom Family Clinic (fictional)" });
  });

  it("the rotated, blurred photo: medicine and dose kept (both reads agree), the invented date and clinic left empty", () => {
    const a = assess(ROTATED_TEXT, ROTATED_SECOND);
    expect(a.reject).toBeNull();
    expect(a.fields).toMatchObject({ drug_id: "amlodipine", directions: "Take ONE tablet every MORNING", dispensed: null, clinic: null });
    expect(a.warnings).toEqual(expect.arrayContaining(["date_unconfirmed", "clinic_near_known"]));
    expect(a.fields.drug_text).toBe("AMLODIPINE 5MG TABLET"); // never the address line
  });

  it("the check's Ghana transcript, even with no second read: the 2024 date and the near-miss clinic are left empty", () => {
    for (const second of [undefined, null]) {
      const a = assess(GHANA_TEXT, second);
      expect(a.fields).toMatchObject({ drug_id: "amlodipine", dispensed: null, clinic: null });
      expect(a.warnings).toEqual(expect.arrayContaining(["date_too_old", "clinic_near_known"]));
      if (second === null) expect(a.warnings).toContain("second_read_unavailable");
    }
  });

  it("reads that disagree on the medicine or on the dose make the photo unreadable", () => {
    expect(assess(GOOD_TEXT, { ...GOOD_SECOND, medicine: "LOSARTAN 50MG TABLET" }).reject).toBe("reads_disagree");
    expect(assess(GOOD_TEXT, { ...GOOD_SECOND, directions: "Take TWO tablets every MORNING" }).reject).toBe("reads_disagree");
  });

  it("a dose line only one read could see is left empty (it is what the safety layer quotes as the label)", () => {
    const a = assess(GOOD_TEXT, { ...GOOD_SECOND, directions: null });
    expect(a.fields).toMatchObject({ directions: null, slots: null, drug_id: "amlodipine" });
    expect(a.warnings).toContain("directions_unconfirmed");
  });

  it("a date in the future is left empty; a few days of clock slack are allowed", () => {
    expect(assessLabelReading({ ...parseLabelText(GOOD_TEXT, { knownClinics: KNOWN }) }, undefined, { today: "2026-08-20", knownClinics: KNOWN }).warnings).toContain("date_in_future");
    expect(assessLabelReading({ ...parseLabelText(GOOD_TEXT, { knownClinics: KNOWN }) }, undefined, { today: "2026-08-30", knownClinics: KNOWN }).warnings).toEqual([]);
  });

  it("a clinic he has never visited is kept (a pharmacy, another clinic); only a near miss of a known one is dropped", () => {
    const text = GOOD_TEXT.replace("BLOSSOM FAMILY CLINIC (FICTIONAL)", "GUARDIAN PHARMACY TOA PAYOH");
    const a = assess(text, { ...GOOD_SECOND, clinic: "GUARDIAN PHARMACY TOA PAYOH" });
    expect(a.fields.clinic).toBe("Guardian Pharmacy Toa Payoh");
    expect(a.warnings).toEqual([]);
  });

  it("the relative's box: its printed dosing never becomes a field, whatever the second read saw", () => {
    const text = "宁和平压丸\n【功能主治】平肝潜阳，用于头晕头痛\n【用法用量】口服，一次六粒，一日三次";
    const a = assess(text, { medicine: "宁和平压丸", directions: "口服，一次6粒，一日3次", date: null, clinic: null });
    expect(a.reject).toBeNull();
    expect(a.fields).toMatchObject({ drug_text: "宁和平压丸", drug_id: null, directions: null });
  });

  it("helpers", () => {
    expect(sameReading("Take ONE tablet every MORNING", "take one tablet every morning.")).toBe(true);
    expect(sameReading("AMLODIPINE 5MG TABLET", "AMLODIPINE 5MG")).toBe(true);
    expect(sameReading("Take ONE tablet", "Take TWO tablets")).toBe(false);
    expect(readDate("Date: 01/09/2026")).toBe("2026-09-01");
    expect(readDate("2026-09-01")).toBe("2026-09-01");
    expect(readDate(null)).toBeNull();
    expect(similarity("Blossom Family Clinic (fictional)", "Blossom Family Clinic (Petitional)")).toBeGreaterThan(0.75);
    expect(similarity("Blossom Family Clinic (fictional)", "Guardian Pharmacy")).toBeLessThan(0.5);
  });
});

describe("parse-label: the medicine line is never an address", () => {
  it("a photo of the clinic header alone has no medicine line", () => {
    const top = "BLOSSOM FAMILY CLINIC (FICTIONAL)\nBlk 000 Demo Ave, Singapore 000000 Tel 6000 0000\nPatient: TAN (DEMO) Date: 01/09/2026";
    const f = parseLabelText(top, { knownClinics: KNOWN });
    expect(f).toMatchObject({ drug_text: null, drug_id: null, clinic: "Blossom Family Clinic (fictional)", dispensed: "2026-09-01" });
  });
  it("address, P.O. box, phone and prescriber lines are skipped", () => {
    const f = parseLabelText("P.O. Box 1234, Accra, Ghana\nDr. G. M. Amoah-Agyeman (MBChB)\nTel 6000 0000\nZYLOPRIM\nTake as directed");
    expect(f.drug_text).toBe("ZYLOPRIM");
  });
});

describe("readLabelText: nothing readable is an error", () => {
  const fake = (transcript: string): LlmClient => ({
    provider: "fake",
    model: "fake",
    async chat(opts) {
      return { content: opts.system === FIELDS_SYSTEM ? JSON.stringify({ medicine: null, directions: null, date: null, clinic: null }) : transcript, tokens: 1 };
    },
  });
  for (const t of ["[?]", "[?]\n[?]\n[?]", "[?] [?]\n12"]) {
    it(JSON.stringify(t), async () => {
      await expect(readLabelText({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }, { llm: fake(t) })).rejects.toMatchObject({ code: "unreadable" });
    });
  }
  it("a field read that is not JSON leaves second null with a code, the transcription still counts", async () => {
    const llm: LlmClient = { provider: "fake", model: "f", chat: async () => ({ content: "AMLODIPINE 5MG TABLET", tokens: 1 }) };
    const out = await readLabelText({ bytes: new Uint8Array([1]), mime: "image/png" }, { llm });
    expect(out).toMatchObject({ second: null, secondError: "bad_json", text: "AMLODIPINE 5MG TABLET" });
  });
});

describe("readLabel (M3) applies the check", () => {
  let dir: string;
  let ctx: Ctx;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-label-check-"));
    ctx = await setup(dir, 29);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const vision = (transcript: string, second: SecondRead | string): LlmClient => ({
    provider: "fake-vision",
    model: "fake",
    async chat(opts) {
      if (opts.system === FIELDS_SYSTEM) return { content: typeof second === "string" ? second : JSON.stringify(second), tokens: 1 };
      return { content: transcript, tokens: 1 };
    },
  });

  it("the hallucinated photo: date and clinic left empty, warnings in the response and the event, no label text in them", async () => {
    const p = await ctx.upload("amlodipine");
    const res = await readLabel({ sessionId: ctx.sessionId, path: p }, { ...ctx.deps, vision: { llm: vision(ROTATED_TEXT, ROTATED_SECOND) } });
    expect(res.fields).toMatchObject({ drug_id: "amlodipine", directions: "Take ONE tablet every MORNING", dispensed: null, clinic: null });
    expect(res.warnings).toEqual(expect.arrayContaining(["date_unconfirmed", "clinic_near_known"]));
    const ev = ctx.events.find((e) => (e.data as { kind?: string }).kind === "label.read")!;
    expect((ev.data as { warnings: string[] }).warnings).toEqual(res.warnings);
    expect(JSON.stringify(res.warnings)).not.toMatch(/Petitional|2024/);
  });

  it("reads that disagree on the dose: label_unreadable (retake), and the event says why", async () => {
    const p = await ctx.upload("amlodipine");
    const err = await readLabel({ sessionId: ctx.sessionId, path: p }, { ...ctx.deps, vision: { llm: vision(GOOD_TEXT, { ...GOOD_SECOND, directions: "Take TWO tablets every MORNING" }) } }).catch((e) => e);
    expect(err).toBeInstanceOf(MedsError);
    expect(err).toMatchObject({ code: "label_unreadable" });
    expect(ctx.events.some((e) => (e.data as { kind?: string; code?: string }).kind === "label.read_failed" && (e.data as { code?: string }).code === "reads_disagree")).toBe(true);
  });

  it("a blank photo: label_unreadable", async () => {
    const p = await ctx.upload("amlodipine");
    const err = await readLabel({ sessionId: ctx.sessionId, path: p }, { ...ctx.deps, vision: { llm: vision("[?]", "{}") } }).catch((e) => e);
    expect(err).toMatchObject({ code: "label_unreadable" });
  });

  it("the offline cassette reader (no second read) still gives the expected fields with no warnings", async () => {
    const p = await ctx.upload("amlodipine");
    const res = await readLabel({ sessionId: ctx.sessionId, path: p }, ctx.deps);
    expect(res.fields).toMatchObject({ drug_id: "amlodipine", dispensed: "2026-09-01", clinic: "Blossom Family Clinic (fictional)" });
    expect(res.warnings).toEqual([]);
  });
});
