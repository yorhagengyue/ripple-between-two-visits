"use client";

/**
 * A day of his month as a sheet from the bottom, on her calendar (owner 10-15, the demo video's first scene: she taps
 * today's date and sees the visit with its time and the doctor; the second: the day shows his reading outside the
 * doctor's target with what he said that day). The page draws it when the address names a day (/f/month?link=&d=), so a
 * reload shows the same; the rows are the server's (app/f/month/page.tsx, each part inside <WhileShared> as on the
 * page), this is only the frame, drawn as her other sheets (the v3 draft's D4: .rpf-scrim, .rpf-sheet, app/motion.css):
 *
 *   it comes up over the dimmed calendar, its head the day's date and 「关闭」; a tap on the dimmed page, 「关闭」 or Escape
 *   lets it go down and then follows the way back (`closeHref`: the month without the day, in place of this address).
 *
 * No router here: the way back is a link it follows itself, so the frame renders anywhere (tests render it to a string).
 * Test hooks: month-sheet (data-date), month-sheet-close, month-sheet-back.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/** As her other sheets (components/family-ui/Sheet.tsx): it goes down this long when it closes. */
const CLOSE_MS = 220;

export function MonthDaySheet({ date, title, today, closeHref, closeLabel, children }: { date: string; title: ReactNode; today?: ReactNode; closeHref: string; closeLabel: string; children: ReactNode }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const back = useRef<HTMLAnchorElement | null>(null);
  const leaving = useRef(false);
  const [closing, setClosing] = useState(false);

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

  return (
    <>
      <button type="button" className="rpf-scrim" aria-label={closeLabel} onClick={close} data-rp="sheet-scrim" data-closing={closing ? "true" : undefined} tabIndex={-1} />
      <div
        ref={box}
        tabIndex={-1}
        className="rpf rpf-sheet rpf-month-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-rp="sheet"
        data-rp-side="family"
        data-closing={closing ? "true" : undefined}
        data-testid="month-sheet"
        data-date={date}
      >
        <div className="rpf-month-sheethead">
          <h2 className="rpf-month-dayhead" id={titleId}>
            {title}
            {today ? <span>{today}</span> : null}
          </h2>
          <button type="button" className="rpf-month-close" onClick={close} data-testid="month-sheet-close">
            {closeLabel}
          </button>
        </div>
        {children}
        <Link ref={back} href={closeHref} replace scroll={false} prefetch={false} hidden tabIndex={-1} aria-hidden="true" data-testid="month-sheet-back">
          {closeLabel}
        </Link>
      </div>
    </>
  );
}
