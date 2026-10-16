/**
 * M6 privacy, the routes' own checks (wave B: the second layer under web/proxy.ts, so a matcher change cannot reopen
 * them). Each is called directly here, without the proxy:
 *   GET /api/notes, GET /api/bp    his notes and readings: Wei Ling's phone 403 patient_only (member row, and her
 *                                  member row with a forged rp_role=patient); once she has joined, a device with no
 *                                  row (her phone with its cookies dropped, rp_role alone) 403 member_required; his
 *                                  phone and a judge's sandbox still read them, and so does a call with no role in a
 *                                  session nobody joined as family.
 *   POST /api/ask                  writes in his name: her phone 403 before the body is read; nothing is added.
 *   POST /api/clock                her phone 403 before the body; the director, backstage, a judge and his phone move it.
 *   POST /api/reminders            only her side records (his phone, backstage, director 403 family_only before the
 *                                  body); the file must be there (404), WAV (415) and hold sound (422); storage that
 *                                  is not there is 503 storage_unavailable; nothing is registered on any refusal.
 *   GET /api/events                her stream is filtered in both bus modes (memory, and the STORE=supabase tail) and
 *                                  a dropped event sends nothing (not even its id); his is not filtered; when her
 *                                  member row cannot be read the answer is an empty stream with `retry`, never an
 *                                  unfiltered one; a stranger and her phone naming another session get 403, no stream.
 *   app/p/layout.tsx               her phone is redirected to /f, a stranger to /join, before the layout reads anything
 *                                  of his.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { GET as bpGet } from "@/app/api/bp/route";
import { POST as clockPost } from "@/app/api/clock/route";
import { GET as eventsGet } from "@/app/api/events/route";
import { GET as notesGet, POST as notesPost } from "@/app/api/notes/route";
import { GET as remindersAudioGet } from "@/app/api/reminders/[id]/audio/route";
import { GET as remindersGet, POST as remindersPost } from "@/app/api/reminders/route";
import { POST as grantsPost } from "@/app/api/family/grants/route";
import { getLocalBlobStore } from "@/lib/blob";
import { Bus, getBus, type BusEvent, type BusLog } from "@/lib/bus";
import { WAV_HEADER_BYTES } from "@/lib/family/reminders";
import { CREW_COOKIE, crewCookieValue } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const pageSession = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/session/server", () => ({
  getPatientLocale: async () => "zh-Hans",
}));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  getPageSubject: async () => pageSession.ctx,
}));
import { demoSubject, pageSubjectFor } from "@/lib/subject";
// imported after the mock is registered (vi.mock is hoisted above every import)
import PatientLayout from "@/app/p/layout";

const savedEnv = { ...process.env };
let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-wave-b-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const R1 = "At home, we want it below 135 over 85.";

function req(method: "GET" | "POST", p: string, sessionId: string, body?: unknown, cookie?: string, signal?: AbortSignal): NextRequest {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${p}?session=${encodeURIComponent(sessionId)}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

async function d41(): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}
async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}
/**
 * her phone four ways, with the error each gets: her member row and her member row with a forged rp_role=patient
 * (patient_only); rp_role=family alone and no cookies at all (her phone in a private window), which in a session she
 * has joined are strangers (member_required)
 */
async function herWays(s: SessionRow): Promise<[string | undefined, string][]> {
  const her = await device(s, "family");
  return [
    [her, "patient_only"],
    [her.replace("rp_role=family", "rp_role=patient"), "patient_only"],
    [`rp_session=${s.id}; rp_role=family`, "member_required"],
    [undefined, "member_required"],
  ];
}

function wav(samples: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + samples * 2);
  const dv = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  dv.setUint32(4, 36 + samples * 2, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  dv.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) dv.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(8000 * Math.sin(i / 8)), true);
  return bytes;
}

// ------------------------------------------------------------------ his reads

