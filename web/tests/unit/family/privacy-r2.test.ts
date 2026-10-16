/**
 * M6 fixer round 2: the in-path half of the privacy and reminder defects the second verification found.
 *
 *   lib/family/events.ts     what Wei Ling's device may receive on GET /api/events: only her switches, the session
 *                            row, this morning's dose state while he shares it, and content-free "read again" hints
 *                            for sections he shares. Everything else (his notes, readings, asks, safety layers,
 *                            transcripts, cards, director cues, member ids, unknown types) is reduced to the SSE id
 *                            line. Checked with sentinel payloads on every bus type, and on the real events the routes
 *                            publish when he writes a note, records a reading, asks and ticks a dose.
 *   lib/family/reminders.ts  POST /api/reminders' checks: the uploaded clip exists, is WAV and holds sound (404 / 415
 *                            / 422, storage trouble 503 within the timeout); only Wei Ling's side records (403
 *                            family_only for his device, backstage and director).
 *   lib/family/recorder.ts   her recorder names those two refusals instead of "tap save again".
 *   lib/family/clips.ts      fallbackClip: the clip to try when hers does not play.
 *
 * The route wiring (app/api/events, app/api/reminders, components/daily) is outside this track's paths; see the
 * 2026-10-09 fixer round 2 section of web/PROGRESS.md.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as bpPost } from "@/app/api/bp/route";
import { POST as dosesPost } from "@/app/api/doses/route";
import { POST as grantsPost } from "@/app/api/family/grants/route";
import { POST as notesPost } from "@/app/api/notes/route";
import { createLocalBlobStore, type BlobObject } from "@/lib/blob";
import { EXTRA_EVENT_TYPES, getBus, SPEC_EVENT_TYPES, toSseFrame, type BusEvent } from "@/lib/bus";
import type { ReminderClipView } from "@/lib/daily/types";
import { fallbackClip, preferredClip } from "@/lib/family/clips";
import { createFamilyStream, FAMILY_SESSION_FIELDS, familyEvent, familySessionRow, familyStreamFor, HINT_WHEN, type FamilyEventKind, StreamDenied } from "@/lib/family/events";
import { ft } from "@/lib/family/i18n";
import { saveErrorFor, saveErrorKey } from "@/lib/family/recorder";
import { reminderAudioProblem, reminderAuthor, reminderAuthorFor, WAV_HEADER_BYTES } from "@/lib/family/reminders";
import { NO_GRANTS } from "@/lib/family/types";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems, MemberRole, SessionRow, Store } from "@/lib/store/types";

const ALL_ON: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const SECRET = "SENTINEL-他的原话-7731";

let blobDir: string;
const savedEnv = { ...process.env };
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-m6-r2-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ helpers

function ev(type: string, data: unknown, id = 7, sid = "s-1"): BusEvent {
  return { id, type: type as BusEvent["type"], session_id: sid, at: "2026-10-09T08:00:00.000Z", say: `say: ${SECRET}`, data };
}

/** A payload with the secret in every field a real event of any type could carry. */
function loaded(sid = "s-1"): Record<string, unknown> {
  return {
    text: SECRET,
    note: { id: "n1", text: SECRET, day: 41 },
    reading: { systolic: 151, diastolic: 97, text: SECRET },
    question: { id: "q1", text: SECRET },
    utterance: { id: "u1", text: SECRET },
    card: { id: "c1", quote: SECRET },
    member: { id: `member-${SECRET}`, role: "patient" },
    clip: { id: "clip-1", text: SECRET, audio_path: `${sid}/reminders/${SECRET}.wav` },
    doses: [{ medication_id: "med-amlodipine", name: SECRET }],
    beat: { id: "b", label: SECRET },
    session: { id: sid, join_code: "ABCDEF", story_day: 41, story_time: "08:45", filming_mode: false, template: "mr-tan", created_at: "x", expires_at: null },
    dose: { id: "d1", session_id: sid, medication_id: "med-amlodipine", day: 41, slot: "morning", state: "missed", reason: "tai_chi_morning", reason_text: SECRET, created_at: "x" },
    name: SECRET,
    by: "patient",
    grant: { session_id: sid, member: "wei-ling", items: { ...ALL_ON, extra: SECRET }, created_at: "x", updated_at: "y" },
    changed: { notes: true, extra: SECRET },
  };
}

