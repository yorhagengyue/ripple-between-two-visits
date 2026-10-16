/**
 * The name of the DOM event that says "the router has set off for another page" (front-end line fe-12). Sent by
 * web/instrumentation-client.ts, which is part of every page's first code, and heard by the navigation mark
 * (components/site/NavProgress.tsx). A module of its own so that the sender imports one string and nothing else of
 * the app.
 */
export const NAV_START_EVENT = "rp:nav-start";

export interface NavStartDetail {
  /** where the router is going, as it was asked (a path or a whole address) */
  url: string;
  /** a link or router.push ("push"), router.replace ("replace"), the browser's back and forward ("traverse") */
  type: string;
}
