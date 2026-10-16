/**
 * 「拍药盒，看怎么吃」 / "Scan a medicine box" (lib/meds/scan.ts; scene 3 of the owner's film, 10-15): a photo of one of
 * his boxes -> which of his medicines it is -> a sheet with how to take it (his checked label's own words), what it is
 * for (the leaflet's sentence) and what his doctor said about it (with the recorded line, never played by itself).
 *
 * On the example account with its four medicines (RIPPLE_EXAMPLE_MEDS on, laid out on Thu 15 Oct 2026, day 42). The
 * label reader is the model path of lib/vision with a stand-in model that "reads" the printed labels made for the film
 * (D:/ripple-c2/print/medicine-labels-1015): the transcription and the field read, as lib/vision asks for them.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import { getKb } from "@/lib/kb/load";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { mx } from "@/lib/meds/account-copy";
import { MedsError } from "@/lib/meds/errors";
import { matchScan, plainLabelRuns, sameDirections, scanBox, type ScanView } from "@/lib/meds/scan";
import type { MedsDeps } from "@/lib/meds/write";
import { judgementHits } from "@/lib/safety/judgement";
import { sameQuote } from "@/lib/safety/text";
import { UNKNOWN_MED_SENTENCE } from "@/lib/safety/templates";
import { setAiConsent } from "@/lib/privacy/ai";
import { getMemoryStore } from "@/lib/store/memory";
import type { MedicationRow, SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { setTestClock } from "@/lib/time/now";

/** The printed labels for the film: the lines a reader transcribes, top to bottom. */
function label(drugLine: string, directions: string, qty: number): { text: string; fields: Record<string, string | null> } {
  const lines = [
    "BLOSSOM FAMILY CLINIC (FICTIONAL)",
    "Blk 000 Demo Ave, Singapore 000000 Tel 6000 0000",
    "Patient: MR TAN (EXAMPLE) Date: 11/09/2026",
    drugLine,
    directions,
    `Qty: ${qty} tablets`,
    "Keep out of reach of children.",
    "EXAMPLE LABEL FOR A FILM - NOT A REAL PRESCRIPTION",
  ];
  return { text: lines.join("\n"), fields: { medicine: drugLine, directions, date: "11/09/2026", clinic: "BLOSSOM FAMILY CLINIC (FICTIONAL)" } };
}
const LABELS = {
  amlodipine: label("AMLODIPINE 5MG TABLET", "Take ONE tablet every MORNING", 30),
  metformin: label("METFORMIN 500MG TABLET", "Take TWO tablets twice a day AFTER breakfast and dinner", 120),
  atorvastatin: label("ATORVASTATIN 20MG TABLET", "Take ONE tablet at BEDTIME", 30),
  aspirin: label("ASPIRIN 100MG TABLET", "Take ONE tablet every MORNING AFTER breakfast", 30),
  // not his: losartan is prescribed only at today's planned visit; a strength he does not have; a name nobody knows
  losartan: label("LOSARTAN 50MG TABLET", "Take ONE tablet every MORNING", 30),
  amlodipine10: label("AMLODIPINE 10MG TABLET", "Take ONE tablet every MORNING", 30),
  amlodipineTwo: label("AMLODIPINE 5MG TABLET", "Take TWO tablets every MORNING", 30),
  unknown: label("XYZOPRILANE 10MG TABLET", "Take ONE tablet every MORNING", 30),
};
type LabelKey = keyof typeof LABELS;

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;
let him: TestAccount;
let scope: SessionRow;

/** A stand-in model that reads the given label: the transcription, or the field read when lib/vision asks for JSON. */
function reader(key: LabelKey): LlmClient {
  const l = LABELS[key];
  return {
    provider: "fake-vision",
    model: "fake",
    async chat(opts: ChatOpts) {
      return opts.json ? { content: JSON.stringify(l.fields), tokens: 1 } : { content: l.text, tokens: 1 };
    },
  } as unknown as LlmClient;
}
const deps = (key: LabelKey): MedsDeps => ({ store, blob, vision: { llm: reader(key) }, publish: () => undefined, ask: { costGuard: null, checker: null, checkerReason: "unit test" } });

