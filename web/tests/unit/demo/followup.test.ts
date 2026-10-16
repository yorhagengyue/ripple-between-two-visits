/**
 * The demo side of the owner's must-fix list (C2 follow-up, track E; docs/plan/real-app.md 10 and 12): what was fixed for
 * accounts first and was still open in the judge sandbox and the crew's filming session.
 *
 *   blood pressure   a reading above the doctor's warning line comes back with his words at once (POST /api/bp)
 *   the brief        an empty recording is not "the last visit"; readings above the warning line on their own row;
 *                    his words with their checked English when the brief is read in English
 *   the reminder     the director's cue carries the clip his phone plays (her newest recording), words and sound alike
 *   her page         "this week" and "today" read one medicine list
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { DELETE as clipDelete } from "@/app/api/demo/reminders/[id]/route";
import { GET as remindersGet, POST as remindersPost } from "@/app/api/reminders/route";
import { getLocalBlobStore } from "@/lib/blob";
import type { ReminderClipView } from "@/lib/daily/types";
import { preferredClip } from "@/lib/family/clips";
import { familyView } from "@/lib/family/view";
import { cueReminder } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { buildBrief } from "@/lib/summary/brief";
import { translationKey } from "@/lib/translate";
import { startVisit } from "@/lib/visit/pipeline";

const R2 =
  "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const store = getMemoryStore();

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

function post(path: string, sessionId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}?session=${sessionId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("the demo's blood pressure: above the doctor's warning line, his words come at once", () => {
  it("185/112 on Day 29: 201 with R2 word for word with its date and time point first, then the 995 sentence", async () => {
    const s = await sessionAt(29, "20:15");
    const res = await bpPost(post("/api/bp", s.id, { systolic: 185, diastolic: 112 }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reading: { systolic: number; diastolic: number }; relay: ThresholdRelay | null };
    expect([body.reading.systolic, body.reading.diastolic]).toEqual([185, 112]);
    const relay = body.relay!;
    expect(relay).not.toBeNull();
    // the doctor's own words first, the 995 sentence after (owner 10-14), for when he feels very unwell (his second decision)
    expect(relay.lines.map((l) => l.origin)).toEqual(["span", "template"]);
    expect(relay.template.templateId).toBe("signal_995_unwell");
    expect(relay.template.zh ?? relay.template.en).toContain("995");
    expect(relay.doctorLine.en).toBe(R2);
    expect(relay.doctorLine.attribution).toBe("doctor");
    // the visit date (Day 0 of the story) and the time point in the recording, with the line's clip
    expect(relay.doctorLine.cite?.date).toBe("2026-08-24");
    expect(typeof relay.doctorLine.cite?.tStartMs).toBe("number");
    expect(relay.doctorLine.cite?.clipUrl).toContain("/api/visits/v1/clip");
    expect(relay.threshold.systolic).toBe(180);
    // nothing in the answer judges the reading
    expect(JSON.stringify(body)).not.toMatch(/偏高|too high|dangerous|危险/);
  });

  it("150/95, 180/100 (not above the line) and 「没量」: recorded, no relay", async () => {
    const s = await sessionAt(29, "20:15");
    for (const data of [{ systolic: 150, diastolic: 95 }, { systolic: 180, diastolic: 100 }, { state: "unconfirmed" }]) {
      const res = await bpPost(post("/api/bp", s.id, data));
      expect(res.status).toBe(201);
      expect(((await res.json()) as { relay: unknown }).relay).toBeNull();
    }
  });

  it("Day 0 before the first visit: Dr Lim has not said the line yet, so no relay (only the record)", async () => {
    const s = await sessionAt(0, "08:00");
    const res = await bpPost(post("/api/bp", s.id, { systolic: 190, diastolic: 110 }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { relay: unknown }).relay).toBeNull();
  });
});

describe("the demo's brief", () => {
  it("a recording that started and ended with nothing is not the last visit: the window still starts after the second visit", async () => {
    const s = await sessionAt(30, "10:00");
    const empty = await startVisit(store, s, { mode: "record", consent: { given: true } });
    expect(empty.day).toBe(30);
    await store.updateVisit(s.id, empty.id, { status: "review" });
    const later = await store.setStoryDay(s.id, 31, "09:00");
    const view = await buildBrief(store, later, "zh-Hans");
    expect(view.window).toMatchObject({ fromDay: 9, toDay: 31, lastVisit: { id: "v2", day: 8 } });
    // the Day 29 evening reading is still in it (it was dropped when the empty recording counted)
    expect(view.bp.count).toBeGreaterThan(0);
  });

  it("readings above the warning line get a row of their own next to R2, word for word; none above: no row", async () => {
    const s = await sessionAt(29, "20:15");
    const before = await buildBrief(store, s, "zh-Hans");
    expect(before.aboveLine?.line.text).toBe(R2);
    expect(before.aboveLine?.readings).toEqual([]);
    await store.addBp(s.id, { day: 27, slot: "evening", systolic: 185, diastolic: 112, state: "recorded" });
    await store.addBp(s.id, { day: 28, slot: "morning", systolic: 180, diastolic: 99, state: "recorded" });
    const view = await buildBrief(store, s, "zh-Hans");
    expect(view.aboveLine?.readings.map((r) => [r.day, r.date, r.slot, r.systolic, r.diastolic])).toEqual([[27, "2026-09-20", "evening", 185, 112]]);
    expect(view.aboveLine?.line).toMatchObject({ systolic: 180, date: "2026-08-24", state: "confirmed" });
    // a reading before the window (before the last visit) is not listed
    await store.addBp(s.id, { day: 5, slot: "evening", systolic: 190, diastolic: 100, state: "recorded" });
    expect((await buildBrief(store, s, "zh-Hans")).aboveLine?.readings.map((r) => r.day)).toEqual([27]);
  });

  it("Day 0 before the visit: no warning line yet, so no row at all", async () => {
    const s = await sessionAt(0, "08:00");
    expect((await buildBrief(store, s, "zh-Hans")).aboveLine).toBeNull();
  });

  it("read in English: his words carry the checked translation that is kept; in 华语 none is looked up; a rejected one is never shown", async () => {
    const s = await sessionAt(37, "20:00");
    const zh = await buildBrief(store, s, "zh-Hans");
    expect(zh.english).toEqual({});
    const note = zh.notes.at(-1)!;
    expect(note.text).toMatch(/\p{Script=Han}/u);
    // offline (the mock model) nothing is translated: the brief then says his words are not translated
    expect((await buildBrief(store, s, "en")).english).toEqual({});
    await store.putTranslation(s.id, { direction: "zh-Hans>en", source_sha256: translationKey(note.text), source_text: note.text.trim(), text: "A checked translation of his note.", status: "checked", checks: {} });
    const other = zh.notes.find((n) => n.id !== note.id);
    if (other) {
      await store.putTranslation(s.id, { direction: "zh-Hans>en", source_sha256: translationKey(other.text), source_text: other.text.trim(), text: null, status: "rejected", checks: {} });
    }
    const en = await buildBrief(store, s, "en");
    expect(en.english).toEqual({ [note.text.trim()]: "A checked translation of his note." });
    // his own words stay as they are
    expect(en.notes.at(-1)!.text).toBe(note.text);
    expect((await buildBrief(store, s, "en", { translate: "cache" })).english).toEqual(en.english);
  });
});

// ---------------------------------------------------------------- her page: recordings, the cue, this week and today

// uploaded test clips go to a temp folder of their own (left there; the OS clears it)
const prevBlobDir = process.env.BLOB_LOCAL_DIR;
beforeAll(() => {
  process.env.BLOB_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), "rp-demo-followup-"));
});
afterAll(() => {
  if (prevBlobDir === undefined) delete process.env.BLOB_LOCAL_DIR;
  else process.env.BLOB_LOCAL_DIR = prevBlobDir;
});

function wav(): Uint8Array {
  const bytes = new Uint8Array(44 + 3200);
  bytes.set(Buffer.from("RIFF"), 0);
  bytes.set(Buffer.from("WAVEfmt "), 8);
  return bytes;
}

async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await store.addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

/** She records one (upload, then register), as /f does. */
async function record(s: SessionRow, name: string, text?: string): Promise<string> {
  const clipPath = `${s.id}/reminders/${name}.wav`;
  await getLocalBlobStore()!.putObject("audio", clipPath, wav(), "audio/wav");
  const res = await remindersPost(post("/api/reminders", s.id, text ? { audio_path: clipPath, text } : { audio_path: clipPath }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { clip: { id: string } }).clip.id;
}

async function clipsOf(s: SessionRow, cookie?: string): Promise<ReminderClipView[]> {
  const res = await remindersGet(new NextRequest(`http://localhost/api/reminders?session=${s.id}`, { headers: cookie ? { cookie } : {} }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { clips: ReminderClipView[] }).clips;
}

function del(s: SessionRow, id: string, cookie?: string): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/demo/reminders/${encodeURIComponent(id)}?session=${s.id}`, { method: "DELETE", headers: cookie ? { cookie } : {} });
  return clipDelete(req, { params: Promise.resolve({ id }) });
}

describe("her recordings on the demo's /f can be heard and deleted", () => {
  it("each saved recording has its own audio link; deleting the newest falls back to the one before, then to the stand-in", async () => {
    const s = await sessionAt(29);
    const first = await record(s, "one", "爸，记得吃药。");
    const second = await record(s, "two");
    let clips = await clipsOf(s);
    const mine = clips.filter((c) => c.audio_url && !c.stand_in);
    expect(mine.map((c) => c.id)).toEqual([first, second]);
    for (const c of mine) expect(c.audio_url).toBe(`/api/reminders/${c.id}/audio?session=${encodeURIComponent(s.id)}`);
    expect(preferredClip(clips)?.id).toBe(second);

    expect((await del(s, second)).status).toBe(200);
    clips = await clipsOf(s);
    expect(clips.some((c) => c.id === second)).toBe(false);
    expect(preferredClip(clips)?.id).toBe(first);

    expect((await del(s, first)).status).toBe(200);
    clips = await clipsOf(s);
    expect(preferredClip(clips)).toMatchObject({ id: "clip-wei-ling-1", stand_in: true });
    // gone is gone
    expect((await del(s, first)).status).toBe(404);
  });

  it("the story's own clip is not hers to delete; his phone, backstage and the director cannot delete her recording", async () => {
    const s = await store.createSession({ story_day: 29, ttl_hours: null, filming_mode: true });
    expect((await del(s, "clip-wei-ling-1", await device(s, "family"))).status).toBe(404);
    const her = await device(s, "family");
    const clipPath = `${s.id}/reminders/hers.wav`;
    await getLocalBlobStore()!.putObject("audio", clipPath, wav(), "audio/wav");
    const made = await remindersPost(new NextRequest(`http://localhost/api/reminders?session=${s.id}`, { method: "POST", headers: { cookie: her, "content-type": "application/json" }, body: JSON.stringify({ audio_path: clipPath }) }));
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { clip: { id: string } }).clip.id;
    for (const role of ["patient", "backstage", "director"] as const) {
      const res = await del(s, id, await device(s, role));
      expect([res.status, ((await res.json()) as { error: string }).error], role).toEqual([403, "family_only"]);
    }
    expect((await clipsOf(s, her)).some((c) => c.id === id)).toBe(true);
    expect((await del(s, id, her)).status).toBe(200);
    expect((await clipsOf(s, her)).some((c) => c.id === id)).toBe(false);
  });
});

