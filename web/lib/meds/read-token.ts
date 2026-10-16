/**
 * The label fields travel from POST /api/labels/read to the patient's confirm screen and back to POST /api/meds
 * inside a signed token, so the fields the server writes are exactly the ones its own reader produced. Without
 * this, any client could post made-up "directions" that the safety layer would later quote as the label's words.
 *
 * Token: "<base64url payload>.<base64url HMAC-SHA256>", payload { v, sid, path, fields, by, exp }. The secret is
 * the blob module's (BLOB_SIGNING_SECRET, else one random secret per process), with its own prefix so a blob
 * link token can never pass as a label read and the reverse. Server-only.
 *
 * C2 track G (real-app 5.6 H1): the payload is only base64, so anyone holding the token reads it. `sid` is therefore
 * never the scope's id (for an account that is the person's user id, which no answer may carry): it is a keyed one-way
 * tag of it, enough to tell that a token belongs to this scope and nothing more. Callers still pass the scope's id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { blobSigningSecret } from "@/lib/blob/token";
import type { LabelFields } from "./types";

export const READ_TOKEN_SECONDS = 3600;

export interface ReadTokenPayload {
  v: 1;
  /** the scope this read belongs to: its id when signing; in the token and in a verified payload, the scope's tag */
  sid: string;
  /** labels bucket path of the photo */
  path: string;
  fields: LabelFields;
  /** reader that produced the fields */
  by: string;
  /** expiry, unix seconds */
  exp: number;
}

export class ReadTokenError extends Error {
  constructor(
    readonly code: "bad_read_token" | "read_token_expired" | "read_token_session",
    message: string,
  ) {
    super(message);
    this.name = "ReadTokenError";
  }
}

const sign = (secret: Buffer, body: string): Buffer => createHmac("sha256", secret).update(`ripple-label-read-v1.${body}`).digest();

/** What stands for a scope inside the token: a keyed one-way tag, never its id. */
export const readTokenScopeTag = (secret: Buffer, scopeId: string): string =>
  createHmac("sha256", secret).update(`ripple-label-read-scope-v1.${scopeId}`).digest("base64url").slice(0, 32);

export function signReadToken(
  input: Omit<ReadTokenPayload, "v" | "exp">,
  opts: { nowMs?: number; secret?: Buffer; ttlSec?: number } = {},
): string {
  const secret = opts.secret ?? blobSigningSecret();
  const payload: ReadTokenPayload = { v: 1, ...input, sid: readTokenScopeTag(secret, input.sid), exp: Math.floor((opts.nowMs ?? Date.now()) / 1000) + (opts.ttlSec ?? READ_TOKEN_SECONDS) };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body).toString("base64url")}`;
}

export function verifyReadToken(token: string, sessionId: string, opts: { nowMs?: number; secret?: Buffer } = {}): ReadTokenPayload {
  const secret = opts.secret ?? blobSigningSecret();
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ReadTokenError("bad_read_token", "malformed read token");
  const expected = sign(secret, parts[0]);
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ReadTokenError("bad_read_token", "read token signature does not match");
  let payload: ReadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as ReadTokenPayload;
  } catch {
    throw new ReadTokenError("bad_read_token", "read token payload is not JSON");
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || !payload.fields) throw new ReadTokenError("bad_read_token", "read token payload has the wrong shape");
  if (payload.exp * 1000 <= (opts.nowMs ?? Date.now())) throw new ReadTokenError("read_token_expired", "the label read has expired; photograph it again");
  if (payload.sid !== readTokenScopeTag(secret, sessionId)) throw new ReadTokenError("read_token_session", "the label read belongs to another session");
  return payload;
}
