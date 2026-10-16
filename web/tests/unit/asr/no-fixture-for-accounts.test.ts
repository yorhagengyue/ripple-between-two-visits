/**
 * An account's own visit is never answered with the demo's replay files (C2 track G guard; real-app.md H6 line 1106,
 * 8.7 lines 1487-1488, 6.7 lines 1174-1179, 6.8 lines 1196-1204, 4.6 lines 979-990, 2.14).
 *
 * The demo's story has four visits (v1, v2, p1, v3). Each has a replay file web/fixtures/visits/<id>.utterances.json
 * (the same lines are the scripted fallback's script) and a few stand-in clips web/fixtures/visits/clips/<line>.wav.
 * The rule (H6): a visit on an account is transcribed from its own recording or not at all; a replay file answers
 * only for a row whose own audio_fixture names it, which only the demo and the example account's sample visits have.
 * A visit of his that happens to be called "v1" is no exception.
 *
 * What this file does:
 *   - it reads every line of every replay file from disk into a set of needles (the normalised words, and the line
 *     ids such as v1-u08), and checks that the script the fallback uses is made of the same lines;
 *   - for a blank account whose visit is called v1, a blank account whose visit has a uuid, and an example account's
 *     own visit next to its sample visits, under SPEECH_PROVIDER=mock and under whisper with the service down, with
 *     the developer tools off (a production build) and on, it walks one recording through the route handlers the visit
 *     screen calls, with and without every switch that names a fixture (the x-ripple-devfake-fixture header, query
 *     and body fields). Each answer is the designed one, the visit ends "awaiting_transcript" with no line, and no
 *     answer, store row or event carries a needle;
 *   - the same walk on a demo session's v1 and on the example account's sample visit v3 does carry the needles (the
 *     scan can fail);
 *   - the developer stand-in (SPEECH_PROVIDER=devfake) is the one setting where the header works, and only with the
 *     developer tools on;
 *   - every place the code still looks a fixture up by a visit's id is tried on an account whose visit is called v1.
 *
 * Seven of these cases failed when they were written and were fixed in the code with them (web/progress/g.md): the
 * stand-in clip, the replay taking his own visit, the script, the medicine card's lines and a line's stand-in clip were
 * found by the visit's id; the stand-in's header was read with the developer tools off.
 *
 * Where the summary, the design and the code's recorded decisions differ, this file follows:
 *   - 8.7 says the transcript is empty; the visit still has one item, the consent tap of real-app 2.12
 *     ("<visit>-consent-screen", written when the recording starts). The walk asserts exactly that one item.
 *   - 6.8 says replayFallbackAllowed should decide by the scope. The code keeps the environment switch and decides by
 *     the row's audio_fixture (web/progress/f1.md: "账号的拜访没有回放和 mock 转写（只认 audio_fixture）"); the walk
 *     leaves ASR_REPLAY_FALLBACK at its default (on), the harder case.
 *   - the example account's three past visits carry the replay files' lines as their transcripts and v3 replays, by
 *     design (4.2, 4.6); the walk on an example account is his own new recording, and the sample rows must not change.
 *   - a filming account (web/progress/j.md, second round, item 3) may use the script behind three conditions; that is
 *     tests/unit/crew/filming-second.test.ts. Here every account is an ordinary one.
 *   - the film crew's gate is one answer (web/progress/e.md, item 12 "拍摄组口令一道门"; real-app 5.2): the crew's
 *     credential and a filming scope are the whole rule of the scripted fallback, and nothing is unlocked per session.
 *     So the walk tries the script with the crew's real credential in every form, and checks that the account is no
 *     filming scope; the route answers 404 not_found all the same.
 *   - in the demo, a visit that already happened in the story is watched again in a copy (real-app 12; e.md: "v1-again-…",
 *     script_section "copy:v1"); on its own story day the replay is the visit itself. The demo control runs both.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chunkPost } from "@/app/api/asr/chunk/route";
import { GET as jobGet } from "@/app/api/asr/jobs/[id]/route";
import { GET as jobsGet, POST as jobsPost } from "@/app/api/asr/jobs/route";
import { POST as tokenPost } from "@/app/api/asr/realtime-token/route";
import { GET as familyClipGet } from "@/app/api/family/clip/route";
import { POST as answerPost } from "@/app/api/meds/[id]/answer/route";
import { GET as medGet } from "@/app/api/meds/[id]/route";
import { GET as clipGet } from "@/app/api/visits/[id]/clip/route";
import { POST as extractPost } from "@/app/api/visits/[id]/extract/route";
import { POST as finalizePost } from "@/app/api/visits/[id]/finalize/route";
import { POST as replayPost } from "@/app/api/visits/[id]/replay/route";
import { GET as visitGet } from "@/app/api/visits/[id]/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { AccountReviewPage } from "@/components/visit/elder/pages";
import { DEVFAKE_HEADER, fixtureUtterances, REPLAY_VISITS, WhisperSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, getBlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { confirmLabel, readLabel, type MedsDeps } from "@/lib/meds/write";
import { CREW_COOKIE, CREW_HEADER, crewCookieAccepted, crewCookieValue, crewKeyAccepted, resetCrewAttempts } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { NewUtterance, SessionRow, VisitRow } from "@/lib/store/types";
import { loadTemplate } from "@/lib/story/seed";
import { pageSubjectFor, selfSubject } from "@/lib/subject";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";
import { fallbackAllowed, filmingSession, scriptFor } from "@/lib/visit/fallback";
import { finalizeVisit, processChunk, setScriptedFallback, startVisit } from "@/lib/visit/pipeline";
import { clearVisitLive, visitLive } from "@/lib/visit/state";
import type { VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";
import { encodeWav } from "@/lib/visit/wav";
import { agreedLink } from "../../support/agreed-link";
import { labelPng } from "../meds/helpers";
import { fakeConfig, fakeWhisper, type FakeWhisper } from "./fake-whisper";

const store = getMemoryStore();
const WEB = process.cwd();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const savedEnv = { ...process.env };
let blobDir: string;

const speechCache = (): Map<string, unknown> => {
  const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
  g.__rippleSpeech ??= new Map();
  return g.__rippleSpeech;
};

beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-g-h6-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  process.env.MOCK_ASR_JOB_MS = "0";
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});
beforeEach(() => {
  // offline, whatever the shell exported: the rules label a record, nothing is translated or read aloud
  vi.stubEnv("LLM_PROVIDER", "mock");
  vi.stubEnv("ASR_REPLAY_FALLBACK", "on");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  speechCache().delete("whisper");
  speechCache().delete("devfake");
  await resetCrewAttempts();
});

// ---------------------------------------------------------------- the needles

interface Line {
  id: string;
  t_start_ms: number;
  text: string;
}

/** Every replay file on disk: "v1" -> its lines. Read from the folder, so a fifth file is a fifth set of needles. */
function readReplayFiles(): Record<string, Line[]> {
  const dir = path.join(WEB, "fixtures", "visits");
  const out: Record<string, Line[]> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".utterances.json")).sort()) {
    out[f.replace(".utterances.json", "")] = (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { utterances: Line[] }).utterances;
  }
  return out;
}

const FILES = readReplayFiles();
const LINES: Line[] = Object.values(FILES).flat();
const lineOf = (id: string): Line => LINES.find((l) => l.id === id)!;
const ids = (visit: string): string[] => FILES[visit].map((l) => l.id);

/** Words only: case, punctuation and spacing do not hide a line. */
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** A line this long (normalised) is looked for inside any string; a shorter one ("对。") only as a whole string. */
const LONG = 12;
const LONG_NEEDLES: [string, string][] = LINES.filter((l) => norm(l.text).length >= LONG).map((l) => [norm(l.text), l.id]);
const SHORT_NEEDLES: [string, string][] = LINES.filter((l) => norm(l.text).length < LONG).map((l) => [norm(l.text), l.id]);
const ID_NEEDLE = new RegExp(`(?<![A-Za-z0-9])(?:${LINES.map((l) => l.id).join("|")})(?![0-9])`, "g");

/** Stand-in clips on disk: file name -> bytes. */
const CLIPS: [string, Buffer][] = readdirSync(path.join(WEB, "fixtures", "visits", "clips"))
  .filter((f) => f.endsWith(".wav"))
  .sort()
  .map((f) => [f, readFileSync(path.join(WEB, "fixtures", "visits", "clips", f))]);

/**
 * The needles in any value (strings and keys, however deep): "text:v1-u08" when a string carries that line's words,
 * "id:v1-u08" when it names the line. Sorted, each once.
 */
function hits(value: unknown): string[] {
  const out = new Set<string>();
  const str = (s: string) => {
    const n = norm(s);
    for (const [k, id] of SHORT_NEEDLES) if (n === k) out.add(`text:${id}`);
    if (n.length >= LONG) for (const [k, id] of LONG_NEEDLES) if (n.includes(k)) out.add(`text:${id}`);
    for (const m of s.matchAll(ID_NEEDLE)) out.add(`id:${m[0]}`);
  };
  const walk = (v: unknown) => {
    if (typeof v === "string") str(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        str(k);
        walk(x);
      }
    }
  };
  walk(value);
  return [...out].sort();
}
const textHits = (value: unknown): string[] => hits(value).filter((h) => h.startsWith("text:")).map((h) => h.slice(5));

