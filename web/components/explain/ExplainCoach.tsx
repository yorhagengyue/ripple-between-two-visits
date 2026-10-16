"use client";

/**
 * The gesture, taught once (owner's decision of 10-14, modelled on his iOS app's first-run coach:
 * RippleApp/Explain/LongPressCoach.swift). There is no AI button anywhere on his screens, so the one gesture that opens
 * Ripple's read has to be shown, or nobody finds it: on Today, once per browser, a card over the dimmed ground with a
 * row that is being held over and over (explain.css; with prefers-reduced-motion the ring stands still), the three
 * sentences, and 「知道了」.
 *
 *   once        localStorage rp_explain_coach, written when he taps 「知道了」 (or presses Escape). A browser that keeps
 *               nothing shows it again on the next visit; nothing else is lost.
 *   never over  a medicine that waits for his answer, the reasons after 「还没吃」, the mark right after an answer, the
 *               family card that waits for his 「是她」, or another one-time card of Today (the reminders offer, the
 *               example's intro, 「建好了」, the reminder that is due). The page says what the server knows (`quiet`);
 *               what only the browser knows is read off the screen (BUSY), a moment after the page has settled, and
 *               again every second while the card is up: when one of those comes up, the coach steps aside and waits
 *               for another visit.
 *   where       inside the page's .rpu-screen, like the sheet (the phone's column on a computer); only on a screen that
 *               holds something to hold.
 *   scripts     a browser driven by a script (navigator.webdriver: the journeys, the page checks, the recordings) is
 *               not taught, or the card would stand over every Today they open. ?coach=1 in the address shows it there
 *               too, and again after 「知道了」 (his iOS app's UI tests force theirs the same way).
 *
 * Test hooks: explain-coach, explain-coach-ok.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PrimaryButton } from "@/components/ui";
import { dt } from "@/lib/daily/i18n";
import { holdWords } from "@/lib/explain/copy";
import type { HoldLocale } from "@/lib/explain/subjects";
import "./explain.css";

export const COACH_KEY = "rp_explain_coach";

/** how long after the page is there the coach looks at the screen (the other one-time cards decide in their first tick) */
const SETTLE_MS = 900;
const LOOK_MS = 1000;

/** Today's states with something else for him to do, and its other one-time cards: the coach waits for another visit. */
const BUSY = [
  // a slot that needs him, the reasons, the mark right after an answer (TodayAccount's dose-section says which)
  '[data-testid="dose-section"]:not([data-state="coming"], [data-state="untracked"], [data-state="all-done"], [data-state="no-meds"])',
  '[data-testid="dose-reasons"]',
  '[data-testid="dose-own"]',
  '[data-testid="undo-toast"]',
  // the family card that waits for his answer
  '[data-testid="today-family-confirm"]',
  '[data-testid="today-family-bound"]',
  // the other one-time cards
  '[data-testid="setup-done-notice"]',
  '[data-testid="today-push"]',
  '[data-rp="example-intro"]',
  '[data-testid="due-reminder"]',
  // Ripple's read itself
  '[data-testid="explain-sheet"]',
].join(", ");

function seen(): boolean {
  try {
    return window.localStorage.getItem(COACH_KEY) !== null;
  } catch {
    return false;
  }
}

/** ?coach=1: show it whatever was seen before, also to a script. */
const forced = () => new URLSearchParams(window.location.search).get("coach") === "1";
const scripted = () => navigator.webdriver === true;

/** The screen the coach may stand on now, or null: not yet, not here, or something else is up. */
function freeScreen(): Element | null {
  const screen = document.querySelector(".rpu-screen");
  if (!screen || !screen.querySelector('[data-rpx="hold"]')) return null;
  return document.querySelector(BUSY) ? null : screen;
}

export function ExplainCoach({ locale, quiet = false }: { locale: HoldLocale; /** the page already knows something else has the screen */ quiet?: boolean }) {
  const w = holdWords(locale);
  const card = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  // once the page has settled: is it his first time, and is the screen free?
  useEffect(() => {
    if (quiet) return;
    const t = window.setTimeout(() => {
      if (forced() || (!seen() && !scripted())) setHost(freeScreen());
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [quiet]);

  // while it is up: something else came up (a reminder fell due, a card arrived): it steps aside without a word
  useEffect(() => {
    if (!host) return;
    const t = window.setInterval(() => {
      if (!host.isConnected || document.querySelector(BUSY)) setHost(null);
    }, LOOK_MS);
    return () => window.clearInterval(t);
  }, [host]);

  const done = useCallback(() => {
    try {
      window.localStorage.setItem(COACH_KEY, "1");
    } catch {
      // storage blocked: it is back on the next visit, nothing else is lost
    }
    setHost(null);
  }, []);

  useEffect(() => {
    if (!host) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done();
    };
    window.addEventListener("keydown", onKey);
    card.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [host, done]);

  if (!host || quiet) return null;
  return createPortal(
    <div className="rpx-coach" data-rp-phone-fixed="" data-testid="explain-coach" lang={locale}>
      {/* the ground takes the taps and does nothing with them: 「知道了」 is the way on */}
      <div className="rpx-ground" />
      <div ref={card} className="rpx-coach-card" role="dialog" aria-modal="true" aria-label={w.coachTitle} tabIndex={-1}>
        <p className="rpx-coach-t">{w.coachTitle}</p>
        <div className="rpx-demo" aria-hidden="true">
          <span>{dt(locale, "slotMed.morning")}</span>
          <span className="rpx-fx">
            <svg className="rpx-ring" focusable="false">
              <rect width="100%" height="100%" rx="14" pathLength={100} />
            </svg>
          </span>
        </div>
        <p className="rpx-coach-b">{w.coachBody}</p>
        <p className="rpx-coach-s">{w.coachSmall}</p>
        <PrimaryButton data-testid="explain-coach-ok" onClick={done}>
          {w.coachOk}
        </PrimaryButton>
      </div>
    </div>,
    host,
  );
}
