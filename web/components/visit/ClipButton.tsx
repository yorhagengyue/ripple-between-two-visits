"use client";

/**
 * Play the speaker's own words (one sentence). Stand-in clips (synthetic voices until the real recordings
 * exist) carry the label 代录音 / stand-in recording.
 */
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { vt } from "@/lib/visit/strings";
import type { ClipView } from "@/lib/visit/types";
import s from "./styles";

declare global {
  interface Window {
    __rpClipPlays?: { url: string; at: number }[];
  }
}

export function ClipButton({ clip, locale, testId }: { clip: ClipView; locale: Locale; testId?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => audio.current?.pause(), []);

  function toggle() {
    if (playing && audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    let a = audio.current;
    if (!a) {
      a = new Audio(clip.url);
      a.addEventListener("playing", () => {
        window.__rpClipPlays = [...(window.__rpClipPlays ?? []), { url: clip.url, at: Date.now() }];
        setPlaying(true);
      });
      for (const ev of ["ended", "pause", "error"]) a.addEventListener(ev, () => setPlaying(false));
      audio.current = a;
    }
    void a.play().catch(() => setPlaying(false));
  }

  return (
    <div className={s.clipRow}>
      <button type="button" className="rp-btn rp-btn-ghost" onClick={toggle} data-testid={testId} data-clip-url={clip.url} aria-pressed={playing}>
        {playing ? `■ ${vt(locale, "clip.stop")}` : `▶ ${vt(locale, "clip.play")}`}
      </button>
      <span className={`rp-src ${s.standIn}`} data-testid={testId ? `${testId}-label` : undefined}>
        {clip.standIn ? vt(locale, "clip.standIn") : vt(locale, "clip.recording")}
      </span>
    </div>
  );
}
