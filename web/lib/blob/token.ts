/**
 * HMAC tokens for the local driver's signed links. A token is "<payload>.<signature>", both base64url;
 * the payload names the operation, bucket, path, content type (uploads) and expiry, and the signature
 * is HMAC-SHA256 over the payload with BLOB_SIGNING_SECRET (or a random per-process secret).
 *
 * The random secret lives on globalThis, not in module scope: `next dev` re-evaluates modules on hot
 * reload, and a rotated secret would invalidate every link handed out a moment earlier.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BlobError, type BlobBucket, type BlobContentType } from "./types";

export interface BlobTokenPayload {
  v: 1;
  op: "put" | "get";
  b: BlobBucket;
  p: string;
  /** content type the upload must declare (put only) */
  ct?: BlobContentType;
  /** expiry, unix seconds */
  exp: number;
}

const g = globalThis as unknown as { __rippleBlobSecret?: Buffer };

/** BLOB_SIGNING_SECRET when set (needed when more than one process serves the links), else random per process. */
export function blobSigningSecret(env: Record<string, string | undefined> = process.env): Buffer {
  const configured = (env.BLOB_SIGNING_SECRET ?? "").trim();
  if (configured) return Buffer.from(configured, "utf8");
  if (!g.__rippleBlobSecret) g.__rippleBlobSecret = randomBytes(32);
  return g.__rippleBlobSecret;
}

const sign = (secret: Buffer, payload: string): Buffer =>
  createHmac("sha256", secret).update(`ripple-blob-v1.${payload}`).digest();

export function signToken(secret: Buffer, payload: BlobTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body).toString("base64url")}`;
}

/**
 * Check the signature, the expiry and the operation. Any change to the payload or the signature
 * fails as bad_token; a valid but old token fails as token_expired.
 */
export function verifyToken(
  secret: Buffer,
  token: string | null | undefined,
  op: BlobTokenPayload["op"],
  nowMs: number = Date.now(),
): BlobTokenPayload {
  if (!token || typeof token !== "string") throw new BlobError("bad_token", "missing token");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new BlobError("bad_token", "malformed token");
  const [body, sig] = parts;
  const expected = sign(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new BlobError("bad_token", "token signature does not match");
  }
  let payload: BlobTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BlobTokenPayload;
  } catch {
    throw new BlobError("bad_token", "malformed token");
  }
  if (payload.v !== 1 || payload.op !== op || typeof payload.p !== "string" || typeof payload.exp !== "number") {
    throw new BlobError("bad_token", "token is not for this operation");
  }
  if (Math.floor(nowMs / 1000) >= payload.exp) throw new BlobError("token_expired", "the link has expired");
  return payload;
}
