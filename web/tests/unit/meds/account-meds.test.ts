/**
 * His medicines on a real account (C2 track F; real-app 2.16, 2.17, 6.9, 12): a prescription from his confirmed visit
 * awaiting its label, the label checked line by line (a changed line is his, never the label's), the slots from the
 * label's own time words or his choice, from now on; a label for another medicine asks the pharmacist instead; the same
 * unidentified box twice is one medicine; his own typed entry; 没在吃 / 带去给医生看; 知道 kept; the list only after the
 * visit happened; the sample photos only for the example account; the doctor's English translated once and kept.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as sampleGet } from "@/app/api/labels/sample/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import { answerUnderstanding, understandingView } from "@/lib/explain/understanding";
import type { LlmClient } from "@/lib/llm/types";
import { buildMedCardView } from "@/lib/meds/card";
import { listMedGroups } from "@/lib/meds/list";
import { medsNow } from "@/lib/meds/on-day";
import type { StoredLabel } from "@/lib/meds/types";
import { addManualMed, confirmLabel, readLabel, setMedPatientStatus, type MedsDeps } from "@/lib/meds/write";
import { zhGenericName, ZH_GENERIC } from "@/lib/meds/zh-names";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { getSpeechProvider } from "@/lib/asr";
import { finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { translateVisitLines } from "@/lib/visit/translate";
import { buildVisitView } from "@/lib/visit/view";
import { labelPng, type LabelName } from "./helpers";
import drugs from "@/kb/drugs.json";

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;
const saved = { ...process.env };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-meds-"));
  blob = createLocalBlobStore({ dir });
  process.env.MOCK_ASR_JOB_MS = "0";
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => setTestClock(null));

const deps = (): MedsDeps => ({ store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } });

async function account(space: "blank" | "example" = "blank"): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `fm${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}

async function photo(scope: SessionRow, name: LabelName): Promise<string> {
  const p = `${blobPrefix(scope)}/labels/${name}-${randomUUID().slice(0, 8)}.png`;
  await blob.putObject("labels", p, labelPng(name), "image/png");
  return p;
}

/** His visit with the v2 sample record (devfake / Whisper), the prescription line confirmed: amlodipine awaits its label. */
async function prescribedAmlodipine(scope: SessionRow) {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  const items = await store.listVisitItems(scope.id, { visit_id: visit.id });
  const med = items.find((i) => i.type === "medication" && i.slots?.drug === "amlodipine")!;
  // the doctor's reason (v2's "This tablet works quietly ..."), on its own line
  const purposeLine = items.find((i) => i.type === "purpose")!.utterance_ids[0];
  const purpose = items.filter((i) => i.utterance_ids.includes(purposeLine));
  await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
  if (purpose.length) await setItemVerdict(store, scope, visit.id, { items: purpose.map((p) => p.id), verdict: "right" });
  return visit;
}

const fieldsAll = ["drug_text", "strength", "directions", "dispensed", "clinic"];