describe("the needles", () => {
  it("are every line of the four replay files: 52 lines, and the story's required lines among them", () => {
    expect(Object.keys(FILES)).toEqual(["p1", "v1", "v2", "v3"]);
    expect(Object.keys(FILES).sort()).toEqual([...REPLAY_VISITS].sort());
    expect(Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, v.length]))).toEqual({ p1: 3, v1: 12, v2: 17, v3: 20 });
    expect(LINES).toHaveLength(52);
    expect(new Set(LINES.map((l) => l.id)).size).toBe(52);
    expect(LONG_NEEDLES.length + SHORT_NEEDLES.length).toBe(52);
    expect(SHORT_NEEDLES.map(([, id]) => id)).toEqual(["v2-u15"]);
    expect(lineOf("v1-u08").text).toBe("At home, we want it below 135 over 85.");
    // R1-R4, the story's doctor's own words, are replay lines
    const required = loadTemplate("mr-tan").required_doctor_lines;
    expect(required.map((r) => textHits(r.text))).toEqual([["v1-u08"], ["v1-u09"], ["v2-u06"], ["v2-u08"]]);
    expect(CLIPS.map(([f]) => f)).toEqual(["v1-u08.wav", "v1-u09.wav", "v2-u06.wav", "v2-u08.wav", "v3-u19.wav", "v3-u20.wav"]);
  });

  it("the scripted fallback's script is these lines and nothing else (a story visit's own file; a filming account's scene by its day)", () => {
    const story = loadTemplate("mr-tan");
    for (const v of story.visits) {
      const own = scriptFor({ kind: "filming" }, { id: v.id, day: v.day });
      expect(own.map((l) => [l.id, l.text]), v.id).toEqual(FILES[v.id].map((l) => [l.id, l.text]));
      const scene = scriptFor({ kind: "account", filming: true, d0: story.meta.d0 }, { id: randomUUID(), day: v.day });
      expect(scene.map((l) => l.id), v.id).toEqual(ids(v.id));
    }
    expect(story.visits.map((v) => v.id).sort()).toEqual(Object.keys(FILES));
  });

  it("the scan finds a planted line: its words inside other words, whatever the case and punctuation; its id as a value or a key", () => {
    expect(hits({ a: [{ text: "He said: AT HOME we want it, below 135 over 85 ... right?" }] })).toEqual(["text:v1-u08"]);
    expect(hits("对。")).toEqual(["text:v2-u15"]);
    expect(hits(" 对 ")).toEqual(["text:v2-u15"]);
    expect(hits("不对。")).toEqual([]);
    expect(hits({ "v1-u08": 1 })).toEqual(["id:v1-u08"]);
    expect(hits("/api/visits/v1/clip?u=v3-u19")).toEqual(["id:v3-u19"]);
    expect(hits(["v1-u080", "xv1-u08", "v1-w08", "v1-consent-screen", "v1"])).toEqual([]);
    expect(hits({ view: { lines: [], status: "awaiting_transcript" }, detail: "no replay file for visit v1" })).toEqual([]);
  });
});

// ---------------------------------------------------------------- the server's settings

type Tools = "off" | "on";
type Speech = "mock" | "whisper, the service down";

/**
 * The developer tools as a server has them (lib/dev/enabled.ts): off is a production build without RIPPLE_DEV_TOOLS,
 * with the crew key it was given in SCRIPTED_FALLBACK_KEY; on is this test run, where the dev crew key counts. Returns
 * the crew key that server accepts (the crew's cookie and header in the walk are made from it, never invented).
 */
function setTools(tools: Tools): string {
  vi.stubEnv("RIPPLE_DEV_TOOLS", "");
  vi.stubEnv("RIPPLE_DEPLOYED", "");
  let key: string;
  if (tools === "off") {
    key = `crew-key-${randomUUID()}`;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", key);
  } else {
    key = DEV_ONLY_CREW_KEY;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
  }
  expect(devToolsEnabled()).toBe(tools === "on");
  expect(crewKeyAccepted(key)).toBe(true);
  expect(crewCookieAccepted(crewCookieValue(key))).toBe(true);
  return key;
}

function setSpeech(speech: Speech): FakeWhisper | null {
  if (speech === "mock") {
    vi.stubEnv("SPEECH_PROVIDER", "mock");
    return null;
  }
  const fake = fakeWhisper();
  fake.mode = "down";
  speechCache().set("whisper", new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch }));
  vi.stubEnv("SPEECH_PROVIDER", "whisper");
  return fake;
}

// ---------------------------------------------------------------- who asks, and the requests

interface Actor {
  scope: SessionRow;
  /** an account: his rp_at cookie; a demo session: null (the session id rides in the query) */
  token: string | null;
}

/** Everything a request can carry that names a fixture without being part of the route's own contract. */
const SWITCH_HEADERS: Record<string, string> = { [DEVFAKE_HEADER]: "v1" };
const SWITCH_QUERY: Record<string, string> = { fixture: "v1", replay: "v1", visit: "v1", u: "v1-u08", audio_fixture: "visit_A.wav" };

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string>;
  switches?: boolean;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  wav?: boolean;
}

