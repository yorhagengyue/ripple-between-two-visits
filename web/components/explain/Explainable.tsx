"use client";

/**
 * Hold anything, Ripple investigates (owner's decision of 10-14, modelled on his iOS app's long press:
 * RippleApp/Explain/ExplainLongPress.swift). Wraps ONE element that stands for one of his records; holding it for half
 * a second opens Ripple's read of it (ExplainSheet.tsx). There is no AI button anywhere: the thing itself is the way in.
 * (The medicine's explain card, ExplainCard.tsx in this folder, is the draft's 06-8 and another thing.)
 *
 *   the gesture   pointer down starts a 500 ms hold; moving more than 10px, lifting, a cancelled pointer (the page
 *                 scrolls) or the window losing focus ends it and nothing happened: an ordinary tap still does what it
 *                 did (a row that is a link opens). At 500 ms: a short vibration where the phone has one, the click
 *                 that would follow is swallowed, the sheet opens.
 *   while holding the element dips to 0.97 and a ring in his accent charges around it over the 500 ms (explain.css;
 *                 CSS only). prefers-reduced-motion: no dip, the ring is simply there.
 *   not his       no text selection and no long-press menu on the element (user-select, -webkit-touch-callout, the
 *                 context menu of a touch or a pen).
 *   their own     a press that starts on one of the app's buttons, fields or players inside the element stays that
 *                 control's (OWN_PRESS): 「吃了」 held a little long is still 「吃了」. A row that is itself a button or a
 *                 link is the element, and can be held.
 *   without       a keyboard or a screen reader cannot hold: every element carries a button 「问 Ripple」, not seen until
 *                 it has the focus, that opens the same sheet. Its words are its aria-label, so the element's own text
 *                 is unchanged. It is marked data-check-allow: the page checks' 48px rule is for what a finger taps.
 *   the sheet     drawn inside the nearest .rpu-screen (the phone's column on a computer), never in this element: it is
 *                 a sibling in React's tree as well, so nothing tapped in the sheet reaches the element under it.
 *
 * `as` says how the wrapper stands in its place:
 *   "block"   (default) a box of its own around the element
 *   "line"    an entry of a <Timeline>: the wrapper is a group of the line, the rule runs through it
 *   "row"     a row of a <ListCard>: the ring runs inside the card, the hairline between rows is kept
 *   "inline"  inside a heading: a <span>
 *
 * On the family side too (owner's decision of 10-14: 「长按进入 AI 在家属端也要有」). `link` is her care link's id: with
 * it the element is one of HIS records on HER screen, and the same hold opens the same sheet, read through her link and
 * cut by his switches (the sheet posts to /api/explain?link=). Her screens are not an .rpu-screen: the sheet is drawn on
 * the page itself and keeps to her phone's column (explain.css, [data-viewer="family"]); the ring is her side's accent,
 * which shows on her dark ground. Nothing else differs: the gesture, the half second, the hidden button.
 *
 * Test hooks: [data-rpx="hold"] (data-rpx-type, data-rpx-ref, data-holding; data-rpx-viewer="family" on her side) on the
 * wrapper, explain-ask on the button.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { holdWords } from "@/lib/explain/copy";
import type { HoldLocale, HoldSubject } from "@/lib/explain/subjects";
import { ExplainSheet } from "./ExplainSheet";
import "./explain.css";

/** how long he holds */
export const HOLD_MS = 500;
/** a finger that moves further than this is scrolling, not holding */
const MOVE_PX = 10;
/** after the finger lifts, the click it makes comes at once: the swallower waits this long for it, then leaves */
const CLICK_WAIT_MS = 400;
/** the sheet goes down this long before it is gone (explain.css rpx-down); at once for someone who asked for less motion */
const CLOSE_MS = 220;

/**
 * Controls inside a held element that keep their own press (a row that is itself a button, .rpu-li, is the element).
 * .rpf-btn: the family side's buttons, which are links as often as buttons (his screens have none).
 */
const OWN_PRESS =
  "button:not(.rpu-li), input, select, textarea, summary, audio, video, [contenteditable='true'], [role='button'], .rpu-btn, .rpu-act, .rpu-src, .rpu-back, .rpu-chip-btn, .rpf-btn, [data-kind='me'], [data-rpx-own]";

const VARIANT = { block: "", line: "rpx-line rpu-tl-group", row: "rpx-row", inline: "rpx-inline" } as const;

/** The one click that follows a hold never reaches the page: caught before React, once, wherever it lands. */
function swallowNextClick(): () => void {
  let wait = 0;
  const stop = () => {
    window.clearTimeout(wait);
    document.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
  };
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stop();
  };
  const lifted = () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(stop, CLICK_WAIT_MS);
  };
  document.addEventListener("click", swallow, true);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
  return stop;
}

