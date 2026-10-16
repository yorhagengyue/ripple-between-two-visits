"use client";

/**
 * The mark that shows the next page is on its way (front-end line fe-12). Every page of the app is drawn on the server
 * from the person's own data, so a tap on a link or on the tab bar shows nothing until the server has answered; on the
 * real database that is a visible moment each time. A loading boundary would hide it, but it would also turn a page's
 * redirect() and notFound() into a 200 with a redirect done in the browser, and the proxy and the specs expect 307 and
 * 404. So instead: one thin bar at the top of the phone page.
 *
 *   from     the moment he taps an internal link (the tab bar's are links): a plain left click or a tap, on this site,
 *            to another page (not a part of this page, not a file or an API address, not a new window); and the moment
 *            the router sets off for another page by itself (router.push after a button: the question he typed, the
 *            visit he ended, a step of setting up; the browser's back). The router says so through
 *            web/instrumentation-client.ts
 *   shown    only once 300 ms have passed with the old page still there: a page that arrives sooner shows nothing
 *   until    the page drawn has changed, or the address has (the framework changes it when the new page is drawn),
 *            or 8 s have passed
 *   says     「正在打开……」 to a screen reader, in the page's language, and marks the phone screen busy (aria-busy)
 *   never    blocks a tap (it takes no pointer events) or moves the page (it is fixed over the top edge, 4px)
 *
 * Only on the phone pages, his and hers: not on the pages made for a computer (/demo, /how, /eval, /director,
 * /backstage, /design). On a computer a phone page is a column in the middle of the window (app/desktop.css): the bar
 * carries data-rp-phone-fixed, which that file keeps inside the column.
 *
 * Mounted once, in app/layout.tsx. Not started by router.refresh() (a page reading its own data again is not a page
 * change) nor by a change of ?query alone that code makes (the same screen answering a tap). A route that has a
 * loading boundary of its own (blood pressure, prevention, diet) changes the address as soon as its outline is drawn,
 * so there the mark ends at once or never shows: the page's own outline is the sign of work. Test hook: nav-progress
 * (data-busy).
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { phoneLanguage, siteWords } from "./copy";
import { NAV_START_EVENT, type NavStartDetail } from "./nav-event";
import "./nav-progress.css";

/** The pages made for a computer: no mark there. */
export const NOT_PHONE_PAGES = /^\/(demo|how|eval|director|backstage|design)(\/|$)/;
export const SHOW_AFTER_MS = 300;
export const GIVE_UP_MS = 8000;
const POLL_MS = 100;

/** The page a click on `target` would open, when that is another page of this site reached in this window; else null. */
export function internalDestination(e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">, here: Location | URL): URL | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement)) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  let to: URL;
  try {
    to = new URL(a.href, here.href);
  } catch {
    return null;
  }
  if (to.origin !== here.origin) return null; // another site, tel:, mailto:
  if (to.pathname === "/api" || to.pathname.startsWith("/api/")) return null; // a sound clip, a file
  if (to.pathname === here.pathname && to.search === here.search) return null; // this page (or a part of it)
  return to;
}

/**
 * The page the router has just set off for, when that is another page than the one drawn now; else null. `drawn` is
 * the path of the page on the screen: with the browser's back and forward the address has changed already, so the
 * address cannot say where he is coming from. The same page with another ?query is not another page.
 */
export function routedDestination(url: string, here: Location | URL, drawn: string | null): URL | null {
  let to: URL;
  try {
    to = new URL(url, here.href);
  } catch {
    return null;
  }
  if (to.origin !== here.origin) return null;
  return to.pathname === (drawn ?? here.pathname) ? null : to;
}

interface Pending {
  from: string;
  show: number;
  stop: number;
  poll: number;
  marked: Element | null;
}

export function NavProgress() {
  const pathname = usePathname();
  const [busy, setBusy] = useState<{ words: string } | null>(null);
  const pending = useRef<Pending | null>(null);
  /** the path of the page on the screen (the address runs ahead of it on the browser's back and forward) */
  const drawn = useRef<string | null>(pathname);

  const stop = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(p.show);
    window.clearTimeout(p.stop);
    window.clearInterval(p.poll);
    p.marked?.removeAttribute("aria-busy");
    setBusy(null);
  }, []);

  const start = useCallback(() => {
    stop();
    const from = window.location.pathname + window.location.search;
    const p: Pending = { from, show: 0, stop: 0, poll: 0, marked: null };
    p.show = window.setTimeout(() => {
      if (pending.current !== p) return;
      // the phone screen on this page: it is the part that is about to be replaced
      const screen = document.querySelector("[data-rp-side]");
      if (screen && !screen.hasAttribute("aria-busy")) {
        screen.setAttribute("aria-busy", "true");
        p.marked = screen;
      }
      setBusy({ words: siteWords(screen?.getAttribute("lang") ?? phoneLanguage()).opening });
    }, SHOW_AFTER_MS);
    p.stop = window.setTimeout(() => {
      if (pending.current === p) stop();
    }, GIVE_UP_MS);
    // the address changes when the next page is drawn (and a change of ?query alone is a change too)
    p.poll = window.setInterval(() => {
      if (pending.current === p && window.location.pathname + window.location.search !== from) stop();
    }, POLL_MS);
    pending.current = p;
  }, [stop]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (NOT_PHONE_PAGES.test(window.location.pathname)) return;
      if (internalDestination(e, window.location)) start();
    };
    // the router set off by itself, or for the link just tapped (then the mark is already waiting: left as it is)
    const onRouted = (e: Event) => {
      const detail = (e as CustomEvent<NavStartDetail | undefined>).detail;
      if (!detail || typeof detail.url !== "string") return;
      if (NOT_PHONE_PAGES.test(drawn.current ?? window.location.pathname)) return;
      if (!pending.current && routedDestination(detail.url, window.location, drawn.current)) start();
    };
    // in the capture phase: the framework's own link handler cancels the click's default before it bubbles up
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START_EVENT, onRouted);
    // a page brought back whole by the browser's back button was left with its mark up
    window.addEventListener("pageshow", stop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAV_START_EVENT, onRouted);
      window.removeEventListener("pageshow", stop);
      stop();
    };
  }, [start, stop]);

  // the route changed: the page he asked for is here
  useEffect(() => {
    drawn.current = pathname;
    stop();
  }, [pathname, stop]);

  if (pathname && NOT_PHONE_PAGES.test(pathname)) return null;
  return (
    <div className="rp12-nav" data-rp-phone-fixed="" data-testid="nav-progress" data-busy={busy ? "true" : "false"} role="status" aria-live="polite">
      {busy ? <span className="rp12-nav-bar" aria-hidden="true" /> : null}
      <span className="rp12-nav-sr">{busy ? busy.words : ""}</span>
    </div>
  );
}