function request(actor: Actor, method: string, pathname: string, o: RequestOptions = {}): NextRequest {
  const query = new URLSearchParams({ ...(o.switches ? SWITCH_QUERY : {}), ...(actor.token ? {} : { session: actor.scope.id }), ...(o.query ?? {}) }).toString();
  const jar = { ...(actor.token ? { rp_at: actor.token } : {}), ...(o.cookies ?? {}) };
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = { ...(o.switches ? SWITCH_HEADERS : {}), ...(o.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (o.wav) headers["content-type"] = "audio/wav";
  else if (o.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${pathname}${query ? `?${query}` : ""}`, {
    method,
    headers,
    body: o.wav ? (encodeWav(new Float32Array(16_000 * 2).fill(0.02)).buffer as ArrayBuffer) : o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface Answer {
  status: number;
  /** the parsed body of a JSON answer, else null */
  json: unknown;
  /** the bytes of any other answer, else null */
  bytes: Buffer | null;
  standIn: string | null;
  setCookie: string[];
}

async function answerOf(res: Response): Promise<Answer> {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const base = { status: res.status, standIn: res.headers.get("x-ripple-stand-in"), setCookie: res.headers.getSetCookie() };
  return type.includes("json") ? { ...base, json: JSON.parse(buf.toString("utf8")) as unknown, bytes: null } : { ...base, json: null, bytes: buf };
}

/** Needles in a set of answers, as "step: needle"; a body that is one of the stand-in clips counts as "clip <file>". */
function scan(answers: Record<string, Answer>): string[] {
  const out: string[] = [];
  for (const [step, a] of Object.entries(answers)) {
    for (const h of hits(a.json)) out.push(`${step}: ${h}`);
    if (a.bytes) {
      for (const [file, bytes] of CLIPS) if (a.bytes.equals(bytes)) out.push(`${step}: clip ${file}`);
      for (const h of hits(a.bytes.toString("utf8"))) out.push(`${step}: ${h}`);
    }
  }
  return out;
}

async function account(space: "blank" | "example"): Promise<{ a: TestAccount; actor: Actor }> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `h6${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return { a, actor: { scope: (await store.getSession(a.userId))!, token: a.tokens.access_token } };
}

const WHO = ["a blank account whose visit is called v1", "a blank account whose visit has a uuid", "an example account's own visit next to its sample visits"] as const;
type Who = (typeof WHO)[number];

/**
 * The account, ready to record. The server makes every visit id (tests/unit/visit/replay-fixture-for.test.ts: no body
 * chooses one), so a visit called v1 is made the one way it can be: today's planned follow-up, which his recording
 * continues (lib/visit/pipeline.ts startVisit), here with that id.
 */
async function someone(who: Who): Promise<{ a: TestAccount; actor: Actor; visitId: string | null }> {
  const made = await account(who.startsWith("an example") ? "example" : "blank");
  if (who !== WHO[0]) return { ...made, visitId: null };
  await store.upsertVisit(made.actor.scope.id, { id: "v1", kind: "follow_up", place: "Clinic", day: made.actor.scope.story_day, status: "planned" });
  return { ...made, visitId: "v1" };
}

/** visit id -> the lines the store holds for it ("id|text"), for every visit of the scope. */
async function transcripts(scopeId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const v of await store.listVisits(scopeId)) out[v.id] = (await store.listUtterances(scopeId, v.id)).map((u) => `${u.id}|${u.text}`);
  return out;
}

// ---------------------------------------------------------------- the walk

const OWN_SENTENCE = "Good morning doctor, I brought my readings.";
const RECORD = { mode: "record", consent: { given: true }, place: "clinic" } as const;

interface Walk {
  visitId: string;
  answers: Record<string, Answer>;
}

async function settle(actor: Actor, jobId: string, visitId: string, switches: boolean): Promise<Answer> {
  for (let i = 0; i < 300; i++) {
    const a = await answerOf(await jobGet(request(actor, "GET", `/api/asr/jobs/${jobId}`, { query: { visit_id: visitId }, switches }), params(jobId)));
    if ((a.json as { status?: string } | null)?.status !== "pending") return a;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("the job is still pending");
}

/**
 * One recording through the handlers the visit screen calls, in its order: start, the realtime token, a piece of
 * audio, the replay, a sentence from the browser (and one with the crew's fallback flag and the crew's cookie), the
 * scripted switch (no crew; the crew's cookie; the crew's key in the header; the key typed), her clip route, the
 * recording saved, End visit (the whole-visit job, its poll, the reopen check, finalize), and the screen's data.
 * `switches`: every request also carries the fixture names.
 */
async function walk(actor: Actor, o: { start: Record<string, unknown>; switches: boolean; crewKey: string }): Promise<Walk> {
  const sw = o.switches;
  const A: Record<string, Answer> = {};
  A.start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: o.start, switches: sw })));
  const visitId = (A.start.json as { visit?: { id?: string } } | null)?.visit?.id ?? "";
  if (!visitId) return { visitId, answers: A };
  const at = `/api/visits/${visitId}`;
  const p = params(visitId);
  try {
    A.token = await answerOf(await tokenPost(request(actor, "POST", "/api/asr/realtime-token", { body: { visit_id: visitId }, switches: sw })));
    A.chunk = await answerOf(await chunkPost(request(actor, "POST", "/api/asr/chunk", { query: { visit_id: visitId, kind: "final", line: `${visitId}-w1`, offset_ms: "1000", seq: "1" }, wav: true, switches: sw })));
    A.replay = await answerOf(await replayPost(request(actor, "POST", `${at}/replay`, { body: { source: "live", speed: 0.25 }, switches: sw }), p));
    A.extract = await answerOf(await extractPost(request(actor, "POST", `${at}/extract`, { body: { utterances: [{ t_start_ms: 0, t_end_ms: 900, text: OWN_SENTENCE }] }, switches: sw }), p));
    A.extractCrewFallback = await answerOf(
      await extractPost(request(actor, "POST", `${at}/extract`, { body: { utterances: [{ t_start_ms: 1000, t_end_ms: 1900, text: OWN_SENTENCE }], fallback: true }, cookies: { [CREW_COOKIE]: crewCookieValue(o.crewKey) }, switches: sw }), p),
    );
    A.scripted = await answerOf(await scriptedPost(request(actor, "POST", `${at}/scripted`, { body: { on: true }, switches: sw }), p));
    A.scriptedCrewCookie = await answerOf(await scriptedPost(request(actor, "POST", `${at}/scripted`, { body: { on: true }, cookies: { [CREW_COOKIE]: crewCookieValue(o.crewKey) }, switches: sw }), p));
    A.scriptedCrewHeader = await answerOf(await scriptedPost(request(actor, "POST", `${at}/scripted`, { body: { on: true }, headers: { [CREW_HEADER]: o.crewKey }, switches: sw }), p));
    A.scriptedCrewTyped = await answerOf(await scriptedPost(request(actor, "POST", `${at}/scripted`, { body: { on: true, key: o.crewKey }, switches: sw }), p));
    A.familyClip = await answerOf(await familyClipGet(request(actor, "GET", "/api/family/clip", { query: { visit: visitId, u: `${visitId}-u08` }, switches: sw })));
    // the page uploads the recording, then ends the visit
    const audioPath = `${blobPrefix(actor.scope)}/visits/${visitId}/recording-test.wav`;
    await getBlobStore().putObject("audio", audioPath, encodeWav(new Float32Array(16_000 * 3).fill(0.02)), "audio/wav");
    A.jobs = await answerOf(await jobsPost(request(actor, "POST", "/api/asr/jobs", { body: { visit_id: visitId, audio_path: audioPath }, switches: sw })));
    const jobId = (A.jobs.json as { job_id?: string | null } | null)?.job_id;
    if (typeof jobId === "string") A.poll = await settle(actor, jobId, visitId, sw);
    A.reopen = await answerOf(await jobsGet(request(actor, "GET", "/api/asr/jobs", { query: { visit_id: visitId }, switches: sw })));
    A.finalize = await answerOf(await finalizePost(request(actor, "POST", `${at}/finalize`, { body: { job_id: typeof jobId === "string" ? jobId : `mockjob-${randomUUID()}` }, switches: sw }), p));
    A.view = await answerOf(await visitGet(request(actor, "GET", at, { switches: sw }), p));
  } finally {
    // a replay that did start stops at its next step
    clearVisitLive(actor.scope.id, visitId);
  }
  return { visitId, answers: A };
}

const NOT_FOUND = { error: "not_found" };

/** The designed answers of the walk on an account's own visit: nothing was heard, the recording waits for its text. */
function expectNothingHeard(w: Walk, speech: Speech, prefix: string): void {
  const A = w.answers;
  const id = w.visitId;
  const status = (step: string) => [step, A[step]?.status];
  const started = A.start.json as { visit: VisitRow; view: VisitView };
  expect(status("start")).toEqual(["start", 200]);
  expect(started.visit).toMatchObject({ id, status: "recording", audio_fixture: null, audio_path: null, consent_utterance_id: null, script_section: null });
  expect(started.view).toMatchObject({ lines: [], cards: [], qlist: null, replayable: null, stream: { state: "idle", fixture: null }, fallback: { allowed: false, on: false, unlockable: false }, account: { sample: false, transcript: null } });

  if (speech === "mock") {
    expect(status("token")).toEqual(["token", 200]);
    expect(A.token.json).toEqual({ provider: "mock", token: expect.stringMatching(/^mock-/), expires_at: expect.any(Number) });
    expect(status("chunk")).toEqual(["chunk", 409]);
    expect(A.chunk.json).toEqual({ error: "not_whisper", detail: "live chunks are only taken with SPEECH_PROVIDER=whisper or tencent" });
  } else {
    // the service does not answer: no captions this time, and no replay to play instead
    expect(status("token")).toEqual(["token", 200]);
    expect(A.token.json).toEqual({ provider: "mock", token: expect.stringMatching(/^mock-/), expires_at: expect.any(Number), fallback: { reason: "unreachable", replay: null } });
    expect(status("chunk")).toEqual(["chunk", 409]);
    expect(A.chunk.json).toEqual({ error: "asr_fallback_active", reason: "unreachable", fallback: true, replay: null });
  }
  expect(status("replay")).toEqual(["replay", 409]);
  expect(A.replay.json).toEqual({ error: "no_replay", detail: `no replay file for visit ${id}` });
  // sentences from the browser are never an account's record
  expect(status("extract")).toEqual(["extract", 404]);
  expect(A.extract.json).toEqual(NOT_FOUND);
  // nor with the crew's cookie and the fallback flag (the crew's switch on a browser sentence)
  expect(status("extractCrewFallback")).toEqual(["extractCrewFallback", 404]);
  expect(A.extractCrewFallback.json).toEqual(NOT_FOUND);
  // the story's script as a fallback: as if the route did not exist, crew or not (H2)
  for (const step of ["scripted", "scriptedCrewCookie", "scriptedCrewHeader", "scriptedCrewTyped"]) {
    expect(status(step)).toEqual([step, 404]);
    expect(A[step].json, step).toEqual(NOT_FOUND);
    expect(A[step].setCookie, step).toEqual([]);
  }
  // her clip route is hers only
  expect(status("familyClip")).toEqual(["familyClip", 404]);
  expect(A.familyClip.json).toEqual(NOT_FOUND);

  if (speech === "mock") {
    // real-app 2.14, 8.7: no transcription service, so no job and never the script
    expect(status("jobs")).toEqual(["jobs", 200]);
    expect(A.jobs.json).toEqual({ job_id: null, status: "awaiting_transcript", audio_saved: true });
    expect(A.poll).toBeUndefined();
    expect(status("reopen")).toEqual(["reopen", 200]);
    expect(A.reopen.json).toEqual({ job_id: null, visit_status: "awaiting_transcript" });
    expect(status("finalize")).toEqual(["finalize", 404]);
    expect(A.finalize.json).toEqual({ error: "job_not_found" });
  } else {
    expect(status("jobs")).toEqual(["jobs", 200]);
    const jobId = (A.jobs.json as { job_id: string }).job_id;
    expect(A.jobs.json).toEqual({ job_id: expect.stringMatching(/^whisperjob-/), status: "pending", wait_ms: expect.any(Number) });
    expect(status("poll")).toEqual(["poll", 200]);
    expect(A.poll.json).toEqual({
      job_id: jobId,
      visit_id: id,
      status: "failed",
      error: "whisper_unavailable:unreachable",
      fallback: { reason: "unreachable", used: "none" },
      deferred: true,
      awaiting_transcript: true,
    });
    expect(status("reopen")).toEqual(["reopen", 200]);
    expect(A.reopen.json).toEqual({ job_id: jobId, status: "failed", visit_status: "awaiting_transcript" });
    expect(status("finalize")).toEqual(["finalize", 502]);
    expect(A.finalize.json).toEqual({ error: "job_failed", detail: "whisper_unavailable:unreachable" });
  }

  expect(status("view")).toEqual(["view", 200]);
  expect((A.view.json as { view: VisitView }).view).toMatchObject({
    visit: { id, status: "awaiting_transcript", audioPath: `${prefix}/visits/${id}/recording-test.wav` },
    lines: [],
    cards: [],
    qlist: null,
    counts: { doc: 0, toConfirm: 0, chk: 0, q: 0 },
    stream: { state: "idle", fixture: null },
    fallback: { allowed: false, on: false, unlockable: false },
    replayable: null,
    speech: speech === "mock" ? "mock" : "whisper",
    account: { ownNotes: [], transcript: "waiting", sample: false },
  });
}

