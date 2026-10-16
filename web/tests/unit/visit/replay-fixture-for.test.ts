/**
 * Which visit may be answered with a replay file (C2 track G guard; real-app.md 6.7 lines 1174-1179, H6 line 1106, and
 * the contract of 8.1 line 1379: "replayFixtureFor gives the demo's four visits what it gave before, and null for a
 * row whose audio_fixture is empty and whose id happens to be v1").
 *
 * The rule: a visit replays only when its own row carries an audio_fixture that names a replay file. The row's id
 * decides nothing. The demo's story has four such rows (v1, v2, p1, v3: fixtures/timeline.seed.json); the example
 * account carries the same sample rows (real-app 4.2, 4.6: its three past visits and today's planned v3); an account's
 * own recorded visit has none.
 *
 * This file guards three things:
 *   1. replayFixtureFor and replayIdForAudioFixture themselves, on rows read from the store as the seed makes them;
 *   2. the lookups under them answer "no replay" for any name that is not a replay, also for the names every object
 *      has (constructor, toString, ...);
 *   3. no request body can give an account's visit row an audio_fixture or an id of the account's choosing: every
 *      write handler under app/api/visits and app/api/asr is tried with one, and a handler that is added later and is
 *      not in the table below fails the test.
 *
 * Recorded decision followed (web/progress/f1.md, "账号的拜访没有回放和 mock 转写（只认 audio_fixture）"; lib/asr/fixtures.ts):
 * a replay id itself ("v1") in audio_fixture is accepted like the audio file name, so the fence is that no account can
 * write that column.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as chunkPost } from "@/app/api/asr/chunk/route";
import { DELETE as jobDelete } from "@/app/api/asr/jobs/[id]/route";
import { POST as jobsPost } from "@/app/api/asr/jobs/route";
import { POST as tokenPost } from "@/app/api/asr/realtime-token/route";
import { POST as confirmPost } from "@/app/api/visits/[id]/confirm/route";
import { POST as extractPost } from "@/app/api/visits/[id]/extract/route";
import { POST as finalizePost } from "@/app/api/visits/[id]/finalize/route";
import { POST as keepPost } from "@/app/api/visits/[id]/keep/route";
import { POST as minePost } from "@/app/api/visits/[id]/mine/route";
import { POST as notePost } from "@/app/api/visits/[id]/note/route";
import { POST as partsPost } from "@/app/api/visits/[id]/parts/route";
import { POST as replayPost } from "@/app/api/visits/[id]/replay/route";
import { PATCH as visitPatch } from "@/app/api/visits/[id]/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { POST as verdictPost } from "@/app/api/visits/[id]/verdict/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { REPLAY_VISITS } from "@/lib/asr";
import { AUDIO_FIXTURE_REPLAY, fixtureUtterances, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitRow } from "@/lib/store/types";
import { loadTemplate } from "@/lib/story/seed";
import { isSampleVisit } from "@/lib/visit/pipeline";
import { buildVisitView, replayFixtureFor } from "@/lib/visit/view";
import { encodeWav } from "@/lib/visit/wav";

const store = getMemoryStore();
const WEB = process.cwd();
const STORY = { v1: "v1", v2: "v2", p1: "p1", v3: "v3" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
});
afterEach(() => vi.unstubAllEnvs());

async function account(space: "blank" | "example"): Promise<{ a: TestAccount; scope: SessionRow }> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `rf${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return { a, scope: (await store.getSession(a.userId))! };
}

function req(a: TestAccount, method: string, pathname: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { cookie: `rp_at=${a.tokens.access_token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function startRecording(a: TestAccount): Promise<VisitRow> {
  const res = await visitsPost(req(a, "POST", "/api/visits", { mode: "record", consent: { given: true }, place: "clinic" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { visit: VisitRow }).visit;
}

// ---------------------------------------------------------------- 1. the rule itself

describe("the demo's four visits replay as before (rows as the store's seed makes them)", () => {
  it("a sandbox session's visit rows give v1, v2, p1, v3, each by its own audio_fixture", async () => {
    const demo = await store.createSession({ story_day: 29, ttl_hours: 1 });
    const rows = await store.listVisits(demo.id);
    expect(rows.map((v) => [v.id, v.audio_fixture])).toEqual([
      ["v1", "visit_A.wav"],
      ["v2", "visit_B.wav"],
      ["p1", "pharmacy_C.wav"],
      ["v3", "visit_D.wav"],
    ]);
    expect(Object.fromEntries(rows.map((v) => [v.id, replayFixtureFor(v)]))).toEqual(STORY);
    // and each of them has its replay file
    for (const v of rows) expect(fixtureUtterances(replayFixtureFor(v)!)?.length, v.id).toBeGreaterThan(0);
  });

  it("the table of audio file names is exactly the story's (a fifth story visit, or a renamed file, fails here)", () => {
    const seed = loadTemplate("mr-tan").visits;
    expect(seed).toHaveLength(4);
    expect(Object.fromEntries(seed.map((v) => [v.audio_fixture, v.id]))).toEqual({ ...AUDIO_FIXTURE_REPLAY });
    expect({ ...AUDIO_FIXTURE_REPLAY }).toEqual({ "visit_A.wav": "v1", "visit_B.wav": "v2", "pharmacy_C.wav": "p1", "visit_D.wav": "v3" });
    // the replay files on disk are these four and no other
    const files = readdirSync(path.join(WEB, "fixtures", "visits")).filter((f) => f.endsWith(".utterances.json")).map((f) => f.replace(".utterances.json", ""));
    expect(files.sort()).toEqual([...REPLAY_VISITS].sort());
    expect([...REPLAY_VISITS].sort()).toEqual(["p1", "v1", "v2", "v3"]);
  });
});

describe("the id decides nothing", () => {
  it("rows called v1, v2, p1, v3 with an empty audio_fixture: null, in every way a row can be empty", () => {
    for (const id of REPLAY_VISITS) {
      expect(replayFixtureFor({ id, audio_fixture: null }), id).toBeNull();
      expect(replayFixtureFor({ id, audio_fixture: "" }), id).toBeNull();
      expect(replayFixtureFor({ id, audio_fixture: "   " }), id).toBeNull();
      expect(replayFixtureFor({ id, audio_fixture: undefined as unknown as null }), id).toBeNull();
    }
  });

  it("the same on rows in the store: a blank account's visits called v1, v2, p1, v3 never replay, are no sample, and their screens offer no replay", async () => {
    const { scope } = await account("blank");
    for (const id of REPLAY_VISITS) await store.upsertVisit(scope.id, { id, kind: id === "p1" ? "pharmacy" : "clinic", place: "Clinic", day: scope.story_day, status: "review" });
    const rows = await store.listVisits(scope.id);
    expect(rows.map((v) => v.id).sort()).toEqual(["p1", "v1", "v2", "v3"]);
    for (const v of rows) {
      expect(v.audio_fixture, v.id).toBeNull();
      expect(replayFixtureFor(v), v.id).toBeNull();
      expect(isSampleVisit(scope, v), v.id).toBe(false);
      const view = (await buildVisitView(store, scope.id, v.id, { session: scope }))!;
      expect(view.replayable, v.id).toBeNull();
      expect(view.account?.sample, v.id).toBe(false);
      expect(view.lines, v.id).toEqual([]);
    }
  });

  it("an id that is not the story's replays when its row names a replay (the row decides, both ways)", () => {
    expect(replayFixtureFor({ id: randomUUID(), audio_fixture: "visit_B.wav" })).toBe("v2");
    expect(replayFixtureFor({ id: "v1", audio_fixture: "visit_D.wav" })).toBe("v3");
  });

  it("an account's recorded visit (a full uuid, no audio_fixture): null", async () => {
    const { a, scope } = await account("blank");
    const made = await startRecording(a);
    expect(made.id).toMatch(UUID);
    const row = (await store.getVisit(scope.id, made.id))!;
    expect(row.audio_fixture).toBeNull();
    expect(replayFixtureFor(row)).toBeNull();
    expect(isSampleVisit(scope, row)).toBe(false);
  });

  it("the example account: its planned v3 (visit_D.wav) gives v3, its three past sample visits theirs, and his own recording next to them null", async () => {
    const { a, scope } = await account("example");
    const rows = await store.listVisits(scope.id);
    expect(rows.map((v) => [v.id, v.status, v.audio_fixture])).toEqual([
      ["v1", "confirmed", "visit_A.wav"],
      ["v2", "confirmed", "visit_B.wav"],
      ["p1", "confirmed", "pharmacy_C.wav"],
      ["v3", "planned", "visit_D.wav"],
    ]);
    expect(Object.fromEntries(rows.map((v) => [v.id, replayFixtureFor(v)]))).toEqual(STORY);
    expect(isSampleVisit(scope, rows.find((v) => v.id === "v3")!)).toBe(true);
    const own = await startRecording(a);
    expect(own.id).toMatch(UUID);
    expect(replayFixtureFor((await store.getVisit(scope.id, own.id))!)).toBeNull();
    // his recording did not land on the sample visit
    expect((await store.getVisit(scope.id, "v3"))?.status).toBe("planned");
  });
});

// ---------------------------------------------------------------- 2. replayIdForAudioFixture

describe("replayIdForAudioFixture", () => {
  it("nothing gives nothing", () => {
    for (const v of [null, undefined, "", " ", "\t\n"]) expect(replayIdForAudioFixture(v), JSON.stringify(v)).toBeNull();
  });

  it("the four audio file names, and a replay id itself (accepted by design: lib/asr/fixtures.ts)", () => {
    expect(["visit_A.wav", "visit_B.wav", "pharmacy_C.wav", "visit_D.wav"].map((n) => replayIdForAudioFixture(n))).toEqual(["v1", "v2", "p1", "v3"]);
    expect(REPLAY_VISITS.map((id) => replayIdForAudioFixture(id))).toEqual(REPLAY_VISITS);
  });

  it("an unknown name gives null: other files, other spellings, paths, a line's id", () => {
    const unknown = ["visit_E.wav", "visit_A", "visit_A.mp3", "VISIT_A.WAV", "V1", "v4", "v0", "p2", "v1.utterances.json", "visits/v1", "../visits/v1", "v1/..", "v1,v2", "v1 v2", "v1-u08", "visit_A.wav.bak", "fixture:v1", "none", "0", "null", "undefined"];
    for (const name of unknown) expect(replayIdForAudioFixture(name), name).toBeNull();
    for (const name of unknown) expect(replayFixtureFor({ id: "v1", audio_fixture: name }), name).toBeNull();
  });

  // Shows: the two lookup tables are plain objects, so a name every object has (constructor, toString, __proto__ ...)
  // is taken for a replay: replayIdForAudioFixture hands back a function or Object.prototype instead of null.
  it("a name every object has (constructor, toString, __proto__, hasOwnProperty, valueOf) is not a replay either", () => {
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"];
    expect(names.map((n) => replayIdForAudioFixture(n))).toEqual(names.map(() => null));
    expect(names.map((n) => replayFixtureFor({ id: "v1", audio_fixture: n }))).toEqual(names.map(() => null));
  });

  // Shows: fixtureUtterances("constructor") does not answer null, it throws a TypeError (Object.prototype.constructor
  // has no utterances), so a request that names such a replay is an unhandled error instead of "no replay".
  it("fixtureUtterances answers null, never throws, for a name every object has", () => {
    for (const n of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) expect(fixtureUtterances(n), n).toBeNull();
  });

  // Shows: POST /api/visits { mode: "replay", fixture: "constructor" } is a 500 for any signed-in account (the body's
  // fixture reaches fixtureUtterances as it is); the designed answer for a name with no replay file is 409 no_replay.
  it("POST /api/visits { mode: replay, fixture: <a name every object has> } answers 409 no_replay like any unknown replay", async () => {
    const { a, scope } = await account("blank");
    const known = await visitsPost(req(a, "POST", "/api/visits", { mode: "replay", fixture: "v9" }));
    expect([known.status, ((await known.json()) as { error: string }).error]).toEqual([409, "no_replay"]);
    const answers: [number, string][] = [];
    for (const fixture of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const res = await visitsPost(req(a, "POST", "/api/visits", { mode: "replay", fixture })).catch((err: unknown) => new Response(JSON.stringify({ error: `threw ${(err as Error).name}` }), { status: 500 }));
      answers.push([res.status, ((await res.json()) as { error: string }).error]);
    }
    expect(await store.listVisits(scope.id)).toEqual([]);
    expect(answers).toEqual(answers.map(() => [409, "no_replay"]));
  });
});

// ---------------------------------------------------------------- 3. no request makes such a row

/**
 * Every handler under app/api/visits and app/api/asr that writes (POST, PATCH, PUT, DELETE), with a body that would be
 * accepted but for the extra fields. `json: false` is the one handler that takes bytes (its fields are in the query).
 */
