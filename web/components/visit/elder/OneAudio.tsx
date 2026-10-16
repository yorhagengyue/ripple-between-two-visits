"use client";

/**
 * One sound at a time (real-app 12 「朗读和医生原话叠着放」: 同一时间只放一段声音，开新的先停旧的). Mounted on his pages: the first
 * mount wraps HTMLMediaElement.prototype.play once for the whole page, so any <audio> or new Audio() that starts
 * playing pauses the one that was playing (a doctor's clip, the read-aloud, his recording, her reminder). Nothing is
 * shown. The journey kit's own wrapper (it records which sound played) stays underneath and keeps working.
 */
import { useEffect } from "react";

type WithFlag = typeof globalThis & { __rpOneAudio?: { current: HTMLMediaElement | null } };

export function installOneAudio(): void {
  const g = globalThis as WithFlag;
  if (g.__rpOneAudio || typeof HTMLMediaElement === "undefined") return;
  const state: { current: HTMLMediaElement | null } = { current: null };
  g.__rpOneAudio = state;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const before = state.current;
    if (before && before !== this && !before.paused) before.pause();
    state.current = this;
    return play.call(this);
  };
}

export function OneAudio() {
  useEffect(() => installOneAudio(), []);
  return null;
}
