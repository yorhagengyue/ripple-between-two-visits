/**
 * seedAccount (track C): the one way an account's space is laid out, blank or Mr Tan's example on today's real dates
 * (docs/plan/real-app.md 4.1-4.4), and the example account's 「重新铺一遍」 / 「清空，从我自己的开始」 (4.7).
 *
 * The consistency rules of 4.8 that belong to the laid-out data are checked for seven consecutive "today"s (every
 * weekday): 1 nothing on or after day 42 but the planned v3, no transcript, no losartan; 2 visit dates d0 + day, the
 * bag dispensed d0 + 8, readings and notes inside the past; 3 the four missed mornings on the routine's tai chi days;
 * 6 no family link or grant, the clip has no author account. Rules 4, 5 (brief and check card numbers), 7 (pattern
 * evidence wording) and 8 (the sample visit) belong to tracks B and F.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { MemoryStore } from "@/lib/store/memory";
import type { NewAccountScope, NewProfileFact, ProfileFactRow, ReseedAccount, ScopeRoutineEntry, SessionRow } from "@/lib/store/types";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { clearExample, ensureExampleWhole, EXAMPLE_FAMILY_LABEL, EXAMPLE_PROFILE_NAME, EXAMPLE_TODAY_DAY, reseedExample, seedAccount, settingsKept } from "@/lib/story/example";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import p1Expected from "@/fixtures/visits/p1.expected.json";
import v1Expected from "@/fixtures/visits/v1.expected.json";
import v2Expected from "@/fixtures/visits/v2.expected.json";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A store whose clock the test moves. */
function clockedStore(startMs: number) {
  let t = startMs;
  const store = new MemoryStore({ now: () => new Date(t) });
  return { store, set: (ms: number) => (t = ms), at: () => t };
}

const sg = (date: string, time = "10:00") => zonedTimeToUtcMs(date, time);

function addDays(iso: string, n: number): string {
  return storyDate(iso, n);
}

function taiChiDays(scope: SessionRow): string[] {
  const routine = (scope.settings.routine ?? []) as ScopeRoutineEntry[];
  const tai = routine.find((r) => r.label === "Tai chi");
  expect(tai, "the example routine has tai chi").toBeTruthy();
  expect(Array.isArray(tai!.days)).toBe(true);
  return tai!.days as string[];
}

// seven consecutive days: every weekday once (2026-10-05 is a Monday)
const TODAYS = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays("2026-10-05", n));