describe.each<Tools>(["off", "on"])("an account's recording, developer tools %s", (tools) => {
  describe.each<Speech>(["mock", "whisper, the service down"])("SPEECH_PROVIDER %s", (speech) => {
    const cases = WHO.flatMap((who) => [false, true].map((sw) => [who, sw ? "every request naming a fixture" : "plain requests", sw] as const));

    it.each(cases)("%s, %s: it ends awaiting its transcript, with no line and nothing from the replay files", async (who, _label, switches) => {
      const crewKey = setTools(tools);
      const fake = setSpeech(speech);
      const { actor, visitId } = await someone(who);
      const scope = actor.scope;
      const before = { lines: await transcripts(scope.id), questions: await store.listQuestions(scope.id), meds: await store.listMeds(scope.id) };
      const head = await getBus().head(scope.id);

      const w = await walk(actor, { start: { ...RECORD, ...(switches ? { fixture: "v1" } : {}) }, switches, crewKey });

      // the id is the planted one, or one the server made; never one of the sample visits
      if (visitId) expect(w.visitId).toBe(visitId);
      else expect(w.visitId).toMatch(UUID);
      expectNothingHeard(w, speech, blobPrefix(scope));
      expect(Object.keys(w.answers)).toHaveLength(speech === "mock" ? 15 : 16);
      expect(scan(w.answers)).toEqual([]);

      // the store: the visit waits for its text; no line; its one item is the consent tap (real-app 2.12)
      const row = (await store.getVisit(scope.id, w.visitId))!;
      expect(row).toMatchObject({ status: "awaiting_transcript", audio_fixture: null, consent_utterance_id: null, script_section: null });
      expect(await store.listUtterances(scope.id, w.visitId)).toEqual([]);
      const items = await store.listVisitItems(scope.id, { visit_id: w.visitId });
      expect(items.map((i) => [i.id, i.type, i.utterance_ids])).toEqual([[`${w.visitId}-consent-screen`, "consent", []]]);
      expect(hits(items)).toEqual([]);
      // nothing else of his changed: the sample visits keep their lines (an example account), no question was answered
      expect(await transcripts(scope.id)).toEqual({ ...before.lines, [w.visitId]: [] });
      expect(await store.listQuestions(scope.id)).toEqual(before.questions);
      expect(await store.listMeds(scope.id)).toEqual(before.meds);
      if (who === WHO[2]) expect(Object.fromEntries(Object.entries(before.lines).map(([k, v]) => [k, v.length]))).toEqual({ v1: 12, v2: 17, p1: 3, v3: 0 });
      else expect(Object.values(before.lines).flat()).toEqual([]);
      // the scripted switch stayed off, and the account is no filming scope: with the crew's one gate that is the whole
      // rule (the crew's credential was in four of the requests above)
      expect(visitLive(scope.id, w.visitId).fallbackOn).toBe(false);
      const now = (await store.getSession(scope.id))!;
      expect([now.kind, filmingSession(now), fallbackAllowed(now)]).toEqual(["account", false, false]);
      // his event stream: the visit's events are there, and none carries a line of the story
      const events = getBus().recent(scope.id, { sinceId: head });
      expect(events.filter((e) => e.type === "visit.changed").length).toBeGreaterThanOrEqual(2);
      expect(hits(events)).toEqual([]);
      // the whisper setting really was the service that is down
      if (fake) expect(fake.calls.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------- positive controls

describe("the same walk where a replay is the designed answer (the scan can fail)", () => {
  // On the visit's own story day the replay is the visit itself (written into v1). On a later day the visit already
  // happened in the story: the replay is a re-watch, written into a copy "v1-again-<6 hex>" (real-app 12; lib/visit/
  // pipeline.ts replayCopy), and the story's own v1 keeps its confirmed record untouched.
  it.each([
    ["on the visit's own story day (day 0), written into v1", 0],
    ["on a later story day (day 29, where a judge lands), written into a copy", 29],
  ] as const)("a demo session's v1, %s: the replay starts, the whole-visit transcript is the replay file, every line of v1 is found", async (_label, day) => {
    const crewKey = setTools("on");
    setSpeech("mock");
    const demo = await store.createSession({ story_day: day, ttl_hours: 1 });
    const actor: Actor = { scope: demo, token: null };
    const head = await getBus().head(demo.id);
    const copy = day > 0;
    const w = await walk(actor, { start: { mode: "replay", fixture: "v1" }, switches: false, crewKey });
    const A = w.answers;
    if (copy) expect(w.visitId).toMatch(/^v1-again-[0-9a-f]{6}$/);
    else expect(w.visitId).toBe("v1");
    expect(await store.getVisit(demo.id, w.visitId)).toMatchObject({ day: 0, audio_fixture: "visit_A.wav", script_section: copy ? "copy:v1" : "D0", status: "review" });
    expect([A.replay.status, A.replay.json]).toEqual([200, { started_at: expect.any(Number), speed: 0.25, fixture: "v1", lines: 12, duration_ms: expect.any(Number) }]);
    expect(A.extract.status).toBe(200);
    // a judge's sandbox is no filming scope: the crew's fallback flag is refused in words, and writes nothing
    expect([A.extractCrewFallback.status, (A.extractCrewFallback.json as { error: string }).error]).toEqual([403, "fallback_filming_only"]);
    expect(A.jobs.json).toEqual({ job_id: expect.stringMatching(/^mockjob-/), status: "pending", wait_ms: expect.any(Number) });
    expect(A.poll.json).toMatchObject({ status: "done", source: "fixture" });
    expect(A.finalize.status).toBe(200);
    const view = (A.finalize.json as { view: VisitView }).view;
    expect(view.visit.status).toBe("review");
    expect(view.lines.map((l) => l.text)).toEqual(FILES.v1.map((l) => l.text));
    expect(view.replayable).toBe("v1");
    // the scan sees them by their words in three different answers and in the store, and by their ids in the job's
    // answer (and, when the replay is the visit itself, on the screen: a copy's lines get ids of their own)
    for (const step of ["poll", "finalize", "view"]) expect(textHits(A[step].json), step).toEqual(ids("v1"));
    for (const step of copy ? ["poll"] : ["poll", "finalize", "view"]) expect(hits(A[step].json).filter((h) => h.startsWith("id:")), step).toEqual(ids("v1").map((i) => `id:${i}`));
    if (!copy) expect(view.lines.map((l) => l.id)).toEqual(ids("v1"));
    expect(scan(w.answers).length).toBeGreaterThanOrEqual(copy ? 48 : 72);
    expect(textHits(await store.listUtterances(demo.id, w.visitId))).toEqual(ids("v1"));
    expect(getBus().recent(demo.id, { sinceId: head }).some((e) => e.type === "visit.changed")).toBe(true);
    // the copy leaves the story's own v1 as the seed made it: confirmed, with no line written into it
    if (copy) {
      expect(await store.getVisit(demo.id, "v1")).toMatchObject({ status: "confirmed", script_section: "D0" });
      expect(await store.listUtterances(demo.id, "v1")).toEqual([]);
    }
    // and the stand-in clip of the line that says R1 is served
    const r1 = view.lines.find((l) => l.text === lineOf("v1-u08").text)!;
    expect(r1.clip).toMatchObject({ standIn: true });
    const clip = await answerOf(await clipGet(request(actor, "GET", `/api/visits/${w.visitId}/clip`, { query: { u: r1.id } }), params(w.visitId)));
    expect([clip.status, clip.standIn]).toEqual([200, "1"]);
    expect(scan({ clip })).toEqual(["clip: clip v1-u08.wav"]);
  });

  it("the example account's sample visit v3: it replays by its own audio_fixture and says it is a sample", async () => {
    const crewKey = setTools("off");
    setSpeech("mock");
    const { actor } = await account("example");
    const scope = actor.scope;
    expect(await store.getVisit(scope.id, "v3")).toMatchObject({ status: "planned", audio_fixture: "visit_D.wav" });
    // before it is started the replay route refuses: the visit is not recording
    const early = await answerOf(await replayPost(request(actor, "POST", "/api/visits/v3/replay", { body: {} }), params("v3")));
    expect([early.status, early.json]).toEqual([409, { error: "not_recording" }]);

    const w = await walk(actor, { start: { mode: "replay", fixture: "v3" }, switches: false, crewKey });
    const A = w.answers;
    expect(w.visitId).toBe("v3");
    expect([A.replay.status, A.replay.json]).toEqual([200, { started_at: expect.any(Number), speed: 0.25, fixture: "v3", lines: 20, duration_ms: expect.any(Number) }]);
    // still his account: the browser's sentences and the script switch are refused as on any account
    expect([A.extract.status, A.extractCrewFallback.status, A.scripted.status, A.scriptedCrewCookie.status]).toEqual([404, 404, 404, 404]);
    expect(A.poll.json).toMatchObject({ status: "done", source: "fixture" });
    expect(A.finalize.status).toBe(200);
    const view = (A.finalize.json as { view: VisitView }).view;
    expect(view.lines.map((l) => l.id)).toEqual(ids("v3"));
    expect(view).toMatchObject({ replayable: "v3", account: { sample: true } });
    // (v3-u02 says the same words as v2-u02, so the scan names both)
    expect(textHits(A.finalize.json)).toEqual(expect.arrayContaining(ids("v3")));
    expect(textHits(await store.listUtterances(scope.id, "v3"))).toEqual(["v2-u02", ...ids("v3")]);
    const clip = await answerOf(await clipGet(request(actor, "GET", "/api/visits/v3/clip", { query: { u: "v3-u19" } }), params("v3")));
    expect([clip.status, clip.standIn]).toEqual([200, "1"]);
    expect(scan({ clip })).toEqual(["clip: clip v3-u19.wav"]);
  });
});

// ---------------------------------------------------------------- the developer stand-in

describe("x-ripple-devfake-fixture is the developer stand-in's switch: it works under SPEECH_PROVIDER=devfake with the developer tools on, and nowhere else", () => {
  it("devfake, tools on, the header names v1: the token offers v1, the replay starts, the transcript is v1 (a recorded test stand-in)", async () => {
    const crewKey = setTools("on");
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const { actor } = await someone(WHO[1]);
    const w = await walk(actor, { start: RECORD, switches: true, crewKey });
    const A = w.answers;
    expect(w.visitId).toMatch(UUID);
    expect(A.token.json).toEqual({ provider: "devfake", token: expect.stringMatching(/^devfake-/), expires_at: expect.any(Number), replay: "v1" });
    expect([A.replay.status, A.replay.json]).toMatchObject([200, { fixture: "v1", lines: 12 }]);
    expect(A.poll.json).toMatchObject({ status: "done", source: "fixture", model: "devfake" });
    expect(A.finalize.status).toBe(200);
    expect(textHits(A.finalize.json)).toEqual(ids("v1"));
    expect(textHits(await store.listUtterances(actor.scope.id, w.visitId))).toEqual(ids("v1"));
    // even the stand-in opens neither the browser's sentences nor the script to an account
    expect([A.extract.status, A.extractCrewFallback.status, A.scripted.status, A.scriptedCrewCookie.status, A.scriptedCrewHeader.status, A.scriptedCrewTyped.status]).toEqual([404, 404, 404, 404, 404, 404]);
  });

  it("devfake, tools on, no header: no fixture is guessed; the record is made with no line", async () => {
    const crewKey = setTools("on");
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const { actor } = await someone(WHO[0]);
    const w = await walk(actor, { start: RECORD, switches: false, crewKey });
    const A = w.answers;
    expect(w.visitId).toBe("v1");
    expect(A.token.json).toEqual({ provider: "devfake", token: expect.stringMatching(/^devfake-/), expires_at: expect.any(Number), replay: null });
    expect([A.replay.status, A.replay.json]).toEqual([409, { error: "no_replay", detail: "no replay file for visit v1" }]);
    expect(A.poll.json).toMatchObject({ status: "done", source: "fixture", utterances: [] });
    expect(A.finalize.status).toBe(200);
    expect((A.finalize.json as { view: VisitView }).view).toMatchObject({ visit: { status: "review" }, lines: [], cards: [] });
    expect(scan(w.answers)).toEqual([]);
    expect(await store.listUtterances(actor.scope.id, "v1")).toEqual([]);
  });

  it("devfake, tools off (a production build): the stand-in refuses to exist; the token and the job answer 503 not_configured whatever the header says", async () => {
    const { actor } = await someone(WHO[1]);
    setTools("off");
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD, switches: true })));
    const id = (start.json as { visit: { id: string } }).visit.id;
    const token = await answerOf(await tokenPost(request(actor, "POST", "/api/asr/realtime-token", { body: { visit_id: id }, switches: true })));
    const jobs = await answerOf(await jobsPost(request(actor, "POST", "/api/asr/jobs", { body: { visit_id: id }, switches: true })));
    expect([token.status, (token.json as { error: string }).error]).toEqual([503, "not_configured"]);
    expect([jobs.status, (jobs.json as { error: string }).error]).toEqual([503, "not_configured"]);
    expect(scan({ start, token, jobs })).toEqual([]);
    expect(await store.listUtterances(actor.scope.id, id)).toEqual([]);
  });

  // Shows: with SPEECH_PROVIDER=devfake on a build whose developer tools are off, POST /api/visits/[id]/replay still
  // takes the header (it reads the provider's name, not whether the stand-in may exist): it answers 200, the story's v1
  // runs as the live captions of an account's own recording, and its lines are written into his visit one by one.
  it("devfake, tools off: POST /api/visits/[id]/replay with the header is refused like the token and the job, and no replay starts", async () => {
    const { actor } = await someone(WHO[1]);
    setTools("off");
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD })));
    const id = (start.json as { visit: { id: string } }).visit.id;
    try {
      const replay = await answerOf(await replayPost(request(actor, "POST", `/api/visits/${id}/replay`, { body: { source: "live", speed: 0.25 }, switches: true }), params(id)));
      // refused as a stand-in that may not exist (503 not_configured), or as a visit with no replay (409 no_replay)
      expect([
        [503, "not_configured"],
        [409, "no_replay"],
      ]).toContainEqual([replay.status, (replay.json as { error?: string }).error]);
      expect(visitLive(actor.scope.id, id).stream).toBeNull();
    } finally {
      clearVisitLive(actor.scope.id, id);
    }
  });

  it("a body field that names a fixture is refused whole (400 invalid_body) by the transcript's handlers; in POST /api/visits a recording ignores `fixture`", async () => {
    setTools("off");
    setSpeech("mock");
    const { actor } = await someone(WHO[0]);
    const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: { ...RECORD, fixture: "v1" } })));
    expect((start.json as { visit: VisitRow }).visit).toMatchObject({ id: "v1", status: "recording", audio_fixture: null });
    const p = params("v1");
    const answers: Record<string, Answer> = {};
    for (const extra of [{ fixture: "v1" }, { replay: "v1" }, { devfake_fixture: "v1" }, { audio_fixture: "visit_A.wav" }]) {
      const tag = Object.keys(extra)[0];
      answers[`token ${tag}`] = await answerOf(await tokenPost(request(actor, "POST", "/api/asr/realtime-token", { body: { visit_id: "v1", ...extra } })));
      answers[`replay ${tag}`] = await answerOf(await replayPost(request(actor, "POST", "/api/visits/v1/replay", { body: { source: "live", ...extra } }), p));
      answers[`jobs ${tag}`] = await answerOf(await jobsPost(request(actor, "POST", "/api/asr/jobs", { body: { visit_id: "v1", ...extra } })));
      answers[`finalize ${tag}`] = await answerOf(await finalizePost(request(actor, "POST", "/api/visits/v1/finalize", { body: { job_id: "mockjob-none", ...extra } }), p));
    }
    expect(Object.keys(answers)).toHaveLength(16);
    for (const [name, a] of Object.entries(answers)) expect([a.status, (a.json as { error: string }).error], name).toEqual([400, "invalid_body"]);
    expect(await store.getVisit(actor.scope.id, "v1")).toMatchObject({ status: "recording", audio_fixture: null });
    expect(await store.listUtterances(actor.scope.id, "v1")).toEqual([]);
  });
});