export function Explainable({
  subject,
  locale,
  as = "block",
  label,
  link,
  children,
  className,
}: {
  /** what this element stands for (lib/explain/subjects.ts); the server looks everything else up */
  subject: HoldSubject;
  locale: HoldLocale;
  as?: keyof typeof VARIANT;
  /** what the thing is called on the screen, for the hidden button's name and the sheet's head while it loads */
  label?: string;
  /** her care link's id: the element is on a family member's screen, and the sheet reads his record through that link */
  link?: string;
  children: ReactNode;
  className?: string;
}) {
  const w = holdWords(locale);
  const wrap = useRef<HTMLElement | null>(null);
  const askButton = useRef<HTMLButtonElement | null>(null);
  const hold = useRef<{ timer: number; off: () => void } | null>(null);
  const unswallow = useRef<(() => void) | null>(null);
  /** the last pointer that touched it: a mouse keeps its right-click menu */
  const pointer = useRef<string>("mouse");
  const byKeyboard = useRef(false);
  const [holding, setHolding] = useState(false);
  /** where the sheet is drawn while it is open (the phone's screen), else null */
  const [host, setHost] = useState<Element | null>(null);
  /** the sheet is going down: still drawn for a moment, then gone */
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);

  const cancel = useCallback(() => {
    const h = hold.current;
    if (!h) return;
    hold.current = null;
    window.clearTimeout(h.timer);
    h.off();
    setHolding(false);
  }, []);

  const open = useCallback((keyboard: boolean) => {
    byKeyboard.current = keyboard;
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setHost(wrap.current?.closest(".rpu-screen") ?? document.body);
  }, []);

  const close = useCallback(() => {
    const gone = () => {
      setClosing(false);
      setHost(null);
      // the keyboard's way in gets the focus back
      if (byKeyboard.current) askButton.current?.focus();
    };
    // the sheet goes down first (a moment), unless the phone asks for less motion
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return gone();
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(gone, CLOSE_MS);
  }, []);

  // leaving the page in the middle of a hold ends it
  useEffect(
    () => () => {
      cancel();
      unswallow.current?.();
      window.clearTimeout(closeTimer.current);
    },
    [cancel],
  );

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    pointer.current = e.pointerType;
    if (host || hold.current) return;
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const self = wrap.current;
    const target = e.target instanceof Element ? e.target : null;
    if (!self || !target) return;
    // a held element inside this one is its own; so is a button, a field or a player
    if (target.closest('[data-rpx="hold"]') !== self) return;
    const own = target.closest(OWN_PRESS);
    if (own && self.contains(own)) return;
    const { clientX: x, clientY: y, pointerId: id } = e;
    const moved = (ev: PointerEvent) => {
      if (ev.pointerId === id && Math.hypot(ev.clientX - x, ev.clientY - y) > MOVE_PX) cancel();
    };
    const ended = (ev: PointerEvent) => {
      if (ev.pointerId === id) cancel();
    };
    const off = () => {
      window.removeEventListener("pointermove", moved, true);
      window.removeEventListener("pointerup", ended, true);
      window.removeEventListener("pointercancel", ended, true);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
    window.addEventListener("pointermove", moved, true);
    window.addEventListener("pointerup", ended, true);
    window.addEventListener("pointercancel", ended, true);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    const timer = window.setTimeout(() => {
      // locked in
      hold.current = null;
      off();
      setHolding(false);
      try {
        navigator.vibrate?.(12);
      } catch {
        // no vibration on this phone: the sheet says it instead
      }
      window.getSelection?.()?.removeAllRanges();
      unswallow.current?.();
      unswallow.current = swallowNextClick();
      open(false);
    }, HOLD_MS);
    hold.current = { timer, off };
    setHolding(true);
  }

  const Tag = as === "inline" ? "span" : "div";
  const sep = locale === "en" ? ": " : "：";
  return (
    <>
      <Tag
        ref={(el: HTMLElement | null) => {
          wrap.current = el;
        }}
        className={["rpx", VARIANT[as], className].filter(Boolean).join(" ")}
        data-rpx="hold"
        data-rpx-type={subject.type}
        data-rpx-ref={subject.ref}
        data-rpx-viewer={link ? "family" : undefined}
        data-holding={holding ? "true" : undefined}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          // the long-press menu of a touch or a pen is not shown; a mouse keeps its right click
          if (pointer.current !== "mouse" || hold.current) e.preventDefault();
        }}
      >
        {children}
        <span className="rpx-fx">
          <svg className="rpx-ring" aria-hidden="true" focusable="false">
            <rect width="100%" height="100%" rx="14" pathLength={100} />
          </svg>
          <button
            ref={askButton}
            type="button"
            className="rpx-ask"
            data-testid="explain-ask"
            data-check-allow=""
            data-label={w.ask}
            aria-label={label ? `${w.ask}${sep}${label}` : w.ask}
            aria-haspopup="dialog"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              open(true);
            }}
          />
        </span>
      </Tag>
      {host ? createPortal(<ExplainSheet subject={subject} locale={locale} name={label} link={link} onClose={close} closing={closing} />, host) : null}
    </>
  );
}
