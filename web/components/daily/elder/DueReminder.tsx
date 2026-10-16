"use client";

/**
 * The reminder that is due now, on whichever account page he is (C2 track B, second round; real-app 6.5 「账号上按
 * useClock() 和格子弹出」; the demo's ReminderClipPlayer in PatientFrame does the same for a demo session). Mounted once by
 * app/p/layout.tsx; the layout reads which slot asks for him now (lib/daily/day-clock.ts) and the day's clock (DayClock)
 * re-reads it at 08:45, 09:15 and 09:45, so it comes up without a reload.
 *
 * A passing pop-up, not a strip (owner's tidy of 10-13: the strip stayed on every page for as long as the dose was
 * unanswered and took a third of the screen):
 *
 *   what it shows   her reminder as on Today (her words, 「女儿说」, her recording: it plays by itself when the browser
 *                   allows, else the round play button; components/daily/elder/HerReminder), then the lock screen's
 *                   own words 「早上的药 · 还没记」 (no medicine name, no dose), the button to Today, where he answers
 *                   (/p/today?remind=dose-<slot>), and a quieter 「知道了」. Without a clip: the words and the buttons.
 *   once            once per reminder window: his date, the slot and which reminder of the slot it is (the first, or
 *                   the second half an hour later: DueNow.stretch). It comes up on the page he is on at that moment,
 *                   or on the first page he opens while the window is open that may show it. That it was shown is
 *                   kept in sessionStorage (one key, the window's id), so another page or a reload does not bring it
 *                   back.
 *   how it leaves   「去今天页记」 (Today keeps it off), 「知道了」, or by itself after 10 seconds; while her recording is
 *                   playing it waits for the recording to end, 30 seconds at most. Also when he answered or the window
 *                   closed (the layout's `due` is null then). Nothing of it stays on the page.
 *   where not       dueReminderHidden below: Today (it has the reminder itself); the visit pages (he is in the
 *                   consultation room: nothing pops up and nothing plays over a recording); the brief; adding a
 *                   medicine; asking (an emergency answer has nothing above it); blood pressure while he types a reading
 *   over the page   position fixed at the top of the phone (app/ripple-ui.css .rpu-duepop; on a computer
 *                   data-rp-phone-fixed keeps it inside the column, app/desktop.css). The page under it gives up no
 *                   height for it.
 *
 * Test hooks: due-reminder (data-slot, data-stretch), due-reminder-words, due-reminder-go, due-reminder-ok.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BodyText, PrimaryButton, SecondaryButton } from "@/components/ui";
import type { DueNow } from "@/lib/daily/day-clock";
import { dt, shortTime, type DailyKey } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { HerReminder } from "./HerReminder";

/** the reminder window whose pop-up this tab already showed */
const SHOWN_KEY = "rp_due_shown";
/** it leaves by itself after this long */
const STAY_MS = 10_000;
/** her recording still playing then: when it has ended, and never longer than this */
const STAY_MAX_MS = 30_000;

// the quieter button's words live here: lib/daily/i18n.ts was not this change's to edit (owner's tidy of 10-13)
const OK_WORDS: Record<Locale, string> = { "zh-Hans": "知道了", en: "Got it" };

/** when sessionStorage is blocked: remembered for as long as this page's script lives */
let shownHere: string | null = null;

function wasShown(id: string): boolean {
  if (shownHere === id) return true;
  try {
    return window.sessionStorage.getItem(SHOWN_KEY) === id;
  } catch {
    return false;
  }
}

function markShown(id: string): void {
  shownHere = id;
  try {
    window.sessionStorage.setItem(SHOWN_KEY, id);
  } catch {
    // storage blocked: shownHere keeps it until a reload, nothing else is lost
  }
}

/**
 * Is the pop-up kept off this page? The one place that decides (owner's tidy of 10-13 added the brief in every form,
 * adding a medicine, asking, and blood pressure while a reading is typed).
 */
export function dueReminderHidden(pathname: string, search: Pick<URLSearchParams, "has">): boolean {
  const at = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  // Today shows its own
  if (pathname === "/p/today" || pathname === "/p") return true;
  // the consultation room and the doctor's page stay quiet
  if (at("/p/visit") || at("/p/brief")) return true;
  // he is in the middle of adding a medicine
  if (at("/p/meds/add")) return true;
  // an emergency answer must not have anything above it
  if (at("/p/ask") || at("/p/chat")) return true;
  // he is typing a reading
  if (pathname === "/p/bp" && (search.has("do") || search.has("when"))) return true;
  return false;
}

export function DueReminder({ locale, date, due }: { locale: Locale; date: string; due: DueNow | null }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const box = useRef<HTMLDivElement | null>(null);
  // the reminder window: his date, the slot, and which reminder of the slot it is
  const id = due ? `${date}|${due.slot}|${due.stretch}` : null;
  const allowed = !dueReminderHidden(pathname, search);
  // the window whose pop-up is up now
  const [up, setUp] = useState<string | null>(null);
  const showing = !!due && up === id && allowed;

  // once per window: on this page, or on the first page that may show it
  useEffect(() => {
    if (!id || !allowed) return;
    const t = window.setTimeout(() => {
      if (wasShown(id)) return;
      markShown(id);
      setUp(id);
    }, 0);
    return () => window.clearTimeout(t);
  }, [id, allowed]);

  // a page that keeps it off ends it (he tapped 「去今天页记」, or walked into a visit): it is not back on the next page
  useEffect(() => {
    if (allowed || up === null) return;
    const t = window.setTimeout(() => setUp(null), 0);
    return () => window.clearTimeout(t);
  }, [allowed, up]);

  // it leaves by itself: after 10 seconds, or when her recording has ended if it is still playing then (30 at most)
  useEffect(() => {
    const el = box.current;
    if (!showing || !el) return;
    const leave = () => setUp(null);
    const sounding = () => {
      const audio = el.querySelector("audio");
      return !!audio && !audio.paused && !audio.ended;
    };
    let waiting = false;
    const stopped = () => {
      if (waiting) leave();
    };
    const first = window.setTimeout(() => {
      if (sounding()) waiting = true;
      else leave();
    }, STAY_MS);
    const last = window.setTimeout(leave, STAY_MAX_MS);
    // media events do not bubble: caught on the way down to her <audio>
    el.addEventListener("ended", stopped, true);
    el.addEventListener("pause", stopped, true);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(last);
      el.removeEventListener("ended", stopped, true);
      el.removeEventListener("pause", stopped, true);
    };
  }, [showing]);

  if (!due || !showing) return null;
  const words = `${dt(locale, `slotMed.${due.slot}` as DailyKey)} · ${dt(locale, "notice.dose.body")}`;
  return (
    <div
      ref={box}
      className="rpu rpu-duepop"
      data-rp-side="elder"
      data-rp-phone-fixed=""
      data-testid="due-reminder"
      data-slot={due.slot}
      data-stretch={due.stretch}
      lang={locale}
    >
      <div className="rpu-duepop-card">
        {due.clip ? <HerReminder key={`${due.clip.id}-${due.stretch}`} clip={due.clip} locale={locale} at={shortTime(due.at)} /> : null}
        <BodyText variant="strong">
          <span data-testid="due-reminder-words">{words}</span>
        </BodyText>
        <PrimaryButton href={`/p/today?remind=dose-${due.slot}`} icon="check" data-testid="due-reminder-go">
          {dt(locale, "due.go")}
        </PrimaryButton>
        <SecondaryButton data-testid="due-reminder-ok" onClick={() => setUp(null)}>
          {OK_WORDS[locale]}
        </SecondaryButton>
      </div>
    </div>
  );
}
