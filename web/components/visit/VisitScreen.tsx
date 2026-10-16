"use client";

/**
 * The live visit screen (docs/design/visit-transcript/v3-light.html): header with the three counters, the
 * transcript by speaker with doctor's-note cards, check cards and, after the closing words, Ripple's
 * question list; controls at the bottom (pause the recording, End visit).
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { formatClockTime } from "@/lib/story/clock";
import { demoText } from "@/lib/crew/demo-copy";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { formatMs } from "@/lib/visit/text";
import type { CardView, VisitView } from "@/lib/visit/types";
import { CheckCard } from "./CheckCard";
import { DocCard } from "./DocCard";
import { QuestionList } from "./QuestionList";
import { TranscriptLine } from "./TranscriptLine";
import s from "./styles";

export interface PartialCaption {
  id: string;
  text: string;
  t_start_ms: number;
}

export function visitTitle(locale: Locale, v: VisitView["visit"]): string {
  const kinds = ["healthier_sg_check_in", "follow_up", "pharmacy"];
  const kind = vt(locale, (kinds.includes(v.kind) ? `kind.${v.kind}` : "kind.other") as VisitKey);
  return vt(locale, "visit.dayTitle", { day: v.day, kind });
}

function Counter({
  color,
  label,
  n,
  testId,
  extra,
}: {
  color: string;
  label: string;
  n: number;
  testId: string;
  /** a second figure in the same chip ("· to confirm 2") */
  extra?: { label: string; n: number; testId: string } | null;
}) {
  return (
    <span className={`rp-count ${s.cnt}`} data-testid={testId} data-count={n}>
      <i style={{ background: color }} />
      {label} <b>{n}</b>
      {extra ? (
        <span data-testid={extra.testId} data-count={extra.n}>
          · {extra.label} <b>{extra.n}</b>
        </span>
      ) : null}
    </span>
  );
}

export type UnlockResult = "ok" | "wrong" | "locked" | "disabled" | "failed";

/** Crew only (/p/visit?crew=1 in a filming session): the crew key turns on the scripted-fallback switch. */
function UnlockRow({ locale, onUnlock }: { locale: Locale; onUnlock: (key: string) => Promise<UnlockResult> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UnlockResult | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    const r = await onUnlock(key.trim());
    setBusy(false);
    setResult(r);
    if (r === "ok") setKey("");
  }
  const message =
    result === "wrong"
      ? vt(locale, "fallback.keyWrong")
      : result === "locked"
        ? vt(locale, "fallback.keyLocked")
        : result === "disabled"
          ? vt(locale, "fallback.disabled")
          : result === "failed"
            ? vt(locale, "ctrl.failed")
            : null;
  return (
    <form className={s.toggleRow} onSubmit={submit} data-testid="fallback-unlock">
      <span>{vt(locale, "fallback.unlockLabel")}</span>
      <input
        type="password"
        autoComplete="off"
        className={s.keyInput}
        aria-label={vt(locale, "fallback.keyField")}
        placeholder={vt(locale, "fallback.keyField")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        data-testid="fallback-key"
      />
      <button type="submit" className="rp-btn rp-btn-ghost" disabled={busy || !key.trim()} data-testid="fallback-unlock-submit">
        {vt(locale, "fallback.unlock")}
      </button>
      {message ? (
        <span role="status" data-testid="fallback-unlock-status">
          {message}
        </span>
      ) : null}
    </form>
  );
}

/** Time into the recording. The clock only ticks after hydration, so the server and the first client render agree. */
function useElapsed(view: VisitView): number {
  const [now, setNow] = useState<number | null>(null);
  const running = view.stream.state === "running" && view.stream.startedAt !== null;
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running]);
  const lastEnd = view.lines.at(-1)?.tEndMs ?? 0;
  if (!running || now === null) return lastEnd;
  return Math.max(lastEnd, (now - view.stream.startedAt!) * view.stream.speed);
}