describe("seedAccount: Mr Tan's example on today's dates (4.8), for every weekday", () => {
  for (const today of TODAYS) {
    it(`today ${today} (${WEEKDAYS[weekdayIndex(today, 0)]})`, async () => {
      const nowMs = sg(today, "10:00");
      const { store } = clockedStore(nowMs);
      const userId = randomUUID();
      const scope = await seedAccount(store, { userId, space: "example", nowMs });
      const d0 = addDays(today, -EXAMPLE_TODAY_DAY);

      // the scope row
      expect(scope).toMatchObject({ id: userId, kind: "account", template: "mr-tan", example_data: true, onboarding: "done", d0, story_day: 42 });
      expect(scope.tracking_since).toBe(new Date(nowMs).toISOString());
      expect(scope.settings.clinic).toBe("Blossom Family Clinic (fictional)");

      // 1. nothing on or after day 42 but the planned v3; v3 without a transcript; no losartan
      const visits = await store.listVisits(userId);
      expect(visits.map((v) => [v.id, v.day, v.status])).toEqual([
        ["v1", 0, "confirmed"],
        ["v2", 8, "confirmed"],
        ["p1", 12, "confirmed"],
        ["v3", 42, "planned"],
      ]);
      const v3 = visits.find((v) => v.id === "v3")!;
      expect(v3.audio_fixture).toBe("visit_D.wav");
      expect(await store.listUtterances(userId, "v3")).toEqual([]);
      expect(await store.listVisitItems(userId, { visit_id: "v3" })).toEqual([]);
      const meds = await store.listMeds(userId);
      expect(meds.map((m) => m.id).sort()).toEqual(["med-amlodipine", "med-ibuprofen", "med-relative-box"]);
      const doses = await store.listDoses(userId);
      const bp = await store.listBp(userId);
      const notes = await store.listNotes(userId);
      expect(doses).toHaveLength(33);
      expect(bp).toHaveLength(24);
      expect(notes).toHaveLength(2);
      for (const r of [...doses, ...bp, ...notes]) expect(r.day).toBeLessThan(EXAMPLE_TODAY_DAY);

      // 2. dates: visits at d0 + day, the bag dispensed at d0 + 8, the readings and notes in the past
      for (const v of visits) expect(v.date).toBe(storyDate(d0, v.day));
      expect(v3.date).toBe(today);
      expect(meds.find((m) => m.id === "med-amlodipine")!.label!.dispensed).toBe(storyDate(d0, 8));
      for (const r of [...bp, ...notes]) {
        expect(r.day).toBeGreaterThanOrEqual(0);
        expect(storyDate(d0, r.day) < today).toBe(true);
      }

      // 3. the four missed mornings fall on the routine's tai chi days (rotated with d0)
      const missed = doses.filter((d) => d.state === "missed");
      expect(missed.map((d) => d.day)).toEqual([15, 17, 24, 36]);
      const tai = taiChiDays(scope);
      for (const d of missed) expect(tai).toContain(WEEKDAYS[weekdayIndex(d0, d.day)]);

      // the six questions: what v3 answers is still open; the pattern question is worded from his log
      const questions = await store.listQuestions(userId);
      expect(questions.map((q) => q.id)).toEqual(["q-machine", "q-knee-1", "q-relative-box", "q-extra-tablet", "q-tai-chi", "q-knee-2"]);
      const extra = questions.find((q) => q.id === "q-extra-tablet")!;
      expect(extra).toMatchObject({ status: "open", answer_text: null, answer_visit_id: null });
      // an answer from a past visit is linked to its line in that visit's recording (the time point on his list)
      expect(Object.fromEntries(questions.filter((q) => q.status === "answered").map((q) => [q.id, q.answer_utterance_id]))).toEqual({
        "q-machine": "v1-u12",
        "q-knee-1": "v2-u11",
        "q-relative-box": "p1-u03",
      });
      const taiQ = questions.find((q) => q.id === "q-tai-chi")!;
      expect(taiQ.status).toBe("open");
      expect(taiQ.evidence).toMatch(/^pattern:tai_chi/);

      // 6. no family link or switches; the clip has no author account
      expect(await store.getFamilyGrant(userId, "wei-ling")).toBeNull();
      expect(await store.listCareLinks({ patient_id: userId })).toEqual([]);
      const clips = await store.listReminderClips(userId);
      expect(clips).toHaveLength(1);
      expect(clips[0].by_user_id ?? null).toBeNull();
      expect(clips[0].by_label).toBe(EXAMPLE_FAMILY_LABEL);

      // his profile: 「陈先生（示例）」 and the persona's other facts, his own and confirmed
      const facts = await store.listProfileFacts(userId);
      expect(facts.map((f) => f.kind)).toEqual(["name", "age", "home", "language"]);
      expect(facts[0]).toMatchObject({ text: EXAMPLE_PROFILE_NAME, source: "patient", confirmed_by: "patient" });
      for (const f of facts) expect(f).toMatchObject({ source: "patient", confirmed_by: "patient", created_day: 0 });
    });
  }
});

describe("seedAccount: the past visits keep their transcripts, speakers confirmed", () => {
  it("v1, v2 and p1 hold every line of their recordings with the right speaker; v3 has none; the answers point at their lines", async () => {
    const nowMs = sg("2026-10-10", "10:00");
    const { store } = clockedStore(nowMs);
    const userId = randomUUID();
    await seedAccount(store, { userId, space: "example", nowMs });
    const answers: Record<string, { answers: { id: string; true_role: string }[] }> = { v1: v1Expected, v2: v2Expected, p1: p1Expected };
    for (const visit of ["v1", "v2", "p1"]) {
      const rows = await store.listUtterances(userId, visit);
      const truth = answers[visit].answers;
      expect(rows.map((u) => u.id)).toEqual(truth.map((a) => a.id));
      for (const u of rows) {
        expect(u.role, `${u.id} speaker`).toBe(truth.find((a) => a.id === u.id)!.true_role);
        expect(u.role_state, u.id).toBe("confirmed");
        expect(u.scripted_fallback).toBe(false);
      }
    }
    expect((await store.listUtterances(userId, "v2")).find((u) => u.id === "v2-u08")?.clip_path).toBe("visits/clips/v2-u08.wav");
    expect(await store.listUtterances(userId, "v3")).toEqual([]);
  });
});

