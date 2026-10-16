/**
 * A visit whose recording is several files (C2 track R; lib/visit/recording.ts, migration 0017) in his data's own
 * rules (lib/privacy; C2 track H), on the memory store and the local blob driver in a temporary folder:
 *   - his export lists every part, in order, each with its link and which part of how many it is; a recording in one
 *     file is listed exactly as before
 *   - the retention pass removes every part with the visit's folder and clears the list; inside its days it only stamps
 *   - the orphan sweep never takes a part while its visit lives, also while later parts are still arriving; a file in
 *     the same folder that no row points at goes after two days; once the visit's row is gone, every part goes
 *   - deleting the account leaves no part behind
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { BLOB_BUCKETS, blobPrefix, createLocalBlobStore, type LocalBlobStore } from "@/lib/blob";
import { deleteAccountEverywhere, remainingRows } from "@/lib/privacy/delete";
import { buildExport, type ExportStores, type ExportWho } from "@/lib/privacy/export";
import { ownedAudio, recordingState, retainScope } from "@/lib/privacy/retention";
import { referencedPaths, sweepOrphans } from "@/lib/privacy/sweep";
import { MemoryStore } from "@/lib/store/memory";
import { careEntryStore } from "@/lib/subject/care";
import { selfSubject, systemSubject } from "@/lib/subject/resolve";
import { encodeWav } from "@/lib/visit/wav";

const PASSWORD = "a long test password";
const DAY = 86_400_000;
const wav = () => encodeWav(new Int16Array(1600));

let dir: string;
let blob: LocalBlobStore;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-r-privacy-"));
  blob = createLocalBlobStore({ dir });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface World {
  store: MemoryStore;
  auth: MemoryAuthProvider;
  him: TestAccount;
  prefix: string;
  setNow(iso: string): void;
  nowMs(): number;
}

async function world(startIso = "2026-08-24T02:00:00.000Z"): Promise<World> {
  let now = new Date(startIso);
  const store = new MemoryStore({ now: () => now });
  const auth = new MemoryAuthProvider();
  const him = await createAccountWithSpace(store, auth, { login: `tan${randomUUID().replace(/-/g, "").slice(0, 10)}`, password: PASSWORD, space: "blank", today: startIso.slice(0, 10) }, { nowMs: now.getTime() });
  return { store, auth, him, prefix: blobPrefix(him.scope!), setNow: (iso) => (now = new Date(iso)), nowMs: () => now.getTime() };
}

/** A file in his visit's folder, last written `ageDays` ago (the sweep's grace period looks at that). */
async function put(p: string, ageDays = 0): Promise<string> {
  await blob.putObject("audio", p, wav(), "audio/wav");
  if (ageDays > 0) {
    const at = new Date(Date.now() - ageDays * DAY);
    await utimes(path.join(dir, "audio", ...p.split("/")), at, at);
  }
  return p;
}

const stored = async (p: string) => (await blob.getObject("audio", p)) !== null;

/** A visit recorded in three parts (the whole recording is on the server), two sentence clips, one of them across a cut. */
async function longVisit(w: World, id: string, date: string, opts: { ageDays?: number; complete?: boolean } = {}) {
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) parts.push(await put(`${w.prefix}/visits/${id}/recording-${randomUUID()}.wav`, opts.ageDays));
  const complete = opts.complete !== false;
  await w.store.upsertVisit(w.him.scope!.id, {
    id,
    kind: "clinic",
    place: "Blossom Family Clinic",
    day: 0,
    date,
    status: complete ? "review" : "recording",
    audio_path: complete ? parts[0] : null,
    audio_parts: parts.map((p) => ({ path: p, ms: 100 })),
  });
  const clips: string[] = [];
  if (complete) {
    for (const n of [1, 2]) clips.push(await put(`${w.prefix}/visits/${id}/segments/${id}-u0${n}.wav`, opts.ageDays));
    await w.store.addUtterances(w.him.scope!.id, id, [
      { id: `${id}-u01`, t_start_ms: 0, t_end_ms: 90, text: "Mr Tan, your blood pressure today is 152 over 94.", clip_path: clips[0], role: "doctor", role_state: "confirmed" },
      { id: `${id}-u02`, t_start_ms: 90, t_end_ms: 180, text: "Keep measuring, twice a week is enough now.", clip_path: clips[1], role: "doctor", role_state: "confirmed" },
    ]);
  }
  return { parts, clips };
}