/** Every bus type there is, with what Wei Ling's device gets when every switch is on. */
const KIND_ALL_ON: Record<string, FamilyEventKind> = {
  "asr.partial": "dropped",
  "asr.final": "dropped",
  "utterance.role": "dropped",
  "card.created": "dropped",
  "ask.received": "dropped",
  "ask.route": "dropped",
  "verify.layer1": "dropped",
  "verify.layer2": "dropped",
  "verify.layer3": "dropped",
  "ask.blocked": "dropped",
  "ask.answered": "dropped",
  "question.created": "hint",
  "dose.logged": "trimmed",
  "bp.logged": "hint",
  "clock.changed": "pass",
  "director.cue": "dropped",
  scripted_fallback: "dropped",
  "session.reset": "pass",
  "session.filming_mode": "pass",
  "session.member_joined": "dropped",
  "question.updated": "hint",
  "note.logged": "hint",
  "med.changed": "hint",
  "visit.changed": "hint",
  "family_grant.changed": "pass",
  "reminder.clip_added": "hint",
  "asr.fallback": "dropped",
  // the real app's types (C2 foundation F1): dropped for her until their track decides otherwise (FAMILY_DROPS)
  "care_link.invited": "dropped",
  "care_link.accepted": "dropped",
  "care_link.confirmed": "dropped",
  "care_link.declined": "dropped",
  "care_link.revoked": "dropped",
  "care_link.left": "dropped",
  "consent.recorded": "dropped",
  "push.subscribed": "dropped",
  "push.unsubscribed": "dropped",
  "push.sent": "dropped",
  "push.opened": "dropped",
  "profile.fact_added": "dropped",
  "profile.fact_confirmed": "dropped",
  "profile.fact_changed": "dropped",
  "prevent.done": "dropped",
  "prevent.changed": "dropped",
  "watch.synced": "dropped",
  "diet.checked": "dropped",
  "chat.message": "dropped",
  "visit.transcribed": "dropped",
  // Ripple's notes of his visit carry his visit's words: dropped as a type her stream does not know (fail closed)
  "visit.summary": "dropped",
  "account.created": "dropped",
  "account.changed": "dropped",
  "account.reseeded": "dropped",
  "job.ran": "dropped",
  "job.failed": "dropped",
  // owner 10-16 (lib/care/told.ts): a content-free hint on HER OWN link's stream only (tests/unit/care/told.test.ts); with
  // no link (the demo) it is dropped
  "family.told": "dropped",
};