describe("seedAccount: a blank space", () => {
  it("d0 today, onboarding started, tracking from now, no rows and no template data", async () => {
    const nowMs = sg("2026-10-10", "21:30");
    const { store } = clockedStore(nowMs);
    const userId = randomUUID();
    const scope = await seedAccount(store, { userId, space: "blank", nowMs, settings: { locale: "en" } });
    expect(scope).toMatchObject({ id: userId, kind: "account", template: "blank", example_data: false, onboarding: "started", d0: "2026-10-10", story_day: 0 });
    expect(scope.tracking_since).toBe(new Date(nowMs).toISOString());
    expect(scope.settings).toEqual({ locale: "en" });
    expect(await store.listVisits(userId)).toEqual([]);
    expect(await store.listMeds(userId)).toEqual([]);
    expect(await store.listQuestions(userId)).toEqual([]);
    expect(await store.listProfileFacts(userId)).toEqual([]);
    expect(await store.listReminderClips(userId)).toEqual([]);
  });

  it("near midnight in Singapore the day is Singapore's, whatever the machine's zone", async () => {
    // 2026-10-10 23:59 in Singapore is 15:59 UTC the same day; 00:01 the next day is 16:01 UTC
    for (const [time, date] of [
      ["23:59", "2026-10-10"],
      ["00:01", "2026-10-11"],
    ] as const) {
      const nowMs = sg(date, time);
      const { store } = clockedStore(nowMs);
      const scope = await seedAccount(store, { userId: randomUUID(), space: "example", nowMs });
      expect(scope.d0).toBe(addDays(date, -42));
      expect(scope.story_day).toBe(42);
    }
  });
});

