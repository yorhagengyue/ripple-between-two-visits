/**
 * Live check of the Supabase driver against the real project. Skipped unless BLOB_LIVE=1.
 *
 *   cd web && BLOB_LIVE=1 npx vitest run tests/unit/blob/supabase.live.test.ts
 *
 * Reads web/.env (SUPABASE_URL, SUPABASE_SERVICE_KEY); the buckets must exist
 * (npx tsx scripts/setup-storage.ts). Everything it writes lives under a random "blob-live-<uuid>/"
 * prefix and is removed at the end. Assertions only compare statuses and bytes, so a failure never
 * prints a key or a signed URL.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseBlobStore, supabaseBlobConfig, type SupabaseBlobStore } from "@/lib/blob";
import { equalBytes, labelPng, wavBytes, webmBytes } from "./fixtures";

const LIVE = process.env.BLOB_LIVE === "1";
const prefix = `blob-live-${randomUUID()}`;
let store: SupabaseBlobStore;
let supabaseUrl = "";

describe.skipIf(!LIVE)("supabase blob driver (live, BLOB_LIVE=1)", () => {
  beforeAll(() => {
    const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const cfg = supabaseBlobConfig();
    if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set in web/.env");
    supabaseUrl = cfg.url.replace(/\/+$/, "");
    store = createSupabaseBlobStore(cfg);
  });

  afterAll(async () => {
    if (!store) return;
    await store.removePrefix("audio", prefix).catch(() => 0);
    await store.removePrefix("labels", prefix).catch(() => 0);
  });

  it("both buckets exist and are private", async () => {
    expect(await store.bucketIsPublic("audio")).toBe(false);
    expect(await store.bucketIsPublic("labels")).toBe(false);
  });

  it("server-side put and get round trip (audio and a label photo)", async () => {
    const wav = wavBytes(1600);
    await store.putObject("audio", `${prefix}/a.wav`, wav, "audio/wav");
    const got = await store.getObject("audio", `${prefix}/a.wav`);
    expect(got && equalBytes(got.bytes, wav)).toBe(true);
    expect(got?.contentType).toContain("audio/wav");

    const png = labelPng();
    await store.putObject("labels", `${prefix}/labels/deep/p.png`, png, "image/png");
    const label = await store.getObject("labels", `${prefix}/labels/deep/p.png`);
    expect(label && equalBytes(label.bytes, png)).toBe(true);
    expect(await store.getObject("audio", `${prefix}/missing.wav`)).toBeNull();
  });

  it("private: no public URL, no unauthenticated read", async () => {
    const pub = await fetch(`${supabaseUrl}/storage/v1/object/public/audio/${prefix}/a.wav`);
    expect(pub.status).not.toBe(200);
    const anon = await fetch(`${supabaseUrl}/storage/v1/object/audio/${prefix}/a.wav`);
    expect(anon.status).not.toBe(200);
  });

  it("signed read link serves the bytes; a tampered link does not", async () => {
    const url = await store.signedReadUrl("audio", `${prefix}/a.wav`, 120);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(equalBytes(new Uint8Array(await res.arrayBuffer()), wavBytes(1600))).toBe(true);
    const u = new URL(url);
    const token = u.searchParams.get("token") ?? "";
    u.searchParams.set("token", token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA"));
    expect((await fetch(u)).status).not.toBe(200);
    await expect(store.signedReadUrl("audio", `${prefix}/missing.wav`, 60)).rejects.toMatchObject({ code: "not_found" });
  });

  it("signed read link expires", async () => {
    const url = await store.signedReadUrl("audio", `${prefix}/a.wav`, 1);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(url)).status).not.toBe(200);
  }, 15_000);

  it("signed upload link takes a WAV from the browser side (no key), twice to the same path", async () => {
    const path = `${prefix}/visits/v2/segments/v2-u08.wav`;
    for (const samples of [800, 1200]) {
      const link = await store.signedUploadUrl("audio", path, "audio/wav", 600);
      expect(link.method).toBe("PUT");
      const put = await fetch(link.url, { method: link.method, headers: link.headers, body: Buffer.from(wavBytes(samples)) });
      expect(put.status).toBe(200);
      const got = await store.getObject("audio", path);
      expect(got && equalBytes(got.bytes, wavBytes(samples))).toBe(true);
    }
  });

  it("the audio bucket itself refuses WebM through a signed link", async () => {
    const link = await store.signedUploadUrl("audio", `${prefix}/sneaky.wav`, "audio/wav", 600);
    const put = await fetch(link.url, {
      method: "PUT",
      headers: { ...link.headers, "content-type": "audio/webm" },
      body: Buffer.from(webmBytes()),
    });
    expect(put.ok).toBe(false);
    expect(await store.getObject("audio", `${prefix}/sneaky.wav`)).toBeNull();
  });

  // ---- C2 track H: the listing the nightly orphan sweep and the account deletion's check use
  it("lists the prefix at the bucket's top level and every file under it, each with a real last-written time", async () => {
    const started = Date.now();
    await store.putObject("audio", `${prefix}/reminders/list-a.wav`, wavBytes(), "audio/wav");
    await store.putObject("audio", `${prefix}/visits/v7/segments/list-b.wav`, wavBytes(), "audio/wav");
    expect(await store.listPrefixes("audio")).toContain(prefix);
    expect(await store.listPrefixes("labels")).toContain(prefix);

    const files = await store.listFiles("audio", prefix);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
    for (const p of [`${prefix}/a.wav`, `${prefix}/reminders/list-a.wav`, `${prefix}/visits/v7/segments/list-b.wav`, `${prefix}/visits/v2/segments/v2-u08.wav`]) {
      expect(paths).toContain(p);
    }
    expect(paths.every((p) => p.startsWith(`${prefix}/`))).toBe(true);
    // the time must come from Storage (never null) and be this run's: a wrong field name would show here
    for (const f of files) {
      expect(f.lastModifiedMs).not.toBeNull();
      expect(Number.isFinite(f.lastModifiedMs)).toBe(true);
      expect(Math.abs((f.lastModifiedMs as number) - started)).toBeLessThan(15 * 60_000);
    }
    expect((await store.listFiles("labels", prefix)).map((f) => f.path)).toEqual([`${prefix}/labels/deep/p.png`]);
    expect(await store.listFiles("audio", `${prefix}-nobody`)).toEqual([]);
  }, 30_000);

  it("pages through a listing by offset: two entries a call gives the same answer", async () => {
    const cfg = supabaseBlobConfig()!;
    const paged = createSupabaseBlobStore({ ...cfg, listPage: 2 });
    for (const name of ["page-1", "page-2", "page-3", "page-4", "page-5"]) {
      await store.putObject("audio", `${prefix}/reminders/${name}.wav`, wavBytes(), "audio/wav");
    }
    const whole = (await store.listFiles("audio", prefix)).map((f) => f.path);
    expect((await paged.listFiles("audio", prefix)).map((f) => f.path)).toEqual(whole);
    expect(whole.filter((p) => p.includes("/reminders/page-"))).toHaveLength(5);
    expect(await paged.listPrefixes("audio")).toEqual(await store.listPrefixes("audio"));
  }, 30_000);

  it("removeObjects deletes exactly the named files and counts them", async () => {
    const gone = [`${prefix}/reminders/page-1.wav`, `${prefix}/reminders/page-2.wav`];
    expect(await store.removeObjects("audio", [...gone, `${prefix}/reminders/never-there.wav`])).toBe(2);
    for (const p of gone) expect(await store.getObject("audio", p)).toBeNull();
    expect(await store.getObject("audio", `${prefix}/reminders/page-3.wav`)).not.toBeNull();
    const left = (await store.listFiles("audio", `${prefix}/reminders`)).map((f) => f.path);
    expect(left).toEqual([`${prefix}/reminders/list-a.wav`, `${prefix}/reminders/page-3.wav`, `${prefix}/reminders/page-4.wav`, `${prefix}/reminders/page-5.wav`]);
  }, 30_000);

  it("removePrefix deletes every depth under the prefix in both buckets", async () => {
    await store.putObject("audio", `${prefix}/visits/v1/recording-1.wav`, wavBytes(), "audio/wav");
    const removedAudio = await store.removePrefix("audio", prefix);
    expect(removedAudio).toBeGreaterThanOrEqual(3);
    expect(await store.removePrefix("labels", prefix)).toBe(1);
    for (const p of [`${prefix}/a.wav`, `${prefix}/visits/v2/segments/v2-u08.wav`, `${prefix}/visits/v1/recording-1.wav`]) {
      expect(await store.getObject("audio", p)).toBeNull();
    }
    expect(await store.getObject("labels", `${prefix}/labels/deep/p.png`)).toBeNull();
    expect(await store.removePrefix("audio", prefix)).toBe(0);
    // an emptied prefix is gone from the bucket's top level
    expect(await store.listPrefixes("audio")).not.toContain(prefix);
    expect(await store.listFiles("audio", prefix)).toEqual([]);
  }, 30_000);
});
