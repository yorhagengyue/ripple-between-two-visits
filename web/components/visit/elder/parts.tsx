"use client";

/**
 * Small pieces the visit screens share (web/progress/fe-05.md), each built from the foundation's classes and tokens
 * (app/ripple-ui.css) plus this group's own stylesheet:
 *
 *   VisitHeader   the header of a screen inside the flow: the same markup as components/ui PageHeader, but its way
 *                 back can be a button (a step of the flow, not another address) and it can leave 「我」 out (while he
 *                 records, a stray tap must not take him off the page)
 *   VisitDock     the white strip at the foot of the screen with the question and its buttons (the draft's `dk`)
 *   Heading       a 28px heading with a grey line under it (the draft's `h`)
 *   Problem       something did not work (the draft's 通用-2): a red-bordered box that says what still holds, 「再试
 *                 一次」 as the first button, another way on under it; no apology, no error code. On a long page it
 *                 brings itself into view as it comes up (`reveal`)
 *   RecBar        「● 正在录 00:58」 with a second line under the words
 *   useClip       one clip of the recording, played and stopped by one button
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlayClip } from "@/components/chat/PlayClip";
import { Box, TlControls } from "@/components/ui";
import { HeaderMe, HeaderUnder } from "@/components/ui/AccountHeader";
import { Icon } from "@/components/ui/icons";
import { uiCopy } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";
import "./visit-elder.css";

export function VisitHeader({
  title,
  subtitle,
  locale,
  onBack,
  backLabel,
  me = true,
  line = false,
}: {
  title: ReactNode;
  /** the grey line under the title */
  subtitle?: ReactNode;
  locale: UiLocale;
  /** 「‹ 看诊」 as a button: one step back inside the flow */
  onBack?: () => void;
  backLabel?: string;
  /** false: no 「我」 on this screen (recording, saving) */
  me?: boolean;
  line?: boolean;
}) {
  const copy = uiCopy(locale);
  return (
    <>
      <div className="rpu rpu-meta" data-rp="meta" data-line={line ? "true" : undefined}>
        {onBack ? (
          <button type="button" className="rpu-back rpu-visit-back" data-rp="back" onClick={onBack}>
            <Icon name="back" stroke={2.8} />
            {backLabel ?? copy.back}
          </button>
        ) : null}
        <div className="rpu-meta-row">
          <div className="rpu-meta-text">
            <h1 className="rpu-meta-title" data-rp="page-title">
              {title}
            </h1>
            {subtitle != null ? (
              <span className="rpu-meta-story" data-rp="meta-story">
                {subtitle}
              </span>
            ) : null}
          </div>
          {me ? (
            <span className="rpu-meta-end">
              <HeaderMe label={copy.me} />
            </span>
          ) : null}
        </div>
      </div>
      {/* the line under an example account's header is a link: not on a screen he must not be taken off (me={false}) */}
      {me ? <HeaderUnder /> : null}
    </>
  );
}

export function VisitDock({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="rpu rpu-visit-dock" data-rp="dock" data-testid={testId}>
      {children}
    </div>
  );
}

export function Heading({ title, sub, level = 2 }: { title: ReactNode; sub?: ReactNode; level?: 1 | 2 }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="rpu rpu-visit-h" data-rp="headline">
      <H className="rpu-visit-h-t">{title}</H>
      {sub != null ? <p className="rpu-visit-h-s">{sub}</p> : null}
    </div>
  );
}

export function Problem({
  title,
  children,
  retryLabel,
  onRetry,
  pending = false,
  retryTestId,
  other,
  reveal = false,
  testId,
}: {
  /** what did not work, in one plain sentence */
  title: ReactNode;
  /** what still holds, or what he can do */
  children?: ReactNode;
  retryLabel: string;
  onRetry: () => void;
  pending?: boolean;
  retryTestId?: string;
  /** the other way on: a secondary button */
  other?: ReactNode;
  /** on a long page: as it comes up it is brought to the middle of the screen (never left under the fold, behind the strip of buttons) */
  reveal?: boolean;
  testId?: string;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (reveal) root.current?.scrollIntoView({ block: "center" });
  }, [reveal]);
  return (
    <div ref={root} className="rpu-stack" data-rp="problem" data-testid={testId} role="alert">
      <Box variant="red" title={title}>
        {children}
      </Box>
      <div className="rpu rpu-btns">
        <button type="button" className="rpu rpu-btn" data-variant="primary" data-rp="retry" data-testid={retryTestId} onClick={onRetry} disabled={pending} aria-busy={pending ? true : undefined}>
          <span>{retryLabel}</span>
        </button>
        {other}
      </div>
    </div>
  );
}

export function RecBar({ elapsed, locale, sub, mini = false }: { elapsed: string; locale: UiLocale; sub?: ReactNode; mini?: boolean }) {
  return (
    <p className="rpu rpu-rec" data-rp="recording" data-mini={mini ? "true" : undefined} role="status" style={{ margin: 0 }}>
      <span className="rpu-rec-dot" aria-hidden="true" />
      <span className="rpu-visit-rec-text">
        <span>{uiCopy(locale).recording}</span>
        {sub != null ? <span className="rpu-visit-rec-sub">{sub}</span> : null}
      </span>
      <span className="rpu-rec-time">{elapsed}</span>
    </p>
  );
}

/** One clip (a line of the recording): `toggle` plays it from its start, or stops it. */
export function useClip(url: string | null): { playing: boolean; toggle: () => void } {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  function toggle() {
    if (!url) return;
    let a = audio.current;
    if (!a || a.src !== new URL(url, window.location.href).href) {
      a = new Audio(url);
      a.addEventListener("playing", () => setPlaying(true));
      for (const ev of ["ended", "pause", "error"]) a.addEventListener(ev, () => setPlaying(false));
      audio.current = a;
    }
    if (playing) {
      a.pause();
      a.currentTime = 0;
      return;
    }
    void a.play().catch(() => setPlaying(false));
  }
  return { playing, toggle };
}

/**
 * A line's recording: the round play button and the line that fills as it plays (ux pass 10-12, round 4: the same
 * piece as under every other quoted line, components/chat/PlayClip), with the tag that says so for a stand-in voice.
 * `children` follow in a row of their own under it (a tag, the small 「改一下」).
 */
export function ClipRow({
  clip,
  label,
  locale,
  testId,
  children,
}: {
  clip: { url: string; standIn: boolean } | null;
  /** the button's words when idle: 「听这一句」, 「听原声」 */
  label: string;
  locale: UiLocale;
  /** the hook around the pill and its tag (data-clip-url, data-playing) */
  testId?: string;
  children?: ReactNode;
}) {
  const copy = uiCopy(locale);
  if (!clip && !children) return null;
  return (
    <>
      {/* the hook keeps its name and the clip's address; whether it plays is on the row inside it (clip-row, data-playing) */}
      {clip ? (
        <span style={{ display: "contents" }} data-testid={testId} data-clip-url={clip.url}>
          <PlayClip url={clip.url} standIn={clip.standIn} locale={locale} label={label} playingLabel={copy.playing} testId="clip-row" />
        </span>
      ) : null}
      {children ? <TlControls>{children}</TlControls> : null}
    </>
  );
}