interface Write {
  json: boolean;
  call: (a: TestAccount, visitId: string, extra: Record<string, unknown>) => Promise<Response>;
}
const q = (extra: Record<string, unknown>) => new URLSearchParams(Object.entries(extra).map(([k, v]) => [k, String(v)])).toString();
const WRITES: Record<string, Write> = {
  "visits/route.ts POST": { json: true, call: (a, _v, extra) => visitsPost(req(a, "POST", "/api/visits", { mode: "record", consent: { given: true }, place: "clinic", ...extra })) },
  "visits/[id]/route.ts PATCH": { json: true, call: (a, v, extra) => visitPatch(req(a, "PATCH", `/api/visits/${v}`, { date: "2099-01-01", ...extra }), params(v)) },
  "visits/[id]/confirm/route.ts POST": { json: true, call: (a, v, extra) => confirmPost(req(a, "POST", `/api/visits/${v}/confirm`, { mine: [], items: {}, ...extra }), params(v)) },
  "visits/[id]/extract/route.ts POST": { json: true, call: (a, v, extra) => extractPost(req(a, "POST", `/api/visits/${v}/extract`, { utterances: [{ t_start_ms: 0, t_end_ms: 900, text: "Good morning." }], ...extra }), params(v)) },
  "visits/[id]/finalize/route.ts POST": { json: true, call: (a, v, extra) => finalizePost(req(a, "POST", `/api/visits/${v}/finalize`, { job_id: "mockjob-none", ...extra }), params(v)) },
  "visits/[id]/keep/route.ts POST": { json: true, call: (a, v, extra) => keepPost(req(a, "POST", `/api/visits/${v}/keep`, { keep: true, ...extra }), params(v)) },
  "visits/[id]/mine/route.ts POST": { json: true, call: (a, v, extra) => minePost(req(a, "POST", `/api/visits/${v}/mine`, { line: `${v}-w1`, mine: true, ...extra }), params(v)) },
  "visits/[id]/note/route.ts POST": { json: true, call: (a, v, extra) => notePost(req(a, "POST", `/api/visits/${v}/note`, { text: "He said to rest.", ...extra }), params(v)) },
  // track R: one part of a long recording (a strict body of seq and path; the path here is not a file of his visit)
  "visits/[id]/parts/route.ts POST": { json: true, call: (a, v, extra) => partsPost(req(a, "POST", `/api/visits/${v}/parts`, { seq: 0, path: "nowhere/recording-x.wav", ...extra }), params(v)) },
  "visits/[id]/replay/route.ts POST": { json: true, call: (a, v, extra) => replayPost(req(a, "POST", `/api/visits/${v}/replay`, { source: "live", ...extra }), params(v)) },
  "visits/[id]/scripted/route.ts POST": { json: true, call: (a, v, extra) => scriptedPost(req(a, "POST", `/api/visits/${v}/scripted`, { on: true, ...extra }), params(v)) },
  "visits/[id]/verdict/route.ts POST": { json: true, call: (a, v, extra) => verdictPost(req(a, "POST", `/api/visits/${v}/verdict`, { items: ["x"], verdict: "right", ...extra }), params(v)) },
  "asr/jobs/route.ts POST": { json: true, call: (a, v, extra) => jobsPost(req(a, "POST", "/api/asr/jobs", { visit_id: v, ...extra })) },
  "asr/realtime-token/route.ts POST": { json: true, call: (a, v, extra) => tokenPost(req(a, "POST", "/api/asr/realtime-token", { visit_id: v, ...extra })) },
  "asr/jobs/[id]/route.ts DELETE": { json: false, call: (a, _v, extra) => jobDelete(req(a, "DELETE", `/api/asr/jobs/mockjob-none?${q(extra)}`), params("mockjob-none")) },
  "asr/chunk/route.ts POST": {
    json: false,
    call: (a, v, extra) =>
      chunkPost(
        new NextRequest(`http://localhost/api/asr/chunk?${q({ visit_id: v, kind: "final", line: `${v}-w1`, offset_ms: 0, seq: 0, ...extra })}`, {
          method: "POST",
          headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "audio/wav" },
          body: encodeWav(new Float32Array(16_000).fill(0.02)).buffer as ArrayBuffer,
        }),
      ),
  },
};

