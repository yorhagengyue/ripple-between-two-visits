/**
 * The retention pass (lib/privacy/retention.ts; real-app 8.9 单元 privacy/retention; journey 15; C2 track H), on the
 * memory store and the local blob driver in a temporary folder:
 *   - a recording 91 days after its visit goes (its files, its paths, audio_deleted_at), the transcript stays
 *   - a visit kept for good keeps everything; a visit inside its 90 days only gets retain_until written
 *   - a stand-in clip (fixtures, 代录音) is never his and is left as it is; another account's files are never touched
 *   - safety events past 90 days go; the example-account idle rule counts real time and never takes a filming account
 * And the job itself through the runner (privacy.retention), with ops_run counts only.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobPrefix, createLocalBlobStore, type LocalBlobStore } from "@/lib/blob";
import { exampleIdle, idleExampleAccounts, lastUsedMs, recordingDue, recordingState, retainScope, retainUntil } from "@/lib/privacy/retention";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "@/lib/subject/resolve";
import { encodeWav } from "@/lib/visit/wav";

const DAY = 86_400_000;
const wav = () => encodeWav(new Int16Array(1600));

let dir: string;
let blob: LocalBlobStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-retention-"));
  blob = createLocalBlobStore({ dir });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface World {
  store: MemoryStore;
  scope: SessionRow;
  setNow(iso: string): void;
}

async function world(startIso = "2026-08-24T02:00:00.000Z"): Promise<World> {
  let now = new Date(startIso);
  const store = new MemoryStore({ now: () => now });
  const uid = randomUUID();
  const scope = await store.createAccountScope({ user_id: uid, d0: "2026-08-24" });
  return { store, scope, setNow: (iso) => (now = new Date(iso)) };
}

/** A recorded visit on `date`: the whole recording and two sentence clips in his folder, one stand-in clip. */
async function recordedVisit(store: Store, scope: SessionRow, id: string, date: string, opts: { keep?: boolean } = {}) {
  const prefix = blobPrefix(scope);
  const recording = `${prefix}/visits/${id}/recording-${randomUUID()}.wav`;
  await blob.putObject("audio", recording, wav(), "audio/wav");
  await store.upsertVisit(scope.id, { id, kind: "follow_up", place: "Blossom Family Clinic", day: 0, date, status: "review", audio_path: recording, ...(opts.keep ? { keep_forever: true } : {}) });
  const clips: string[] = [];
  for (const n of [1, 2]) {
    const p = `${prefix}/visits/${id}/segments/${id}-u0${n}.wav`;
    await blob.putObject("audio", p, wav(), "audio/wav");
    clips.push(p);
  }
  await store.addUtterances(scope.id, id, [
    { id: `${id}-u01`, t_start_ms: 0, t_end_ms: 1000, text: "Mr Tan, your blood pressure today is 152 over 94.", clip_path: clips[0], role: "doctor", role_state: "confirmed" },
    { id: `${id}-u02`, t_start_ms: 1000, t_end_ms: 2000, text: "Keep measuring, twice a week is enough now.", clip_path: clips[1], role: "doctor", role_state: "confirmed" },
    { id: `${id}-u03`, t_start_ms: 2000, t_end_ms: 3000, text: "At home, we want it below 135 over 85.", clip_path: "visits/clips/v1-u08.wav", role: "doctor", role_state: "confirmed" },
  ]);
  return { recording, clips };
}

async function exists(p: string): Promise<boolean> {
  return (await blob.getObject("audio", p)) !== null;
}

