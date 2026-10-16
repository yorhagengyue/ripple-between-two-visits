/**
 * The listing BlobStore gives the orphan sweep and the account deletion's check (C2 track H; lib/blob/types.ts
 * listPrefixes, listFiles, removeObjects), held to the same behaviour on both drivers: the local one in a temporary
 * folder, the Supabase one against the in-memory stand-in for its REST API (three entries a page, so it pages).
 * What each driver sends and reads on its own is in local.test.ts and supabase-driver.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlobError } from "@/lib/blob";
import { DRIVER_HARNESSES, type DriverHarness } from "./drivers";

const NOW = Date.parse("2026-10-10T03:00:00.000Z");
const DAY = 86_400_000;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof BlobError) return err.code;
    throw err;
  }
}

describe.each(DRIVER_HARNESSES)("blob listing on the %s driver", (_name, make) => {
  let h: DriverHarness;
  beforeAll(async () => {
    h = await make();
  });
  afterAll(async () => {
    await h.close();
  });

  it("a bucket nobody wrote to has no prefixes, and a folder that is not there has no files", async () => {
    expect(await h.blob.listPrefixes("audio")).toEqual([]);
    expect(await h.blob.listPrefixes("labels")).toEqual([]);
    expect(await h.blob.listFiles("audio", "nobody")).toEqual([]);
    expect(await h.blob.removeObjects("audio", ["nobody/visits/v1/a.wav"])).toBe(0);
    expect(await h.blob.removeObjects("audio", [])).toBe(0);
  });

  it("lists the top-level prefixes in name order, per bucket", async () => {
    await h.put("audio", "scope-b/visits/v1/recording-1.wav", NOW - 5 * DAY);
    await h.put("audio", "scope-a/reminders/r1.wav", NOW - 1 * DAY);
    await h.put("audio", "scope-ab/reminders/r2.wav", NOW - 2 * DAY);
    await h.put("audio", "zeta/visits/v9/recording-9.wav", NOW);
    await h.put("labels", "scope-a/labels/p1.png", NOW - 3 * DAY);
    expect(await h.blob.listPrefixes("audio")).toEqual(["scope-a", "scope-ab", "scope-b", "zeta"]);
    expect(await h.blob.listPrefixes("labels")).toEqual(["scope-a"]);
  });

  it("lists every file under a prefix at any depth, in path order, each with the time it was last written", async () => {
    await h.put("audio", "scope-b/visits/v1/segments/u1.wav", NOW - 4 * DAY);
    await h.put("audio", "scope-b/visits/v1/segments/u2.wav", NOW - 4 * DAY + 1000);
    await h.put("audio", "scope-b/visits/v2/recording-2.wav", NOW - 0.5 * DAY);
    await h.put("audio", "scope-b/reminders/r9.wav", NOW - 10 * DAY);
    const files = await h.blob.listFiles("audio", "scope-b");
    expect(files.map((f) => f.path)).toEqual([
      "scope-b/reminders/r9.wav",
      "scope-b/visits/v1/recording-1.wav",
      "scope-b/visits/v1/segments/u1.wav",
      "scope-b/visits/v1/segments/u2.wav",
      "scope-b/visits/v2/recording-2.wav",
    ]);
    const at = Object.fromEntries(files.map((f) => [f.path, f.lastModifiedMs]));
    expect(at["scope-b/reminders/r9.wav"]).toBe(NOW - 10 * DAY);
    expect(at["scope-b/visits/v1/recording-1.wav"]).toBe(NOW - 5 * DAY);
    expect(at["scope-b/visits/v1/segments/u2.wav"]).toBe(NOW - 4 * DAY + 1000);
    expect(at["scope-b/visits/v2/recording-2.wav"]).toBe(NOW - 0.5 * DAY);
    // a sub-folder can be listed on its own; a trailing slash is allowed
    expect((await h.blob.listFiles("audio", "scope-b/visits/v1/")).map((f) => f.path)).toEqual([
      "scope-b/visits/v1/recording-1.wav",
      "scope-b/visits/v1/segments/u1.wav",
      "scope-b/visits/v1/segments/u2.wav",
    ]);
  });

  it("folder semantics: a prefix never reaches into a longer name beside it", async () => {
    expect((await h.blob.listFiles("audio", "scope-a")).map((f) => f.path)).toEqual(["scope-a/reminders/r1.wav"]);
    expect((await h.blob.listFiles("audio", "scope")).map((f) => f.path)).toEqual([]);
  });

  it("removeObjects deletes exactly the paths it is given, skips what is not there, and never a folder", async () => {
    const removed = await h.blob.removeObjects("audio", [
      "scope-b/visits/v1/segments/u1.wav",
      "scope-b/visits/v1/segments/u1.wav", // named twice: once
      "scope-b/visits/v1/segments/never-there.wav",
      "scope-b/visits/v2", // a folder
    ]);
    expect(removed).toBe(1);
    expect(await h.has("audio", "scope-b/visits/v1/segments/u1.wav")).toBe(false);
    expect(await h.has("audio", "scope-b/visits/v1/segments/u2.wav")).toBe(true);
    expect(await h.has("audio", "scope-b/visits/v2/recording-2.wav")).toBe(true);
    // the other bucket's file of the same scope is untouched
    expect(await h.has("labels", "scope-a/labels/p1.png")).toBe(true);
  });

  it("a prefix whose last file went is no longer listed; removePrefix and the listing agree", async () => {
    expect(await h.blob.removeObjects("audio", ["scope-ab/reminders/r2.wav"])).toBe(1);
    expect(await h.blob.listPrefixes("audio")).toEqual(["scope-a", "scope-b", "zeta"]);
    expect(await h.blob.removePrefix("audio", "scope-b")).toBe(4);
    expect(await h.blob.listFiles("audio", "scope-b")).toEqual([]);
    expect(await h.blob.listPrefixes("audio")).toEqual(["scope-a", "zeta"]);
  });

  it("refuses a bad bucket, an empty prefix and a path that leaves the bucket", async () => {
    expect(await code(h.blob.listPrefixes("video" as never))).toBe("invalid_bucket");
    expect(await code(h.blob.listFiles("video" as never, "scope-a"))).toBe("invalid_bucket");
    expect(await code(h.blob.listFiles("audio", ""))).toBe("invalid_path");
    expect(await code(h.blob.listFiles("audio", "../audio"))).toBe("invalid_path");
    expect(await code(h.blob.removeObjects("audio", ["scope-a/../zeta/visits/v9/recording-9.wav"]))).toBe("invalid_path");
    expect(await code(h.blob.removeObjects("video" as never, ["scope-a/a.wav"]))).toBe("invalid_bucket");
    expect(await h.has("audio", "zeta/visits/v9/recording-9.wav")).toBe(true);
  });
});