describe("a prescription from his visit, then its label", () => {
  it("awaits its label on his list, then the label confirms it: slots from the label's words, from now on", async () => {
    const { scope } = await account();
    const visit = await prescribedAmlodipine(scope);
    let groups = await listMedGroups(store, scope.id, scope.story_day, "zh-Hans", scope.story_time);
    expect(groups.flatMap((g) => g.items)).toEqual([expect.objectContaining({ id: "med-amlodipine", status: "awaiting_label", zhName: "氨氯地平", slots: [] })]);
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps());
    const out = await confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: fieldsAll, origin: "prescription", locale: "zh-Hans" }, deps());
    expect(out.created).toBe(false);
    expect(out.med).toMatchObject({ id: "med-amlodipine", status: "label_confirmed", prescribed_visit_id: visit.id, dose_slots: ["morning"], dose_slots_source: "label", start_at: "2026-10-12T02:00:00.000Z", start_day: scope.story_day });
    expect((out.med.label as StoredLabel).directions).toBe("Take ONE tablet every MORNING");
    groups = await listMedGroups(store, scope.id, scope.story_day, "zh-Hans", scope.story_time);
    expect(groups[0].items[0]).toMatchObject({ status: "label_confirmed", slots: ["morning"] });
    const card = await buildMedCardView(store, scope.id, out.med, { day: scope.story_day, locale: "zh-Hans" });
    expect(card.howToTake.map((l) => l.chip.kind)).toEqual(["label"]);
    expect(card.slots).toEqual({ slots: ["morning"], source: "label" });
  });

  it("a line he changes is his: shown as 「你改过」, never quoted as the label's; his choice sets the slots", async () => {
    const { scope } = await account();
    await prescribedAmlodipine(scope);
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps());
    const out = await confirmLabel(
      { sessionId: scope.id, readToken: read.read_token, confirmed: ["drug_text", "strength", "dispensed"], edits: { directions: "一天一粒，晚饭后", clinic: "Blossom Family Clinic" }, slots: ["evening"], locale: "zh-Hans" },
      deps(),
    );
    const label = out.med.label as StoredLabel;
    expect(label.directions).toBeNull();
    expect(label.clinic).toBeNull();
    expect(label.edited).toEqual(["directions", "clinic"]);
    expect(label.edited_values).toEqual({ directions: "一天一粒，晚饭后", clinic: "Blossom Family Clinic" });
    expect(label.text).not.toContain("一天一粒");
    expect(out.med).toMatchObject({ dose_slots: ["evening"], dose_slots_source: "patient" });
    const card = await buildMedCardView(store, scope.id, out.med, { day: scope.story_day, locale: "zh-Hans" });
    expect(card.howToTake).toEqual([]);
    expect(card.edited).toEqual([
      { field: "directions", value: "一天一粒，晚饭后" },
      { field: "clinic", value: "Blossom Family Clinic" },
    ]);
    // every line is either ticked or changed
    const again = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps());
    await expect(confirmLabel({ sessionId: scope.id, readToken: again.read_token, confirmed: ["drug_text"], locale: "zh-Hans" }, deps())).rejects.toMatchObject({ code: "not_all_confirmed" });
  });

  it("a label that names another medicine than the doctor prescribed writes nothing and asks the pharmacist, once", async () => {
    const { scope } = await account();
    await store.upsertMed(scope.id, { id: "med-losartan", origin: "prescription", status: "awaiting_label", drug_id: "losartan", start_day: scope.story_day });
    for (let i = 0; i < 2; i++) {
      const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps());
      await expect(confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: fieldsAll, medId: "med-losartan", locale: "zh-Hans" }, deps())).rejects.toMatchObject({
        code: "label_mismatch",
        detail: { questions: [expect.objectContaining({ for: "pharmacist", text: "药袋上的名字（AMLODIPINE 5MG TABLET）和医生开的（Losartan）不一样，是同一种药吗？" })] },
      });
    }
    expect((await store.listQuestions(scope.id)).filter((q) => q.evidence === "label_mismatch:med-losartan")).toHaveLength(1);
    expect((await store.getMed(scope.id, "med-losartan"))?.status).toBe("awaiting_label");
  });
});

describe("a medicine nobody identified", () => {
  it("the same box photographed twice is one medicine with one question; 没在吃 and 带去给医生看 are his", async () => {
    const { scope } = await account();
    const first = await confirmLabel({ sessionId: scope.id, readToken: (await readLabel({ sessionId: scope.id, path: await photo(scope, "relative_box") }, deps())).read_token, confirmed: ["drug_text"], origin: "relative", locale: "zh-Hans" }, deps());
    expect(first).toMatchObject({ outcome: "unidentified", created: true });
    expect(first.answer?.fixedText).toBe("I'm not able to identify that medication, please check with your pharmacist.");
    const second = await confirmLabel({ sessionId: scope.id, readToken: (await readLabel({ sessionId: scope.id, path: await photo(scope, "relative_box") }, deps())).read_token, confirmed: ["drug_text"], origin: "relative", locale: "zh-Hans" }, deps());
    expect(second).toMatchObject({ created: false, questions: [] });
    expect(second.med.id).toBe(first.med.id);
    // the same fixed sentence again, without a second question
    expect(second.answer).toMatchObject({ route: "unknown_med", fixedText: first.answer?.fixedText, fixedTextZh: first.answer?.fixedTextZh });
    expect(second.answer?.addedQuestionId).toBeUndefined();
    expect((await store.listMeds(scope.id)).filter((m) => m.status === "unidentified")).toHaveLength(1);
    expect((await store.listQuestions(scope.id)).filter((q) => q.origin === "unidentified_medicine")).toHaveLength(1);
    expect(second.med.dose_slots ?? null).toBeNull();

    const notTaking = await setMedPatientStatus({ sessionId: scope.id, medId: first.med.id, status: "not_taking", locale: "zh-Hans" }, deps());
    expect(notTaking.question).toBeNull();
    expect((notTaking.med.label as StoredLabel).patient_status).toBe("not_taking");
    const bring = await setMedPatientStatus({ sessionId: scope.id, medId: first.med.id, status: "bring_to_doctor", locale: "zh-Hans" }, deps());
    expect(bring.question).toMatchObject({ for: "doctor", origin: "own", text: "我带了这盒药给医生看：「宁和平压丸」。可以吃吗？", status: "open" });
    const again = await setMedPatientStatus({ sessionId: scope.id, medId: first.med.id, status: "bring_to_doctor", locale: "zh-Hans" }, deps());
    expect(again.question?.id).toBe(bring.question!.id);
    expect((await store.listQuestions(scope.id)).filter((q) => q.for === "doctor" && q.text.includes("宁和平压丸"))).toHaveLength(1);
    const groups = await listMedGroups(store, scope.id, scope.story_day, "zh-Hans");
    expect(groups.flatMap((g) => g.items).find((m) => m.id === first.med.id)).toMatchObject({ patientStatus: "bring_to_doctor" });
    // only a medicine nobody identified has these choices
    await store.upsertMed(scope.id, { id: "med-x", origin: "prescription", status: "label_confirmed", drug_id: "amlodipine" });
    await expect(setMedPatientStatus({ sessionId: scope.id, medId: "med-x", status: "not_taking", locale: "zh-Hans" }, deps())).rejects.toMatchObject({ code: "not_unidentified" });
  });
});

