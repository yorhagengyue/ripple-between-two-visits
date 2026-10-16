/**
 * How long one event stream lives (C2 track L; docs/plan/real-app.md 3.4 续期, line 476:
 * 「事件流由 BUS_STREAM_MAX_MS（5 分钟）到点结束。浏览器带 Last-Event-ID 重连时，经过代理续期。」). No imports.
 *
 * Every /api/events stream ends itself after this long, with either store. The browser's EventSource comes straight
 * back with Last-Event-ID (or the page's ?since=), so nothing is lost or repeated, and the new request passes the
 * proxy again: the sign-in is renewed there, and a session that was signed out in the meantime gets no new stream.
 * Before it ends, the stream tells the browser to come back after RENEW_RETRY_MS instead of the usual second, so a
 * page that follows another within a second keeps doing so across the change.
 *
 *   BUS_STREAM_MAX_MS   empty, not a number, or 0 and below: 5 minutes. Hosting sets 290000 (hosting.md 5.5). Kept
 *                       between 0.1 second (tests) and 15 minutes (the longest the app keeps an access token).
 */

export const DEFAULT_STREAM_MAX_MS = 5 * 60_000;
export const MIN_STREAM_MAX_MS = 100;
export const MAX_STREAM_MAX_MS = 15 * 60_000;

/** The reconnect delay a stream announces just before it ends on time (the usual one is the route's `retry: 1000`). */
export const RENEW_RETRY_MS = 100;

/** The last frame of a stream that ends on time: only a reconnect delay, no event. */
export const RENEW_FRAME = `retry: ${RENEW_RETRY_MS}\n\n`;

export function streamMaxMs(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.BUS_STREAM_MAX_MS ?? "").trim();
  const n = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STREAM_MAX_MS;
  return Math.min(MAX_STREAM_MAX_MS, Math.max(MIN_STREAM_MAX_MS, Math.floor(n)));
}