describe("GET /api/notes and GET /api/bp are his only", () => {
  it("her phone gets 403 with none of his words or numbers (also with its cookies dropped); his phone and a judge read them", async () => {
    const s = await d41();
    for (const [cookie, code] of await herWays(s)) {
      for (const [name, get] of [
        ["notes", () => notesGet(req("GET", "/api/notes", s.id, undefined, cookie))],
        ["bp", () => bpGet(req("GET", "/api/bp", s.id, undefined, cookie))],
      ] as const) {
        const res = await get();
        expect(res.status, `${name} ${cookie}`).toBe(403);
        const body = await res.text();
        expect(JSON.parse(body).error, `${name} ${cookie}`).toBe(code);
        for (const x of [NOTE_D37, R1, "150", "systolic"]) expect(body, `${name}: ${x}`).not.toContain(x);
      }
    }
    // a call with no role still reads in a session nobody joined as family (the tests' and scripts' way)
    const plain = await d41();
    expect((await notesGet(req("GET", "/api/notes", plain.id))).status).toBe(200);
    for (const cookie of [await device(s, "patient"), await device(s, "judge")]) {
      const notes = await notesGet(req("GET", "/api/notes", s.id, undefined, cookie));
      expect(notes.status, String(cookie)).toBe(200);
      expect(await notes.text()).toContain(NOTE_D37);
      const bp = await bpGet(req("GET", "/api/bp", s.id, undefined, cookie));
      expect(bp.status, String(cookie)).toBe(200);
      expect(await bp.text()).toContain(R1);
    }
  });
});

// ------------------------------------------------------------------ acting in his name

describe("POST /api/ask: her phone cannot ask in his name", () => {
  it("403 patient_only before the body is read; no note, no question, no event", async () => {
    const s = await d41();
    const store = getMemoryStore();
    const before = { notes: (await store.listNotes(s.id)).length, questions: (await store.listQuestions(s.id)).length };
    const seen: BusEvent[] = [];
    const off = getBus().subscribe(s.id, (e) => seen.push(e));
    try {
      for (const [cookie, code] of await herWays(s)) {
        for (const body of [{ text: "我今天头有点晕。", locale: "zh-Hans" }, { text: "我可以多吃一粒降压药吗？", role: "patient" }, "not json", {}]) {
          const res = await askPost(req("POST", "/api/ask", s.id, body, cookie));
          expect(res.status, `${JSON.stringify(body)} ${cookie}`).toBe(403);
          expect((await res.json()).error, String(cookie)).toBe(code);
        }
      }
    } finally {
      off();
    }
    expect({ notes: (await store.listNotes(s.id)).length, questions: (await store.listQuestions(s.id)).length }).toEqual(before);
    expect(seen).toEqual([]);
    // his phone still asks (a log_only sentence becomes his note)
    const his = await askPost(req("POST", "/api/ask", s.id, { text: "我今天头有点晕。", locale: "zh-Hans" }, await device(s, "patient")));
    expect(his.status).toBe(200);
    expect((await store.listNotes(s.id)).length).toBe(before.notes + 1);
  });
});

describe("POST /api/clock: her phone cannot move the story clock", () => {
  // the story clock is the film crew's (lib/crew/gate.ts): without the crew's cookie every caller gets 404 first; with it,
  // her phone is still refused (the crew's own phones join as family too)
  const crew = (cookie: string | undefined) => [cookie, `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`].filter(Boolean).join("; ");
  it("403 before the body; the day does not move; director, backstage, a judge and his phone keep the remote", async () => {
    const s = await d41();
    for (const [cookie, code] of await herWays(s)) {
      for (const body of [{ day: 0 }, { beat: "next" }, "nope"]) {
        const bare = await clockPost(req("POST", "/api/clock", s.id, body, cookie));
        expect(bare.status, `no crew: ${JSON.stringify(body)} ${cookie}`).toBe(404);
        const res = await clockPost(req("POST", "/api/clock", s.id, body, crew(cookie)));
        expect(res.status, `${JSON.stringify(body)} ${cookie}`).toBe(403);
        expect((await res.json()).error, String(cookie)).toBe(code);
      }
    }
    expect((await getMemoryStore().getSession(s.id))?.story_day).toBe(41);
    let day = 30;
    for (const role of ["director", "backstage", "judge", "patient"] as const) {
      const res = await clockPost(req("POST", "/api/clock", s.id, { day }, crew(await device(s, role))));
      expect(res.status, role).toBe(200);
      expect((await getMemoryStore().getSession(s.id))?.story_day, role).toBe(day);
      day += 1;
    }
  });
});

// ------------------------------------------------------------------ her reminder recording

