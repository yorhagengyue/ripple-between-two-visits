/**
 * His medicines on an account, the second round (C2 track F; real-app 2.2 step 7, 2.5 step 3, 2.16, 3.11):
 *   - without his consent to AI processing a label photo is handed to no reader (403 ai_off); he types the label's
 *     words himself, for a prescribed medicine onto that medicine; turning it on under 「我」 works from the next request;
 *   - the unknown-medicine answer passes his decision on to lib/safety's ask();
 *   - /p/meds/add opened from setting up his account goes back to setting up (an internal path only).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as readPost } from "@/app/api/labels/read/route";
import { GET as sampleGet } from "@/app/api/labels/sample/route";
import { POST as manualPost } from "@/app/api/meds/manual/route";
import { getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { addFlowTargets, internalNext, ONBOARD_RETURN } from "@/lib/meds/add-targets";
import { accountSamples } from "@/lib/meds/samples";
import { checkAskedTimes, slotTimeQuestions } from "@/lib/meds/slot-times";
import { REMINDER_SLOTS, SLOT_TIME_RANGE, slotTimeKnown, slotTimes } from "@/lib/profile/reminder-times";
import type { StoredLabel } from "@/lib/meds/types";
import { scopeSlotSchedule } from "@/lib/daily/cells";
import { addManualMed, confirmLabel, readLabel, type MedsDeps } from "@/lib/meds/write";
import { setAiConsent } from "@/lib/privacy/ai";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { readLabelText } from "@/lib/vision";
import { finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { newSession } from "../visit/helpers";
import { expectedLabel, FIXTURES, labelPng, type LabelName } from "./helpers";

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;
const saved = { ...process.env };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-meds2-"));
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

async function account(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `m2${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}

const aiOff = (a: TestAccount, scope: SessionRow) => setAiConsent({ store, texts: store }, { userId: a.userId, scopeId: scope.id, on: false, locale: "zh-Hans" });
const aiOn = (a: TestAccount, scope: SessionRow) => setAiConsent({ store, texts: store }, { userId: a.userId, scopeId: scope.id, on: true, locale: "zh-Hans" });

async function photo(scope: SessionRow, name: LabelName): Promise<string> {
  const p = `${blobPrefix(scope)}/labels/${name}-${randomUUID().slice(0, 8)}.png`;
  await blob.putObject("labels", p, labelPng(name), "image/png");
  return p;
}

/** A label reader that counts what it is handed: the model path of lib/vision with a stand-in model. */
async function countingReader(name: LabelName): Promise<{ calls: ChatOpts[]; deps: () => MedsDeps }> {
  const text = (await readLabelText({ bytes: labelPng(name), mime: "image/png" }, { env: { LLM_PROVIDER: "mock" } })).text;
  const expected = expectedLabel(name) as { drug_text: string; directions: string };
  const calls: ChatOpts[] = [];
  const llm = {
    provider: "fake",
    model: "fake-vision",
    async chat(opts: ChatOpts) {
      calls.push(opts);
      return opts.json ? { content: JSON.stringify({ medicine: expected.drug_text, directions: expected.directions, date: null, clinic: null }), tokens: 1 } : { content: text, tokens: 1 };
    },
  } as unknown as LlmClient;
  return { calls, deps: () => ({ store, blob, vision: { llm }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } }) };
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

