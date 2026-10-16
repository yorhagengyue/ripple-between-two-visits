"use client";

/**
 * What the microphone hears, under the recording bar (10-15: the owner recorded 29 s and got 「没有录到声音」; the
 * microphone had sent nothing but zeros and the screen never said so; then 「麦克风还是无法真正检索我使用的麦克风是哪」).
 *   the row       「麦克风：<its name>」 and five bars that move with his voice, and 「换一个」
 *   换一个         every microphone the browser knows, each with its own bars (all of them open at once, raw: he speaks and
 *                 sees which one moves, ../mic-devices.ts watchMics); a tap moves the same recording to that one and keeps
 *                 it for the next recording (rememberMic)
 *   听不到声音     once the microphone in use has sent nothing at all for DEAD_AFTER_MS (all zeros: a headset that is off,
 *                 a muted or empty device; a quiet room is never that) and the screen did not move it by itself
 *                 (AccountVisitFlow runs settleMic when the recording starts): the warning, with the same list open
 */
import { useEffect, useState } from "react";
import { Box, Button } from "@/components/ui";
import type { AccountLocale } from "@/lib/visit/account-copy";
import { micName, rememberMic, watchMics, type MicLevel } from "../mic-devices";
import { MIC_SILENT_PEAK, type WavRecorder } from "../useWavRecorder";
import { vw } from "./words";

/** After this much audio from one microphone with nothing in it, the screen says so. */
export const DEAD_AFTER_MS = 3000;
const BARS = 5;

/** The meter's bars for a level (0 to 1): -60 dBFS and below none, -10 dBFS and above all five. */
export function barsFor(level: number, bars = BARS): number {
  const db = level > 0 ? 20 * Math.log10(level) : -100;
  return Math.max(0, Math.min(bars, Math.round(((db + 60) / 50) * bars)));
}

function Bars({ lit, testId }: { lit: number; testId?: string }) {
  return (
    <span className="rpu-mic-bars" aria-hidden="true" data-testid={testId} data-lit={lit}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="rpu-mic-bar" data-on={i < lit ? "true" : undefined} />
      ))}
    </span>
  );
}

/** Every microphone with its own bars while the list is open; a tap moves the recording to it. */
function MicList({ recorder, locale, onPicked }: { recorder: WavRecorder; locale: AccountLocale; onPicked: () => void }) {
  const [levels, setLevels] = useState<MicLevel[] | null>(null);
  const [current, setCurrent] = useState<string | null>(recorder.inputId());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void watchMics((l) => {
      if (!gone) setLevels(l);
    }).then((s) => {
      if (gone) s();
      else stop = s;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  async function use(id: string) {
    setBusy(true);
    setFailed(false);
    const ok = await recorder.switchInput(id);
    setBusy(false);
    if (!ok) return setFailed(true);
    rememberMic(id);
    setCurrent(id);
    onPicked();
  }

  if (!levels) return <p className="rpu-mic-sub">{vw(locale, "mic.looking")}</p>;
  if (!levels.length) return <p className="rpu-mic-sub">{vw(locale, "mic.none")}</p>;
  return (
    <div className="rpu-mic-list" data-testid="visit-mic-list">
      <p className="rpu-mic-sub">{vw(locale, "mic.pickHint")}</p>
      {levels.map((l, n) => {
        const name = micName(l.label) || vw(locale, "mic.unnamed", { n: n + 1 });
        const inUse = l.id === current;
        return (
          <button
            key={l.id}
            type="button"
            className="rpu-mic-pick"
            data-testid="visit-mic-use"
            data-in-use={inUse ? "true" : "false"}
            data-silent={l.open && l.peak < MIC_SILENT_PEAK ? "true" : "false"}
            disabled={busy || inUse || !l.open}
            onClick={() => void use(l.id)}
          >
            <span className="rpu-mic-pick-name">{name}</span>
            <span className="rpu-mic-pick-end">
              {inUse ? <span className="rpu-mic-pick-tag">{vw(locale, "mic.inUse")}</span> : null}
              {!l.open ? <span className="rpu-mic-pick-tag">{vw(locale, "mic.cannotOpen")}</span> : <Bars lit={barsFor(l.peak)} />}
            </span>
          </button>
        );
      })}
      {failed ? <p className="rpu-mic-sub">{vw(locale, "mic.switchFailed")}</p> : null}
    </div>
  );
}

export function MicCheck({ recorder, locale }: { recorder: WavRecorder; locale: AccountLocale }) {
  const [lit, setLit] = useState(0);
  const [dead, setDead] = useState(false);
  const [name, setName] = useState<string>("");
  const [listing, setListing] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => {
      setLit(barsFor(recorder.level()));
      const h = recorder.hearing();
      setDead(h.ms >= DEAD_AFTER_MS && h.peak < MIC_SILENT_PEAK);
      setName(micName(recorder.inputLabel()));
    }, 120);
    return () => window.clearInterval(t);
  }, [recorder]);

  const list = listing || dead;
  return (
    <div className="rpu-mic" data-testid="visit-mic" data-dead={dead ? "true" : "false"} data-lit={lit}>
      <div className="rpu-mic-row">
        <span className="rpu-mic-label" data-testid="visit-mic-name">
          {name ? vw(locale, "mic.named", { name }) : vw(locale, "mic.level")}
        </span>
        <Bars lit={lit} />
        {!dead ? (
          <Button variant="link" onClick={() => setListing(!listing)} data-testid="visit-mic-switch">
            {listing ? vw(locale, "mic.done") : vw(locale, "mic.switch")}
          </Button>
        ) : null}
      </div>
      {dead ? (
        <div data-testid="visit-mic-dead" role="alert">
          <Box variant="acc" title={vw(locale, "mic.dead")}>
            <p className="rpu-mic-sub">{vw(locale, "mic.deadSubOne")}</p>
            <MicList recorder={recorder} locale={locale} onPicked={() => setListing(false)} />
          </Box>
        </div>
      ) : list ? (
        <MicList recorder={recorder} locale={locale} onPicked={() => setListing(false)} />
      ) : null}
    </div>
  );
}
