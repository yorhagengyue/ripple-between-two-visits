/**
 * Addresses of track H's own routes that pages put into a player or a link (C2 track H). Client-safe.
 *
 * His visit recording is never handed to a page as a signed link: the player gets this path on our own site, and
 * GET /api/me/export/recording signs a fresh 10-minute link each time it is asked (docs/plan/real-app.md 3.9 「浏览器只拿
 * 服务端签的 10 分钟链接」). A page left open keeps working, and no long-lived link sits in its HTML.
 */
export function recordingListenPath(visitId: string, part = 0): string {
  // C2 track R: a long recording is several files; `part` names one after the first (the player goes through them)
  return `/api/me/export/recording?visit=${encodeURIComponent(visitId)}${part > 0 ? `&part=${part}` : ""}`;
}
