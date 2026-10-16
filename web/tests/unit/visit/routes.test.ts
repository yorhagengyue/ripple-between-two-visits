/**
 * M2 routes called directly: start a visit, realtime token, extract a chunk, the whole-visit job and finalize,
 * confirm, the scripted fallback (filming sessions with the crew key only), the clip route, and the recording
 * upload (WAV only).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as asrJobsPOST } from "@/app/api/asr/jobs/route";
import { GET as asrJobGET } from "@/app/api/asr/jobs/[id]/route";
import { POST as tokenPOST } from "@/app/api/asr/realtime-token/route";
import { POST as uploadUrlPOST } from "@/app/api/upload-url/route";
import { GET as clipGET } from "@/app/api/visits/[id]/clip/route";
import { POST as confirmPOST } from "@/app/api/visits/[id]/confirm/route";
import { POST as extractPOST } from "@/app/api/visits/[id]/extract/route";
import { POST as finalizePOST } from "@/app/api/visits/[id]/finalize/route";
import { POST as replayPOST } from "@/app/api/visits/[id]/replay/route";
import { GET as visitGET } from "@/app/api/visits/[id]/route";
import { POST as scriptedPOST } from "@/app/api/visits/[id]/scripted/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { fixtureUtterances } from "@/lib/asr";
import { getBlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import { CREW_COOKIE, crewCookieValue, MAX_WRONG_KEYS, resetCrewAttempts } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import type { VisitView } from "@/lib/visit/types";
import { encodeWav } from "@/lib/visit/wav";
import { newSession, replayLive } from "./helpers";

const BASE = "http://localhost:3200";
const saved = { ...process.env };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-m2-routes-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  delete process.env.SPEECH_PROVIDER;
  delete process.env.SCRIPTED_FALLBACK_KEY;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

function req(method: string, url: string, sessionId: string | null, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const q = sessionId ? `${url.includes("?") ? "&" : "?"}session=${sessionId}` : "";
  return new NextRequest(`${BASE}${url}${q}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const types = (sid: string) => getBus().recent(sid).map((e) => e.type);

async function start(s: SessionRow, body: Record<string, unknown>): Promise<VisitView> {
  const res = await visitsPOST(req("POST", "/api/visits", s.id, body));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()).view as VisitView;
}

describe("POST /api/visits", () => {
  it("needs a session and a valid body", async () => {
    expect((await visitsPOST(req("POST", "/api/visits", null, { mode: "replay", fixture: "v1" }))).status).toBe(400);
    const s = await newSession();
    expect((await visitsPOST(req("POST", "/api/visits", s.id, { mode: "nope" }))).status).toBe(400);
    expect((await visitsPOST(req("POST", "/api/visits", s.id, { mode: "replay", fixture: "v9" }))).status).toBe(409);
  });

  it("replay uses the sample visit's own row; record uses today's visit or a new one, and keeps the consent", async () => {
    const s = await newSession({ story_day: 0 });
    const replay = await start(s, { mode: "replay", fixture: "v1" });
    expect(replay.visit).toMatchObject({ id: "v1", status: "recording" });
    await getMemoryStore().setStoryDay(s.id, 0, "09:30");
    const rec = await start(s, { mode: "record", consent: { given: true, at: "2026-10-09T02:00:00.000Z", statement: "同意录音" } });
    expect(rec.visit).toMatchObject({ id: "v1", day: 0, status: "recording" });
    // the wall clock is kept for the record; the screen shows the story moment (Day 0, 09:30)
    expect(rec.consent).toMatchObject({ given: true, at: "2026-10-09T02:00:00.000Z", storyDay: 0, storyTime: "09:30" });
    const items = await getMemoryStore().listVisitItems(s.id, { visit_id: "v1", type: "consent" });
    expect(items[0]).toMatchObject({ text: "同意录音", slots: { variant: "screen" } });
    expect(types(s.id)).toContain("visit.changed");

    const later = await newSession({ story_day: 29 });
    const fresh = await start(later, { mode: "record", consent: { given: true } });
    expect(fresh.visit.id).toMatch(/^visit-/);
    expect(fresh.visit.day).toBe(29);
    expect(fresh.replayable).toBeNull();
  });
});

describe("day gating", () => {
  it("a sample visit later than the story day cannot be replayed or read yet", async () => {
    const s = await newSession({ story_day: 0 });
    const later = await visitsPOST(req("POST", "/api/visits", s.id, { mode: "replay", fixture: "v2" }));
    expect(later.status).toBe(409);
    expect((await later.json()).error).toBe("visit_not_yet");
    expect((await visitsPOST(req("POST", "/api/visits", s.id, { mode: "replay", fixture: "v3" }))).status).toBe(409);
    const read = await visitGET(req("GET", "/api/visits/v2", s.id), params("v2"));
    expect(read.status).toBe(409);
    expect((await read.json()).error).toBe("visit_not_yet");
    expect((await getMemoryStore().getVisit(s.id, "v2"))!.status).toBe("confirmed"); // untouched
    // the story reaches Day 8: v2 can be replayed and read
    await getMemoryStore().setStoryDay(s.id, 8);
    expect((await visitGET(req("GET", "/api/visits/v2", s.id), params("v2"))).status).toBe(200);
    expect((await start(s, { mode: "replay", fixture: "v2" })).visit).toMatchObject({ id: "v2", status: "recording" });
    // without a story time the consent shows no time at all (never the wall clock)
    const rec = await start(s, { mode: "record", consent: { given: true } });
    expect(rec.consent).toMatchObject({ given: true, storyDay: 8, storyTime: null });
  });
});

describe("realtime token and replay", () => {
  it("mock: a fake token; trtc: 503 not configured", async () => {
    const s = await newSession();
    const res = await tokenPOST(req("POST", "/api/asr/realtime-token", s.id, { visit_id: "v1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "mock", token: expect.stringMatching(/^mock-/) });
    expect((await tokenPOST(req("POST", "/api/asr/realtime-token", s.id, { visit_id: "nope" }))).status).toBe(404);
    process.env.SPEECH_PROVIDER = "trtc";
    try {
      const trtc = await tokenPOST(req("POST", "/api/asr/realtime-token", s.id, {}));
      expect(trtc.status).toBe(503);
      expect((await trtc.json()).error).toBe("not_configured");
      await start(s, { mode: "replay", fixture: "v1" });
      expect((await replayPOST(req("POST", "/api/visits/v1/replay", s.id, {}), params("v1"))).status).toBe(409);
    } finally {
      delete process.env.SPEECH_PROVIDER;
    }
  });

  it("replay only for a recording visit with a replay file", async () => {
    const s = await newSession({ story_day: 0 }); // the visit's own day: the replay is written in place
    expect((await replayPOST(req("POST", "/api/visits/v1/replay", s.id, {}), params("v1"))).status).toBe(409); // seeded: confirmed
    await start(s, { mode: "replay", fixture: "v1" });
    expect((await replayPOST(req("POST", "/api/visits/v1/replay", s.id, { speed: 99 }), params("v1"))).status).toBe(400);
    const ok = await replayPOST(req("POST", "/api/visits/v1/replay", s.id, { speed: 20 }), params("v1"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ speed: 20, fixture: "v1", lines: 12, duration_ms: 79934 });
    // stop it: the visit moves on
    await getMemoryStore().updateVisit(s.id, "v1", { status: "transcribing" });
  });
});

describe("POST /api/visits/[id]/extract", () => {
  it("stores a chunk, infers roles with context, extracts items, publishes the events", async () => {
    const s = await newSession();
    await start(s, { mode: "replay", fixture: "v1" });
    const lines = fixtureUtterances("v1")!;
    const res = await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: lines.slice(0, 3) }), params("v1"));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.utterances.map((u: { id: string; role: string }) => [u.id, u.role])).toEqual([
      ["v1-u01", "patient"],
      ["v1-u02", "doctor"],
      ["v1-u03", "doctor"],
    ]);
    expect(out.utterances.every((u: { role_state: string }) => u.role_state === "inferred")).toBe(true);
    expect(out.new_cards.map((c: { id: string }) => c.id)).toEqual(["doc-v1-u03"]);
    expect(types(s.id)).toEqual(expect.arrayContaining(["asr.final", "card.created", "utterance.role"]));
    // a realtime client's own ids are replaced by the visit's ids
    const next = await extractPOST(
      req("POST", "/api/visits/v1/extract", s.id, { utterances: [{ id: "client-1", t_start_ms: 90000, t_end_ms: 91000, speaker_cluster: 1, text: "Okay." }] }),
      params("v1"),
    );
    expect((await next.json()).utterances[0].id).toBe("v1-u04");
    expect((await extractPOST(req("POST", "/api/visits/nope/extract", s.id, { utterances: lines.slice(0, 1) }), params("nope"))).status).toBe(404);
    expect((await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: [] }), params("v1"))).status).toBe(400);
  });
});

describe("scripted fallback: filming sessions, the film crew only (lib/crew/gate.ts)", () => {
  const CREW_HEADERS = { "x-ripple-crew-key": DEV_ONLY_CREW_KEY };
  beforeEach(async () => {
    // C2 track L: these tests tell clients apart by X-Forwarded-For; that is only believed behind a proxy of ours (lib/guard/client-ip.ts)
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    await resetCrewAttempts();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await resetCrewAttempts();
  });

  it("without the crew's cookie or key the switch does not exist (404), in a sandbox and in a filming session alike", async () => {
    for (const s of [await newSession(), await newSession({ filming: true, story_day: 0 })]) {
      await start(s, { mode: "replay", fixture: "v1" });
      const res = await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true }), params("v1"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(types(s.id)).not.toContain("scripted_fallback");
    }
  });

  it("a judge sandbox cannot turn it on (crew key or extract flag), even with filming mode on", async () => {
    const s = await newSession();
    await start(s, { mode: "replay", fixture: "v1" });
    // the crew's key does not help in a sandbox
    for (const r of [req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: DEV_ONLY_CREW_KEY }), req("POST", "/api/visits/v1/scripted", s.id, { on: true }, CREW_HEADERS)]) {
      const keyed = await scriptedPOST(r, params("v1"));
      expect(keyed.status).toBe(403);
      expect((await keyed.json()).error).toBe("fallback_filming_only");
    }
    // the extract flag is the crew's switch too: without the crew it does not exist; with the crew a sandbox refuses it
    const bare = await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: fixtureUtterances("v1")!.slice(0, 1), fallback: true }), params("v1"));
    expect([bare.status, (await bare.json()).error]).toEqual([404, "not_found"]);
    const flag = await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: fixtureUtterances("v1")!.slice(0, 1), fallback: true }, CREW_HEADERS), params("v1"));
    expect([flag.status, (await flag.json()).error]).toEqual([403, "fallback_filming_only"]);
    await getMemoryStore().setFilmingMode(s.id, true); // a sandbox with filming mode switched on is still a sandbox
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true }, CREW_HEADERS), params("v1"))).status).toBe(403);
    const view = (await (await visitGET(req("GET", "/api/visits/v1", s.id), params("v1"))).json()).view as VisitView;
    expect(view.fallback).toEqual({ allowed: false, on: false, unlockable: false });
  });

  it("a filming session and a wrong typed key: the same 404 as no key (never \"wrong key\"), the extract flag too; a misheard line kept as heard", async () => {
    const s = await newSession({ filming: true, story_day: 0 });
    await start(s, { mode: "replay", fixture: "v1" });
    // the scope can use the fallback and this server has a key: a phone that is not the crew's may sign in on the screen
    let view = (await (await visitGET(req("GET", "/api/visits/v1", s.id), params("v1"))).json()).view as VisitView;
    expect(view.fallback).toEqual({ allowed: true, on: false, unlockable: true });
    const wrong = await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: "guess" }), params("v1"));
    expect([wrong.status, (await wrong.json()).error]).toEqual([404, "not_found"]);
    const header = await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true }, { "x-ripple-crew-key": "guess" }), params("v1"));
    expect(header.status).toBe(404);
    const flag = await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: fixtureUtterances("v1")!.slice(0, 1), fallback: true }), params("v1"));
    expect([flag.status, (await flag.json()).error]).toEqual([404, "not_found"]);
    view = (await (await visitGET(req("GET", "/api/visits/v1", s.id), params("v1"))).json()).view as VisitView;
    expect(view.fallback).toEqual({ allowed: true, on: false, unlockable: true });
    // a misheard line stays as heard: no script line stands in
    const garbled = { t_start_ms: 6815, t_end_ms: 8015, speaker_cluster: 1, text: "Shore, know prob lame." };
    const heard = await (await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: [garbled] }), params("v1"))).json();
    expect(heard.utterances[0]).toMatchObject({ text: "Shore, know prob lame.", scripted_fallback: false });
    expect(getBus().recent(s.id).some((e) => e.type === "scripted_fallback")).toBe(false);
  });

  it("a filming session with the crew: on, a misheard line shows the script line and backstage gets scripted_fallback", async () => {
    const s = await newSession({ filming: true, story_day: 0 });
    await start(s, { mode: "replay", fixture: "v1" });
    const filmingOff = await getMemoryStore().setFilmingMode(s.id, false);
    const offRes = await scriptedPOST(req("POST", "/api/visits/v1/scripted", filmingOff.id, { on: true, key: DEV_ONLY_CREW_KEY }), params("v1"));
    expect(offRes.status).toBe(403);
    expect((await offRes.json()).error).toBe("fallback_filming_only");
    await getMemoryStore().setFilmingMode(s.id, true);
    const on = await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: DEV_ONLY_CREW_KEY }), params("v1"));
    expect(on.status).toBe(200);
    const body = await on.text();
    expect(JSON.parse(body)).toEqual({ fallback: { allowed: true, on: true, unlockable: false } });
    expect(body).not.toContain(DEV_ONLY_CREW_KEY);
    // the typed key leaves the crew's cookie (a hash, never the key) on this browser: later switches carry it, no key
    const cookies = on.headers.getSetCookie().join("\n");
    expect(cookies).toContain(`${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`);
    expect(cookies).not.toContain(DEV_ONLY_CREW_KEY);
    const crewCookie = { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` };
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: false }, crewCookie), params("v1"))).status).toBe(200);
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true }, crewCookie), params("v1"))).status).toBe(200);
    // nothing is unlocked per session any more (one gate): no "crew key accepted" event, and every phone's view says the
    // same thing about the scope; whether a browser shows the switch is its own crew cookie
    expect(getBus().recent(s.id).some((e) => (e.data as { fallback_unlocked?: boolean } | null)?.fallback_unlocked)).toBe(false);
    const seen = (await (await visitGET(req("GET", "/api/visits/v1", s.id), params("v1"))).json()).view as VisitView;
    expect(seen.fallback).toEqual({ allowed: true, on: true, unlockable: true });

    const lines = fixtureUtterances("v1")!;
    // heard right: kept as heard
    const ok = await (await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: [lines[0]] }), params("v1"))).json();
    expect(ok.utterances[0]).toMatchObject({ text: lines[0].text, scripted_fallback: false });
    // misheard: the next script line is shown instead, marked
    const garbled = { t_start_ms: 6815, t_end_ms: 8015, speaker_cluster: 1, text: "Shore, know prob lame." };
    const fb = await (await extractPOST(req("POST", "/api/visits/v1/extract", s.id, { utterances: [garbled] }), params("v1"))).json();
    expect(fb.utterances[0]).toMatchObject({ text: "Sure, no problem.", scripted_fallback: true });
    const ev = getBus().recent(s.id).find((e) => e.type === "scripted_fallback")!;
    expect(ev.data).toMatchObject({ heard: "Shore, know prob lame.", script: "Sure, no problem." });
    expect(fb.view.lines.find((l: { id: string }) => l.id === fb.utterances[0].id).scriptedFallback).toBe(true);
    // the key never reaches the event stream
    expect(JSON.stringify(getBus().recent(s.id))).not.toContain(DEV_ONLY_CREW_KEY);
    // another filming session: nothing without the crew
    const other = await newSession({ filming: true, story_day: 0 });
    await start(other, { mode: "replay", fixture: "v1" });
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", other.id, { on: true }), params("v1"))).status).toBe(404);
  });

  it("which keys count: SCRIPTED_FALLBACK_KEY, and the dev key while the developer tools are on; a production build without the key never unlocks", async () => {
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "crew-test-key-0042");
    const s = await newSession({ filming: true, story_day: 0 });
    await start(s, { mode: "replay", fixture: "v1" });
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: "crew-test-key-0042" }), params("v1"))).status).toBe(200);
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: false, key: DEV_ONLY_CREW_KEY }), params("v1"))).status).toBe(200);

    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    const prod = await newSession({ filming: true, story_day: 0 });
    await start(prod, { mode: "replay", fixture: "v1" });
    const view = (await (await visitGET(req("GET", "/api/visits/v1", prod.id), params("v1"))).json()).view as VisitView;
    // a filming scope, but no key exists on this server: nothing to sign in with, and nobody is the crew
    expect(view.fallback).toEqual({ allowed: true, on: false, unlockable: false });
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", prod.id, { on: true }), params("v1"))).status).toBe(404);
    for (const key of [DEV_ONLY_CREW_KEY, "crew-test-key-0042"]) {
      const res = await scriptedPOST(req("POST", "/api/visits/v1/scripted", prod.id, { on: true, key }), params("v1"));
      expect([res.status, (await res.json()).error]).toEqual([404, "not_found"]);
    }
  });

  it(`${MAX_WRONG_KEYS} wrong keys from one client: its typed keys are ignored for ten minutes (still 404, even the right one); the cookie and another client are not affected`, async () => {
    const s = await newSession({ filming: true, story_day: 0 });
    await start(s, { mode: "replay", fixture: "v1" });
    for (let i = 0; i < MAX_WRONG_KEYS; i++) {
      expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: `wrong-${i}` }), params("v1"))).status).toBe(404);
    }
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: DEV_ONLY_CREW_KEY }), params("v1"))).status).toBe(404);
    const crewCookie = { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` };
    expect((await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true }, crewCookie), params("v1"))).status).toBe(200);
    const elsewhere = await scriptedPOST(req("POST", "/api/visits/v1/scripted", s.id, { on: true, key: DEV_ONLY_CREW_KEY }, { "x-forwarded-for": "198.51.100.7" }), params("v1"));
    expect(elsewhere.status).toBe(200);
  });
});

describe("whole-visit job, finalize, confirm", () => {
  it("replay: job from the replay file, finalize to review, confirm writes the answered questions", async () => {
    process.env.MOCK_ASR_JOB_MS = "0";
    const s = await newSession();
    await replayLive(s, "v1");
    const job = await asrJobsPOST(req("POST", "/api/asr/jobs", s.id, { visit_id: "v1" }));
    expect(job.status).toBe(200);
    const { job_id } = await job.json();
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.status).toBe("transcribing");

    const other = await newSession();
    expect((await asrJobGET(req("GET", `/api/asr/jobs/${job_id}`, other.id), params(job_id))).status).toBe(404);
    expect((await finalizePOST(req("POST", "/api/visits/v1/finalize", other.id, { job_id }), params("v1"))).status).toBe(404);
    const st = await (await asrJobGET(req("GET", `/api/asr/jobs/${job_id}`, s.id), params(job_id))).json();
    expect(st).toMatchObject({ status: "done", source: "fixture" });
    expect(st.utterances).toHaveLength(12);

    const fin = await finalizePOST(req("POST", "/api/visits/v1/finalize", s.id, { job_id }), params("v1"));
    expect(fin.status).toBe(200);
    const view = (await fin.json()).view as VisitView;
    expect(view.visit.status).toBe("review");

    const machine = view.qlist!.items.find((q) => q.questionId === "q-machine")!;
    const target = view.qlist!.items.find((q) => q.why === "ripple_target")!;
    const items: Record<string, "right"> = { [machine.answer!.itemId!]: "right", [target.answer!.itemId!]: "right" };
    const res = await confirmPOST(req("POST", "/api/visits/v1/confirm", s.id, { mine: ["v1-u01", "v1-u04", "v1-u11"], items, locale: "zh-Hans" }), params("v1"));
    expect(res.status).toBe(200);
    expect(((await res.json()).view as VisitView).visit.status).toBe("confirmed");
    const q = (await getMemoryStore().getQuestion(s.id, "q-machine"))!;
    expect(q).toMatchObject({
      status: "answered",
      answer_text: "手腕的不太准。买一个绑手臂的，upper arm 的。",
      answer_utterance_id: "v1-u12",
      answer_visit_id: "v1",
      answer_speaker: "doctor",
    });
    const written = (await getMemoryStore().getQuestion(s.id, target.id))!;
    expect(written).toMatchObject({ text: "我多少算正常？", status: "answered", answer_text: "At home, we want it below 135 over 85." });
    expect((await confirmPOST(req("POST", "/api/visits/v1/confirm", s.id, { mine: ["nope"], items: {} }), params("v1"))).status).toBe(400);
  });

  it("pending job: finalize answers 409 until it is done", async () => {
    process.env.MOCK_ASR_JOB_MS = "60000";
    try {
      const s = await newSession();
      await start(s, { mode: "replay", fixture: "v2" });
      const { job_id } = await (await asrJobsPOST(req("POST", "/api/asr/jobs", s.id, { visit_id: "v2" }))).json();
      const fin = await finalizePOST(req("POST", "/api/visits/v2/finalize", s.id, { job_id }), params("v2"));
      expect(fin.status).toBe(409);
    } finally {
      process.env.MOCK_ASR_JOB_MS = "0";
    }
  });

  it("a recording: WAV upload accepted (WebM refused), saved on the visit, job created from it", async () => {
    const s = await newSession({ story_day: 0 });
    await start(s, { mode: "record", consent: { given: true } });
    const webm = await uploadUrlPOST(req("POST", "/api/upload-url", s.id, { kind: "recording", content_type: "audio/webm;codecs=opus", visit_id: "v1" }));
    expect(webm.status).toBe(415);
    const up = await (await uploadUrlPOST(req("POST", "/api/upload-url", s.id, { kind: "recording", content_type: "audio/wav", visit_id: "v1" }))).json();
    await getBlobStore().putObject("audio", up.path, encodeWav(new Float32Array(16000)), "audio/wav");
    const bad = await asrJobsPOST(req("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: "someone-else/visits/v1/recording-x.wav" }));
    expect(bad.status).toBe(400);
    const job = await asrJobsPOST(req("POST", "/api/asr/jobs", s.id, { visit_id: "v1", audio_path: up.path }));
    expect(job.status).toBe(200);
    expect((await getMemoryStore().getVisit(s.id, "v1"))!.audio_path).toBe(up.path);
  });
});

describe("GET /api/visits/[id]/clip", () => {
  it("serves the R4 stand-in clip of the session's visit, with ranges; nothing for other sessions", async () => {
    const s = await newSession();
    await replayLive(s, "v2");
    const res = await clipGET(req("GET", "/api/visits/v2/clip?u=v2-u08", s.id), params("v2"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-ripple-stand-in")).toBe("1");
    const file = readFileSync(path.join(process.cwd(), "fixtures", "visits", "clips", "v2-u08.wav"));
    expect(Buffer.from(await res.arrayBuffer()).equals(file)).toBe(true);
    const part = await clipGET(req("GET", "/api/visits/v2/clip?u=v2-u08", s.id, undefined, { range: "bytes=0-43" }), params("v2"));
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(44);
    expect((await clipGET(req("GET", "/api/visits/v2/clip?u=v2-u05", s.id), params("v2"))).status).toBe(404); // no clip for this line
    const other = await newSession();
    expect((await clipGET(req("GET", "/api/visits/v2/clip?u=../../.env", other.id), params("v2"))).status).toBe(404);
    // a seeded visit without transcript: its own stand-in clips only
    expect((await clipGET(req("GET", "/api/visits/v1/clip?u=v1-u08", other.id), params("v1"))).status).toBe(200);
    expect((await clipGET(req("GET", "/api/visits/v1/clip?u=v2-u08", other.id), params("v1"))).status).toBe(404);
  });
});