// ---------------------------------------------------------------- the replay route, and replay as a way to start

describe("a replay on an account: only a row whose own audio_fixture names one", () => {
  it("POST /api/visits/[id]/replay: 404 for a visit he does not have, 409 no_replay for his own recording whatever it is called", async () => {
    setTools("off");
    setSpeech("mock");
    const { actor } = await account("blank");
    const scope = actor.scope;
    for (const id of REPLAY_VISITS) {
      const none = await answerOf(await replayPost(request(actor, "POST", `/api/visits/${id}/replay`, { body: {} }), params(id)));
      expect([none.status, none.json], id).toEqual([404, { error: "visit_not_found" }]);
    }
    for (const id of REPLAY_VISITS) await store.upsertVisit(scope.id, { id, kind: id === "p1" ? "pharmacy" : "clinic", place: "Clinic", day: scope.story_day, status: "recording" });
    for (const id of REPLAY_VISITS) {
      for (const body of [{}, { source: "live" }, { source: "replay", speed: 20 }]) {
        const own = await answerOf(await replayPost(request(actor, "POST", `/api/visits/${id}/replay`, { body, switches: true }), params(id)));
        expect([own.status, own.json], id).toEqual([409, { error: "no_replay", detail: `no replay file for visit ${id}` }]);
        expect(visitLive(scope.id, id).stream, id).toBeNull();
      }
      expect(await store.listUtterances(scope.id, id), id).toEqual([]);
    }
  });

  it("the whole-visit job of a demo session's v1 is not his: finalize and the job's status answer 404 job_not_found for his own v1", async () => {
    setTools("off");
    setSpeech("mock");
    // a demo session ends its replay of v1 (on v1's own story day, so the replay is written into v1 itself): a finished
    // job for a visit called v1 whose transcript is the replay file
    const demo: Actor = { scope: await store.createSession({ story_day: 0, ttl_hours: 1 }), token: null };
    const replayed = await answerOf(await visitsPost(request(demo, "POST", "/api/visits", { body: { mode: "replay", fixture: "v1" } })));
    expect((replayed.json as { visit: VisitRow }).visit).toMatchObject({ id: "v1", status: "recording" });
    const job = await answerOf(await jobsPost(request(demo, "POST", "/api/asr/jobs", { body: { visit_id: "v1" } })));
    const jobId = (job.json as { job_id: string }).job_id;
    const done = await settle(demo, jobId, "v1", false);
    expect(textHits(done.json)).toEqual(ids("v1"));

    const { actor } = await someone(WHO[0]);
    await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD }));
    const mine = {
      finalize: await answerOf(await finalizePost(request(actor, "POST", "/api/visits/v1/finalize", { body: { job_id: jobId } }), params("v1"))),
      status: await answerOf(await jobGet(request(actor, "GET", `/api/asr/jobs/${jobId}`, { query: { visit_id: "v1" } }), params(jobId))),
    };
    expect([mine.finalize.status, mine.finalize.json]).toEqual([404, { error: "job_not_found" }]);
    expect([mine.status.status, mine.status.json]).toEqual([404, { error: "job_not_found" }]);
    expect(scan(mine)).toEqual([]);
    expect(await store.listUtterances(actor.scope.id, "v1")).toEqual([]);
    expect((await store.getVisit(actor.scope.id, "v1"))?.status).toBe("recording");
  });

  // Shows: POST /api/visits { mode: "replay", fixture: "v1" } finds the visit by the fixture's name (lib/visit/pipeline.ts
  // startVisit), not by the row's audio_fixture: on an account whose own visit is called v1 it answers 200 and puts his
  // waiting recording back to "recording" with audio_path erased (no line of the story reaches it: the replay route refuses).
  it("POST /api/visits { mode: replay, fixture: v1 } does not take his own visit called v1: refused, and the waiting recording is left as it was", async () => {
    const crewKey = setTools("off");
    setSpeech("mock");
    const { actor } = await someone(WHO[0]);
    const w = await walk(actor, { start: RECORD, switches: false, crewKey });
    const before = (await store.getVisit(actor.scope.id, "v1"))!;
    expect(before).toMatchObject({ status: "awaiting_transcript", audio_path: `${blobPrefix(actor.scope)}/visits/v1/recording-test.wav` });
    expect(w.visitId).toBe("v1");
    const res = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: { mode: "replay", fixture: "v1" } })));
    // refused as a visit with no replay (409 no_replay), or as no sample visit of that name (404 visit_not_found)
    expect([
      [409, "no_replay"],
      [404, "visit_not_found"],
    ]).toContainEqual([res.status, (res.json as { error?: string }).error]);
    expect(await store.getVisit(actor.scope.id, "v1")).toEqual(before);
  });
});