describe("POST /api/reminders: who records, and that the file is a real recording", () => {
  async function clips(s: SessionRow): Promise<number> {
    return (await getMemoryStore().listReminderClips(s.id)).length;
  }
  async function upload(s: SessionRow, name: string, bytes = wav(1600)): Promise<string> {
    const p = `${s.id}/reminders/${name}.wav`;
    await getLocalBlobStore()!.putObject("audio", p, bytes, "audio/wav");
    return p;
  }
  /** bytes that are not a WAV, at a .wav path (the upload route would refuse them; storage can still hold them) */
  function plant(p: string, bytes: Uint8Array) {
    const file = path.join(blobDir, "audio", ...p.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }

  it("her phone: a path never uploaded 404, not WAV 415, header only 422, a real WAV 201 by wei-ling", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const before = await clips(s);
    const ghost = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: `${s.id}/reminders/never-uploaded.wav` }, her));
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error).toBe("audio_not_found");
    const png = `${s.id}/reminders/png.wav`;
    plant(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
    expect((await (await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: png }, her))).json()).error).toBe("not_wav");
    const empty = await upload(s, "empty", wav(0));
    const e = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: empty }, her));
    expect(e.status).toBe(422);
    expect((await e.json()).error).toBe("audio_empty");
    expect(await clips(s)).toBe(before);
    const ok = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: await upload(s, "hers"), text: "爸，记得吃药。" }, her));
    expect(ok.status).toBe(201);
    expect((await ok.json()).clip.by).toBe("wei-ling");
    expect(await clips(s)).toBe(before + 1);
  });

  it("his phone, backstage and the director: 403 family_only before the body, even with a real WAV; a judge and a no-role call record as wei-ling", async () => {
    const s = await d41();
    const p = await upload(s, "his");
    const before = await clips(s);
    for (const role of ["patient", "backstage", "director"] as const) {
      const cookie = await device(s, role);
      for (const body of [{ audio_path: p }, "nope"]) {
        const res = await remindersPost(req("POST", "/api/reminders", s.id, body, cookie));
        expect(res.status, role).toBe(403);
        expect((await res.json()).error, role).toBe("family_only");
      }
    }
    expect(await clips(s)).toBe(before);
    for (const cookie of [await device(s, "judge"), undefined]) {
      const res = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: await upload(s, `j${Math.random().toString(36).slice(2)}`) }, cookie));
      expect(res.status, String(cookie)).toBe(201);
      expect((await res.json()).clip.by).toBe("wei-ling");
    }
  });

  it("GET /api/reminders and the audio: her phone in her session reads them; a stranger and her phone elsewhere get 403", async () => {
    const s = await d41();
    const t = await d41();
    const her = await device(s, "family");
    const clipId = (await getMemoryStore().listReminderClips(s.id))[0].id;
    const audio = (cookie: string | undefined, sid = s.id) =>
      remindersAudioGet(req("GET", `/api/reminders/${clipId}/audio`, sid, undefined, cookie), { params: Promise.resolve({ id: clipId }) });
    expect((await remindersGet(req("GET", "/api/reminders", s.id, undefined, her))).status).toBe(200);
    expect((await audio(her)).status).toBe(200);
    for (const [cookie, sid, code] of [
      [undefined, s.id, "member_required"],
      [`rp_session=${s.id}; rp_role=patient`, s.id, "member_required"],
      [her, t.id, "patient_only"],
    ] as const) {
      const list = await remindersGet(req("GET", "/api/reminders", sid, undefined, cookie));
      expect(list.status, `${cookie} ${sid}`).toBe(403);
      expect((await list.json()).error).toBe(code);
      const a = await audio(cookie, sid);
      expect(a.status, `audio ${cookie} ${sid}`).toBe(403);
      expect((await a.json()).error).toBe(code);
    }
    // her phone cannot register a clip into another session, nor can a stranger into hers
    const p = await upload(t, "elsewhere");
    const before = await clips(t);
    const elsewhere = await remindersPost(req("POST", "/api/reminders", t.id, { audio_path: p }, her));
    expect(elsewhere.status).toBe(403);
    expect((await elsewhere.json()).error).toBe("patient_only");
    expect(await clips(t)).toBe(before);
    const stranger = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: await upload(s, "stranger") }));
    expect(stranger.status).toBe(403);
    expect((await stranger.json()).error).toBe("member_required");
  });

  it("storage that is not there: 503 storage_unavailable, nothing registered", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const before = await clips(s);
    const saved = { driver: process.env.BLOB_DRIVER, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.BLOB_DRIVER = "supabase";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      const res = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: `${s.id}/reminders/x.wav` }, her));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("storage_unavailable");
    } finally {
      if (saved.driver === undefined) delete process.env.BLOB_DRIVER;
      else process.env.BLOB_DRIVER = saved.driver;
      if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.SUPABASE_SERVICE_KEY = saved.key;
      warn.mockRestore();
    }
    expect(await clips(s)).toBe(before);
  });
});

