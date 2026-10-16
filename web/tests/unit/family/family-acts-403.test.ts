/**
 * Wei Ling may look, never act for him (task M6, closed in the round-4 fixer pass): the family role gets 403
 * patient_only from the four routes round 4 left open (POST /api/understanding, PATCH /api/meds/[id], POST /api/bp,
 * POST /api/notes) and nothing is written or published; once she has joined, her phone with its cookies dropped or
 * forged is a stranger (403 member_required). Mr Tan's own device (patient role, or a request with no role in a session
 * nobody joined as family) still acts, and so does a judge's sandbox. Her own reminder recording stays open to her: POST /api/upload-url
 * (kind reminder) and POST /api/reminders.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { PATCH as medPatch } from "@/app/api/meds/[id]/route";
import { POST as notesPost } from "@/app/api/notes/route";
import { POST as remindersPost } from "@/app/api/reminders/route";
import { POST as understandingPost } from "@/app/api/understanding/route";
import { POST as uploadUrlPost } from "@/app/api/upload-url/route";
import { getLocalBlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";

const savedEnv = { ...process.env };
let blobDir: string;

beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-family-403-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});

afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

function req(method: "POST" | "PATCH", p: string, sessionId: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${p}?session=${encodeURIComponent(sessionId)}`, { method, headers, body: JSON.stringify(body) });
}

/** A device that joined the session as `role` (the member row and cookies /join sets). */
async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

const id = (x: string) => ({ params: Promise.resolve({ id: x }) });

/** The four acting routes, each called once by the given device. */
function act(s: SessionRow, cookie: string | undefined): [string, Promise<Response>][] {
  return [
    ["POST /api/understanding", understandingPost(req("POST", "/api/understanding", s.id, { med_id: "med-amlodipine", item: "feel_fine", answer: "unsure" }, cookie))],
    ["PATCH /api/meds/[id]", medPatch(req("PATCH", "/api/meds/med-amlodipine", s.id, { action: "relabel" }, cookie), id("med-amlodipine"))],
    ["POST /api/bp", bpPost(req("POST", "/api/bp", s.id, { systolic: 150, diastolic: 95 }, cookie))],
    ["POST /api/notes", notesPost(req("POST", "/api/notes", s.id, { text: "脚踝有点肿。" }, cookie))],
  ];
}

async function snapshot(s: SessionRow) {
  const store = getMemoryStore();
  return {
    bp: (await store.listBp(s.id)).length,
    notes: (await store.listNotes(s.id)).length,
    questions: (await store.listQuestions(s.id)).length,
    amlodipine: (await store.getMed(s.id, "med-amlodipine"))?.status,
  };
}

describe("Wei Ling (family role) gets 403 patient_only and nothing changes", () => {
  it("by her member row, with a spoofed rp_role=patient on it; with her cookies dropped or forged she is a stranger (403 member_required)", async () => {
    const s = await getMemoryStore().createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const before = await snapshot(s);
    const member = await device(s, "family");
    const cases: [string | undefined, string][] = [
      [member, "patient_only"],
      [member.replace("rp_role=family", "rp_role=patient"), "patient_only"],
      // once she has joined, a device with no row in his session is nobody (never "no role, so his side")
      [undefined, "member_required"],
      [`rp_session=${s.id}; rp_role=family`, "member_required"],
      [`rp_session=${s.id}; rp_role=patient`, "member_required"],
    ];
    for (const [cookie, code] of cases) {
      for (const [name, p] of act(s, cookie)) {
        const res = await p;
        expect(res.status, `${name} ${cookie}`).toBe(403);
        expect((await res.json()).error, `${name} ${cookie}`).toBe(code);
      }
    }
    expect(await snapshot(s)).toEqual(before);
    expect(before.amlodipine).toBe("label_confirmed");
    const types = getBus().recent(s.id).map((e) => e.type);
    for (const t of ["bp.logged", "note.logged", "question.created", "med.changed"]) expect(types, t).not.toContain(t);
  });
});

describe("Mr Tan's side still acts", () => {
  for (const role of [null, "patient", "judge"] as const) {
    it(`${role ?? "no role (?session= only)"}: all four go through`, async () => {
      const s = await getMemoryStore().createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
      const cookie = role ? await device(s, role) : undefined;
      const status = Object.fromEntries(await Promise.all(act(s, cookie).map(async ([name, p]) => [name, (await p).status] as const)));
      expect(status).toEqual({ "POST /api/understanding": 200, "PATCH /api/meds/[id]": 200, "POST /api/bp": 201, "POST /api/notes": 201 });
      const after = await snapshot(s);
      expect(after.amlodipine).toBe("awaiting_label");
    });
  }
});

describe("her own reminder recording stays open to her", () => {
  it("POST /api/upload-url (kind reminder) and POST /api/reminders answer her, not 403", async () => {
    const s = await getMemoryStore().createSession({ story_day: 29, ttl_hours: 1 });
    const her = await device(s, "family");
    const link = await uploadUrlPost(req("POST", "/api/upload-url", s.id, { kind: "reminder", content_type: "audio/wav" }, her));
    expect(link.status).toBe(200);
    const { path: audioPath } = (await link.json()) as { path: string };
    expect(audioPath.startsWith(`${s.id}/reminders/`)).toBe(true);
    // her phone PUTs the recording through the signed link before registering it (the route may check the file)
    const wav = new Uint8Array(44 + 3200);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVEfmt "), 8);
    await getLocalBlobStore()!.putObject("audio", audioPath, wav, "audio/wav");
    const clip = await remindersPost(req("POST", "/api/reminders", s.id, { audio_path: audioPath, text: "爸，药记得吃哦。" }, her));
    expect(clip.status).toBe(201);
    expect(getBus().recent(s.id).map((e) => e.type)).toContain("reminder.clip_added");
  });
});
