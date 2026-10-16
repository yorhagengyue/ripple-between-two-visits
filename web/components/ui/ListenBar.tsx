"use client";

import { useEffect, useRef, useState } from "react";
import { clampFraction, uiCopy } from "@/lib/ui/copy";
import { clipTime, cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { SourceKind, UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { PlayGlyph } from "./Timeline";
import { Tag } from "./Tag";

/**
 * A recording he can play: the play pill (「▶ 听 0:04」 outlined, 「❚❚ 正在播 0:02 / 0:04」 filled while it plays; the
 * elapsed time in its words is the progress, the draft draws no line) and a square tag saying whose voice it is:
 * 「代录音」 for a stand-in, 「女儿的录音」 once Wei Ling recorded it herself. Never an icon-only button.
 *
 * With `src` it plays that audio; without it the bar shows `progress` / `playing` as given (gallery, screenshots).
 * `unavailable` disables it and says so in words.
 *
 * C2 track R: one recording kept as several files plays through as one. `more` are the files after `src`, in order:
 * when one ends the next starts by itself, the button stays 「正在播」, and with `lengthsMs` (every file's length, `src`
 * first) the time and the line run over the whole recording. Played again after the end, it starts from the first.
 */
export function ListenBar({
  src,
  more,
  lengthsMs,
  time,
  locale,
  kind = "family",
  label,
  standIn = false,
  ownVoice = false,
  progress = 0,
  playing: initialPlaying = false,
  unavailable = false,
  filming,
  className,
  style,
}: UiBaseProps & {
  src?: string;
  /** the same recording's following files, played after `src` without a pause */
  more?: readonly string[];
  /** the length of every file in ms (`src` first): the time and the line then cover the whole recording */
  lengthsMs?: readonly number[];
  /** the clip length as shown, "0:04" */
  time: string;
  locale: UiLocale;
  /** whose recording: decides the colour (family amber, doctor blue ...) */
  kind?: SourceKind;
  /** the button's word when idle; defaults to 「听」 */
  label?: string;
  /** the voice is a stand-in: tag 「代录音」 */
  standIn?: boolean;
  /** Wei Ling recorded it herself: tag 「女儿的录音」 */
  ownVoice?: boolean;
  /** 0..1 */
  progress?: number;
  playing?: boolean;
  unavailable?: boolean;
}) {
  const copy = uiCopy(locale);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(initialPlaying && !unavailable);
  const [fraction, setFraction] = useState(clampFraction(progress));
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  // one recording in several files: which file is in the player, and whether the next one starts by itself
  const moreKey = (more ?? []).join("\n");
  const sources = src ? [src, ...(more ?? [])] : [];
  const [index, setIndex] = useState(0);
  const goOn = useRef(false);
  const current = sources[Math.min(index, Math.max(0, sources.length - 1))];
  const known = lengthsMs && lengthsMs.length === sources.length && sources.length > 1 ? lengthsMs : null;
  const lengthsKey = known ? known.join(",") : "";

  // another recording in the same bar: from its first file
  useEffect(() => {
    goOn.current = false;
    setIndex(0);
  }, [src, moreKey]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const last = index >= sources.length - 1;
    const beforeMs = known ? known.slice(0, index).reduce((ms, n) => ms + n, 0) : 0;
    const totalMs = known ? known.reduce((ms, n) => ms + n, 0) : 0;
    const onTime = () => {
      if (known) {
        setFraction(totalMs > 0 ? clampFraction((beforeMs + el.currentTime * 1000) / totalMs) : 0);
        setElapsedMs(beforeMs + el.currentTime * 1000);
        return;
      }
      setFraction(el.duration > 0 ? clampFraction(el.currentTime / el.duration) : 0);
      setElapsedMs(el.currentTime * 1000);
    };
    const onEnd = () => {
      if (!last) {
        // the next file of the same recording, at once
        goOn.current = true;
        setIndex(index + 1);
        return;
      }
      setPlaying(false);
      setFraction(1);
    };
    // a file that ends pauses the player a moment before the next one starts: the bar keeps saying it plays
    const onPause = () => {
      if (el.ended && !last) return;
      setPlaying(false);
    };
    const onPlay = () => setPlaying(true);
    if (goOn.current) {
      goOn.current = false;
      void el.play().catch(() => setPlaying(false));
    }
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index, sources.length, lengthsKey]);

  function toggle() {
    if (unavailable) return;
    const el = audio.current;
    if (!el) {
      setPlaying((p) => !p);
      return;
    }
    if (el.paused) {
      if (el.ended && index > 0) {
        // played to the end of the last file: again from the first
        goOn.current = true;
        setIndex(0);
        return;
      }
      if (el.ended) el.currentTime = 0;
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }

  const pct = Math.round(fraction * 1000) / 10;
  // the elapsed time while it plays: from the audio element, or from the given progress when there is none
  const elapsed = elapsedMs !== null ? clipTime(elapsedMs) : null;
  const shownTime = unavailable ? null : playing || fraction > 0 ? `${elapsed ?? progressTime(time, fraction)} / ${time}` : time;
  const word = unavailable ? copy.listenUnavailable : playing ? copy.playing : (label ?? copy.listen);

  return (
    <div className={cx("rpu rpu-listen", className)} data-rp="listen" data-kind={kind} data-playing={playing ? "true" : "false"} {...filmingAttr(filming)} style={style}>
      <div className="rpu-src-row">
        <button
          type="button"
          className="rpu-src"
          data-kind={kind}
          onClick={toggle}
          disabled={unavailable}
          aria-pressed={playing}
        >
          {unavailable ? <Icon name="sound" /> : <PlayGlyph playing={playing} />}
          <span>{word}</span>
          {shownTime && <span className="rpu-src-time">{shownTime}</span>}
        </button>
        {standIn && <Tag>{copy.standIn}</Tag>}
        {!standIn && ownVoice && <Tag>{copy.herRecording}</Tag>}
      </div>
      <div className="rpu-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={word}>
        <span className="rpu-track-fill" style={{ width: `${pct}%` }} />
      </div>
      {src && <audio ref={audio} src={current} preload="none" data-part={sources.length > 1 ? index : undefined} />}
    </div>
  );
}

/** "0:04" at 0.5 → "0:02". */
function progressTime(total: string, fraction: number): string {
  const m = /^(\d+):(\d{2})$/.exec(total.trim());
  if (!m) return total;
  const totalMs = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  return clipTime(totalMs * clampFraction(fraction));
}
