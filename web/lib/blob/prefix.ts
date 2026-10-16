/**
 * Where a scope's files live in the buckets (lib/blob/paths.ts: every path starts with this prefix). Server-only.
 *
 *   demo      the session id, as before (audio/<session>/visits/..., labels/<session>/labels/...)
 *   account   "a" + 31 hex characters of sha256("ripple-scope:" + the scope id): stable, one-way, and not the id. An
 *             account's upload paths and links are handed to the browser (the upload link, the path it sends back),
 *             and an account's id never appears in what the browser gets (C2 architecture review, finding 8).
 * The orphan sweep (track H) recomputes the prefix of every live scope the same way.
 */
import { createHash } from "node:crypto";
import type { SessionRow } from "@/lib/store/types";

export function blobPrefix(scope: Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>): string {
  if (scope.kind !== "account") return scope.id;
  return `a${createHash("sha256").update(`ripple-scope:${scope.id}`).digest("hex").slice(0, 31)}`;
}

// ---------------------------------------------------------------- C2 track H (only add): whose file inside a folder

/**
 * The stand-in for a person's id in a file NAME (docs/plan/real-app.md 3.10 「录提醒：文件存在他的前缀下，文件名带她的用户编号前缀」):
 * "u" + 31 hex characters of sha256("ripple-user:" + the user id). One-way and not the id, for the same reason as the
 * folder prefix above: upload paths and links are handed to the browser, and his export lists his files. It is not her
 * own folder's name either (a different derivation), so a file name never points at another person's folder.
 * Her export and her account deletion recompute it to find the recordings she uploaded into his folder.
 */
export function blobUserTag(userId: string): string {
  return `u${createHash("sha256").update(`ripple-user:${userId}`).digest("hex").slice(0, 31)}`;
}

/** Is `path` a reminder recording in the folder `prefix` that the person with this tag uploaded? */
export function reminderFileOf(prefix: string, tag: string, path: string): boolean {
  return typeof path === "string" && path.startsWith(`${prefix}/reminders/${tag}-`);
}

/**
 * Does `path` belong to this subject (real-app 6.14 「pathInSession 改成 pathOwnedBy(subject, path)」)? Use before signing
 * or registering a path the browser sent back.
 *   his own side (self, a scheduled job, the demo)   anything under the scope's prefix
 *   her, through her care link                       only a reminder recording she uploaded herself: under his prefix,
 *                                                    in reminders/, the file name starting with her tag
 */
export function pathOwnedBy(subject: { scope: Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>; relation: string; userId: string | null }, path: string): boolean {
  if (typeof path !== "string" || path.includes("..") || path.includes("\\") || path.includes("//")) return false;
  const prefix = blobPrefix(subject.scope);
  if (subject.relation === "family") return !!subject.userId && reminderFileOf(prefix, blobUserTag(subject.userId), path);
  return path.startsWith(`${prefix}/`);
}

