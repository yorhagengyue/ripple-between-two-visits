"use client";

/**
 * 「听原声」 on a quoted line (ux pass, 10-12; the canvas screen 07-3): a round play button and a line that fills as the
 * recording plays, in place of the worded pill. One tap plays; a tap while it plays pauses; the next one goes on from
 * there; at the end the line is empty again. A stand-in voice says so next to the line (「代录音」). One sound at a time
 * on the page is the layout's (components/visit/elder/OneAudio): starting this stops whatever was playing. It plays only
 * when he taps it (owner 10-15: the doctor's words are on the screen and he chooses to play them; from 10-14 to 10-15 an
 * answer's first recorded line started by itself).
 *
 * The button carries no words (the owner's decision); a screen reader hears `label` / `playingLabel`.
 * components/chat/ClipButton.tsx (the first build's button, also used by the prevention and diet screens) is left as
 * it is. Test hooks as before: `testId` on the row (default chat-clip; data-src, data-playing), and `pillTestId` puts a
 * hook with the same two attributes on the button itself (a script taps what it finds).
 */
import { useRef, useState } from "react";
import { PlayGlyph, Tag } from "@/components/ui";
import { uiCopy } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";

export function PlayClip({
  url,
  standIn,
  locale,
  label,
  playingLabel,
  testId = "chat-clip",
  pillTestId,
}: {
  url: string;
  standIn: boolean;
  locale: UiLocale;
  label: string;
  playingLabel: string;
  testId?: string;
  pillTestId?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /** how much of the recording has played, 0 to 100 */
  const [pct, setPct] = useState(0);
  return (
    <div className="rpu-tl-ctl rpu-clip" data-testid={testId} data-src={url} data-playing={playing ? "true" : "false"}>
      <button
        type="button"
        className="rpu-clip-btn"
        data-testid={pillTestId}
        data-src={pillTestId ? url : undefined}
        data-playing={pillTestId ? (playing ? "true" : "false") : undefined}
        aria-label={playing ? playingLabel : label}
        aria-pressed={playing}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (!el.paused) {
            el.pause();
            return;
          }
          if (el.ended) el.currentTime = 0;
          void el.play().catch(() => setPlaying(false));
        }}
      >
        <PlayGlyph playing={playing} />
      </button>
      <span className="rpu-clip-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
        <span className="rpu-clip-fill" style={{ width: `${pct}%` }} />
        <span className="rpu-clip-dot" style={{ left: `${pct}%` }} />
      </span>
      {standIn && <Tag>{uiCopy(locale).standIn}</Tag>}
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setPct(el.duration > 0 ? Math.min(100, (el.currentTime / el.duration) * 100) : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setPct(0);
        }}
      />
    </div>
  );
}
