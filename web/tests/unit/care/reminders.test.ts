/**
 * Her reminder recordings on a real account (C2 track D; architecture review 18 「卡上的字和录音一致」; 还开着的决定: numbers,
 * medicine names and doses keep the words off his card). The words come from the clip itself (the stand-in transcription
 * here); a take that names a medicine or a dose shows only 「女儿的录音」; no transcription means no words; his phone plays
 * her newest recording with her name; she can choose an older one again and delete her own, never anyone else's.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { DELETE as clipDelete } from "@/app/api/reminders/[id]/route";
import { POST as clipUse } from "@/app/api/reminders/[id]/use/route";
import { GET as remindersGet, POST as remindersPost } from "@/app/api/reminders/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, blobUserTag, getBlobStore } from "@/lib/blob";
import { reminderTextCheck, cardText } from "@/lib/care/reminder-text";
import type { HerClipView, HerReminders } from "@/lib/care/reminders";
import { reminderFixture, transcribeReminder } from "@/lib/care/transcribe";
import { remindersView } from "@/lib/daily/reminders";
import { preferredClip } from "@/lib/family/clips";
import { getMemoryStore } from "@/lib/store/memory";
import { encodeWav } from "@/lib/visit/wav";

const store = getMemoryStore();
const savedEnv = { ...process.env };
let blobDir: string;
let him: TestAccount;
let her: TestAccount;
let linkId: string;

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
function req(p: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** A short WAV with sound, uploaded into his space as her reminder file. */
async function upload(): Promise<string> {
  const pcm = new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3);
  const bytes = encodeWav(pcm, 16000);
  // C2 track H: her recording's file name starts with her tag (what POST /api/upload-url?link= hands her)
  const p = `${blobPrefix({ id: him.userId, kind: "account" })}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`;
  await getBlobStore().putObject("audio", p, bytes, "audio/wav");
  return p;
}

async function record(fixture: string | null): Promise<{ status: number; body: { clip: HerClipView; shown: string; why: string | null } }> {
  const p = await upload();
  const res = await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: p, text: "typed words are ignored" }, headers: fixture ? { "x-ripple-devfake-fixture": fixture } : {} }));
  return { status: res.status, body: (await res.json()) as { clip: HerClipView; shown: string; why: string | null } };
}