function exportStores(w: World): ExportStores {
  return { own: selfSubject(w.store, w.him.scope!, w.him.userId).store, admin: w.store, auth: w.auth, blob };
}
function who(w: World): ExportWho {
  const a = w.him;
  return { userId: a.userId, account: a.account, scope: a.scope, login: a.login.kind === "username" ? a.login.username : a.login.email, origin: "http://localhost:3620" };
}

describe("his export", () => {
  it("lists every part of a long recording, in order, each with a link; a recording in one file is listed as before", async () => {
    const w = await world();
    const long = await longVisit(w, "v-long", "2026-08-24");
    const single = await put(`${w.prefix}/visits/v-short/recording-${randomUUID()}.wav`);
    await w.store.upsertVisit(w.him.scope!.id, { id: "v-short", kind: "clinic", place: "Clinic", day: 0, status: "review", audio_path: single });
    // a visit whose upload stopped after two parts: what did arrive is his too
    const partial = await longVisit(w, "v-partial", "2026-08-24", { complete: false });

    const file = await buildExport(exportStores(w), who(w), { nowMs: w.nowMs(), realNowMs: w.nowMs() });
    const data = JSON.parse(file.json) as { files: { kind: string; path: string; visit_id?: string; part?: number; parts?: number; url: string | null }[]; tables: Record<string, Record<string, unknown>[]> };
    const recordings = data.files.filter((f) => f.kind === "visit_recording");
    expect(recordings.filter((f) => f.visit_id === "v-long").map((f) => [f.path, f.part, f.parts])).toEqual(long.parts.map((p, i) => [p, i + 1, 3]));
    expect(recordings.filter((f) => f.visit_id === "v-partial").map((f) => [f.path, f.part, f.parts])).toEqual(partial.parts.map((p, i) => [p, i + 1, 3]));
    // one file: no part numbers, as before
    const short = recordings.filter((f) => f.visit_id === "v-short");
    expect(short).toHaveLength(1);
    expect(short[0].path).toBe(single);
    expect("part" in short[0] || "parts" in short[0]).toBe(false);
    // every listed file has its link
    expect(recordings.every((f) => typeof f.url === "string" && f.url.length > 0)).toBe(true);
    expect(data.files.filter((f) => f.kind === "sentence_clip").map((f) => f.path).sort()).toEqual([...long.clips].sort());
    // the visit's own row carries the list too
    const row = data.tables.visits.find((v) => v.id === "v-long")!;
    expect(row.audio_parts).toEqual(long.parts.map((p) => ({ path: p, ms: 100 })));
    expect("audio_parts" in data.tables.visits.find((v) => v.id === "v-short")!).toBe(false);
  });
});

describe("the retention pass", () => {
  it("inside its days a long recording is only stamped; after them every part and clip goes and the list is cleared", async () => {
    const w = await world("2026-08-24T02:00:00.000Z");
    const scope = w.him.scope!;
    const long = await longVisit(w, "v-long", "2026-08-24");
    const s = systemSubject(w.store, scope).store;
    expect(ownedAudio(scope, (await w.store.getVisit(scope.id, "v-long"))!, []).files).toEqual(long.parts);

    const early = await retainScope(s, scope, { blob, nowMs: Date.parse("2026-09-01T02:00:00.000Z") });
    expect(early).toMatchObject({ visits: 0, files: 0, stamped: 1 });
    for (const p of [...long.parts, ...long.clips]) expect(await stored(p), p).toBe(true);
    expect(recordingState(scope, (await w.store.getVisit(scope.id, "v-long"))!, await w.store.listUtterances(scope.id, "v-long"))).toMatchObject({ kind: "kept_until", until: "2026-11-22" });

    const late = await retainScope(s, scope, { blob, nowMs: Date.parse("2026-11-23T02:00:00.000Z") });
    expect(late).toMatchObject({ visits: 1, files: 5, clips: 2 });
    for (const p of [...long.parts, ...long.clips]) expect(await stored(p), p).toBe(false);
    const row = (await w.store.getVisit(scope.id, "v-long"))!;
    expect(row.audio_path).toBeNull();
    expect("audio_parts" in row).toBe(false);
    expect(row.audio_deleted_at).toBeTruthy();
    // the transcript stays, without its clips
    expect((await w.store.listUtterances(scope.id, "v-long")).map((u) => [u.text.length > 0, u.clip_path])).toEqual([
      [true, null],
      [true, null],
    ]);
    expect(recordingState(scope, row, [])).toMatchObject({ kind: "deleted" });
    // nothing more to do on the next pass
    expect(await retainScope(s, scope, { blob, nowMs: Date.parse("2026-11-24T02:00:00.000Z") })).toMatchObject({ visits: 0, files: 0 });
  });

  it("a visit kept for good keeps every part; the parts of an upload that never finished go with the visit's folder once it is due", async () => {
    const w = await world("2026-08-24T02:00:00.000Z");
    const scope = w.him.scope!;
    const kept = await longVisit(w, "v-kept", "2026-08-24");
    await w.store.updateVisit(scope.id, "v-kept", { keep_forever: true });
    // he ended this one from another phone: its text came from elsewhere, the parts that arrived are still listed
    const partial = await longVisit(w, "v-partial", "2026-08-24", { complete: false });
    await w.store.updateVisit(scope.id, "v-partial", { status: "review" });
    const s = systemSubject(w.store, scope).store;
    const late = await retainScope(s, scope, { blob, nowMs: Date.parse("2026-11-23T02:00:00.000Z") });
    expect(late).toMatchObject({ visits: 1, files: 3 });
    for (const p of kept.parts) expect(await stored(p), p).toBe(true);
    for (const p of partial.parts) expect(await stored(p), p).toBe(false);
    expect("audio_parts" in (await w.store.getVisit(scope.id, "v-partial"))!).toBe(false);
    expect((await w.store.getVisit(scope.id, "v-kept"))!.audio_parts).toHaveLength(3);
  });
});