describe("his consent to AI processing and the label photo", () => {
  it("on: the photo is read; off: it is handed to no reader (ai_off), nothing is written; on again under 「我」: the next request reads", async () => {
    const { a, scope } = await account();
    const reader = await countingReader("amlodipine");

    // on (the default of a new test account)
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, reader.deps());
    expect(read.fields.drug_id).toBe("amlodipine");
    expect(reader.calls.length).toBe(2); // the transcription and the independent field read
    expect(reader.calls.every((c) => (c.images ?? []).length === 1)).toBe(true);

    await aiOff(a, scope);
    const before = reader.calls.length;
    await expect(readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, reader.deps())).rejects.toMatchObject({ code: "ai_off", status: 403 });
    expect(reader.calls.length).toBe(before); // no reader saw the photo
    expect(await store.listMeds(scope.id)).toEqual([]);

    await aiOn(a, scope);
    const again = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, reader.deps());
    expect(again.fields.drug_id).toBe("amlodipine");
    expect(reader.calls.length).toBe(before + 2);
  });

  it("the route: 403 ai_off while it is off (the offline stand-in reader is not used either), 200 once it is on again", async () => {
    const { a, scope } = await account();
    const p = await photo(scope, "amlodipine");
    await aiOff(a, scope);
    const refused = await readPost(req(a, "/api/labels/read", { path: p }));
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("ai_off");
    await aiOn(a, scope);
    const ok = await readPost(req(a, "/api/labels/read", { path: p }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { fields: { drug_id: string } }).fields.drug_id).toBe("amlodipine");
  });

  it("a demo session keeps today's behaviour: its photos are read", async () => {
    const demo = await newSession();
    const reader = await countingReader("amlodipine");
    const p = `${blobPrefix(demo)}/labels/amlodipine-${randomUUID().slice(0, 8)}.png`;
    await blob.putObject("labels", p, labelPng("amlodipine"), "image/png");
    const read = await readLabel({ sessionId: demo.id, path: p }, reader.deps());
    expect(read.fields.drug_id).toBe("amlodipine");
    expect(reader.calls.length).toBe(2);
  });
});

describe("he types the label's words himself", () => {
  it("for a prescribed medicine awaiting its label: onto that medicine, his own entry, his slots, from now on", async () => {
    const { a, scope } = await account();
    const visit = await prescribedAmlodipine(scope);
    await aiOff(a, scope);
    const res = await manualPost(req(a, "/api/meds/manual", { name: "Amlodipine", origin: "prescription", slots: ["morning"], strength: "5 mg", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(res.status).toBe(201);
    const meds = await store.listMeds(scope.id);
    expect(meds).toHaveLength(1); // the same medicine, not a second row
    expect(meds[0]).toMatchObject({ id: "med-amlodipine", status: "unverified", drug_id: "amlodipine", prescribed_visit_id: visit.id, dose_slots: ["morning"], dose_slots_source: "patient", start_day: scope.story_day, start_at: "2026-10-12T02:00:00.000Z" });
    const label = meds[0].label as StoredLabel;
    expect(label).toMatchObject({ typed: true, read_by: "patient", drug_text: "Amlodipine", strength: "5 mg", directions: null, photo_path: null });
  });

  it("another name than the prescribed one writes nothing: his question for the pharmacist, once (409 label_mismatch)", async () => {
    const { a, scope } = await account();
    await prescribedAmlodipine(scope);
    await aiOff(a, scope);
    const body = { name: "Losartan", origin: "prescription", slots: ["morning"], med_id: "med-amlodipine", locale: "zh-Hans" };
    const res = await manualPost(req(a, "/api/meds/manual", body));
    expect(res.status).toBe(409);
    const out = (await res.json()) as { error: string; detail: { questions: { text: string }[] } };
    expect(out.error).toBe("label_mismatch");
    expect(out.detail.questions[0].text).toBe("药袋上的名字（Losartan）和医生开的（Amlodipine）不一样，是同一种药吗？");
    expect((await manualPost(req(a, "/api/meds/manual", body))).status).toBe(409);
    const meds = await store.listMeds(scope.id);
    expect(meds).toHaveLength(1);
    expect(meds[0]).toMatchObject({ status: "awaiting_label", label: null });
    expect((await store.listQuestions(scope.id)).filter((q) => q.evidence === "label_mismatch:med-amlodipine")).toHaveLength(1);
    // a medicine that is not his: 404
    await expect(addManualMed({ sessionId: scope.id, name: "Amlodipine", origin: "prescription", slots: [], medId: "med-nope", locale: "zh-Hans" }, { store })).rejects.toMatchObject({ code: "med_not_found" });
  });
});

describe("an unknown medicine's answer and his consent", () => {
  it("off: the ask is answered without any model (noAiConsent), the same fixed sentence; on: as before", async () => {
    const { a, scope } = await account();
    const deps = (): MedsDeps => ({ store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } });
    // read while it is on, confirmed after he turned it off
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "relative_box") }, deps());
    await aiOff(a, scope);
    const off = await confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: ["drug_text", "strength", "directions", "dispensed", "clinic"], origin: "relative", locale: "zh-Hans" }, deps());
    expect(off.outcome).toBe("unidentified");
    expect(off.answer).toMatchObject({ route: "unknown_med", noAiConsent: true });
    expect(off.answer?.fixedText).toBeTruthy();
    expect(off.questions).toHaveLength(1);

    const other = await account();
    const read2 = await readLabel({ sessionId: other.scope.id, path: await photo(other.scope, "relative_box") }, deps());
    const on = await confirmLabel({ sessionId: other.scope.id, readToken: read2.read_token, confirmed: ["drug_text", "strength", "directions", "dispensed", "clinic"], origin: "relative", locale: "zh-Hans" }, deps());
    expect(on.answer?.route).toBe("unknown_med");
    expect(on.answer?.noAiConsent).toBeUndefined();
    expect(on.answer?.fixedText).toBe(off.answer?.fixedText);
  });
});

