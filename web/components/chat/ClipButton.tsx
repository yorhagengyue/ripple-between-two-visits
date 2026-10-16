"use client";

/**
 * Play a clinician's own words where they are quoted (journey 04): a worded button (never an icon alone), one clip at a
 * time on the page, labelled 代录音 when the voice is a stand-in. Test hooks: chat-clip (data-src, data-playing).
 */
import { useRef, useState } from "react";
import { SourceLink } from "@/components/ui";
import type { UiLocale } from "@/lib/ui/tokens";

declare global {
  interface Window {
    __rpChatClip?: HTMLAudioElement | null;
  }
}

export function ClipButton({ url, kind, time, standIn, locale, label, playingLabel }: { url: string; kind: "doctor" | "pharmacist" | "dispenser"; time?: string; standIn: boolean; locale: UiLocale; label: string; playingLabel: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div data-testid="chat-clip" data-src={url} data-playing={playing ? "true" : "false"}>
      <SourceLink
        kind={kind}
        play
        playing={playing}
        time={time}
        standIn={standIn}
        locale={locale}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          // one sound at a time on the page
          if (window.__rpChatClip && window.__rpChatClip !== el) window.__rpChatClip.pause();
          window.__rpChatClip = el;
          el.currentTime = 0;
          void el.play().catch(() => setPlaying(false));
        }}
      >
        {playing ? playingLabel : label}
      </SourceLink>
      <audio ref={audio} src={url} preload="none" onPlaying={() => setPlaying(true)} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
    </div>
  );
}
