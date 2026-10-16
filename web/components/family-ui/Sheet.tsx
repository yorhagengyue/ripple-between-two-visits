"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";

/** It goes down this long when it closes (app/motion.css rpmo-sheet-down); at once for someone who asked for less motion. */
const CLOSE_MS = 220;

/**
 * The bottom sheet (the v3 draft's D4, the only layer above a screen): the screen underneath stays as it is, dimmed;
 * the sheet has a handle, one sentence, the line under it and what it needs. A tap on the dimmed screen or Escape
 * closes it. Nothing here decides anything: the caller owns `open`.
 *
 * The motion pass (owner 10-14, 「仿 iOS」; app/motion.css): it comes up from the bottom over the fading dim, and when
 * `open` turns false it stays a moment, marked data-closing, while it goes down (it takes no taps then), and is gone.
 * Closed from the start, it draws nothing, as before.
 */
export function FamilySheet({
  open,
  onClose,
  title,
  detail,
  children,
  closeLabel,
  className,
  style,
  ...rest
}: FamilyBaseProps & { open: boolean; onClose: () => void; title: ReactNode; detail?: ReactNode; children?: ReactNode; /** said to screen readers for the dimmed area */ closeLabel: string; "data-testid"?: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement | null>(null);
  // still drawn while it goes down: `open` turned false a moment ago
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = !open && shown;

  useEffect(() => {
    if (!closing) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setShown(false), reduce ? 0 : CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // the first field of the sheet takes the keyboard
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open && !shown) return null;
  return (
    <>
      <button type="button" className="rpf-scrim" aria-label={closeLabel} onClick={onClose} data-rp="sheet-scrim" data-closing={closing ? "true" : undefined} tabIndex={-1} />
      <div ref={box} className={cx("rpf rpf-sheet", className)} role="dialog" aria-modal="true" aria-labelledby={id} data-rp="sheet" data-rp-side="family" data-closing={closing ? "true" : undefined} data-testid={rest["data-testid"]} style={style}>
        <h2 className="rpf-h2" id={id}>
          {title}
        </h2>
        {detail && <p className="rpf-sub">{detail}</p>}
        {children}
      </div>
    </>
  );
}