// ------------------------------------------------------------------ the event stream

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decoder = new TextDecoder();

/** Everything a stream sends, collected in the background (no read is ever left dangling between checks). */
function collect(body: ReadableStream<Uint8Array>): { text(): string } {
  let text = "";
  const reader = body.getReader();
  void (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      text += decoder.decode(r.value, { stream: true });
    }
  })().catch(() => {});
  return { text: () => text };
}

/** He writes a note (notes off at D41) and asks; returns what each stream received. */
async function hisDayOnTheStreams(s: SessionRow, her: string, his: string, wait = 150): Promise<{ hers: string; mine: string }> {
  const a1 = new AbortController();
  const a2 = new AbortController();
  const herStream = collect((await eventsGet(req("GET", "/api/events", s.id, undefined, her, a1.signal))).body!);
  const hisStream = collect((await eventsGet(req("GET", "/api/events", s.id, undefined, his, a2.signal))).body!);
  await sleep(30);
  expect((await notesPost(req("POST", "/api/notes", s.id, { text: "今天脚踝更肿了，鞋子有点紧。" }, his))).status).toBe(201);
  expect((await askPost(req("POST", "/api/ask", s.id, { text: "我可以多吃一粒降压药吗？", locale: "zh-Hans" }, his))).status).toBe(200);
  await sleep(wait);
  a1.abort();
  a2.abort();
  return { hers: herStream.text(), mine: hisStream.text() };
}

describe("GET /api/events: her stream is filtered, his is not", () => {
  /** The SSE frames of a stream text: [id, has data]. */
  const sseFrames = (text: string) =>
    text
      .split("\n\n")
      .filter((f) => /^id: /m.test(f))
      .map((f) => ({ id: Number(/^id: (\d+)$/m.exec(f)?.[1]), data: /^data: /m.test(f), type: /"type":"([^"]+)"/.exec(f)?.[1] ?? null }));

  it("memory bus: his note, his question and the safety steps reach his stream; nothing of a dropped event reaches hers", async () => {
    const s = await d41();
    const { hers, mine } = await hisDayOnTheStreams(s, await device(s, "family"), await device(s, "patient"));
    expect(mine).toContain("今天脚踝更肿了");
    expect(mine).toContain("ask.received");
    for (const x of ["今天脚踝更肿了", "多吃一粒", "ask.received", "verify.layer", "note.logged"]) expect(hers, x).not.toContain(x);
    expect(hers).toContain(": connected");
    // not even a bare id line: her phone cannot tell when a hidden event happened
    expect(sseFrames(hers).filter((f) => !f.data)).toEqual([]);
    expect(sseFrames(mine).length).toBeGreaterThan(3);
  });

  it("STORE=supabase tail: the same filter; dropped events send nothing, and what follows still arrives once, in order", async () => {
    const log = new MemLog();
    const bus = new Bus({ log, pollMs: 20, lingerMs: 50 });
    const g = globalThis as { __rippleBus?: Bus };
    const before = g.__rippleBus;
    g.__rippleBus = bus;
    try {
      const s = await d41();
      const her = await device(s, "family");
      const his = await device(s, "patient");
      const a = new AbortController();
      const herStream = collect((await eventsGet(req("GET", "/api/events", s.id, undefined, her, a.signal))).body!);
      await sleep(60);
      const start = await log.head(s.id);
      expect((await notesPost(req("POST", "/api/notes", s.id, { text: "今天脚踝更肿了，鞋子有点紧。" }, his))).status).toBe(201);
      expect((await askPost(req("POST", "/api/ask", s.id, { text: "我可以多吃一粒降压药吗？", locale: "zh-Hans" }, his))).status).toBe(200);
      expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, his))).status).toBe(200);
      await sleep(600);
      a.abort();
      const hers = herStream.text();
      for (const x of ["今天脚踝更肿了", "多吃一粒", "ask.received", "verify.layer"]) expect(hers, x).not.toContain(x);
      const last = await log.head(s.id);
      expect(last - start).toBeGreaterThan(3);
      const frames = sseFrames(hers);
      // the first frame is the resume point (the head when she connected); after it only frames with data
      expect(frames[0]).toMatchObject({ id: start, data: false });
      expect(frames.slice(1).filter((f) => !f.data)).toEqual([]);
      // the switch he turned on after the dropped events reached her once, as the last event of the table
      const grants = frames.filter((f) => f.type === "family_grant.changed");
      expect(grants.map((f) => f.id)).toEqual([last]);
      const ids = frames.slice(1).map((f) => f.id);
      expect([...ids].sort((x, y) => x - y)).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      bus.close();
      g.__rippleBus = before;
    }
  });

  it("a stranger (her phone with its cookies dropped or forged) and her phone naming another session get 403, no stream", async () => {
    const s = await d41();
    const t = await d41();
    const her = await device(s, "family");
    for (const [cookie, sid, code] of [
      [undefined, s.id, "member_required"],
      [`rp_session=${s.id}; rp_role=patient`, s.id, "member_required"],
      [her, t.id, "patient_only"],
    ] as const) {
      const res = await eventsGet(req("GET", "/api/events", sid, undefined, cookie));
      expect(res.status, `${cookie} ${sid}`).toBe(403);
      expect(res.headers.get("content-type") ?? "").toContain("application/json");
      expect((await res.json()).error).toBe(code);
    }
    // her own session still streams
    const a = new AbortController();
    const ok = await eventsGet(req("GET", "/api/events", s.id, undefined, her, a.signal));
    expect(ok.status).toBe(200);
    a.abort();
  });

  it("when her member row cannot be read: an empty stream with retry, never an unfiltered one", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const store = getMemoryStore();
    vi.spyOn(store, "listMembers").mockRejectedValue(new Error("database unreachable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await eventsGet(req("GET", "/api/events", s.id, undefined, her));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("retry: 2000\n: role unavailable\n\n");
  });
});