describe("his own entry", () => {
  it("typed in: unverified, his own entry, the slots he chose; a kb name only when it is exactly one; never twice", async () => {
    const { scope } = await account();
    const out = await addManualMed({ sessionId: scope.id, name: "Panadol", origin: "self_bought", slots: ["night", "morning"], strength: "500 mg", locale: "zh-Hans" }, deps());
    expect(out.med).toMatchObject({ status: "unverified", drug_id: "paracetamol", origin: "self_bought", dose_slots: ["morning", "night"], dose_slots_source: "patient", start_at: "2026-10-12T02:00:00.000Z" });
    expect(out.med.label).toMatchObject({ typed: true, read_by: "patient", drug_text: "Panadol", strength: "500 mg", directions: null });
    await expect(addManualMed({ sessionId: scope.id, name: "panadol", origin: "self_bought", slots: [], locale: "zh-Hans" }, deps())).rejects.toMatchObject({ code: "med_exists", detail: { med_id: out.med.id } });
    const unknownName = await addManualMed({ sessionId: scope.id, name: "Amlodipne", origin: "prescription", slots: [], locale: "zh-Hans" }, deps());
    expect(unknownName.med.drug_id).toBeNull();
    expect(unknownName.med.dose_slots ?? null).toBeNull();
    expect(unknownName.med.dose_slots_source ?? null).toBeNull();
    await expect(addManualMed({ sessionId: scope.id, name: "   ", origin: "prescription", slots: [], locale: "zh-Hans" }, deps())).rejects.toMatchObject({ code: "bad_name" });
    const card = await buildMedCardView(store, scope.id, out.med, { day: scope.story_day, locale: "zh-Hans" });
    expect(card).toMatchObject({ typed: true, zhName: "扑热息痛", slots: { slots: ["morning", "night"], source: "patient" } });
  });
});