export function VisitScreen({
  view,
  partials,
  locale,
  mode,
  mic = null,
  notice,
  paused,
  onPause,
  onEnd,
  ending,
  endError,
  onFallback,
  onUnlock,
  onUseLive,
}: {
  view: VisitView;
  partials: PartialCaption[];
  locale: Locale;
  mode: "record" | "replay";
  /**
   * record mode: what the microphone is doing on this screen. "on": capturing. "off": the browser gave none. "idle":
   * this screen is not capturing (a visit reopened after a reload). The red dot and the moving waveform mean "this
   * phone is listening", so they show only while it is; with no microphone the timer's place says so instead of
   * counting (real-app 12: no fake timer, no fake waveform). null: a replay, or a caller that does not say (as before).
   */
  mic?: "on" | "off" | "idle" | null;
  notice: string | null;
  paused: boolean;
  onPause: (() => void) | null;
  onEnd(): void;
  ending: boolean;
  endError: boolean;
  onFallback: ((on: boolean) => void) | null;
  /** crew only: the unlock field for the scripted fallback (null hides it) */
  onUnlock?: ((key: string) => Promise<UnlockResult>) | null;
  /** M14: end the visit with the live Whisper captions instead of waiting for (or retrying) the full recording */
  onUseLive?: (() => void) | null;
}) {
  const elapsed = useElapsed(view);
  const ended = view.visit.status !== "recording" || view.stream.state === "ended";
  const noMic = mode === "record" && mic === "off";
  const listening = !ended && !paused && (mode === "record" ? (mic === null ? true : mic === "on") : view.stream.state === "running");
  const kicker = ended ? "live.kicker.ended" : mode === "replay" ? "live.kicker.replay" : "live.kicker.recording";
  const bottom = useRef<HTMLDivElement | null>(null);
  const total = view.lines.length + view.cards.length + partials.length + (view.qlist?.answered ?? 0);

  useEffect(() => {
    const el = bottom.current;
    if (!el) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 320;
    if (nearBottom) el.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [total]);

  const cardsFor = new Map<string, CardView[]>();
  for (const c of view.cards) cardsFor.set(c.anchor, [...(cardsFor.get(c.anchor) ?? []), c]);
  const feed: ReactNode[] = [];
  for (const l of view.lines) {
    if (l.inQuestion) continue;
    feed.push(
      <TranscriptLine
        key={l.id}
        locale={locale}
        id={l.id}
        text={l.text}
        role={l.role}
        display={l.display}
        tStartMs={l.tStartMs}
        marks={l.marks}
        scriptedFallback={l.scriptedFallback}
      />,
    );
    for (const c of cardsFor.get(l.id) ?? []) {
      feed.push(c.kind === "doc" ? <DocCard key={c.id} card={c} locale={locale} /> : <CheckCard key={c.id} card={c} locale={locale} />);
    }
    if (view.qlist && view.qlist.anchor === l.id) feed.push(<QuestionList key="qlist" qlist={view.qlist} lines={view.lines} locale={locale} />);
  }
  for (const p of partials) {
    feed.push(<TranscriptLine key={`p-${p.id}`} locale={locale} id={p.id} text={p.text} role="unknown" display="unknown" tStartMs={p.t_start_ms} partial />);
  }

  // the story moment he agreed (the story clock at that time), not the wall clock of the device
  const consentLine = view.consent.given
    ? view.consent.storyTime
      ? vt(locale, "live.consentAt", { time: formatClockTime(view.consent.storyTime, locale) })
      : vt(locale, "live.consent")
    : null;

  return (
    <div data-testid="visit-screen" data-visit={view.visit.id} data-status={view.visit.status} data-stream={view.stream.state}>
      <div className={s.hdr}>
        <div className={s.row}>
          <span className="rp-kicker" data-testid="visit-kicker">
            {/* "listening" only while this phone is: no microphone, or a screen that is not capturing, says so */}
            {!ended && mode === "record" && (mic === "off" || mic === "idle") ? demoText(locale, "visit.kicker.notRecording") : vt(locale, kicker as VisitKey)}
          </span>
          <span className={`rp-kicker ${s.rec}`} data-testid="visit-timer" data-listening={listening ? "true" : "false"} data-mic={mode === "record" ? (mic ?? "") : ""}>
            <span className={listening ? s.dot : s.dotOff} />
            {noMic && !ended ? demoText(locale, "visit.noMic") : formatMs(elapsed)}
          </span>
        </div>
        <h1 className={s.h1} data-testid="visit-title">
          {visitTitle(locale, view.visit)}
        </h1>
        {consentLine ? (
          <div className={s.sub} data-testid="visit-consent">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {consentLine}
          </div>
        ) : null}
        <div className={s.sub}>{view.visit.place}</div>
        <div className={s.counts}>
          <Counter
            color="var(--doc)"
            label={vt(locale, "count.doc")}
            n={view.counts.doc}
            testId="count-doc"
            extra={view.counts.toConfirm > 0 ? { label: vt(locale, "count.toConfirm"), n: view.counts.toConfirm, testId: "count-to-confirm" } : null}
          />
          <Counter color="var(--chk)" label={vt(locale, "count.chk")} n={view.counts.chk} testId="count-chk" />
          <Counter color="var(--accent)" label={vt(locale, "count.q")} n={view.counts.q} testId="count-q" />
        </div>
        {view.fallback.allowed && onFallback ? (
          <div className={s.toggleRow} data-testid="fallback-toggle">
            <span>{vt(locale, "fallback.label")}</span>
            <button
              type="button"
              className={`rp-btn ${view.fallback.on ? "rp-btn-chk" : "rp-btn-ghost"}`}
              aria-pressed={view.fallback.on}
              data-testid="fallback-switch"
              onClick={() => onFallback(!view.fallback.on)}
            >
              {vt(locale, view.fallback.on ? "fallback.on" : "fallback.off")}
            </button>
          </div>
        ) : view.fallback.unlockable && onUnlock ? (
          <UnlockRow locale={locale} onUnlock={onUnlock} />
        ) : null}
        {view.rewatch ? (
          <p className={s.sub} data-testid="visit-rewatch">
            {demoText(locale, "visit.rewatch")}
          </p>
        ) : null}
        {notice ? (
          <p className={s.notice} data-testid="visit-notice">
            {notice}
          </p>
        ) : null}
      </div>

      <div className={s.feed} data-testid="visit-feed">
        {feed.length === 0 && !ended ? <p className={s.waiting}>{vt(locale, "live.waiting")}</p> : null}
        {feed}
        {ended && mode === "replay" && view.visit.status === "recording" ? <p className={s.waiting}>{vt(locale, "live.ended")}</p> : null}
        <div ref={bottom} />
      </div>

      <div className={s.ctrl}>
        {onPause ? (
          <button type="button" className={s.round} onClick={onPause} aria-label={vt(locale, paused ? "ctrl.resume" : "ctrl.pause")} data-testid="visit-pause">
            {paused ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5l12 7-12 7z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1.2" />
                <rect x="14" y="5" width="4" height="14" rx="1.2" />
              </svg>
            )}
          </button>
        ) : null}
        <div className={`${s.wave} ${listening ? "" : s.waveIdle}`} aria-hidden data-testid="visit-wave" data-listening={listening ? "true" : "false"}>
          {Array.from({ length: 22 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${((i * 37) % 110) / 100}s` }} />
          ))}
        </div>
        <button type="button" className={`rp-btn rp-btn-accent ${s.end}`} onClick={onEnd} disabled={ending || view.visit.status !== "recording"} data-testid="visit-end">
          {ending ? vt(locale, "ctrl.ending") : vt(locale, "ctrl.end")}
        </button>
      </div>
      {endError ? (
        <p className={s.notice} data-testid="visit-end-error">
          {vt(locale, "ctrl.failed")}
        </p>
      ) : null}
      {onUseLive ? (
        <button type="button" className="rp-btn rp-btn-ghost" onClick={onUseLive} data-testid="visit-use-live">
          {vt(locale, "ctrl.useLive")}
        </button>
      ) : null}
    </div>
  );
}
