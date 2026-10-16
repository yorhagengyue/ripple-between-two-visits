/**
 * The nightly orphan sweep (lib/privacy/sweep.ts; real-app 3.11 「每晚有一次孤儿扫描兜底」; C2 track H), on the memory
 * store and on both blob drivers: the local one in a temporary folder and the Supabase one against the in-memory
 * stand-in for its REST API (tests/unit/blob/drivers.ts; three entries a page, so every listing pages). The sweep only
 * uses the BlobStore interface, so the same test holds both to the same result. Prefixes come from lib/blob/prefix.ts,
 * the uploads' own rule.
 *   - a folder no live scope owns: its files older than two days go, younger ones stay
 *   - a live account's folder: files under visits/, labels/, reminders/ that no row points at go after two days (what
 *     track C's example reseed and clear leave behind); every file a row points at stays; other folders are not touched
 *   - a live demo session's folder is never swept
 *   - a file the storage cannot date is kept; a folder the storage fails on is counted and the pass goes on
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobPrefix, BlobError, type BlobStore } from "@/lib/blob";
import { sweepOrphans } from "@/lib/privacy/sweep";
import { MemoryStore } from "@/lib/store/memory";
import { DRIVER_HARNESSES, supabaseHarness, type DriverHarness } from "../blob/drivers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T03:00:00.000Z");

describe.each(DRIVER_HARNESSES)("sweepOrphans on the %s driver", (_name, make) => {
  let h: DriverHarness;
  beforeAll(async () => {
    h = await make();
  });
  afterAll(async () => {
    await h.close();
  });

  const put = (bucket: "audio" | "labels", p: string, ageDays: number) => h.put(bucket, p, NOW - ageDays * DAY);

  it("dead folders and unreferenced files older than two days go; referenced, young and unknown files stay", async () => {
    const store = new MemoryStore({ now: () => new Date(NOW) });
    const uid = randomUUID();
    const scope = await store.createAccountScope({ user_id: uid, d0: "2026-08-24" });
    const demo = await store.createSession();
    const live = blobPrefix(scope);
    const dead = blobPrefix({ id: randomUUID(), kind: "account" });

    // his records point at three files
    const recording = `${live}/visits/v-1/recording-a.wav`;
    const photo = `${live}/labels/kept.png`;
    const reminder = `${live}/reminders/kept.wav`;
    await put("audio", recording, 30);
    await put("labels", photo, 30);
    await put("audio", reminder, 30);
    await store.upsertVisit(scope.id, { id: "v-1", kind: "follow_up", place: "", day: 0, status: "review", audio_path: recording });
    await store.upsertMed(scope.id, { id: "med-a", origin: "prescription", status: "label_confirmed", label: { text: "X", photo_path: photo } });
    await store.addReminderClip(scope.id, { by: "link", plays_at: "after_breakfast", audio_path: reminder });
    // left behind by a reseed (old), and one just uploaded (young), and one in a folder the uploads never use
    const leftover = `${live}/visits/old-example/recording-b.wav`;
    const leftoverClips = ["u1", "u2", "u3", "u4"].map((u) => `${live}/visits/old-example/segments/${u}.wav`);
    const unconfirmedPhoto = `${live}/labels/never-confirmed.png`;
    const fresh = `${live}/reminders/just-uploaded.wav`;
    const unknown = `${live}/other/keep-me.wav`;
    await put("audio", leftover, 10);
    for (const c of leftoverClips) await put("audio", c, 10);
    await put("labels", unconfirmedPhoto, 3);
    await put("audio", fresh, 0.1);
    await put("audio", unknown, 30);
    // a deleted account's folder: an old file and a young one
    await put("audio", `${dead}/visits/v-9/recording-z.wav`, 5);
    await put("audio", `${dead}/reminders/new.wav`, 0.5);
    // a live demo session's file that no row names: never swept
    const demoFile = `${demo.id}/visits/v1/recording-d.wav`;
    await put("audio", demoFile, 30);

    const counts = await sweepOrphans(store, h.blob, { realNowMs: NOW });
    expect(counts).toEqual({ prefixes: 4, orphan_prefixes: 1, files: 1, unreferenced: 6, kept_young: 2, folders_failed: 0 });
    expect(await h.has("audio", recording)).toBe(true);
    expect(await h.has("labels", photo)).toBe(true);
    expect(await h.has("audio", reminder)).toBe(true);
    expect(await h.has("audio", leftover)).toBe(false);
    for (const c of leftoverClips) expect(await h.has("audio", c)).toBe(false);
    expect(await h.has("labels", unconfirmedPhoto)).toBe(false);
    expect(await h.has("audio", fresh)).toBe(true);
    expect(await h.has("audio", unknown)).toBe(true);
    expect(await h.has("audio", `${dead}/visits/v-9/recording-z.wav`)).toBe(false);
    expect(await h.has("audio", `${dead}/reminders/new.wav`)).toBe(true);
    expect(await h.has("audio", demoFile)).toBe(true);

    // the same pass again finds nothing more to do
    expect(await sweepOrphans(store, h.blob, { realNowMs: NOW })).toMatchObject({ files: 0, unreferenced: 0, kept_young: 2, folders_failed: 0 });

    // three days later the young orphan goes too, the live account's young file once it is old and still unnamed;
    // the dead account's folder is then empty and is no longer a prefix
    const later = await sweepOrphans(store, h.blob, { realNowMs: NOW + 3 * DAY });
    expect(later).toMatchObject({ orphan_prefixes: 1, files: 1, unreferenced: 1, kept_young: 0, folders_failed: 0 });
    expect(await h.has("audio", `${dead}/reminders/new.wav`)).toBe(false);
    expect(await h.has("audio", fresh)).toBe(false);
    expect(await h.blob.listPrefixes("audio")).toEqual([live, demo.id].sort());
    expect(await sweepOrphans(store, h.blob, { realNowMs: NOW + 3 * DAY })).toEqual({ prefixes: 3, orphan_prefixes: 0, files: 0, unreferenced: 0, kept_young: 0, folders_failed: 0 });
  }, 30_000); // many small file writes: slow on a busy disk (a build running beside the tests)

  it("when his account is gone, his whole folder is an orphan in both buckets", async () => {
    const store = new MemoryStore({ now: () => new Date(NOW) });
    const gone = blobPrefix({ id: randomUUID(), kind: "account" });
    await put("audio", `${gone}/visits/v-1/recording-a.wav`, 4);
    await put("audio", `${gone}/reminders/hers.wav`, 4);
    await put("labels", `${gone}/labels/photo.png`, 4);
    // a longer grace period keeps them (this store knows no scope at all, so every folder here is an orphan)
    const before = await sweepOrphans(store, h.blob, { realNowMs: NOW, graceMs: 5 * DAY });
    expect(before.kept_young).toBe(3);
    expect(await h.has("audio", `${gone}/visits/v-1/recording-a.wav`)).toBe(true);
    expect(await h.has("labels", `${gone}/labels/photo.png`)).toBe(true);
    expect(await sweepOrphans(store, h.blob, { realNowMs: NOW })).toMatchObject({ files: 3, kept_young: 0, folders_failed: 0 });
    expect(await h.has("audio", `${gone}/visits/v-1/recording-a.wav`)).toBe(false);
    expect(await h.has("audio", `${gone}/reminders/hers.wav`)).toBe(false);
    expect(await h.has("labels", `${gone}/labels/photo.png`)).toBe(false);
    expect(await h.blob.listPrefixes("labels")).not.toContain(gone);
  }, 30_000);
});

describe("sweepOrphans when the storage is unsure or fails", () => {
  it("a file Supabase Storage gives no time for is kept, whatever its age", async () => {
    const h = await supabaseHarness();
    const dead = blobPrefix({ id: randomUUID(), kind: "account" });
    h.storage.seed("audio", `${dead}/visits/v-1/undated.wav`, { undated: true });
    h.storage.seed("audio", `${dead}/visits/v-1/old.wav`, { updatedMs: NOW - 9 * DAY });
    const counts = await sweepOrphans(new MemoryStore(), h.blob, { realNowMs: NOW });
    expect(counts).toEqual({ prefixes: 1, orphan_prefixes: 1, files: 1, unreferenced: 0, kept_young: 1, folders_failed: 0 });
    expect(h.storage.has("audio", `${dead}/visits/v-1/undated.wav`)).toBe(true);
    expect(h.storage.has("audio", `${dead}/visits/v-1/old.wav`)).toBe(false);
  });

  it("a folder the storage fails on is counted and the other folders are still swept; a path never reaches the counts", async () => {
    const h = await supabaseHarness();
    const bad = blobPrefix({ id: randomUUID(), kind: "account" });
    const ok = blobPrefix({ id: randomUUID(), kind: "account" });
    await h.put("audio", `${bad}/visits/v-1/a.wav`, NOW - 9 * DAY);
    await h.put("audio", `${ok}/visits/v-1/b.wav`, NOW - 9 * DAY);
    const flaky: BlobStore = new Proxy(h.blob, {
      get(target, prop, receiver) {
        if (prop === "listFiles") {
          return async (bucket: "audio" | "labels", prefix: string) => {
            if (prefix === bad) throw new BlobError("upstream", "Supabase Storage list: HTTP 500");
            return target.listFiles(bucket, prefix);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const counts = await sweepOrphans(new MemoryStore(), flaky, { realNowMs: NOW });
    expect(counts).toEqual({ prefixes: 2, orphan_prefixes: 1, files: 1, unreferenced: 0, kept_young: 0, folders_failed: 1 });
    expect(h.storage.has("audio", `${bad}/visits/v-1/a.wav`)).toBe(true);
    expect(h.storage.has("audio", `${ok}/visits/v-1/b.wav`)).toBe(false);
    expect(JSON.stringify(counts)).not.toContain(bad.slice(0, 8));
    // the storage not answering at all fails the pass (the job reports it and tries the next night)
    const down = { ...flaky, listPrefixes: async () => Promise.reject(new BlobError("upstream", "Supabase Storage list: network error")) } as unknown as BlobStore;
    await expect(sweepOrphans(new MemoryStore(), down, { realNowMs: NOW })).rejects.toMatchObject({ code: "upstream" });
  });
});
