/**
 * Wei Ling's reminder clip and the "no reply after two reminders" alert (task M4 item 5, literal requirement):
 * the clip is playable at the reminder time; the alert reaches the family view only while family_grant.no_reply_alert
 * is on; both states tested.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as alertsGet } from "@/app/api/family/alerts/route";
import { GET as audioGet } from "@/app/api/reminders/[id]/audio/route";
import { GET as remindersGet, POST as remindersPost } from "@/app/api/reminders/route";
import { familyAlerts } from "@/lib/daily/alerts";
import { getLocalBlobStore } from "@/lib/blob";
import { cueNoReply, cueReminder } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { getReq, postReq, sessionAt } from "./helpers";

// local blob driver in a temp folder, not web/.data (see tests/unit/blob/local.test.ts)
let blobDir = "";
const prevBlobDir = process.env.BLOB_LOCAL_DIR;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "rp-m4-reminders-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
});
afterAll(() => {
  if (prevBlobDir === undefined) delete process.env.BLOB_LOCAL_DIR;
  else process.env.BLOB_LOCAL_DIR = prevBlobDir;
  rmSync(blobDir, { recursive: true, force: true });
});

async function alerts(s: SessionRow) {
  const res = await alertsGet(getReq("/api/family/alerts", s.id));
  expect(res.status).toBe(200);
  return res.json();
}

describe("Wei Ling's reminder clip", () => {
  it("GET /api/reminders: her words, a playable clip (the labelled stand-in voice for the seed clip), today's times", async () => {
    const s = await sessionAt(43, "08:45");
    const body = await (await remindersGet(getReq("/api/reminders", s.id))).json();
    expect(body.schedule).toEqual({ first: "08:45", second: "09:15", closes: "09:45" });
    expect(body.clips).toEqual([
      {
        id: "clip-wei-ling-1",
        by: "wei-ling",
        text: "爸，早餐吃了吗？药记得吃哦。",
        lang: "zh-Hans",
        plays_at: "after_breakfast",
        audio_url: `/api/reminders/clip-wei-ling-1/audio?session=${encodeURIComponent(s.id)}`,
        stand_in: true,
      },
    ]);
    const audio = await audioGet(getReq("/api/reminders/clip-wei-ling-1/audio", s.id), { params: Promise.resolve({ id: "clip-wei-ling-1" }) });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("x-ripple-stand-in")).toBe("1");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(bytes.slice(8, 12)).toString("ascii")).toBe("WAVE");
    expect(bytes.length).toBeGreaterThan(40_000); // a few seconds of 16 kHz speech
    const ranged = await audioGet(getReq("/api/reminders/clip-wei-ling-1/audio", s.id, { range: "bytes=0-99" }), { params: Promise.resolve({ id: "clip-wei-ling-1" }) });
    expect(ranged.status).toBe(206);
    // the director's reminder cue carries the same clip (filming: the phone plays it on the cue)
    const cue = await cueReminder(getMemoryStore(), s);
    expect(cue.clip?.id).toBe("clip-wei-ling-1");
  });

  it("a clip whose words are not the seed's gets no stand-in voice; another session cannot read it", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(29);
    await store.addReminderClip(s.id, { id: "clip-x", by: "wei-ling", plays_at: "after_breakfast", text: "别的话", audio_path: null });
    const body = await (await remindersGet(getReq("/api/reminders", s.id))).json();
    expect(body.clips.find((c: { id: string }) => c.id === "clip-x").audio_url).toBeNull();
    expect((await audioGet(getReq("/api/reminders/clip-x/audio", s.id), { params: Promise.resolve({ id: "clip-x" }) })).status).toBe(404);
    const other = await sessionAt(29);
    expect((await audioGet(getReq("/api/reminders/clip-x/audio", other.id), { params: Promise.resolve({ id: "clip-x" }) })).status).toBe(404);
  });

  it("POST /api/reminders registers her own uploaded recording (this session's reminders folder only)", async () => {
    const s = await sessionAt(29);
    const blob = getLocalBlobStore();
    expect(blob).not.toBeNull();
    const clipPath = `${s.id}/reminders/test-clip.wav`;
    const wav = new Uint8Array(44 + 3200);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVEfmt "), 8);
    await blob!.putObject("audio", clipPath, wav, "audio/wav");
    const bad = await remindersPost(postReq("/api/reminders", s.id, { audio_path: "someone-else/reminders/x.wav" }));
    expect(bad.status).toBe(403);
    const ok = await remindersPost(postReq("/api/reminders", s.id, { audio_path: clipPath, text: "爸，记得吃药。" }));
    expect(ok.status).toBe(201);
    const clip = (await ok.json()).clip;
    expect(clip).toMatchObject({ by: "wei-ling", audio_path: clipPath, plays_at: "after_breakfast", text: "爸，记得吃药。" });
    const body = await (await remindersGet(getReq("/api/reminders", s.id))).json();
    expect(body.clips.find((c: { id: string }) => c.id === clip.id)).toMatchObject({ stand_in: false });
    const audio = await audioGet(getReq(`/api/reminders/${clip.id}/audio`, s.id), { params: Promise.resolve({ id: clip.id }) });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("x-ripple-stand-in")).toBe("0");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(wav);
  });
});

describe("'no reply after two reminders' reaches Wei Ling only when he allows it", () => {
  it("grant on (the seed): two reminders, no reply -> one alert", async () => {
    const s = await sessionAt(42, "09:15");
    await cueReminder(getMemoryStore(), s);
    await cueReminder(getMemoryStore(), s);
    await cueNoReply(getMemoryStore(), s);
    const body = await alerts(s);
    expect(body.on).toBe(true);
    expect(body.alerts).toEqual([
      expect.objectContaining({ day: 42, date: "2026-10-05", slot: "morning", medication_id: "med-amlodipine", name: "Amlodipine", reminders: 2 }),
    ]);
  });

  it("grant off: nothing, for every role, in the same situation", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(42, "09:15");
    await store.setFamilyGrant(s.id, "wei-ling", { no_reply_alert: false });
    await cueReminder(getMemoryStore(), s);
    await cueReminder(getMemoryStore(), s);
    await cueNoReply(getMemoryStore(), s);
    expect(await alerts(s)).toEqual({ on: false, alerts: [] });
    // switched back on, the same dose shows
    await store.setFamilyGrant(s.id, "wei-ling", { no_reply_alert: true });
    expect((await alerts(s)).alerts.some((a: { day: number }) => a.day === 42)).toBe(true);
  });

  it("the reminder window closing with no answer raises it too (no director needed); an answer never does", async () => {
    const store = getMemoryStore();
    const on = await sessionAt(42, "09:50");
    expect((await alerts(on)).alerts.map((a: { day: number }) => a.day)).toEqual([42]);
    const answered = await sessionAt(42, "08:50");
    await store.logDose(answered.id, { medication_id: "med-amlodipine", day: 42, slot: "morning", state: "missed", reason: "forgot" });
    await store.setStoryDay(answered.id, 42, "10:30");
    expect((await alerts((await store.getSession(answered.id))!)).alerts).toEqual([]);
    const off = await sessionAt(42, "09:50");
    await store.setFamilyGrant(off.id, "wei-ling", { no_reply_alert: false });
    expect(await familyAlerts(store, off)).toEqual({ on: false, alerts: [] });
  });

  it("the seed's own story (D29, grant on, every dose answered) has no alert", async () => {
    expect(await alerts(await sessionAt(29))).toEqual({ on: true, alerts: [] });
  });
});
