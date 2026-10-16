/**
 * Both blob drivers behind one small test harness (C2 track H): the local driver in a temporary folder and the
 * Supabase driver against the in-memory stand-in for its REST API (./fake-storage.ts). A test written against the
 * harness runs on both, so the listing and the orphan sweep are held to the same behaviour on each.
 */
import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalBlobStore, createSupabaseBlobStore, type BlobBucket, type BlobStore } from "@/lib/blob";
import { FAKE_STORAGE_URL, FakeStorage } from "./fake-storage";
import { labelPng, wavBytes } from "./fixtures";

export interface DriverHarness {
  name: "local" | "supabase";
  blob: BlobStore;
  /** Store a WAV (audio) or a PNG (labels) at `path` through the driver, last written at `writtenMs`. */
  put(bucket: BlobBucket, path: string, writtenMs: number): Promise<void>;
  has(bucket: BlobBucket, path: string): Promise<boolean>;
  close(): Promise<void>;
}

async function write(blob: BlobStore, bucket: BlobBucket, p: string): Promise<void> {
  if (bucket === "audio") await blob.putObject("audio", p, wavBytes(), "audio/wav");
  else await blob.putObject("labels", p, labelPng(), "image/png");
}

export async function localHarness(): Promise<DriverHarness & { dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-blob-"));
  const blob = createLocalBlobStore({ dir });
  return {
    name: "local",
    blob,
    dir,
    async put(bucket, p, writtenMs) {
      await write(blob, bucket, p);
      const t = new Date(writtenMs);
      await utimes(path.join(dir, bucket, ...p.split("/")), t, t);
    },
    has: async (bucket, p) => (await blob.getObject(bucket, p)) !== null,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

export async function supabaseHarness(opts: { listPage?: number } = {}): Promise<DriverHarness & { storage: FakeStorage }> {
  const storage = new FakeStorage();
  const blob = createSupabaseBlobStore({ url: FAKE_STORAGE_URL, serviceKey: "fake-service-key-for-tests", fetch: storage.fetch, listPage: opts.listPage });
  return {
    name: "supabase",
    blob,
    storage,
    async put(bucket, p, writtenMs) {
      await write(blob, bucket, p);
      storage.touch(bucket, p, writtenMs);
    },
    has: async (bucket, p) => storage.has(bucket, p),
    close: async () => undefined,
  };
}

/** Each driver's harness, for describe.each. The Supabase one lists three entries a page, so every listing pages. */
export const DRIVER_HARNESSES: [string, () => Promise<DriverHarness>][] = [
  ["local", () => localHarness()],
  ["supabase", () => supabaseHarness({ listPage: 3 })],
];