describe("the example's own sample label: losartan (real-app 4.6)", () => {
  const sample = (name: string, token?: string) => new NextRequest(`http://localhost/api/labels/sample?name=${name}`, { headers: token ? { cookie: `rp_at=${token}` } : {} });

  it("offered to the example account only: a blank account 403, the demo's list stays at three", async () => {
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const example = await createAccountWithSpace(store, getAuthProvider(), { login: `m2${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const blank = await account();
    expect((await sampleGet(sample("losartan", example.tokens.access_token))).status).toBe(200);
    expect((await sampleGet(sample("losartan", blank.a.tokens.access_token))).status).toBe(403);
    expect((await sampleGet(sample("losartan"))).status).toBe(404);
    expect((await sampleGet(sample("amlodipine"))).status).toBe(200);
    expect(accountSamples("losartan")[0]).toBe("losartan");
    expect(accountSamples(null)).toEqual(["amlodipine", "ibuprofen", "relative_box", "losartan"]);
  });

  it("after the sample visit prescribes losartan, the sample label confirms that medicine: the label's own words set the morning slot", async () => {
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const example = await createAccountWithSpace(store, getAuthProvider(), { login: `m2${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const scope = (await store.getSession(example.scope!.id))!;
    const visit = await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
    const item = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.type === "medication" && i.slots?.drug === "losartan")!;
    await setItemVerdict(store, scope, visit.id, { items: [item.id], verdict: "right" });
    const awaiting = (await store.listMeds(scope.id)).find((m) => m.drug_id === "losartan")!;
    expect(awaiting).toMatchObject({ status: "awaiting_label", prescribed_visit_id: visit.id });

    const p = `${blobPrefix(scope)}/labels/losartan-${randomUUID().slice(0, 8)}.png`;
    await blob.putObject("labels", p, new Uint8Array(readFileSync(path.join(FIXTURES, "labels", "losartan.png"))), "image/png");
    const deps: MedsDeps = { store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } };
    const read = await readLabel({ sessionId: scope.id, path: p }, deps);
    expect(read.fields).toMatchObject({ drug_id: "losartan", strength: "50 mg" });
    const out = await confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: ["drug_text", "strength", "directions", "dispensed", "clinic"], medId: awaiting.id, locale: "zh-Hans" }, deps);
    expect(out.med).toMatchObject({ id: awaiting.id, status: "label_confirmed", dose_slots: ["morning"], dose_slots_source: "label" });
  });
});

