"use client";

/**
 * Play a quoted line's own recording (the doctor's words at the visit) or Wei Ling's reminder. A synthetic stand-in
 * voice says so on the button: 代录音 / stand-in recording. Plays are recorded on window.__rpDailyClipPlays for e2e.
 */
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { dt } from "@/lib/daily/i18n";

declare global {
  interface Window {
    __rpDailyClipPlays?: { url: string; at: number; playing: boolean; auto: boolean; blocked?: boolean }[];
  }
}

export function ClipPlay({
  url,
  locale,
  standIn,
  label,
  testId = "answer-clip",
  autoPlayKey = null,
  buttonText,
}: {
  url: string;
  locale: Locale;
  standIn: boolean;
  /** shown label for the stand-in (from the API: 代录音 / stand-in recording); defaults to the UI language's */
  label?: string | null;
  testId?: string;
  /** a new non-null value plays the clip without a tap (the reminder at its time; the browser may refuse) */
  autoPlayKey?: string | null;
  buttonText?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const standInLabel = label || dt(locale, "answer.standIn");

  function play(auto = false) {
    const el = audio.current;
    if (!el) return;
    const entry: NonNullable<Window["__rpDailyClipPlays"]>[number] = { url, at: Date.now(), playing: false, auto };
    (window.__rpDailyClipPlays ??= []).push(entry);
    el.currentTime = 0;
    void el.play().catch(() => {
      entry.blocked = true;
      setPlaying(false);
    });
  }

  useEffect(() => {
    if (autoPlayKey) play(true);
    // play once per new key; `play` reads the current element
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayKey]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        className="rp-btn rp-btn-ghost min-h-12 px-4"
        onClick={() => play(false)}
        data-testid={testId}
        data-src={url}
        data-stand-in={standIn ? "1" : "0"}
        data-playing={playing ? "true" : "false"}
        aria-label={`${buttonText ?? dt(locale, "answer.play")}${standIn ? ` · ${standInLabel}` : ""}`}
      >
        {playing ? `■ ${dt(locale, "answer.playing")}` : `▶ ${buttonText ?? dt(locale, "answer.play")}`}
        {standIn ? <span className="ml-2 text-ink-2">· {standInLabel}</span> : null}
      </button>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          const last = window.__rpDailyClipPlays?.findLast((p) => p.url === url);
          if (last) last.playing = true;
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
