/**
 * A label and the medicines waiting for theirs, the third round (C2 track F; real-app 2.16, 6.9 line 1208; audit au4
 * row 17): on an account the match does not depend on the page having been opened for that medicine (`med_id`).
 *   - the label names the waiting medicine: it goes onto that medicine;
 *   - a prescription waits and the label names something else: nothing is written, he is asked (409 label_which);
 *     「是」 is the mismatch rule (the pharmacist question, 409 label_mismatch), 「不是」 saves it as its own medicine;
 *   - he said it is not from the doctor and the names differ, or it is a medicine he already has again: no question;
 *   - the same for a label he types in himself;
 *   - a demo session keeps its behaviour.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as manualPost } from "@/app/api/meds/manual/route";
import { POST as medsPost } from "@/app/api/meds/route";
import { getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import { confirmLabel, readLabel, relabelMed, type MedsDeps } from "@/lib/meds/write";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { FIXTURES } from "./helpers";

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;
const saved = { ...process.env };
const ALL = ["drug_text", "strength", "directions", "dispensed", "clinic"];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-meds3-"));
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

async function account(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `m3${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}

type Label = "amlodipine" | "losartan" | "ibuprofen" | "relative_box";

/** A label photo in his space, read: the read token and the fields. */
async function read(scope: SessionRow, name: Label) {
  const p = `${blobPrefix(scope)}/labels/${name}-${randomUUID().slice(0, 8)}.png`;
  await blob.putObject("labels", p, new Uint8Array(readFileSync(path.join(FIXTURES, "labels", `${name}.png`))), "image/png");
  return readLabel({ sessionId: scope.id, path: p }, deps());
}

/** His visit with the v2 sample record, the prescription line confirmed: amlodipine awaits its label. */
async function prescribedAmlodipine(scope: SessionRow) {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  const med = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.type === "medication" && i.slots?.drug === "amlodipine")!;
  await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
  return visit;
}