describe("retention policy", () => {
  it("retain_until is the visit date + 90 days unless stamped; due only after that day, never when kept or busy", () => {
    expect(retainUntil({ date: "2026-08-24", retain_until: null })).toBe("2026-11-22");
    expect(retainUntil({ date: "2026-08-24", retain_until: "2027-01-01" })).toBe("2027-01-01");
    const v = { id: "v", session_id: "", kind: "follow_up", place: "", day: 0, date: "2026-08-24", consent_utterance_id: null, status: "review", audio_path: "x", script_section: null, audio_fixture: null, created_at: "" } as const;
    expect(recordingDue({ ...v }, "2026-11-22")).toBe(false);
    expect(recordingDue({ ...v }, "2026-11-23")).toBe(true);
    expect(recordingDue({ ...v, keep_forever: true }, "2027-05-01")).toBe(false);
    expect(recordingDue({ ...v, status: "transcribing" }, "2027-05-01")).toBe(false);
    expect(recordingDue({ ...v, status: "awaiting_transcript" }, "2027-05-01")).toBe(true);
    expect(recordingDue({ ...v, audio_deleted_at: "2026-11-23T00:00:00.000Z" }, "2027-05-01")).toBe(false);
  });

  it("idle example accounts: 30 days of real time since the last sign-in or refresh; never a filming account or a plain one", () => {
    const now = Date.parse("2026-12-01T00:00:00.000Z");
    const example = { kind: "account" as const, example_data: true, filming: false };
    expect(exampleIdle(example, now - 31 * DAY, now)).toBe(true);
    expect(exampleIdle(example, now - 29 * DAY, now)).toBe(false);
    expect(exampleIdle({ ...example, filming: true }, now - 300 * DAY, now)).toBe(false);
    expect(exampleIdle({ ...example, example_data: false }, now - 300 * DAY, now)).toBe(false);
    expect(exampleIdle(example, null, now)).toBe(false);
    expect(lastUsedMs([null, "2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z", undefined])).toBe(Date.parse("2026-10-05T00:00:00.000Z"));
  });
});

