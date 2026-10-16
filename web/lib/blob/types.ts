/**
 * Object storage for recordings and label photos (spec section 3: two private buckets, read and written
 * through signed links, deleted with the session). Server-only.
 *
 * Two drivers behind one interface, picked by BLOB_DRIVER (see ./index.ts):
 * - local (default): files under web/.data/blob/<bucket>/<path>; the signed links point at our own
 *   routes (/api/blob/upload, /api/blob/read) and carry an HMAC token.
 * - supabase: Supabase Storage REST API (fetch only), server key from web/.env.
 *
 * Every object of a session lives under "<session_id>/..." so a reset can removePrefix(bucket, id).
 */

export const BLOB_BUCKETS = ["audio", "labels"] as const;
export type BlobBucket = (typeof BLOB_BUCKETS)[number];

/** The only content types the app stores. Audio is 16 kHz mono WAV recorded in the browser; never WebM. */
export const AUDIO_TYPES = ["audio/wav"] as const;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type BlobContentType = (typeof AUDIO_TYPES)[number] | (typeof IMAGE_TYPES)[number];

export interface BucketConfig {
  id: BlobBucket;
  contentTypes: readonly BlobContentType[];
  /** per-object cap, bytes; also set on the Supabase bucket by scripts/setup-storage.ts */
  maxBytes: number;
}

const MB = 1024 * 1024;

export const BUCKET_CONFIG: Record<BlobBucket, BucketConfig> = {
  // 50 MB is the Supabase free-plan ceiling: about 27 minutes of 16 kHz mono 16-bit WAV. A longer visit is uploaded as
  // several files of 20 minutes each (C2 track R: lib/visit/parts.ts), so no single file comes near it.
  audio: { id: "audio", contentTypes: AUDIO_TYPES, maxBytes: 50 * MB },
  labels: { id: "labels", contentTypes: IMAGE_TYPES, maxBytes: 10 * MB },
};

export interface SignedUpload {
  /** absolute for supabase; a same-origin path (/api/blob/upload?token=...) for local */
  url: string;
  method: "PUT";
  /** headers the uploader must send with the bytes (content-type, and x-upsert for supabase) */
  headers: Record<string, string>;
  /** ISO time the link stops working. Supabase fixes signed upload links at 2 hours. */
  expiresAt: string;
}

export interface BlobObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface BlobStore {
  readonly driver: "local" | "supabase";
  /** Server-side write (overwrites). Checks bucket, path, content type and the file's leading bytes. */
  putObject(bucket: BlobBucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Server-side read; null when the object does not exist. */
  getObject(bucket: BlobBucket, path: string): Promise<BlobObject | null>;
  /** A link the browser PUTs the bytes to directly (spec: uploads never pass through our API). */
  signedUploadUrl(bucket: BlobBucket, path: string, contentType: string, expiresSec: number): Promise<SignedUpload>;
  /** A link the browser can GET (e.g. an <audio src>). Throws not_found when the object is missing. */
  signedReadUrl(bucket: BlobBucket, path: string, expiresSec: number): Promise<string>;
  /** Delete every object under "<prefix>/" (folder semantics: "abc" never touches "abcd/..."). Returns how many. */
  removePrefix(bucket: BlobBucket, prefix: string): Promise<number>;

  // ---- C2 track H (only add): what the nightly orphan sweep and the account deletion's check need, on both drivers
  /**
   * The bucket's top-level folders, in name order: each is one scope's prefix (lib/blob/prefix.ts). A bucket nobody has
   * written to is []. Names that could not be a prefix (the path rules of ./validate.ts) are left out.
   */
  listPrefixes(bucket: BlobBucket): Promise<string[]>;
  /**
   * Every object under "<prefix>/" at any depth, in path order, with the time it was last written. A folder that does
   * not exist is []. An upload still being written and names that could not be an object path are left out.
   */
  listFiles(bucket: BlobBucket, prefix: string): Promise<BlobFileInfo[]>;
  /** Delete exactly these objects (whole paths, never a folder). A path that is not there is skipped. Returns how many went. */
  removeObjects(bucket: BlobBucket, paths: readonly string[]): Promise<number>;
}

/** One stored object as a listing shows it. */
export interface BlobFileInfo {
  /** bucket-relative, "prefix/.../file.ext" */
  path: string;
  /** epoch ms of the last write; null when the storage did not say (a caller then treats the file as just written) */
  lastModifiedMs: number | null;
}

export type BlobErrorCode =
  | "invalid_bucket"
  | "invalid_path"
  | "unsupported_content_type"
  | "content_mismatch"
  | "too_large"
  | "bad_token"
  | "token_expired"
  | "not_found"
  | "not_configured"
  | "invalid"
  | "upstream";

export class BlobError extends Error {
  constructor(
    readonly code: BlobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BlobError";
  }

  /**
   * Production builds put this module into many chunks and stores live on globalThis, so an error thrown by a store can
   * come from another copy of this class: `instanceof` recognises any error with this name and a string code.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const e = value as { name?: unknown; code?: unknown };
    return e.name === "BlobError" && typeof e.code === "string";
  }
}

/** HTTP status for each error code (routes use this; messages never carry keys, tokens or signed URLs). */
export function blobErrorStatus(code: BlobErrorCode): number {
  switch (code) {
    case "unsupported_content_type":
    case "content_mismatch":
      return 415;
    case "too_large":
      return 413;
    case "bad_token":
    case "token_expired":
      return 403;
    case "not_found":
      return 404;
    case "not_configured":
      return 503;
    case "upstream":
      return 502;
    default:
      return 400;
  }
}
