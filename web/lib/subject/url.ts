/**
 * Links the server builds for a scope (docs/plan/real-app.md 3.7 scopedUrl, H1). Client-safe, pure.
 *
 *   demo      the session id rides along as ?session=<id>, exactly as before (the judge's iframe, the tests)
 *   account   nothing is added: the browser's own sign-in cookie names the scope, and an account's id never appears in
 *             a link, a page or an event (C2 architecture review: 真账号用的页面、链接、事件里不带空间编号)
 * Her links to his things (family) name her care link instead: linkUrl.
 */
import type { SessionRow } from "@/lib/store/types";

function withParam(path: string, name: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${name}=${encodeURIComponent(value)}`;
}

/** `path` for this scope: with ?session= for a demo row, unchanged for an account. */
export function scopedUrl(scope: Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>, path: string): string {
  if (scope.kind === "account" || !scope.id) return path;
  return withParam(path, "session", scope.id);
}

/** `path` through her care link (?link=<id>), for the few routes that accept it. */
export function linkUrl(linkId: string, path: string): string {
  return withParam(path, "link", linkId);
}

/**
 * The scope row as the browser may have it: a demo row unchanged (its id is how the demo pages name their session);
 * an account's row without its id, owner or join code (the browser is identified by its cookie instead).
 */
export function clientScope<T extends Pick<SessionRow, "id" | "kind" | "owner_user_id" | "join_code">>(row: T): T {
  if (row.kind !== "account") return row;
  return { ...row, id: "", owner_user_id: null, join_code: null };
}
