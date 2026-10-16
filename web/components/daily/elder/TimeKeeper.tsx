"use client";

/**
 * Keeps an open account page on the right moment of the day (C2 track B; real-app 6.3 「开着的页面自己换到新的一天」): the
 * server says when the screen next changes by itself (a reminder starts, a window closes, the blood pressure part
 * starts, Singapore midnight), and the page re-reads its server data at that moment. The server's "now" may differ from
 * the phone's (a phone with the wrong time, the developer test clock): the wait is counted from the server's now.
 *
 * Second round: his midnight and the medicine moments are kept for every page by the layout's DayClock
 * (components/daily/elder/DayClock.tsx, which also looks again every 30 seconds and when the phone wakes). This one
 * stays for a page's own moments the layout does not read: the doctor's blood pressure plan on Today and on /p/bp.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
// C2 track O: without a network the re-read waits for it (a failed one would replace the open page with a full load)
import { refreshWhenOnline } from "@/lib/offline/client";

const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

export function TimeKeeper({ nextAtMs, serverNowMs }: { nextAtMs: number | null; serverNowMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (nextAtMs === null) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(1_000, nextAtMs - serverNowMs + 1_000));
    const t = window.setTimeout(() => refreshWhenOnline(router), wait);
    return () => window.clearTimeout(t);
  }, [nextAtMs, serverNowMs, router]);
  return null;
}
