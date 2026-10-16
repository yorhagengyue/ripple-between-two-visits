/**
 * Whose entry it is (C2 track O; real-app 2.25 「家里共用的手机尤其要紧」). Server-only.
 *
 * Every entry of the phone's to-send list is tagged with the account that tapped it, so it is never sent, nor shown,
 * under another account that later signs in on the same phone. The tag is "o" + 31 hex characters of
 * sha256("ripple-owner:" + the user id): stable, one-way, and not the id (an account's id never appears in what the
 * browser gets; the same idea as lib/blob/prefix.ts). The account's own pages carry it (components/offline), the phone
 * keeps it with each entry, and a late request names it in OUTBOX_OWNER_HEADER: a request whose tag is not the signed-in
 * account's is refused (409 other_account) before anything is read or written.
 */
import { createHash } from "node:crypto";
import { OUTBOX_OWNER_HEADER } from "./tap";

export function ownerTag(userId: string): string {
  return `o${createHash("sha256").update(`ripple-owner:${userId}`).digest("hex").slice(0, 31)}`;
}

/** True when the request names an owner and it is not this account (a request that names none is the page's own). */
export function sentForAnotherAccount(req: Pick<Request, "headers">, userId: string | null): boolean {
  const named = req.headers.get(OUTBOX_OWNER_HEADER)?.trim();
  if (!named) return false;
  return !userId || named !== ownerTag(userId);
}
