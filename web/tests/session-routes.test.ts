/**
 * M0 session, clock, director and dose routes, called directly (no server). Checks the response, the
 * store, the cookies and the bus events each route publishes.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as clockPOST } from "@/app/api/clock/route";
import { POST as cuePOST } from "@/app/api/director/cue/route";
import { POST as filmingPOST } from "@/app/api/director/filming/route";
import { GET as dosesGET, POST as dosesPOST } from "@/app/api/doses/route";
import { POST as joinPOST } from "@/app/api/session/join/route";
import { POST as resetPOST } from "@/app/api/session/reset/route";
import { GET as sessionGET, POST as sessionPOST } from "@/app/api/session/route";
import { getBus } from "@/lib/bus";
import type { DoseLoggedData, NoReplyCueData, ReminderCueData } from "@/lib/session/events";
import { getMemoryStore } from "@/lib/store/memory";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import type { DemoSessionRow, DoseLogRow, SessionRow } from "@/lib/store/types";

const BASE = "http://localhost:3200";
/** M8 judge-link gating: filming sessions and filming mode on need the crew key (lib/session/crew-key.ts). */
const CREW = DEV_ONLY_CREW_KEY;

function post(path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The film crew's request (lib/crew/gate.ts): the story clock, the cues, filming mode and reset are the crew's only. */
function crewPost(path: string, body?: unknown): NextRequest {
  return post(path, body, { "x-ripple-crew-key": CREW });
}

async function newSession(body: Record<string, unknown> = {}): Promise<DemoSessionRow> {
  const res = await sessionPOST(post("/api/session", body));
  expect(res.status).toBe(201);
  return (await res.json()).session as DemoSessionRow;
}

const types = (sessionId: string) => getBus().recent(sessionId).map((e) => e.type);

describe("POST /api/session", () => {
  it("creates a judge sandbox that expires, seeded on D29, and sets the cookies", async () => {
    const res = await sessionPOST(post("/api/session"));
    expect(res.status).toBe(201);
    const { session, member } = await res.json();
    expect(session).toMatchObject({ template: "mr-tan", story_day: 29, story_time: null, filming_mode: false });
    expect(session.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const hours = (Date.parse(session.expires_at) - Date.parse(session.created_at)) / 3_600_000;
    expect(hours).toBe(48);
    expect(member).toMatchObject({ role: "judge", session_id: session.id });
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toContain(`rp_session=${session.id}`);
    expect(cookies).toContain(`rp_member=${member.id}`);
    expect(cookies).toContain("rp_role=judge");
    expect((await getMemoryStore().listDoses(session.id)).length).toBe(33);
  });

  it("creates a filming session without expiry for the director", async () => {
    const res = await sessionPOST(post("/api/session", { kind: "filming", story_day: 0, story_time: "09:30", crew_key: CREW }));
    const { session, member } = await res.json();
    expect(session).toMatchObject({ expires_at: null, story_day: 0, story_time: "09:30" });
    expect(member.role).toBe("director");
  });

  it("rejects bad bodies", async () => {
    expect((await sessionPOST(post("/api/session", { kind: "party" }))).status).toBe(400);
    expect((await sessionPOST(post("/api/session", { story_time: "25:00" }))).status).toBe(400);
    expect((await sessionPOST(post("/api/session", { extra: 1 }))).status).toBe(400);
    const notJson = new NextRequest(`${BASE}/api/session`, { method: "POST", body: "{" });
    expect((await sessionPOST(notJson)).status).toBe(400);
  });

  it("GET returns the current session from ?session= or the cookie", async () => {
    const s = await newSession();
    const byQuery = await sessionGET(new NextRequest(`${BASE}/api/session?session=${s.id}`));
    expect((await byQuery.json()).session.id).toBe(s.id);
    const byCookie = await sessionGET(new NextRequest(`${BASE}/api/session`, { headers: { cookie: `rp_session=${s.id}` } }));
    const body = await byCookie.json();
    expect(body.session.id).toBe(s.id);
    expect(body.members.map((m: { role: string }) => m.role)).toEqual(["judge"]);
    expect((await sessionGET(new NextRequest(`${BASE}/api/session`))).status).toBe(400);
    expect((await sessionGET(new NextRequest(`${BASE}/api/session?session=nope`))).status).toBe(404);
  });
});

describe("POST /api/session/join", () => {
  it("joins by code (any case), records the member, sends the role home", async () => {
    const s = await newSession({ kind: "filming", crew_key: CREW });
    const res = await joinPOST(post("/api/session/join", { code: s.join_code.toLowerCase(), role: "patient" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe(s.id);
    expect(body.next).toBe("/p/today");
    expect(res.headers.getSetCookie().join("\n")).toContain(`rp_session=${s.id}`);
    expect((await getMemoryStore().listMembers(s.id)).map((m) => m.role)).toEqual(["director", "patient"]);
    expect(types(s.id)).toContain("session.member_joined");

    const fam = await joinPOST(post("/api/session/join", { code: s.join_code, role: "family" }));
    expect((await fam.json()).next).toBe("/f");
  });

  it("404 for an unknown code, 400 for a bad role", async () => {
    expect((await joinPOST(post("/api/session/join", { code: "ZZZZZZ", role: "patient" }))).status).toBe(404);
    expect((await joinPOST(post("/api/session/join", { code: "ZZZZZZ", role: "doctor" }))).status).toBe(400);
  });
});

describe("POST /api/doses", () => {
  it("records the tick for the story day and publishes dose.logged to that session only", async () => {
    const s = await newSession({ story_day: 15 });
    const other = await newSession({ story_day: 15 });
    const res = await dosesPOST(post(`/api/doses?session=${s.id}`, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }));
    expect(res.status).toBe(200);
    const { dose } = (await res.json()) as { dose: DoseLogRow };
    expect(dose).toMatchObject({ day: 15, slot: "morning", state: "taken", id: "dose-d15-med-amlodipine-morning" });

    const events = getBus().recent(s.id);
    expect(events.map((e) => e.type)).toEqual(["dose.logged"]);
    const data = events[0].data as DoseLoggedData;
    expect(data).toMatchObject({ name: "Amlodipine", by: "patient", dose: { state: "taken", day: 15 } });
    expect(events[0].say).toContain("taken");
    expect(getBus().recent(other.id)).toEqual([]);

    const list = await dosesGET(new NextRequest(`${BASE}/api/doses?session=${other.id}&from=15&to=15`));
    expect((await list.json()).doses.map((d: DoseLogRow) => d.state)).toEqual(["missed"]);
  });

  it("validates the session, the medicine and the body", async () => {
    const s = await newSession();
    const body = { medication_id: "med-amlodipine", slot: "morning", state: "taken" };
    expect((await dosesPOST(post("/api/doses", body))).status).toBe(400);
    expect((await dosesPOST(post("/api/doses?session=nope", body))).status).toBe(404);
    expect((await dosesPOST(post(`/api/doses?session=${s.id}`, { ...body, medication_id: "med-nope" }))).status).toBe(404);
    expect((await dosesPOST(post(`/api/doses?session=${s.id}`, { ...body, state: "maybe" }))).status).toBe(400);
  });
});

describe("POST /api/clock", () => {
  it("steps through beats, jumps to days, and broadcasts clock.changed with the session row", async () => {
    const s = await newSession();
    const next = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { beat: "next" }));
    expect((await next.json()).session).toMatchObject({ story_day: 29, story_time: "20:15" });
    const again = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { beat: "next" }));
    expect((await again.json()).beat.id).toBe("d37-ankle");
    const back = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { beat: "prev" }));
    expect((await back.json()).beat.id).toBe("d29-hero");

    const jump = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 3 }));
    expect((await jump.json()).session).toMatchObject({ story_day: 3, story_time: null });
    const withTime = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 23, time: "07:40" }));
    expect((await withTime.json()).session).toMatchObject({ story_day: 23, story_time: "07:40" });

    const events = getBus().recent(s.id);
    expect(events.every((e) => e.type === "clock.changed")).toBe(true);
    expect(events.at(-1)?.say).toBe("Story clock → Day 23 · Wed 7:40am");
    expect((events.at(-1)?.data as { session: SessionRow }).session.story_day).toBe(23);
  });

  it("refuses unknown beats, the end of the story and empty bodies", async () => {
    const s = await newSession({ story_day: 42, story_time: "09:30" });
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { beat: "next" }))).status).toBe(409);
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { beat: "nope" }))).status).toBe(400);
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, {}))).status).toBe(400);
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: -1 }))).status).toBe(400);
    // the clock runs from Day 0 to Day 45 (the story and two quiet days after it): any other day is refused in words
    // (real-status: Day 99 flooded the backstage with "no reply" rows)
    for (const day of [46, 99, 120]) {
      const res = await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day }));
      expect(res.status, String(day)).toBe(400);
      expect(await res.json()).toEqual({ error: "outside_story", detail: "The clock runs from Day 0 to Day 45 (the story's records end on Day 43)." });
    }
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 45 }))).status).toBe(200);
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 43 }))).status).toBe(200);
    expect((await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 0 }))).status).toBe(200);
  });

  it("is the film crew's: without the crew's cookie or key every director route answers 404 and changes nothing", async () => {
    const s = await newSession({ story_day: 15 });
    for (const [route, call] of [
      ["clock", () => clockPOST(post(`/api/clock?session=${s.id}`, { day: 3 }))],
      ["cue", () => cuePOST(post(`/api/director/cue?session=${s.id}`, { cue: "no_reply" }))],
      ["filming", () => filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: false }))],
      ["reset", () => resetPOST(post(`/api/session/reset?session=${s.id}`))],
    ] as const) {
      const res = await call();
      expect(res.status, route).toBe(404);
      expect(await res.json(), route).toEqual({ error: "not_found" });
    }
    expect((await getMemoryStore().getSession(s.id))?.story_day).toBe(15);
    expect(types(s.id)).toEqual([]);
  });
});

