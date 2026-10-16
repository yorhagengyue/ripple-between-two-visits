/**
 * Filming, the second round (C2 track J; integrator 10-10, issues 1-4), every change with its proof that demo sessions
 * and ordinary accounts are unchanged:
 *
 *   1. a filming account's rows carry its own clock: his 吃了 reads 「早上 8:52 吃的」 in the story's time on Today, the
 *      medicines he adds or marks start on that clock (lib/meds/write.ts, the slots route), and the check card's start
 *      goes back on the app's clock before it reaches the dose day (lib/store/scope.ts appMsOf); the store's own part is
 *      in the store contract (memory and PGlite)
 *   2. his phone follows the director: account.changed is a refresh event
 *   3. the crew's scripted fallback on a filming account: the route opens for it (crew and his own sign-in), a sentence
 *      the whole transcript misheard shows the scene's script line; the director's switch
 *   4. the example's sample material (the sample visit replay, the sample labels) for a filming account on a crew request
 *
 * Real time is the developer test clock, frozen at Mon 12 Oct 2026 15:00 in Singapore.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as sampleGet } from "@/app/api/labels/sample/route";
import { POST as slotsPost } from "@/app/api/doses/slots/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { filmingRef, findFilming, FilmingError, markFilming, moveForward, seedToMoment, setFilmingFallback } from "@/lib/crew/filming-account";
import { accountToday } from "@/lib/daily/account-today";
import { answerDose } from "@/lib/daily/doses";
import { todayDoseData } from "@/lib/daily/today-view";
import { addManualMed, setMedPatientStatus } from "@/lib/meds/write";
import { CREW_COOKIE, crewCookieValue, resetCrewAttempts } from "@/lib/session/crew-key";
import { REFRESH_EVENT_TYPES } from "@/lib/session/events";
import { appMsOf, samplesAllowed, scopeNow } from "@/lib/store/scope";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import type { SessionRow, Store } from "@/lib/store/types";
import { filmingEntry } from "@/lib/subject/filming";
import type { Subject } from "@/lib/subject/types";
import { setTestClock } from "@/lib/time/now";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import { finalizeVisit, setScriptedFallback, startVisit } from "@/lib/visit/pipeline";

const PASSWORD = "a long test password";
const REAL = Date.parse("2026-10-12T15:00:00+08:00");
const STORY_0852 = "2026-09-23T00:52:00.000Z"; // Wed 23 Sep 08:52 in Singapore: the story's own date
const CREW = `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`;
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function account(store: Store, space: "example" | "blank"): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: login("j"), password: PASSWORD, space });
}

/** A filming account laid out to `scene` (and moved on to `forward` when given), with its crew subject. */
async function filming(store: Store, scene: string, forward?: { time: string; date?: string }): Promise<{ him: TestAccount; subject: Subject; scope: () => Promise<SessionRow> }> {
  const him = await account(store, "example");
  const scope = async () => (await store.getSession(him.userId))!;
  await markFilming(store, await scope());
  const subject = (await findFilming(filmingRef(him.userId), filmingEntry(store)))!;
  await seedToMoment(subject, { scene }, REAL);
  if (forward) await moveForward(subject, forward, REAL);
  return { him, subject, scope };
}

function req(path: string, method: string, cookies: string[], body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: cookies.join("; ") },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(() => setTestClock({ at: REAL, frozen: true }));
afterAll(() => setTestClock(null));
beforeEach(() => resetCrewAttempts());

// ---------------------------------------------------------------- 1. the story's clock on what he writes