describe("a slot's reminder time, asked once (real-app 2.16)", () => {
  it("中午 / 晚上 / 睡前 are asked when nothing says their time; his answer is his setting from then on and is never asked again", async () => {
    const { scope } = await account();
    const q = slotTimeQuestions(scope, "zh-Hans");
    expect(q.map((x) => x.slot)).toEqual(["midday", "evening", "night"]);
    expect(q.map((x) => x.now)).toEqual(["12:45", "18:45", "21:30"]);
    // one implementation (track C's lib/profile/reminder-times.ts): which parts are asked, the time now, the range and the words
    expect(q.map((x) => x.slot)).toEqual(REMINDER_SLOTS.filter((s) => s !== "morning" && !slotTimeKnown(scope, s)));
    expect(q.map((x) => x.now)).toEqual(slotTimes(scope).filter((t) => t.slot !== "morning").map((t) => t.first));
    expect(q[1]).toMatchObject({ range: SLOT_TIME_RANGE.evening, title: ["晚间药物，", "几点提醒你？"] });
    expect(q[1].rangeWords).toContain("之间");
    expect(slotTimeQuestions(scope, "en")[0].title.join(" ")).toContain("Midday medicine");

    // a medicine he takes in the evening: only the slot it uses is kept (a time for another slot is dropped)
    await addManualMed({ sessionId: scope.id, name: "Panadol", origin: "self_bought", slots: ["evening"], times: { evening: "19:15", night: "22:00" }, locale: "zh-Hans" }, { store });
    let now = (await store.getSession(scope.id))!;
    expect(now.settings.reminder_times).toEqual({ evening: "19:15" });
    expect(scopeSlotSchedule(now, "evening")).toMatchObject({ first: "19:15", second: "19:45" });
    expect(slotTimeQuestions(now, "zh-Hans").map((x) => x.slot)).toEqual(["midday", "night"]);

    // asked once: a later request cannot change the evening time; a new slot is added next to it
    await addManualMed({ sessionId: scope.id, name: "Vitamin C", origin: "supplement", slots: ["evening", "night"], times: { evening: "20:00", night: "21:00" }, locale: "zh-Hans" }, { store });
    now = (await store.getSession(scope.id))!;
    expect(now.settings.reminder_times).toEqual({ evening: "19:15", night: "21:00" });
    expect(slotTimeQuestions(now, "zh-Hans").map((x) => x.slot)).toEqual(["midday"]);
  });

  it("a slot his routine already says (dinner at 18:00) is not asked, and a time sent for it changes nothing", async () => {
    const { scope } = await account();
    const withDinner = await store.updateScope(scope.id, { settings: { routine: [{ label: "Dinner", label_zh: "晚饭", days: "daily", time: "18:00" }] } });
    expect(slotTimeQuestions(withDinner, "zh-Hans").map((x) => x.slot)).toEqual(["midday", "night"]);
    await addManualMed({ sessionId: scope.id, name: "Panadol", origin: "self_bought", slots: ["evening"], times: { evening: "20:00" }, locale: "zh-Hans" }, { store });
    const now = (await store.getSession(scope.id))!;
    expect(now.settings.reminder_times).toBeUndefined();
    expect(scopeSlotSchedule(now, "evening").first).toBe("18:15");
  });

  it("with a label photo: the slot he chose gets its time in the same confirmation; a malformed time is refused by the route", async () => {
    const { a, scope } = await account();
    const deps: MedsDeps = { store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } };
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps);
    const out = await confirmLabel(
      { sessionId: scope.id, readToken: read.read_token, confirmed: ["drug_text", "strength", "dispensed", "clinic"], edits: { directions: "一天一粒" }, slots: ["night"], times: { night: "21:00" }, origin: "prescription", locale: "zh-Hans" },
      deps,
    );
    expect(out.med).toMatchObject({ dose_slots: ["night"], dose_slots_source: "patient" });
    expect((await store.getSession(scope.id))!.settings.reminder_times).toEqual({ night: "21:00" });
    // only the parts this medicine uses are looked at; "8:05"-style input is cleaned by track C's rule
    expect(checkAskedTimes({ evening: "25:00", midday: "12:30" }, ["midday", "night"])).toEqual({ midday: "12:30" });
    expect(() => checkAskedTimes({ night: "9pm" }, ["night"])).toThrow(/time_invalid/);
    const bad = await manualPost(req(a, "/api/meds/manual", { name: "Panadol", origin: "self_bought", slots: ["evening"], times: { evening: "7pm" }, locale: "zh-Hans" }));
    expect(bad.status).toBe(400);
  });

  it("a time outside its part of the day (「别的时间」) is refused before anything is written: 400 bad_time with the part and its range", async () => {
    const { a, scope } = await account();
    // the night's reminder takes 19:00-22:55 (track C's range): 23:30 would run past midnight
    expect(() => checkAskedTimes({ night: "23:30" }, ["night"])).toThrow(expect.objectContaining({ code: "bad_time", status: 400 }));
    const res = await manualPost(req(a, "/api/meds/manual", { name: "Panadol", origin: "self_bought", slots: ["night"], times: { night: "23:30" }, locale: "zh-Hans" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_time", detail: { slot: "night", code: "time_out_of_range", ...SLOT_TIME_RANGE.night } });
    expect(await store.listMeds(scope.id)).toEqual([]);
    expect((await store.getSession(scope.id))!.settings.reminder_times).toBeUndefined();
    // with a label photo too: nothing is written
    const deps: MedsDeps = { store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } };
    const read = await readLabel({ sessionId: scope.id, path: await photo(scope, "amlodipine") }, deps);
    await expect(
      confirmLabel({ sessionId: scope.id, readToken: read.read_token, confirmed: ["drug_text", "strength", "dispensed", "clinic"], edits: { directions: "一天一粒" }, slots: ["midday"], times: { midday: "16:00" }, origin: "prescription", locale: "zh-Hans" }, deps),
    ).rejects.toMatchObject({ code: "bad_time" });
    expect(await store.listMeds(scope.id)).toEqual([]);
    // the label's own time words come back with the read, exactly what confirming will set
    expect(read.dose_slots).toEqual(["morning"]);
  });
});

