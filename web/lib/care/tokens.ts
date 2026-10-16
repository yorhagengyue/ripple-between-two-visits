/**
 * The one-time invitation link (C2 track D; real-app 3.10: 32 random bytes, only the sha256 stored, 7 days). Server-only.
 *
 *   token   "<link id>.<43 base64url characters>" (the link id is a uuid; the secret is 32 random bytes)
 *   stored  care_link.invite_token_hash = sha256(token) as hex; the token itself is handed out once, in his answer to
 *           the invitation, and never stored or logged
 *   URL     /invite/<token>
 *
 * The link id rides in the token so her page can find the invitation without a lookup by hash, then compares the
 * hashes (in constant time) before showing anything: the id alone opens nothing.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const INVITE_DAYS = 7;
export const INVITE_MS = INVITE_DAYS * 86_400_000;

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export interface NewInviteToken {
  linkId: string;
  token: string;
  hash: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh link id and its one-time token. */
export function newInviteToken(): NewInviteToken {
  const linkId = randomUUID();
  const token = `${linkId}.${randomBytes(32).toString("base64url")}`;
  return { linkId, token, hash: hashToken(token) };
}

/** The link id inside a well-formed token; null for anything else. */
export function tokenLinkId(token: string | null | undefined): string | null {
  const m = TOKEN_RE.exec((token ?? "").trim());
  return m ? m[1] : null;
}

/** Does this token belong to the stored hash? (constant time; false for a missing hash) */
export function tokenMatches(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !tokenLinkId(token)) return false;
  const a = Buffer.from(hashToken(token.trim()), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function invitePath(token: string): string {
  return `/invite/${token}`;
}
