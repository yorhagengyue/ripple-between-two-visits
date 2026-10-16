"use client";

/**
 * The day's clock on every account page (C2 track B, second round; real-app 2.7 「新加坡 0 点，开着的页面自己换到新的一天」,
 * 6.3 「账号上用新的 useClock()，每 30 秒走一次，新加坡日期变了就刷新页面」). Mounted once by app/p/layout.tsx, so it is there on
 * Today, blood pressure, the brief, the question list and every other page of his.
 *
 * The server says what it knows (lib/daily/day-clock.ts): the account's own "now" (a filming account's clock offset
 * included), his zone, today's date and the next moment the day changes by itself (a reminder starts, a window closes,
 * his midnight). This component keeps time from there:
 *
 *   useClock()   the server's "now" as this phone can tell it: the phone's clock plus the difference measured at the
 *                last server render, so a phone with the wrong time (or the developer test clock) still agrees with
 *                the server about what day it is
 *   when         a timer set for the next moment, a look every 30 seconds, and a look whenever the page comes back
 *                (the phone woke up, the tab was shown again): timers do not run while a phone sleeps
 *   then         when the date in his zone is no longer the page's date, or the next moment has passed, the page reads
 *                its server data again (router.refresh: no reload, what he typed stays). The header's date, the day's
 *                rows and the reminder that is due (DueReminder, in the same layout) all come from that read.
 * A read that changes nothing (the server's clock disagrees) is not repeated more often than the 30 second look.
 * Without a network nothing is read (track O: a failed re-read would replace the open page with a full load, and he can
 * still record on the page he has); the look runs again the moment the network is back.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isOffline } from "@/lib/offline/client";
import { localDate } from "@/lib/time/clock";

const TICK_MS = 30_000;
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
/** past the moment by this much before reading again, so the server is past it too */
const AFTER_MS = 1_000;

/**
 * The server's "now" as this phone can tell it, re-read every 30 seconds (and when the page comes back). `serverNowMs`
 * is the server's clock at the last server render (`stamp` changes with each one, also when the server's clock stood
 * still, as the developer test clock can); the estimate moves with the phone's clock from there.
 */
export function useClock(serverNowMs: number, stamp: number): { now: () => number; tick: number } {
  const offset = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    offset.current = serverNowMs - Date.now();
  }, [serverNowMs, stamp]);
  useEffect(() => {
    const beat = () => setTick((n) => n + 1);
    const seen = () => {
      if (document.visibilityState === "visible") beat();
    };
    const timer = window.setInterval(beat, TICK_MS);
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("pageshow", beat);
    window.addEventListener("focus", beat);
    // the network is back: what could not be read while it was away is looked at now
    window.addEventListener("online", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("pageshow", beat);
      window.removeEventListener("focus", beat);
      window.removeEventListener("online", beat);
    };
  }, []);
  return { now: () => Date.now() + offset.current, tick };
}

export function DayClock({ stamp, serverNowMs, tz, date, nextAtMs }: { stamp: number; serverNowMs: number; tz: string; date: string; nextAtMs: number }) {
  const router = useRouter();
  const { now, tick } = useClock(serverNowMs, stamp);
  // the read already asked for (the page's date and next moment it was asked about): not asked twice for the same
  const asked = useRef<string | null>(null);

  useEffect(() => {
    const look = () => {
      // no network: the open page stays as it is (track O); "online" brings the look back
      if (isOffline()) return;
      const at = now();
      const stale = localDate(at, tz) !== date || at >= nextAtMs + AFTER_MS;
      const key = `${stamp}|${date}|${nextAtMs}|${tick}`;
      if (!stale || asked.current === key) return;
      asked.current = key;
      router.refresh();
    };
    look();
    // exactly at the next moment too, not only at the next 30 second look
    const wait = Math.min(MAX_WAIT_MS, Math.max(AFTER_MS, nextAtMs - now() + AFTER_MS));
    const timer = window.setTimeout(look, wait);
    return () => window.clearTimeout(timer);
    // `now` reads refs only; `tick` re-runs the look every 30 seconds and when the page comes back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, stamp, serverNowMs, tz, date, nextAtMs, router]);

  return <span hidden data-testid="day-clock" data-date={date} data-next={nextAtMs} />;
}
