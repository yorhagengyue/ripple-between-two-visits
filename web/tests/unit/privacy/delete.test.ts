/**
 * Deleting an account (lib/privacy/delete.ts; real-app 3.11 删除账号, 8.9; journey 15; C2 track H), on the memory store,
 * the memory identity provider and the local blob driver in a temporary folder:
 *   - storage first and empty when asked again: his recording, his label photo and the reminder she recorded for him
 *   - her link ends at once (revoked, care_link.revoked on his channel), a link where he is the family member is left
 *     and then goes with him; her own account stays; her reminder for someone else keeps its row without her id
 *   - his sessions end (the token stops working), the identity goes (no sign-in, no lookup), zero rows anywhere:
 *     every column that can hold his id is counted (store.countAccountRows), his sign-in sessions, his channel's
 *     history and both storage folders too; a file that lands while the deletion runs is found and removed; rows a
 *     store fails to delete are deleted once more, and what still stays is reported as leftover (counts, no ids)
 *   - a family member's recordings in his folder (her tag in the file name): the registered ones stay with him, one
 *     she uploaded and never saved goes with her account
 *   - a storage that will not empty: 503 storage_not_empty and nothing else changed; an identity that cannot be deleted:
 *     503 identity_failed after storage and links
 *   - the password check: wrong, then locked after five; right
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryAuthProvider, type AuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { newDeviceId } from "@/lib/auth/device";
import { tokenClaims } from "@/lib/auth/jwt";
import type { Me, RequestFacts } from "@/lib/auth/service";
import { BLOB_BUCKETS, blobPrefix, blobUserTag, createLocalBlobStore, type BlobStore, type LocalBlobStore } from "@/lib/blob";
import { getBus, publish } from "@/lib/bus";
import { logLook } from "@/lib/care/access-log";
import { confirmPassword, deleteAccountEverywhere, remainingRows } from "@/lib/privacy/delete";
import { MemoryStore } from "@/lib/store/memory";
import { careEntryStore } from "@/lib/subject/care";
import { familySubject } from "@/lib/subject/resolve";
import { encodeWav } from "@/lib/visit/wav";

const PASSWORD = "a long test password";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);

let dir: string;
let blob: LocalBlobStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-delete-"));
  blob = createLocalBlobStore({ dir });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function link(store: MemoryStore, patient: TestAccount, family: TestAccount, label: string) {
  const hash = createHash("sha256").update(randomBytes(16)).digest("hex");
  const invited = await store.createInvite({ patient_id: patient.userId, relation: "daughter", family_label: label, invite_token_hash: hash, invite_expires_at: "2099-01-01T00:00:00.000Z" }, { dose_summary: true });
  if (!invited.ok) throw new Error(invited.code);
  const accepted = await store.acceptInvite(hash, family.userId, label);
  if (!accepted.ok) throw new Error(accepted.code);
  const confirmed = await store.confirmLink(accepted.link.id, patient.userId, true);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.link;
}

interface Family {
  store: MemoryStore;
  auth: AuthProvider;
  him: TestAccount;
  her: TestAccount;
  aunt: TestAccount;
  files: { recording: string; photo: string; herClip: string };
  hisLinkId: string;
  auntLinkId: string;
}

/** Mr Tan with a recorded visit, a label photo and Wei Ling's reminder in his folder; Wei Ling linked to him; him linked as family to an aunt. */
async function family(): Promise<Family> {
  const store = new MemoryStore();
  const auth = new MemoryAuthProvider();
  const him = await createAccountWithSpace(store, auth, { login: login("tan"), password: PASSWORD, space: "blank" });
  const her = await createAccountWithSpace(store, auth, { login: login("weiling"), password: PASSWORD, space: "none" });
  const aunt = await createAccountWithSpace(store, auth, { login: login("mei"), password: PASSWORD, space: "blank" });
  const scope = him.scope!;
  const prefix = blobPrefix(scope);
  const recording = `${prefix}/visits/v-1/recording-${randomUUID()}.wav`;
  const photo = `${prefix}/labels/${randomUUID()}.png`;
  const herClip = `${prefix}/reminders/${blobUserTag(her.userId)}-${randomUUID()}.wav`; // her tag in the file name
  await blob.putObject("audio", recording, encodeWav(new Int16Array(800)), "audio/wav");
  await blob.putObject("labels", photo, PNG, "image/png");
  await blob.putObject("audio", herClip, encodeWav(new Int16Array(800)), "audio/wav");
  await store.upsertVisit(scope.id, { id: "v-1", kind: "follow_up", place: "Blossom Family Clinic", day: 0, status: "review", audio_path: recording });
  await store.addUtterances(scope.id, "v-1", [{ id: "v-1-u01", t_start_ms: 0, t_end_ms: 900, text: "Please don't change the dose yourself." }]);
  await store.upsertMed(scope.id, { id: "med-a", origin: "prescription", status: "label_confirmed", drug_id: "amlodipine", label: { text: "AMLODIPINE 5MG TABLET", photo_path: photo } });
  await store.addSafetyEvent(scope.id, { input: "我今天好累。", route: "log_only" });
  const hisLink = await link(store, him, her, "Wei Ling");
  await store.addReminderClip(scope.id, { by: hisLink.id, plays_at: "after_breakfast", audio_path: herClip, by_user_id: her.userId, by_label: "Wei Ling", link_id: hisLink.id });
  await logLook(familySubject(store, scope, her.userId, hisLink).store, scope.id, { linkId: hisLink.id, userId: her.userId, label: "Wei Ling", route: "/f", items: ["dose_summary"] }, Date.now());
  // him as the family member of an aunt, with a reminder he recorded for her (kept without his id when he goes)
  const auntLink = await link(store, aunt, him, "Ah Tan");
  await store.addReminderClip(aunt.scope!.id, { by: auntLink.id, plays_at: "after_breakfast", audio_path: null, by_user_id: him.userId, by_label: "Ah Tan", link_id: auntLink.id });
  return { store, auth, him, her, aunt, files: { recording, photo, herClip }, hisLinkId: hisLink.id, auntLinkId: auntLink.id };
}

