"use client";

/**
 * A day of his month as a sheet from the bottom (owner 10-15: every day of the month on Today can be opened; the demo
 * video's second scene opens today's and shows his reading outside the doctor's target with what he said about it). The
 * page draws it when the address names a day (/p/today?d=YYYY-MM-DD: components/daily/elder/OwnMonth.tsx links every
 * day there), so a reload shows the same; the rows are the server's (OwnDay), this is only the frame:
 *
 *   it comes up over the dimmed page (Today stays as it was under it), its head the day's date and 「关闭」; a tap on the
 *   dimmed page, 「关闭」 or Escape lets it go down and then follows the way back (`closeHref`, the address without the
 *   day, in place of this one: a day opened and closed leaves nothing to go back through). The page under it does not
 *   scroll while it is open. Above the ask button and the tab bar, under the long-press sheet (a row of it can be held).
 *
 * No router here: the way back is a link it follows itself, so the frame renders anywhere (tests render it to a string).
 * Test hooks: own-day (data-date), own-day-close, own-day-today (the way back's link), own-day-scrim.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/** How long it takes to go down (month.css rpu-daysheet-down); at once for someone who asked for less motion. */
const CLOSE_MS = 200;

export function OwnDaySheet({ date, title, closeHref, closeLabel, children }: { date: string; title: ReactNode; closeHref: string; closeLabel: string; children: ReactNode }) {
  const titleId = useId();
  const box = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLAnchorElement | null>(null);
  const [closing, setClosing] = useState(false);
  const leaving = useRef(false);

  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setClosing(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => back.current?.click(), reduce ? 0 : CLOSE_MS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    box.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // the page under the sheet stays where it is
  useEffect(() => {
    const body = document.body;
    const was = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = was;
    };
  }, []);

  return (
    <div className="rpu-daysheet-wrap" data-closing={closing ? "true" : undefined}>
      <button type="button" className="rpu-daysheet-scrim" aria-label={closeLabel} tabIndex={-1} onClick={close} data-testid="own-day-scrim" />
      <section
        ref={box}
        tabIndex={-1}
        className="rpu rpu-month-day rpu-daysheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-rp="own-day"
        data-testid="own-day"
        data-date={date}
      >
        <div className="rpu-daysheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="rpu-daysheet-close" onClick={close} data-testid="own-day-close">
            {closeLabel}
          </button>
        </div>
        <div className="rpu-daysheet-body">{children}</div>
        <Link ref={back} href={closeHref} replace scroll={false} prefetch={false} hidden tabIndex={-1} aria-hidden="true" data-testid="own-day-today">
          {closeLabel}
        </Link>
      </section>
    </div>
  );
}
