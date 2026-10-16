/**
 * His export (lib/privacy/export.ts; real-app 3.11 导出, 8.9; the elder brief 15.1; journey 15; C2 track H), on the
 * memory store, the memory identity provider and the local blob driver in a temporary folder:
 *   - every table of his records is there, his side of the family link with its switches, history and access log, his
 *     consents and sign-in sessions; the files his rows point at in his folder each carry a link for 24 real hours
 *   - nothing names anyone (no user id, his own included; no invitation hash, no device or session hash, no push keys)
 *   - a stand-in clip is not his file; a file gone from storage is listed without a link
 *   - three a day on his own day; the fourth is 429 until his next midnight; the next day counts again
 *   - a family member without a space exports her account, her side of the link and the reminders she recorded (as
 *     they are registered: no path, no link to the sound, nothing of his)
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, blobUserTag, createLocalBlobStore, type LocalBlobStore } from "@/lib/blob";
import { logLook } from "@/lib/care/access-log";
import { buildExport, exportAllowance, runExport, type ExportStores, type ExportWho } from "@/lib/privacy/export";
import { MemoryStore } from "@/lib/store/memory";
import { familySubject, selfSubject } from "@/lib/subject/resolve";
import { scopedStore } from "@/lib/subject/scoped-store";
import { encodeWav } from "@/lib/visit/wav";

const PASSWORD = "a long test password";
const ORIGIN = "http://localhost:3590";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);

let dir: string;
let blob: LocalBlobStore;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-export-"));
  blob = createLocalBlobStore({ dir });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

interface Setup {
  store: MemoryStore;
  auth: MemoryAuthProvider;
  him: TestAccount;
  her: TestAccount;
  linkId: string;
  hash: string;
  setNow(iso: string): void;
  nowMs(): number;
  files: { recording: string; clip: string; photo: string; herClip: string };
}

async function setup(): Promise<Setup> {
  let now = new Date("2026-10-10T03:00:00.000Z"); // 11:00 in Singapore
  const store = new MemoryStore({ now: () => now });
  const auth = new MemoryAuthProvider();
  const him = await createAccountWithSpace(store, auth, { login: login("tan"), password: PASSWORD, space: "blank", today: "2026-10-10" }, { nowMs: now.getTime() });
  const her = await createAccountWithSpace(store, auth, { login: login("weiling"), password: PASSWORD, space: "none" }, { nowMs: now.getTime() });
  const scope = him.scope!;
  const prefix = blobPrefix(scope);
  const files = {
    recording: `${prefix}/visits/v-1/recording-${randomUUID()}.wav`,
    clip: `${prefix}/visits/v-1/segments/v-1-u01.wav`,
    photo: `${prefix}/labels/${randomUUID()}.png`,
    // her recording in his folder: the file name starts with her tag (lib/blob/prefix.ts blobUserTag)
    herClip: `${prefix}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`,
  };
  for (const p of [files.recording, files.clip, files.herClip]) await blob.putObject("audio", p, encodeWav(new Int16Array(400)), "audio/wav");
  await blob.putObject("labels", files.photo, PNG, "image/png");
  await store.upsertVisit(scope.id, { id: "v-1", kind: "follow_up", place: "Blossom Family Clinic", day: 0, status: "review", audio_path: files.recording });
  await store.addUtterances(scope.id, "v-1", [
    { id: "v-1-u01", t_start_ms: 0, t_end_ms: 900, text: "Please don't change the dose yourself.", clip_path: files.clip },
    { id: "v-1-u02", t_start_ms: 900, t_end_ms: 1800, text: "At home, we want it below 135 over 85.", clip_path: "visits/clips/v1-u08.wav" },
  ]);
  await store.upsertMed(scope.id, { id: "med-a", origin: "prescription", status: "label_confirmed", drug_id: "amlodipine", label: { text: "AMLODIPINE 5MG TABLET", photo_path: files.photo } });
  await store.addBp(scope.id, { day: 0, slot: "morning", systolic: 138, diastolic: 82 });
  await store.addNote(scope.id, { day: 0, text: "我今天好累。", source: "typed" });
  await store.addQuestion(scope.id, { for: "doctor", origin: "own", text: "膝盖止痛药还可以吃吗？", asked_by_user_id: her.userId });
  await store.addSafetyEvent(scope.id, { input: "我今天好累。", route: "log_only" });
  const hash = createHash("sha256").update(randomBytes(16)).digest("hex");
  const invited = await store.createInvite({ patient_id: him.userId, relation: "daughter", family_label: "Wei Ling", invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true });
  if (!invited.ok) throw new Error(invited.code);
  const accepted = await store.acceptInvite(hash, her.userId, "Wei Ling");
  if (!accepted.ok) throw new Error(accepted.code);
  const confirmed = await store.confirmLink(accepted.link.id, him.userId, true);
  if (!confirmed.ok) throw new Error(confirmed.code);
  await store.addReminderClip(scope.id, { by: confirmed.link.id, plays_at: "after_breakfast", audio_path: files.herClip, by_user_id: her.userId, by_label: "Wei Ling", link_id: confirmed.link.id });
  await logLook(familySubject(store, scope, her.userId, confirmed.link).store, scope.id, { linkId: confirmed.link.id, userId: her.userId, label: "Wei Ling", route: "/f", items: ["dose_summary"] }, now.getTime());
  return { store, auth, him, her, linkId: confirmed.link.id, hash, files, setNow: (iso) => (now = new Date(iso)), nowMs: () => now.getTime() };
}

function stores(s: Setup, who: TestAccount): ExportStores {
  const own = who.scope ? selfSubject(s.store, who.scope, who.userId).store : scopedStore(s.store, { id: `no-scope:${who.userId}` }, "self", { userId: who.userId, maskSessionId: true });
  return { own, admin: s.store, auth: s.auth, blob };
}

function whoOf(a: TestAccount): ExportWho {
  return { userId: a.userId, account: a.account, scope: a.scope, login: a.login.kind === "username" ? a.login.username : a.login.email, origin: ORIGIN };
}

describe("buildExport", () => {
  it("his whole record, his side of the link, his files with 24-hour links; nothing that names anyone", async () => {
    const s = await setup();
    const real = Date.parse("2026-10-10T03:00:00.000Z");
    const file = await buildExport(stores(s, s.him), whoOf(s.him), { nowMs: real, realNowMs: real });
    expect(file.fileName).toBe("ripple-export-2026-10-10.json");
    const data = JSON.parse(file.json) as { format: string; version: number; account: Record<string, unknown>; space: Record<string, unknown>; counts: Record<string, number>; tables: Record<string, Record<string, unknown>[]>; files: Record<string, unknown>[]; links_expire_at: string };
    expect(data).toMatchObject({ format: "ripple-export", version: 1, account: { login: s.him.account.username, login_kind: "username" }, space: { kind: "account", tz: "Asia/Singapore", today: "2026-10-10" } });
    expect(data.counts).toMatchObject({ visits: 1, utterances: 2, medications: 1, bp_readings: 1, notes: 1, questions: 1, reminder_clips: 1, safety_events: 1, family_links: 1, family_switches: 1, family_access_log: 1, links_as_family: 0 });
    expect(data.counts.consents).toBeGreaterThanOrEqual(2);
    expect(data.counts.sign_in_sessions).toBeGreaterThanOrEqual(1);
    expect(data.counts.family_switch_history).toBeGreaterThanOrEqual(1);
    for (const table of Object.keys(data.counts)) expect(Array.isArray(data.tables[table]), table).toBe(true);
    expect(data.tables.family_links[0]).toMatchObject({ id: s.linkId, family_label: "Wei Ling", status: "active" });
    expect(data.tables.family_access_log[0]).toMatchObject({ who: "Wei Ling", items: ["dose_summary"], link_id: s.linkId });
    expect(data.tables.notes[0]).toMatchObject({ text: "我今天好累。" });

    // files: the recording, his clip, the label photo, her reminder; not the stand-in clip
    expect(data.files.map((f) => f.kind).sort()).toEqual(["label_photo", "reminder", "sentence_clip", "visit_recording"]);
    expect(JSON.stringify(data.files)).not.toContain("visits/clips/");
    const expires = Date.parse(data.links_expire_at);
    expect(expires - real).toBe(24 * 3600 * 1000);
    for (const f of data.files) {
      expect(f.expires_at).toBe(data.links_expire_at);
      const url = String(f.url);
      expect(url.startsWith(`${ORIGIN}/api/blob/read?token=`)).toBe(true);
      const token = new URL(url).searchParams.get("token");
      expect(blob.readToken(token)).toEqual({ bucket: f.bucket, path: f.path });
    }

    // nothing that names anyone or opens anything
    const text = file.json;
    for (const secret of [s.him.userId, s.her.userId, s.hash]) expect(text).not.toContain(secret);
    for (const key of ['"session_id"', '"user_id"', '"patient_id"', '"family_id"', '"family_user_id"', '"invite_token_hash"', '"device_hash"', '"by_user_id"', '"asked_by_user_id"', '"code_hash"', '"p256dh"']) expect(text).not.toContain(key);
  });

  it("a file gone from storage is listed without a link", async () => {
    const s = await setup();
    await blob.removePrefix("labels", blobPrefix(s.him.scope!));
    const file = await buildExport(stores(s, s.him), whoOf(s.him), { nowMs: Date.now(), realNowMs: Date.now() });
    const photo = (file.data.files as { kind: string; url: string | null; expires_at: string | null }[]).find((f) => f.kind === "label_photo")!;
    expect(photo).toMatchObject({ url: null, expires_at: null });
  });

  it("a family member without a space: her account and her side of the link, none of his records", async () => {
    const s = await setup();
    const file = await buildExport(stores(s, s.her), whoOf(s.her), { nowMs: Date.now(), realNowMs: Date.now() });
    const data = file.data as { space: unknown; counts: Record<string, number>; tables: Record<string, Record<string, unknown>[]>; files: unknown[] };
    expect(data.space).toBeNull();
    expect(data.files).toEqual([]);
    expect(data.counts).toMatchObject({ visits: 0, notes: 0, family_links: 0, links_as_family: 1, family_access_log: 0 });
    expect(data.tables.links_as_family[0]).toMatchObject({ id: s.linkId, status: "active" });
    expect(file.json).not.toContain("我今天好累");
    expect(file.json).not.toContain(s.him.userId);
  });

  it("her export carries the reminders she recorded, as registered: no path, no link to the sound, nothing of his", async () => {
    const s = await setup();
    const scope = s.him.scope!;
    const prefix = blobPrefix(scope);
    const tag = blobUserTag(s.her.userId);
    // a second take with words, one recorded before file names carried a tag, one whose file is gone, one of his own
    // stand-in clips, and a recording she uploaded but never saved
    const second = `${prefix}/reminders/${tag}-${randomUUID()}.wav`;
    const legacy = `${prefix}/reminders/${randomUUID()}.wav`;
    const lost = `${prefix}/reminders/${tag}-${randomUUID()}.wav`;
    const neverSaved = `${prefix}/reminders/${tag}-${randomUUID()}.wav`;
    for (const p of [second, legacy, neverSaved]) await blob.putObject("audio", p, encodeWav(new Int16Array(400)), "audio/wav");
    await s.store.addReminderClip(scope.id, { by: s.linkId, plays_at: "after_breakfast", audio_path: second, text: "爸，早餐吃了吗？", lang: "zh-Hans", by_user_id: s.her.userId, by_label: "Wei Ling", link_id: s.linkId });
    await s.store.addReminderClip(scope.id, { by: s.linkId, plays_at: "08:45", audio_path: legacy, by_user_id: s.her.userId, by_label: "Wei Ling", link_id: s.linkId });
    await s.store.addReminderClip(scope.id, { by: s.linkId, plays_at: "after_breakfast", audio_path: lost, by_user_id: s.her.userId, by_label: "Wei Ling", link_id: s.linkId });
    await s.store.addReminderClip(scope.id, { by: "wei-ling", plays_at: "after_breakfast", audio_path: "reminders/stand-in.wav", text: "不是她录的" });

    const file = await buildExport(stores(s, s.her), whoOf(s.her), { nowMs: Date.now(), realNowMs: Date.now() });
    const data = file.data as { counts: Record<string, number>; tables: Record<string, Record<string, unknown>[]>; files: unknown[]; reminder_recordings_unregistered: number };
    expect(data.counts.reminders_recorded).toBe(4);
    expect(data.files).toEqual([]);
    const rows = data.tables.reminders_recorded;
    expect(rows.map((r) => Object.keys(r).sort())).toEqual(rows.map(() => ["created_at", "id", "lang", "link_id", "plays_at", "recording_stored", "text"]));
    expect(rows.every((r) => r.link_id === s.linkId)).toBe(true);
    expect(rows.find((r) => r.text === "爸，早餐吃了吗？")).toMatchObject({ plays_at: "after_breakfast", lang: "zh-Hans", recording_stored: true });
    expect(rows.find((r) => r.plays_at === "08:45")).toMatchObject({ recording_stored: true, text: null });
    expect(rows.filter((r) => r.recording_stored === false)).toHaveLength(1);
    expect(data.reminder_recordings_unregistered).toBe(1);
    // nothing of his: not his folder, not a path, not his stand-in clip, not his id; and not her own id either
    for (const secret of [prefix, "audio_path", "reminders/", "不是她录的", s.him.userId, s.her.userId, tag]) expect(file.json).not.toContain(secret);

    // his own export is unchanged by this: her reminders are his files, with links; he recorded none for anyone
    const his = await buildExport(stores(s, s.him), whoOf(s.him), { nowMs: Date.now(), realNowMs: Date.now() });
    expect((his.data as { counts: Record<string, number> }).counts).toMatchObject({ reminders_recorded: 0, reminder_clips: 5 });
    expect((his.data as { reminder_recordings_unregistered: number }).reminder_recordings_unregistered).toBe(0);

    // after she leaves, what she recorded is still hers to export (the link row stays, revoked)
    const left = await s.store.revokeLink(s.linkId, s.her.userId, "family");
    expect(left.ok).toBe(true);
    const after = await buildExport(stores(s, s.her), whoOf(s.her), { nowMs: Date.now(), realNowMs: Date.now() });
    expect((after.data as { counts: Record<string, number> }).counts.reminders_recorded).toBe(4);

    // once he deletes his account there is nothing of hers left there
    await s.store.deleteAccount(s.him.userId);
    const gone = await buildExport(stores(s, s.her), whoOf(s.her), { nowMs: Date.now(), realNowMs: Date.now() });
    expect((gone.data as { counts: Record<string, number> }).counts).toMatchObject({ reminders_recorded: 0, links_as_family: 0 });
  });
});

describe("runExport: three a day", () => {
  it("three on his day, the fourth is 429 until his midnight, the next day starts again; each export is an account event", async () => {
    const s = await setup();
    const clock = () => ({ nowMs: s.nowMs(), realNowMs: Date.now() });
    for (let i = 1; i <= 3; i++) {
      const r = await runExport(stores(s, s.him), whoOf(s.him), clock());
      expect(r).toMatchObject({ ok: true, left: 3 - i });
    }
    const fourth = await runExport(stores(s, s.him), whoOf(s.him), clock());
    expect(fourth).toEqual({ ok: false, status: 429, error: "export_limit", until: "2026-10-10T16:00:00.000Z" });
    expect(await exportAllowance(s.store, { userId: s.him.userId, scope: s.him.scope }, clock())).toMatchObject({ day: "2026-10-10", used: 3, left: 0 });
    const events = (await s.store.listAccountEvents(s.him.userId)).filter((e) => e.kind === "export");
    expect(events).toHaveLength(3);
    expect(events[0].detail).toMatchObject({ files: 4 });
    expect(JSON.stringify(events)).not.toContain("我今天好累");

    s.setNow("2026-10-10T16:30:00.000Z"); // 00:30 on 10-11 in Singapore
    expect(await runExport(stores(s, s.him), whoOf(s.him), clock())).toMatchObject({ ok: true, left: 2 });
  });
});