function req(a: TestAccount, pathname: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, { method: "POST", headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

const meds = (scope: SessionRow) => store.listMeds(scope.id);
const mismatchQuestions = async (scope: SessionRow) => (await store.listQuestions(scope.id)).filter((q) => q.evidence?.startsWith("label_mismatch:"));

describe("a photographed label and the medicine waiting for its label (no med_id)", () => {
  it("the label names the waiting medicine: it goes onto that medicine, linked to its visit as before", async () => {
    const { scope } = await account();
    const visit = await prescribedAmlodipine(scope);
    const r = await read(scope, "amlodipine");
    const out = await confirmLabel({ sessionId: scope.id, readToken: r.read_token, confirmed: ALL, origin: "prescription", locale: "zh-Hans" }, deps());
    expect(out.created).toBe(false);
    expect(await meds(scope)).toHaveLength(1);
    expect(out.med).toMatchObject({ id: "med-amlodipine", status: "label_confirmed", prescribed_visit_id: visit.id, dose_slots: ["morning"], dose_slots_source: "label" });
  });

  it("the label names another medicine: nothing is written and he is asked; 「是」 is the mismatch (the pharmacist question), 「不是」 saves it as its own medicine", async () => {
    const { a, scope } = await account();
    await prescribedAmlodipine(scope);
    const r = await read(scope, "losartan");
    const body = { read_token: r.read_token, confirmed: ALL, origin: "prescription", locale: "zh-Hans" };

    // the page was opened without ?med=: before round three this quietly became a second medicine
    const asked = await medsPost(req(a, "/api/meds", body));
    expect(asked.status).toBe(409);
    const which = (await asked.json()) as { error: string; detail: { waiting: { id: string; name: string; zh: string | null }[]; label_name: string } };
    expect(which.error).toBe("label_which");
    expect(which.detail.waiting).toEqual([{ id: "med-amlodipine", name: "Amlodipine", zh: "氨氯地平" }]);
    expect(which.detail.label_name).toMatch(/losartan/i);
    expect(await meds(scope)).toHaveLength(1);
    expect((await meds(scope))[0]).toMatchObject({ status: "awaiting_label", label: null });
    expect(await mismatchQuestions(scope)).toHaveLength(0); // no question until he says it is that medicine's label

    // 「是」: the label photographed for that medicine names another one
    const yes = await medsPost(req(a, "/api/meds", { read_token: r.read_token, confirmed: ALL, med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(yes.status).toBe(409);
    const mismatch = (await yes.json()) as { error: string; detail: { questions: { text: string; for: string }[] } };
    expect(mismatch.error).toBe("label_mismatch");
    expect(mismatch.detail.questions[0]).toMatchObject({ for: "pharmacist" });
    expect(mismatch.detail.questions[0].text).toContain("和医生开的（Amlodipine）不一样");
    expect(await meds(scope)).toHaveLength(1);
    expect(await mismatchQuestions(scope)).toHaveLength(1);

    // 「不是，是另一种药」: its own medicine; the prescribed one keeps waiting
    const no = await medsPost(req(a, "/api/meds", { ...body, other: true }));
    expect(no.status).toBe(201);
    const after = await meds(scope);
    expect(after).toHaveLength(2);
    expect(after.find((m) => m.drug_id === "losartan")).toMatchObject({ status: "label_confirmed", origin: "prescription", prescribed_visit_id: null });
    expect(after.find((m) => m.drug_id === "amlodipine")).toMatchObject({ status: "awaiting_label", label: null });
    expect(await mismatchQuestions(scope)).toHaveLength(1);
  });

  it("a box nobody identifies, said to be from the doctor while a prescription waits: he is asked; said to be from a relative: the usual fixed sentence, no question about the waiting one", async () => {
    const { scope } = await account();
    await prescribedAmlodipine(scope);
    const r = await read(scope, "relative_box");
    await expect(confirmLabel({ sessionId: scope.id, readToken: r.read_token, confirmed: ALL, origin: "prescription", locale: "zh-Hans" }, deps())).rejects.toMatchObject({
      code: "label_which",
      status: 409,
      detail: { waiting: [{ id: "med-amlodipine", name: "Amlodipine", zh: "氨氯地平" }] },
    });
    expect(await meds(scope)).toHaveLength(1);
    const out = await confirmLabel({ sessionId: scope.id, readToken: r.read_token, confirmed: ALL, origin: "relative", locale: "zh-Hans" }, deps());
    expect(out.outcome).toBe("unidentified");
    expect(out.answer?.route).toBe("unknown_med");
    expect(await meds(scope)).toHaveLength(2);
  });

  it("he said it is not from the doctor: another name is saved without a question; the waiting medicine's own name is asked about, and 「是」 puts it on that medicine", async () => {
    const { scope } = await account();
    const visit = await prescribedAmlodipine(scope);
    const ibu = await read(scope, "ibuprofen");
    const bought = await confirmLabel({ sessionId: scope.id, readToken: ibu.read_token, confirmed: ALL, origin: "self_bought", locale: "zh-Hans" }, deps());
    expect(bought.med).toMatchObject({ drug_id: "ibuprofen", origin: "self_bought", status: "label_confirmed" });

    const aml = await read(scope, "amlodipine");
    await expect(confirmLabel({ sessionId: scope.id, readToken: aml.read_token, confirmed: ALL, origin: "self_bought", locale: "zh-Hans" }, deps())).rejects.toMatchObject({
      code: "label_which",
      detail: { waiting: [{ id: "med-amlodipine" }] },
    });
    expect((await meds(scope)).filter((m) => m.drug_id === "amlodipine")).toHaveLength(1);
    const yes = await confirmLabel({ sessionId: scope.id, readToken: aml.read_token, confirmed: ALL, medId: "med-amlodipine", locale: "zh-Hans" }, deps());
    expect(yes.med).toMatchObject({ id: "med-amlodipine", origin: "prescription", status: "label_confirmed", prescribed_visit_id: visit.id });
    expect((await meds(scope)).filter((m) => m.drug_id === "amlodipine")).toHaveLength(1);
  });

  it("a medicine from the doctor he already has, photographed again while another one waits: that medicine again, no question", async () => {
    const { scope } = await account();
    // losartan first (nothing waits yet), then the visit prescribes amlodipine
    const first = await confirmLabel({ sessionId: scope.id, readToken: (await read(scope, "losartan")).read_token, confirmed: ALL, origin: "prescription", locale: "zh-Hans" }, deps());
    expect(first.created).toBe(true);
    await prescribedAmlodipine(scope);
    const again = await confirmLabel({ sessionId: scope.id, readToken: (await read(scope, "losartan")).read_token, confirmed: ALL, origin: "prescription", locale: "zh-Hans" }, deps());
    expect(again.created).toBe(false);
    expect(again.med.id).toBe(first.med.id);
    expect(await meds(scope)).toHaveLength(2);
  });
});

describe("a label he types in himself and the medicine waiting for its label (no med_id)", () => {
  it("the waiting medicine's own name goes onto it; another name asks; 「不是」 saves his own entry", async () => {
    const { a, scope } = await account();
    const visit = await prescribedAmlodipine(scope);

    const other = await manualPost(req(a, "/api/meds/manual", { name: "Losartan", origin: "prescription", slots: ["morning"], locale: "zh-Hans" }));
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: "label_which", detail: { waiting: [{ id: "med-amlodipine", name: "Amlodipine" }], label_name: "Losartan" } });
    expect(await meds(scope)).toHaveLength(1);

    const none = await manualPost(req(a, "/api/meds/manual", { name: "Losartan", origin: "prescription", slots: ["morning"], other: true, locale: "zh-Hans" }));
    expect(none.status).toBe(201);
    expect((await meds(scope)).find((m) => m.drug_id === "losartan")).toMatchObject({ status: "unverified", prescribed_visit_id: null });

    // before round three this answered 409 med_exists and the prescribed medicine kept waiting
    const same = await manualPost(req(a, "/api/meds/manual", { name: "Amlodipine", origin: "prescription", slots: ["morning"], strength: "5 mg", locale: "zh-Hans" }));
    expect(same.status).toBe(201);
    const after = await meds(scope);
    expect(after).toHaveLength(2);
    expect(after.find((m) => m.drug_id === "amlodipine")).toMatchObject({ id: "med-amlodipine", status: "unverified", prescribed_visit_id: visit.id, dose_slots: ["morning"], dose_slots_source: "patient" });
  });
});

describe("a demo session keeps its behaviour", () => {
  it("a label for another medicine without med_id is saved as before, with amlodipine waiting for a new label", async () => {
    const demo = await store.createSession({ story_day: 9, ttl_hours: 1 });
    const seeded = (await store.listMeds(demo.id)).find((m) => m.drug_id === "amlodipine")!;
    const waiting = await relabelMed({ sessionId: demo.id, medId: seeded.id }, deps());
    expect(waiting.status).toBe("awaiting_label");
    const p = `${blobPrefix(demo)}/labels/losartan-${randomUUID().slice(0, 8)}.png`;
    await blob.putObject("labels", p, new Uint8Array(readFileSync(path.join(FIXTURES, "labels", "losartan.png"))), "image/png");
    const r = await readLabel({ sessionId: demo.id, path: p }, deps());
    const out = await confirmLabel({ sessionId: demo.id, readToken: r.read_token, confirmed: ALL, origin: "prescription", locale: "en" }, deps());
    expect(out.created).toBe(true);
    expect(out.med.drug_id).toBe("losartan");
  });
});