describe("/p/meds/add opened from setting up his account", () => {
  it("?from=onboard: 「以后再说」 and the way on after adding both go on with setting up; afterwards it behaves as from his medicines", () => {
    expect(addFlowTargets({ next: null, fromOnboard: true, onboarding: "started" })).toEqual({ laterHref: ONBOARD_RETURN, returnHref: ONBOARD_RETURN });
    expect(ONBOARD_RETURN).toBe("/onboard");
    expect(addFlowTargets({ next: null, fromOnboard: true, onboarding: null })).toEqual({ laterHref: "/onboard", returnHref: "/onboard" });
    expect(addFlowTargets({ next: null, fromOnboard: true, onboarding: "done" })).toEqual({ laterHref: "/p/meds", returnHref: null });
    expect(addFlowTargets({ next: null, fromOnboard: false, onboarding: "started" })).toEqual({ laterHref: "/p/meds", returnHref: null });
    // from=onboard wins over a ?next= given with it
    expect(addFlowTargets({ next: "/p/today", fromOnboard: true, onboarding: "started" }).laterHref).toBe("/onboard");
  });

  it("?next= accepts an internal path only", () => {
    expect(internalNext("/onboard/age")).toBe("/onboard/age");
    expect(internalNext("/p/today")).toBe("/p/today");
    expect(addFlowTargets({ next: "/onboard/age", fromOnboard: false, onboarding: "started" })).toEqual({ laterHref: "/onboard/age", returnHref: null });
    for (const bad of ["https://evil.example/p/today", "//evil.example", "/p//evil.example", "/f", "/p/today?x=1", "/onboard/../admin", "javascript:alert(1)", "/p/today#x", "", null, undefined]) {
      expect(internalNext(bad as string | null), String(bad)).toBeNull();
      expect(addFlowTargets({ next: bad as string | null, fromOnboard: false, onboarding: "started" }).laterHref).toBe("/p/meds");
    }
  });
});
