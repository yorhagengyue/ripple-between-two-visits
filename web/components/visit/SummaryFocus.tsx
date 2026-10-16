"use client";

/**
 * Ripple's summary, large (scene 1 of the owner's video, 2026-10-15: "at good moments a summary appears and the summary
 * enlarges by itself, for the camera"). Wraps the summary card as a screen draws it (his RippleNotes, her live view's)
 * and, on top of it, the same points large:
 *
 *   by itself   `auto` (while he records): when a point arrives or changes, the card grows into a large view that fills
 *               most of the screen, the new point marked, for HOLD_MS (about 4 s), and settles back into the card
 *   by a tap    a tap on the card (or Enter / Space) opens the large view; a tap anywhere on it, or Escape, closes it
 *   compact     `clamp`: the card itself keeps to a few lines (the screen under it, the live captions, stays in view), the
 *               last of them fading out, with 「点一下放大看」 under it while there is more than fits; the large view has
 *               every point
 *   the first   `announceFirst`: the points the card opens with arrived just now (a screen that was already open when the
 *               first notes came), so they grow large too; without it the card's first points are taken as already seen
 *   motion      the large view grows out of the card and goes back into it (300 ms, iOS's curve, never past its end);
 *               with prefers-reduced-motion nothing moves or scales, the view only fades in and out
 * The points on the card itself are unchanged: the large view is a picture of the same words, with the same title and
 * the same quiet line that says they are Ripple's notes, not confirmed. Nothing is said aloud twice: the card keeps its
 * own aria-live; the large view is hidden from assistive technology while it opened by itself.
 *
 * The view is drawn in document.body (a page that slides in with a transform would otherwise be the frame of a fixed
 * element). Client-only; the server render is the card alone.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./summary-focus.css";

/** How long the large view stays when it opened by itself. */
export const HOLD_MS = 4000;
const MOVE_MS = 300;
const FADE_MS = 150;
const EASE = "cubic-bezier(.32, .72, 0, 1)";

type Phase = "closed" | "opening" | "open" | "closing";

