"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampFraction, clampUndoMs, fill, uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * 「已记下：吃了 · 8:47 [撤销 12 秒]」 (the draft's `toast`): an ink bar in the white strip at the bottom, above the say bar
 * and the tab bar. The message, a grey second line (`detail`: the time, the reason), and a white 「撤销」 button that
 * counts the seconds left. No confirm dialog anywhere: a tap does the thing, and this bar undoes it. 12 s by default,
 * never under 10 s.
 *
 * - `onUndo` / `onExpire` from a client component, or `undoHref` from a server one.
 * - `frozenAt` (0..1, the part of the time left) stops the clock: gallery and screenshots.
 * - placement "fixed" (pages), "absolute" (inside a positioned phone), "inline" (gallery rows: the ink bar alone).
 * - While a fixed or absolute bar is there, the <Screen> it stands on keeps the bar's height free under its last block.
 */
export function UndoToast({
  message,
  detail,
  locale,
  undoLabel,
  durationMs,
  onUndo,
  onExpire,
  undoHref,
  frozenAt,
  placement = "fixed",
  filming,
  className,
  style,
}: UiBaseProps & {
  message: ReactNode;
  /** the second line, in grey: when it was recorded, the reason he gave */
  detail?: ReactNode;
  locale: UiLocale;
  undoLabel?: string;
  durationMs?: number;
  onUndo?: () => void;
  onExpire?: () => void;
  undoHref?: string;
  frozenAt?: number;
  placement?: "fixed" | "absolute" | "inline";
}) {
  const copy = uiCopy(locale);
  const ms = clampUndoMs(durationMs);
  const frozen = frozenAt !== undefined;
  const [open, setOpen] = useState(true);
  // the seconds left, counted up to the next whole second (the same rule as the running clock below)
  const [left, setLeft] = useState(() => Math.max(1, Math.ceil(((frozen ? clampFraction(frozenAt) : 1) * ms) / 1000)));
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (frozen || !open) return;
    const started = Date.now();
    const t = window.setTimeout(() => {
      setOpen(false);
      expire.current?.();
    }, ms);
    const tick = window.setInterval(() => setLeft(Math.max(1, Math.ceil((ms - (Date.now() - started)) / 1000))), 250);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
    };
  }, [frozen, open, ms]);

  // The bar covers the foot of the page for as long as it is there: the screen it stands on is told how high it is
  // (--rpu-toast-h on the nearest .rpu-screen), and the page keeps that much more room under its last block, so the
  // last entry can be scrolled clear of the bar. Taken back when the bar goes.
  const bar = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bar.current;
    if (!open || !el || placement === "inline") return;
    const screen = el.closest<HTMLElement>(".rpu-screen");
    if (!screen) return;
    const tell = () => screen.style.setProperty("--rpu-toast-h", `${el.offsetHeight}px`);
    tell();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(tell);
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      screen.style.removeProperty("--rpu-toast-h");
    };
  }, [open, placement]);

  if (!open) return null;

  const label = undoLabel ?? copy.undo;
  const seconds = (
    <span className="rpu-toast-left" aria-hidden="true" data-rp="toast-left">
      {fill(copy.secondsLeft, { n: left })}
    </span>
  );
  return (
    <div
      ref={bar}
      className={cx("rpu rpu-toast", className)}
      data-rp="toast"
      data-placement={placement}
      data-duration-ms={ms}
      role="status"
      aria-live="polite"
      {...filmingAttr(filming)}
      style={style}
    >
      <div className="rpu-toast-in">
        <span className="rpu-toast-msg">
          <span>{message}</span>
          {detail != null && <span className="rpu-toast-sub">{detail}</span>}
        </span>
        {undoHref ? (
          <a className="rpu-toast-undo" href={undoHref}>
            {label}
            {seconds}
          </a>
        ) : (
          <button
            type="button"
            className="rpu-toast-undo"
            onClick={() => {
              setOpen(false);
              onUndo?.();
            }}
          >
            {label}
            {seconds}
          </button>
        )}
        {/* not drawn: the countdown is the number in the button; this carries the timing (tests, the gallery's frozen bars) */}
        <span className="rpu-toast-bar" aria-hidden="true">
          <span
            className="rpu-toast-bar-fill"
            data-running={frozen ? "false" : "true"}
            style={frozen ? { width: `${clampFraction(frozenAt) * 100}%` } : { width: "100%", animationDuration: `${ms}ms` }}
          />
        </span>
      </div>
    </div>
  );
}