/** route.ts files under a folder, with the write methods each exports, as "visits/[id]/keep/route.ts POST". */
function writeHandlers(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const rel = path.relative(path.join(WEB, "app", "api"), p).split(path.sep).join("/");
        for (const m of readFileSync(p, "utf8").matchAll(/^export (?:async function|const) (POST|PATCH|PUT|DELETE)\b/gm)) out.push(`${rel} ${m[1]}`);
      }
    }
  };
  walk(path.join(WEB, "app", "api", folder));
  return out;
}

describe("no request gives an account's visit an audio_fixture, or an id, of its choosing", () => {
  it("the table covers every write handler under app/api/visits and app/api/asr", () => {
    const found = [...writeHandlers("visits"), ...writeHandlers("asr")].sort();
    expect(found.length).toBeGreaterThanOrEqual(15);
    expect(found).toEqual(Object.keys(WRITES).sort());
  });

  it("no route handler in app/ names audio_fixture at all: the column is written by the seed and by the pipeline's copy of a sample row only", () => {
    const naming: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && readFileSync(p, "utf8").includes("audio_fixture")) naming.push(path.relative(WEB, p).split(path.sep).join("/"));
      }
    };
    walk(path.join(WEB, "app"));
    expect(naming).toEqual([]);
    // the scan reads the tree it means to: the visit routes are in it
    expect(readFileSync(path.join(WEB, "app", "api", "visits", "route.ts"), "utf8")).toContain("startVisit");
  });

  it("a body that names audio_fixture, id, script_section or status is refused whole (400 invalid_body) by every JSON handler; nothing is written", async () => {
    const { a, scope } = await account("blank");
    const visit = await startRecording(a);
    const before = await store.listVisits(scope.id);
    expect(before).toHaveLength(1);
    const extras: Record<string, unknown>[] = [{ audio_fixture: "v1" }, { audio_fixture: "visit_A.wav" }, { id: "v1" }, { visit: { id: "v1", audio_fixture: "v1" } }, { script_section: "copy:v1" }, { status: "confirmed" }];
    for (const [name, w] of Object.entries(WRITES)) {
      if (!w.json) continue;
      for (const extra of extras) {
        // asr/jobs and realtime-token take visit_id: an `id` next to it is still an unknown key
        const res = await w.call(a, visit.id, extra);
        const body = (await res.json()) as { error?: string };
        // crew-only and demo-only handlers answer 404 to an account before they read anything (H2)
        const want = name.startsWith("visits/[id]/scripted") || name.startsWith("visits/[id]/extract") ? [404, "not_found"] : [400, "invalid_body"];
        expect([res.status, body.error], `${name} ${JSON.stringify(extra)}`).toEqual(want);
      }
    }
    expect(await store.listVisits(scope.id)).toEqual(before);
  });

  it("the handler that takes bytes, and the one with no body, ignore such fields in the query; the row stays as it was", async () => {
    const { a, scope } = await account("blank");
    const visit = await startRecording(a);
    const before = await store.listVisits(scope.id);
    const chunk = await WRITES["asr/chunk/route.ts POST"].call(a, visit.id, { audio_fixture: "v1", fixture: "v1", id: "v1" });
    expect([chunk.status, ((await chunk.json()) as { error: string }).error]).toEqual([409, "not_whisper"]);
    const del = await WRITES["asr/jobs/[id]/route.ts DELETE"].call(a, visit.id, { audio_fixture: "v1", fixture: "v1", visit_id: visit.id });
    expect([del.status, ((await del.json()) as { error: string }).error]).toEqual([404, "job_not_found"]);
    expect(await store.listVisits(scope.id)).toEqual(before);
  });

  it("after every accepted body of every handler, each of his visit rows still has no audio_fixture and an id the server made", async () => {
    const { a, scope } = await account("blank");
    const visit = await startRecording(a);
    const statuses: Record<string, number> = {};
    for (const [name, w] of Object.entries(WRITES)) statuses[name] = (await w.call(a, visit.id, {})).status;
    // the calls did reach the handlers (not one blanket refusal): a second recording started, the jobs handler answered
    expect(statuses["visits/route.ts POST"]).toBe(200);
    expect(statuses["asr/jobs/route.ts POST"]).toBe(200);
    expect(statuses["visits/[id]/keep/route.ts POST"]).toBe(200);
    const rows = await store.listVisits(scope.id);
    expect(rows).toHaveLength(2);
    for (const v of rows) {
      expect(v.id).toMatch(UUID);
      expect(v.audio_fixture).toBeNull();
      expect(replayFixtureFor(v)).toBeNull();
    }
  });

  it("POST /api/visits { mode: replay, fixture } never makes a row: 404 on a blank account for each of the story's four, 409 for an unknown name", async () => {
    const { a, scope } = await account("blank");
    for (const fixture of REPLAY_VISITS) {
      const res = await visitsPost(req(a, "POST", "/api/visits", { mode: "replay", fixture }));
      expect([res.status, ((await res.json()) as { error: string }).error], fixture).toEqual([404, "visit_not_found"]);
    }
    const unknown = await visitsPost(req(a, "POST", "/api/visits", { mode: "replay", fixture: "visit_A.wav" }));
    expect([unknown.status, ((await unknown.json()) as { error: string }).error]).toEqual([409, "no_replay"]);
    expect(await store.listVisits(scope.id)).toEqual([]);
  });

  it("the control: a row that did carry a replay name would replay (so the fence above is what keeps an account out)", async () => {
    const { scope } = await account("blank");
    const planted = await store.upsertVisit(scope.id, { id: randomUUID(), kind: "clinic", place: "Clinic", day: scope.story_day, audio_fixture: "v1" });
    expect(replayFixtureFor(planted)).toBe("v1");
    expect(isSampleVisit(scope, planted)).toBe(true);
  });
});