describe("retainScope", () => {
  it("91 days on: the recording and its clips go, the transcript stays; the kept visit and the recent one are untouched", async () => {
    const w = await world();
    const old = await recordedVisit(w.store, w.scope, "v-old", "2026-08-24");
    const kept = await recordedVisit(w.store, w.scope, "v-kept", "2026-08-24", { keep: true });
    w.setNow("2026-09-01T02:00:00.000Z");
    const recent = await recordedVisit(w.store, w.scope, "v-recent", "2026-09-01");
    // the other account's identical layout must never be touched
    const other = await world();
    const theirs = await recordedVisit(other.store, other.scope, "v-old", "2026-08-24");

    w.setNow("2026-11-23T02:00:00.000Z"); // Singapore 11-23: one day past v-old's 2026-11-22
    const s = systemSubject(w.store, w.scope);
    const counts = await retainScope(s.store, s.scope, { blob, nowMs: Date.parse("2026-11-23T02:00:00.000Z") });
    expect(counts).toMatchObject({ visits: 1, files: 3, clips: 2, safety: 0 });
    expect(counts.stamped).toBe(2); // v-recent and v-kept got their retain_until (his review page shows it; un-keeping uses it)

    const gone = (await w.store.getVisit(w.scope.id, "v-old"))!;
    expect(gone).toMatchObject({ audio_path: null, retain_until: "2026-11-22", audio_deleted_at: "2026-11-23T02:00:00.000Z" });
    const lines = await w.store.listUtterances(w.scope.id, "v-old");
    expect(lines.map((u) => u.text)).toHaveLength(3); // the transcript stays
    expect(lines.map((u) => u.clip_path)).toEqual([null, null, "visits/clips/v1-u08.wav"]); // the stand-in is not his
    expect(await exists(old.recording)).toBe(false);
    for (const c of old.clips) expect(await exists(c)).toBe(false);
    expect(recordingState(w.scope, gone, lines)).toEqual({ kind: "deleted", on: "2026-11-23", until: "2026-11-22" });

    const keptRow = (await w.store.getVisit(w.scope.id, "v-kept"))!;
    expect(keptRow.audio_path).toBe(kept.recording);
    expect(keptRow.audio_deleted_at ?? null).toBeNull();
    expect(await exists(kept.recording)).toBe(true);
    expect(recordingState(w.scope, keptRow, await w.store.listUtterances(w.scope.id, "v-kept"))).toEqual({ kind: "kept_forever" });

    const recentRow = (await w.store.getVisit(w.scope.id, "v-recent"))!;
    expect(recentRow).toMatchObject({ audio_path: recent.recording, retain_until: "2026-11-30" });
    expect(await exists(recent.recording)).toBe(true);

    expect(await exists(theirs.recording)).toBe(true);

    // a second pass finds nothing more to do
    const again = await retainScope(s.store, s.scope, { blob, nowMs: Date.parse("2026-11-23T03:00:00.000Z") });
    expect(again).toMatchObject({ visits: 0, files: 0, clips: 0, stamped: 0 });
  });

  it("a visit with neither recording nor clips of his is left alone, and is not called deleted", async () => {
    const w = await world();
    await w.store.upsertVisit(w.scope.id, { id: "v-text", kind: "follow_up", place: "", day: 0, date: "2026-08-24", status: "confirmed" });
    await w.store.addUtterances(w.scope.id, "v-text", [{ id: "v-text-u01", t_start_ms: 0, t_end_ms: 1, text: "Sure.", clip_path: "visits/clips/v1-u08.wav" }]);
    const s = systemSubject(w.store, w.scope);
    const counts = await retainScope(s.store, s.scope, { blob, nowMs: Date.parse("2027-01-01T00:00:00.000Z") });
    expect(counts.visits).toBe(0);
    const v = (await w.store.getVisit(w.scope.id, "v-text"))!;
    expect(v.audio_deleted_at ?? null).toBeNull();
    expect(recordingState(w.scope, v, await w.store.listUtterances(w.scope.id, "v-text"))).toEqual({ kind: "none" });
  });

  it("safety events older than 90 days go, newer ones stay", async () => {
    const w = await world("2026-08-01T00:00:00.000Z");
    await w.store.addSafetyEvent(w.scope.id, { input: "old words", route: "explain" });
    w.setNow("2026-10-01T00:00:00.000Z");
    const recent = await w.store.addSafetyEvent(w.scope.id, { input: "newer words", route: "explain" });
    const s = systemSubject(w.store, w.scope);
    const counts = await retainScope(s.store, s.scope, { blob, nowMs: Date.parse("2026-11-01T00:00:00.000Z") });
    expect(counts.safety).toBe(1);
    expect((await w.store.listSafetyEvents(w.scope.id)).map((e) => e.id)).toEqual([recent.id]);
  });

  it("idleExampleAccounts: the account's last sign-in and its sessions' refreshes, against real time", async () => {
    const store = new MemoryStore();
    const fresh = randomUUID();
    const stale = randomUUID();
    const filming = randomUUID();
    const plain = randomUUID();
    for (const [id, example] of [
      [fresh, true],
      [stale, true],
      [filming, true],
      [plain, false],
    ] as const) {
      await store.createAccount({ user_id: id, login_kind: "username", username: `u${id.slice(0, 8)}` });
      await store.createAccountScope({ user_id: id, d0: "2026-08-24", example_data: example });
      await store.updateAccount(id, { last_seen_at: "2026-09-01T00:00:00.000Z" });
    }
    await store.setFilmingAccount(filming, true);
    const now = Date.parse("2026-10-10T00:00:00.000Z");
    const auth = {
      listSessions: async (userId: string) =>
        userId === fresh ? [{ session_id: "s", user_id: fresh, device_hash: null, device_label: null, ephemeral: false, created_at: "2026-09-01T00:00:00.000Z", last_seen_at: "2026-10-09T00:00:00.000Z", ended_at: null, ended_reason: null }] : [],
    };
    expect(await idleExampleAccounts(store, auth, now)).toEqual([stale]);
  });
});