describe("POST /api/director/cue", () => {
  it("reminder carries today's due medicine and Wei Ling's own words", async () => {
    const s = await newSession({ story_day: 15 });
    const res = await cuePOST(crewPost(`/api/director/cue?session=${s.id}`, { cue: "reminder" }));
    const data = (await res.json()) as ReminderCueData;
    expect(data).toMatchObject({ cue: "reminder", day: 15, slot: "morning" });
    expect(data.doses.map((d) => d.medication_id)).toEqual(["med-amlodipine"]);
    expect(data.clip).toMatchObject({ id: "clip-wei-ling-1", by: "wei-ling", lang: "zh-Hans" });
    expect(data.clip?.text).toMatch(/\p{Script=Han}/u);
    expect(types(s.id)).toEqual(["director.cue"]);
  });

  it("no reply marks only unanswered doses as unconfirmed", async () => {
    const answered = await newSession({ story_day: 29 }); // seed: D29 morning taken
    const r1 = (await (await cuePOST(crewPost(`/api/director/cue?session=${answered.id}`, { cue: "no_reply" }))).json()) as NoReplyCueData;
    expect(r1.marked).toEqual([]);
    expect((await getMemoryStore().listDoses(answered.id, { fromDay: 29, toDay: 29 }))[0].state).toBe("taken");

    const open = await newSession({ story_day: 43 }); // after the story: nothing recorded
    const r2 = (await (await cuePOST(crewPost(`/api/director/cue?session=${open.id}`, { cue: "no_reply" }))).json()) as NoReplyCueData;
    expect(r2.marked).toEqual(["med-amlodipine", "med-losartan"]);
    const doses = await getMemoryStore().listDoses(open.id, { fromDay: 43, toDay: 43 });
    expect(doses.map((d) => [d.medication_id, d.state, d.reason])).toEqual([
      ["med-amlodipine", "unconfirmed", "no_reply"],
      ["med-losartan", "unconfirmed", "no_reply"],
    ]);
    expect(types(open.id)).toEqual(["dose.logged", "dose.logged", "director.cue"]);
  });

  it("rejects unknown cues", async () => {
    const s = await newSession();
    expect((await cuePOST(crewPost(`/api/director/cue?session=${s.id}`, { cue: "explode" }))).status).toBe(400);
  });
});