/** Which points are new or changed against the ones shown before (their index), by their words. */
export function freshPoints(before: readonly string[], now: readonly string[]): number[] {
  const had = new Set(before.map((p) => p.trim()));
  return now.map((p, i) => (had.has(p.trim()) ? -1 : i)).filter((i) => i >= 0);
}

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SummaryFocus({
  variant,
  title,
  note,
  points,
  lang,
  auto = false,
  holdMs = HOLD_MS,
  openLabel,
  testId,
  clamp = false,
  announceFirst = false,
  children,
}: {
  /** his light screens, or her dark ones */
  variant: "elder" | "family";
  title: string;
  note: string;
  points: readonly string[];
  lang: "zh-Hans" | "en";
  /** grow by itself when a point arrives or changes (while he records) */
  auto?: boolean;
  holdMs?: number;
  /** what the card says to a screen reader as a control: 「放大看」 / "Show large" */
  openLabel: string;
  testId: string;
  /** keep the card to a few lines (see the header) */
  clamp?: boolean;
  /** the card's first points arrived just now: they grow large too (see the header) */
  announceFirst?: boolean;
  /** the card as the screen draws it */
  children: ReactNode;
}) {
  const [phase, setPhaseState] = useState<Phase>("closed");
  const [fresh, setFresh] = useState<number[]>([]);
  const [byItself, setByItself] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the points shown before the latest change (null: none yet since the screen opened) */
  const seen = useRef<readonly string[] | null>(null);
  /** the phase as last set (timers and animation callbacks read it between renders) */
  const phaseRef = useRef<Phase>("closed");
  const setPhase = useCallback((next: Phase | ((p: Phase) => Phase)) => {
    const value = typeof next === "function" ? next(phaseRef.current) : next;
    phaseRef.current = value;
    setPhaseState(value);
  }, []);

  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };

  const close = useCallback(() => {
    stopHold();
    const p = phaseRef.current;
    if (p === "closed" || p === "closing") return;
    setPhase("closing");
  }, [setPhase]);

  const open = useCallback(
    (self: boolean) => {
      setByItself(self);
      stopHold();
      if (self) hold.current = setTimeout(close, holdMs);
      const p = phaseRef.current;
      if (p === "open" || p === "opening") return;
      setPhase("opening");
    },
    [close, holdMs, setPhase],
  );

  // a point arrived or changed: mark it, and grow by itself (the points the screen opened with only when they are news)
  const key = points.join("\u0001");
  useEffect(() => {
    const before = seen.current ?? (announceFirst ? [] : null);
    seen.current = points;
    if (before === null) return;
    const changed = freshPoints(before, points);
    if (!changed.length) return;
    setFresh(changed);
    if (auto && points.length) open(phaseRef.current === "open" || phaseRef.current === "opening" ? byItself : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => stopHold(), []);

  // the motion: out of the card into the large view, and back. A change of mind half way (a new point while it settles
  // back) stops the running motion and starts the other one from where things are
  const running = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const view = big.current;
    const ground = scrim.current;
    if (phase !== "opening" && phase !== "closing") return;
    for (const a of running.current) a.cancel();
    running.current = [];
    if (!view || !ground || typeof view.animate !== "function") {
      setPhase((p) => (p === "opening" ? "open" : p === "closing" ? "closed" : p));
      return;
    }
    const reduced = reducedMotion();
    const from = card.current?.getBoundingClientRect();
    const to = view.getBoundingClientRect();
    const fromCard = from && from.width > 0 && to.width > 0 ? `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})` : "scale(.96)";
    if (phase === "opening") {
      const g = ground.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? FADE_MS : MOVE_MS, easing: "ease-out" });
      const v = reduced
        ? view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" })
        : view.animate([{ transform: fromCard, opacity: 0.5 }, { transform: "none", opacity: 1 }], { duration: MOVE_MS, easing: EASE });
      running.current = [g, v];
      v.onfinish = () => setPhase((p) => (p === "opening" ? "open" : p));
    } else {
      const g = ground.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? FADE_MS : MOVE_MS, easing: "ease-in", fill: "forwards" });
      const v = reduced
        ? view.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-in", fill: "forwards" })
        : view.animate([{ transform: "none", opacity: 1 }, { transform: fromCard, opacity: 0 }], { duration: MOVE_MS, easing: EASE, fill: "forwards" });
      running.current = [g, v];
      v.onfinish = () => setPhase((p) => (p === "closing" ? "closed" : p));
    }
  }, [phase, setPhase]);

  // Escape closes the large view
  useEffect(() => {
    if (phase === "closed") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  /** a tap on the card: the large view, nothing marked, until a tap closes it */
  const tapOpen = () => {
    setFresh([]);
    open(false);
  };
  const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tapOpen();
    }
  };

  // compact: whether the card holds more than it shows (measured after every change of the points and of its width)
  const clip = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = clip.current;
    if (!clamp || !el) return;
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 2);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp, key]);

  const shown = phase !== "closed";
  return (
    <>
      <div
        ref={card}
        className="rpsf-card"
        data-variant={variant}
        role="button"
        tabIndex={0}
        aria-label={openLabel}
        aria-expanded={shown}
        onClick={tapOpen}
        onKeyDown={onCardKey}
        data-testid={`${testId}-card`}
        data-focus={shown ? "open" : "closed"}
      >
        {clamp ? (
          <>
            <div ref={clip} className="rpsf-clip" data-over={over ? "true" : undefined}>
              {children}
            </div>
            {over ? (
              <p className="rpsf-more" aria-hidden="true">
                {openLabel}
              </p>
            ) : null}
          </>
        ) : (
          children
        )}
      </div>
      {/* only ever after a tap or a new point, so only in the browser: the server draws the card alone */}
      {shown
        ? createPortal(
            <div className="rpsf-layer" data-variant={variant} data-testid={`${testId}-focus`} data-by-itself={byItself ? "true" : undefined} data-phase={phase} onClick={close} aria-hidden={byItself ? true : undefined}>
              <div ref={scrim} className="rpsf-scrim" />
              <div ref={big} className={variant === "elder" ? "rpu rpsf-view" : "rpf rpsf-view"} role="dialog" aria-label={title} lang={lang}>
                <p className="rpsf-title">{title}</p>
                <ul className="rpsf-points">
                  {points.map((p, i) => (
                    <li key={`${i}-${p}`} data-fresh={fresh.includes(i) ? "true" : undefined} data-testid={`${testId}-focus-point`}>
                      {p}
                    </li>
                  ))}
                </ul>
                <p className="rpsf-note">{note}</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
