/**
 * The director's remote beyond the clock (lib/crew/director.ts, app/api/director/replay, app/api/clock's `show`; real-status
 * "导演台和评委页"): a scene moves the phones to its page, a replay starts on the phones and stops on demand, moving the
 * clock or resetting stops a running replay first, days stay inside the story, and a refusal reads as a sentence. The
 * fence (real-app H2): every crew route answers an account 404, with or without the crew's key.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as clockPost } from "@/app/api/clock/route";
import { POST as cuePost } from "@/app/api/director/cue/route";
import { POST as filmingPost } from "@/app/api/director/filming/route";
import { POST as replayPost } from "@/app/api/director/replay/route";
import { POST as resetPost } from "@/app/api/session/reset/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { directorProblem, noReplyBlocked } from "@/components/director/DirectorConsole";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus } from "@/lib/bus";
import { isPhonePath, showCueOf } from "@/lib/crew/cues";
import { replayableToday, runningReplays, showOnPhones } from "@/lib/crew/director";
import { BEAT_PAGE, CLOCK_LAST_DAY, inStory, pageForBeat, plainBeat, replayPage, STORY_LAST_DAY } from "@/lib/crew/story";
import { BEATS } from "@/lib/session/beats";
import { ApiError } from "@/lib/session/client";
import { CREW_COOKIE, crewCookieValue, resetCrewAttempts } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import { startVisit } from "@/lib/visit/pipeline";
import { beginStream, visitLive } from "@/lib/visit/state";

const store = getMemoryStore();
const CREW = { "x-ripple-crew-key": DEV_ONLY_CREW_KEY };

function post(p: string, body: unknown, headers: Record<string, string> = CREW): NextRequest {
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const cues = (sid: string) =>
  getBus()
    .recent(sid)
    .filter((e) => e.type === "director.cue")
    .map((e) => e.data as Record<string, unknown>);

async function demo(day: number, time: string | null = null): Promise<SessionRow> {
  return store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

beforeEach(() => resetCrewAttempts());

describe("the story's days and scenes", () => {
  it("the clock: Day 0 to Day 45 (the story's records end on Day 43); every scene has a page of his and a plain title", () => {
    expect([inStory(0), inStory(43), inStory(45), inStory(-1), inStory(46), inStory(99), inStory(1.5)]).toEqual([true, true, true, false, false, false, false]);
    expect(STORY_LAST_DAY).toBe(43);
    expect(CLOCK_LAST_DAY).toBe(45);
    for (const b of BEATS) {
      expect(isPhonePath(BEAT_PAGE[b.id]), b.id).toBe(true);
      expect(plainBeat(b.id), b.id).toBeTruthy();
      expect(plainBeat(b.id, "zh-Hans"), b.id).toBeTruthy();
      expect(plainBeat(b.id)!, b.id).not.toMatch(/Hero shot|direction|beat/i);
    }
    expect(pageForBeat("nope")).toBe("/p/today");
    expect(replayPage("v3")).toBe("/p/visit?replay=v3");
  });

  it("a show cue only ever names one of his pages", () => {
    for (const ok of ["/p/today", "/p/visit?replay=v3", "/p/meds/med-amlodipine", "/p/bp"]) expect(isPhonePath(ok), ok).toBe(true);
    for (const bad of ["/f", "/director", "https://evil.example/p/today", "//evil.example/p", "/p/../director", "/p/today#x", "javascript:alert(1)", "/pizza"]) {
      expect(isPhonePath(bad), bad).toBe(false);
    }
    expect(showCueOf({ cue: "show", path: "/p/bp", why: "scene", beat: "d1-home" })).toEqual({ cue: "show", path: "/p/bp", why: "scene", beat: "d1-home" });
    expect(showCueOf({ cue: "show", path: "/director" })).toBeNull();
    expect(showCueOf({ cue: "reminder" })).toBeNull();
    expect(showCueOf(null)).toBeNull();
  });
});

describe("POST /api/clock: scenes move the phones, days stay in the story, a running replay stops first", () => {
  it("show: true with a scene publishes the scene's page for the phones; without show, or with a plain day, nothing moves them", async () => {
    const s = await demo(29, "20:15");
    const res = await clockPost(post(`/api/clock?session=${s.id}`, { beat: "d42-visit", show: true }));
    expect(res.status).toBe(200);
    expect(cues(s.id)).toEqual([{ cue: "show", path: "/p/visit", why: "scene", beat: "d42-visit" }]);
    await clockPost(post(`/api/clock?session=${s.id}`, { beat: "d29-hero" }));
    await clockPost(post(`/api/clock?session=${s.id}`, { day: 12, show: true }));
    expect(cues(s.id)).toHaveLength(1);
  });

  it("a replay running when the clock moves is stopped before its next sentence, and the backstage says so", async () => {
    const s = await demo(42, "09:30");
    await startVisit(store, s, { mode: "replay", fixture: "v3" });
    beginStream(s.id, "v3", { fixture: "v3", speed: 1, startedAt: Date.now(), source: "replay" });
    expect(await runningReplays(store, s)).toEqual(["v3"]);
    const generation = visitLive(s.id, "v3").stream!.generation;
    await clockPost(post(`/api/clock?session=${s.id}`, { day: 29, time: "20:15" }));
    expect(visitLive(s.id, "v3").stream).toMatchObject({ state: "ended" });
    expect(visitLive(s.id, "v3").stream!.generation).not.toBe(generation);
    expect(cues(s.id)).toEqual([{ cue: "replay_stopped", visits: ["v3"], why: "clock" }]);
    expect(await runningReplays(store, s)).toEqual([]);
  });
});

describe("POST /api/director/replay", () => {
  it("start: the phones open the day's sample visit to play it; a day without one is refused in words", async () => {
    for (const [day, visit] of [
      [0, "v1"],
      [8, "v2"],
      [42, "v3"],
    ] as const) {
      const s = await demo(day, "09:30");
      expect((await replayableToday(store, s))?.id).toBe(visit);
      const res = await replayPost(post(`/api/director/replay?session=${s.id}`, { action: "start" }));
      expect(res.status, String(day)).toBe(200);
      expect(await res.json()).toEqual({ visit, path: `/p/visit?replay=${visit}` });
      expect(cues(s.id)).toEqual([{ cue: "show", path: `/p/visit?replay=${visit}`, why: "replay", beat: null }]);
    }
    const none = await demo(29, "20:15");
    const res = await replayPost(post(`/api/director/replay?session=${none.id}`, { action: "start" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_visit_today", detail: "There is no visit to replay on this day. The visits are on Day 0, Day 8 and Day 42." });
    expect(cues(none.id)).toEqual([]);
  });

  it("stop: every running replay of the session stops; nothing running is fine", async () => {
    const s = await demo(8, "10:00");
    await startVisit(store, s, { mode: "replay", fixture: "v2" });
    beginStream(s.id, "v2", { fixture: "v2", speed: 1, startedAt: Date.now(), source: "replay" });
    const stop = await replayPost(post(`/api/director/replay?session=${s.id}`, { action: "stop" }));
    expect(await stop.json()).toEqual({ stopped: ["v2"] });
    expect(cues(s.id)).toEqual([{ cue: "replay_stopped", visits: ["v2"], why: "director" }]);
    const again = await replayPost(post(`/api/director/replay?session=${s.id}`, { action: "stop" }));
    expect(await again.json()).toEqual({ stopped: [] });
    expect(cues(s.id)).toHaveLength(1);
    expect((await replayPost(post(`/api/director/replay?session=${s.id}`, { action: "rewind" }))).status).toBe(400);
  });

  it("reset stops a running replay too, and lands on the evening of Day 29, 8:15pm", async () => {
    const s = await demo(42, "09:30");
    await startVisit(store, s, { mode: "replay", fixture: "v3" });
    beginStream(s.id, "v3", { fixture: "v3", speed: 1, startedAt: Date.now(), source: "replay" });
    const res = await resetPost(post(`/api/session/reset?session=${s.id}`, {}));
    expect((await res.json()).session).toMatchObject({ story_day: 29, story_time: "20:15" });
    expect(visitLive(s.id, "v3").stream).toMatchObject({ state: "ended" });
  });

  it("showOnPhones refuses anything but one of his pages", () => {
    expect(() => showOnPhones("s", "/director", "scene")).toThrow();
    expect(() => showOnPhones("s", "https://example.com/p/today", "scene")).toThrow();
  });
});

describe("the console's words", () => {
  it("a refused call reads as a sentence, never its code", () => {
    const codes = ["outside_story", "end_of_story", "start_of_story", "unknown_beat", "no_visit_today", "not_found", "crew_key_wrong", "crew_key_attempts", "patient_only", "role_unavailable", "something_new"];
    for (const code of codes) {
      const words = directorProblem(new ApiError(400, code));
      expect(words, code).not.toContain(code);
      expect(words, code).toMatch(/\.$/);
    }
    expect(directorProblem(new ApiError(400, "outside_story"))).toBe("The clock runs from Day 0 to Day 45 (the story's records end on Day 43).");
    expect(directorProblem(new Error("network"))).toContain("did not answer");
  });

  it("'Simulate no reply' is greyed with what is recorded when every tablet of that time has an answer", () => {
    expect(noReplyBlocked([])).toBe("No tablet is due on this day, so there is nothing to leave unanswered.");
    expect(noReplyBlocked([{ name: "Amlodipine", slot: "morning", state: null }])).toBeNull();
    expect(noReplyBlocked([{ name: "Amlodipine", slot: "morning", state: "unconfirmed" }])).toBeNull();
    expect(
      noReplyBlocked([
        { name: "Amlodipine", slot: "morning", state: "taken" },
        { name: "Losartan", slot: "morning", state: "missed" },
      ]),
    ).toBe("This day is already recorded: Amlodipine taken, Losartan not taken.");
  });
});

describe("the fence (real-app H2): an account gets 404 from every crew route, crew key or not", () => {
  let him: TestAccount;
  beforeAll(async () => {
    him = await createAccountWithSpace(store, getAuthProvider(), { login: `e${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  });

  it("clock, cues, filming mode, replay, reset and the scripted fallback: 404 not_found, and his day does not move", async () => {
    const before = (await store.getSession(him.userId))!.story_day;
    const crewCookie = `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`;
    for (const crew of [false, true]) {
      const headers = { cookie: [`rp_at=${him.tokens.access_token}`, crew ? crewCookie : null].filter(Boolean).join("; ") };
      const rs = [
        await clockPost(post("/api/clock", { day: 3 }, headers)),
        await cuePost(post("/api/director/cue", { cue: "no_reply" }, headers)),
        await filmingPost(post("/api/director/filming", { on: true }, headers)),
        await replayPost(post("/api/director/replay", { action: "start" }, headers)),
        await resetPost(post("/api/session/reset", {}, headers)),
        await scriptedPost(post("/api/visits/v1/scripted", { on: true }, headers), { params: Promise.resolve({ id: "v1" }) }),
      ];
      expect(rs.map((r) => r.status), `crew ${crew}`).toEqual([404, 404, 404, 404, 404, 404]);
      for (const r of rs) expect(await r.json()).toEqual({ error: "not_found" });
    }
    expect((await store.getSession(him.userId))!.story_day).toBe(before);
  });
});
