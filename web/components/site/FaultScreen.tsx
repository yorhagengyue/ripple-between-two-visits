"use client";

/**
 * The screen for a page that could not be drawn (real-app 2.25 「存储读不到：照旧拒绝，不放行」; the timeline draft's 通用-2
 * for its look: a white box with the red border, the filled button under it, a second button with the ink border).
 * Drawn by the app's root error boundary (app/error.tsx) and by the one above it (app/global-error.tsx). When the
 * proxy sees the store's fault before any page is drawn it sends a static page of its own with the same look and the
 * same sentences (lib/subject/unavailable.ts storeUnavailablePage): change the two together.
 *
 *   what it says   the records could not be read (lib/subject getPageSubject threw StoreUnavailable; its digest reaches
 *                  the browser): the fixed sentences of lib/subject/unavailable.ts. Any other fault: one plain sentence
 *                  of this line's own (components/site/copy.ts) and what still holds. Never the fault's own text, never
 *                  a code, never an apology, and never a page built from a guess
 *   再试一次        asks the server for the page again (the boundary's `retry`: a fresh read, not the failed one redrawn)
 *   the way on     his pages (/p, /onboard): 「先看今天」 to Today; anywhere else: 「回到首页」 to the front door, which
 *                  sends a signed-in person on to where they belong (the browser cannot tell who is signed in: the
 *                  sign-in cookies are the server's). A plain link, so the page is loaded afresh
 *
 * It must hold when little else does. The boundary replaces everything under the root layout (his tab bar, her dark
 * frame, the account's providers), and the fault may be that the app's own CSS or a part of its code did not arrive.
 * So: no class of the app, no component of the app, no next/link, no web font it has to wait for. Every size and colour
 * is written here, as the foundation's variable with the draft's own value behind it: with the app's CSS the tokens
 * decide (and the phone's text size through --rp-u), without it the values do. It paints its own ground and marks
 * itself as a phone page (data-rp-phone: on a computer app/desktop.css keeps it a column) and as an elder screen
 * (data-rp-side: the page checks hold it to 18px text and 48px targets).
 *
 * Test hooks (the first two are track A's and stay): store-unavailable (data-fault "store" | "page"),
 * store-unavailable-retry, fault-way-on (data-way "today" | "front").
 */
import { useSyncExternalStore, type CSSProperties } from "react";
import { STORE_UNAVAILABLE_WORDS } from "@/lib/subject/unavailable";
import { phoneLanguage, SITE_WORDS, type SiteLocale } from "./copy";

/** lib/subject/unavailable.ts StoreUnavailable carries this digest; the framework hands a server fault's digest on. */
export const STORE_FAULT_DIGEST = "RIPPLE_STORE_UNAVAILABLE";

export type Fault = (Error & { digest?: string }) | { digest?: string; name?: string } | null | undefined;

/** Is this fault "the records could not be read"? Only then does the screen say so. */
export function isStoreFault(fault: Fault): boolean {
  return !!fault && (fault.digest === STORE_FAULT_DIGEST || fault.name === "StoreUnavailable");
}

/** Where the second button leads from the page that failed. */
export function wayOn(pathname: string): { way: "today" | "front"; href: string } {
  return /^\/(p|onboard)(\/|$)/.test(pathname) ? { way: "today", href: "/p/today" } : { way: "front", href: "/" };
}

/** N design px: the foundation's unit when its CSS is here, a sixteenth of the root's text size when it is not. */
const u = (n: number) => `calc(${n} * var(--rp-u, 0.0625rem))`;

const INK = "var(--rp-ink, #18202C)";
const WHITE = "var(--rp-white, #FFFFFF)";

const S: Record<"screen" | "brand" | "box" | "title" | "body" | "retry" | "on", CSSProperties> = {
  screen: {
    boxSizing: "border-box",
    minHeight: "100dvh",
    maxWidth: u(430),
    margin: "0 auto",
    padding: "4px 20px 40px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    alignContent: "start",
    gap: 18,
    background: "var(--rp-paper, #F2F5F9)",
    color: INK,
    fontFamily: 'var(--rp-font-sans, "Noto Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif)',
    lineHeight: 1.45,
    letterSpacing: "normal",
    WebkitFontSmoothing: "antialiased",
    textAlign: "left",
  },
  brand: { margin: "8px 0 0", fontSize: u(36), fontWeight: 900, lineHeight: 1.2 },
  box: {
    display: "grid",
    gap: 6,
    padding: "16px 18px",
    borderRadius: 16,
    background: WHITE,
    border: "2.5px solid var(--rp-urgent, #A4262C)",
  },
  title: { margin: 0, fontSize: u(22), fontWeight: 800, lineHeight: 1.4 },
  body: { margin: 0, fontSize: u(19), fontWeight: 400, lineHeight: 1.55, color: "var(--rp-ink-2, #2C3644)" },
  retry: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: "100%",
    minHeight: u(72),
    padding: `6px ${u(16)}`,
    border: 0,
    borderRadius: 16,
    background: "var(--rp-accent, #6A4C93)",
    color: "var(--rp-on-accent, #FFFFFF)",
    font: "inherit",
    fontSize: u(26),
    fontWeight: 800,
    lineHeight: 1.25,
    textAlign: "center",
    cursor: "pointer",
  },
  on: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: "100%",
    minHeight: u(64),
    padding: `6px ${u(16)}`,
    border: `2px solid ${INK}`,
    borderRadius: 16,
    background: WHITE,
    color: INK,
    fontSize: u(23),
    fontWeight: 700,
    lineHeight: 1.25,
    textAlign: "center",
    textDecoration: "none",
  },
};

const never = () => () => undefined;

export function FaultScreen({ fault, retry }: { fault?: Fault; retry?: () => void }) {
  // the phone's language and the page that failed are the browser's to say; on the server: 华语, the front door
  const lang = useSyncExternalStore<SiteLocale>(never, phoneLanguage, () => "zh-Hans");
  const pathname = useSyncExternalStore(never, () => window.location.pathname, () => "/");
  const store = isStoreFault(fault);
  const w = SITE_WORDS[lang];
  const said = store ? STORE_UNAVAILABLE_WORDS[lang] : w.fault;
  const on = wayOn(pathname);
  return (
    <main lang={lang} data-testid="store-unavailable" data-fault={store ? "store" : "page"} data-rp-side="elder" data-rp-phone="" style={S.screen}>
      <p style={S.brand} translate="no">
        Ripple
      </p>
      <div role="alert" style={S.box}>
        <h1 style={S.title}>{said.title}</h1>
        <p style={S.body}>{said.body}</p>
      </div>
      <button type="button" onClick={() => (retry ? retry() : window.location.reload())} data-testid="store-unavailable-retry" style={S.retry}>
        {said.retry}
      </button>
      <a href={on.href} data-testid="fault-way-on" data-way={on.way} style={S.on}>
        {on.way === "today" ? w.seeToday : w.toFront}
      </a>
    </main>
  );
}