// ---------------------------------------------------------------- the clips

/** GET /api/visits/[id]/clip for the lines a stand-in clip exists for, and for the same line numbers under his visit's id. */
async function clipAnswers(actor: Actor, visitId: string, switches: boolean): Promise<Record<string, Answer>> {
  const out: Record<string, Answer> = {};
  const lines = [...CLIPS.map(([f]) => f.replace(".wav", "")), `${visitId}-u08`, `${visitId}-u09`];
  for (const u of [...new Set(lines)]) out[u] = await answerOf(await clipGet(request(actor, "GET", `/api/visits/${visitId}/clip`, { query: { u }, switches }), params(visitId)));
  return out;
}

/** `asked`: how many different lines were asked for (the six stand-in lines, and two under his visit's id when they differ). */
function expectNoClip(answers: Record<string, Answer>, asked: number): void {
  expect(Object.keys(answers)).toHaveLength(asked);
  expect(scan(answers)).toEqual([]);
  for (const [u, a] of Object.entries(answers)) expect([u, a.status, a.json, a.standIn]).toEqual([u, 404, { error: "no_clip" }, null]);
}

describe("the stand-in clips belong to the demo and to the example's sample visits", () => {
  it.each<Tools>(["off", "on"])("developer tools %s: his own visit with a uuid, on a blank and on an example account, serves no stand-in clip", async (tools) => {
    setTools(tools);
    setSpeech("mock");
    for (const who of [WHO[1], WHO[2]] as const) {
      const { actor } = await someone(who);
      const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD })));
      const id = (start.json as { visit: { id: string } }).visit.id;
      expect(id).toMatch(UUID);
      for (const switches of [false, true]) expectNoClip(await clipAnswers(actor, id, switches), 8);
    }
  });

  // Shows: GET /api/visits/[id]/clip looks the clip up by the line's id when the visit has no such line
  // (app/api/visits/[id]/clip/route.ts: `!row && u.startsWith(visitId-)`): on an account whose own visit is called v1,
  // ?u=v1-u08 and ?u=v1-u09 play the story's stand-in doctor (200, audio/wav) although the visit has no line at all.
  it("his own visit called v1 serves no stand-in clip either (developer tools off and on)", async () => {
    for (const tools of ["off", "on"] as const) {
      setTools(tools);
      setSpeech("mock");
      const { actor } = await someone(WHO[0]);
      const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD })));
      expect((start.json as { visit: VisitRow }).visit).toMatchObject({ id: "v1", audio_fixture: null });
      expect(await store.listUtterances(actor.scope.id, "v1")).toEqual([]);
      for (const switches of [false, true]) expectNoClip(await clipAnswers(actor, "v1", switches), 6);
    }
  });

  it("the control: the example account's past sample visit v1 does serve its stand-in clip, to him and (once he shares it) to her", async () => {
    setTools("off");
    setSpeech("mock");
    const { a: dad, actor } = await account("example");
    const clip = await answerOf(await clipGet(request(actor, "GET", "/api/visits/v1/clip", { query: { u: "v1-u08" } }), params("v1")));
    expect([clip.status, clip.standIn]).toEqual([200, "1"]);
    expect(scan({ clip })).toEqual(["clip: clip v1-u08.wav"]);
    const her = await linked(dad);
    const hers = await answerOf(await familyClipGet(request(her.actor, "GET", "/api/family/clip", { query: { link: her.linkId, visit: "v1", u: "v1-u08" } })));
    expect([hers.status, hers.standIn]).toEqual([200, "1"]);
    expect(scan({ hers })).toEqual(["hers: clip v1-u08.wav"]);
  });

  it("her clip route on a blank account whose visit is called v1: 404 no_clip for every stand-in line", async () => {
    setTools("off");
    setSpeech("mock");
    const { a: dad, actor } = await someone(WHO[0]);
    await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD }));
    const her = await linked(dad);
    const answers: Record<string, Answer> = {};
    for (const [file] of CLIPS) {
      const u = file.replace(".wav", "");
      answers[u] = await answerOf(await familyClipGet(request(her.actor, "GET", "/api/family/clip", { query: { link: her.linkId, visit: "v1", u }, switches: true })));
    }
    expect(Object.keys(answers)).toHaveLength(6);
    for (const [u, a] of Object.entries(answers)) expect([u, a.status, a.json]).toEqual([u, 404, { error: "no_clip" }]);
    expect(scan(answers)).toEqual([]);
  });
});

