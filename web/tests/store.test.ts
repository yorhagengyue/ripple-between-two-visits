import { afterEach, describe, expect, it } from "vitest";
import seedJson from "@/fixtures/timeline.seed.json";
import { getStore, storeKind } from "@/lib/store";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import { StoreError, type Store } from "@/lib/store/types";

const FIXED_NOW = new Date("2026-10-09T00:00:00.000Z");

function freshStore(): MemoryStore {
  return new MemoryStore({ now: () => FIXED_NOW });
}

/** Everything a session holds, read through the public interface. */
async function snapshot(store: Store, sessionId: string) {
  return {
    visits: await store.listVisits(sessionId),
    items: await store.listVisitItems(sessionId),
    meds: await store.listMeds(sessionId),
    doses: await store.listDoses(sessionId),
    bp: await store.listBp(sessionId),
    notes: await store.listNotes(sessionId),
    questions: await store.listQuestions(sessionId),
    grant: await store.getFamilyGrant(sessionId),
    clips: await store.listReminderClips(sessionId),
    safety: await store.listSafetyEvents(sessionId),
    utterances: (
      await Promise.all((await store.listVisits(sessionId)).map((v) => store.listUtterances(sessionId, v.id)))
    ).flat(),
  };
}

describe("seed", () => {
  it("loads the template timeline into a new session", async () => {
    const store = freshStore();
    const s = await store.createSession();

    const visits = await store.listVisits(s.id);
    expect(visits.map((v) => v.id)).toEqual(["v1", "v2", "p1", "v3"]);
    expect(visits.map((v) => v.day)).toEqual([0, 8, 12, 42]);

    const required = await store.listVisitItems(s.id, { required_only: true });
    expect(required.map((r) => r.required_line)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(required.map((r) => r.text)).toEqual(seedJson.required_doctor_lines.map((r) => r.text));
    expect(required.every((r) => r.speaker === "doctor")).toBe(true);
    expect(required.find((r) => r.required_line === "R1")).toMatchObject({
      visit_id: "v1",
      type: "target",
      slots: { systolic: 135, diastolic: 85 },
    });
    expect(required.find((r) => r.required_line === "R4")).toMatchObject({ visit_id: "v2", type: "instruction" });

    expect(await store.listMeds(s.id)).toHaveLength(4);
    expect(await store.listBp(s.id)).toHaveLength(24);
    expect(await store.listDoses(s.id)).toHaveLength(33);
  });

  it("keeps the seed's details: ids, nulls, Chinese text, extras", async () => {
    const store = freshStore();
    const s = await store.createSession();

    const meds = await store.listMeds(s.id);
    expect(meds.map((m) => m.id)).toEqual(["med-amlodipine", "med-ibuprofen", "med-relative-box", "med-losartan"]);
    const aml = meds[0];
    expect(aml.label?.directions).toBe("Take ONE tablet every MORNING");
    expect(aml).toMatchObject({ drug_id: "amlodipine", status: "label_confirmed", start_day: 9, prescribed_visit_id: "v2" });
    const box = meds.find((m) => m.id === "med-relative-box")!;
    expect(box.drug_id).toBeNull();
    expect(box.status).toBe("unidentified");
    expect(box.pharmacist_answer?.visit_id).toBe("p1");
    expect(meds.find((m) => m.id === "med-losartan")!.label).toBeNull();

    const bp = await store.listBp(s.id);
    const missing = bp.find((b) => b.id === "bp-d3-evening")!;
    expect(missing).toMatchObject({ state: "unconfirmed", systolic: null, diastolic: null });
    expect(bp.filter((b) => b.state === "recorded")).toHaveLength(23);
    expect(bp.find((b) => b.day === 29)).toMatchObject({ slot: "evening", systolic: 150, diastolic: 95 });

    const doses = await store.listDoses(s.id);
    const missed = doses.filter((d) => d.state === "missed");
    expect(missed.map((d) => d.day)).toEqual([15, 17, 24, 36]);
    expect(missed.every((d) => d.reason === "tai_chi_morning" && d.reason_text === "打太极，忘了")).toBe(true);
    expect(doses[0].id).toBe("dose-d9-med-amlodipine-morning");

    const questions = await store.listQuestions(s.id);
    expect(questions).toHaveLength(6);
    expect(questions.find((q) => q.id === "q-tai-chi")!.text).toBe("打太极的早上我常常忘记吃，可以打完太极回来再吃吗？");
    expect(questions.find((q) => q.id === "q-machine")).toMatchObject({
      created_day: 0,
      status: "answered",
      answer_speaker: "doctor",
      answer_visit_id: "v1",
      lang: "zh-Hans",
    });
    expect(questions.find((q) => q.id === "q-knee-1")!.created_day).toBe(8);
    // 10-10: the seed records Dr Lim's answer to it at the D42 visit (story-day gating keeps it waiting before then)
    expect(questions.find((q) => q.id === "q-extra-tablet")).toMatchObject({ created_day: 29, status: "answered", answer_visit_id: "v3", answer_speaker: "doctor" });
    expect(await store.listQuestions(s.id, { status: "open" })).toHaveLength(2);

    const notes = await store.listNotes(s.id);
    expect(notes.map((n) => n.day)).toEqual([20, 37]);
    expect(notes[1].text).toContain("脚踝有点肿");

    expect(await store.getFamilyGrant(s.id)).toMatchObject({
      member: "wei-ling",
      items: { dose_summary: true, visit_transcripts: false, notes: false },
    });
    expect((await store.listReminderClips(s.id))[0]).toMatchObject({ id: "clip-wei-ling-1", by: "wei-ling" });
    expect(await store.listUtterances(s.id, "v1")).toEqual([]);
  });

  it("filters day-based lists by an inclusive day range", async () => {
    const store = freshStore();
    const s = await store.createSession();
    expect(await store.listBp(s.id, { toDay: 7 })).toHaveLength(14);
    expect(await store.listDoses(s.id, { toDay: 29 })).toHaveLength(21);
    expect(await store.listDoses(s.id, { fromDay: 30, toDay: 41 })).toHaveLength(12);
    expect(await store.listNotes(s.id, { toDay: 29 })).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("creates a session with template defaults and a join code", async () => {
    const store = freshStore();
    const s = await store.createSession();
    expect(s).toMatchObject({ template: "mr-tan", story_day: 29, story_time: null, filming_mode: false, expires_at: null });
    expect(s.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await store.getSessionByJoinCode(s.join_code.toLowerCase())).toEqual(s);
    expect(await store.getSession("nope")).toBeNull();
    expect(await store.getSessionByJoinCode("ZZZZZZ")).toBeNull();
  });

  it("moves the story clock and filming mode", async () => {
    const store = freshStore();
    const s = await store.createSession();
    expect(await store.setStoryDay(s.id, 8, "09:30")).toMatchObject({ story_day: 8, story_time: "09:30" });
    expect(await store.setStoryDay(s.id, 9)).toMatchObject({ story_day: 9, story_time: "09:30" });
    expect(await store.setStoryDay(s.id, 10, null)).toMatchObject({ story_day: 10, story_time: null });
    expect(await store.setFilmingMode(s.id, true)).toMatchObject({ filming_mode: true });
    await expect(store.setStoryDay(s.id, 1.5)).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps two sessions isolated", async () => {
    const store = freshStore();
    const a = await store.createSession();
    const b = await store.createSession();
    expect(a.id).not.toBe(b.id);
    expect(a.join_code).not.toBe(b.join_code);

    await store.logDose(a.id, { medication_id: "med-amlodipine", day: 42, slot: "morning", state: "taken" });
    await store.addBp(a.id, { day: 30, slot: "morning", systolic: 138, diastolic: 86 });
    await store.addQuestion(a.id, { for: "pharmacist", origin: "own", text: "only in A" });
    await store.updateQuestion(a.id, "q-knee-2", { status: "skipped" });
    await store.upsertMed(a.id, { id: "med-amlodipine", origin: "prescription", status: "pharmacist_checked" });
    await store.setFamilyGrant(a.id, "wei-ling", { notes: true });
    await store.setStoryDay(a.id, 3);
    await store.addMember(a.id, { role: "patient", device_label: "phone A" });

    expect(await store.listDoses(a.id)).toHaveLength(34);
    expect(await store.listDoses(b.id)).toHaveLength(33);
    expect(await store.listBp(b.id)).toHaveLength(24);
    expect(await store.listQuestions(b.id)).toHaveLength(6);
    expect((await store.getQuestion(b.id, "q-knee-2"))!.status).toBe("open");
    expect((await store.getMed(b.id, "med-amlodipine"))!.status).toBe("label_confirmed");
    expect((await store.getFamilyGrant(b.id))!.items.notes).toBe(false);
    expect((await store.getSession(b.id))!.story_day).toBe(29);
    expect(await store.listMembers(b.id)).toEqual([]);
  });

  it("hands out copies, never the stored rows", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const med = (await store.getMed(s.id, "med-amlodipine"))!;
    med.label!.directions = "changed";
    med.status = "unverified";
    const again = (await store.getMed(s.id, "med-amlodipine"))!;
    expect(again.label!.directions).toBe("Take ONE tablet every MORNING");
    expect(again.status).toBe("label_confirmed");
  });

  it("reset restores the template seed and keeps id, join code and members", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const before = await snapshot(store, s.id);
    await store.addMember(s.id, { role: "director" });

    await store.setStoryDay(s.id, 42, "10:00");
    await store.logDose(s.id, { medication_id: "med-amlodipine", day: 15, slot: "morning", state: "taken" });
    await store.logDose(s.id, { medication_id: "med-losartan", day: 43, slot: "morning", state: "unconfirmed" });
    await store.addBp(s.id, { day: 31, slot: "evening", systolic: 141, diastolic: 88 });
    await store.addNote(s.id, { day: 31, text: "今天好累", source: "typed" });
    await store.addQuestion(s.id, { for: "doctor", origin: "refused_question", text: "extra" });
    await store.updateQuestion(s.id, "q-extra-tablet", { status: "answered", answer_text: "x" });
    await store.upsertMed(s.id, { origin: "supplement", status: "unverified", label: { text: "Fish oil" } });
    await store.setFamilyGrant(s.id, "wei-ling", { dose_summary: false });
    await store.addReminderClip(s.id, { by: "wei-ling", plays_at: "08:45" });
    await store.addSafetyEvent(s.id, { input: "150/95 can I take one more?", route: "refuse_route" });
    await store.upsertVisit(s.id, { id: "v1", kind: "healthier_sg_check_in", place: "x", day: 0, status: "recording" });
    await store.addUtterances(s.id, "v1", [{ t_start_ms: 0, t_end_ms: 900, text: "Sure, no problem." }]);
    await store.addVisitItems(s.id, "v1", [{ type: "consent", text: "Sure, no problem." }]);

    expect(await snapshot(store, s.id)).not.toEqual(before);

    const reset = await store.resetSession(s.id);
    expect(reset).toMatchObject({ id: s.id, join_code: s.join_code, story_day: 29, story_time: null });
    expect(await snapshot(store, s.id)).toEqual(before);
    expect(await store.listMembers(s.id)).toHaveLength(1);
  });

  it("expires sessions created with a ttl", async () => {
    let now = new Date("2026-10-09T00:00:00Z");
    const store = new MemoryStore({ now: () => now });
    const judge = await store.createSession({ ttl_hours: 24 });
    const filming = await store.createSession();
    expect(judge.expires_at).toBe("2026-10-10T00:00:00.000Z");
    now = new Date("2026-10-10T00:00:01Z");
    expect(await store.getSession(judge.id)).toBeNull();
    expect(await store.getSessionByJoinCode(judge.join_code)).toBeNull();
    expect(await store.getSession(filming.id)).not.toBeNull();
  });
});

describe("writes", () => {
  it("logDose upserts on medication, day and slot", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const row = await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed", reason: "forgot" });
    expect(row.id).toBe("dose-d29-med-amlodipine-morning");
    expect(await store.listDoses(s.id)).toHaveLength(33);
    const fixed = await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "taken" });
    expect(fixed).toMatchObject({ state: "taken", reason: null });
  });

  it("adds questions with defaults and updates them", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const q = await store.addQuestion(s.id, { for: "doctor", origin: "refused_question", text: "能不能多吃一粒？" });
    expect(q).toMatchObject({ status: "open", created_day: 29, answer_text: null });
    const answered = await store.updateQuestion(s.id, q.id, { status: "answered", answer_text: "Please don't change the dose yourself." });
    expect(answered.status).toBe("answered");
    await expect(store.addQuestion(s.id, { id: "q-machine", for: "doctor", origin: "own", text: "dup" })).rejects.toBeInstanceOf(StoreError);
    await expect(store.updateQuestion(s.id, "missing", { status: "open" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("upserts visits and records utterances and items against them", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const v = await store.upsertVisit(s.id, { kind: "follow_up", place: "Blossom Family Clinic (fictional)", day: 42 });
    expect(v).toMatchObject({ date: "2026-10-05", status: "recording" });
    await store.upsertVisit(s.id, { id: v.id, kind: v.kind, place: v.place, day: v.day, status: "review" });
    expect((await store.getVisit(s.id, v.id))!.status).toBe("review");

    const [u2, u1] = await store.addUtterances(s.id, v.id, [
      { id: "u2", t_start_ms: 5000, t_end_ms: 6000, text: "second", speaker_cluster: 1 },
      { id: "u1", t_start_ms: 1000, t_end_ms: 2000, text: "first", speaker_cluster: 0 },
    ]);
    expect(u1).toMatchObject({ role: "unknown", role_state: "unknown", scripted_fallback: false });
    expect((await store.listUtterances(s.id, v.id)).map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(await store.updateUtterance(s.id, u2.id, { role: "doctor", role_state: "inferred" })).toMatchObject({ role: "doctor" });

    const [item] = await store.addVisitItems(s.id, v.id, [{ type: "medication", text: "losartan 50 mg", utterance_ids: ["u2"] }]);
    expect(await store.updateVisitItem(s.id, item.id, { confirmed_by: "patient" })).toMatchObject({ confirmed_by: "patient" });
    expect(await store.listVisitItems(s.id, { visit_id: v.id })).toHaveLength(1);
    await expect(store.addUtterances(s.id, "no-visit", [])).rejects.toMatchObject({ code: "not_found" });
  });

  it("patches visits and medications in place", async () => {
    const store = freshStore();
    const s = await store.createSession();
    expect(await store.updateVisit(s.id, "v3", { status: "review", audio_path: "audio/v3.wav" })).toMatchObject({
      id: "v3",
      kind: "follow_up",
      day: 42,
      status: "review",
      audio_path: "audio/v3.wav",
    });
    const label = { text: "LOSARTAN 50MG TABLET", directions: "Take ONE tablet every MORNING" };
    const med = await store.updateMed(s.id, "med-losartan", { status: "label_confirmed", label });
    expect(med).toMatchObject({ drug_id: "losartan", origin: "prescription", status: "label_confirmed", label });
    label.text = "mutated after the call";
    expect((await store.getMed(s.id, "med-losartan"))!.label!.text).toBe("LOSARTAN 50MG TABLET");
    await expect(store.updateVisit(s.id, "nope", { status: "review" })).rejects.toMatchObject({ code: "not_found" });
    await expect(store.updateMed(s.id, "nope", { status: "unverified" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("merges family grants and keeps safety events newest-last", async () => {
    const store = freshStore();
    const s = await store.createSession();
    const g = await store.setFamilyGrant(s.id, "wei-ling", { visit_transcripts: true });
    expect(g.items).toMatchObject({ dose_summary: true, visit_transcripts: true });
    const other = await store.setFamilyGrant(s.id, "someone-else", { notes: true });
    expect(other.items).toEqual({
      dose_summary: false,
      bp_summary: false,
      questions_count: false,
      no_reply_alert: false,
      visit_transcripts: false,
      notes: true,
    });

    for (const input of ["a", "b", "c"]) await store.addSafetyEvent(s.id, { input, route: "explain" });
    expect((await store.listSafetyEvents(s.id, { limit: 2 })).map((e) => e.input)).toEqual(["b", "c"]);
    expect(await store.listSafetyEvents(s.id, { limit: 0 })).toEqual([]);
  });

  it("stores eval runs outside sessions", async () => {
    const store = freshStore();
    expect(await store.getLatestEvalRun()).toBeNull();
    await store.addEvalRun({ git_sha: "abc", results: { n: 1 } });
    await store.addEvalRun({ git_sha: "def", results: { n: 2 } });
    expect(await store.getLatestEvalRun()).toMatchObject({ git_sha: "def", results: { n: 2 } });
  });

  it("rejects calls for an unknown session", async () => {
    const store = freshStore();
    await expect(store.listMeds("nope")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(store.resetSession("nope")).rejects.toBeInstanceOf(StoreError);
  });
});

describe("store selection", () => {
  const original = process.env.STORE;
  afterEach(() => {
    if (original === undefined) delete process.env.STORE;
    else process.env.STORE = original;
  });

  it("uses one process-wide memory store by default", () => {
    delete process.env.STORE;
    expect(storeKind()).toBe("memory");
    expect(getStore()).toBe(getMemoryStore());
    expect(getMemoryStore()).toBe(getMemoryStore());
  });

  it("fails loudly for the unbuilt Supabase adapter and unknown values", () => {
    process.env.STORE = "supabase";
    expect(() => getStore()).toThrow(/not configured/);
    process.env.STORE = "mongo";
    expect(() => getStore()).toThrow(StoreError);
  });
});