beforeAll(async () => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-care-rem-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  process.env.SPEECH_PROVIDER = "devfake";
  him = await createAccountWithSpace(store, getAuthProvider(), { login: login("t"), password: "a long test password", space: "example", display_name: "陈先生" });
  her = await createAccountWithSpace(store, getAuthProvider(), { login: login("w"), password: "a long test password", space: "none", display_name: "Wei Ling" });
  const inv = await invitePost(req("/api/family/invites", { token: him.tokens.access_token, body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }));
  const body = (await inv.json()) as { link: { id: string }; path: string };
  linkId = body.link.id;
  await acceptPost(req("/api/family/invites/accept", { token: her.tokens.access_token, body: { token: body.path.slice("/invite/".length) } }));
  await confirmPost(req(`/api/family/links/${linkId}/confirm`, { token: him.tokens.access_token, body: { yes: true } }), params(linkId));
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

describe("the words on his card", () => {
  it("everyday words pass; a medicine name, a number or a dose keeps them off", () => {
    expect(reminderTextCheck("爸，早餐吃了吗？药记得吃哦。")).toEqual({ clinical: false, signals: [] });
    expect(reminderTextCheck("Dad, have you had breakfast? Remember your medicine.").clinical).toBe(false);
    expect(reminderTextCheck("爸，今天记得吃一粒 Amlodipine 5 毫克。").clinical).toBe(true);
    expect(reminderTextCheck("爸，今天吃两粒").signals).toContain("number");
    expect(reminderTextCheck("Dad, take 2 tablets").clinical).toBe(true);
    expect(reminderTextCheck("Dad, remember your Xyzoprilane 10").signals).toContain("unknown_drug");
    expect(reminderTextCheck("爸，血压 150 要记下来").clinical).toBe(true);
    expect(cardText(null)).toEqual({ text: null, why: "no_transcript" });
    expect(cardText("   ")).toEqual({ text: null, why: "no_transcript" });
    expect(cardText("爸，今天记得吃一粒 Amlodipine 5 毫克。")).toEqual({ text: null, why: "clinical" });
    expect(cardText("爸，早餐吃了吗？药记得吃哦。")).toEqual({ text: "爸，早餐吃了吗？药记得吃哦。", why: null });
  });

  it("the stand-in transcription knows the journey's takes; mock knows nothing", async () => {
    expect(reminderFixture("reminder")).toBe("爸，早餐吃了吗？药记得吃哦。");
    expect(reminderFixture("v1")).toBeNull();
    const audio = new Uint8Array(100);
    expect(await transcribeReminder(audio, { devfakeFixture: "reminder", env: { SPEECH_PROVIDER: "devfake" } })).toEqual({ text: "爸，早餐吃了吗？药记得吃哦。", source: "devfake" });
    expect(await transcribeReminder(audio, { devfakeFixture: null, env: { SPEECH_PROVIDER: "devfake" } })).toEqual({ text: null, source: "devfake" });
    expect(await transcribeReminder(audio, { devfakeFixture: "reminder", env: { SPEECH_PROVIDER: "mock" } })).toEqual({ text: null, source: "none" });
    // devfake refuses outside the developer tools
    expect(await transcribeReminder(audio, { devfakeFixture: "reminder", env: { SPEECH_PROVIDER: "devfake", NODE_ENV: "production" } })).toEqual({ text: null, source: "none" });
  });
});

describe("her recordings", () => {
  it("a recording's words come from the clip; his phone plays it with her name", async () => {
    const r = await record("reminder");
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ shown: "text", why: null, clip: { whose: "yours", text: "爸，早餐吃了吗？药记得吃哦。", current: true, byLabel: "Wei Ling" } });
    expect(r.body.clip.audioUrl).toContain(`link=${linkId}`);
    expect(JSON.stringify(r.body)).not.toContain("typed words are ignored");
    const his = await remindersView(store, (await store.getSession(him.userId))!);
    const plays = preferredClip(his.clips);
    expect(plays).toMatchObject({ id: r.body.clip.id, text: "爸，早餐吃了吗？药记得吃哦。", stand_in: false, by_label: "Wei Ling" });
  });

  it("a take that names a medicine and a dose plays as 「女儿的录音」 with no words; no transcription, no words", async () => {
    const dose = await record("reminder-dose");
    expect(dose.body).toMatchObject({ shown: "label_only", why: "clinical", clip: { text: null, current: true } });
    const none = await record(null);
    expect(none.body).toMatchObject({ shown: "label_only", why: "no_transcript", clip: { text: null } });
  });

  it("she chooses an older one again, deletes her own; his own account cannot record or delete hers", async () => {
    const first = await record("reminder");
    await record("reminder-dose");
    const use = await clipUse(req(`/api/reminders/${first.body.clip.id}/use?link=${linkId}`, { token: her.tokens.access_token, body: {} }), params(first.body.clip.id));
    expect(use.status).toBe(200);
    let mine = (await (await remindersGet(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token }))).json()) as HerReminders;
    expect(mine.current?.text).toBe("爸，早餐吃了吗？药记得吃哦。");
    // one row per file in her list, newest first
    const files = mine.mine.map((c) => c.id);
    expect(new Set(files).size).toBe(files.length);
    expect((await clipDelete(req(`/api/reminders/${mine.current!.id}?link=${linkId}`, { token: her.tokens.access_token, method: "DELETE" }), params(mine.current!.id))).status).toBe(200);
    mine = (await (await remindersGet(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token }))).json()) as HerReminders;
    expect(mine.mine.find((c) => c.text === "爸，早餐吃了吗？药记得吃哦。" && c.id === first.body.clip.id)).toBeUndefined();
    // his account: a clip of his never plays labelled hers; her clips are not his to delete through these routes
    const p = await upload();
    expect((await remindersPost(req("/api/reminders", { token: him.tokens.access_token, body: { audio_path: p } }))).status).toBe(403);
    expect((await clipDelete(req(`/api/reminders/${mine.mine[0].id}`, { token: him.tokens.access_token, method: "DELETE" }), params(mine.mine[0].id))).status).toBe(404);
    // the stand-in seed clip is not hers to delete
    const standIn = (await store.listReminderClips(him.userId)).find((c) => !c.by_user_id)!;
    expect((await clipDelete(req(`/api/reminders/${standIn.id}?link=${linkId}`, { token: her.tokens.access_token, method: "DELETE" }), params(standIn.id))).status).toBe(404);
  });

  it("the file must be his space's reminder file, uploaded and with sound", async () => {
    const bad = await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: "elsewhere/reminders/x.wav" } }));
    expect(bad.status).toBe(403);
    const missing = `${blobPrefix({ id: him.userId, kind: "account" })}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`;
    expect((await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: missing } }))).status).toBe(404);
    // C2 track H: a file in his reminders folder that she did not upload (no tag of hers in its name) is not hers to register
    const notHers = `${blobPrefix({ id: him.userId, kind: "account" })}/reminders/${randomUUID()}.wav`;
    await getBlobStore().putObject("audio", notHers, encodeWav(new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3), 16000), "audio/wav");
    expect((await remindersPost(req(`/api/reminders?link=${linkId}`, { token: her.tokens.access_token, body: { audio_path: notHers } }))).status).toBe(403);
  });

  // C2 track D, round two: 「删掉这段」 takes the recording itself, at once (it used to wait for his whole space to go)
  it("deleting her recording removes its file from his storage once no row points at it; a take she went back to keeps the file", async () => {
    const blob = getBlobStore();
    const stored = async (p: string) => (await blob.getObject("audio", p)) !== null;
    const pathOf = async (id: string) => (await store.listReminderClips(him.userId)).find((c) => c.id === id)!.audio_path!;
    const first = await record("reminder");
    const file = await pathOf(first.body.clip.id);
    expect(await stored(file)).toBe(true);
    // 「换回这段」 makes a second row pointing at the same file: deleting either row of hers takes every row of that file, then the file
    const again = await clipUse(req(`/api/reminders/${first.body.clip.id}/use?link=${linkId}`, { token: her.tokens.access_token, body: {} }), params(first.body.clip.id));
    expect(again.status).toBe(200);
    expect((await store.listReminderClips(him.userId)).filter((c) => c.audio_path === file)).toHaveLength(2);
    const other = await record("reminder");
    const otherFile = await pathOf(other.body.clip.id);
    const gone = await clipDelete(req(`/api/reminders/${first.body.clip.id}?link=${linkId}`, { token: her.tokens.access_token, method: "DELETE" }), params(first.body.clip.id));
    expect(await gone.json()).toEqual({ ok: true, removed: 2 });
    expect((await store.listReminderClips(him.userId)).filter((c) => c.audio_path === file)).toEqual([]);
    expect(await stored(file)).toBe(false);
    // her other recording, and its file, are untouched
    expect(await stored(otherFile)).toBe(true);
    // a file without her tag in its name is never hers to remove, even if a row of hers pointed at it
    const untagged = `${blobPrefix({ id: him.userId, kind: "account" })}/reminders/${randomUUID()}.wav`;
    await blob.putObject("audio", untagged, encodeWav(new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3), 16000), "audio/wav");
    const row = await store.addReminderClip(him.userId, { by: linkId, plays_at: "after_breakfast", audio_path: untagged, by_user_id: her.userId, by_label: "Wei Ling", link_id: linkId });
    expect((await clipDelete(req(`/api/reminders/${row.id}?link=${linkId}`, { token: her.tokens.access_token, method: "DELETE" }), params(row.id))).status).toBe(200);
    expect(await stored(untagged)).toBe(true);
  });
});