class MemLog implements BusLog {
  private events = new Map<string, BusEvent[]>();
  async append(event: Omit<BusEvent, "id">): Promise<number> {
    const list = this.events.get(event.session_id) ?? [];
    const id = list.length + 1;
    list.push(structuredClone({ ...event, id }));
    this.events.set(event.session_id, list);
    return id;
  }
  async after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).filter((e) => e.id > afterId).slice(0, limit));
  }
  async latest(sessionId: string, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).slice(-limit));
  }
  async head(sessionId: string): Promise<number> {
    return (this.events.get(sessionId) ?? []).length;
  }
  async clear(): Promise<void> {}
}

// ------------------------------------------------------------------ his pages

describe("app/p/layout.tsx: the second layer under the proxy", () => {
  it("her phone is redirected to /f before the layout reads anything; his phone gets the frame", async () => {
    const s = await d41();
    const her = await getMemoryStore().addMember(s.id, { role: "family" });
    const store = getMemoryStore();
    const reads = vi.spyOn(store, "listDoses");
    pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), s), { role: "patient", memberId: her.id, since: 0 }); // forged role cookie
    let thrown: unknown = null;
    try {
      await PatientLayout({ children: null } as never);
    } catch (err) {
      thrown = err;
    }
    expect(String((thrown as { digest?: string } | null)?.digest ?? thrown)).toContain(";/f;");
    expect(reads).not.toHaveBeenCalled();
    // a device with no row in his session (her phone with forged cookies): /join, before anything is read
    pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), s), { role: "patient", memberId: null, since: 0 });
    thrown = null;
    try {
      await PatientLayout({ children: null } as never);
    } catch (err) {
      thrown = err;
    }
    expect(String((thrown as { digest?: string } | null)?.digest ?? thrown)).toContain(";/join;");
    expect(reads).not.toHaveBeenCalled();
    const his = await getMemoryStore().addMember(s.id, { role: "patient" });
    pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), s), { role: "patient", memberId: his.id, since: 0 });
    await expect(PatientLayout({ children: null } as never)).resolves.toBeTruthy();
    pageSession.ctx = null;
  });
});
