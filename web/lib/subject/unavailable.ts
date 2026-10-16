/**
 * When the store (or the identity provider) cannot be read (docs/plan/real-app.md 2.25 「存储读不到：照旧拒绝，不放行，503」;
 * C2 track A). Who a request is for can then not be told, so it is refused with 503 and a plain body: never let
 * through, never answered from a guess (not "signed out", not "no profile", not an empty list), and never an unhandled
 * 500. The demo's device check already answers 503 role_unavailable the same way (lib/family/role.ts).
 *
 *   isStoreUnavailable(err)       a failed read that says "could not tell": a PostgREST call with no response, a
 *                                 timeout, a 5xx, or the database refusing the server's own key (401, 403, 408, 429);
 *                                 the identity provider not answering (AuthError unavailable). A constraint, a missing
 *                                 row or a malformed query is NOT this: those are answers (and bugs stay 500s).
 *   storeUnavailableResponse()    503 { error: "store_unavailable", detail } with Retry-After, never cached
 *   storeUnavailablePage(locale)  the same for a page request: 503 with one plain sentence and 「再试一次」
 *
 * No imports from the store or the provider: the classes are recognised by name and shape, because production builds
 * put them in several chunks (lib/store/types.ts StoreError has the same note) and the proxy bundle has its own copy.
 */
import { NextResponse } from "next/server";

export const STORE_UNAVAILABLE = "store_unavailable";
export const STORE_UNAVAILABLE_DETAIL = "Ripple could not read its records just now. Nothing was changed. Try again in a moment.";
export const STORE_RETRY_AFTER_S = 5;

/** What his screen says (fixed copy; nothing clinical, nothing about why). */
export const STORE_UNAVAILABLE_WORDS = {
  "zh-Hans": { title: "现在读不到资料。", body: "所以先不显示。你记下的东西都还在，过一会儿再试一次。", retry: "再试一次" },
  en: { title: "Ripple cannot read your records right now.", body: "So nothing is shown. Everything you saved is still there. Try again in a moment.", retry: "Try again" },
} as const;

const REFUSED_BY_DATABASE = new Set([401, 403, 408, 429]);

/** Did this error come from a read that could not be made (see the file header)? */
export function isStoreUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; status?: unknown; code?: unknown };
  if (e.name === "PostgrestError" && typeof e.status === "number") return e.status === 0 || e.status >= 500 || REFUSED_BY_DATABASE.has(e.status);
  if (e.name === "AuthError") return e.code === "unavailable";
  if (e.name === "StoreUnavailable") return true;
  return false;
}

/** Thrown where a response cannot be returned (a page's subject); the error boundary and the proxy know it by name. */
export class StoreUnavailable extends Error {
  readonly digest = "RIPPLE_STORE_UNAVAILABLE";
  constructor(where: string) {
    super(`the store could not be read (${where})`);
    this.name = "StoreUnavailable";
  }
}

let lastWarn = 0;
/** One line at most every 10 s: where it happened and the error's short message, never a value. */
export function warnStoreUnavailable(where: string, err: unknown): void {
  const now = Date.now();
  if (now - lastWarn < 10_000) return;
  lastWarn = now;
  console.warn(`[store] unavailable at ${where}: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
}

/** 503 store_unavailable for an API request. */
export function storeUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: STORE_UNAVAILABLE, detail: STORE_UNAVAILABLE_DETAIL },
    { status: 503, headers: { "Retry-After": String(STORE_RETRY_AFTER_S), "Cache-Control": "private, no-store" } },
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * 503 for a page request, as a small page of its own (the app's pages cannot render without the store): one sentence,
 * what still holds, and a link that asks for the same page again. `retryHref` must be a path on this site.
 *
 * Front-end line fe-12 (only the look): the same screen as the app's error screen (components/site/FaultScreen.tsx,
 * the timeline design's 通用-2): the cool paper ground, 「Ripple」 as the title, the sentence in a white box with the red
 * border, the one filled button. The proxy sends this page before any of the app's CSS, so the design's own values are
 * written out; the sizes are in rem (1rem = 16 design px) so they follow the phone's text size, nothing under 18px. On
 * a computer it is the 430px column the app's phone pages are. The words, the answer and its headers are track A's.
 */
export function storeUnavailablePage(locale: "zh-Hans" | "en", retryHref: string): NextResponse {
  const w = STORE_UNAVAILABLE_WORDS[locale];
  const href = retryHref.startsWith("/") && !retryHref.startsWith("//") ? retryHref : "/";
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F2F5F9">
<title>Ripple</title>
<style>
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { margin: 0; background: #F2F5F9; color: #18202C; font-family: "Noto Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  main { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 1.125rem; min-height: 100vh; min-height: 100dvh; max-width: 26.875rem; margin: 0 auto; padding: 0.25rem 1.25rem 2.5rem; background: #F2F5F9; }
  .brand { margin: 0.5rem 0 0; font-size: 2.25rem; line-height: 1.2; font-weight: 900; }
  .box { display: grid; gap: 0.375rem; padding: 1rem 1.125rem; border: 2.5px solid #A4262C; border-radius: 1rem; background: #FFFFFF; }
  h1 { margin: 0; font-size: 1.375rem; line-height: 1.4; font-weight: 800; }
  .say { margin: 0; font-size: 1.1875rem; line-height: 1.55; color: #2C3644; }
  .btn { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 4.5rem; padding: 0.375rem 1rem; border-radius: 1rem; background: #6A4C93; color: #FFFFFF; font-size: 1.625rem; line-height: 1.25; font-weight: 800; text-align: center; text-decoration: none; }
  .btn:active { background: #4E3672; }
  .btn:focus-visible { outline: 3px solid #6A4C93; outline-offset: 2px; }
  @media screen and (min-width: 720px) { html, body { background: #E1E7EE; } main { box-shadow: 0 0 0 1px #D5DCE5; } }
</style>
</head>
<body>
<main data-testid="store-unavailable" data-rp-side="elder">
<p class="brand" translate="no">Ripple</p>
<div class="box" role="alert">
<h1>${esc(w.title)}</h1>
<p class="say">${esc(w.body)}</p>
</div>
<a class="btn" href="${esc(href)}" data-testid="store-unavailable-retry">${esc(w.retry)}</a>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(STORE_RETRY_AFTER_S), "Cache-Control": "private, no-store" },
  });
}