describe("1. what he writes while filming carries the story's time", () => {
  const store = new MemoryStore();

  it("his 吃了 at 8:52 on the story's 23 Sep is stamped 08:52 and reads 「8:52」 on Today; an ordinary account's is the real time", async () => {
    const f = await filming(store, "d29-hero", { time: "08:52" });
    const s = await f.scope();
    expect([s.story_day, s.story_time]).toEqual([30, "08:52"]);
    const dose = await answerDose(store, s, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, REAL);
    expect(dose.created_at).toBe(STORY_0852);
    const today = await accountToday(store, await f.scope(), REAL, {}, "zh-Hans");
    const data = todayDoseData(today, "zh-Hans", "Asia/Singapore");
    const cell = [data.focus?.slot, ...data.others].find((x) => x?.slot === "morning")?.meds[0];
    expect([cell?.state, cell?.answeredTime]).toEqual(["taken", "08:52"]);

    const plain = await account(store, "example");
    const ps = (await store.getSession(plain.userId))!;
    const his = await answerDose(store, ps, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, REAL);
    expect(his.created_at).toBe(new Date(REAL).toISOString());
  });

  it("a medicine he types in or marks while filming starts on the story's clock; an ordinary account's on the real one", async () => {
    const f = await filming(store, "d29-hero", { time: "08:52" });
    const { med } = await addManualMed({ sessionId: f.him.userId, name: "Panadol", origin: "self_bought", slots: [], locale: "zh-Hans" }, { store });
    expect([med.start_at, med.created_at]).toEqual([STORY_0852, STORY_0852]);
    const { med: marked } = await setMedPatientStatus({ sessionId: f.him.userId, medId: "med-relative-box", status: "not_taking", locale: "zh-Hans" }, { store });
    expect((marked.label as { patient_status_at?: string }).patient_status_at).toBe(STORY_0852);

    const plain = await account(store, "example");
    const { med: own } = await addManualMed({ sessionId: plain.userId, name: "Panadol", origin: "self_bought", slots: [], locale: "zh-Hans" }, { store });
    expect(own.start_at).toBe(new Date(REAL).toISOString());
  });

  it("a stamp on the story's clock goes back on the app's clock (the check card's start): the same instant for every other scope", () => {
    const film = { kind: "account" as const, filming: true, clock_offset_ms: -1_700_000_000 };
    expect(appMsOf(film, scopeNow(film, REAL))).toBe(REAL);
    expect(appMsOf({ kind: "account", filming: false, clock_offset_ms: null }, REAL)).toBe(REAL);
    expect(appMsOf({ kind: "account", filming: true, clock_offset_ms: null }, REAL)).toBe(REAL);
    expect(appMsOf({ kind: "sandbox", filming: false, clock_offset_ms: null }, REAL)).toBe(REAL);
  });
});

describe("1. the slot he chooses (POST /api/doses/slots) starts a filming account's medicine on its clock", () => {
  const store = getMemoryStore();

  it("filming: the story's 08:52; ordinary: the real time", async () => {
    const f = await filming(store, "d29-hero", { time: "08:52" });
    const plain = await account(store, "example");
    for (const [who, want] of [
      [f.him, STORY_0852],
      [plain, new Date(REAL).toISOString()],
    ] as const) {
      await store.upsertMed(who.userId, { id: "med-chosen", origin: "prescription", status: "awaiting_label", drug_id: "losartan", start_day: 0 });
      const res = await slotsPost(req("/api/doses/slots", "POST", [`rp_at=${who.tokens.access_token}`], { medication_id: "med-chosen", slots: ["morning"] }));
      expect(res.status).toBe(200);
      expect((await store.getMed(who.userId, "med-chosen"))?.start_at).toBe(want);
    }
  });
});

// ---------------------------------------------------------------- 2. his phone follows the director

describe("2. his phone reads the page again when the director moves his clock", () => {
  it("account.changed is a refresh event (the demo's own events stay as they are)", () => {
    expect(REFRESH_EVENT_TYPES.has("account.changed")).toBe(true);
    for (const t of ["clock.changed", "session.reset", "dose.logged"]) expect(REFRESH_EVENT_TYPES.has(t)).toBe(true);
  });
});

// ---------------------------------------------------------------- 3. the scripted fallback

