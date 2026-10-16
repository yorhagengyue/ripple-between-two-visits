/**
 * An account's visit (C2 track F; real-app 2.12-2.15, 12): the recording's row and consent record, the doctor's "no",
 * one answer at a time in the review (right / not right / not sure), "not right" flags and asks instead of deleting, the
 * warning line stays on the emergency path, confirmed prescriptions and follow-ups go on his list, edits keep their
 * history, and a replay of a visit he already confirmed goes to a copy.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { CONSENT_CARD_VERSION } from "@/lib/visit/consent";
import { doctorNumbers } from "@/lib/visit/doctor-numbers";
import { isReplayCopy } from "@/lib/visit/happened";
import { confirmVisit, consentCardSha, declineRecording, finalizeVisit, processChunk, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { verdictHistory } from "@/lib/visit/verdict";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterEach(() => setTestClock(null));

async function account(space: "blank" | "example" = "blank", settings?: { clinic?: string }): Promise<{ scope: SessionRow; userId: string }> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `av${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  let scope = a.scope!;
  if (settings) scope = await store.updateScope(scope.id, { settings });
  return { scope, userId: a.userId };
}

/** The whole-visit record of a fixture (what devfake or Whisper hand back), on a recorded visit. */
async function record(scope: SessionRow, fixture: string, place?: "clinic" | "pharmacy"): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true }, place });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${fixture}`, lang: "zh-en-mixed", fixture });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  return (await store.getVisit(scope.id, visit.id))!;
}

const items = async (scope: SessionRow, visitId: string) => (await store.listVisitItems(scope.id, { visit_id: visitId })).filter((i) => i.slots?.superseded !== true);
const one = async (scope: SessionRow, visitId: string, pred: (i: VisitItemRow) => boolean) => (await items(scope, visitId)).find(pred)!;

describe("starting an account's visit", () => {
  it("a new row with a full uuid at his clinic, kept 90 days, and the doctor's yes as a consent record with the card's hash and the wall clock", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { scope, userId } = await account("blank", { clinic: "Blossom Family Clinic (fictional)" });
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true, at: "1999-01-01T00:00:00.000Z" } });
    expect(visit.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(visit).toMatchObject({ kind: "clinic", place: "Blossom Family Clinic (fictional)", status: "recording", date: "2026-10-12", retain_until: "2027-01-10", keep_forever: false });
    const consentItem = await one(scope, visit.id, (i) => i.type === "consent");
    expect(consentItem.slots).toMatchObject({ variant: "screen", at: "2026-10-12T01:30:00.000Z", card_version: CONSENT_CARD_VERSION });
    const records = await store.listConsentRecords(userId, { kind: "visit_recording" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ decision: "granted", version: CONSENT_CARD_VERSION, text_sha256: consentCardSha(), method: "tap", scope_id: scope.id });
    expect(consentCardSha()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("at the pharmacy: a pharmacy visit; a second recording the same day is another row", async () => {
    const { scope } = await account();
    const a = await startVisit(store, scope, { mode: "record", consent: { given: true }, place: "pharmacy" });
    expect(a).toMatchObject({ kind: "pharmacy", place: "Pharmacy" });
    const b = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    expect(b.id).not.toBe(a.id);
    expect(b).toMatchObject({ kind: "clinic", place: "Clinic" });
  });

  it("records on today's planned follow-up he confirmed, never on the example's sample visit", async () => {
    const { scope } = await account();
    const planned = await store.upsertVisit(scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Blossom", day: scope.story_day, status: "planned" });
    const v = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    expect(v.id).toBe(planned.id);
    const ex = await account("example");
    const recorded = await startVisit(store, ex.scope, { mode: "record", consent: { given: true } });
    expect(recorded.id).not.toBe("v3");
    expect((await store.getVisit(ex.scope.id, "v3"))?.status).toBe("planned");
  });

  it("the doctor says no: nothing starts; the account keeps the decision", async () => {
    const { scope, userId } = await account();
    await declineRecording(store, scope, { place: "clinic" });
    expect(await store.listVisits(scope.id)).toEqual([]);
    const records = await store.listConsentRecords(userId, { kind: "visit_recording" });
    expect(records.map((r) => r.decision)).toEqual(["declined"]);
  });
});

describe("the review, one line at a time", () => {
  it("right confirms the line; the target and the warning line become his doctor's numbers", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v1");
    const target = await one(scope, visit.id, (i) => i.type === "target");
    const view = await setItemVerdict(store, scope, visit.id, { items: [target.id], verdict: "right" });
    expect(view.lines.find((l) => l.id === target.utterance_ids[0])).toMatchObject({ role: "doctor", roleState: "confirmed", display: "confirmed" });
    expect((await doctorNumbers(store, scope.id)).target).toMatchObject({ systolic: 135, diastolic: 85 });
    expect((await store.getVisit(scope.id, visit.id))?.status).toBe("review");
  });

  it("not right on the warning line: kept, flagged, still on the emergency path, one question for the doctor", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v1");
    const threshold = await one(scope, visit.id, (i) => i.type === "threshold");
    let view = await setItemVerdict(store, scope, visit.id, { items: [threshold.id], verdict: "wrong" });
    view = await setItemVerdict(store, scope, visit.id, { items: [threshold.id], verdict: "wrong" });
    const card = view.cards.find((c) => c.kind === "doc" && c.rows.some((r) => r.itemId === threshold.id));
    expect(card).toMatchObject({ disputed: true });
    const after = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.id === threshold.id)!;
    expect(after.slots).toMatchObject({ disputed: true, rejected: false, verdict: "wrong" });
    const n = await doctorNumbers(store, scope.id);
    expect(n.threshold).toBeNull();
    expect(n.emergency).toMatchObject({ disputed: true, systolic: 180 });
    const qs = (await store.listQuestions(scope.id)).filter((q) => q.evidence?.startsWith("visit_disputed:"));
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ for: "doctor", status: "open" });
    expect(qs[0].text).toContain("call 995");
  });

  it("not right on another line leaves the sources (rejected) but stays on the screen; unsure changes nothing", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v1");
    const lifestyle = await one(scope, visit.id, (i) => i.type === "lifestyle");
    const followUp = await one(scope, visit.id, (i) => i.type === "follow_up");
    await setItemVerdict(store, scope, visit.id, { items: [lifestyle.id], verdict: "wrong" });
    const view = await setItemVerdict(store, scope, visit.id, { items: [followUp.id], verdict: "unsure" });
    const row = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.id === lifestyle.id)!;
    expect(row.slots).toMatchObject({ disputed: true, rejected: true });
    expect(view.cards.some((c) => c.kind === "doc" && c.rows.some((r) => r.itemId === lifestyle.id && r.disputed))).toBe(true);
    const fu = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.id === followUp.id)!;
    expect(fu.confirmed_by).toBeNull();
    expect(view.lines.find((l) => l.id === followUp.utterance_ids[0])?.roleState).toBe("inferred");
  });

  it("a confirmed prescription goes on his list awaiting its label, linked to the visit; a confirmed follow-up is a planned visit", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v2");
    const med = await one(scope, visit.id, (i) => i.type === "medication");
    const followUp = await one(scope, visit.id, (i) => i.type === "follow_up");
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
    await setItemVerdict(store, scope, visit.id, { items: [followUp.id], verdict: "right" });
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
    const meds = await store.listMeds(scope.id);
    expect(meds).toHaveLength(1);
    expect(meds[0]).toMatchObject({ id: "med-amlodipine", drug_id: "amlodipine", origin: "prescription", status: "awaiting_label", prescribed_visit_id: visit.id, label: null });
    const planned = (await store.listVisits(scope.id)).filter((v) => v.status === "planned");
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ kind: "follow_up", day: visit.day + 35 });
  });

  it("after confirming he can change an answer: the history keeps it, a question it took back is skipped", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v1");
    const target = await one(scope, visit.id, (i) => i.type === "target");
    await confirmVisit(store, scope, visit.id, { mine: [], items: { [target.id]: "right" } });
    expect((await store.getVisit(scope.id, visit.id))?.status).toBe("confirmed");
    await setItemVerdict(store, scope, visit.id, { items: [target.id], verdict: "wrong" });
    let row = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.id === target.id)!;
    expect(verdictHistory(row).map((h) => [h.from, h.to])).toEqual([["right", "wrong"]]);
    expect((await doctorNumbers(store, scope.id)).target).toBeNull();
    const q = (await store.listQuestions(scope.id)).find((x) => x.evidence?.startsWith("visit_disputed:"))!;
    expect(q.status).toBe("open");
    await setItemVerdict(store, scope, visit.id, { items: [target.id], verdict: "right" });
    row = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.id === target.id)!;
    expect(verdictHistory(row).map((h) => [h.from, h.to])).toEqual([["right", "wrong"], ["wrong", "right"]]);
    expect((await store.getQuestion(scope.id, q.id))?.status).toBe("skipped");
    expect((await doctorNumbers(store, scope.id)).target).toMatchObject({ systolic: 135 });
  });

  it("a visit still recording has nothing to check", async () => {
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await expect(setItemVerdict(store, scope, visit.id, { items: ["x"], verdict: "right" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("a replay never takes back what he confirmed", () => {
  it("the example's sample visit played again after he confirmed it goes to a copy; his labels stay 医生说", async () => {
    const { scope } = await account("example");
    const lines = fixtureUtterances("v3")!;
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    await processChunk(store, scope, "v3", lines);
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
    const medItems = (await items(scope, "v3")).filter((i) => i.utterance_ids.includes("v3-u07"));
    await confirmVisit(store, scope, "v3", { mine: [], items: Object.fromEntries(medItems.map((i) => [i.id, "right" as const])) });
    expect((await store.listUtterances(scope.id, "v3")).find((u) => u.id === "v3-u07")?.role_state).toBe("confirmed");
    // losartan, prescribed at the sample visit, is on his list awaiting its label
    expect((await store.listMeds(scope.id)).find((m) => m.drug_id === "losartan")).toMatchObject({ status: "awaiting_label", prescribed_visit_id: "v3" });

    const again = await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    expect(again.id).not.toBe("v3");
    expect(isReplayCopy(again)).toBe(true);
    await processChunk(store, scope, again.id, lines.slice(0, 8));
    expect((await store.listUtterances(scope.id, "v3")).find((u) => u.id === "v3-u07")?.role_state).toBe("confirmed");
    expect((await store.getVisit(scope.id, "v3"))?.status).toBe("confirmed");
    // the copy never adds a second medicine
    expect((await store.listMeds(scope.id)).filter((m) => m.drug_id === "losartan")).toHaveLength(1);
  });
});