/** His daughter's account with an active care link to him that shares his visit records. */
async function linked(dad: TestAccount): Promise<{ actor: Actor; linkId: string }> {
  const her = await createAccountWithSpace(store, getAuthProvider(), { login: `h6w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const hash = `h-${randomUUID()}`;
  const inv = await store.createInvite({ patient_id: dad.userId, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { visit_transcripts: true });
  if (!inv.ok) throw new Error("the invitation was not made");
  await store.acceptInvite(hash, her.userId, "Wei Ling");
  await store.confirmLink(inv.link.id, dad.userId, true);
  // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
  await agreedLink(store, { id: inv.link.id, patient_id: dad.userId, family_id: her.userId });
  return { actor: { scope: (await store.getSession(dad.userId))!, token: her.tokens.access_token }, linkId: inv.link.id };
}

// ---------------------------------------------------------------- the lookups by a visit's id that remain

const R1 = lineOf("v1-u08");
const MISHEARD = "zzz qqq xxx www";
const line = (id: string, text: string, role: "doctor" | "patient", t: number): NewUtterance => ({
  id,
  t_start_ms: t,
  t_end_ms: t + 2000,
  speaker_cluster: null,
  lang: "en",
  text,
  role,
  role_state: "confirmed",
  clip_path: null,
  scripted_fallback: false,
});

describe("where the code still looks a fixture up by a visit's id, on an account whose visit is called v1", () => {
  it("the review page (app/p/visit/[id]/review/page.tsx): an account is answered before the page's lookup, and its data has nothing of the story", async () => {
    const crewKey = setTools("off");
    setSpeech("mock");
    // the page hands an account to AccountReviewPage before it reads the replay file by the visit's id
    const src = readFileSync(path.join(WEB, "app", "p", "visit", "[id]", "review", "page.tsx"), "utf8");
    const accountReturn = src.indexOf('if (ctx.subject.kind === "account") return <AccountReviewPage');
    const lookup = src.indexOf("fixtureUtterances(visitId)");
    expect(accountReturn).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(accountReturn);
    expect(src.match(/fixtureUtterances\(/g)).toHaveLength(1);
    expect(src.indexOf("fixtureClipPath(")).toBeGreaterThan(accountReturn);

    const { a, actor } = await someone(WHO[0]);
    const w = await walk(actor, { start: RECORD, switches: true, crewKey });
    expect(w.visitId).toBe("v1");
    const scope = (await store.getSession(a.userId))!;
    const el = await AccountReviewPage({ ctx: pageSubjectFor(selfSubject(store, scope, a.userId)), locale: "zh-Hans", visitId: "v1" });
    const children = (el.props as { children: { props: Record<string, unknown> }[] }).children;
    const review = children.find((c) => "view" in c.props)!;
    const view = review.props.view as VisitView;
    expect(view).toMatchObject({ visit: { id: "v1", status: "awaiting_transcript" }, lines: [], cards: [], qlist: null, replayable: null, account: { sample: false, transcript: "waiting" } });
    expect(review.props.recordingUrl).toBe("/api/me/export/recording?visit=v1");
    expect(hits(review.props)).toEqual([]);
  });

  it("the check card's target time (lib/visit/view.ts, the R1 line looked up in the replay file of the visit that said it): never on an account's screen; the demo's has it", async () => {
    setTools("on");
    setSpeech("mock");
    // the demo: day 8, v1 never replayed in this session, v2 replayed up to "Around 130": the card's target carries the
    // time of v1-u08 in the replay file
    const demo = await store.createSession({ story_day: 8, ttl_hours: 1 });
    await startVisit(store, demo, { mode: "replay", fixture: "v2" });
    const demoView = (await processChunk(store, demo, "v2", fixtureUtterances("v2")!.slice(0, 2))).view;
    const demoCard = demoView.cards.find((c) => c.kind === "chk" && c.check === "bp") as { target?: { tStartMs: number | null } } | undefined;
    expect(demoCard?.target?.tStartMs).toBe(R1.t_start_ms);
    clearVisitLive(demo.id, "v2");

    // an account: an earlier visit called v1 that keeps the same sentence as its R1 row and has no line for it, then a
    // visit where the doctor asks about his readings (his own words, confirmed)
    const { actor } = await account("blank");
    const scope = actor.scope;
    await store.upsertVisit(scope.id, { id: "v1", kind: "clinic", place: "Clinic", day: scope.story_day - 7, status: "confirmed" });
    await store.addVisitItems(scope.id, "v1", [{ id: "item-R1", type: "target", text: R1.text, required_line: "R1", slots: { systolic: 135, diastolic: 85 }, speaker: "doctor", confirmed_by: "patient" }]);
    for (const d of [3, 2, 1]) await store.addBp(scope.id, { day: scope.story_day - d, slot: "morning", systolic: 142, diastolic: 88 });
    const today = await store.upsertVisit(scope.id, { id: randomUUID(), kind: "clinic", place: "Clinic", day: scope.story_day, status: "review" });
    await store.addUtterances(scope.id, today.id, [line(`${today.id}-w1`, "How were the blood pressure readings at home this month?", "doctor", 1000), line(`${today.id}-w2`, "Around 140, I think.", "patient", 4000)]);
    // the lookup's own conditions hold: an R1 row on a visit called v1, earlier than this one
    expect((await store.listVisitItems(scope.id, { required_only: true })).map((i) => [i.visit_id, i.required_line])).toEqual([["v1", "R1"]]);
    const view = (await buildVisitView(store, scope.id, today.id, { session: scope }))!;
    expect(view.lines).toHaveLength(2);
    // his readings card is there, against his own sentence, with no time taken from the replay file
    const card = view.cards.find((c) => c.kind === "chk" && c.check === "bp") as { recorded: number; target?: Record<string, unknown> } | undefined;
    expect(card).toMatchObject({ recorded: 3, target: { systolic: 135, diastolic: 85, quote: R1.text, visitId: "v1", tStartMs: null } });
    const times: number[] = [];
    JSON.stringify(view, (k, v: unknown) => {
      if (k === "tStartMs" && typeof v === "number") times.push(v);
      return v;
    });
    expect(times).toEqual([1000, 4000]);
    // the sentence is his own row's (planted above); no other line of the story, and no line id, is on the screen
    expect(hits(view)).toEqual(["text:v1-u08"]);
  });

  it("the script (lib/visit/fallback.ts scriptFor): a misheard sentence on his visit called v1 stays as heard, even with the switch forced on; a demo filming session's is replaced", async () => {
    setTools("on");
    setSpeech("mock");
    const heard = { t_start_ms: 1500, t_end_ms: 4000, speaker_cluster: null, lang: "en", text: MISHEARD };
    const { actor } = await someone(WHO[0]);
    const scope = actor.scope;
    await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD }));
    // no request can do this on an account (the scripted route and the fallback flag are 404, setScriptedFallback
    // throws): the visit's switch set in memory by hand. Since the crew's one gate nothing else stands between a scope
    // and its script than being a filming scope
    visitLive(scope.id, "v1").fallbackOn = true;
    expect([filmingSession(scope), fallbackAllowed(scope)]).toEqual([false, false]);
    try {
      const live = await processChunk(store, scope, "v1", [{ id: "v1-w1", ...heard }]);
      expect(live.utterances.map((u) => [u.id, u.text, u.scripted_fallback, u.clip_path])).toEqual([["v1-w1", MISHEARD, false, null]]);
      await expect(processChunk(store, scope, "v1", [{ id: "v1-w2", ...heard, t_start_ms: 5000, t_end_ms: 7000 }], { fallback: true })).rejects.toMatchObject({ code: "fallback_filming_only" });
      await expect(setScriptedFallback(store, scope, "v1", true)).rejects.toMatchObject({ code: "fallback_filming_only" });
      const view = await finalizeVisit(store, scope, "v1", { status: "done", source: "audio", utterances: [{ tStartMs: 1500, tEndMs: 4000, speaker: null, text: MISHEARD }] }, { llm: null, aiAllowed: false });
      expect(view.lines.map((l) => [l.text, l.scriptedFallback])).toEqual([[MISHEARD, false]]);
      expect(hits(view)).toEqual([]);
      expect(hits(await store.listUtterances(scope.id, "v1"))).toEqual([]);
    } finally {
      visitLive(scope.id, "v1").fallbackOn = false;
    }

    // the control: the crew's filming session, the switch on for its v1
    const filming = await store.createSession({ kind: "filming", filming_mode: true, story_day: 0, story_time: "10:00" });
    const visit = await startVisit(store, filming, { mode: "record", consent: { given: true } });
    expect(visit.id).toBe("v1");
    expect([filmingSession(filming), fallbackAllowed(filming)]).toEqual([true, true]);
    await setScriptedFallback(store, filming, "v1", true);
    const out = await processChunk(store, filming, "v1", [heard]);
    expect(out.utterances.map((u) => [u.text, u.scripted_fallback])).toEqual([[FILES.v1[0].text, true]]);
    expect(textHits(out.utterances)).toEqual(["v1-u01"]);
    visitLive(filming.id, "v1").fallbackOn = false;
    clearVisitLive(filming.id, "v1");
  });

  // Shows: scriptFor answers by the visit's id for any scope: for an ordinary account's visit called v1 (v2, p1, v3) it
  // returns the story's script. Nothing reaches it today (both callers ask fallbackAllowed first, which an ordinary
  // account never passes: the test above), so this is the missing second fence, not a leak that happens.
  it("scriptFor has no script for an ordinary account's visit, whatever it is called", async () => {
    const { actor } = await account("blank");
    const example = (await account("example")).actor.scope;
    const got = REPLAY_VISITS.flatMap((id) => [scriptFor(actor.scope, { id, day: actor.scope.story_day }).length, scriptFor(example, { id, day: example.story_day }).length]);
    expect(got).toEqual(got.map(() => 0));
  });

  it("the stand-in clip of a line (lib/visit/pipeline.ts standInClip): his visit with a uuid never gets one, whatever the line says", async () => {
    setTools("on");
    setSpeech("mock");
    const { actor } = await account("blank");
    const scope = actor.scope;
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    // the pipeline reads a fixture line's id from the end of a line id ("<visit>-v1-u08", as a replay into a copy
    // sends it), so that is the id that would show a leak here; the plain "<visit>-u09" and a line with no id go with it
    const out = await processChunk(store, scope, visit.id, [
      { id: `${visit.id}-v1-u08`, t_start_ms: R1.t_start_ms, t_end_ms: R1.t_start_ms + 3000, speaker_cluster: null, lang: "en", text: R1.text },
      { id: `${visit.id}-u09`, t_start_ms: 60_000, t_end_ms: 63_000, speaker_cluster: null, lang: "en", text: lineOf("v1-u09").text },
      { t_start_ms: 70_000, t_end_ms: 73_000, speaker_cluster: null, lang: "en", text: lineOf("v2-u06").text },
    ]);
    expect(out.utterances.map((u) => [u.id.slice(visit.id.length), u.clip_path])).toEqual([
      ["-v1-u08", null],
      ["-u09", null],
      ["-u01", null],
    ]);
    const view = await finalizeVisit(store, scope, visit.id, { status: "done", source: "audio", utterances: [{ tStartMs: R1.t_start_ms, tEndMs: R1.t_start_ms + 3000, speaker: null, text: R1.text }] }, { llm: null, aiAllowed: false });
    expect(view.lines.map((l) => [l.id.slice(visit.id.length), l.clip])).toEqual([["-v1-u08", null]]);
    expect((await store.listUtterances(scope.id, visit.id)).map((u) => u.clip_path)).toEqual([null, null, null]);
    const clip = await answerOf(await clipGet(request(actor, "GET", `/api/visits/${visit.id}/clip`, { query: { u: `${visit.id}-v1-u08` } }), params(visit.id)));
    expect([clip.status, clip.json]).toEqual([404, { error: "no_clip" }]);

    // the control: the same line on a demo session's own recording (a day with no story visit) does get the stand-in clip
    const demo = await store.createSession({ story_day: 5, ttl_hours: 1 });
    const rec = await startVisit(store, demo, { mode: "record", consent: { given: true } });
    expect(rec.id).toMatch(/^visit-[0-9a-f]{8}$/);
    const demoOut = await processChunk(store, demo, rec.id, [{ id: `${rec.id}-v1-u08`, t_start_ms: R1.t_start_ms, t_end_ms: R1.t_start_ms + 3000, speaker_cluster: null, lang: "en", text: R1.text }]);
    expect(demoOut.utterances.map((u) => u.clip_path)).toEqual(["visits/clips/v1-u08.wav"]);
  });

  // Shows: standInClip takes the fixture from the line's id alone: on an account whose own visit is called v1, a line
  // v1-u08 whose words are the story's (his doctor said the same sentence) is given the story's stand-in clip, and
  // "play this sentence" then plays the stand-in doctor instead of his recording.
  it("the stand-in clip of a line: his visit called v1 gets none either, when a line's id and words are the story's", async () => {
    setTools("on");
    setSpeech("mock");
    const { actor } = await someone(WHO[0]);
    await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD }));
    const out = await processChunk(store, actor.scope, "v1", [{ id: "v1-u08", t_start_ms: R1.t_start_ms, t_end_ms: R1.t_start_ms + 3000, speaker_cluster: null, lang: "en", text: R1.text }]);
    expect(out.utterances.map((u) => [u.id, u.clip_path])).toEqual([["v1-u08", null]]);
    const clip = await answerOf(await clipGet(request(actor, "GET", "/api/visits/v1/clip", { query: { u: "v1-u08" } }), params("v1")));
    expect([clip.status, clip.json]).toEqual([404, { error: "no_clip" }]);
  });

  // This failed when it was written and was fixed with it: finalizeVisit took the stand-in clip from the line's id alone
  // when it had no recording to cut from (lib/visit/pipeline.ts, the branch that calls standInClip, also for a job whose
  // source is "audio"), so on an account whose own visit is called v1 the line v1-u08 with the story's words was stored
  // with visits/clips/v1-u08.wav and GET /api/visits/v1/clip?u=v1-u08 played the story's stand-in doctor.
  it("the stand-in clip of a line, in the whole-visit record: his visit called v1 gets none when the transcript came from his recording (source audio) and no recording is there to cut from", async () => {
    setTools("on");
    setSpeech("mock");
    const { actor } = await someone(WHO[0]);
    const scope = actor.scope;
    await visitsPost(request(actor, "POST", "/api/visits", { body: RECORD }));
    await processChunk(store, scope, "v1", [{ id: "v1-u08", t_start_ms: R1.t_start_ms, t_end_ms: R1.t_start_ms + 3000, speaker_cluster: null, lang: "en", text: R1.text }]);
    // the service's transcript of his recording (no ids of its own: the line takes the live line's id); no recording
    // is saved on the visit, so no clip can be cut from it
    expect((await store.getVisit(scope.id, "v1"))?.audio_path).toBeNull();
    const view = await finalizeVisit(store, scope, "v1", { status: "done", source: "audio", utterances: [{ tStartMs: R1.t_start_ms, tEndMs: R1.t_start_ms + 3000, speaker: null, text: R1.text }] }, { llm: null, aiAllowed: false });
    expect(view.lines.map((l) => [l.id, l.clip])).toEqual([["v1-u08", null]]);
    expect((await store.listUtterances(scope.id, "v1")).map((u) => [u.id, u.clip_path])).toEqual([["v1-u08", null]]);
    const clip = await answerOf(await clipGet(request(actor, "GET", "/api/visits/v1/clip", { query: { u: "v1-u08" } }), params("v1")));
    expect([clip.status, clip.json]).toEqual([404, { error: "no_clip" }]);
    expect(scan({ clip })).toEqual([]);
  });

  describe("the medicine card's answer choices (lib/meds/answers.ts: the replay file stands in for a visit with no stored transcript)", () => {
    /** A box nobody can identify, photographed and confirmed on his account: one open question for the pharmacist. */
    async function unknownBox(actor: Actor): Promise<string> {
      const blob = createLocalBlobStore({ dir: blobDir });
      const deps: MedsDeps = { store, blob, vision: { env: { LLM_PROVIDER: "mock" } }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } };
      const photo = `${blobPrefix(actor.scope)}/labels/relative_box-${randomUUID().slice(0, 8)}.png`;
      await blob.putObject("labels", photo, labelPng("relative_box"), "image/png");
      const read = await readLabel({ sessionId: actor.scope.id, path: photo }, deps);
      const made = await confirmLabel({ sessionId: actor.scope.id, readToken: read.read_token, confirmed: ["drug_text"], origin: "relative", locale: "zh-Hans" }, deps);
      expect(made.outcome).toBe("unidentified");
      expect((await store.listQuestions(actor.scope.id)).map((q) => [q.for, q.origin, q.status])).toEqual([["pharmacist", "unidentified_medicine", "open"]]);
      return made.med.id;
    }
    type Card = { card: { question: { status: string; answerChoices: { visitId: string; utteranceId: string; text: string }[] } | null } };

    it("his pharmacy visit with a uuid, waiting for its transcript: the card offers no line", async () => {
      setTools("off");
      setSpeech("mock");
      const { actor } = await account("blank");
      const medId = await unknownBox(actor);
      const start = await answerOf(await visitsPost(request(actor, "POST", "/api/visits", { body: { ...RECORD, place: "pharmacy" } })));
      const visitId = (start.json as { visit: VisitRow }).visit.id;
      await jobsPost(request(actor, "POST", "/api/asr/jobs", { body: { visit_id: visitId } }));
      expect(await store.getVisit(actor.scope.id, visitId)).toMatchObject({ kind: "pharmacy", status: "awaiting_transcript" });
      const card = await answerOf(await medGet(request(actor, "GET", `/api/meds/${medId}`), params(medId)));
      expect(card.status).toBe(200);
      expect((card.json as Card).card.question).toMatchObject({ status: "open", answerChoices: [] });
      expect(scan({ card })).toEqual([]);
    });

    // Shows: under SPEECH_PROVIDER=mock (a server with no transcription service, where an account's visit waits for its
    // text) the medicine card takes the replay file by the visit's id: on an account whose own pharmacy visit is called
    // p1, GET /api/meds/[id] offers the story's three pharmacy lines as "which sentence answered it", and
    // POST /api/meds/[id]/answer stores the story's pharmacist's sentence as his pharmacist's answer.
    it("his pharmacy visit called p1, waiting for its transcript: the card offers no line, and none can be linked", async () => {
      setTools("off");
      setSpeech("mock");
      const { actor } = await account("blank");
      const scope = actor.scope;
      const medId = await unknownBox(actor);
      await store.upsertVisit(scope.id, { id: "p1", kind: "pharmacy", place: "Pharmacy", day: scope.story_day, status: "awaiting_transcript" });
      expect(await store.listUtterances(scope.id, "p1")).toEqual([]);
      const card = await answerOf(await medGet(request(actor, "GET", `/api/meds/${medId}`), params(medId)));
      const link = await answerOf(await answerPost(request(actor, "POST", `/api/meds/${medId}/answer`, { body: { visit_id: "p1", utterance_id: "p1-u03", speaker: "pharmacist" } }), params(medId)));
      const question = (await store.listQuestions(scope.id))[0];
      expect([card.status, (card.json as Card).card.question?.answerChoices]).toEqual([200, []]);
      expect([link.status, (link.json as { error?: string }).error]).toEqual([404, "utterance_not_found"]);
      expect(scan({ card })).toEqual([]);
      // the refusal names the line the request itself asked for, and nothing else of the story
      expect(scan({ link }).filter((hit) => hit !== "link: id:p1-u03")).toEqual([]);
      expect([question.status, question.answer_text, question.answer_visit_id]).toEqual(["open", null, null]);
      expect(hits(await store.listMeds(scope.id))).toEqual([]);
    });
  });
});