function req(method: "GET" | "POST", p: string, sessionId: string, body?: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${p}?session=${encodeURIComponent(sessionId)}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

/** The data lines of an SSE chunk, parsed. */
function frames(chunk: string): { id: number; event: BusEvent | null }[] {
  return chunk
    .split("\n\n")
    .filter((f) => f.trim())
    .map((f) => {
      const id = Number(/^id: (\d+)$/m.exec(f)?.[1]);
      const data = /^data: (.*)$/m.exec(f)?.[1];
      return { id, event: data ? (JSON.parse(data) as BusEvent) : null };
    });
}

// ------------------------------------------------------------------ the stream filter

describe("familyEvent: what her device gets for each bus type", () => {
  it("classifies every bus type the app publishes (a new type must be added here on purpose)", () => {
    const all = [...SPEC_EVENT_TYPES, ...EXTRA_EVENT_TYPES].sort();
    expect(Object.keys(KIND_ALL_ON).sort()).toEqual(all);
    for (const t of all) expect(familyEvent(ev(t, loaded()), ALL_ON).kind, t).toBe(KIND_ALL_ON[t]);
  });

  it("never sends `say`, and none of his words, numbers or member ids, for any type, with every switch on or off", () => {
    for (const grants of [ALL_ON, NO_GRANTS]) {
      for (const t of Object.keys(KIND_ALL_ON)) {
        const r = familyEvent(ev(t, loaded()), grants);
        const out = r.event ? toSseFrame(r.event) : "";
        expect(out, `${t}`).not.toContain(SECRET);
        expect(out, `${t}`).not.toContain("151");
        expect(out, `${t}`).not.toContain("systolic");
        if (r.event) {
          expect(r.event.say, t).toBe("");
          expect(r.event.id, t).toBe(7);
          expect(r.event.type, t).toBe(t);
        }
      }
    }
  });

  it("unknown types are dropped (fail closed)", () => {
    expect(familyEvent(ev("notes.exported", loaded()), ALL_ON)).toEqual({ kind: "dropped", event: null });
  });

  it("each data type reaches her only while he shares its section", () => {
    for (const [type, keys] of Object.entries(HINT_WHEN)) {
      if (type === "dose.logged") continue; // its own test below
      expect(familyEvent(ev(type, loaded()), NO_GRANTS).kind, `${type} all off`).toBe("dropped");
      for (const k of keys) expect(familyEvent(ev(type, loaded()), { ...NO_GRANTS, [k]: true }).kind, `${type} with ${k}`).toBe("hint");
      const others = (Object.keys(NO_GRANTS) as (keyof FamilyGrantItems)[]).filter((k) => !keys.includes(k));
      expect(familyEvent(ev(type, loaded()), { ...NO_GRANTS, ...Object.fromEntries(others.map((k) => [k, true])) }).kind, `${type} only other switches`).toBe("dropped");
    }
    // the D41 defaults: notes and transcripts off
    const d41 = { ...ALL_ON, notes: false, visit_transcripts: false };
    expect(familyEvent(ev("note.logged", loaded()), d41).kind).toBe("dropped");
    expect(familyEvent(ev("bp.logged", loaded()), { ...d41, bp_summary: false }).kind).toBe("dropped");
  });

  it("a hint carries no data at all", () => {
    const r = familyEvent(ev("bp.logged", loaded()), ALL_ON);
    expect(r.event).toEqual({ id: 7, type: "bp.logged", session_id: "s-1", at: "2026-10-09T08:00:00.000Z", say: "", data: {} });
  });

  it("dose.logged: this morning's state while dose_summary is on; a hint for the no-reply card; nothing when both are off", () => {
    const on = familyEvent(ev("dose.logged", loaded()), { ...NO_GRANTS, dose_summary: true });
    expect(on.kind).toBe("trimmed");
    expect(on.event?.data).toEqual({ dose: { medication_id: "med-amlodipine", day: 41, slot: "morning", state: "missed" } });
    expect(familyEvent(ev("dose.logged", loaded()), { ...NO_GRANTS, no_reply_alert: true })).toMatchObject({ kind: "hint", event: { data: {} } });
    expect(familyEvent(ev("dose.logged", loaded()), NO_GRANTS).kind).toBe("dropped");
    // a malformed dose is not trimmed into something half-true: a hint instead
    expect(familyEvent(ev("dose.logged", { dose: { medication_id: 3 } }), { ...NO_GRANTS, dose_summary: true }).kind).toBe("hint");
  });

  it("session events carry the session row only, cut to what /f uses (never the join code), and only this session's row", () => {
    const clock = familyEvent(ev("clock.changed", loaded()), NO_GRANTS);
    expect(clock.kind).toBe("pass");
    expect(Object.keys(clock.event!.data as object).sort()).toEqual(["beat", "session"]);
    expect((clock.event!.data as { beat: unknown }).beat).toBeNull();
    // id, story day and time, filming mode; not the join code (with it a device can join), not when the sandbox
    // expires or was made, not the template
    expect((clock.event!.data as { session: SessionRow }).session).toEqual({ id: "s-1", story_day: 41, story_time: "08:45", filming_mode: false });
    expect(JSON.stringify(clock.event)).not.toContain("ABCDEF");
    for (const type of ["session.reset", "session.filming_mode"]) {
      const r = familyEvent(ev(type, loaded()), NO_GRANTS);
      expect(r.event?.data, type).toEqual({ session: { id: "s-1", story_day: 41, story_time: "08:45", filming_mode: false } });
      // the frame her stream sends
      expect(createFamilyStream({ ...NO_GRANTS }).frame(ev(type, loaded())), type).not.toContain("join_code");
    }
    const reset = familyEvent(ev("session.reset", { session: { id: "s-1", story_day: 0 }, other: SECRET }), NO_GRANTS);
    expect(reset.event?.data).toEqual({ session: { id: "s-1", story_day: 0 } });
    const foreign = familyEvent(ev("session.filming_mode", { session: { id: "someone-else" } }), NO_GRANTS);
    expect(foreign.event?.data).toEqual({});
  });

  it("familySessionRow keeps only FAMILY_SESSION_FIELDS (the row /f is rendered with)", () => {
    const row: SessionRow = { id: "s-9", join_code: "QWERTY", template: "mr-tan", story_day: 3, story_time: null, filming_mode: true, created_at: "2026-10-10T00:00:00.000Z", expires_at: null, kind: "filming", owner_user_id: null, d0: null, tz: "Asia/Singapore", settings: {}, onboarding: null, example_data: false, tracking_since: null, clock_offset_ms: null, filming: false };
    expect(familySessionRow(row)).toEqual({ id: "s-9", story_day: 3, story_time: null, filming_mode: true });
    expect([...FAMILY_SESSION_FIELDS].sort()).toEqual(["filming_mode", "id", "story_day", "story_time"]);
  });

  it("family_grant.changed passes with the six switches only; one that cannot be read is dropped", () => {
    const r = familyEvent(ev("family_grant.changed", loaded()), NO_GRANTS);
    expect(r.kind).toBe("pass");
    const data = r.event!.data as { grant: { items: Record<string, boolean>; member: string }; changed: Record<string, boolean> };
    expect(data.grant.items).toEqual(ALL_ON);
    expect(data.grant.member).toBe("wei-ling");
    expect(data.changed).toEqual({ notes: true });
    expect(familyEvent(ev("family_grant.changed", { grant: null }), ALL_ON).kind).toBe("dropped");
    expect(familyEvent(ev("family_grant.changed", "x"), ALL_ON).kind).toBe("dropped");
  });
});

describe("createFamilyStream: follows his switches in stream order", () => {
  it("a note is dropped while notes is off, a hint after he turns it on, dropped again after he turns it off", () => {
    const sid = "s-2";
    const stream = createFamilyStream({ ...ALL_ON, notes: false });
    const note = (id: number) => ev("note.logged", { note: { text: SECRET } }, id, sid);
    const grant = (id: number, notes: boolean) => ev("family_grant.changed", { grant: { member: "wei-ling", items: { ...ALL_ON, notes } }, changed: { notes } }, id, sid);
    const chunk = [note(1), grant(2, true), note(3), grant(4, false), note(5)].map((e) => stream.frame(e)).join("");
    expect(chunk).not.toContain(SECRET);
    const got = frames(chunk);
    // a dropped event sends nothing at all, not even its id: her phone cannot tell when hidden events happen
    expect(got.map((f) => f.id)).toEqual([2, 3, 4]);
    expect(got.map((f) => f.event?.type ?? null)).toEqual(["family_grant.changed", "note.logged", "family_grant.changed"]);
    expect(stream.grants().notes).toBe(false);
    expect(stream.frame(note(6))).toBe("");
    expect(stream.view(note(7)).kind).toBe("dropped");
  });
});

describe("familyStreamFor: only the family role is filtered", () => {
  const SEED = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false };
  async function denied(p: Promise<unknown>): Promise<string | null> {
    try {
      await p;
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(StreamDenied);
      return (err as StreamDenied).code;
    }
  }

  it("her member row (even with a forged rp_role=patient): filtered, starting from his switches; his side unfiltered", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const hers = await device(s, "family");
    for (const cookie of [hers, hers.replace("rp_role=family", "rp_role=patient")]) {
      const f = await familyStreamFor(req("GET", "/api/events", s.id, undefined, cookie), s, getMemoryStore());
      expect(f, cookie).not.toBeNull();
      expect(f!.grants()).toEqual(SEED);
    }
    for (const role of ["patient", "backstage", "director", "judge"] as const) {
      expect(await familyStreamFor(req("GET", "/api/events", s.id, undefined, await device(s, role)), s, getMemoryStore()), role).toBeNull();
    }
    // rp_role=family alone counts in a session nobody joined as family (the e2e harness's phones)
    const plain = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    expect((await familyStreamFor(req("GET", "/api/events", plain.id, undefined, `rp_session=${plain.id}; rp_role=family`), plain, getMemoryStore()))!.grants()).toEqual(SEED);
    expect(await familyStreamFor(req("GET", "/api/events", plain.id), plain, getMemoryStore())).toBeNull();
  });

  it("no stream at all (StreamDenied) for her phone with its cookies dropped or forged, and for her phone naming another session", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const t = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const hers = await device(s, "family");
    for (const cookie of [undefined, `rp_session=${s.id}; rp_role=family`, `rp_session=${s.id}; rp_role=patient`, "rp_member=nobody"]) {
      expect(await denied(familyStreamFor(req("GET", "/api/events", s.id, undefined, cookie), s, getMemoryStore())), String(cookie)).toBe("member_required");
    }
    expect(await denied(familyStreamFor(req("GET", "/api/events", t.id, undefined, hers), t, getMemoryStore()))).toBe("patient_only");
  });

  it("when his switches cannot be read, she starts with every switch off (fail closed)", async () => {
    const mem = getMemoryStore();
    const s = await mem.createSession({ story_day: 41, ttl_hours: 1 });
    const hers = await device(s, "family");
    const broken = new Proxy(mem, {
      get(target, prop, receiver) {
        if (prop === "getFamilyGrant") return () => Promise.reject(new Error("store down"));
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Store;
    const f = await familyStreamFor(req("GET", "/api/events", s.id, undefined, hers), s, broken, getMemoryStore());
    expect(f!.grants()).toEqual(NO_GRANTS);
  });
});

describe("on the real events: he writes a note, records a reading, asks, ticks a dose (D41, seed switches)", () => {
  it("her stream carries none of his words or numbers; the note reaches her as a hint only after he shares notes", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const his = await device(s, "patient");
    const hers = await device(s, "family");
    const family = await familyStreamFor(req("GET", "/api/events", s.id, undefined, hers), s, getMemoryStore());
    expect(family).not.toBeNull();
    const published: BusEvent[] = [];
    const off = getBus().subscribe(s.id, (e) => published.push(e));
    try {
      const NOTE = `脚踝今天更肿了。${SECRET}`;
      const ASK = "我可以多吃一粒降压药吗？";
      expect((await notesPost(req("POST", "/api/notes", s.id, { text: NOTE }, his))).status).toBe(201);
      expect((await bpPost(req("POST", "/api/bp", s.id, { systolic: 151, diastolic: 97 }, his))).status).toBe(201);
      expect((await askPost(req("POST", "/api/ask", s.id, { text: ASK, locale: "zh-Hans", role: "patient" }, his))).status).toBe(200);
      expect((await dosesPost(req("POST", "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, his))).status).toBe(200);
      expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, his))).status).toBe(200);
      const NOTE2 = `第二句。${SECRET}`;
      expect((await notesPost(req("POST", "/api/notes", s.id, { text: NOTE2 }, his))).status).toBe(201);

      // the unfiltered bus does carry them (this is what the route sends today)
      const raw = published.map(toSseFrame).join("");
      expect(raw).toContain(SECRET);
      expect(raw).toContain("151");
      expect(raw).toContain("多吃一粒");

      const per = published.map((e) => family!.frame(e));
      const chunk = per.join("");
      expect(chunk).not.toContain(SECRET);
      expect(chunk).not.toContain("多吃一粒");
      expect(chunk).not.toContain("systolic");
      expect(chunk).not.toMatch(/"say":"[^"]/);
      const got = frames(chunk);
      // what she gets is a subsequence of the bus, in order; a dropped event sends nothing (not even its id)
      expect(got.map((f) => f.id)).toEqual(published.filter((_, i) => per[i] !== "").map((e) => e.id));
      expect(got.every((f) => f.event !== null)).toBe(true);
      const types = got.map((f) => f.event?.type ?? null);
      const firstNote = published.findIndex((e) => e.type === "note.logged");
      const lastNote = published.map((e) => e.type).lastIndexOf("note.logged");
      expect(per[firstNote]).toBe(""); // notes off: nothing
      const hint = frames(per[lastNote])[0];
      expect(hint.event?.type).toBe("note.logged"); // notes on: a hint
      expect(hint.event?.data).toEqual({});
      expect(types).toContain("bp.logged"); // bp_summary on: a hint, no numbers
      expect(types).toContain("family_grant.changed");
      // nothing of the ask reaches her, not even that he asked
      for (const t of types) expect(t === null || !/^(ask|verify)\./.test(t), String(t)).toBe(true);
      // the tick: this morning's state only
      const dose = got.find((f) => f.event?.type === "dose.logged");
      expect(dose?.event?.data).toEqual({ dose: { medication_id: "med-amlodipine", day: 41, slot: "morning", state: "taken" } });
    } finally {
      off();
    }
  });
});