describe("filming mode and reset", () => {
  it("filming mode is stored and broadcast", async () => {
    const s = await newSession();
    const res = await filmingPOST(crewPost(`/api/director/filming?session=${s.id}`, { on: true, crew_key: CREW }));
    expect((await res.json()).session.filming_mode).toBe(true);
    expect(types(s.id)).toEqual(["session.filming_mode"]);
    expect((await filmingPOST(crewPost(`/api/director/filming?session=${s.id}`, { on: "yes" }))).status).toBe(400);
  });

  it("reset restores the seed, keeps id and join code, clears the history, then announces itself", async () => {
    const s = await newSession({ kind: "filming", crew_key: CREW });
    const store = getMemoryStore();
    const strip = (rows: DoseLogRow[]) => rows.map((row) => ({ ...row, created_at: "" }));
    const seedDoses = strip(await store.listDoses(s.id));
    await dosesPOST(post(`/api/doses?session=${s.id}`, { medication_id: "med-amlodipine", slot: "morning", state: "missed" }));
    await dosesPOST(post(`/api/doses?session=${s.id}`, { medication_id: "med-amlodipine", day: 50, slot: "morning", state: "taken" }));
    await clockPOST(crewPost(`/api/clock?session=${s.id}`, { day: 3, time: "21:00" }));
    await filmingPOST(crewPost(`/api/director/filming?session=${s.id}`, { on: true, crew_key: CREW }));

    const res = await resetPOST(crewPost(`/api/session/reset?session=${s.id}`));
    const { session } = await res.json();
    // back on the evening of Day 29, 8:15pm (real-status: the clock had no time after a reset)
    expect(session).toMatchObject({ id: s.id, join_code: s.join_code, story_day: 29, story_time: "20:15", filming_mode: true });
    expect(strip(await store.listDoses(s.id))).toEqual(seedDoses);
    expect(types(s.id)).toEqual(["session.reset", "clock.changed"]);
    expect((await resetPOST(crewPost("/api/session/reset?session=nope"))).status).toBe(404);
  });
});