describe("which medicines are his now", () => {
  it("a medicine prescribed at a planned or an empty visit is not on his list", async () => {
    const { scope } = await account();
    const planned = await store.upsertVisit(scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Clinic", day: scope.story_day, status: "planned" });
    const empty = await store.upsertVisit(scope.id, { id: `e-${randomUUID()}`, kind: "clinic", place: "Clinic", day: scope.story_day, status: "review" });
    await store.upsertMed(scope.id, { id: "med-a", origin: "prescription", status: "awaiting_label", drug_id: "losartan", prescribed_visit_id: planned.id });
    await store.upsertMed(scope.id, { id: "med-b", origin: "prescription", status: "awaiting_label", drug_id: "metformin", prescribed_visit_id: empty.id });
    await store.upsertMed(scope.id, { id: "med-c", origin: "self_bought", status: "unverified", drug_id: null, start_day: scope.story_day });
    expect((await medsNow(store, scope)).map((m) => m.id)).toEqual(["med-c"]);
  });

  it("the demo on the v3 day, before the visit (09:30, no record): losartan is not on the list yet", async () => {
    const s = await store.createSession({ story_day: 42, story_time: "09:30", ttl_hours: 1 });
    await store.upsertMed(s.id, { id: "med-losartan", origin: "prescription", status: "awaiting_label", drug_id: "losartan", prescribed_visit_id: "v3", start_day: null });
    const ids = (await listMedGroups(store, s.id, 42, "en", "09:30")).flatMap((g) => g.items.map((m) => m.id));
    expect(ids).toContain("med-amlodipine");
    expect(ids).not.toContain("med-losartan");
    expect((await listMedGroups(store, s.id, 42, "en", null)).flatMap((g) => g.items.map((m) => m.id))).toContain("med-losartan");
  });
});

describe("the understanding checklist keeps 知道", () => {
  it("知道 and 不确定 are kept; 不确定 also asks", async () => {
    const { scope } = await account();
    await prescribedAmlodipine(scope);
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps());
    await confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: fieldsAll, origin: "prescription", locale: "zh-Hans" }, deps());
    await answerUnderstanding({ sessionId: scope.id, medId: "med-amlodipine", item: "purpose", answer: "know", locale: "zh-Hans" }, { store, publish: () => undefined });
    await answerUnderstanding({ sessionId: scope.id, medId: "med-amlodipine", item: "missed", answer: "unsure", locale: "zh-Hans" }, { store, publish: () => undefined });
    const view = await understandingView(store, scope.id, "med-amlodipine");
    expect(view.items.map((i) => [i.id, i.answer, !!i.questionId])).toEqual([
      ["purpose", "know", false],
      ["feel_fine", null, false],
      ["when", null, false],
      ["missed", "unsure", true],
    ]);
  });
});

describe("the sample label photos", () => {
  const sample = (token?: string) => new NextRequest("http://localhost/api/labels/sample?name=amlodipine", { headers: token ? { cookie: `rp_at=${token}` } : {} });
  it("a blank account: 403 example_only; the example account and the demo's landing: the photo", async () => {
    const blank = await account("blank");
    expect((await sampleGet(sample(blank.a.tokens.access_token))).status).toBe(403);
    const example = await account("example");
    expect((await sampleGet(sample(example.a.tokens.access_token))).status).toBe(200);
    expect((await sampleGet(sample())).status).toBe(200);
  });
});

describe("Chinese generic names", () => {
  it("every entry is one of the kb's own aliases for that drug (the checked table)", () => {
    for (const [id, zh] of Object.entries(ZH_GENERIC)) {
      const drug = (drugs as { drugs: { id: string; aliases: string[] }[] }).drugs.find((d) => d.id === id);
      expect(drug, id).toBeTruthy();
      expect(drug!.aliases, id).toContain(zh);
    }
    expect(zhGenericName("amlodipine")).toBe("氨氯地平");
    expect(zhGenericName(null)).toBeNull();
  });
});

describe("the doctor's English, translated once at the end of the visit", () => {
  const fakeLlm = (content: (user: string) => string): LlmClient => ({
    provider: "fake",
    model: "fake",
    chat: async (o) => ({ content: content(o.user), tokens: 1 }),
  });

  it("a checked translation is kept and the review shows it; no consent: nothing sent, nothing kept", async () => {
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
    await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
    const asked: string[] = [];
    const llm = fakeLlm((user) => {
      const { text } = JSON.parse(user) as { text: string };
      asked.push(text);
      return JSON.stringify({ translation: text === "At home, we want it below 135 over 85." ? "在家里，我们希望低于 135/85。" : "" });
    });
    const checker = fakeLlm(() => JSON.stringify({ same: true }));
    expect(await translateVisitLines(store, scope, visit.id, { aiAllowed: false, llm, checker })).toBe(0);
    expect(asked).toEqual([]);
    const done = await translateVisitLines(store, scope, visit.id, { aiAllowed: true, llm, checker });
    expect(done).toBe(1);
    expect(asked.length).toBeGreaterThan(1);
    const view = (await buildVisitView(store, scope.id, visit.id, { session: (await store.getSession(scope.id))! }))!;
    const target = view.lines.find((l) => l.text === "At home, we want it below 135 over 85.")!;
    expect(target.translation).toBe("在家里，我们希望低于 135/85。");
    expect(view.lines.filter((l) => l.translation).length).toBe(1);
  });
});