describe("the director's reminder cue names the clip the phones play", () => {
  it("the story's clip while she has recorded nothing; her newest recording after, with its own words (or none), never the story's", async () => {
    const s = await sessionAt(43, "08:45");
    expect((await cueReminder(store, s)).clip).toMatchObject({ id: "clip-wei-ling-1", text: "爸，早餐吃了吗？药记得吃哦。" });
    const typed = await record(s, "typed", "爸，今天也要吃药。");
    expect((await cueReminder(store, s)).clip).toMatchObject({ id: typed, text: "爸，今天也要吃药。" });
    const silent = await record(s, "no-words");
    const cue = await cueReminder(store, s);
    // the card shows no words for a recording she saved without typing any; the sound is that same clip
    expect(cue.clip).toMatchObject({ id: silent, text: null });
    expect(preferredClip(await clipsOf(s))?.id).toBe(cue.clip?.id);
  });
});

describe("her page: this week and today read one medicine list", () => {
  it("Day 42 (a Monday) before 9:45: nothing counted this week yet, and today's tablet is listed as still open", async () => {
    const s = await sessionAt(42, "08:30");
    const view = await familyView(store, s);
    expect(view.doses?.week).toMatchObject({ fromDay: 42, toDay: 42 });
    expect(view.doses?.daysDue).toBe(0);
    // the page says "no check-in this week so far" (not "no medicine due"): today lists the tablet
    expect(view.doses?.today.map((d) => [d.medication_id, d.state])).toEqual([["med-amlodipine", null]]);
  });

  it("the same day after the window closed: the day counts, and today lists the same tablet", async () => {
    const s = await sessionAt(42, "10:00");
    const view = await familyView(store, s);
    expect(view.doses?.daysDue).toBe(1);
    expect(view.doses?.today.map((d) => d.medication_id)).toEqual(["med-amlodipine"]);
  });

  it("Day 43: the new tablet from the third visit is in both, by name the same", async () => {
    const s = await sessionAt(43, "10:00");
    const view = await familyView(store, s);
    expect(view.doses?.today.map((d) => d.medication_id).sort()).toEqual(["med-amlodipine", "med-losartan"]);
    expect(view.doses?.daysDue).toBeGreaterThanOrEqual(1);
  });
});
