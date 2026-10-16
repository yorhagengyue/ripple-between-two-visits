"use client";

/**
 * The note beside the phone column on a computer (owner, 2026-10-11: judges open the site on a laptop): two sentences
 * in the phone's language, saying that this is a phone app shown here as a column, and a QR code that opens the
 * site's front door on a phone. Mounted once by app/layout.tsx; app/desktop.css places and colours it.
 *
 *   where     only in a window at least 1100px wide, only on a phone page (a column of app/desktop.css, or one of Wei
 *             Ling's screens, is in the document), and only while there is room beside the column (a very large text
 *             size widens the column). Anywhere else it is not in the DOM at all: not on the pages made for a computer
 *             (/demo, /how, /eval, the crew's pages, /design), not at phone widths, not inside the phone that /demo
 *             shows in its frame (that frame is a narrow window of its own).
 *   when      nothing on the server and nothing on the first client render, so there is no hydration mismatch and the
 *             page is never delayed or shifted (the note is position: fixed, outside the page's flow). After mounting it
 *             looks again whenever the window is resized, the route changes, the page's DOM changes (a screen that
 *             arrives late, the language switch) or the root element's text size is set.
 *   the code  the site's own origin plus "/", never the current path and nothing about the person; drawn here from
 *             lib/crew/qr.ts, no request leaves the browser. Its address is not written out as text.
 *   language  the `lang` of the page's own screen: whatever that page decided (its ?lang=, the rp_lang cookie, the
 *             account's setting), the note says the same.
 *   colours   from the stage as it really is behind the column: data-stage="dark" when <body> is dark (her screens,
 *             the sign-in pages), "light" otherwise.
 *
 * The words must not repeat anything a page shows (components/desktop/copy.ts says why).
 */
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { encodeQr, qrSvgPath } from "@/lib/crew/qr";
import { DESK_COLUMN_UNITS, DESK_NOTE_GAP, DESK_NOTE_MARGIN, DESK_NOTE_MEDIA, DESK_NOTE_UNITS, DESK_PHONE_PAGE } from "./column";
import { deskCopy, deskLocale, type DeskLocale } from "./copy";

interface NoteView {
  locale: DeskLocale;
  stage: "light" | "dark";
  /** the front door of this site */
  url: string;
}

/** Is this colour (a computed "rgb(r, g, b)") a dark ground? Anything unreadable or transparent counts as light. */
function isDark(color: string): boolean {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(color.trim());
  if (!m) return false;
  if (m[4] !== undefined && Number(m[4]) === 0) return false;
  return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]) < 96;
}

/** What the note should be right now, or null when it has no place on this page or in this window. */
function readView(): NoteView | null {
  if (!window.matchMedia(DESK_NOTE_MEDIA).matches) return null;
  const column = document.querySelector(DESK_PHONE_PAGE);
  if (!column) return null;
  // Room beside the column. app/desktop.css puts the note at the window's middle plus half a column plus the gap, and
  // makes it DESK_NOTE_UNITS wide; both grow with the text size, like the column. The unit is read off the root's font
  // size as the foundation defines it (1px at 16px, never above 2.5px).
  const unit = Math.min((parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16, 2.5);
  const width = document.documentElement.clientWidth;
  const left = width / 2 + (DESK_COLUMN_UNITS / 2) * unit + DESK_NOTE_GAP;
  // the column reaches into the note's place (it is wider than a column, or not in the middle)
  if (column.getBoundingClientRect().right > left - DESK_NOTE_GAP / 2) return null;
  // the note would not fit before the window's edge
  if (left + DESK_NOTE_UNITS * unit + DESK_NOTE_MARGIN > width) return null;
  return {
    locale: deskLocale(column.closest("[lang]")?.getAttribute("lang")),
    stage: isDark(getComputedStyle(document.body).backgroundColor) ? "dark" : "light",
    url: `${window.location.origin}/`,
  };
}

const same = (a: NoteView | null, b: NoteView | null) => a === b || (!!a && !!b && a.locale === b.locale && a.stage === b.stage && a.url === b.url);

export function DeskNote() {
  const pathname = usePathname();
  const [view, setView] = useState<NoteView | null>(null);

  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      const next = readView();
      setView((prev) => (same(prev, next) ? prev : next));
    };
    // at most once a frame, however many things changed
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(look);
    };
    soon();
    const wide = window.matchMedia(DESK_NOTE_MEDIA);
    wide.addEventListener("change", soon);
    window.addEventListener("resize", soon);
    // a screen that arrives after this effect (a streamed page, a client step), the language switch, a root that gets
    // its mark late
    const seen = new MutationObserver(soon);
    seen.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "lang", "data-rp-phone", "data-fill"] });
    // the text size, when it is set on the root element itself (the column and the note grow with it)
    const root = new MutationObserver(soon);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      wide.removeEventListener("change", soon);
      window.removeEventListener("resize", soon);
      seen.disconnect();
      root.disconnect();
    };
    // the route: look again on every change of page, even one that keeps its DOM
  }, [pathname]);

  const url = view?.url ?? null;
  const qr = useMemo(() => {
    const code = url ? encodeQr(url) : null;
    return code ? qrSvgPath(code) : null;
  }, [url]);

  if (!view) return null;
  const w = deskCopy(view.locale);
  return (
    <aside className="rpdesk-note" data-testid="desk-note" data-stage={view.stage} lang={view.locale} aria-label={w.label}>
      {qr ? (
        <svg className="rpdesk-note-qr" data-testid="desk-note-qr" data-url={view.url} role="img" aria-label={w.code} viewBox={`0 0 ${qr.width} ${qr.width}`} shapeRendering="crispEdges">
          <rect width={qr.width} height={qr.width} fill="#FFFFFF" />
          <path d={qr.d} fill="#18202C" />
        </svg>
      ) : null}
      <p className="rpdesk-note-lead">{w.lead}</p>
      <p className="rpdesk-note-text">{w.text}</p>
    </aside>
  );
}
