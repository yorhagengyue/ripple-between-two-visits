import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * Today, right after an answer about a medicine (ux pass, 10-12; the canvas screens 02-3 and 02-4): the screen is one
 * round mark in the middle with a few words under it, instead of an entry of the day's line.
 *
 *   DoseHero      the mark and the words. `kind`:
 *                   "taken"   the tick, which turns into a smiling face, once
 *                   "missed"  the tick alone: it was written down, nothing more is said
 *                   "why"     a puzzled face that tilts once, over 「没吃是因为？」
 *                 Someone who asked the phone for less motion gets the still mark (the tick; the still face). The
 *                 motion is the stylesheet's: app/ripple-ui.css, "ux pass 10-12 (E)".
 *   DoseHeroHer   「Wei Ling 会看到：今天吃了」 under the words, with the round person mark
 *   DoseHeroMed   the row between two hairlines: the medicine, 「改一下」; after 还没吃 also when it was written (after
 *                 吃了 the words above say it: owner's tidy of 10-13)
 *
 * Only shapes: every word is handed in by components/daily/elder/TodayAccount.tsx, which keeps the test hooks.
 */
export type DoseHeroKind = "taken" | "missed" | "why";

type Attrs = Record<`data-${string}`, string | number | undefined>;

const DONE_MARK = (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={4.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path className="rpu-hero-check" d="M12 25l8.5 8.5L36 16" />
    <circle className="rpu-hero-eye" cx="17" cy="19" r="2.8" />
    <circle className="rpu-hero-eye" cx="31" cy="19" r="2.8" />
    <path className="rpu-hero-mouth" d="M14 28c3.5 7 16.5 7 20 0" />
  </svg>
);

const WHY_MARK = (
  <svg className="rpu-hero-face" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M11.5 13h8" />
    <path className="rpu-hero-brow" d="M27 10c2.6-2.4 6.2-2.4 8.8 0" />
    <circle className="rpu-hero-dot" cx="16.5" cy="22.5" r="3" />
    <circle className="rpu-hero-dot" cx="31.5" cy="22.5" r="3" />
    <path d="M15 36q4.5-5 9 0t9 0" />
  </svg>
);

export function DoseHero({
  kind,
  eyebrow,
  title,
  sub,
  children,
  testId,
  attrs,
}: {
  kind: DoseHeroKind;
  /** the small grey line over the title (「已记下：还没吃」) */
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  testId?: string;
  attrs?: Attrs;
}) {
  return (
    <div className="rpu-hero" data-rp="dose-hero" data-hero={kind} data-testid={testId} {...attrs}>
      <span className="rpu-hero-mark" data-kind={kind} aria-hidden="true">
        {kind === "why" ? WHY_MARK : DONE_MARK}
      </span>
      {eyebrow ? <p className="rpu-hero-k">{eyebrow}</p> : null}
      <h2 className="rpu-hero-t" data-size={kind === "why" ? "ask" : undefined}>
        {title}
      </h2>
      {sub ? <p className="rpu-hero-s">{sub}</p> : null}
      {children}
    </div>
  );
}

export function DoseHeroHer({ children, testId, attrs }: { children: ReactNode; testId?: string; attrs?: Attrs }) {
  return (
    <p className="rpu-hero-her" data-testid={testId} {...attrs}>
      <span className="rpu-hero-her-mark" aria-hidden="true">
        <Icon name="person" size={22} stroke={2.2} />
      </span>
      <span>{children}</span>
    </p>
  );
}

export function DoseHeroMed({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rpu-hero-med" data-rp="dose-hero-med">
      <div className="rpu-hero-med-main">
        <p className="rpu-hero-med-t">{title}</p>
        {sub ? <p className="rpu-hero-med-s">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}
