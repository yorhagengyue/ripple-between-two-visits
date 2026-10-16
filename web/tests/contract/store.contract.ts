/**
 * Store contract: the store unit tests (originally tests/store.test.ts, memory only) as one suite that runs
 * against every Store implementation.
 *
 *   tests/unit/store/memory.contract.test.ts   MemoryStore, always
 *   tests/unit/store/supabase.live.test.ts     SupabaseStore against the real project, only with STORE_LIVE=1
 *
 * A target gives a factory `create({ now })`: the store must take its timestamps from `now`, because several
 * tests fix the clock (snapshot equality after reset, expiry). `sharedDatabase` marks a store whose tables other
 * runs also use (Supabase): there the suite never asserts that a table is empty, only what it wrote itself.
 * Every session and eval run a test creates is recorded and handed to `cleanup` at the end.
 *
 * Not named *.test.ts on purpose: vitest only runs it through the two runners above.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import seedJson from "@/fixtures/timeline.seed.json";
import { buildSeedTables } from "@/lib/story/seed";
import { StoreError, type SessionRow, type Store } from "@/lib/store/types";

export const FIXED_NOW = new Date("2026-10-09T00:00:00.000Z");

export interface Created {
  sessions: string[];
  evalRuns: string[];
  /** user ids the C2 tests made (accounts and their spaces); a live target deletes them */
  users: string[];
}

export interface ContractTarget {
  create(opts: { now: () => Date }): Store;
  /** tables are shared with other runs: no "the table is empty" assertions */
  sharedDatabase: boolean;
  /** remove what the suite created (live targets) */
  cleanup?(created: Created): Promise<void>;
  /** per-test timeout (network targets) */
  timeoutMs?: number;
  /**
   * A user id the C2 tests may give an account (the canonical uuid). Default: a fresh random uuid (the memory store has
   * no user table); a database target creates the auth user first so the foreign keys hold.
   */
  newUserId?(): Promise<string>;
}

