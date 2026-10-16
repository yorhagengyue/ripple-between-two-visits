"use client";

/**
 * On her home while he records a visit (scene 1 of the owner's video, 2026-10-15; lib/care/live-visit.ts recordingNow,
 * FamilyHomeData.liveVisit): one row with a breathing dot, 「爸爸正在就诊，录音中」 and how long it has been recording.
 * While he shares his visit records the whole row opens the visit live (「实时看 ›」); without them it says only that
 * the visit is being recorded (the owner's decision). Her home's stream reads her home again when a recording starts
 * or ends (lib/family/events.ts), so the row comes and goes by itself.
 */
import { useEffect, useState } from "react";
import { UiLink } from "@/components/ui/UiLink";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import "./live-visit.css";

/** 3:07, or 1:02:07 past an hour */
export function runningTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The running time of a recording that started at `startedAt`, every second, on the server's clock (`serverNow` when the copy was built). */
export function useRunningTime(startedAt: string | null, serverNow: number, running: boolean): string | null {
  const [skew] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return null;
  const at = Date.parse(startedAt);
  return Number.isFinite(at) ? runningTime(now + skew - at) : null;
}

export function LiveBanner({ locale, dad, live, href, serverNow }: { locale: Locale; dad: string; live: { id: string; startedAt: string | null; shared: boolean }; href: string; serverNow: number }) {
  const time = useRunningTime(live.startedAt, serverNow, true);
  const body = (
    <>
      <span className="rpfl-dot" aria-hidden="true" />
      <span className="rpfl-banner-text">
        <span className="rpfl-banner-title">{hc(locale, "liveBanner", { dad })}</span>
        {time ? <span className="rpfl-banner-sub">{hc(locale, "liveBannerSub", { time })}</span> : null}
      </span>
      {live.shared ? <span className="rpfl-banner-go">{hc(locale, "liveWatch")} ›</span> : <span />}
    </>
  );
  return live.shared ? (
    <UiLink href={href} nav="forward" className="rpf rpfl-banner" data-testid="home-live-visit" data-shared="true" data-visit={live.id}>
      {body}
    </UiLink>
  ) : (
    <div className="rpf rpfl-banner" role="status" data-testid="home-live-visit" data-shared="false" data-visit={live.id}>
      {body}
    </div>
  );
}