describe("the developer helper lays out the same spaces", () => {
  it("space example: the example profile and the pattern question come with it", async () => {
    const nowMs = sg("2026-10-10", "09:00");
    const { store } = clockedStore(nowMs);
    const a = await createAccountWithSpace(store, new MemoryAuthProvider(), { login: `c${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" }, { nowMs });
    expect(a.scope).toMatchObject({ example_data: true, onboarding: "done", story_day: 42 });
    const facts = await store.listProfileFacts(a.userId);
    expect(facts.find((f) => f.kind === "name")?.text).toBe(EXAMPLE_PROFILE_NAME);
    expect((await store.getQuestion(a.userId, "q-tai-chi"))?.evidence).toMatch(/^pattern:tai_chi/);
  });

  it("space blank keeps the helper's own default (onboarding done) unless told otherwise", async () => {
    const nowMs = sg("2026-10-10", "09:00");
    const { store } = clockedStore(nowMs);
    const auth = new MemoryAuthProvider();
    const done = await createAccountWithSpace(store, auth, { login: `c${randomUUID().slice(0, 10)}`, password: "a long test password" }, { nowMs });
    expect(done.scope).toMatchObject({ template: "blank", onboarding: "done", example_data: false });
    const started = await createAccountWithSpace(store, auth, { login: `c${randomUUID().slice(0, 10)}`, password: "a long test password", onboarding: "started" }, { nowMs });
    expect(started.scope).toMatchObject({ template: "blank", onboarding: "started" });
  });
});

describe("the example account's two buttons (4.7)", () => {
  async function exampleWithChanges() {
    const first = sg("2026-10-08", "10:00");
    const clock = clockedStore(first);
    const { store } = clock;
    const userId = randomUUID();
    let scope = await seedAccount(store, { userId, space: "example", nowMs: first, settings: { locale: "en" } });
    // he used it for a while: a note, a question of his own, a family invitation with switches
    await store.addNote(userId, { day: 42, text: "my own note", source: "typed" });
    await store.addQuestion(userId, { for: "doctor", origin: "own", text: "my own question" });
    const invited = await store.createInvite(
      { patient_id: userId, family_label: "Wei Ling", invite_token_hash: "a".repeat(64), invite_expires_at: new Date(first + 7 * 86_400_000).toISOString() },
      { dose_summary: true },
    );
    expect(invited.ok).toBe(true);
    await store.updateScope(userId, { settings: { example_intro_dismissed: true, reminder_time: "08:00" } });
    scope = (await store.getSession(userId))!;
    return { ...clock, userId, scope, linkId: invited.ok ? invited.link.id : "" };
  }

  it("lay it out again: today's dates, his own rows gone, the example back once, links and his language kept", async () => {
    const { store, set, userId, scope, linkId } = await exampleWithChanges();
    const later = sg("2026-10-10", "11:15");
    set(later);
    const row = await reseedExample(store, scope, { nowMs: later });
    expect(row).toMatchObject({ d0: addDays("2026-10-10", -42), story_day: 42, example_data: true, onboarding: "done", template: "mr-tan" });
    expect(row.tracking_since).toBe(new Date(later).toISOString());
    expect(row.settings.locale).toBe("en");
    expect(row.settings.example_intro_dismissed).toBeUndefined();
    expect(row.settings.reminder_time).toBeUndefined();
    expect((await store.listNotes(userId)).map((n) => n.text)).not.toContain("my own note");
    expect((await store.listQuestions(userId)).map((q) => q.text)).not.toContain("my own question");
    expect(await store.listQuestions(userId)).toHaveLength(6);
    expect((await store.listProfileFacts(userId)).map((f) => f.kind)).toEqual(["name", "age", "home", "language"]);
    expect((await store.listVisits(userId)).find((v) => v.id === "v3")).toMatchObject({ status: "planned", date: "2026-10-10" });
    // the people stay: her link and its switches are not part of the timeline
    expect((await store.getCareLink(linkId))?.status).toBe("invited");
    expect((await store.getFamilyGrant(userId, linkId))?.items.dose_summary).toBe(true);
    // the missed mornings stay on the new tai chi days
    const tai = taiChiDays(row);
    for (const d of (await store.listDoses(userId)).filter((x) => x.state === "missed")) expect(tai).toContain(WEEKDAYS[weekdayIndex(row.d0!, d.day)]);
  });

  it("start from my own: a blank space from today, onboarding again, only his language kept", async () => {
    const { store, set, userId, scope, linkId } = await exampleWithChanges();
    const later = sg("2026-10-10", "11:15");
    set(later);
    const row = await clearExample(store, scope, { nowMs: later });
    expect(row).toMatchObject({ template: "blank", example_data: false, onboarding: "started", d0: "2026-10-10", story_day: 0 });
    expect(row.tracking_since).toBe(new Date(later).toISOString());
    expect(row.settings).toEqual({ locale: "en" });
    for (const rows of [
      await store.listVisits(userId),
      await store.listMeds(userId),
      await store.listDoses(userId),
      await store.listBp(userId),
      await store.listNotes(userId),
      await store.listQuestions(userId),
      await store.listReminderClips(userId),
      await store.listProfileFacts(userId),
    ])
      expect(rows).toEqual([]);
    expect((await store.getCareLink(linkId))?.status).toBe("invited");
  });

  it("settingsKept drops only the timeline's keys", () => {
    expect(settingsKept({ locale: "zh-Hans", clinic: "x", routine: [], reminder_time: "08:00", onboarding_step: "meds", example_intro_dismissed: true, push_prefs: { a: 1 } })).toEqual({
      locale: "zh-Hans",
      push_prefs: { a: 1 },
    });
    expect(settingsKept(null)).toEqual({});
  });
});

describe("the example is laid out in one step (real-app 4.1 line 904; migration 0014)", () => {
  /** A store whose separate writes of transcripts and profile facts always fail: only the layout's one call can bring them. */
  class NoFollowUps extends MemoryStore {
    override async addProfileFact(): Promise<never> {
      throw new Error("a separate profile fact write");
    }
    override async addUtterances(): Promise<never> {
      throw new Error("a separate transcript write");
    }
  }

  /** A database whose seed function predates 0014: the layout's call ignores the two tables. `failFacts` cuts a follow-up short. */
  class OldSeedFunction extends MemoryStore {
    failFacts = 0;
    override async createAccountScope(scope: NewAccountScope): Promise<SessionRow> {
      return super.createAccountScope({ ...scope, tables: { ...scope.tables, utterances: [], profile_facts: [] } });
    }
    override async reseedAccount(scopeId: string, reseed: ReseedAccount): Promise<SessionRow> {
      return super.reseedAccount(scopeId, { ...reseed, tables: { ...reseed.tables, utterances: [], profile_facts: [] } });
    }
    override async addProfileFact(sessionId: string, fact: NewProfileFact): Promise<ProfileFactRow> {
      if (this.failFacts > 0 && fact.id === "fact-home") {
        this.failFacts--;
        throw new Error("the database went away");
      }
      return super.addProfileFact(sessionId, fact);
    }
  }

  const whole = async (store: MemoryStore, userId: string) => ({
    facts: (await store.listProfileFacts(userId)).map((f) => f.id).sort(),
    lines: [(await store.listUtterances(userId, "v1")).length, (await store.listUtterances(userId, "v2")).length, (await store.listUtterances(userId, "p1")).length],
  });
  const WHOLE = { facts: ["fact-age", "fact-home", "fact-languages", "fact-name"] };

  it("the transcripts and the profile facts come with the layout's own call, at sign-up and at 「重新铺一遍」", async () => {
    const nowMs = sg("2026-10-10", "10:00");
    const reference = new MemoryStore({ now: () => new Date(nowMs) });
    const refId = randomUUID();
    await seedAccount(reference, { userId: refId, space: "example", nowMs });
    const ref = await whole(reference, refId);
    expect(ref.facts).toEqual(WHOLE.facts);
    expect(ref.lines.every((n) => n > 0)).toBe(true);

    const store = new NoFollowUps({ now: () => new Date(nowMs) });
    const userId = randomUUID();
    const scope = await seedAccount(store, { userId, space: "example", nowMs });
    expect(await whole(store, userId)).toEqual(ref);
    // the rows are the same rows a separate write would have made
    const strip = <T extends { session_id: string }>(rows: T[]) => rows.map((r) => ({ ...r, session_id: "" }));
    expect(strip(await store.listProfileFacts(userId))).toEqual(strip(await reference.listProfileFacts(refId)));
    expect(strip(await store.listUtterances(userId, "v2"))).toEqual(strip(await reference.listUtterances(refId, "v2")));
    // a reseed: the old rows go and the new ones are whole again, in its one call
    await store.updateProfileFact(userId, "fact-name", { hidden: true });
    await reseedExample(store, scope, { nowMs: nowMs + 60_000 });
    expect(await whole(store, userId)).toEqual(ref);
    expect((await store.listProfileFacts(userId)).find((f) => f.id === "fact-name")?.hidden ?? null).toBeNull();
    // nothing is missing, so the check writes nothing (and would have thrown here if it tried)
    expect(await ensureExampleWhole(store, (await store.getSession(userId))!)).toBe(false);
  });

  it("a database without 0014: what the call left out is written right after, and a cut-short run is completed on his next page", async () => {
    const nowMs = sg("2026-10-10", "10:00");
    const store = new OldSeedFunction({ now: () => new Date(nowMs) });
    const userId = randomUUID();
    const reference = new MemoryStore({ now: () => new Date(nowMs) });
    const refId = randomUUID();
    await seedAccount(reference, { userId: refId, space: "example", nowMs });
    const ref = await whole(reference, refId);

    await seedAccount(store, { userId, space: "example", nowMs });
    expect(await whole(store, userId)).toEqual(ref);

    // 「重新铺一遍」 fails halfway through the follow-up: the example is short of facts ...
    store.failFacts = 1;
    const scope = (await store.getSession(userId))!;
    await expect(reseedExample(store, scope, { nowMs: nowMs + 60_000 })).rejects.toThrow("the database went away");
    const half = await whole(store, userId);
    expect(half.facts).toEqual(["fact-age", "fact-name"]);
    expect(half.lines).toEqual(ref.lines);
    // ... until he opens a page (app/p/layout.tsx): exactly what is missing is written, once
    const now = (await store.getSession(userId))!;
    expect(await ensureExampleWhole(store, now)).toBe(true);
    expect(await whole(store, userId)).toEqual(ref);
    expect(await ensureExampleWhole(store, now)).toBe(false);
    expect((await store.listProfileFacts(userId)).length).toBe(4);
    // his own account (not the example) is never touched
    const blank = await seedAccount(store, { userId: randomUUID(), space: "blank", nowMs });
    expect(await ensureExampleWhole(store, blank)).toBe(false);
    expect(await store.listProfileFacts(blank.id)).toEqual([]);
  });
});
