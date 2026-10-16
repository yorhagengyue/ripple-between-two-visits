/**
 * An account's visit, the second round (C2 track F; real-app 2.12-2.15, 3.11, 4.6):
 *   - at the pharmacy he never records onto today's planned clinic follow-up;
 *   - no recording starts without the doctor's answer to the consent card in the request; the yes heard in the recording
 *     is its own consent record (method "spoken", the sentence's id in its evidence), once per visit; records carry the
 *     card's version and hash, and assisted = true when someone helps him on his device;
 *   - without his consent to AI processing the record is made by the rules only; turning it on under 「我」 takes effect
 *     on the next request;
 *   - 「先自己记一句」: his own note about a visit that waits for its transcript, shown on that visit, never a visit line;
 *   - the example account's sample visit is marked as a sample (its events, its review);
 *   - a planned follow-up's day can be changed to the day he booked.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as jobsPost } from "@/app/api/asr/jobs/route";
import { POST as keepPost } from "@/app/api/visits/[id]/keep/route";
import { POST as notePost } from "@/app/api/visits/[id]/note/route";
import { PATCH as visitPatch } from "@/app/api/visits/[id]/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus, type BusEvent } from "@/lib/bus";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { setAiConsent } from "@/lib/privacy/ai";
import { ASSISTED_NOTE, consentStamp } from "@/lib/privacy/consents";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { CONSENT_CARD_VERSION } from "@/lib/visit/consent";
import { visitNotes } from "@/lib/visit/own-note";
import { confirmVisit, consentCardSha, declineRecording, finalizeVisit, isSampleVisit, processChunk, setItemVerdict, startVisit, VisitError } from "@/lib/visit/pipeline";
import { buildVisitView } from "@/lib/visit/view";
import { newSession } from "./helpers";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterEach(() => setTestClock(null));

async function account(space: "blank" | "example" = "blank", opts: { assisted?: boolean } = {}): Promise<{ a: TestAccount; scope: SessionRow; userId: string }> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `r2${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  if (opts.assisted) {
    // what sign-up records when a family member is tapping for him (track A: terms_privacy with assisted = true)
    await store.addConsentRecord({ user_id: a.userId, scope_id: a.scope!.id, kind: "terms_privacy", decision: "granted", version: "2026-10-10", text_sha256: "x", method: "signup_screen", evidence: null, assisted: true });
  }
  return { a, scope: (await store.getSession(a.scope!.id))!, userId: a.userId };
}

async function fixtureJob(fixture: string) {
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${fixture}`, lang: "zh-en-mixed", fixture });
  return speech.getFileJob(jobId);
}

async function record(scope: SessionRow, fixture: string, opts: Parameters<typeof finalizeVisit>[4] = {}): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  await finalizeVisit(store, scope, visit.id, await fixtureJob(fixture), opts);
  return (await store.getVisit(scope.id, visit.id))!;
}

function req(a: TestAccount | null, method: string, pathname: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { ...(a ? { cookie: `rp_at=${a.tokens.access_token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function spyLlm(calls: ChatOpts[]): LlmClient {
  return {
    provider: "fake",
    model: "fake-extract",
    async chat(opts: ChatOpts) {
      calls.push(opts);
      return { content: JSON.stringify({ items: [] }), tokens: 1 };
    },
  } as unknown as LlmClient;
}

describe("where he is decides the visit", () => {
  it("at the pharmacy on a day with a planned follow-up: a pharmacy visit of its own; the follow-up stays planned and is still used at the clinic", async () => {
    const { scope } = await account();
    const planned = await store.upsertVisit(scope.id, { id: `p-${randomUUID()}`, kind: "follow_up", place: "Blossom", day: scope.story_day, status: "planned" });
    const pharmacy = await startVisit(store, scope, { mode: "record", consent: { given: true }, place: "pharmacy" });
    expect(pharmacy.id).not.toBe(planned.id);
    expect(pharmacy).toMatchObject({ kind: "pharmacy", place: "Pharmacy", status: "recording" });
    expect((await store.getVisit(scope.id, planned.id))?.status).toBe("planned");
    // the counter's lines at that visit are the counter's, not the doctor's (lib/visit/roles.ts by the visit's kind)
    const lines = fixtureUtterances("p1")!;
    const out = await processChunk(store, scope, pharmacy.id, lines.map((u) => ({ t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: u.text })));
    expect(out.utterances.some((u) => u.role === "doctor")).toBe(false);
    expect(out.utterances.some((u) => u.role === "dispenser" || u.role === "pharmacist")).toBe(true);
    // at the clinic the same day: the planned follow-up is the row
    const clinic = await startVisit(store, scope, { mode: "record", consent: { given: true }, place: "clinic" });
    expect(clinic.id).toBe(planned.id);
  });
});

describe("the recording consent", () => {
  it("an account's recording does not start without the consent in the request: 400 consent_required, no visit row; the demo starts as before", async () => {
    const { a, scope } = await account();
    await expect(startVisit(store, scope, { mode: "record" })).rejects.toMatchObject({ code: "consent_required" });
    await expect(startVisit(store, scope, { mode: "record" })).rejects.toBeInstanceOf(VisitError);
    const res = await visitsPost(req(a, "POST", "/api/visits", { mode: "record", place: "clinic" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("consent_required");
    expect(await store.listVisits(scope.id)).toEqual([]);
    // with the doctor's yes: it starts
    const ok = await visitsPost(req(a, "POST", "/api/visits", { mode: "record", consent: { given: true }, place: "clinic" }));
    expect(ok.status).toBe(200);
    // a demo session keeps its behaviour
    const demo = await newSession();
    expect((await startVisit(store, demo, { mode: "record" })).status).toBe("recording");
  });

  it("the yes heard in the recording is its own consent record (spoken), with the sentence's id, once per visit", async () => {
    const { scope, userId } = await account();
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const job = await fixtureJob("v1");
    await finalizeVisit(store, scope, visit.id, job);
    const after = (await store.getVisit(scope.id, visit.id))!;
    expect(after.consent_utterance_id).toBeTruthy();
    let records = await store.listConsentRecords(userId, { kind: "visit_recording" });
    expect(records.map((r) => r.method)).toEqual(["tap", "spoken"]);
    expect(records[1]).toMatchObject({ decision: "granted", version: CONSENT_CARD_VERSION, text_sha256: consentCardSha(), scope_id: scope.id, assisted: false });
    expect(records[1].evidence).toMatchObject({ visit_id: visit.id, utterance_id: after.consent_utterance_id });
    // the record is made again (a second finalize): still one spoken record for this visit
    await finalizeVisit(store, scope, visit.id, job);
    records = await store.listConsentRecords(userId, { kind: "visit_recording" });
    expect(records.filter((r) => r.method === "spoken")).toHaveLength(1);
    // found live too (a chunk with the sentence), on another visit: one record for that visit
    const live = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const lines = fixtureUtterances("v1")!.map((u) => ({ t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: u.text }));
    await processChunk(store, scope, live.id, lines.slice(0, 4));
    await processChunk(store, scope, live.id, lines.slice(4, 8));
    const spoken = (await store.listConsentRecords(userId, { kind: "visit_recording" })).filter((r) => r.method === "spoken");
    expect(spoken.map((r) => (r.evidence as { visit_id: string }).visit_id).sort()).toEqual([visit.id, live.id].sort());
  });

  it("someone helps him on his device (what sign-up recorded): the tap, the spoken yes and a no are all kept with assisted = true", async () => {
    const helped = await account("blank", { assisted: true });
    await record(helped.scope, "v1");
    await declineRecording(store, helped.scope, { place: "clinic" });
    const records = await store.listConsentRecords(helped.userId, { kind: "visit_recording" });
    expect(records.map((r) => [r.method, r.decision, r.assisted])).toEqual([
      ["tap", "granted", true],
      ["spoken", "granted", true],
      ["tap", "declined", true],
    ]);
    for (const r of records) {
      expect(r).toMatchObject({ version: CONSENT_CARD_VERSION, text_sha256: consentCardSha() });
      expect(r.evidence).toMatchObject({ assisted_note: ASSISTED_NOTE, locale: "en" });
    }
    // on his own: false, and no note
    const alone = await account();
    await record(alone.scope, "v1");
    const his = await store.listConsentRecords(alone.userId, { kind: "visit_recording" });
    expect(his.every((r) => r.assisted === false)).toBe(true);
    expect(his.every((r) => !("assisted_note" in (r.evidence as object)))).toBe(true);
  });

  it("what the request says about a helper wins over sign-up's record; the spoken yes follows its visit's tap", async () => {
    // sign-up says he was alone, today his daughter holds the phone
    const { a, scope, userId } = await account();
    const started = await visitsPost(req(a, "POST", "/api/visits", { mode: "record", consent: { given: true, assisted: true }, place: "clinic" }));
    expect(started.status).toBe(200);
    const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
    await finalizeVisit(store, scope, visitId, await fixtureJob("v1"));
    await visitsPost(req(a, "POST", "/api/visits", { mode: "record", consent: { given: false, assisted: true }, place: "clinic" }));
    expect((await store.listConsentRecords(userId, { kind: "visit_recording" })).map((r) => [r.method, r.decision, r.assisted])).toEqual([
      ["tap", "granted", true],
      ["spoken", "granted", true],
      ["tap", "declined", true],
    ]);
    // sign-up says he was helped, today he is alone
    const helped = await account("blank", { assisted: true });
    const v = await startVisit(store, helped.scope, { mode: "record", consent: { given: true, assisted: false } });
    await finalizeVisit(store, helped.scope, v.id, await fixtureJob("v1"));
    expect((await store.listConsentRecords(helped.userId, { kind: "visit_recording" })).map((r) => [r.method, r.assisted])).toEqual([
      ["tap", false],
      ["spoken", false],
    ]);
  });

  it("「一直保留」 is kept with the retention text's version and sha256, in his language, and assisted", async () => {
    const { a, scope, userId } = await account("blank", { assisted: true });
    const visit = await record(scope, "v1");
    const on = await keepPost(req(a, "POST", `/api/visits/${visit.id}/keep`, { keep: true }), params(visit.id));
    expect(on.status).toBe(200);
    const off = await keepPost(req(a, "POST", `/api/visits/${visit.id}/keep`, { keep: false, assisted: false }), params(visit.id));
    expect(off.status).toBe(200);
    const records = await store.listConsentRecords(userId, { kind: "retention_keep_forever" });
    const stamp = consentStamp("retention_keep_forever", "zh-Hans");
    expect(records.map((r) => [r.decision, r.assisted, r.version, r.text_sha256])).toEqual([
      ["granted", true, stamp.version, stamp.text_sha256],
      ["withdrawn", false, stamp.version, stamp.text_sha256],
    ]);
    expect(records[0].evidence).toMatchObject({ visit_id: visit.id, locale: "zh-Hans", assisted_note: ASSISTED_NOTE });
    expect((await store.getVisit(scope.id, visit.id))?.keep_forever).toBe(false);
  });
});

describe("his consent to AI processing and the visit's record", () => {
  it("on: the labelling model sees the transcript; off: the rules alone make the record and say so; on again under 「我」: the next request uses the model", async () => {
    const { scope, userId } = await account();
    const calls: ChatOpts[] = [];
    const llm = spyLlm(calls);
    // on (the default of a new test account)
    await record(scope, "v1", { llm });
    expect(calls.length).toBe(1);

    await setAiConsent({ store, texts: store }, { userId, scopeId: scope.id, on: false, locale: "zh-Hans" });
    const rulesOnly = await record(scope, "v1", { llm });
    expect(calls.length).toBe(1); // the model was not called
    const events: BusEvent[] = getBus().recent(scope.id);
    const ready = events.filter((e) => e.type === "visit.changed" && (e.data as { extraction?: unknown }).extraction).at(-1);
    expect((ready!.data as { extraction: { source: string; aiOff?: boolean } }).extraction).toMatchObject({ source: "rules", aiOff: true });
    // the rules still found the doctor's lines, and his review says AI is off
    expect((await store.listVisitItems(scope.id, { visit_id: rulesOnly.id })).some((i) => i.type === "target")).toBe(true);
    expect((await buildVisitView(store, scope.id, rulesOnly.id))?.account?.aiOff).toBe(true);

    await setAiConsent({ store, texts: store }, { userId, scopeId: scope.id, on: true, locale: "zh-Hans" });
    const again = await record(scope, "v1", { llm });
    expect(calls.length).toBe(2);
    expect((await buildVisitView(store, scope.id, again.id))?.account?.aiOff).toBe(false);
  });

  it("a demo session keeps today's behaviour: the model labels its visits whatever any account decided", async () => {
    const demo = await newSession();
    const calls: ChatOpts[] = [];
    const visit = await startVisit(store, demo, { mode: "replay", fixture: "v1" });
    await finalizeVisit(store, demo, visit.id, await fixtureJob("v1"), { llm: spyLlm(calls) });
    expect(calls.length).toBe(1);
    expect((await buildVisitView(store, demo.id, visit.id))?.account).toBeUndefined();
  });
});

describe("「先自己记一句」 on a visit that waits for its transcript", () => {
  async function waiting(): Promise<{ a: TestAccount; scope: SessionRow; visit: VisitRow }> {
    const { a, scope } = await account();
    const v = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const visit = await store.updateVisit(scope.id, v.id, { status: "awaiting_transcript" });
    return { a, scope, visit };
  }

  it("saved as his own note (typed, today, his words), shown on that visit, never a line or an item of the visit", async () => {
    setTestClock({ at: "2026-10-12T10:05:00+08:00", frozen: true });
    const { a, scope, visit } = await waiting();
    const res = await notePost(req(a, "POST", `/api/visits/${visit.id}/note`, { text: "  医生说两个星期后\n再来  " }), params(visit.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { note: { id: string; text: string }; notes: { text: string }[] };
    expect(body.note.text).toBe("医生说两个星期后 再来");
    expect(body.notes.map((n) => n.text)).toEqual(["医生说两个星期后 再来"]);
    // one of his notes, like one written on Today
    const notes = await store.listNotes(scope.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: body.note.id, text: "医生说两个星期后 再来", source: "typed", day: scope.story_day });
    // on the visit's review, as his
    const view = (await buildVisitView(store, scope.id, visit.id))!;
    expect(view.account?.ownNotes.map((n) => n.text)).toEqual(["医生说两个星期后 再来"]);
    expect(view.account?.transcript).toBe("waiting");
    // never a line of the visit, never an item: nothing can quote it as the doctor's
    expect(await store.listUtterances(scope.id, visit.id)).toEqual([]);
    expect((await store.listVisitItems(scope.id, { visit_id: visit.id })).every((i) => i.type === "consent")).toBe(true);
    expect(view.lines).toEqual([]);
    expect(view.cards).toEqual([]);

    // after the text arrives the note is still on that visit
    await finalizeVisit(store, scope, visit.id, await fixtureJob("v1"));
    const later = (await buildVisitView(store, scope.id, visit.id))!;
    expect(later.visit.status).toBe("review");
    expect(later.account?.ownNotes.map((n) => n.text)).toEqual(["医生说两个星期后 再来"]);
    expect(later.lines.some((l) => l.text.includes("两个星期后"))).toBe(false);
  });

  it("only while it waits, only one line of words, only his own visit; another visit's notes are not mixed in", async () => {
    const { a, scope, visit } = await waiting();
    expect((await notePost(req(a, "POST", `/api/visits/${visit.id}/note`, { text: "   " }), params(visit.id))).status).toBe(400);
    expect((await notePost(req(a, "POST", `/api/visits/${visit.id}/note`, { text: "字".repeat(301) }), params(visit.id))).status).toBe(400);
    expect((await notePost(req(a, "POST", "/api/visits/nope/note", { text: "x" }), params("nope"))).status).toBe(404);
    expect((await notePost(req(null, "POST", `/api/visits/${visit.id}/note`, { text: "x" }), params(visit.id))).status).toBeGreaterThanOrEqual(400);
    // someone else's account cannot write on his visit
    const other = await account();
    expect((await notePost(req(other.a, "POST", `/api/visits/${visit.id}/note`, { text: "x" }), params(visit.id))).status).toBe(404);
    // a visit whose id starts with this visit's id (a planned follow-up made from one of its lines) keeps its own notes
    const longer = await store.upsertVisit(scope.id, { id: `${visit.id}-f03-planned`, kind: "follow_up", place: "Clinic", day: scope.story_day, status: "awaiting_transcript" });
    expect((await notePost(req(a, "POST", `/api/visits/${visit.id}/note`, { text: "第一次的" }), params(visit.id))).status).toBe(201);
    expect((await notePost(req(a, "POST", `/api/visits/${longer.id}/note`, { text: "另一次的" }), params(longer.id))).status).toBe(201);
    const notes = await store.listNotes(scope.id);
    expect(visitNotes(notes, visit.id).map((n) => n.text)).toEqual(["第一次的"]);
    expect(visitNotes(notes, longer.id).map((n) => n.text)).toEqual(["另一次的"]);
    // once the record is there he checks the record itself: no more own lines through this route
    await finalizeVisit(store, scope, visit.id, await fixtureJob("v1"));
    const late = await notePost(req(a, "POST", `/api/visits/${visit.id}/note`, { text: "x" }), params(visit.id));
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toBe("visit_not_waiting");
  });
});

describe("never the script on an account (real-app 8.7 asr/no-fixture-for-accounts)", () => {
  it("a visit of his whose id happens to be v1 still waits for its transcript under mock speech: no line of the sample files", async () => {
    const { a, scope } = await account();
    await store.upsertVisit(scope.id, { id: "v1", kind: "clinic", place: "Clinic", day: scope.story_day, status: "recording" });
    const res = await jobsPost(req(a, "POST", "/api/asr/jobs", { visit_id: "v1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_id: null, status: "awaiting_transcript", audio_saved: false });
    expect((await store.getVisit(scope.id, "v1"))?.status).toBe("awaiting_transcript");
    expect(await store.listUtterances(scope.id, "v1")).toEqual([]);
    const view = (await buildVisitView(store, scope.id, "v1"))!;
    expect(view.replayable).toBeNull();
    expect(view.lines).toEqual([]);
    const sample = fixtureUtterances("v1")!.map((u) => u.text);
    expect(JSON.stringify(view)).not.toContain(sample[3]);
  });
});

describe("the example account's sample visit", () => {
  it("its events say sample recording and its review is marked; his own recording is not", async () => {
    const ex = await account("example");
    const sample = await startVisit(store, ex.scope, { mode: "replay", fixture: "v3" });
    expect(isSampleVisit(ex.scope, sample)).toBe(true);
    const made = await finalizeVisit(store, ex.scope, sample.id, await fixtureJob("v3"));
    await confirmVisit(store, ex.scope, sample.id, { mine: made.lines.filter((l) => l.role === "patient").map((l) => l.id), items: {} });
    const events: BusEvent[] = getBus().recent(ex.scope.id);
    const changed = events.filter((e) => e.type === "visit.changed" && (e.data as { sample?: boolean }).sample === true);
    expect(changed.length).toBeGreaterThanOrEqual(3);
    for (const e of changed) expect(e.say).toMatch(/^Sample recording: /);
    expect(changed[0].say).not.toMatch(/Day \d+/);
    expect((await buildVisitView(store, ex.scope.id, sample.id))?.account?.sample).toBe(true);
    // played again after he confirmed it: a copy, still a sample
    const copy = await startVisit(store, ex.scope, { mode: "replay", fixture: "v3" });
    expect(copy.id).not.toBe(sample.id);
    expect((await buildVisitView(store, ex.scope.id, copy.id))?.account?.sample).toBe(true);
    // the sample's spoken yes is not his doctor's: no consent record of his
    expect(await store.listConsentRecords(ex.userId, { kind: "visit_recording" })).toEqual([]);

    // his own recording on the same account is not a sample
    const own = await record(ex.scope, "v1");
    expect(isSampleVisit(ex.scope, own)).toBe(false);
    expect((await buildVisitView(store, ex.scope.id, own.id))?.account?.sample).toBe(false);
  });
});

describe("a planned follow-up: the day he booked", () => {
  it("「大约 11月23日」 becomes the day he booked; only a planned visit, only a real date from today on", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const { a, scope } = await account();
    const visit = await record(scope, "v1");
    const followUp = (await store.listVisitItems(scope.id, { visit_id: visit.id })).find((i) => i.type === "follow_up")!;
    await setItemVerdict(store, scope, visit.id, { items: [followUp.id], verdict: "right" });
    const planned = (await store.listVisits(scope.id)).find((v) => v.status === "planned")!;
    expect(planned).toBeTruthy();
    const before = (await buildVisitView(store, scope.id, planned.id))!;
    expect(before.account).toMatchObject({ sample: false });

    const res = await visitPatch(req(a, "PATCH", `/api/visits/${planned.id}`, { date: "2026-11-20" }), params(planned.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visit: { date: string; day: number; approx: boolean } };
    expect(body.visit).toMatchObject({ date: "2026-11-20", approx: false });
    const after = (await store.getVisit(scope.id, planned.id))!;
    expect(after).toMatchObject({ status: "planned", date: "2026-11-20" });
    expect(after.day).toBe(scope.story_day + 39);

    // a day that has passed, a date that is not one, a visit that is not planned
    expect((await visitPatch(req(a, "PATCH", `/api/visits/${planned.id}`, { date: "2026-10-01" }), params(planned.id))).status).toBe(400);
    expect((await visitPatch(req(a, "PATCH", `/api/visits/${planned.id}`, { date: "2026-13-40" }), params(planned.id))).status).toBe(400);
    expect((await visitPatch(req(a, "PATCH", `/api/visits/${visit.id}`, { date: "2026-11-20" }), params(visit.id))).status).toBe(409);
    expect((await visitPatch(req(a, "PATCH", "/api/visits/nope", { date: "2026-11-20" }), params("nope"))).status).toBe(404);
  });
});