describe("the orphan sweep", () => {
  it("a part is never an orphan while its visit lives, also while later parts are still arriving; a loose file beside them goes", async () => {
    const w = await world();
    const scope = w.him.scope!;
    const long = await longVisit(w, "v-long", "2026-08-24", { ageDays: 30 });
    const partial = await longVisit(w, "v-partial", "2026-08-24", { ageDays: 30, complete: false });
    // uploaded and never registered (the phone lost its connection before it could tell the server): no row points at it
    const loose = await put(`${w.prefix}/visits/v-partial/recording-${randomUUID()}.wav`, 30);
    const fresh = await put(`${w.prefix}/visits/v-partial/recording-${randomUUID()}.wav`, 0);

    const refs = await referencedPaths(w.store, scope);
    for (const p of [...long.parts, ...long.clips, ...partial.parts]) expect(refs.has(p), p).toBe(true);
    expect(refs.has(loose)).toBe(false);

    const counts = await sweepOrphans(w.store, blob, { realNowMs: Date.now() });
    expect(counts.unreferenced).toBe(1);
    for (const p of [...long.parts, ...long.clips, ...partial.parts]) expect(await stored(p), p).toBe(true);
    expect(await stored(loose)).toBe(false);
    // inside the two days nothing is taken: the phone may be about to register it
    expect(await stored(fresh)).toBe(true);
  });

  it("the visit's row is gone (the example was laid out again, his data was cleared): every part goes after two days", async () => {
    const w = await world();
    const scope = w.him.scope!;
    const long = await longVisit(w, "v-long", "2026-08-24", { ageDays: 30 });
    await w.store.deleteVisit(scope.id, "v-long");
    const counts = await sweepOrphans(w.store, blob, { realNowMs: Date.now() });
    expect(counts.unreferenced).toBe(5);
    for (const p of [...long.parts, ...long.clips]) expect(await stored(p), p).toBe(false);
  });
});

describe("deleting the account", () => {
  it("no part is left: his storage folder is empty and nothing of his remains", async () => {
    const w = await world();
    const long = await longVisit(w, "v-long", "2026-08-24");
    const partial = await longVisit(w, "v-partial", "2026-08-24", { complete: false });
    const before = await remainingRows({ store: w.store, auth: w.auth, blob }, { userId: w.him.userId, scope: w.him.scope });
    expect(before).toMatchObject({ "visit.session_id": 2, "storage.audio": 8 });

    const r = await deleteAccountEverywhere({ store: w.store, auth: w.auth, blob, care: careEntryStore(w.store) }, w.him.userId, { reason: "user" });
    expect(r).toMatchObject({ ok: true, counts: { files: 8, files_late: 0, leftover: 0 } });
    for (const p of [...long.parts, ...long.clips, ...partial.parts]) expect(await stored(p), p).toBe(false);
    for (const bucket of BLOB_BUCKETS) expect(await blob.removePrefix(bucket, w.prefix)).toBe(0);
    expect(await remainingRows({ store: w.store, auth: w.auth, blob }, { userId: w.him.userId, scope: w.him.scope })).toEqual({});
  });
});