// ------------------------------------------------------------------ registering her reminder

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

const fakeBlob = (get: () => Promise<BlobObject | null>) => ({ getObject: get });

describe("reminderAudioProblem: the clip must be there, WAV, and have sound", () => {
  it("in the real local storage: a recording that was uploaded is fine; a path never uploaded is 404 audio_not_found", async () => {
    const blob = createLocalBlobStore({ dir: blobDir, secret: Buffer.from("unit-test-secret") });
    const p = "sess-r2/reminders/ok.wav";
    await blob.putObject("audio", p, wav(1600), "audio/wav");
    expect(await reminderAudioProblem(blob, p)).toBeNull();
    expect(await reminderAudioProblem(blob, "sess-r2/reminders/never-uploaded.wav")).toEqual({ status: 404, code: "audio_not_found" });
  });

  it("not WAV is 415, a header with no sound is 422", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await reminderAudioProblem(fakeBlob(async () => ({ bytes: png, contentType: "audio/wav" })), "x/reminders/a.wav")).toEqual({ status: 415, code: "not_wav" });
    expect(await reminderAudioProblem(fakeBlob(async () => ({ bytes: wav(0), contentType: "audio/wav" })), "x/reminders/a.wav")).toEqual({ status: 422, code: "audio_empty" });
    expect(await reminderAudioProblem(fakeBlob(async () => ({ bytes: wav(10), contentType: "audio/wav" })), "x/reminders/a.wav")).toBeNull();
  });

  it("storage that errors, or does not answer in time, is 503 storage_unavailable (never a silent 201)", async () => {
    expect(await reminderAudioProblem(fakeBlob(() => Promise.reject(new Error("upstream 500"))), "x/reminders/a.wav")).toEqual({ status: 503, code: "storage_unavailable" });
    const t0 = Date.now();
    expect(await reminderAudioProblem(fakeBlob(() => new Promise<never>(() => {})), "x/reminders/a.wav", 60)).toEqual({ status: 503, code: "storage_unavailable" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("reminderAuthor: only Wei Ling's side records a reminder", () => {
  it("family, a judge's sandbox and a request with no role are wei-ling; his phone, backstage and director get 403 family_only", async () => {
    for (const r of ["family", "judge", null] as const) expect(reminderAuthor(r), String(r)).toEqual({ ok: true, by: "wei-ling" });
    for (const r of ["patient", "backstage", "director"] as const) expect(reminderAuthor(r), r).toEqual({ ok: false, status: 403, code: "family_only" });
    const s = await getMemoryStore().createSession({ story_day: 29, ttl_hours: 1 });
    expect(await reminderAuthorFor(req("POST", "/api/reminders", s.id, {}, await device(s, "patient")), s)).toMatchObject({ ok: false, code: "family_only" });
    expect(await reminderAuthorFor(req("POST", "/api/reminders", s.id, {}, await device(s, "family")), s)).toEqual({ ok: true, by: "wei-ling" });
    // once she has joined: no row is a stranger (her phone with its cookies dropped), and her phone elsewhere is refused
    expect(await reminderAuthorFor(req("POST", "/api/reminders", s.id, {}), s)).toEqual({ ok: false, status: 403, code: "member_required" });
    const t = await getMemoryStore().createSession({ story_day: 29, ttl_hours: 1 });
    expect(await reminderAuthorFor(req("POST", "/api/reminders", t.id, {}, await device(s, "family")), t)).toEqual({ ok: false, status: 403, code: "patient_only" });
  });
});

describe("her recorder names the refusals that another tap cannot fix", () => {
  it("403 family_only and 422 audio_empty have their own line; everything else is 'tap save again'", () => {
    expect(saveErrorFor(403, "family_only")).toBe("family_only");
    expect(saveErrorFor(422, "audio_empty")).toBe("empty");
    for (const [st, code] of [[404, "audio_not_found"], [503, "storage_unavailable"], [403, "patient_only"], [undefined, undefined], [500, undefined]] as const) {
      expect(saveErrorFor(st, code), `${st} ${code}`).toBe("retry");
    }
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const e of ["retry", "family_only", "empty"] as const) {
        const line = ft(locale, saveErrorKey(e));
        expect(line, `${locale} ${e}`).not.toMatch(/^rec\./);
        expect(judgementHits(line), `${locale} ${e}`).toEqual([]);
      }
    }
    expect(ft("zh-Hans", "rec.error.familyOnly")).toBe("只有家人的手机能给爸爸录提醒。");
    expect(ft("en", "rec.error.empty")).toBe("This recording has no sound. Record it again.");
  });
});

describe("fallbackClip: what to play when her clip does not", () => {
  const clip = (id: string, standIn: boolean, audio = true): ReminderClipView =>
    ({ id, by: "wei-ling", text: null, lang: null, plays_at: "after_breakfast", audio_url: audio ? `/api/reminders/${id}/audio` : null, stand_in: standIn });
  it("her next-newest own recording, then the stand-in, then nothing", () => {
    const clips = [clip("seed", true), clip("hers-1", false), clip("broken-no-audio", false, false), clip("hers-2", false)];
    expect(preferredClip(clips)?.id).toBe("hers-2");
    expect(fallbackClip(clips, ["hers-2"])?.id).toBe("hers-1");
    expect(fallbackClip(clips, ["hers-2", "hers-1"])?.id).toBe("seed");
    expect(fallbackClip(clips, ["hers-2", "hers-1", "seed"])).toBeNull();
    expect(fallbackClip([], [])).toBeNull();
  });
});
