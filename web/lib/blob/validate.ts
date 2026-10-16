/**
 * Checks shared by both blob drivers and the upload routes: bucket names, object paths, content types,
 * file extensions and the file's leading bytes ("magic numbers"). Pure functions, no I/O.
 *
 * The leading-bytes check is what keeps WebM out: Tencent's speech service needs a real WAV, so a WebM
 * file renamed to .wav or sent with content-type audio/wav is rejected too.
 */
import {
  BLOB_BUCKETS,
  BUCKET_CONFIG,
  BlobError,
  type BlobBucket,
  type BlobContentType,
} from "./types";

export const EXTENSION_FOR: Record<BlobContentType, string> = {
  "audio/wav": "wav",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const TYPE_FOR_EXTENSION: Record<string, BlobContentType> = {
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function isBucket(value: unknown): value is BlobBucket {
  return typeof value === "string" && (BLOB_BUCKETS as readonly string[]).includes(value);
}

export function assertBucket(value: unknown): BlobBucket {
  if (!isBucket(value)) throw new BlobError("invalid_bucket", `Unknown bucket; use ${BLOB_BUCKETS.join(" or ")}`);
  return value;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PATH = 512;

/**
 * Object paths are "seg/seg/file.ext": no leading or trailing slash, no backslash, no "." or ".."
 * segments, each segment [A-Za-z0-9._-] starting with a letter or digit. Session ids (UUIDs) and the
 * store's row ids fit.
 */
export function assertPath(path: string, what = "path"): string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH) {
    throw new BlobError("invalid_path", `${what} must be 1-${MAX_PATH} characters`);
  }
  const parts = path.split("/");
  for (const part of parts) {
    if (!SEGMENT.test(part) || part === "." || part === "..") {
      throw new BlobError("invalid_path", `${what} has an invalid segment`);
    }
  }
  return path;
}

/** C2 track H (only add): does `path` follow the object path rules? A listing leaves out anything that does not. */
export function isPath(path: string): boolean {
  try {
    assertPath(path);
    return true;
  } catch {
    return false;
  }
}

/** A prefix for removePrefix: same rules as a path; one trailing slash is allowed and dropped. */
export function normalizePrefix(prefix: string): string {
  const trimmed = typeof prefix === "string" && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return assertPath(trimmed, "prefix");
}

/** "Audio/WAV; codecs=1" -> "audio/wav". */
export function baseContentType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

/** The content type if this bucket accepts it, otherwise unsupported_content_type (audio/webm lands here). */
export function assertContentType(bucket: BlobBucket, value: string | null | undefined): BlobContentType {
  const ct = baseContentType(value);
  const allowed = BUCKET_CONFIG[bucket].contentTypes as readonly string[];
  if (!allowed.includes(ct)) {
    throw new BlobError(
      "unsupported_content_type",
      `${ct || "(none)"} is not accepted in the ${bucket} bucket; allowed: ${allowed.join(", ")}`,
    );
  }
  return ct as BlobContentType;
}

/** Content type implied by the path's extension, or null. */
export function contentTypeForPath(path: string): BlobContentType | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return TYPE_FOR_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? null;
}

/** The path's extension must name the same type (no "clip.wav" holding a PNG, no ".webm"). */
export function assertExtension(path: string, contentType: BlobContentType): void {
  if (contentTypeForPath(path) !== contentType) {
    throw new BlobError("content_mismatch", `the file extension does not match ${contentType}`);
  }
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

/** What the leading bytes say the file is (only the formats this app cares about). */
export function sniffContentType(bytes: Uint8Array): BlobContentType | "audio/webm" | null {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") {
    const form = ascii(bytes, 8, 12);
    if (form === "WAVE") return "audio/wav";
    if (form === "WEBP") return "image/webp";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // EBML header: WebM / Matroska
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  return null;
}

/** The bytes must really be the declared type. */
export function assertBytesMatch(bytes: Uint8Array, contentType: BlobContentType): void {
  const sniffed = sniffContentType(bytes);
  if (sniffed !== contentType) {
    throw new BlobError(
      sniffed === "audio/webm" ? "unsupported_content_type" : "content_mismatch",
      sniffed === "audio/webm"
        ? "the file is WebM; record 16 kHz mono WAV instead"
        : `the file's bytes are not ${contentType}`,
    );
  }
}

export function assertSize(bucket: BlobBucket, size: number): void {
  const max = BUCKET_CONFIG[bucket].maxBytes;
  if (size > max) throw new BlobError("too_large", `the ${bucket} bucket takes at most ${max} bytes per object`);
}

/** Every check a server-side write makes; returns the normalized content type. */
export function checkWrite(bucket: BlobBucket, path: string, bytes: Uint8Array, contentType: string): BlobContentType {
  assertBucket(bucket);
  assertPath(path);
  const ct = assertContentType(bucket, contentType);
  assertExtension(path, ct);
  assertSize(bucket, bytes.byteLength);
  assertBytesMatch(bytes, ct);
  return ct;
}

/**
 * The longest any signed link may live: 24 hours, the links inside his export (docs/plan/real-app.md 3.11 导出). Every
 * other link the browser gets is 10 minutes (./paths.ts READ_LINK_SECONDS, UPLOAD_LINK_SECONDS). C2 track H lowered
 * this from 7 days.
 */
export const MAX_LINK_SECONDS = 24 * 3600;

/** Signed-link lifetimes are clamped to 1 second .. 24 hours. */
export function clampExpiry(expiresSec: number): number {
  if (!Number.isFinite(expiresSec)) throw new BlobError("invalid", "expiresSec must be a number");
  return Math.min(MAX_LINK_SECONDS, Math.max(1, Math.floor(expiresSec)));
}
