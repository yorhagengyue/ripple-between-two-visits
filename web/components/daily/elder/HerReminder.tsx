"use client";

/**
 * Her reminder at a reminder time, on an account's Today (C2 track B; real-app 2.7; e2e-chains 1.9), drawn as the
 * draft's sub card row (02-2b, 02-8): the round play button on the left, a line saying whose reminder it is and whose
 * voice, and her words as she said them (serif). It plays by itself when the browser allows: the button is filled with
 * two bars and the line says 「正在播」. When the browser refuses, the button shows the triangle and a line under her
 * words says to tap it (never silence without a way to hear her). One tap plays or stops.
 *
 * The words are the card's own from before the timeline: 「Wei Ling 的提醒」 (the name he gave her link; 「家人的提醒」
 * without one), then whose voice it is: 「代录音」 for a stand-in, 「Wei Ling 的录音」 once she recorded it herself
 * (real-app 3.10). When the audio cannot be played at all it says so in words (e2e-chains 1.7).
 *
 * Test hooks: her-reminder (data-state: idle | playing | ended | blocked | broken; data-clip), her-words (her words
 * and nothing else), her-reminder-play (the round button, the first button of the row), her-reminder-broken.
 */
import { useEffect, useRef, useState } from "react";
import { PlayCircle, Said, SubRow, TlNote } from "@/components/ui";
import { dt } from "@/lib/daily/i18n";
import type { ReminderClipView } from "@/lib/daily/types";
import type { Locale } from "@/lib/i18n";
import { uiCopy } from "@/lib/ui/copy";

type PlayState = "idle" | "playing" | "ended" | "blocked" | "broken";

export function HerReminder({ clip, locale, autoplay = true }: { clip: ReminderClipView; locale: Locale; at?: string; autoplay?: boolean }) {
  const copy = uiCopy(locale);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayState>("idle");
  const name = clip.by_label?.trim() || null;

  useEffect(() => {
    const el = audio.current;
    if (!el || !clip.audio_url || !autoplay) return;
    void el.play().then(
      () => setState("playing"),
      (err: unknown) => setState((err as { name?: string } | null)?.name === "NotAllowedError" ? "blocked" : "broken"),
    );
  }, [clip.audio_url, autoplay]);

  function play() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (el.ended) el.currentTime = 0;
    void el.play().then(
      () => setState("playing"),
      () => setState("broken"),
    );
  }

  const playing = state === "playing";
  const who = name ? dt(locale, "today.reminder.from", { name }) : dt(locale, "today.reminder.fromDefault");
  // whose voice he hears (real-app 3.10): a stand-in says so; her own recording carries the name he gave her link
  const voice = clip.stand_in ? copy.standIn : name ? dt(locale, "today.reminder.recording", { name }) : dt(locale, "today.reminder.recordingDefault");
  const meta = [clip.audio_url ? voice : null, playing ? copy.playing : null].filter(Boolean).join(" · ") || undefined;
  const listen = name ? dt(locale, "today.reminder.listen", { name }) : dt(locale, "today.reminder.listenDefault");

  return (
    <SubRow
      testId="her-reminder"
      attrs={{ "data-state": state, "data-clip": clip.id }}
      lead={clip.audio_url ? <PlayCircle playing={playing} label={playing ? copy.pause : listen} onClick={play} disabled={state === "broken"} testId="her-reminder-play" /> : undefined}
      who={who}
      meta={meta}
    >
      {clip.text ? (
        <div data-testid="her-words">
          <Said lang={clip.lang === "en" ? "en" : "zh-Hans"} source={{ kind: "family", ref: clip.id }} style={{ marginTop: 0 }} size="sub">
            「{clip.text}」
          </Said>
        </div>
      ) : null}
      {clip.audio_url && state === "broken" ? <TlNote testId="her-reminder-broken">{dt(locale, "today.reminder.unavailable")}</TlNote> : null}
      {clip.audio_url ? (
        <audio
          ref={audio}
          src={clip.audio_url}
          preload="auto"
          onPlay={() => setState("playing")}
          onPause={(e) => {
            if (!e.currentTarget.ended) setState("idle");
          }}
          onEnded={() => setState("ended")}
          onError={() => setState("broken")}
        />
      ) : null}
    </SubRow>
  );
}
