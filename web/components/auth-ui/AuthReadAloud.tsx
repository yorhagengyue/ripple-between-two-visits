"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadAloudScreen } from "@/lib/auth/read-aloud-text";
import { authNoPrint } from "./AuthScreen";
import { AuthIcon } from "./icons";
import { playAloud, primeInTap } from "./read-aloud-player";

/**
 * 「读给我听」 on the consent and recovery-code screens (real-app 2.0), as a capsule under the title. Drawn only when the
 * server says there is a real voice (`available`; with the mock voice nothing is rendered at all). It asks POST
 * /api/auth/read-aloud for this screen's sentences, part after part: the request names the screen, the language and a
 * part number, never any text. One sound at a time: tapping again stops, and leaving the screen stops.
 *
 * The audio element is made in the tap itself and every part plays on it (read-aloud-player.ts): iOS Safari may refuse
 * a play() that only comes after the network has answered. To be tried on a real iPhone.
 */
export function AuthReadAloud({ screen, locale, copy, available }: { screen: ReadAloudScreen; locale: "zh-Hans" | "en"; copy: { readAloud: string; readAloudStop: string; readAloudFailed: string }; available: boolean }) {
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  const run = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
  };
  // leaving the screen (or a new screen under the same button) stops the voice
  useEffect(() => stop, [screen, locale]);
  if (!available) return null;

  /** Runs inside the tap: the element exists, and the phone has counted the tap for it, before anything is fetched. */
  function start() {
    const mine = ++run.current;
    const el = new Audio();
    primeInTap(el);
    audio.current = el;
    setState("playing");
    playAloud(
      el,
      async (part) => {
        const res = await fetch("/api/auth/read-aloud", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screen, locale, part }),
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return null;
        const parts = Number(res.headers.get("x-ripple-tts-parts") ?? "1") || 1;
        return { url: URL.createObjectURL(await res.blob()), parts };
      },
      () => mine === run.current,
      (url) => URL.revokeObjectURL(url),
    ).then(
      (end) => {
        if (end === "done" && mine === run.current) setState("idle");
      },
      () => {
        if (mine === run.current) setState("failed");
      },
    );
  }

  return (
    <div className={authNoPrint} data-rp="read-aloud">
      <button
        type="button"
        className="rpa-ios-read"
        aria-pressed={state === "playing"}
        data-testid="read-aloud"
        data-screen={screen}
        data-state={state}
        onClick={() => {
          if (state === "playing") {
            stop();
            setState("idle");
          } else start();
        }}
      >
        <AuthIcon name="sound" />
        {state === "playing" ? copy.readAloudStop : copy.readAloud}
      </button>
      {state === "failed" && (
        <p className="rpa-ios-text" data-variant="note" role="status" data-testid="read-aloud-failed">
          {copy.readAloudFailed}
        </p>
      )}
    </div>
  );
}