/** Wrap a store so every created session / eval run id is recorded for cleanup. */
function tracked(store: Store, created: Created): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "createSession") {
        return async (...args: unknown[]) => {
          const s = await (value as (...a: unknown[]) => Promise<{ id: string }>).apply(target, args);
          created.sessions.push(s.id);
          return s;
        };
      }
      if (prop === "createAccountScope" || prop === "createAccount") {
        return async (...args: unknown[]) => {
          const id = (args[0] as { user_id: string }).user_id;
          if (!created.users.includes(id)) created.users.push(id);
          return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (prop === "addEvalRun") {
        return async (...args: unknown[]) => {
          const r = await (value as (...a: unknown[]) => Promise<{ id: string }>).apply(target, args);
          created.evalRuns.push(r.id);
          return r;
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
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

export function describeStoreContract(label: string, target: ContractTarget): void {
  const created: Created = { sessions: [], evalRuns: [], users: [] };
  const freshStore = (now: () => Date = () => FIXED_NOW): Store => tracked(target.create({ now }), created);
  const t = target.timeoutMs;

  describe(`store contract: ${label}`, () => {
    afterAll(async () => {
      if (target.cleanup) await target.cleanup(created);
    }, 120_000);

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
      }, t);

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
      }, t);

      it("filters day-based lists by an inclusive day range", async () => {
        const store = freshStore();
        const s = await store.createSession();
        expect(await store.listBp(s.id, { toDay: 7 })).toHaveLength(14);
        expect(await store.listDoses(s.id, { toDay: 29 })).toHaveLength(21);
        expect(await store.listDoses(s.id, { fromDay: 30, toDay: 41 })).toHaveLength(12);
        expect(await store.listNotes(s.id, { toDay: 29 })).toHaveLength(1);
        expect(await store.listDoses(s.id, { medication_id: "med-losartan" })).toHaveLength(0);
        expect((await store.listDoses(s.id, { medication_id: "med-amlodipine", fromDay: 15, toDay: 15 }))[0]).toMatchObject({
          state: "missed",
        });
      }, t);

      it("hands out rows in the memory store's order (day, then slot, then insertion)", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await store.addBp(s.id, { id: "bp-x-night", day: 2, slot: "night", systolic: 1, diastolic: 1 });
        await store.addBp(s.id, { id: "bp-x-morning", day: 2, slot: "morning", systolic: 2, diastolic: 2 });
        await store.addBp(s.id, { id: "bp-x-morning-2", day: 2, slot: "morning", systolic: 3, diastolic: 3 });
        const day2 = (await store.listBp(s.id, { fromDay: 2, toDay: 2 })).map((b) => b.id);
        expect(day2.indexOf("bp-x-morning")).toBeLessThan(day2.indexOf("bp-x-morning-2"));
        expect(day2.indexOf("bp-x-morning-2")).toBeLessThan(day2.indexOf("bp-x-night"));
        const all = await store.listBp(s.id);
        const order = { morning: 0, midday: 1, evening: 2, night: 3 } as const;
        for (let i = 1; i < all.length; i++) {
          const a = all[i - 1];
          const b = all[i];
          expect(a.day < b.day || (a.day === b.day && order[a.slot] <= order[b.slot])).toBe(true);
        }
      }, t);
    });

    describe("sessions", () => {
      it("creates a session with template defaults and a join code", async () => {
        const store = freshStore();
        const s = await store.createSession();
        expect(s).toMatchObject({ template: "mr-tan", story_day: 29, story_time: null, filming_mode: false, expires_at: null });
        expect(s.created_at).toBe(FIXED_NOW.toISOString());
        expect(s.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
        expect(await store.getSessionByJoinCode(s.join_code.toLowerCase())).toEqual(s);
        expect(await store.getSessionByJoinCode(` ${s.join_code} `)).toEqual(s);
        expect(await store.getSession(s.id)).toEqual(s);
        expect(await store.getSession("nope")).toBeNull();
        expect(await store.getSessionByJoinCode("ZZZZZZ")).toBeNull();
        expect((await store.listSessions()).map((x) => x.id)).toContain(s.id);
      }, t);

      it("takes the create options", async () => {
        const store = freshStore();
        const s = await store.createSession({ story_day: 8, story_time: "09:30", filming_mode: true, ttl_hours: 48 });
        expect(s).toMatchObject({ story_day: 8, story_time: "09:30", filming_mode: true, expires_at: "2026-10-11T00:00:00.000Z" });
        expect(await store.getSession(s.id)).toEqual(s);
      }, t);

      it("moves the story clock and filming mode", async () => {
        const store = freshStore();
        const s = await store.createSession();
        expect(await store.setStoryDay(s.id, 8, "09:30")).toMatchObject({ story_day: 8, story_time: "09:30" });
        expect(await store.setStoryDay(s.id, 9)).toMatchObject({ story_day: 9, story_time: "09:30" });
        expect(await store.setStoryDay(s.id, 10, null)).toMatchObject({ story_day: 10, story_time: null });
        expect(await store.setFilmingMode(s.id, true)).toMatchObject({ filming_mode: true });
        expect(await store.getSession(s.id)).toMatchObject({ story_day: 10, story_time: null, filming_mode: true });
        await expect(store.setStoryDay(s.id, 1.5)).rejects.toMatchObject({ code: "invalid" });
        await expect(store.setStoryDay("nope", 3)).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.setFilmingMode("nope", true)).rejects.toMatchObject({ code: "session_not_found" });
      }, t);

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
        expect(await store.listMembers(a.id)).toMatchObject([{ role: "patient", device_label: "phone A", session_id: a.id }]);
      }, t);

      it("hands out copies, never the stored rows", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const med = (await store.getMed(s.id, "med-amlodipine"))!;
        med.label!.directions = "changed";
        med.status = "unverified";
        const again = (await store.getMed(s.id, "med-amlodipine"))!;
        expect(again.label!.directions).toBe("Take ONE tablet every MORNING");
        expect(again.status).toBe("label_confirmed");
      }, t);

      it("reset restores the template seed and keeps id, join code and members", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const before = await snapshot(store, s.id);
        await store.addMember(s.id, { role: "director" });

        await store.setStoryDay(s.id, 42, "10:00");
        await store.setFilmingMode(s.id, true);
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
        await store.updateVisitItem(s.id, "item-R1", { confirmed_by: "patient", slots: { changed: true } });

        expect(await snapshot(store, s.id)).not.toEqual(before);

        const reset = await store.resetSession(s.id);
        expect(reset).toMatchObject({ id: s.id, join_code: s.join_code, story_day: 29, story_time: null, filming_mode: true });
        expect(await snapshot(store, s.id)).toEqual(before);
        expect(await store.listMembers(s.id)).toHaveLength(1);
        expect(await store.getSession(s.id)).toEqual(reset);
      }, t);

      it("expires sessions created with a ttl", async () => {
        let now = new Date("2026-10-09T00:00:00Z");
        const store = freshStore(() => now);
        const judge = await store.createSession({ ttl_hours: 24 });
        const filming = await store.createSession();
        expect(judge.expires_at).toBe("2026-10-10T00:00:00.000Z");
        expect(await store.getSession(judge.id)).not.toBeNull();
        now = new Date("2026-10-10T00:00:01Z");
        expect(await store.getSession(judge.id)).toBeNull();
        expect(await store.getSessionByJoinCode(judge.join_code)).toBeNull();
        expect((await store.listSessions()).map((x) => x.id)).not.toContain(judge.id);
        expect(await store.getSession(filming.id)).not.toBeNull();
      }, t);

      it("deletes a session with everything in it", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await store.addMember(s.id, { role: "patient" });
        await store.addUtterances(s.id, "v1", [{ id: "u1", t_start_ms: 0, t_end_ms: 10, text: "x" }]);
        await store.deleteSession(s.id);
        expect(await store.getSession(s.id)).toBeNull();
        expect(await store.getSessionByJoinCode(s.join_code)).toBeNull();
        await expect(store.listMeds(s.id)).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.listUtterances(s.id, "v1")).rejects.toMatchObject({ code: "session_not_found" });
        await store.deleteSession(s.id); // twice is fine
      }, t);
    });

    describe("writes", () => {
      it("logDose upserts on medication, day and slot", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const row = await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed", reason: "forgot" });
        expect(row.id).toBe("dose-d29-med-amlodipine-morning");
        expect(row).toMatchObject({ state: "missed", reason: "forgot", reason_text: null });
        expect(await store.listDoses(s.id)).toHaveLength(33);
        const fixed = await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "taken" });
        expect(fixed).toMatchObject({ id: "dose-d29-med-amlodipine-morning", state: "taken", reason: null });
        const fresh = await store.logDose(s.id, { medication_id: "med-losartan", day: 43, slot: "evening", state: "unconfirmed", reason: "later" });
        expect(fresh).toMatchObject({ session_id: s.id, day: 43, slot: "evening", reason: "later", created_at: FIXED_NOW.toISOString() });
        expect(fresh.id).toMatch(/^dose-/);
        expect(await store.listDoses(s.id)).toHaveLength(34);
        expect((await store.listDoses(s.id)).at(-1)).toEqual(fresh);
      }, t);

      it("adds questions with defaults and updates them", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const q = await store.addQuestion(s.id, { for: "doctor", origin: "refused_question", text: "能不能多吃一粒？" });
        expect(q).toMatchObject({ status: "open", created_day: 29, answer_text: null });
        expect(await store.getQuestion(s.id, q.id)).toEqual(q);
        const answered = await store.updateQuestion(s.id, q.id, { status: "answered", answer_text: "Please don't change the dose yourself." });
        expect(answered.status).toBe("answered");
        expect(answered.text).toBe("能不能多吃一粒？");
        await expect(store.addQuestion(s.id, { id: "q-machine", for: "doctor", origin: "own", text: "dup" })).rejects.toBeInstanceOf(StoreError);
        await expect(store.addQuestion(s.id, { id: "q-machine", for: "doctor", origin: "own", text: "dup" })).rejects.toMatchObject({ code: "invalid" });
        await expect(store.updateQuestion(s.id, "missing", { status: "open" })).rejects.toMatchObject({ code: "not_found" });
        expect(await store.getQuestion(s.id, "missing")).toBeNull();
        expect((await store.listQuestions(s.id, { for: "pharmacist" })).every((x) => x.for === "pharmacist")).toBe(true);
        expect((await store.listQuestions(s.id, { origin: "refused_question" })).map((x) => x.id)).toContain(q.id);
        await store.setStoryDay(s.id, 31);
        expect((await store.addQuestion(s.id, { for: "pharmacist", origin: "own", text: "later" })).created_day).toBe(31);
        expect((await store.addQuestion(s.id, { for: "pharmacist", origin: "own", text: "set", created_day: 5 })).created_day).toBe(5);
      }, t);

      it("upserts visits and records utterances and items against them", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const v = await store.upsertVisit(s.id, { kind: "follow_up", place: "Blossom Family Clinic (fictional)", day: 42 });
        expect(v).toMatchObject({ date: "2026-10-05", status: "recording" });
        await store.upsertVisit(s.id, { id: v.id, kind: v.kind, place: v.place, day: v.day, status: "review" });
        expect((await store.getVisit(s.id, v.id))!.status).toBe("review");
        expect(await store.getVisit(s.id, v.id)).toMatchObject({ date: "2026-10-05", created_at: v.created_at });
        expect((await store.listVisits(s.id)).map((x) => x.id)).toEqual(["v1", "v2", "p1", "v3", v.id]);

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
        expect(await store.listVisitItems(s.id, { type: "medication" })).toMatchObject([{ id: item.id, utterance_ids: ["u2"] }]);
        await expect(store.addUtterances(s.id, "no-visit", [])).rejects.toMatchObject({ code: "not_found" });
        await expect(store.addUtterances(s.id, "no-visit", [{ t_start_ms: 0, t_end_ms: 1, text: "x" }])).rejects.toMatchObject({ code: "not_found" });
        await expect(store.addVisitItems(s.id, "no-visit", [{ type: "test", text: "x" }])).rejects.toMatchObject({ code: "not_found" });
        await expect(store.updateUtterance(s.id, "missing", { text: "x" })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.updateVisitItem(s.id, "missing", { text: "x" })).rejects.toMatchObject({ code: "not_found" });
      }, t);

      it("replaces a re-sent utterance or item in place (same id), whole row", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await store.addUtterances(s.id, "v1", [
          { id: "a", t_start_ms: 1000, t_end_ms: 2000, text: "first a", role: "doctor", role_state: "inferred" },
          { id: "b", t_start_ms: 1000, t_end_ms: 2000, text: "b" },
        ]);
        const again = await store.addUtterances(s.id, "v1", [
          { id: "a", t_start_ms: 1000, t_end_ms: 2100, text: "final a" },
          { id: "c", t_start_ms: 500, t_end_ms: 900, text: "c" },
          { id: "c", t_start_ms: 500, t_end_ms: 950, text: "c twice" },
        ]);
        expect(again.map((u) => u.text)).toEqual(["final a", "c", "c twice"]);
        const list = await store.listUtterances(s.id, "v1");
        expect(list.map((u) => [u.id, u.text])).toEqual([
          ["c", "c twice"],
          ["a", "final a"],
          ["b", "b"],
        ]);
        expect(list.find((u) => u.id === "a")).toMatchObject({ role: "unknown", role_state: "unknown", t_end_ms: 2100 });

        await store.addVisitItems(s.id, "v1", [{ id: "it-1", type: "reading", text: "146/92", slots: { systolic: 146, nested: { a: [1, "二"] } } }]);
        await store.addVisitItems(s.id, "v1", [{ id: "it-1", type: "reading", text: "146/92 again" }]);
        const items = await store.listVisitItems(s.id, { visit_id: "v1" });
        expect(items.find((i) => i.id === "it-1")).toMatchObject({ text: "146/92 again", slots: {} });
        expect(items.filter((i) => i.id === "it-1")).toHaveLength(1);
      }, t);

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
        expect(await store.updateVisit(s.id, "v3", {})).toMatchObject({ id: "v3", status: "review" });
        expect(await store.updateVisit(s.id, "v3", { audio_path: null })).toMatchObject({ audio_path: null });
        const label = { text: "LOSARTAN 50MG TABLET", directions: "Take ONE tablet every MORNING" };
        const med = await store.updateMed(s.id, "med-losartan", { status: "label_confirmed", label });
        expect(med).toMatchObject({ drug_id: "losartan", origin: "prescription", status: "label_confirmed", label });
        label.text = "mutated after the call";
        expect((await store.getMed(s.id, "med-losartan"))!.label!.text).toBe("LOSARTAN 50MG TABLET");
        await expect(store.updateVisit(s.id, "nope", { status: "review" })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.updateMed(s.id, "nope", { status: "unverified" })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.updateVisit("nope", "v3", { status: "review" })).rejects.toMatchObject({ code: "session_not_found" });

        const merged = await store.upsertMed(s.id, { id: "med-ibuprofen", origin: "self_bought", status: "label_confirmed", note: undefined });
        expect(merged).toMatchObject({ id: "med-ibuprofen", status: "label_confirmed", drug_id: "ibuprofen" });
        expect(merged.note).toBe((await store.getMed(s.id, "med-ibuprofen"))!.note);
        const added = await store.upsertMed(s.id, {
          origin: "relative",
          status: "awaiting_label",
          label: { text: "宁和平压丸", photo_path: "labels/x/labels/y.png" },
          pharmacist_answer: { visit_id: "p1", text: "原话" },
        });
        expect(added).toMatchObject({ drug_id: null, start_day: null, created_at: FIXED_NOW.toISOString() });
        expect(await store.getMed(s.id, added.id)).toEqual(added);
        expect((await store.listMeds(s.id)).at(-1)!.id).toBe(added.id);
      }, t);

      it("merges family grants and keeps safety events newest-last", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const g = await store.setFamilyGrant(s.id, "wei-ling", { visit_transcripts: true });
        expect(g.items).toMatchObject({ dose_summary: true, visit_transcripts: true });
        expect(g.updated_at).toBe(FIXED_NOW.toISOString());
        const other = await store.setFamilyGrant(s.id, "someone-else", { notes: true });
        expect(other.items).toEqual({
          dose_summary: false,
          bp_summary: false,
          questions_count: false,
          no_reply_alert: false,
          visit_transcripts: false,
          notes: true,
        });
        expect(await store.getFamilyGrant(s.id, "someone-else")).toEqual(other);
        expect(await store.getFamilyGrant(s.id, "nobody")).toBeNull();

        for (const input of ["a", "b", "c"]) await store.addSafetyEvent(s.id, { input, route: "explain" });
        expect((await store.listSafetyEvents(s.id, { limit: 2 })).map((e) => e.input)).toEqual(["b", "c"]);
        expect(await store.listSafetyEvents(s.id, { limit: 0 })).toEqual([]);
        expect((await store.listSafetyEvents(s.id)).map((e) => e.input)).toEqual(["a", "b", "c"]);
        const rich = await store.addSafetyEvent(s.id, {
          input: "我可以多吃一粒吗？",
          lang: "zh-Hans",
          route: "refuse_route",
          candidates: [{ sourceId: "visit:v2:R4", span: "Don't change the dose yourself." }],
          layer1: { pass: false, reasons: ["number_not_in_span"] },
          output: { sentences: [], fixedText: null },
          blocked: [{ layer: 2 }],
          latency_ms: 12.5,
        });
        expect((await store.listSafetyEvents(s.id, { limit: 1 }))[0]).toEqual(rich);
      }, t);

      it("stores eval runs outside sessions", async () => {
        const store = freshStore();
        if (!target.sharedDatabase) expect(await store.getLatestEvalRun()).toBeNull();
        await store.addEvalRun({ git_sha: "abc", results: { n: 1 } });
        const second = await store.addEvalRun({ git_sha: "def", results: { n: 2, zh: "中文" } });
        expect(await store.getLatestEvalRun()).toEqual(second);
        expect(second).toMatchObject({ git_sha: "def", results: { n: 2, zh: "中文" } });
      }, t);

      it("rejects calls for an unknown session", async () => {
        const store = freshStore();
        await expect(store.listMeds("nope")).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.resetSession("nope")).rejects.toBeInstanceOf(StoreError);
        await expect(store.resetSession("nope")).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.getVisit("nope", "v1")).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.listDoses("nope")).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.logDose("nope", { medication_id: "m", day: 1, slot: "morning", state: "taken" })).rejects.toMatchObject({
          code: "session_not_found",
        });
        await expect(store.addBp("nope", { day: 1, slot: "morning" })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.addQuestion("nope", { for: "doctor", origin: "own", text: "x" })).rejects.toMatchObject({
          code: "session_not_found",
        });
        await expect(store.setFamilyGrant("nope", "wei-ling", { notes: true })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.getFamilyGrant("nope")).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.listSafetyEvents("nope", { limit: 0 })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.addMember("nope", { role: "patient" })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.upsertVisit("nope", { kind: "x", place: "y", day: 1 })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.addUtterances("nope", "v1", [{ t_start_ms: 0, t_end_ms: 1, text: "x" }])).rejects.toMatchObject({
          code: "session_not_found",
        });
      }, t);
    });

    // ---------------------------------------------------------------- C2: scopes, accounts and the new tables

    describe("C2: account scopes", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());
      /** A store whose clock the test moves. */
      const clocked = (startIso: string) => {
        let now = Date.parse(startIso);
        const store = freshStore(() => new Date(now));
        return { store, set: (iso: string) => void (now = Date.parse(iso)), advance: (ms: number) => void (now += ms) };
      };

      it("an account's space: its id is the user's, no join code, today computed in Singapore across midnight", async () => {
        const { store, set } = clocked("2026-10-09T15:59:59.000Z"); // 23:59:59 in Singapore
        const uid = await newUser();
        const s = await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        expect(s).toMatchObject({
          id: uid,
          kind: "account",
          owner_user_id: uid,
          join_code: null,
          expires_at: null,
          template: "blank",
          d0: "2026-08-28",
          tz: "Asia/Singapore",
          settings: {},
          onboarding: null,
          example_data: false,
          clock_offset_ms: null,
          filming: false,
          story_day: 42,
          story_time: "23:59",
          tracking_since: "2026-10-09T15:59:59.000Z",
        });
        set("2026-10-09T16:00:00.000Z"); // midnight in Singapore
        expect(await store.getSession(uid)).toMatchObject({ story_day: 43, story_time: "00:00" });
        expect((await store.listSessions()).find((x) => x.id === uid)).toMatchObject({ story_day: 43 });
        expect((await store.listAccountScopes()).find((x) => x.id === uid)).toMatchObject({ story_day: 43 });
        // a day 0 after today: a negative day (a visit entered from before he started)
        const later = await newUser();
        expect(await store.createAccountScope({ user_id: later, d0: "2026-10-12" })).toMatchObject({ story_day: -2 });
        // the store's own defaults read the computed day and the scope's d0
        const v = await store.upsertVisit(uid, { kind: "follow_up", place: "Clinic", day: 43 });
        expect(v.date).toBe("2026-10-10");
        expect((await store.addQuestion(uid, { for: "doctor", origin: "own", text: "x" })).created_day).toBe(43);
      }, t);

      it("only demo rows have a story clock, a reset, filming mode and joining devices", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        await expect(store.setStoryDay(uid, 3)).rejects.toMatchObject({ code: "account_scope" });
        await expect(store.setFilmingMode(uid, true)).rejects.toMatchObject({ code: "account_scope" });
        await expect(store.resetSession(uid)).rejects.toMatchObject({ code: "account_scope" });
        await expect(store.addMember(uid, { role: "patient" })).rejects.toMatchObject({ code: "account_scope" });
        expect(await store.listMembers(uid)).toEqual([]);
        // and the account-only operations refuse a demo row
        const demo = await store.createSession({ ttl_hours: 1 });
        expect(demo.kind).toBe("sandbox");
        await expect(store.updateScope(demo.id, { onboarding: "done" })).rejects.toMatchObject({ code: "account_scope" });
        await expect(store.setFilmingAccount(demo.id, true)).rejects.toMatchObject({ code: "account_scope" });
        await expect(store.reseedAccount(demo.id, {})).rejects.toMatchObject({ code: "account_scope" });
        expect((await store.createSession()).kind).toBe("filming");
        await expect(store.createAccountScope({ user_id: "not-a-uuid", d0: "2026-08-28" })).rejects.toMatchObject({ code: "invalid" });
        await expect(store.createAccountScope({ user_id: uid, d0: "2026-08-28" })).rejects.toMatchObject({ code: "conflict" });
      }, t);

      it("cleanup deletes expired judge sandboxes only: never a filming session, never an account", async () => {
        const { store, advance } = clocked("2026-10-09T00:00:00.000Z");
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const sandbox = await store.createSession({ ttl_hours: 1 });
        const filming = await store.createSession({ ttl_hours: null });
        advance(2 * 3_600_000);
        expect(await store.deleteExpiredSandboxes()).toBeGreaterThanOrEqual(1);
        expect(await store.getSession(sandbox.id)).toBeNull();
        expect(await store.getSession(filming.id)).toMatchObject({ kind: "filming" });
        expect(await store.getSession(uid)).toMatchObject({ kind: "account" });
      }, t);

      it("settings merge key by key; the zone must be a real one", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28", settings: { clinic: "Blossom", routine: [] } });
        const s = await store.updateScope(uid, { settings: { reminder_time: "08:15" }, onboarding: "done" });
        expect(s.settings).toEqual({ clinic: "Blossom", routine: [], reminder_time: "08:15" });
        expect(s.onboarding).toBe("done");
        await expect(store.updateScope(uid, { tz: "Mars/Olympus" })).rejects.toMatchObject({ code: "invalid" });
        expect((await store.updateScope(uid, { tz: "Asia/Kuala_Lumpur" })).tz).toBe("Asia/Kuala_Lumpur");
      }, t);

      it("a filming account's offset moves its day and restarts tracking at its new now; a plain account has none", async () => {
        const { store } = clocked("2026-10-09T16:00:00.000Z");
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-24", example_data: true, template: "mr-tan" });
        await expect(store.setClockOffset(uid, 1000)).rejects.toMatchObject({ code: "account_scope" });
        await store.setFilmingAccount(uid, true);
        const beat = Date.parse("2026-09-22T12:15:00.000Z"); // Day 29, 20:15 in Singapore
        const s = await store.setClockOffset(uid, beat - Date.parse("2026-10-09T16:00:00.000Z"));
        expect(s).toMatchObject({ filming: true, story_day: 29, story_time: "20:15", tracking_since: "2026-09-22T12:15:00.000Z" });
        const off = await store.setFilmingAccount(uid, false);
        expect(off).toMatchObject({ filming: false, clock_offset_ms: null, story_day: 47 });
      }, t);

      it("a reseed replaces his records but keeps his family links' switches", async () => {
        const store = freshStore();
        const uid = await newUser();
        const tables = buildSeedTables("placeholder", FIXED_NOW.toISOString(), "mr-tan");
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28", template: "mr-tan", example_data: true, tables: { ...tables, family_grants: [] } });
        expect(await store.listMeds(uid)).toHaveLength(4);
        expect((await store.listVisits(uid)).every((v) => v.session_id === uid)).toBe(true);
        const link = await store.createInvite({ patient_id: uid, invite_token_hash: `h-${randomUUID()}`, invite_expires_at: "2026-10-16T00:00:00.000Z" }, { dose_summary: true });
        expect(link.ok).toBe(true);
        const linkId = link.ok ? link.link.id : "";
        await store.addNote(uid, { day: 40, text: "x", source: "typed" });
        const blank = await store.reseedAccount(uid, { template: "blank", example_data: false, onboarding: null, settings: {}, tables: {} });
        expect(blank).toMatchObject({ template: "blank", example_data: false, onboarding: null, settings: {} });
        expect(await store.listMeds(uid)).toEqual([]);
        expect(await store.listNotes(uid)).toEqual([]);
        expect(await store.getFamilyGrant(uid, linkId)).toMatchObject({ link_id: linkId, items: { dose_summary: true } });
      }, t);

      // C2 track C (0014_c_example_seed): the example's transcripts and profile facts are part of the layout's one call
      it("an account's space is laid out with its transcripts and profile facts in the same call; a reseed replaces them", async () => {
        const store = freshStore();
        const uid = await newUser();
        const at = FIXED_NOW.toISOString();
        const tables = buildSeedTables("placeholder", at, "mr-tan");
        const line = (id: string, visit_id: string, text: string) => ({
          id, session_id: "placeholder", visit_id, t_start_ms: 1000, t_end_ms: 2500.5, speaker_cluster: 0, role: "doctor" as const, role_state: "confirmed" as const,
          text, lang: "en", clip_path: null, scripted_fallback: false, created_at: at,
        });
        const fact = (id: string, kind: string, text: string, data: unknown) => ({
          id, session_id: "placeholder", kind, text, source: "patient" as const, entered_by: "patient", confirmed_by: "patient", visit_item_id: null, created_day: 0,
          data, hidden: null, entered_by_user_id: null, link_id: null, confirmed_at: at, updated_at: null, created_at: at,
        });
        const utterances = [line("v1-a", "v1", "Good morning, Mr Tan."), line("v1-b", "v1", "Take it every morning."), line("v2-a", "v2", "Your reading is 150 over 95.")];
        const profile_facts = [fact("fact-name", "name", "陈先生（示例）", { example: true }), fact("fact-age", "age", "67", { years: 67 }), fact("fact-home", "home", "Toa Payoh", null)];
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28", template: "mr-tan", example_data: true, tables: { ...tables, family_grants: [], utterances, profile_facts } });
        // every row is his space's, as written, in order
        expect((await store.listUtterances(uid, "v1")).map((u) => [u.id, u.session_id, u.visit_id, u.text, u.role, u.role_state, u.t_end_ms, u.created_at])).toEqual([
          ["v1-a", uid, "v1", "Good morning, Mr Tan.", "doctor", "confirmed", 2500.5, at],
          ["v1-b", uid, "v1", "Take it every morning.", "doctor", "confirmed", 2500.5, at],
        ]);
        expect((await store.listUtterances(uid, "v2")).map((u) => u.id)).toEqual(["v2-a"]);
        expect(await store.listProfileFacts(uid)).toEqual(profile_facts.map((f) => ({ ...f, session_id: uid })));
        // rows written afterwards sit next to the laid-out ones
        await store.addProfileFact(uid, { kind: "allergy", text: "青霉素", source: "patient", confirmed_by: "patient" });
        expect((await store.listProfileFacts(uid)).map((f) => f.kind)).toEqual(["name", "age", "home", "allergy"]);
        // a reseed with new rows replaces both tables in its one call; one with none empties them
        const again = await store.reseedAccount(uid, { tables: { ...tables, family_grants: [], utterances: [line("v1-c", "v1", "Hello again.")], profile_facts: [fact("fact-name", "name", "陈先生（示例）", null)] } });
        expect(again).toMatchObject({ example_data: true });
        expect((await store.listUtterances(uid, "v1")).map((u) => u.id)).toEqual(["v1-c"]);
        expect(await store.listUtterances(uid, "v2")).toEqual([]);
        expect((await store.listProfileFacts(uid)).map((f) => [f.id, f.data])).toEqual([["fact-name", null]]);
        await store.reseedAccount(uid, { template: "blank", example_data: false, tables: {} });
        expect(await store.listProfileFacts(uid)).toEqual([]);
        expect(await store.listVisits(uid)).toEqual([]);
        // a line for a visit that is not laid out is refused, and nothing of that call stays
        const orphan = await newUser();
        await expect(store.createAccountScope({ user_id: orphan, d0: "2026-08-28", tables: { utterances: [line("x-a", "no-such-visit", "x")], profile_facts: [fact("fact-name", "name", "x", null)] } })).rejects.toBeTruthy();
        expect(await store.getSession(orphan)).toBeNull();
      }, t);
    });

    describe("C2: accounts", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("accounts, usernames, recovery codes, devices, reset requests and events", async () => {
        const store = freshStore();
        const uid = await newUser();
        const uname = `t${uid.slice(0, 8)}`;
        const a = await store.createAccount({ user_id: uid, login_kind: "username", username: uname, display_name: "Mr Tan" });
        expect(a).toMatchObject({ user_id: uid, username: uname, display_name: "Mr Tan", locale: null, last_seen_at: null, created_at: FIXED_NOW.toISOString() });
        expect(await store.getAccount(uid)).toEqual(a);
        expect(await store.getAccountByUsername(uname.toUpperCase())).toEqual(a);
        expect(await store.getAccount(randomUUID())).toBeNull();
        await expect(store.createAccount({ user_id: uid, login_kind: "username" })).rejects.toBeInstanceOf(StoreError);
        const other = await newUser();
        await expect(store.createAccount({ user_id: other, login_kind: "username", username: uname })).rejects.toMatchObject({ code: "conflict" });
        expect(await store.updateAccount(uid, { locale: "en", last_seen_at: FIXED_NOW.toISOString() })).toMatchObject({ locale: "en", last_seen_at: FIXED_NOW.toISOString() });

        expect(await store.getRecoveryCode(uid)).toBeNull();
        await store.setRecoveryCode(uid, "hash-1");
        expect(await store.setRecoveryCode(uid, "hash-2")).toMatchObject({ code_hash: "hash-2" });
        expect((await store.getRecoveryCode(uid))!.code_hash).toBe("hash-2");

        const d1 = await store.touchKnownDevice(uid, "dev-1", "his phone");
        expect(d1).toMatchObject({ device_hash: "dev-1", label: "his phone", first_seen_at: FIXED_NOW.toISOString() });
        await store.touchKnownDevice(uid, "dev-1");
        await store.touchKnownDevice(uid, "dev-2");
        expect((await store.listKnownDevices(uid)).map((d) => [d.device_hash, d.label])).toEqual([
          ["dev-1", "his phone"],
          ["dev-2", null],
        ]);

        const rr = await store.createResetRequest({ user_id: uid, device_hash: "dev-1", expires_at: "2026-10-09T00:10:00.000Z" });
        expect(await store.getResetRequest(rr.id)).toEqual(rr);
        expect((await store.useResetRequest(rr.id))!.used_at).toBe(FIXED_NOW.toISOString());
        expect(await store.useResetRequest(rr.id)).toBeNull();

        await store.addAccountEvent(uid, "recovery_code", { via: "signup" });
        await store.addAccountEvent(uid, "export");
        expect((await store.listAccountEvents(uid)).map((e) => [e.kind, e.detail])).toEqual([
          ["recovery_code", { via: "signup" }],
          ["export", {}],
        ]);
      }, t);
    });

    describe("C2: family links", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("invite, accept, confirm, switches with a version and history, the access log, revoke", async () => {
        const store = freshStore();
        const dad = await newUser();
        const her = await newUser();
        await store.createAccountScope({ user_id: dad, d0: "2026-08-28" });
        const hash = `h-${randomUUID()}`;
        const inv = await store.createInvite(
          { patient_id: dad, relation: "daughter", family_label: "Wei Ling", patient_label: "Dad", invite_token_hash: hash, invite_expires_at: "2026-10-16T00:00:00.000Z" },
          { dose_summary: true },
        );
        expect(inv.ok).toBe(true);
        if (!inv.ok) return;
        const id = inv.link.id;
        expect(inv.link).toMatchObject({ patient_id: dad, family_id: null, status: "invited", invite_token_hash: hash, relation: "daughter" });
        expect(await store.getFamilyGrant(dad, id)).toMatchObject({ member: id, link_id: id, version: 1, items: { dose_summary: true, notes: false } });

        expect(await store.acceptInvite(hash, dad)).toEqual({ ok: false, code: "invite_self" });
        expect(await store.acceptInvite("nope", her)).toEqual({ ok: false, code: "invite_not_found" });
        const acc = await store.acceptInvite(hash, her, "Wei Ling");
        expect(acc).toMatchObject({ ok: true, link: { status: "accepted", family_id: her, accepted_at: FIXED_NOW.toISOString() } });
        expect(await store.acceptInvite(hash, her)).toEqual({ ok: false, code: "invite_used" });
        expect(await store.confirmLink(id, her, true)).toEqual({ ok: false, code: "link_not_found" });
        const conf = await store.confirmLink(id, dad, true);
        expect(conf).toMatchObject({ ok: true, link: { status: "active", invite_token_hash: null, confirmed_at: FIXED_NOW.toISOString() } });
        expect(await store.confirmLink(id, dad, true)).toEqual({ ok: false, code: "link_not_accepted" });

        const g2 = await store.setFamilyGrant(dad, id, { bp_summary: true });
        expect(g2).toMatchObject({ version: 2, items: { dose_summary: true, bp_summary: true } });
        expect((await store.setFamilyGrant(dad, id, { bp_summary: true })).version).toBe(2);
        expect((await store.listGrantHistory(id)).map((h) => [h.version, h.items.bp_summary])).toEqual([
          [1, false],
          [2, true],
        ]);

        expect((await store.listCareLinks({ patient_id: dad })).map((l) => l.id)).toEqual([id]);
        expect((await store.listCareLinks({ family_id: her, status: ["active"] })).map((l) => l.id)).toEqual([id]);
        expect(await store.listCareLinks({ family_id: her, status: ["revoked"] })).toEqual([]);

        await store.addCareAccessLog(dad, { link_id: id, family_user_id: her, family_label: "Wei Ling", route: "GET /api/family/view", items: ["dose_summary"] });
        expect((await store.listCareAccessLog(dad)).map((e) => [e.route, e.items])).toEqual([["GET /api/family/view", ["dose_summary"]]]);

        expect(await store.revokeLink(id, her, "patient")).toEqual({ ok: false, code: "link_not_found" });
        const rv = await store.revokeLink(id, dad, "patient");
        expect(rv).toMatchObject({ ok: true, link: { status: "revoked", revoked_by: "patient" } });
        expect(await store.revokeLink(id, dad, "patient")).toEqual({ ok: false, code: "link_closed" });
      }, t);

      it("an invitation expires; he can say the person who accepted is not her", async () => {
        let now = Date.parse("2026-10-01T00:00:00.000Z");
        const store = freshStore(() => new Date(now));
        const dad = await newUser();
        const her = await newUser();
        await store.createAccountScope({ user_id: dad, d0: "2026-08-28" });
        const h1 = `h-${randomUUID()}`;
        const old = await store.createInvite({ patient_id: dad, invite_token_hash: h1, invite_expires_at: "2026-10-08T00:00:00.000Z" });
        now = Date.parse("2026-10-09T00:00:00.000Z");
        expect(await store.acceptInvite(h1, her)).toEqual({ ok: false, code: "invite_expired" });
        expect((await store.getCareLink(old.ok ? old.link.id : ""))?.status).toBe("expired");
        const h2 = `h-${randomUUID()}`;
        const h3 = `h-${randomUUID()}`;
        const pending = await store.createInvite({ patient_id: dad, invite_token_hash: h2, invite_expires_at: "2026-10-08T12:00:00.000Z" });
        expect(await store.expireInvites()).toBeGreaterThanOrEqual(1);
        expect((await store.getCareLink(pending.ok ? pending.link.id : ""))?.status).toBe("expired");
        const next = await store.createInvite({ patient_id: dad, invite_token_hash: h3, invite_expires_at: "2026-10-16T00:00:00.000Z" });
        await store.acceptInvite(h3, her);
        const no = await store.confirmLink(next.ok ? next.link.id : "", dad, false);
        expect(no).toMatchObject({ ok: true, link: { status: "declined", invite_token_hash: null } });
        // an invitation needs his own account space
        const demo = await store.createSession({ ttl_hours: 1 });
        await expect(store.createInvite({ patient_id: demo.id, invite_token_hash: `h-${randomUUID()}`, invite_expires_at: "2026-10-16T00:00:00.000Z" })).rejects.toBeInstanceOf(StoreError);
      }, t);

      it("deleting an account: his space and links go; her clips and access-log rows in his space keep her label", async () => {
        const store = freshStore();
        const dad = await newUser();
        const her = await newUser();
        await store.createAccount({ user_id: dad, login_kind: "username", username: `d${dad.slice(0, 8)}` });
        await store.createAccount({ user_id: her, login_kind: "email" });
        await store.createAccountScope({ user_id: dad, d0: "2026-08-28" });
        const hash = `h-${randomUUID()}`;
        const inv = await store.createInvite({ patient_id: dad, invite_token_hash: hash, invite_expires_at: "2026-10-16T00:00:00.000Z" });
        const id = inv.ok ? inv.link.id : "";
        await store.acceptInvite(hash, her);
        await store.confirmLink(id, dad, true);
        const clip = await store.addReminderClip(dad, { by: id, plays_at: "after_breakfast", by_user_id: her, by_label: "Wei Ling", link_id: id });
        expect(clip).toMatchObject({ by_user_id: her, by_label: "Wei Ling", link_id: id });
        await store.addCareAccessLog(dad, { link_id: id, family_user_id: her, family_label: "Wei Ling", route: "GET /api/family/view", items: [] });
        await store.addConsentRecord({ user_id: her, kind: "family_accept", decision: "granted" });
        await store.deleteAccount(her);
        expect(await store.getAccount(her)).toBeNull();
        expect(await store.getCareLink(id)).toBeNull();
        expect(await store.listConsentRecords(her)).toEqual([]);
        const kept = (await store.listReminderClips(dad)).find((c) => c.id === clip.id)!;
        expect(kept.by_label).toBe("Wei Ling");
        expect(kept.by_user_id).toBeUndefined(); // cleared: handed out only once set
        expect((await store.listCareAccessLog(dad))[0]).toMatchObject({ family_user_id: null, family_label: "Wei Ling" });
        await store.deleteAccount(dad);
        expect(await store.getSession(dad)).toBeNull();
        expect(await store.getAccount(dad)).toBeNull();
      }, t);
    });

    describe("C2: consent, push, deliveries, limits, leases", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("consent texts never change; records are kept in order", async () => {
        const store = freshStore();
        const uid = await newUser();
        const version = `v-${randomUUID().slice(0, 8)}`;
        const text = await store.putConsentText({ kind: "ai_processing", version, locale: "en", sha256: "abc", text: "We use DeepSeek." });
        expect(text).toMatchObject({ kind: "ai_processing", version, published_at: FIXED_NOW.toISOString() });
        expect(await store.putConsentText({ kind: "ai_processing", version, locale: "en", sha256: "abc", text: "We use DeepSeek." })).toEqual(text);
        await expect(store.putConsentText({ kind: "ai_processing", version, locale: "en", sha256: "zzz", text: "Changed." })).rejects.toMatchObject({ code: "invalid" });
        expect(await store.getConsentText("ai_processing", version, "en")).toEqual(text);
        await store.addConsentRecord({ user_id: uid, kind: "ai_processing", decision: "granted", version, text_sha256: "abc", method: "signup_screen" });
        await store.addConsentRecord({ user_id: uid, kind: "ai_processing", decision: "withdrawn", version, assisted: true });
        await store.addConsentRecord({ user_id: uid, kind: "terms_privacy", decision: "granted" });
        expect((await store.listConsentRecords(uid, { kind: "ai_processing" })).map((r) => [r.decision, r.assisted])).toEqual([
          ["granted", false],
          ["withdrawn", true],
        ]);
        expect(await store.listConsentRecords(uid)).toHaveLength(3);
        await expect(store.addConsentRecord({ user_id: uid, kind: "ai_processing", decision: "maybe" as never })).rejects.toMatchObject({ code: "invalid" });
      }, t);

      it("push subscriptions: one row per endpoint; deliveries are sent once", async () => {
        const store = freshStore();
        const uid = await newUser();
        const endpoint = `https://push.example/${randomUUID()}`;
        const first = await store.savePushSubscription({ user_id: uid, endpoint, p256dh: "k1", auth: "a1" });
        const again = await store.savePushSubscription({ user_id: uid, endpoint, p256dh: "k2", auth: "a2", user_agent: "phone" });
        expect(again).toMatchObject({ id: first.id, p256dh: "k2", auth: "a2", user_agent: "phone" });
        expect(await store.listPushSubscriptions(uid)).toHaveLength(1);
        await store.deletePushSubscription(endpoint);
        expect(await store.listPushSubscriptions(uid)).toEqual([]);

        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const key = { kind: "dose_first", ref: "med-amlodipine", day: 42, slot: "morning" };
        const sent = await store.recordDelivery(uid, key);
        expect(sent).toMatchObject({ created: true, delivery: { ...key, opened_at: null } });
        expect(await store.recordDelivery(uid, key)).toMatchObject({ created: false, delivery: { id: sent.delivery.id } });
        expect((await store.markDeliveryOpened(uid, sent.delivery.id)).opened_at).toBe(FIXED_NOW.toISOString());
        expect(await store.listDeliveries(uid, { fromDay: 42, toDay: 42 })).toHaveLength(1);
        await expect(store.recordDelivery("nope", key)).rejects.toBeInstanceOf(StoreError);
      }, t);

      it("rate limits count in a fixed window; a job lease has one holder at a time", async () => {
        let now = Date.parse("2026-10-09T00:00:00.000Z");
        const store = freshStore(() => new Date(now));
        const bucket = `b-${randomUUID()}`;
        expect(await store.rateHit(bucket, 60, 2)).toMatchObject({ count: 1, allowed: true, reset_at: "2026-10-09T00:01:00.000Z" });
        expect(await store.rateHit(bucket, 60, 2)).toMatchObject({ count: 2, allowed: true });
        expect(await store.rateHit(bucket, 60, 2)).toMatchObject({ count: 3, allowed: false });
        now += 61_000;
        expect(await store.rateHit(bucket, 60, 2)).toMatchObject({ count: 1, allowed: true });

        const job = `job-${randomUUID()}`;
        expect(await store.acquireJobLease(job, "a", 60)).toBe(true);
        expect(await store.acquireJobLease(job, "b", 60)).toBe(false);
        expect(await store.acquireJobLease(job, "a", 60)).toBe(true);
        now += 61_000;
        expect(await store.acquireJobLease(job, "b", 60)).toBe(true);
        await store.releaseJobLease(job, "b");
        expect(await store.acquireJobLease(job, "a", 60)).toBe(true);
        await store.releaseJobLease(job, "a");

        const run = await store.addOpsRun({ job, counts: { scopes: 2, written: 1 }, started_at: "2026-10-09T00:00:00.000Z" });
        expect((await store.listOpsRuns(job)).map((r) => r.id)).toEqual([run.id]);
      }, t);
    });

    describe("C2 track A: sign-in protection", () => {
      it("a bucket's window is read without counting a hit, gone once it has passed, and can be cleared", async () => {
        let now = Date.parse("2026-10-09T00:00:00.000Z");
        const store = freshStore(() => new Date(now));
        const bucket = `login_fail:${randomUUID()}:dev`;
        expect(await store.getRateWindow(bucket)).toBeNull();
        await store.rateHit(bucket, 900, 5);
        await store.rateHit(bucket, 900, 5);
        const w = { count: 2, reset_at: "2026-10-09T00:15:00.000Z" };
        expect(await store.getRateWindow(bucket)).toEqual(w);
        expect(await store.getRateWindow(bucket)).toEqual(w); // reading never counts
        expect(await store.rateHit(bucket, 900, 5)).toMatchObject({ count: 3 });
        now += 900_000;
        expect(await store.getRateWindow(bucket)).toBeNull(); // the window has passed
        expect(await store.rateHit(bucket, 900, 5)).toMatchObject({ count: 1, reset_at: "2026-10-09T00:30:00.000Z" });
        await store.clearRate(bucket);
        expect(await store.getRateWindow(bucket)).toBeNull();
        expect(await store.rateHit(bucket, 900, 5)).toMatchObject({ count: 1 });
        await store.clearRate(bucket);
        await store.clearRate(`never-${randomUUID()}`); // clearing an unknown bucket is fine
      }, t);
    });

    describe("C2 track L: an allowance that is a sum", () => {
      it("rateAdd counts an amount in the same fixed window, and shares the bucket's row with the other rate methods", async () => {
        let now = Date.parse("2026-10-09T00:00:00.000Z");
        const store = freshStore(() => new Date(now));
        const bucket = `audio:${randomUUID()}`;
        expect(await store.rateAdd(bucket, 86_400, 100, 30)).toEqual({ count: 30, allowed: true, reset_at: "2026-10-10T00:00:00.000Z" });
        expect(await store.rateAdd(bucket, 86_400, 100, 70)).toMatchObject({ count: 100, allowed: true });
        expect(await store.rateAdd(bucket, 86_400, 100, 1)).toMatchObject({ count: 101, allowed: false, reset_at: "2026-10-10T00:00:00.000Z" });
        expect(await store.rateAdd(bucket, 86_400, 100, 0)).toMatchObject({ count: 101, allowed: false }); // adding nothing reads the state
        expect(await store.getRateWindow(bucket)).toEqual({ count: 101, reset_at: "2026-10-10T00:00:00.000Z" });
        now += 86_400_000;
        expect(await store.rateAdd(bucket, 86_400, 100, 5)).toEqual({ count: 5, allowed: true, reset_at: "2026-10-11T00:00:00.000Z" });
        await store.clearRate(bucket);
        expect(await store.rateAdd(bucket, 86_400, 100, 2)).toMatchObject({ count: 2 });
        await store.clearRate(bucket);
      }, t);
    });

    describe("C2 track A: family-assisted reset (real-app 3.6)", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("his switch on a link: off until he turns it on, his own active links only; revoking leaves it as it was", async () => {
        const store = freshStore();
        const dad = await newUser();
        const her = await newUser();
        await store.createAccountScope({ user_id: dad, d0: "2026-08-28" });
        const hash = `h-${randomUUID()}`;
        const inv = await store.createInvite({ patient_id: dad, family_label: "Wei Ling", invite_token_hash: hash, invite_expires_at: "2026-10-16T00:00:00.000Z" });
        expect(inv.ok).toBe(true);
        if (!inv.ok) return;
        const id = inv.link.id;
        expect(inv.link.reset_helper).toBe(false);
        // not active yet: nothing to switch
        expect(await store.setLinkResetHelper(id, dad, true)).toEqual({ ok: false, code: "link_closed" });
        await store.acceptInvite(hash, her, "Wei Ling");
        expect(await store.setLinkResetHelper(id, dad, true)).toEqual({ ok: false, code: "link_closed" });
        await store.confirmLink(id, dad, true);
        expect((await store.getCareLink(id))!.reset_helper).toBe(false);
        // only he switches it, and only on a link that exists
        expect(await store.setLinkResetHelper(id, her, true)).toEqual({ ok: false, code: "link_not_found" });
        expect(await store.setLinkResetHelper(randomUUID(), dad, true)).toEqual({ ok: false, code: "link_not_found" });
        expect((await store.getCareLink(id))!.reset_helper).toBe(false);
        expect(await store.setLinkResetHelper(id, dad, true)).toMatchObject({ ok: true, link: { id, status: "active", reset_helper: true } });
        expect(await store.setLinkResetHelper(id, dad, true)).toMatchObject({ ok: true, link: { reset_helper: true } });
        expect((await store.listCareLinks({ patient_id: dad, status: ["active"] })).map((l) => l.reset_helper)).toEqual([true]);
        expect(await store.setLinkResetHelper(id, dad, false)).toMatchObject({ ok: true, link: { reset_helper: false } });
        await store.setLinkResetHelper(id, dad, true);
        await store.revokeLink(id, dad, "patient");
        expect(await store.setLinkResetHelper(id, dad, false)).toEqual({ ok: false, code: "link_closed" });
        expect((await store.getCareLink(id))!.reset_helper).toBe(true);
      }, t);

      it("his requests in order; a code's hash and her link go on an unused request, a second code replaces the first", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccount({ user_id: uid, login_kind: "username", username: `t${uid.slice(0, 8)}` });
        expect(await store.listResetRequests(uid)).toEqual([]);
        const first = await store.createResetRequest({ user_id: uid, device_hash: "dev-1", expires_at: "2026-10-09T00:10:00.000Z" });
        const second = await store.createResetRequest({ user_id: uid, device_hash: "dev-2", expires_at: "2026-10-09T00:20:00.000Z" });
        expect((await store.listResetRequests(uid)).map((r) => [r.id, r.device_hash, r.code_hash, r.link_id, r.used_at])).toEqual([
          [first.id, "dev-1", null, null, null],
          [second.id, "dev-2", null, null, null],
        ]);
        expect(await store.listResetRequests(randomUUID())).toEqual([]);
        const link = randomUUID();
        expect(await store.setResetRequestCode(second.id, link, "hash-a")).toMatchObject({ id: second.id, link_id: link, code_hash: "hash-a", used_at: null, device_hash: "dev-2" });
        expect(await store.setResetRequestCode(second.id, link, "hash-b")).toMatchObject({ code_hash: "hash-b" });
        expect((await store.getResetRequest(second.id))!.code_hash).toBe("hash-b");
        expect(await store.setResetRequestCode(randomUUID(), link, "hash-c")).toBeNull();
        // a used request takes no code
        await store.useResetRequest(first.id);
        expect(await store.setResetRequestCode(first.id, link, "hash-d")).toBeNull();
        expect((await store.getResetRequest(first.id))!.code_hash).toBeNull();
      }, t);
    });

    describe("C2: the new modules' tables and the corrections", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("profile facts (a family proposal waits), prevention, watch, diet, chat and brief snapshots", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const own = await store.addProfileFact(uid, { kind: "clinic", text: "Blossom", source: "patient", confirmed_by: "patient" });
        const fam = await store.addProfileFact(uid, { kind: "condition", text: "hepatitis B", source: "family", entered_by: "Wei Ling" });
        expect(fam).toMatchObject({ confirmed_by: null, hidden: null, created_day: 42, updated_at: null });
        expect((await store.listProfileFacts(uid, { confirmed: false })).map((f) => f.id)).toEqual([fam.id]);
        const ok = await store.updateProfileFact(uid, fam.id, { confirmed_by: "patient", confirmed_at: FIXED_NOW.toISOString() });
        expect(ok).toMatchObject({ confirmed_by: "patient", updated_at: FIXED_NOW.toISOString() });
        await store.updateProfileFact(uid, own.id, { hidden: true });
        expect((await store.listProfileFacts(uid, { hidden: false })).map((f) => f.id)).toEqual([fam.id]);
        expect((await store.listProfileFacts(uid, { source: "family" })).map((f) => f.id)).toEqual([fam.id]);

        const p = await store.addPreventDone(uid, { item_id: "flu_jab", day: 40 });
        expect(await store.listPreventDone(uid)).toEqual([p]);
        await store.deletePreventDone(uid, p.id);
        expect(await store.listPreventDone(uid)).toEqual([]);
        await expect(store.deletePreventDone(uid, p.id)).rejects.toMatchObject({ code: "not_found" });

        await store.addWatchMetrics(uid, [
          { day: 41, metric: "steps", value: 4000, unit: "steps" },
          { day: 40, metric: "steps", value: 5000 },
          { day: 41, metric: "sleep_h", value: 6.5 },
        ]);
        expect((await store.listWatchMetrics(uid, { metric: "steps" })).map((m) => m.day)).toEqual([40, 41]);
        expect(await store.listWatchMetrics(uid, { fromDay: 41, toDay: 41 })).toHaveLength(2);

        const d1 = await store.setDietCheck(uid, { day: 42, item: "less_salt", answer: "yes" });
        const d2 = await store.setDietCheck(uid, { day: 42, item: "less_salt", answer: "no", note: "party" });
        expect(d2).toMatchObject({ id: d1.id, answer: "no", note: "party" });
        expect(await store.listDietChecks(uid)).toHaveLength(1);

        for (const text of ["a", "b", "c"]) await store.addChatMessage(uid, { day: 42, role: "patient", text });
        await store.addChatMessage(uid, { day: 41, role: "ripple", text: "older", answer: { sentences: [] } });
        expect((await store.listChatMessages(uid, { fromDay: 42, toDay: 42, limit: 2 })).map((m) => m.text)).toEqual(["b", "c"]);
        expect((await store.listChatMessages(uid, { toDay: 41 }))[0]).toMatchObject({ role: "ripple", answer: { sentences: [] } });

        const b = await store.addBriefSnapshot(uid, { data: { doses: 33 }, locale: "en" });
        expect(await store.getBriefSnapshot(uid, b.id)).toEqual(b);
        expect((await store.markBriefShown(uid, b.id)).shown_at).toBe(FIXED_NOW.toISOString());
        expect(await store.listBriefSnapshots(uid, { limit: 1 })).toHaveLength(1);
        await expect(store.addChatMessage("nope", { day: 1, role: "patient", text: "x" })).rejects.toMatchObject({ code: "session_not_found" });
      }, t);

      it("readings can be corrected and removed; her reminder clip can be removed; the C2 columns appear only once set", async () => {
        const store = freshStore();
        const s = await store.createSession();
        const r = await store.addBp(s.id, { day: 29, slot: "evening", systolic: 185, diastolic: 112 });
        expect(await store.updateBp(s.id, r.id, { systolic: 158 })).toMatchObject({ systolic: 158, diastolic: 112 });
        await store.deleteBp(s.id, r.id);
        expect((await store.listBp(s.id)).some((x) => x.id === r.id)).toBe(false);
        await expect(store.deleteBp(s.id, r.id)).rejects.toMatchObject({ code: "not_found" });
        await store.deleteReminderClip(s.id, "clip-wei-ling-1");
        expect(await store.listReminderClips(s.id)).toEqual([]);
        // demo rows look as before: no C2 column on a seed medicine, visit, question or grant
        const med = (await store.getMed(s.id, "med-amlodipine"))! as unknown as Record<string, unknown>;
        for (const col of ["start_at", "dose_slots", "dose_slots_source"]) expect(col in med, col).toBe(false);
        const v1 = (await store.getVisit(s.id, "v1"))! as unknown as Record<string, unknown>;
        for (const col of ["retain_until", "keep_forever", "audio_deleted_at"]) expect(col in v1, col).toBe(false);
        const grant = (await store.getFamilyGrant(s.id))! as unknown as Record<string, unknown>;
        expect("link_id" in grant || "version" in grant).toBe(false);
        // once set they are there
        expect(await store.updateMed(s.id, "med-amlodipine", { start_at: FIXED_NOW.toISOString(), dose_slots: ["morning"], dose_slots_source: "label" })).toMatchObject({
          start_at: FIXED_NOW.toISOString(),
          dose_slots: ["morning"],
          dose_slots_source: "label",
        });
        const row: SessionRow | null = await store.getSession(s.id);
        expect(row).toMatchObject({ kind: "filming", owner_user_id: null, d0: null, tz: "Asia/Singapore", settings: {}, tracking_since: null });
      }, t);

      // ---- C2 track B (journeys 02, 03): undo deletes his dose answer; the keypad's pulse (0011_b_daily)
      it("track B: an undone dose answer is deleted and the cell takes a fresh row; the pulse appears only once set", async () => {
        let clock = new Date("2026-10-09T00:52:00.000Z");
        const store = freshStore(() => clock);
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-10-09" });
        await store.upsertMed(uid, { id: "med-a", origin: "prescription", status: "label_confirmed", start_day: 0 });
        const first = await store.logDose(uid, { medication_id: "med-a", day: 0, slot: "morning", state: "taken" });
        expect(first.created_at).toBe("2026-10-09T00:52:00.000Z");
        await store.deleteDose(uid, first.id);
        expect(await store.listDoses(uid)).toEqual([]);
        await expect(store.deleteDose(uid, first.id)).rejects.toMatchObject({ code: "not_found" });
        clock = new Date("2026-10-09T02:20:00.000Z");
        const again = await store.logDose(uid, { medication_id: "med-a", day: 0, slot: "morning", state: "taken" });
        expect(again.id).not.toBe(first.id);
        expect(again.created_at).toBe("2026-10-09T02:20:00.000Z");
        expect(await store.listDoses(uid)).toEqual([again]);
        await expect(store.deleteDose("no-such-scope", again.id)).rejects.toMatchObject({ code: "session_not_found" });

        const plain = await store.addBp(uid, { day: 0, slot: "morning", systolic: 138, diastolic: 82 });
        expect("pulse" in plain).toBe(false);
        const withPulse = await store.addBp(uid, { day: 0, slot: "morning", systolic: 140, diastolic: 84, pulse: 72 });
        expect(withPulse).toMatchObject({ systolic: 140, diastolic: 84, pulse: 72 });
        const listed = await store.listBp(uid);
        expect(listed.map((r) => ("pulse" in r ? r.pulse : "unset"))).toEqual(["unset", 72]);
        expect(await store.updateBp(uid, plain.id, { pulse: 68 })).toMatchObject({ pulse: 68 });
        expect("pulse" in (await store.updateBp(uid, withPulse.id, { pulse: null }))).toBe(false);
      }, t);

      // ---- C2 track B, second round (0016_b_bp_changes): a changed or deleted reading keeps its record
      it("track B: a reading's history and deleted_at appear only once set; a deleted reading stays a row and is left out of the list unless asked", async () => {
        const store = freshStore(() => new Date("2026-10-09T00:52:00.000Z"));
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-10-09" });
        const a = await store.addBp(uid, { day: 0, slot: "morning", systolic: 185, diastolic: 112, pulse: 80 });
        const b = await store.addBp(uid, { day: 0, slot: "evening", systolic: 140, diastolic: 84 });
        expect("history" in a).toBe(false);
        expect("deleted_at" in a).toBe(false);

        const edit = { at: "2026-10-09T00:55:00.000Z", action: "edit" as const, systolic: 185, diastolic: 112, pulse: 80, state: "recorded" as const };
        const edited = await store.updateBp(uid, a.id, { systolic: 135, diastolic: 82, pulse: null, history: [edit] });
        expect(edited).toMatchObject({ id: a.id, systolic: 135, diastolic: 82, history: [edit], created_at: a.created_at });
        expect("pulse" in edited).toBe(false);
        expect("deleted_at" in edited).toBe(false);

        const gone = { at: "2026-10-09T01:00:00.000Z", action: "delete" as const, systolic: 135, diastolic: 82, pulse: null, state: "recorded" as const };
        const deleted = await store.updateBp(uid, a.id, { deleted_at: gone.at, history: [edit, gone] });
        expect(deleted).toMatchObject({ deleted_at: "2026-10-09T01:00:00.000Z", history: [edit, gone] });
        expect((await store.listBp(uid)).map((r) => r.id)).toEqual([b.id]);
        expect((await store.listBp(uid, { fromDay: 0, toDay: 0 })).map((r) => r.id)).toEqual([b.id]);
        const all = await store.listBp(uid, { includeDeleted: true });
        expect(all.map((r) => r.id)).toEqual([a.id, b.id]);
        expect(all[0]).toMatchObject({ systolic: 135, deleted_at: "2026-10-09T01:00:00.000Z", history: [edit, gone] });
        expect("history" in all[1]).toBe(false);

        // put back: deleted_at is gone from the row again, the history stays
        const back = await store.updateBp(uid, a.id, { deleted_at: null });
        expect("deleted_at" in back).toBe(false);
        expect(back.history).toEqual([edit, gone]);
        expect((await store.listBp(uid)).map((r) => r.id)).toEqual([a.id, b.id]);
      }, t);

      // ---- C2 track B, fix round (0018_b_dose_pre_tracking): a dose row says what it is to a cell outside tracking
      it("track B: a dose row's pre_tracking appears only once said (true or false), is laid out with a space, and an existing row keeps its own", async () => {
        const store = freshStore(() => new Date("2026-10-09T02:00:00.000Z"));
        const uid = await newUser();
        const laid = (id: string, day: number, pre?: boolean) => ({
          id,
          session_id: "",
          medication_id: "med-a",
          day,
          slot: "morning" as const,
          state: "taken" as const,
          reason: null,
          reason_text: null,
          ...(pre === undefined ? {} : { pre_tracking: pre }),
          created_at: "2026-10-09T02:00:00.000Z",
        });
        // laid out with the space: the row that says it, and one that says nothing
        await store.createAccountScope({ user_id: uid, d0: "2026-10-01", tables: { dose_logs: [laid("dose-laid", 6, true), laid("dose-plain", 7)] } });
        const listed = await store.listDoses(uid);
        expect(listed.map((r) => [r.id, "pre_tracking" in r ? r.pre_tracking : "unset"])).toEqual([
          ["dose-laid", true],
          ["dose-plain", "unset"],
        ]);
        // a fresh row: as said by the writer (true, false), or nothing
        const note = await store.logDose(uid, { medication_id: "med-a", day: 8, slot: "morning", state: "taken", pre_tracking: false });
        expect(note.pre_tracking).toBe(false);
        const kept = await store.logDose(uid, { medication_id: "med-a", day: 8, slot: "evening", state: "missed", pre_tracking: true });
        expect(kept.pre_tracking).toBe(true);
        const silent = await store.logDose(uid, { medication_id: "med-a", day: 8, slot: "night", state: "taken" });
        expect("pre_tracking" in silent).toBe(false);
        // an existing row keeps what it is through the upsert, like its id and created_at
        const again = await store.logDose(uid, { medication_id: "med-a", day: 6, slot: "morning", state: "missed", reason: "forgot", pre_tracking: false });
        expect(again).toMatchObject({ id: "dose-laid", state: "missed", reason: "forgot", pre_tracking: true, created_at: "2026-10-09T02:00:00.000Z" });
        const still = await store.logDose(uid, { medication_id: "med-a", day: 8, slot: "morning", state: "missed", pre_tracking: true });
        expect(still).toMatchObject({ id: note.id, state: "missed", pre_tracking: false });
        expect((await store.listDoses(uid)).map((r) => ("pre_tracking" in r ? r.pre_tracking : "unset"))).toEqual([true, "unset", false, true, "unset"]);
        // laid out again: the new tables' rows, with what they say
        await store.reseedAccount(uid, { tables: { dose_logs: [laid("dose-again", 5, true)] } });
        expect((await store.listDoses(uid)).map((r) => [r.id, r.pre_tracking])).toEqual([["dose-again", true]]);
        // a demo session's rows never carry it
        const demo = await store.createSession();
        expect((await store.listDoses(demo.id)).some((r) => "pre_tracking" in r)).toBe(false);
      }, t);

      // ---- C2 track O (real-app 2.25): an answer or a reading kept on the phone is dated when he tapped
      it("track O: a fresh dose row and a reading take the tap's own time; an existing dose row keeps its own", async () => {
        const store = freshStore(() => new Date("2026-10-09T04:00:00.000Z"));
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-10-09" });
        await store.upsertMed(uid, { id: "med-a", origin: "prescription", status: "label_confirmed", start_day: 0 });
        const dose = await store.logDose(uid, { medication_id: "med-a", day: 0, slot: "morning", state: "taken", created_at: "2026-10-09T00:52:00.000Z" });
        expect(Date.parse(dose.created_at)).toBe(Date.parse("2026-10-09T00:52:00.000Z"));
        const same = await store.logDose(uid, { medication_id: "med-a", day: 0, slot: "morning", state: "missed", created_at: "2026-10-09T03:00:00.000Z" });
        expect(same).toMatchObject({ id: dose.id, state: "missed" });
        expect(Date.parse(same.created_at)).toBe(Date.parse("2026-10-09T00:52:00.000Z"));
        const bp = await store.addBp(uid, { id: "bp-o-late", day: 0, slot: "morning", systolic: 138, diastolic: 82, created_at: "2026-10-09T00:55:00.000Z" });
        expect(Date.parse(bp.created_at)).toBe(Date.parse("2026-10-09T00:55:00.000Z"));
        const listed = (await store.listBp(uid)).find((r) => r.id === "bp-o-late");
        expect(listed && Date.parse(listed.created_at)).toBe(Date.parse("2026-10-09T00:55:00.000Z"));
        const now = await store.addBp(uid, { day: 0, slot: "morning", systolic: 140, diastolic: 84 });
        expect(Date.parse(now.created_at)).toBe(Date.parse("2026-10-09T04:00:00.000Z"));
      }, t);
    });

    // C2 track C (0010_c_questions): what he does to his own question list
    describe("C2 track C: his edits and merges on the question list", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("edited_at and merged_into appear only once set, survive a read, and the demo's questions look as before", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const a = await store.addQuestion(uid, { for: "doctor", origin: "own", text: "膝盖止痛药还可以吃吗？", lang: "zh-Hans" });
        const b = await store.addQuestion(uid, { for: "doctor", origin: "preventive", text: "Should I get the flu jab?", lang: "en" });
        for (const q of [a, b]) for (const col of ["edited_at", "merged_into"]) expect(col in (q as unknown as Record<string, unknown>), col).toBe(false);
        const edited = await store.updateQuestion(uid, a.id, { text: "膝盖痛的止痛药还能吃吗？", edited_at: FIXED_NOW.toISOString() });
        expect(edited).toMatchObject({ text: "膝盖痛的止痛药还能吃吗？", edited_at: FIXED_NOW.toISOString(), status: "open" });
        const merged = await store.updateQuestion(uid, b.id, { status: "skipped", merged_into: a.id });
        expect(merged).toMatchObject({ status: "skipped", merged_into: a.id, origin: "preventive" });
        const listed = await store.listQuestions(uid);
        expect(listed.find((q) => q.id === a.id)).toMatchObject({ edited_at: FIXED_NOW.toISOString() });
        expect(listed.find((q) => q.id === b.id)).toMatchObject({ merged_into: a.id });
        // undo a merge: the column is cleared and leaves the row again
        const back = (await store.updateQuestion(uid, b.id, { status: "open", merged_into: null })) as unknown as Record<string, unknown>;
        expect(back.status).toBe("open");
        expect("merged_into" in back).toBe(false);
        // a demo session's seeded questions carry neither column
        const s = await store.createSession();
        for (const q of await store.listQuestions(s.id)) for (const col of ["edited_at", "merged_into"]) expect(col in (q as unknown as Record<string, unknown>), col).toBe(false);
      }, t);
    });

    describe("C2 track S: translations (0009_s_translations)", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());
      const H1 = "a".repeat(64);
      const H2 = "b".repeat(64);

      it("one row per scope, direction and source text: insert once, the first row stays", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        expect(await store.getTranslation(uid, "en>zh-Hans", H1)).toBeNull();
        const first = await store.putTranslation(uid, {
          direction: "en>zh-Hans",
          source_sha256: H1,
          source_text: "At home, we want it below 135 over 85.",
          text: "在家里，我们希望血压低于 135/85。",
          status: "checked",
          checks: { facts: { pass: true }, meaning: { pass: true, checker: "test" } },
        });
        expect(first).toMatchObject({ session_id: uid, direction: "en>zh-Hans", status: "checked", created_at: FIXED_NOW.toISOString() });
        const again = await store.putTranslation(uid, { direction: "en>zh-Hans", source_sha256: H1, source_text: "At home, we want it below 135 over 85.", text: "另一种译法", status: "checked" });
        expect(again).toEqual(first);
        expect(await store.getTranslation(uid, "en>zh-Hans", H1)).toEqual(first);
        // the other direction of the same hash is another row; a rejected text keeps no translation
        const rejected = await store.putTranslation(uid, { direction: "zh-Hans>en", source_sha256: H1, source_text: "最近很累", status: "rejected", checks: { facts: { pass: false } } });
        expect(rejected).toMatchObject({ text: null, status: "rejected", checks: { facts: { pass: false } } });
        expect((await store.listTranslations(uid)).map((r) => r.id)).toEqual([first.id, rejected.id]);
        // another scope does not see them
        const other = await newUser();
        await store.createAccountScope({ user_id: other, d0: "2026-08-28" });
        expect(await store.getTranslation(other, "en>zh-Hans", H1)).toBeNull();
        expect(await store.listTranslations(other)).toEqual([]);
      }, t);

      it("a checked row needs its text; an unknown scope is session_not_found; a demo session keeps them across a reset", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await expect(store.putTranslation(s.id, { direction: "en>zh-Hans", source_sha256: H2, source_text: "x", status: "checked" })).rejects.toMatchObject({ code: "invalid" });
        await expect(store.putTranslation("nope", { direction: "en>zh-Hans", source_sha256: H2, source_text: "x", status: "rejected" })).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.getTranslation("nope", "en>zh-Hans", H2)).rejects.toMatchObject({ code: "session_not_found" });
        const kept = await store.putTranslation(s.id, { direction: "en>zh-Hans", source_sha256: H2, source_text: "Some people get ankle swelling with this one.", text: "有些人吃这个药会脚踝肿。", status: "checked" });
        await store.resetSession(s.id);
        expect(await store.getTranslation(s.id, "en>zh-Hans", H2)).toEqual(kept);
      }, t);
    });

    describe("C2 track F: the understanding checklist's answers (0013_f_understanding)", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("one row per medicine and item, his latest answer; another scope sees none", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        await store.upsertMed(uid, { id: "med-amlodipine", origin: "prescription", status: "awaiting_label", drug_id: "amlodipine" });
        await store.upsertMed(uid, { id: "med-losartan", origin: "prescription", status: "awaiting_label", drug_id: "losartan" });
        expect(await store.listUnderstandingAnswers(uid)).toEqual([]);
        const first = await store.setUnderstandingAnswer(uid, { medication_id: "med-amlodipine", item: "purpose", answer: "know", day: 3 });
        expect(first).toMatchObject({ session_id: uid, medication_id: "med-amlodipine", item: "purpose", answer: "know", day: 3, created_at: FIXED_NOW.toISOString() });
        const changed = await store.setUnderstandingAnswer(uid, { medication_id: "med-amlodipine", item: "purpose", answer: "unsure" });
        expect(changed).toMatchObject({ id: first.id, answer: "unsure", day: 3 });
        const other = await store.setUnderstandingAnswer(uid, { medication_id: "med-losartan", item: "missed", answer: "know", day: 4 });
        expect((await store.listUnderstandingAnswers(uid)).map((r) => [r.medication_id, r.item, r.answer])).toEqual([
          ["med-amlodipine", "purpose", "unsure"],
          ["med-losartan", "missed", "know"],
        ]);
        expect(await store.listUnderstandingAnswers(uid, { medication_id: "med-losartan" })).toEqual([other]);
        const someoneElse = await newUser();
        await store.createAccountScope({ user_id: someoneElse, d0: "2026-08-28" });
        expect(await store.listUnderstandingAnswers(someoneElse)).toEqual([]);
      }, t);

      it("a medicine that does not exist is not_found; unknown items and answers are invalid; a reset takes them with the medicines", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await expect(store.setUnderstandingAnswer(s.id, { medication_id: "med-nope", item: "purpose", answer: "know" })).rejects.toMatchObject({ code: "not_found" });
        await expect(
          store.setUnderstandingAnswer(s.id, { medication_id: "med-amlodipine", item: "dosage" as never, answer: "know" }),
        ).rejects.toMatchObject({ code: "invalid" });
        await expect(
          store.setUnderstandingAnswer(s.id, { medication_id: "med-amlodipine", item: "when", answer: "maybe" as never }),
        ).rejects.toMatchObject({ code: "invalid" });
        await store.setUnderstandingAnswer(s.id, { medication_id: "med-amlodipine", item: "when", answer: "know", day: 9 });
        expect(await store.listUnderstandingAnswers(s.id)).toHaveLength(1);
        await store.resetSession(s.id);
        expect(await store.listUnderstandingAnswers(s.id)).toEqual([]);
      }, t);
    });

    // C2 track F, round three: how a visit's record was made (0016_f_visit_made); a prescription awaiting its label
    // and a planned follow-up can be taken back (deleteMed, deleteVisit: existing table privileges, no migration)
    describe("C2 track F: visit.ai_used, deleteMed, deleteVisit", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("ai_used is handed out only once set, true or false; a seed visit never has it", async () => {
        const store = freshStore();
        const demo = await store.createSession();
        expect("ai_used" in ((await store.getVisit(demo.id, "v1"))! as unknown as Record<string, unknown>)).toBe(false);
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const made = await store.upsertVisit(uid, { id: "visit-a", kind: "follow_up", place: "Clinic", day: 3, status: "transcribing" });
        expect("ai_used" in made).toBe(false);
        expect(await store.updateVisit(uid, "visit-a", { ai_used: false })).toMatchObject({ id: "visit-a", ai_used: false });
        expect((await store.getVisit(uid, "visit-a"))!.ai_used).toBe(false);
        expect((await store.listVisits(uid)).map((v) => v.ai_used)).toEqual([false]);
        expect(await store.updateVisit(uid, "visit-a", { ai_used: true, status: "review" })).toMatchObject({ ai_used: true, status: "review" });
        expect("ai_used" in (await store.updateVisit(uid, "visit-a", { ai_used: null }))).toBe(false);
        expect(await store.upsertVisit(uid, { id: "visit-b", kind: "follow_up", place: "Clinic", day: 4, ai_used: true })).toMatchObject({ ai_used: true });
      }, t);

      it("deleteMed removes the one row and its understanding answers; deleteVisit removes the visit with its lines and items; missing rows are not_found", async () => {
        const store = freshStore();
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        await store.upsertMed(uid, { id: "med-amlodipine", origin: "prescription", status: "awaiting_label", drug_id: "amlodipine" });
        await store.upsertMed(uid, { id: "med-losartan", origin: "prescription", status: "awaiting_label", drug_id: "losartan" });
        await store.setUnderstandingAnswer(uid, { medication_id: "med-amlodipine", item: "purpose", answer: "know", day: 3 });
        await store.setUnderstandingAnswer(uid, { medication_id: "med-losartan", item: "purpose", answer: "know", day: 3 });
        await store.deleteMed(uid, "med-amlodipine");
        expect((await store.listMeds(uid)).map((m) => m.id)).toEqual(["med-losartan"]);
        expect((await store.listUnderstandingAnswers(uid)).map((a) => a.medication_id)).toEqual(["med-losartan"]);
        await expect(store.deleteMed(uid, "med-amlodipine")).rejects.toMatchObject({ code: "not_found" });
        await expect(store.deleteMed("no-such-scope", "med-losartan")).rejects.toMatchObject({ code: "session_not_found" });

        await store.upsertVisit(uid, { id: "visit-a", kind: "follow_up", place: "Clinic", day: 3, status: "review" });
        await store.upsertVisit(uid, { id: "visit-a-planned", kind: "follow_up", place: "Clinic", day: 45, status: "planned" });
        await store.addUtterances(uid, "visit-a", [{ id: "visit-a-f01", t_start_ms: 0, t_end_ms: 900, speaker_cluster: 0, role: "doctor", role_state: "inferred", text: "Come back in six weeks.", lang: "en" }]);
        await store.addVisitItems(uid, "visit-a", [{ id: "it-a", type: "follow_up", text: "Come back in six weeks.", utterance_ids: ["visit-a-f01"], slots: { days: 42 } }]);
        await store.deleteVisit(uid, "visit-a-planned");
        expect((await store.listVisits(uid)).map((v) => v.id)).toEqual(["visit-a"]);
        expect(await store.listUtterances(uid, "visit-a")).toHaveLength(1);
        await expect(store.deleteVisit(uid, "visit-a-planned")).rejects.toMatchObject({ code: "not_found" });
        // a visit with a record: its lines and items go with it
        await store.deleteVisit(uid, "visit-a");
        expect(await store.listVisits(uid)).toEqual([]);
        expect(await store.listVisitItems(uid)).toEqual([]);
        await expect(store.deleteVisit("no-such-scope", "visit-a")).rejects.toMatchObject({ code: "session_not_found" });
      }, t);
    });

    // C2 track R (0017_r_visit_audio_parts): a long recording's files, in order, on the visit
    describe("C2 track R: visit.audio_parts", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("audio_parts is handed out only once set; the list comes back in order, grows, and is cleared with null; audio_path is not touched by it", async () => {
        const store = freshStore();
        const demo = await store.createSession();
        expect("audio_parts" in ((await store.getVisit(demo.id, "v1"))! as unknown as Record<string, unknown>)).toBe(false);
        const uid = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-08-28" });
        const made = await store.upsertVisit(uid, { id: "visit-long", kind: "clinic", place: "Clinic", day: 3, status: "recording" });
        expect("audio_parts" in made).toBe(false);
        expect(made.audio_path).toBeNull();

        const one = [{ path: "aprefix/visits/visit-long/recording-1.wav", ms: 1_200_000 }];
        const first = await store.updateVisit(uid, "visit-long", { audio_parts: one });
        expect(first.audio_parts).toEqual(one);
        // parts still arriving: the recording is not there yet
        expect(first.audio_path).toBeNull();
        const two = [...one, { path: "aprefix/visits/visit-long/recording-2.wav", ms: 345_678 }];
        expect((await store.updateVisit(uid, "visit-long", { audio_parts: two })).audio_parts).toEqual(two);
        expect((await store.getVisit(uid, "visit-long"))!.audio_parts).toEqual(two);
        expect((await store.listVisits(uid)).map((v) => v.audio_parts)).toEqual([two]);
        // the last part is there: the recording's path is the first part's, in the same write as the status
        expect(await store.updateVisit(uid, "visit-long", { audio_path: two[0].path, status: "transcribing" })).toMatchObject({ audio_path: two[0].path, status: "transcribing", audio_parts: two });
        // what a store hands out is a copy: changing it does not change the row
        (await store.getVisit(uid, "visit-long"))!.audio_parts!.pop();
        expect((await store.getVisit(uid, "visit-long"))!.audio_parts).toEqual(two);

        // the recording reached the end of its days: both go, and the column is no longer handed out
        const gone = await store.updateVisit(uid, "visit-long", { audio_path: null, audio_parts: null });
        expect(gone.audio_path).toBeNull();
        expect("audio_parts" in gone).toBe(false);
        // a visit made with its parts already known (a copy, a seed)
        expect(await store.upsertVisit(uid, { id: "visit-b", kind: "clinic", place: "Clinic", day: 4, audio_path: one[0].path, audio_parts: one })).toMatchObject({ audio_path: one[0].path, audio_parts: one });
        // another scope's visit never carries them
        const other = await newUser();
        await store.createAccountScope({ user_id: other, d0: "2026-08-28" });
        await store.upsertVisit(other, { id: "visit-long", kind: "clinic", place: "Clinic", day: 3 });
        expect("audio_parts" in (await store.getVisit(other, "visit-long"))!).toBe(false);
      }, t);
    });

    // C2 track H (journey 15): safety events hold his own words and are kept 90 days (lib/jobs/retention.ts)
    describe("C2 track H: retention", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("pruneSafetyEvents drops the scope's events made before the moment, keeps the later ones and every other scope's", async () => {
        let at = new Date("2026-07-01T00:00:00.000Z");
        const store = freshStore(() => at);
        const uid = await newUser();
        const other = await newUser();
        await store.createAccountScope({ user_id: uid, d0: "2026-06-30" });
        await store.createAccountScope({ user_id: other, d0: "2026-06-30" });
        await store.addSafetyEvent(uid, { input: "first", route: "explain" });
        await store.addSafetyEvent(other, { input: "theirs", route: "explain" });
        at = new Date("2026-08-01T00:00:00.000Z");
        await store.addSafetyEvent(uid, { input: "second", route: "explain" });
        at = new Date("2026-09-01T00:00:00.000Z");
        const kept = await store.addSafetyEvent(uid, { input: "third", route: "explain" });

        expect(await store.pruneSafetyEvents(uid, "2026-08-15T00:00:00.000Z")).toBe(2);
        expect((await store.listSafetyEvents(uid)).map((e) => e.id)).toEqual([kept.id]);
        expect((await store.listSafetyEvents(other)).map((e) => e.input)).toEqual(["theirs"]);
        // the moment itself is kept (strictly before goes); nothing left to drop
        expect(await store.pruneSafetyEvents(uid, kept.created_at)).toBe(0);
        expect(await store.pruneSafetyEvents(uid, "2026-08-15T00:00:00.000Z")).toBe(0);
      }, t);

      it("pruneSafetyEvents: an unknown scope is session_not_found, a non-moment is invalid", async () => {
        const store = freshStore();
        const s = await store.createSession();
        await expect(store.pruneSafetyEvents(`no-such-${randomUUID()}`, FIXED_NOW.toISOString())).rejects.toMatchObject({ code: "session_not_found" });
        await expect(store.pruneSafetyEvents(s.id, "yesterday")).rejects.toMatchObject({ code: "invalid" });
        expect(await store.pruneSafetyEvents(s.id, FIXED_NOW.toISOString())).toBe(0);
      }, t);

      // the account deletion's last check (lib/privacy/delete.ts; real-app 3.11 删除账号 step 4)
      it("countAccountRows: every column that names him is counted; after deleteAccount nothing is left, hers or his", async () => {
        const store = freshStore();
        const dad = await newUser();
        const her = await newUser();
        await store.createAccount({ user_id: dad, login_kind: "username", username: `d${dad.slice(0, 8)}` });
        await store.createAccount({ user_id: her, login_kind: "email" });
        await store.createAccountScope({ user_id: dad, d0: "2026-08-28" });
        expect(await store.countAccountRows(randomUUID())).toEqual({});

        // his records, one row or more in every table of his space
        const v = await store.upsertVisit(dad, { kind: "follow_up", place: "Blossom Family Clinic (fictional)", day: 42 });
        await store.addUtterances(dad, v.id, [{ id: `u-${randomUUID()}`, t_start_ms: 0, t_end_ms: 900, text: "first" }]);
        await store.addVisitItems(dad, v.id, [{ type: "instruction", text: "walk daily", speaker: "doctor" }]);
        await store.upsertMed(dad, { id: "med-amlodipine", origin: "prescription", status: "awaiting_label", drug_id: "amlodipine" });
        await store.setUnderstandingAnswer(dad, { medication_id: "med-amlodipine", item: "purpose", answer: "know", day: 42 });
        await store.logDose(dad, { medication_id: "med-amlodipine", day: 42, slot: "morning", state: "taken" });
        await store.addBp(dad, { day: 42, slot: "morning", systolic: 138, diastolic: 82 });
        await store.addNote(dad, { day: 42, text: "tired", source: "typed" });
        await store.addQuestion(dad, { for: "doctor", origin: "own", text: "knee pills?" });
        await store.addSafetyEvent(dad, { input: "tired", route: "log_only" });
        await store.addProfileFact(dad, { kind: "clinic", text: "Blossom", source: "patient", confirmed_by: "patient" });
        await store.addPreventDone(dad, { item_id: "flu_jab", day: 40 });
        await store.addWatchMetrics(dad, [{ day: 41, metric: "steps", value: 4000, unit: "steps" }]);
        await store.setDietCheck(dad, { day: 42, item: "less_salt", answer: "yes" });
        await store.addChatMessage(dad, { day: 42, role: "patient", text: "hello" });
        await store.addBriefSnapshot(dad, { data: { doses: 33 }, locale: "en" });
        await store.putTranslation(dad, { direction: "en>zh-Hans", source_sha256: "a".repeat(64), source_text: "walk daily", text: "每天走路", status: "checked" });
        await store.recordDelivery(dad, { kind: "dose_first", ref: "med-amlodipine", day: 42, slot: "morning" });
        // his account
        await store.setRecoveryCode(dad, "hash-1");
        await store.touchKnownDevice(dad, "dev-1", "his phone");
        await store.createResetRequest({ user_id: dad, device_hash: "dev-1", expires_at: "2026-10-09T00:10:00.000Z" });
        await store.addAccountEvent(dad, "export");
        await store.addConsentRecord({ user_id: dad, scope_id: dad, kind: "terms_privacy", decision: "granted" });
        await store.savePushSubscription({ user_id: dad, endpoint: `https://push.example/${randomUUID()}`, p256dh: "k1", auth: "a1" });
        // his link to her, and what she left in his space
        const hash = `h-${randomUUID()}`;
        const inv = await store.createInvite({ patient_id: dad, invite_token_hash: hash, invite_expires_at: "2026-10-16T00:00:00.000Z" }, { dose_summary: true });
        const id = inv.ok ? inv.link.id : "";
        await store.acceptInvite(hash, her);
        await store.confirmLink(id, dad, true);
        await store.addReminderClip(dad, { by: id, plays_at: "after_breakfast", by_user_id: her, by_label: "Wei Ling", link_id: id });
        await store.addCareAccessLog(dad, { link_id: id, family_user_id: her, family_label: "Wei Ling", route: "GET /api/family/view", items: [] });
        await store.addProfileFact(dad, { kind: "condition", text: "hepatitis B", source: "family", entered_by: "Wei Ling", entered_by_user_id: her, link_id: id });
        await store.addConsentRecord({ user_id: her, kind: "family_accept", decision: "granted" });

        const his = await store.countAccountRows(dad);
        expect(Object.keys(his).sort()).toEqual(
          [
            "session.id",
            "session.owner_user_id",
            "visit.session_id",
            "utterance.session_id",
            "visit_item.session_id",
            "medication.session_id",
            "understanding_answer.session_id",
            "dose_log.session_id",
            "bp_reading.session_id",
            "note.session_id",
            "question.session_id",
            "family_grant.session_id",
            "reminder_clip.session_id",
            "safety_event.session_id",
            "profile_fact.session_id",
            "watch_metric.session_id",
            "prevent_done.session_id",
            "diet_check.session_id",
            "chat_message.session_id",
            "brief_snapshot.session_id",
            "translation.session_id",
            "reminder_delivery.session_id",
            "account.user_id",
            "account_recovery.user_id",
            "known_device.user_id",
            "reset_request.user_id",
            "account_event.user_id",
            "consent_record.user_id",
            "consent_record.scope_id",
            "push_subscription.user_id",
            "care_link.patient_id",
            "care_grant_history.session_id",
            "care_access_log.session_id",
          ].sort(),
        );
        expect(his["profile_fact.session_id"]).toBe(2);
        expect(await store.countAccountRows(her)).toEqual({
          "account.user_id": 1,
          "consent_record.user_id": 1,
          "care_link.family_id": 1,
          "reminder_clip.by_user_id": 1,
          "care_access_log.family_user_id": 1,
          "profile_fact.entered_by_user_id": 1,
        });

        // she deletes her account: nothing names her any more, in her rows or in his space; his rows are all still his
        await store.deleteAccount(her);
        expect(await store.countAccountRows(her)).toEqual({});
        const afterHer = await store.countAccountRows(dad);
        expect(afterHer["reminder_clip.session_id"]).toBe(1);
        expect(afterHer["profile_fact.session_id"]).toBe(2);
        expect(afterHer["care_link.patient_id"]).toBeUndefined(); // the link went with her

        await store.deleteAccount(dad);
        expect(await store.countAccountRows(dad)).toEqual({});
      }, t);
    });

    describe("C2 track I: web push", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());

      it("a person removes only their own phone's subscription; a repeated subscribe moves the endpoint to the new person", async () => {
        const store = freshStore();
        const him = await newUser();
        const her = await newUser();
        const hisPhone = `https://push.example/${randomUUID()}`;
        const herPhone = `https://push.example/${randomUUID()}`;
        await store.savePushSubscription({ user_id: him, endpoint: hisPhone, p256dh: "k1", auth: "a1" });
        await store.savePushSubscription({ user_id: her, endpoint: herPhone, p256dh: "k2", auth: "a2" });
        // not hers to remove: nothing goes
        expect(await store.deleteOwnPushSubscription(her, hisPhone)).toBe(false);
        expect(await store.listPushSubscriptions(him)).toHaveLength(1);
        // his own: gone, and only that one
        expect(await store.deleteOwnPushSubscription(him, hisPhone)).toBe(true);
        expect(await store.deleteOwnPushSubscription(him, hisPhone)).toBe(false);
        expect(await store.listPushSubscriptions(him)).toEqual([]);
        expect((await store.listPushSubscriptions(her)).map((s) => s.endpoint)).toEqual([herPhone]);
        // the same browser subscribed again by someone else (a shared phone): one row, now theirs
        await store.savePushSubscription({ user_id: him, endpoint: herPhone, p256dh: "k3", auth: "a3" });
        expect(await store.listPushSubscriptions(her)).toEqual([]);
        expect((await store.listPushSubscriptions(him)).map((s) => [s.endpoint, s.p256dh])).toEqual([[herPhone, "k3"]]);
      }, t);

      // C2 track D (0015_d_push_device.sql)
      it("a subscription keeps the device it was made on; a later subscribe without one keeps it, with another replaces it", async () => {
        const store = freshStore();
        const him = await newUser();
        const phoneA = "a".repeat(64);
        const phoneB = "b".repeat(64);
        const first = `https://push.example/${randomUUID()}`;
        const second = `https://push.example/${randomUUID()}`;
        expect((await store.savePushSubscription({ user_id: him, endpoint: first, p256dh: "k1", auth: "a1", device_hash: phoneA })).device_hash).toBe(phoneA);
        expect((await store.savePushSubscription({ user_id: him, endpoint: second, p256dh: "k2", auth: "a2" })).device_hash ?? null).toBeNull();
        const byEndpoint = async () => Object.fromEntries((await store.listPushSubscriptions(him)).map((s) => [s.endpoint, s.device_hash ?? null]));
        expect(await byEndpoint()).toEqual({ [first]: phoneA, [second]: null });
        // the service worker renewing the keys sends no device: the row keeps the one it had
        await store.savePushSubscription({ user_id: him, endpoint: first, p256dh: "k1b", auth: "a1b" });
        expect(await byEndpoint()).toEqual({ [first]: phoneA, [second]: null });
        // the same endpoint subscribed from another device id (the cookie was replaced)
        await store.savePushSubscription({ user_id: him, endpoint: first, p256dh: "k1c", auth: "a1c", device_hash: phoneB });
        expect(await byEndpoint()).toEqual({ [first]: phoneB, [second]: null });
        // a hash that is not a sha256 is refused by the database's check (the memory store keeps what it is given)
        if (store.kind === "supabase") {
          await expect(store.savePushSubscription({ user_id: him, endpoint: `https://push.example/${randomUUID()}`, p256dh: "k", auth: "a", device_hash: "not-a-hash" })).rejects.toBeTruthy();
        }
      }, t);
    });

    describe("C2 track J (filming): a filming account's rows carry its own clock", () => {
      const newUser = async () => (target.newUserId ? target.newUserId() : randomUUID());
      const REAL = "2026-10-12T07:00:00.000Z"; // Mon 15:00 in Singapore
      const STORY = "2026-09-23T00:52:00.000Z"; // Wed 08:52 in Singapore, on the story's own dates

      /** Every kind of row his phone writes, into one scope; the stamps they got. */
      async function stamps(store: Store, scopeId: string, day: number): Promise<string[]> {
        const med = await store.upsertMed(scopeId, { origin: "self_bought", status: "unverified" });
        const dose = await store.logDose(scopeId, { medication_id: med.id, day, slot: "morning", state: "taken" });
        const bp = await store.addBp(scopeId, { day, slot: "morning", systolic: 138, diastolic: 84 });
        const note = await store.addNote(scopeId, { day, text: "累", source: "typed" });
        const q = await store.addQuestion(scopeId, { for: "doctor", origin: "own", text: "x?" });
        const chat = await store.addChatMessage(scopeId, { day, role: "patient", text: "x" });
        const del = await store.recordDelivery(scopeId, { kind: "dose_first", ref: "dose", day, slot: "morning" });
        const opened = await store.markDeliveryOpened(scopeId, del.delivery.id);
        return [med.created_at, dose.created_at, bp.created_at, note.created_at, q.created_at, chat.created_at, del.delivery.sent_at, opened.opened_at ?? ""];
      }

      it("rows written into a filming account with an offset carry its time; an ordinary account and a demo session keep the real time", async () => {
        const store = freshStore(() => new Date(REAL));
        const film = await newUser();
        await store.createAccountScope({ user_id: film, d0: "2026-08-24", template: "mr-tan" });
        await store.setFilmingAccount(film, true);
        await store.setClockOffset(film, Date.parse(STORY) - Date.parse(REAL));
        expect(new Set(await stamps(store, film, 30))).toEqual(new Set([STORY]));

        const plain = await newUser();
        await store.createAccountScope({ user_id: plain, d0: "2026-08-24", template: "mr-tan" });
        expect(new Set(await stamps(store, plain, 30))).toEqual(new Set([REAL]));
        const demo = await store.createSession({ story_day: 30, story_time: "08:52", ttl_hours: 1 });
        expect(new Set(await stamps(store, demo.id, 30))).toEqual(new Set([REAL]));

        // marked but not moved, and after filming ends: the real time again
        await store.setClockOffset(film, null);
        expect(new Set(await stamps(store, film, 31))).toEqual(new Set([REAL]));
        await store.setFilmingAccount(film, false);
        expect(new Set(await stamps(store, film, 32))).toEqual(new Set([REAL]));
      }, t);
    });
  });
}
