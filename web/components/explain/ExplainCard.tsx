"use client";

/**
 * The explain card 「为什么没感觉也要吃」 (task M5). v3 card layout: each line's source label on top, the words, and
 * the visit date and time point underneath. The doctor's line (R3) carries its clip: tapping the source label plays
 * the doctor's own words (代录音 / stand-in recording until the real recording exists). 「朗读这张卡」 reads exactly
 * these sentences (POST /api/tts builds the text from the same card on the server).
 * Every sentence comes from lib/explain/card (lib/safety checked); this component only lays it out.
 * `readAloud` (the page passes lib/tts readAloudOffered("demo")): false leaves the button out, when the provider that
 * is chosen cannot answer (TTS_PROVIDER=trtc with a setting missing or refused, lib/tts/trtc.ts): never a button that answers 503.
 * e2e hooks: window.__rpExplainClips (clip plays), window.__rpTts (read-aloud).
 */
import { useEffect, useRef, useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { et } from "@/lib/explain/i18n";
import type { ExplainCardView, ExplainLine } from "@/lib/explain/types";
import type { Locale } from "@/lib/i18n";
import { chipDetailText, chipKindText } from "@/lib/meds/chips";
import { formatClipTime, formatDate } from "@/lib/meds/i18n";
import { withSession } from "@/lib/session/client";
import { voiceFromTap } from "./tap-voice";

declare global {
  interface Window {
    __rpExplainClips?: { url: string; at: number; playing: boolean }[];
    __rpTts?: { at: number; status: number; provider: string | null; sha256: string | null; bytes: number; playing: boolean; ended: boolean };
  }
}

function detailText(locale: Locale, line: ExplainLine): string {
  const chip = line.chip;
  if (chip.kind === "leaflet") return chipDetailText(locale, chip);
  const parts: string[] = [];
  if (chip.date) parts.push(formatDate(locale, chip.date));
  if (chip.tStartMs != null) parts.push(et(locale, "card.at", { time: formatClipTime(chip.tStartMs) }));
  return parts.join(" · ");
}

/** The source label as a button that plays the line's own recording. */
function ClipChip({ line, locale }: { line: ExplainLine; locale: Locale }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const clip = line.clip!;

  useEffect(() => () => audio.current?.pause(), []);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      return;
    }
    (window.__rpExplainClips ??= []).push({ url: clip.url, at: Date.now(), playing: false });
    el.currentTime = 0;
    void el.play().catch(() => setPlaying(false));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex min-h-12 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-hair-2 bg-surface px-3 py-2 text-left"
      aria-pressed={playing}
      aria-label={`${chipKindText(locale, line.chip)} · ${et(locale, "card.sourceTap")}${clip.standIn ? ` · ${et(locale, "card.standIn")}` : ""}`}
      data-testid="explain-clip-chip"
      data-src={clip.url}
      data-playing={playing ? "true" : "false"}
      data-stand-in={clip.standIn ? "1" : "0"}
    >
      <span className="rp-tag" data-testid="explain-chip">
        ● {chipKindText(locale, line.chip)}
      </span>
      <span className="rp-src" data-testid="explain-clip-label">
        {playing ? `■ ${et(locale, "card.playing")}` : "▶"} {clip.standIn ? et(locale, "card.standIn") : ""}
      </span>
      <audio
        ref={audio}
        src={clip.url}
        preload="none"
        data-testid="explain-clip-audio"
        onPlaying={() => {
          setPlaying(true);
          const last = window.__rpExplainClips?.findLast((p) => p.url === clip.url);
          if (last) last.playing = true;
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </button>
  );
}

function Line({ line, locale }: { line: ExplainLine; locale: Locale }) {
  const detail = detailText(locale, line);
  const doctorSaid = line.chip.kind === "doctor" && !line.chip.inferred;
  return (
    <div
      className={`rp-card ${doctorSaid ? "rp-card-doc" : ""} flex flex-col gap-1.5`}
      data-testid="explain-line"
      data-kind={line.kind}
      data-source={line.sourceId}
      data-chip={line.chip.kind}
      data-inferred={line.chip.inferred ? "true" : "false"}
    >
      {line.clip ? (
        <ClipChip line={line} locale={locale} />
      ) : (
        <div className="rp-tag" data-testid="explain-chip">
          ● {chipKindText(locale, line.chip)}
        </div>
      )}
      <p className="whitespace-pre-line text-body leading-[1.42]" data-testid="explain-line-text" lang={line.lang}>
        {line.text}
      </p>
      {detail ? (
        <div className="rp-src" data-testid="explain-line-source">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function ReadAloud({ medId, locale }: { medId: string; locale: Locale }) {
  const { session } = useLiveSession();
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  /** false once the card has left the page: a voice that arrives after that is given to nobody */
  const live = useRef(true);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "failed">("idle");
  const [synthetic, setSynthetic] = useState(false);

  useEffect(() => {
    live.current = true;
    // the card's own <audio>, as it is while the card is on the page (the ref is empty again by the time this cleans up)
    const el = audio.current;
    return () => {
      live.current = false;
      el?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  /**
   * The tap itself. An iPhone lets a sound start only from the tap, and the voice arrives later (it is made on the
   * server first): so the <audio> of this card is loaded right here, before anything is awaited, and the voice is given
   * to it when it comes. The order is voiceFromTap's (./tap-voice.ts; held by tests/unit/explain/tap-voice.test.ts).
   * Nothing may be awaited in this function before that call.
   */
  function start() {
    const el = audio.current;
    if (!el) return;
    if (state === "playing") {
      el.pause();
      el.currentTime = 0;
      setState("idle");
      return;
    }
    setState("loading");
    const { done } = voiceFromTap({
      makeElement: () => el,
      fetchVoice: async () => {
        const res = await fetch(withSession("/api/tts", session.id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card: "explain", med_id: medId, locale }),
          credentials: "same-origin",
        });
        const blob = await res.blob();
        window.__rpTts = {
          at: Date.now(),
          status: res.status,
          provider: res.headers.get("x-ripple-tts-provider"),
          sha256: res.headers.get("x-ripple-tts-sha256"),
          bytes: blob.size,
          playing: false,
          ended: false,
        };
        if (!res.ok) throw new Error(`tts ${res.status}`);
        setSynthetic(res.headers.get("x-ripple-tts-synthetic") === "1");
        return blob;
      },
      toUrl: (blob) => {
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        return objectUrl.current;
      },
      current: () => live.current,
    });
    done.catch(() => live.current && setState("failed"));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="rp-btn rp-btn-accent min-h-14 w-full"
        onClick={start}
        disabled={state === "loading"}
        aria-pressed={state === "playing"}
        data-testid="explain-read-aloud"
        data-state={state}
      >
        {state === "loading"
          ? et(locale, "read.loading")
          : state === "playing"
            ? `■ ${et(locale, "read.stop")} · ${et(locale, "read.playing")}`
            : `▶ ${et(locale, "read.button")}`}
      </button>
      {synthetic ? (
        <span className="rp-src" data-testid="explain-read-synthetic">
          {et(locale, "read.mock")}
        </span>
      ) : null}
      {state === "failed" ? (
        <p className="text-ink-2" role="alert" data-testid="explain-read-failed">
          {et(locale, "read.failed")}
        </p>
      ) : null}
      <audio
        ref={audio}
        data-testid="explain-read-audio"
        onPlaying={() => {
          setState("playing");
          if (window.__rpTts) window.__rpTts.playing = true;
        }}
        onEnded={() => {
          setState("idle");
          if (window.__rpTts) window.__rpTts.ended = true;
        }}
        onPause={() => setState((s) => (s === "playing" ? "idle" : s))}
      />
    </div>
  );
}

export function ExplainCard({ card, locale, readAloud = true }: { card: ExplainCardView; locale: Locale; readAloud?: boolean }) {
  return (
    <section className="flex flex-col gap-3" data-testid="explain-card" data-med={card.medId} aria-labelledby="explain-title">
      <div className="flex flex-col gap-1">
        <span className="rp-kicker">{et(locale, "card.kicker")}</span>
        <h2 id="explain-title" className="text-[22px] font-bold leading-snug" data-testid="explain-title">
          {et(locale, "card.title")}
        </h2>
      </div>
      {card.lines.map((l) => (
        <Line key={l.sourceId} line={l} locale={locale} />
      ))}
      {card.hidden.length > 0 ? (
        <p className="text-ink-2" data-testid="explain-hidden" data-count={card.hidden.length}>
          {et(locale, card.hidden.length === 1 ? "card.hidden" : "card.hiddenMany", { n: card.hidden.length })}
        </p>
      ) : null}
      {readAloud ? <ReadAloud medId={card.medId} locale={locale} /> : null}
    </section>
  );
}