async function stored(bucket: "audio" | "labels", p: string) {
  return (await blob.getObject(bucket, p)) !== null;
}

describe("deleteAccountEverywhere", () => {
  it("storage first, her link ended, his sessions and identity gone, zero rows; her own account and the aunt's records stay", async () => {
    const f = await family();
    const scopeId = f.him.scope!.id;
    const sessionId = tokenClaims(f.him.tokens.access_token).sessionId;
    expect(await f.auth.sessionAlive!(sessionId)).toBe(true);
    publish(scopeId, "note.logged", "Note: a line he typed", { note: { text: "我今天好累。" } });
    expect(getBus().recent(scopeId).length).toBeGreaterThan(0);
    // what is there before: rows in many tables, his channel's history, files in both buckets
    const before = await remainingRows({ store: f.store, auth: f.auth, blob }, { userId: f.him.userId, scope: f.him.scope });
    expect(before).toMatchObject({ "account.user_id": 1, "session.id": 1, "visit.session_id": 1, "care_link.patient_id": 1, "care_link.family_id": 1, "reminder_clip.by_user_id": 1, "storage.audio": 2, "storage.labels": 1 });
    expect(before["bus_event.session_id"]).toBeGreaterThan(0);
    expect(before["account_session.user_id"]).toBeGreaterThanOrEqual(1);
    // her open stream, listening on his channel while he deletes
    const heard: string[] = [];
    const stop = getBus().subscribe(scopeId, (e) => heard.push(e.type));

    const r = await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob, care: careEntryStore(f.store) }, f.him.userId, { reason: "user" });
    stop();
    expect(r).toMatchObject({ ok: true, counts: { files: 3, files_late: 0, her_files_removed: 0, her_clips_kept: 0, links_revoked: 1, links_left: 1, leftover: 0 } });
    if (!r.ok) throw new Error("not ok");
    expect(r.counts.sessions).toBeGreaterThanOrEqual(1);
    expect(r.leftover).toEqual({});

    // storage: his folder is empty in both buckets, her reminder for him included
    for (const p of [f.files.recording, f.files.herClip]) expect(await stored("audio", p)).toBe(false);
    expect(await stored("labels", f.files.photo)).toBe(false);
    for (const bucket of BLOB_BUCKETS) expect(await blob.removePrefix(bucket, blobPrefix(f.him.scope!))).toBe(0);

    // the identity: the old token's session is over, no sign-in, no lookup
    expect(await f.auth.sessionAlive!(sessionId)).toBe(false);
    expect(await f.auth.checkPassword(f.him.login.email, PASSWORD)).toBe(false);
    expect(await f.auth.findUserIdByEmail(f.him.login.email)).toBeNull();

    // zero rows by his id and his scope
    expect(await remainingRows({ store: f.store, auth: f.auth, blob }, { userId: f.him.userId, scope: f.him.scope })).toEqual({});
    expect(await f.store.countAccountRows(f.him.userId)).toEqual({});

    // her link ended with an event on his channel while her stream was open (her page and stream close on it); after
    // the deletion his channel keeps no history at all
    expect(heard).toEqual(["care_link.revoked"]);
    expect(getBus().recent(scopeId)).toEqual([]);
    // her account is untouched, and nothing links her to him any more
    expect(await f.store.getAccount(f.her.userId)).not.toBeNull();
    expect(await f.store.listCareLinks({ family_id: f.her.userId })).toEqual([]);
    // the aunt keeps her records; his reminder for her stays, without his id
    const auntClips = await f.store.listReminderClips(f.aunt.scope!.id);
    expect(auntClips).toHaveLength(1);
    expect(auntClips[0].by_user_id ?? null).toBeNull();
    expect(auntClips[0].by_label).toBe("Ah Tan");
    expect(await f.store.listCareLinks({ patient_id: f.aunt.userId })).toEqual([]);

    // one ops_run row, counts only
    const runs = await f.store.listOpsRuns("delete_account");
    expect(runs).toHaveLength(1);
    expect(JSON.stringify(runs[0])).not.toContain(f.him.userId);
    expect(runs[0].counts).toMatchObject({ files: 3, links_revoked: 1, links_left: 1, leftover: 0, idle_example: 0, with_space: 1 });
  });

  it("a storage that will not empty: 503 storage_not_empty, and nothing else changed", async () => {
    const f = await family();
    // the storage says it removed the files, and they are still there when the folders are listed again
    const stubborn = stub(blob, { removePrefix: async () => 3 });
    const r = await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob: stubborn }, f.him.userId, { reason: "user" });
    expect(r).toEqual({ ok: false, status: 503, error: "storage_not_empty" });
    // a storage that does not answer: 503 storage_failed, the same way
    const down = stub(blob, { removePrefix: async () => Promise.reject(new Error("down")) });
    expect(await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob: down }, f.him.userId, { reason: "user" })).toEqual({ ok: false, status: 503, error: "storage_failed" });
    expect(await stored("audio", f.files.recording)).toBe(true);
    expect(await f.store.getAccount(f.him.userId)).not.toBeNull();
    expect((await f.store.getCareLink(f.hisLinkId))?.status).toBe("active");
    expect(await f.auth.sessionAlive!(tokenClaims(f.him.tokens.access_token).sessionId)).toBe(true);
    expect(await f.auth.checkPassword(f.him.login.email, PASSWORD)).toBe(true);
  });

  it("an identity that cannot be deleted: 503 identity_failed after storage and links; trying again finishes it", async () => {
    const f = await family();
    const failing: AuthProvider = Object.assign(Object.create(Object.getPrototypeOf(f.auth)) as AuthProvider, f.auth, {
      deleteUser: async () => {
        throw new Error("down");
      },
    });
    const r = await deleteAccountEverywhere({ store: f.store, auth: failing, blob }, f.him.userId, { reason: "user" });
    expect(r).toEqual({ ok: false, status: 503, error: "identity_failed" });
    expect(await stored("audio", f.files.recording)).toBe(false);
    expect((await f.store.getCareLink(f.hisLinkId))?.status).toBe("revoked");
    expect(await f.store.getAccount(f.him.userId)).not.toBeNull();
    const again = await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob }, f.him.userId, { reason: "user" });
    expect(again).toMatchObject({ ok: true, counts: { files: 0, leftover: 0 } });
    expect(await f.store.getAccount(f.him.userId)).toBeNull();
  });

  it("a family member without a space: her links are left, her account goes, his records stay with her label", async () => {
    const f = await family();
    const r = await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob }, f.her.userId, { reason: "user" });
    expect(r).toMatchObject({ ok: true, counts: { files: 0, links_left: 1, links_revoked: 0, leftover: 0, her_clips_kept: 1, her_files_removed: 0 } });
    expect(await f.store.getAccount(f.her.userId)).toBeNull();
    expect(await f.store.countAccountRows(f.her.userId)).toEqual({});
    const clips = await f.store.listReminderClips(f.him.scope!.id);
    expect(clips[0]).toMatchObject({ by_label: "Wei Ling" });
    expect(clips[0].by_user_id ?? null).toBeNull();
    expect(await stored("audio", f.files.herClip)).toBe(true); // her reminder is in his folder: his to keep
    const log = await f.store.listCareAccessLog(f.him.scope!.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ family_label: "Wei Ling", family_user_id: null });
  });

  it("her recordings are found by her tag: one she never saved goes with her account, the registered one and other people's files stay", async () => {
    const f = await family();
    const prefix = blobPrefix(f.him.scope!);
    const neverSaved = `${prefix}/reminders/${blobUserTag(f.her.userId)}-${randomUUID()}.wav`;
    const someoneElses = `${prefix}/reminders/${blobUserTag(f.aunt.userId)}-${randomUUID()}.wav`;
    const noTag = `${prefix}/reminders/${randomUUID()}.wav`;
    for (const p of [neverSaved, someoneElses, noTag]) await blob.putObject("audio", p, encodeWav(new Int16Array(800)), "audio/wav");
    const r = await deleteAccountEverywhere({ store: f.store, auth: f.auth, blob }, f.her.userId, { reason: "user" });
    expect(r).toMatchObject({ ok: true, counts: { her_files_removed: 1, her_clips_kept: 1, files: 0, leftover: 0 } });
    expect(await stored("audio", neverSaved)).toBe(false);
    expect(await stored("audio", f.files.herClip)).toBe(true);
    expect(await stored("audio", someoneElses)).toBe(true);
    expect(await stored("audio", noTag)).toBe(true);
    expect(await stored("audio", f.files.recording)).toBe(true);
    const run = (await f.store.listOpsRuns("delete_account"))[0];
    expect(run.counts).toMatchObject({ her_files_removed: 1, her_clips_kept: 1, with_space: 0 });
    expect(JSON.stringify(run)).not.toContain(f.her.userId);
    expect(JSON.stringify(run)).not.toContain(prefix);
  });

  it("a file that lands in his folder while the deletion runs is found at the last check and removed", async () => {
    const f = await family();
    const prefix = blobPrefix(f.him.scope!);
    const late = `${prefix}/visits/v-1/segments/late-${randomUUID()}.wav`;
    // an upload link issued before the deletion is used between step 1 and the last check
    const auth: AuthProvider = Object.assign(Object.create(Object.getPrototypeOf(f.auth)) as AuthProvider, f.auth, {
      deleteUser: async (id: string) => {
        await blob.putObject("audio", late, encodeWav(new Int16Array(800)), "audio/wav");
        return f.auth.deleteUser(id);
      },
    });
    const r = await deleteAccountEverywhere({ store: f.store, auth, blob }, f.him.userId, { reason: "user" });
    expect(r).toMatchObject({ ok: true, counts: { files: 3, files_late: 1, leftover: 0 }, leftover: {} });
    expect(await stored("audio", late)).toBe(false);
    for (const bucket of BLOB_BUCKETS) expect(await blob.listFiles(bucket, prefix)).toEqual([]);
  });

  it("rows a store leaves behind are deleted once more; what still stays is reported as leftover, by table, without an id", async () => {
    const f = await family();
    // the first deleteAccount does nothing (a failed cascade); the second one works
    let calls = 0;
    const flaky = new Proxy(f.store, {
      get(target, prop, receiver) {
        if (prop === "deleteAccount") return async (id: string) => (++calls === 1 ? undefined : target.deleteAccount(id));
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const ok = await deleteAccountEverywhere({ store: flaky, auth: f.auth, blob }, f.him.userId, { reason: "user" });
    expect(calls).toBe(2);
    expect(ok).toMatchObject({ ok: true, counts: { leftover: 0 }, leftover: {} });

    // a store that never deletes: the answer still says deleted (his identity is gone), with what is left counted
    const g = await family();
    const broken = new Proxy(g.store, {
      get(target, prop, receiver) {
        if (prop === "deleteAccount") return async () => undefined;
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const r = await deleteAccountEverywhere({ store: broken, auth: g.auth, blob }, g.him.userId, { reason: "user" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("not ok");
    expect(r.counts.leftover).toBeGreaterThan(5);
    expect(r.leftover).toMatchObject({ "account.user_id": 1, "session.id": 1, "visit.session_id": 1, "safety_event.session_id": 1 });
    expect(Object.keys(r.leftover).some((k) => k.startsWith("storage."))).toBe(false);
    const run = (await g.store.listOpsRuns("delete_account")).at(-1)!;
    expect(run.counts.leftover).toBe(r.counts.leftover);
    expect(JSON.stringify(run)).not.toContain(g.him.userId);
  });
});

/** The blob store with some methods replaced (the rest are the real ones). */
function stub(real: BlobStore, over: Partial<BlobStore>): BlobStore {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop in over) return (over as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("confirmPassword", () => {
  const facts = (): RequestFacts => ({ ip: "local", deviceId: newDeviceId(), knownDevice: true, userAgent: null });
  const meOf = (a: TestAccount): Me => ({ userId: a.userId, sessionId: null, account: a.account, email: null, ephemeral: false });

  // C2 track A (follow-up): the lockout's rule is the design's, 「第 6 次失败锁这一台」: five wrong ones are answered, the sixth locks
  it("wrong is 401 wrong_password, the sixth wrong locks the device (423 with until), the right one passes elsewhere", async () => {
    const f = await family();
    const device = facts();
    for (let i = 1; i <= 5; i++) expect(await confirmPassword(f, meOf(f.him), "not it", device)).toEqual({ ok: false, status: 401, error: "wrong_password" });
    const locked = await confirmPassword(f, meOf(f.him), "not it", device);
    expect(locked).toMatchObject({ ok: false, status: 423, error: "locked" });
    expect(await confirmPassword(f, meOf(f.him), PASSWORD, device)).toMatchObject({ ok: false, status: 423 });
    expect(await confirmPassword(f, meOf(f.him), PASSWORD, facts())).toEqual({ ok: true });
  });
});
