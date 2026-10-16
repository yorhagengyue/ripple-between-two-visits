/**
 * Runs in the browser before the app starts, on every page (Next.js 16: node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/instrumentation-client.md). Front-end line fe-12 added the file for one thing:
 * the router's own word that it has set off for another page (a link, router.push after a button, the browser's
 * back), passed on as a DOM event. The navigation mark (components/site/NavProgress.tsx) hears it, so the thin bar
 * also shows for a page change that code starts, not only for a tap on a link. Not sent for router.refresh().
 *
 * Keep it this small: it is part of every page's first code. Whoever adds to it: a hook that throws is caught by the
 * framework and never stops a navigation.
 */
import { NAV_START_EVENT, type NavStartDetail } from "@/components/site/nav-event";

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse"): void {
  const detail: NavStartDetail = { url, type: navigationType };
  window.dispatchEvent(new CustomEvent<NavStartDetail>(NAV_START_EVENT, { detail }));
}
