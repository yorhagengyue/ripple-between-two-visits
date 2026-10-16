/**
 * Blob storage entry point. Server-only (route handlers, server components, scripts).
 *
 *   import { getBlobStore } from "@/lib/blob";
 *   const blob = getBlobStore();
 *   const { url, method, headers } = await blob.signedUploadUrl("audio", path, "audio/wav", 600);
 *   const clip = await blob.getObject("labels", path);           // { bytes, contentType } | null
 *   const src = await blob.signedReadUrl("audio", path, 3600);   // for <audio src>
 *
 * BLOB_DRIVER=local (default) -> files under web/.data/blob (or BLOB_LOCAL_DIR), links via our routes,
 *                                 HMAC-signed with BLOB_SIGNING_SECRET or a random per-process secret
 * BLOB_DRIVER=supabase        -> Supabase Storage, SUPABASE_URL + SUPABASE_SERVICE_KEY
 *
 * Paths: everything of a scope lives under its prefix (see ./paths.ts, ./prefix.ts: a demo session's id, an account's
 * one-way stand-in for its id); removeSessionBlobs() clears both buckets on reset.
 */
import nodePath from "node:path";
import { createLocalBlobStore, LocalBlobStore } from "./local";
import { createSupabaseBlobStore, supabaseBlobConfig } from "./supabase";
import { BLOB_BUCKETS, BlobError, type BlobStore } from "./types";

export type BlobDriver = "local" | "supabase";

export function blobDriver(env: Record<string, string | undefined> = process.env): BlobDriver {
  const raw = (env.BLOB_DRIVER ?? "").trim().toLowerCase();
  if (raw === "" || raw === "local") return "local";
  if (raw === "supabase") return "supabase";
  throw new BlobError("invalid", `Unknown BLOB_DRIVER=${env.BLOB_DRIVER}; use local or supabase`);
}

/** web/.data/blob (relative to the server's working directory, which is web/), or BLOB_LOCAL_DIR. */
export function localBlobDir(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.BLOB_LOCAL_DIR ?? "").trim();
  return configured ? nodePath.resolve(configured) : nodePath.join(process.cwd(), ".data", "blob");
}

const g = globalThis as unknown as { __rippleBlobStores?: Map<string, BlobStore> };

/** The configured driver (one instance per configuration, shared by every route in the process). */
export function getBlobStore(env: Record<string, string | undefined> = process.env): BlobStore {
  const driver = blobDriver(env);
  g.__rippleBlobStores ??= new Map();
  if (driver === "local") {
    const dir = localBlobDir(env);
    const key = `local|${dir}`;
    let store = g.__rippleBlobStores.get(key);
    if (!store) {
      store = createLocalBlobStore({ dir });
      g.__rippleBlobStores.set(key, store);
    }
    return store;
  }
  const cfg = supabaseBlobConfig(env);
  if (!cfg) throw new BlobError("not_configured", "BLOB_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY");
  const key = `supabase|${cfg.url}`;
  let store = g.__rippleBlobStores.get(key);
  if (!store) {
    store = createSupabaseBlobStore(cfg);
    g.__rippleBlobStores.set(key, store);
  }
  return store;
}

/** The local driver when it is the configured one (the /api/blob/* routes only exist for it). */
export function getLocalBlobStore(env: Record<string, string | undefined> = process.env): LocalBlobStore | null {
  const store = getBlobStore(env);
  return store instanceof LocalBlobStore ? store : null;
}

/**
 * Delete every object of a session in both buckets. Returns how many were removed per bucket.
 * Used by the session reset; callers that must not fail (reset) catch and log.
 */
export async function removeSessionBlobs(
  sessionId: string,
  store: BlobStore = getBlobStore(),
): Promise<Record<(typeof BLOB_BUCKETS)[number], number>> {
  const out = { audio: 0, labels: 0 };
  for (const bucket of BLOB_BUCKETS) out[bucket] = await store.removePrefix(bucket, sessionId);
  return out;
}

export * from "./types";
export { LocalBlobStore, LOCAL_READ_ROUTE, LOCAL_UPLOAD_ROUTE, createLocalBlobStore } from "./local";
export { SupabaseBlobStore, createSupabaseBlobStore, supabaseBlobConfig, SUPABASE_UPLOAD_LINK_SECONDS } from "./supabase";
export {
  assertBytesMatch,
  baseContentType,
  contentTypeForPath,
  MAX_LINK_SECONDS,
  sniffContentType,
} from "./validate";
export { blobPrefix, blobUserTag, pathOwnedBy, reminderFileOf } from "./prefix";
export {
  READ_LINK_SECONDS,
  UPLOAD_KINDS,
  UPLOAD_LINK_SECONDS,
  planUpload,
  pathInSession,
  uploadUrlBody,
  type PlanOptions,
  type UploadKind,
  type UploadPlan,
  type UploadUrlBody,
} from "./paths";