describe("3. the crew's scripted fallback on a filming account", () => {
  const store = getMemoryStore();
  const heardRight = { tStartMs: 1500, tEndMs: 4192, speaker: 0, text: "So how were the readings at home?", lang: "en" };
  const misheard = { tStartMs: 4892, tEndMs: 7199, speaker: 1, text: "zzz qqq xxx www", lang: "en" };

  it("the route: an ordinary account is 404 whatever the crew; a filming account on his own phone with the crew's cookie switches it", async () => {
    const plain = await account(store, "example");
    const pv = await startVisit(store, (await store.getSession(plain.userId))!, { mode: "record", consent: { given: true } });
    const no = await scriptedPost(req(`/api/visits/${pv.id}/scripted`, "POST", [`rp_at=${plain.tokens.access_token}`, CREW], { on: true }), { params: Promise.resolve({ id: pv.id }) });
    expect([no.status, (await no.json()).error]).toEqual([404, "not_found"]);

    const f = await filming(store, "d8-visit");
    const started = await visitsPost(req("/api/visits", "POST", [`rp_at=${f.him.tokens.access_token}`], { mode: "record", consent: { given: true }, place: "clinic" }));
    expect(started.status).toBe(200);
    const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
    // without the crew's credential: the route does not exist for his phone either
    const bare = await scriptedPost(req(`/api/visits/${visitId}/scripted`, "POST", [`rp_at=${f.him.tokens.access_token}`], { on: true }), { params: Promise.resolve({ id: visitId }) });
    expect(bare.status).toBe(404);
    const on = await scriptedPost(req(`/api/visits/${visitId}/scripted`, "POST", [`rp_at=${f.him.tokens.access_token}`, CREW], { on: true }), { params: Promise.resolve({ id: visitId }) });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ fallback: { allowed: true, on: true, unlockable: false } });
  });

  it("with it on, the whole transcript's misheard sentence shows the scene's script line (the second visit's), marked; off, nothing changes", async () => {
    for (const fallback of [true, false]) {
      const f = await filming(store, "d8-visit");
      const scope = await f.scope();
      const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
      expect(visit.id).not.toBe("v2"); // a new visit row: v2 keeps its sample recording for the replay
      // the crew's switch (the route asked the gate); a filming account is a filming scope, nothing else to unlock
      if (fallback) await setScriptedFallback(store, scope, visit.id, true);
      await finalizeVisit(store, scope, visit.id, { status: "done", source: "audio", utterances: [heardRight, misheard] });
      const lines = await store.listUtterances(scope.id, visit.id);
      const second = lines.find((u) => u.t_start_ms === misheard.tStartMs)!;
      const first = lines.find((u) => u.t_start_ms === heardRight.tStartMs)!;
      expect(first.text).toBe(heardRight.text);
      expect([second.text, second.scripted_fallback]).toEqual(fallback ? ["Okay lah. Around 130, I think.", true] : [misheard.text, false]);
    }
  });

  it("a demo filming session's whole transcript is as before (the live captions keep the demo's fallback)", async () => {
    const demo = await store.createSession({ kind: "filming", filming_mode: true, story_day: 8, story_time: "10:00" });
    const visit = await startVisit(store, demo, { mode: "record", consent: { given: true } });
    await setScriptedFallback(store, demo, visit.id, true);
    await finalizeVisit(store, demo, visit.id, { status: "done", source: "audio", utterances: [heardRight, misheard] });
    const second = (await store.listUtterances(demo.id, visit.id)).find((u) => u.t_start_ms === misheard.tStartMs)!;
    expect([second.text, second.scripted_fallback]).toEqual([misheard.text, false]);
  });

  it("the director's switch: refused in words before the visit starts; on for the visit being recorded, with the scene's script", async () => {
    const f = await filming(store, "d8-visit");
    await expect(setFilmingFallback(f.subject, true)).rejects.toMatchObject({ code: "no_visit" });
    await expect(setFilmingFallback(f.subject, true)).rejects.toBeInstanceOf(FilmingError);
    const visit = await startVisit(store, await f.scope(), { mode: "record", consent: { given: true } });
    expect(await setFilmingFallback(f.subject, true)).toEqual({ visit: visit.id, date: "2026-09-01", on: true, script: true });
    expect((await setFilmingFallback(f.subject, false)).on).toBe(false);
  });
});

// ---------------------------------------------------------------- 4. the sample material

describe("4. the example's samples for a filming account, on a crew request only", () => {
  const store = getMemoryStore();
  const sample = (cookies: string[]) => sampleGet(req("/api/labels/sample?name=amlodipine", "GET", cookies));

  it("the rule: the example account; a filming account when the crew asks; no other account, whoever asks", () => {
    expect(samplesAllowed({ kind: "account", example_data: true, filming: false }, false)).toBe(true);
    expect(samplesAllowed({ kind: "account", example_data: false, filming: true }, true)).toBe(true);
    expect(samplesAllowed({ kind: "account", example_data: false, filming: true }, false)).toBe(false);
    expect(samplesAllowed({ kind: "account", example_data: false, filming: false }, true)).toBe(false);
    expect(samplesAllowed({ kind: "sandbox", example_data: false, filming: false }, true)).toBe(false);
  });

  it("GET /api/labels/sample: a filming account with the crew's cookie gets the photo; without it, or an ordinary account with it, 403", async () => {
    const f = await filming(store, "d8-visit");
    const plain = await account(store, "blank");
    const example = await account(store, "example");
    expect((await sample([`rp_at=${f.him.tokens.access_token}`])).status).toBe(403);
    const ok = await sample([`rp_at=${f.him.tokens.access_token}`, CREW]);
    expect([ok.status, ok.headers.get("content-type")]).toEqual([200, "image/png"]);
    const no = await sample([`rp_at=${plain.tokens.access_token}`, CREW]);
    expect([no.status, (await no.json()).error]).toEqual([403, "example_only"]);
    expect((await sample([`rp_at=${example.tokens.access_token}`])).status).toBe(200);
  });
});
