/**
 * An account's visit review, the third round (C2 track F; real-app 2.15, 12 「确认后还能改，改动留历史」):
 *   - how a visit's record was made is kept with the visit (visit.ai_used): the review's sentence about AI processing
 *     describes that visit, whatever his setting is today;
 *   - an answer changed away from 「是」 takes back the prescription that still waits for its label and the follow-up
 *     that is still only planned; what was taken back is in the item's history; 「是」 again puts it back; a medicine
 *     whose label he confirmed and a follow-up on a day he booked stay;
 *   - 「哪几句是我说的」: a line whose speaker nobody could tell is marked as his own, or given back (POST
 *     /api/visits/[id]/mine); a line he said is the clinician's is not his to take;
 *   - the follow-up planned from the visit is on the review with its day.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as minePost } from "@/app/api/visits/[id]/mine/route";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus } from "@/lib/bus";
import { setAiConsent } from "@/lib/privacy/ai";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { confirmVisit, finalizeVisit, rescheduleFollowUp, setItemVerdict, setLineMine, startVisit } from "@/lib/visit/pipeline";
import { buildVisitView } from "@/lib/visit/view";
import { newSession } from "./helpers";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterEach(() => setTestClock(null));

async function account(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `r3${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}

async function record(scope: SessionRow, fixture: string): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${fixture}`, lang: "zh-en-mixed", fixture });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  return (await store.getVisit(scope.id, visit.id))!;
}

const items = async (scope: SessionRow, visitId: string) => (await store.listVisitItems(scope.id, { visit_id: visitId })).filter((i) => i.slots?.superseded !== true);
const one = async (scope: SessionRow, visitId: string, pred: (i: VisitItemRow) => boolean) => (await items(scope, visitId)).find(pred)!;
const item = async (scope: SessionRow, visitId: string, id: string) => (await items(scope, visitId)).find((i) => i.id === id)!;
const history = (it: VisitItemRow) => (it.slots.history ?? []) as { from: string; to: string; undone?: unknown[] }[];
const ai = (a: TestAccount, scope: SessionRow, on: boolean) => setAiConsent({ store, texts: store }, { userId: a.userId, scopeId: scope.id, on, locale: "zh-Hans" });
const acct = async (scope: SessionRow, visitId: string) => (await buildVisitView(store, scope.id, visitId, { session: scope }))!.account!;

describe("how the visit's record was made is kept with the visit", () => {
  it("made with AI on: ai_used true; he turns AI off later: the review says nothing about this visit (only his setting now is off)", async () => {
    const { a, scope } = await account();
    const visit = await record(scope, "v1");
    expect(visit.ai_used).toBe(true);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: false, aiOffFrom: "record", aiOffNow: false });
    await ai(a, scope, false);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: false, aiOffFrom: "record", aiOffNow: true });
  });

  it("made with AI off: ai_used false; he turns AI on later: the review still says this visit was made by the rules only", async () => {
    const { a, scope } = await account();
    await ai(a, scope, false);
    const visit = await record(scope, "v1");
    expect(visit.ai_used).toBe(false);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: true, aiOffFrom: "record", aiOffNow: true });
    await ai(a, scope, true);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: true, aiOffFrom: "record", aiOffNow: false });
    // the next visit is made with AI on
    const next = await record(scope, "v2");
    expect(next.ai_used).toBe(true);
    expect(await acct(scope, next.id)).toMatchObject({ aiOff: false, aiOffNow: false });
  });

  it("a visit that does not say (made before this was kept, or its record not made yet): his setting as it is now; the demo never has it", async () => {
    const { a, scope } = await account();
    const visit = await record(scope, "v1");
    await store.updateVisit(scope.id, visit.id, { ai_used: null });
    expect("ai_used" in (await store.getVisit(scope.id, visit.id))!).toBe(false);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: false, aiOffFrom: "setting" });
    await ai(a, scope, false);
    expect(await acct(scope, visit.id)).toMatchObject({ aiOff: true, aiOffFrom: "setting", aiOffNow: true });
    // waiting for its transcript: no record yet, so his setting now
    const waiting = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await store.updateVisit(scope.id, waiting.id, { status: "awaiting_transcript" });
    expect(await acct(scope, waiting.id)).toMatchObject({ aiOff: true, aiOffFrom: "setting" });

    const demo = await newSession({ story_day: 0 });
    const v1 = await startVisit(store, demo, { mode: "replay", fixture: "v1" });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
    await finalizeVisit(store, demo, v1.id, await speech.getFileJob(jobId));
    expect("ai_used" in (await store.getVisit(demo.id, v1.id))!).toBe(false);
  });
});

describe("an answer changed away from 是 takes back what it created", () => {
  it("the prescription that still waits for its label leaves his list; the history says so; 是 again puts it back", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v2");
    const med = await one(scope, visit.id, (i) => i.type === "medication" && i.slots?.drug === "amlodipine");
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
    expect((await store.listMeds(scope.id)).map((m) => [m.id, m.status])).toEqual([["med-amlodipine", "awaiting_label"]]);

    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "wrong" });
    expect(await store.listMeds(scope.id)).toEqual([]);
    let row = await item(scope, visit.id, med.id);
    expect(history(row)).toEqual([expect.objectContaining({ from: "right", to: "wrong", undone: [{ med: "med-amlodipine" }] })]);
    // the line stays on the screen, flagged, with his question for the doctor
    expect(row.slots).toMatchObject({ disputed: true });
    expect((await store.listQuestions(scope.id)).some((q) => q.evidence?.startsWith("visit_disputed:") && q.status === "open")).toBe(true);
    const events = getBus().recent(scope.id);
    expect(events.filter((e) => e.type === "med.changed" && (e.data as { kind?: string }).kind === "prescription_withdrawn")).toHaveLength(1);

    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
    expect((await store.listMeds(scope.id))[0]).toMatchObject({ id: "med-amlodipine", status: "awaiting_label", prescribed_visit_id: visit.id, label: null });
    row = await item(scope, visit.id, med.id);
    expect(history(row).map((h) => [h.from, h.to])).toEqual([["right", "wrong"], ["wrong", "right"]]);
  });

  it("不记得 takes it back too; after he confirmed the visit it is the same (an edit, kept in the history)", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v2");
    const med = await one(scope, visit.id, (i) => i.type === "medication" && i.slots?.drug === "amlodipine");
    await confirmVisit(store, scope, visit.id, { mine: [], items: { [med.id]: "right" } });
    expect(await store.listMeds(scope.id)).toHaveLength(1);
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "unsure" });
    expect(await store.listMeds(scope.id)).toEqual([]);
    expect(history(await item(scope, visit.id, med.id))).toEqual([expect.objectContaining({ from: "right", to: "unsure", undone: [{ med: "med-amlodipine" }] })]);
  });

  it("a medicine whose label he already confirmed is his by the label and stays", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v2");
    const med = await one(scope, visit.id, (i) => i.type === "medication" && i.slots?.drug === "amlodipine");
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
    await store.updateMed(scope.id, "med-amlodipine", { status: "label_confirmed", label: { text: "Amlodipine 5 mg" }, start_day: scope.story_day });
    await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "wrong" });
    expect((await store.listMeds(scope.id)).map((m) => [m.id, m.status])).toEqual([["med-amlodipine", "label_confirmed"]]);
    expect(history(await item(scope, visit.id, med.id))[0].undone).toBeUndefined();
  });

  it("a medicine another visit put on his list is not touched", async () => {
    const { scope } = await account();
    const first = await record(scope, "v2");
    const med1 = await one(scope, first.id, (i) => i.type === "medication" && i.slots?.drug === "amlodipine");
    await setItemVerdict(store, scope, first.id, { items: [med1.id], verdict: "right" });
    const second = await record(scope, "v2");
    const med2 = await one(scope, second.id, (i) => i.type === "medication" && i.slots?.drug === "amlodipine");
    await setItemVerdict(store, scope, second.id, { items: [med2.id], verdict: "right" });
    await setItemVerdict(store, scope, second.id, { items: [med2.id], verdict: "wrong" });
    expect((await store.listMeds(scope.id))[0]).toMatchObject({ id: "med-amlodipine", prescribed_visit_id: first.id, status: "awaiting_label" });
  });

  it("the follow-up that is still only planned is no longer planned; one on a day he booked himself stays", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v2");
    const fu = await one(scope, visit.id, (i) => i.type === "follow_up");
    await setItemVerdict(store, scope, visit.id, { items: [fu.id], verdict: "right" });
    const planned = (await store.listVisits(scope.id)).find((v) => v.status === "planned")!;
    expect(planned.id).toBe(`${fu.id}-planned`);
    expect(await acct(scope, visit.id)).toMatchObject({ followUp: { id: planned.id, date: planned.date, approx: true } });

    await setItemVerdict(store, scope, visit.id, { items: [fu.id], verdict: "wrong" });
    expect((await store.listVisits(scope.id)).filter((v) => v.status === "planned")).toEqual([]);
    expect(history(await item(scope, visit.id, fu.id))).toEqual([expect.objectContaining({ from: "right", to: "wrong", undone: [{ visit: planned.id }] })]);
    expect((await acct(scope, visit.id)).followUp).toBeNull();
    expect(getBus().recent(scope.id).filter((e) => e.type === "visit.changed" && (e.data as { withdrawn?: boolean }).withdrawn === true)).toHaveLength(1);

    // 是 again: planned again; he sets the day he booked; then 不是: his own day stays
    await setItemVerdict(store, scope, visit.id, { items: [fu.id], verdict: "right" });
    const again = (await store.listVisits(scope.id)).find((v) => v.status === "planned")!;
    const booked = await rescheduleFollowUp(store, scope, again.id, "2026-11-20");
    expect(booked.approx).toBe(false);
    expect(await acct(scope, visit.id)).toMatchObject({ followUp: { id: again.id, date: "2026-11-20", approx: false } });
    await setItemVerdict(store, scope, visit.id, { items: [fu.id], verdict: "wrong" });
    expect((await store.listVisits(scope.id)).filter((v) => v.status === "planned").map((v) => v.date)).toEqual(["2026-11-20"]);
  });

  it("the demo keeps its seed: 不对 on a prescription line removes nothing", async () => {
    const demo = await newSession({ story_day: 8 });
    const v2 = await startVisit(store, demo, { mode: "replay", fixture: "v2" });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
    await finalizeVisit(store, demo, v2.id, await speech.getFileJob(jobId));
    const before = (await store.listMeds(demo.id)).map((m) => m.id);
    const med = (await store.listVisitItems(demo.id, { visit_id: v2.id })).find((i) => i.type === "medication" && i.slots?.superseded !== true)!;
    await setItemVerdict(store, demo, v2.id, { items: [med.id], verdict: "right" });
    await setItemVerdict(store, demo, v2.id, { items: [med.id], verdict: "wrong" });
    expect((await store.listMeds(demo.id)).map((m) => m.id)).toEqual(before);
  });
});

describe("「哪几句是我说的」: a line whose speaker nobody could tell", () => {
  /** A record whose lines come without speakers (the whole-visit transcript of a service that could not tell them apart). */
  async function recordWithoutSpeakers(scope: SessionRow): Promise<VisitRow> {
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const lines = fixtureUtterances("v1")!.map((u) => ({ tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: null, text: u.text }));
    // the sample visit's own lines are all guessed now from their order and form (lib/visit/roles.ts
    // turnsWithoutSpeakers); a last line that answers no question and has nobody's cue is still nobody's
    lines.push({ tStartMs: 82_000, tEndMs: 84_000, speaker: null, text: "Okay, I will write that down." });
    await finalizeVisit(store, scope, visit.id, { status: "done", source: "audio", utterances: lines });
    return (await store.getVisit(scope.id, visit.id))!;
  }

  it("marked as his own it is his (patient, confirmed); given back it is unknown again; saved as he taps, before and after he confirmed", async () => {
    const { a, scope } = await account();
    const visit = await recordWithoutSpeakers(scope);
    const view = (await buildVisitView(store, scope.id, visit.id, { session: scope }))!;
    const unknown = view.lines.filter((l) => l.roleState === "unknown");
    expect(unknown.length).toBeGreaterThan(0);
    const line = unknown[0];

    const mine = await setLineMine(store, scope, visit.id, { line: line.id, mine: true });
    expect(mine.lines.find((l) => l.id === line.id)).toMatchObject({ role: "patient", roleState: "confirmed" });
    const back = await setLineMine(store, scope, visit.id, { line: line.id, mine: false });
    expect(back.lines.find((l) => l.id === line.id)).toMatchObject({ role: "unknown", roleState: "unknown" });

    // the route, and after he confirmed
    const post = (body: unknown) =>
      minePost(new NextRequest(`http://localhost/api/visits/${visit.id}/mine`, { method: "POST", headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), {
        params: Promise.resolve({ id: visit.id }),
      });
    await confirmVisit(store, scope, visit.id, { mine: [], items: {} });
    const res = await post({ line: line.id, mine: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { view: { lines: { id: string; role: string; roleState: string }[] } }).view.lines.find((l) => l.id === line.id)).toMatchObject({ role: "patient", roleState: "confirmed" });
    expect((await post({ line: "no-such-line", mine: true })).status).toBe(400);
    expect((await post({ line: line.id, mine: true, text: "mine" })).status).toBe(400);
    expect(getBus().recent(scope.id).filter((e) => e.type === "utterance.role").length).toBeGreaterThanOrEqual(3);
  });

  it("a Whisper record has no speakers at all: lines with a clinician's cue are guessed, a line with none is unknown and waits for him", async () => {
    const { scope } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const lines = [
      { tStartMs: 49_520, tEndMs: 52_981, speaker: null, text: "At home, we want it below 135 over 85." },
      { tStartMs: 55_300, tEndMs: 67_000, speaker: null, text: "If your reading at home is above 180 on top, or you get chest pain, go to A&E or call 995." },
      { tStartMs: 68_200, tEndMs: 70_000, speaker: null, text: "Okay, I will write that down." },
    ];
    const view = await finalizeVisit(store, scope, visit.id, { status: "done", source: "audio", utterances: lines });
    expect(view.lines.map((l) => [l.role, l.roleState])).toEqual([
      ["doctor", "inferred"],
      ["doctor", "inferred"],
      ["unknown", "unknown"],
    ]);
    // the unknown line carries no item: it is not asked about in the queue, only in 「哪几句是你说的？」
    const items = (await store.listVisitItems(scope.id, { visit_id: visit.id })).filter((i) => i.type !== "consent");
    expect(items.some((i) => i.utterance_ids.includes(view.lines[2].id))).toBe(false);
  });

  it("a line he said is the clinician's is not his to take; a visit still recording has nothing to mark", async () => {
    const { scope } = await account();
    const visit = await record(scope, "v1");
    const target = await one(scope, visit.id, (i) => i.type === "target");
    await setItemVerdict(store, scope, visit.id, { items: [target.id], verdict: "right" });
    await expect(setLineMine(store, scope, visit.id, { line: target.utterance_ids[0], mine: true })).rejects.toMatchObject({ code: "invalid" });
    expect((await store.listUtterances(scope.id, visit.id)).find((u) => u.id === target.utterance_ids[0])).toMatchObject({ role: "doctor", role_state: "confirmed" });
    const live = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    await expect(setLineMine(store, scope, live.id, { line: "x", mine: true })).rejects.toMatchObject({ code: "invalid" });
  });
});