async function photo(): Promise<string> {
  const p = `${blobPrefix(scope)}/labels/box-${randomUUID().slice(0, 8)}.jpg`;
  // the bytes are any image's: the stand-in model reads the label it was given
  await blob.putObject("labels", p, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), "image/jpeg");
  return p;
}
const scanOf = async (key: LabelKey, locale: "en" | "zh-Hans" = "en"): Promise<ScanView> => scanBox({ sessionId: scope.id, path: await photo(), locale }, deps(key));
const runsText = (v: ScanView) => v.how!.runs.map((r) => r.text).join("");
const strong = (v: ScanView) => v.how!.runs.filter((r) => r.strong).map((r) => r.text);
const patientText = (id: string) => getKb().patientText.find((e) => e.id === id)!;

beforeAll(async () => {
  vi.stubEnv("RIPPLE_EXAMPLE_MEDS", "on");
  dir = mkdtempSync(path.join(tmpdir(), "ripple-scan-"));
  blob = createLocalBlobStore({ dir });
  setTestClock({ at: "2026-10-15T10:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `scan${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  scope = (await store.getSession(him.userId))!;
});
afterAll(() => {
  vi.unstubAllEnvs();
  setTestClock(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("the words of the big sentence: the label's own, capitals in bold", () => {
  it("lowers only the words printed in capitals and marks them; lib/safety still counts it the label's own words", () => {
    const cases: [string, string, string[]][] = [
      ["Take ONE tablet every MORNING", "Take one tablet every morning", ["one", "morning"]],
      ["Take TWO tablets twice a day AFTER breakfast and dinner", "Take two tablets twice a day after breakfast and dinner", ["two", "after"]],
      ["Take ONE tablet at BEDTIME", "Take one tablet at bedtime", ["one", "bedtime"]],
      ["Take ONE tablet every MORNING AFTER breakfast", "Take one tablet every morning after breakfast", ["one", "morning", "after"]],
      ["TAKE 1 TAB OM", "Take 1 tab OM", ["take", "tab"]],
    ];
    for (const [printed, plain, bold] of cases) {
      const runs = plainLabelRuns(printed);
      expect(runs.map((r) => r.text).join("")).toBe(plain);
      expect(runs.filter((r) => r.strong).map((r) => r.text.toLowerCase())).toEqual(bold);
      expect(sameQuote(plain, printed)).toBe(true);
    }
  });

  it("two directions lines say the same when their words or their quantity, unit, time and frequency do", () => {
    expect(sameDirections("Take ONE tablet every MORNING", "take one tablet every morning.")).toBe(true);
    expect(sameDirections("Take 1 tablet every morning", "Take ONE tablet every MORNING")).toBe(true);
    expect(sameDirections("Take TWO tablets every MORNING", "Take ONE tablet every MORNING")).toBe(false);
    expect(sameDirections("Take ONE tablet at BEDTIME", "Take ONE tablet every MORNING")).toBe(false);
  });
});

describe("which of his medicines the box is (matchScan)", () => {
  const med = (id: string, drug: string | null, strength: string | null, extra: Partial<MedicationRow> = {}) =>
    ({ id, drug_id: drug, origin: "prescription", status: "label_confirmed", label: { text: "", strength, directions: "Take ONE tablet every MORNING" }, ...extra }) as MedicationRow;
  const meds = [med("a", "amlodipine", "5 mg"), med("b", "aspirin", "100 mg"), med("box", null, null, { status: "unidentified", origin: "relative" })];

  it("his: the same medicine and strength, directions the same or not read", () => {
    expect(matchScan({ drug_id: "amlodipine", strength: "5 mg", directions: "Take ONE tablet every MORNING" }, meds)).toMatchObject({ outcome: "his", differs: null, med: { id: "a" } });
    expect(matchScan({ drug_id: "amlodipine", strength: null, directions: null }, meds)).toMatchObject({ outcome: "his", med: { id: "a" } });
  });

  it("differs: another strength, or directions that say something else; never his directions for it", () => {
    expect(matchScan({ drug_id: "amlodipine", strength: "10 mg", directions: "Take ONE tablet every MORNING" }, meds)).toMatchObject({ outcome: "differs", differs: "strength", med: { id: "a" } });
    expect(matchScan({ drug_id: "amlodipine", strength: "5 mg", directions: "Take TWO tablets every MORNING" }, meds)).toMatchObject({ outcome: "differs", differs: "directions" });
  });

  it("not his, or nobody can tell: no medicine of his, the box nobody identified matches nothing", () => {
    expect(matchScan({ drug_id: "losartan", strength: "50 mg", directions: null }, meds)).toEqual({ outcome: "not_his", med: null, differs: null });
    expect(matchScan({ drug_id: null, strength: null, directions: null }, meds)).toEqual({ outcome: "unknown", med: null, differs: null });
  });

  it("prefers the checked label of the same strength from the doctor when he has the medicine twice", () => {
    const two = [med("self", "amlodipine", "10 mg", { origin: "self_bought", status: "unverified" }), med("rx", "amlodipine", "5 mg")];
    expect(matchScan({ drug_id: "amlodipine", strength: "5 mg", directions: null }, two).med?.id).toBe("rx");
    expect(matchScan({ drug_id: "amlodipine", strength: "10 mg", directions: null }, two).med?.id).toBe("self");
  });
});

describe("the sheet, on the example account with its four medicines", () => {
  it("amlodipine: his label's words big, morning, his clinic; the leaflet's line; the doctor's words with the recorded line", async () => {
    const v = await scanOf("amlodipine");
    expect(v).toMatchObject({ outcome: "his", differs: null, say: null, question: null, noDirections: false, provider: "fake-vision" });
    expect(v.med).toEqual({ id: "med-amlodipine", name: "Amlodipine", strength: "5 mg", zhName: "氨氯地平" });
    // what the reader returned, as the add flow gets it: the date and the clinic of the printed label
    expect(v.read).toEqual({ name: "Amlodipine", strength: "5 mg", printed: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every MORNING", dispensed: "2026-09-11", clinic: "Blossom Family Clinic (fictional)", warnings: [] });
    expect(runsText(v)).toBe("Take one tablet every morning");
    expect(strong(v)).toEqual(["one", "morning"]);
    expect(v.how).toMatchObject({ lang: "en", printed: null, when: "Morning · as the label says", slots: ["morning"], clinic: "Blossom Family Clinic (fictional)", sourceId: "label:med-amlodipine" });
    expect(v.purpose).toMatchObject({ text: patientText("amlodipine.purpose").en, url: expect.stringContaining("healthhub.sg") });
    expect(v.purpose!.meta).toContain("healthhub.sg");
    // what his doctor said about why he takes it, at v2 (day 8 of the account), with the stand-in clip of that line
    expect(v.doctor).toHaveLength(1);
    const d = v.doctor[0];
    expect(d.text).toBe("This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.");
    expect(d).toMatchObject({ lang: "en", date: storyDate(scope.d0!, 8), inferred: false, clip: { url: expect.stringContaining("/api/visits/v2/clip?u=v2-u06"), standIn: true } });
    expect(d.meta).toContain("Sep");
  });

  it("metformin, atorvastatin, aspirin: each his own label's words and slots; no leaflet line (the kb has none), no doctor's words", async () => {
    const want: [LabelKey, string, string, string, string[]][] = [
      ["metformin", "x-med-metformin", "Take two tablets twice a day after breakfast and dinner", "Morning, Evening · the time you chose", ["morning", "evening"]],
      ["atorvastatin", "x-med-atorvastatin", "Take one tablet at bedtime", "Bedtime · as the label says", ["night"]],
      ["aspirin", "x-med-aspirin", "Take one tablet every morning after breakfast", "Morning · as the label says", ["morning"]],
    ];
    for (const [key, id, words, when, slots] of want) {
      const v = await scanOf(key);
      expect(v.outcome, key).toBe("his");
      expect(v.med?.id).toBe(id);
      expect(runsText(v)).toBe(words);
      expect(v.how).toMatchObject({ when, slots, clinic: "Blossom Family Clinic (fictional)", sourceId: `label:${id}` });
      // the knowledge base has the leaflet's line of what it is for only for amlodipine among his four: none is written here
      expect(getKb().patientText.some((e) => e.id === `${key}.purpose`)).toBe(false);
      expect(v.purpose).toBeNull();
      expect(v.doctor).toEqual([]);
    }
  });

  it("华语: lib/safety's template with the label's words under it; no template, the label's words; the doctor's words as said", async () => {
    const aml = await scanOf("amlodipine", "zh-Hans");
    expect(aml.how).toMatchObject({ lang: "zh-Hans", runs: [{ text: "每天早上服用一片。", strong: false }], printed: "Take ONE tablet every MORNING", when: "早间服用 · 依药品标签" });
    expect(aml.purpose?.text).toBe(patientText("amlodipine.purpose").zh);
    expect(aml.doctor[0]).toMatchObject({ lang: "en", text: expect.stringContaining("This tablet works quietly.") });
    const met = await scanOf("metformin", "zh-Hans");
    expect(met.how).toMatchObject({ lang: "en", printed: null, when: "早间、晚间服用 · 你选的时间" });
    expect(runsText(met)).toBe("Take two tablets twice a day after breakfast and dinner");
    expect(met.purpose).toBeNull();
  });

  it("a box that is not his: said plainly, no directions; his question for the pharmacist is offered", async () => {
    const v = await scanOf("losartan");
    expect(v).toMatchObject({ outcome: "not_his", med: null, how: null, purpose: null, doctor: [], read: { name: "Losartan", strength: "50 mg" } });
    expect(v.say).toBe(mx("en", "scan.notHis", { name: "Losartan 50 mg" }));
    expect(v.question).toBe(mx("en", "scan.questionNotHis", { name: "Losartan 50 mg" }));
    const zh = await scanOf("losartan", "zh-Hans");
    expect(zh.say).toBe("这是 Losartan 50 mg，不在你的药单上。吃之前先问药剂师或医生。");
  });

  it("a box nobody can identify: lib/safety's fixed sentence and the add flow's own question", async () => {
    const v = await scanOf("unknown");
    expect(v).toMatchObject({ outcome: "unknown", med: null, how: null, say: UNKNOWN_MED_SENTENCE, read: { name: null, printed: "XYZOPRILANE 10MG TABLET" } });
    expect(v.question).toBe("What is this medicine? The box says: XYZOPRILANE 10MG TABLET");
    expect((await scanOf("unknown", "zh-Hans")).say).toBe("我认不出这个药，请拿去问药剂师。");
  });

  it("his medicine with another strength or other directions: said in one sentence, nothing of how to take either", async () => {
    const strength = await scanOf("amlodipine10");
    expect(strength).toMatchObject({ outcome: "differs", differs: "strength", med: { id: "med-amlodipine" }, how: null, purpose: null, doctor: [] });
    expect(strength.say).toBe("This box is Amlodipine 10 mg. The Amlodipine on your list is 5 mg. Ask your pharmacist which box to use before you take it.");
    const directions = await scanOf("amlodipineTwo");
    expect(directions).toMatchObject({ outcome: "differs", differs: "directions", how: null });
  });

  it("writes nothing: his medicines and his question list are as they were", async () => {
    const meds = (await store.listMeds(scope.id)).map((m) => [m.id, m.status, m.label?.directions]);
    const questions = (await store.listQuestions(scope.id)).length;
    for (const key of Object.keys(LABELS) as LabelKey[]) await scanOf(key);
    expect((await store.listMeds(scope.id)).map((m) => [m.id, m.status, m.label?.directions])).toEqual(meds);
    expect((await store.listQuestions(scope.id)).length).toBe(questions);
  });

  it("with his consent to AI processing off the photo goes to no reader", async () => {
    await setAiConsent({ store, texts: store }, { userId: him.userId, scopeId: scope.id, on: false, locale: "en" });
    try {
      await expect(scanOf("amlodipine")).rejects.toMatchObject({ code: "ai_off" } satisfies Partial<MedsError>);
    } finally {
      await setAiConsent({ store, texts: store }, { userId: him.userId, scopeId: scope.id, on: true, locale: "en" });
    }
  });
});

describe("the sheet's own words", () => {
  it("every scan.* line has English and 华语, and none of them judges", () => {
    for (const locale of ["en", "zh-Hans"] as const) {
      for (const key of ["scan.button", "scan.bar", "scan.how", "scan.purpose", "scan.doctor", "scan.play", "scan.noDirections", "scan.notHis", "scan.differsStrength", "scan.differsDirections", "scan.unreadable", "scan.failed", "scan.aiOff"] as const) {
        const text = mx(locale, key, { name: "X", read: "X 10 mg", mine: "5 mg" });
        expect(text.length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(judgementHits(text), `${locale} ${key}`).toEqual([]);
        if (locale === "zh-Hans") expect(/\p{Script=Han}/u.test(text), key).toBe(true);
      }
    }
    // his question for the pharmacist is a question in his words (asking about other medicines is what it is for)
    expect(mx("en", "scan.questionNotHis", { name: "X" })).toMatch(/\?$/);
    expect(mx("zh-Hans", "scan.questionNotHis", { name: "X" })).toMatch(/？$/);
    expect(mx("en", "scan.button")).toBe("Scan a medicine box");
    expect(mx("zh-Hans", "scan.button")).toBe("拍药盒，看怎么吃");
  });
});
