import type { ReactNode } from "react";
import { cx } from "@/lib/ui/props";
import type { DataAttrs } from "./AuthScreen";
import { AuthIcon, type AuthIconName } from "./icons";

/**
 * The head of the welcome and of a log-in: the mark, then a centred title and a centred line (WelcomeView, SignInView).
 * `centre`: nothing else stands between it and the bottom buttons, so it sits in the middle of the free space
 * (SignInView's two spacers).
 */
export function AuthHero({ children, centre = false, className, ...data }: { children: ReactNode; centre?: boolean; className?: string } & DataAttrs) {
  return (
    <div className={cx("rpa-ios-hero", className)} data-centre={centre ? "true" : undefined} {...data}>
      {children}
    </div>
  );
}

/** The title and the line under the mark: 8px apart on the welcome screen, 10 above a log-in. */
export function AuthHeroText({ children, gap = 8, ...data }: { children: ReactNode; gap?: 8 | 10 } & DataAttrs) {
  return (
    <div className="rpa-ios-hero-text" data-gap={gap === 10 ? "10" : undefined} {...data}>
      {children}
    </div>
  );
}

/** The head of a form screen: the title 8px under the bar, its grey line 8px under the title (EmailEntryView). */
export function AuthHead({ children, className, ...data }: { children: ReactNode; className?: string } & DataAttrs) {
  return (
    <div className={cx("rpa-ios-head", className)} {...data}>
      {children}
    </div>
  );
}

/**
 * A screen's title: .title.bold (28; 34 on Mr Tan's pages), or `size="large"` for .largeTitle.bold (34; 40), the
 * welcome's and a finished screen's. An <h1>: one a screen.
 */
export function AuthTitle({ children, size = "title", align = "start", className, ...data }: { children: ReactNode; size?: "title" | "large"; align?: "start" | "centre"; className?: string } & DataAttrs) {
  return (
    <h1 className={cx("rpa-ios-title", className)} data-size={size === "large" ? "large" : undefined} data-align={align === "centre" ? "centre" : undefined} {...data}>
      {children}
    </h1>
  );
}

/**
 * Running text.
 *   "lede"    the grey line under a title (.subheadline, textSecondary); `size="callout"` for SignInView's and
 *             AllSetView's, one step larger
 *   "plain"   a sentence in the screen's own voice (.body)
 *   "strong"  the one line that matters (.headline)
 *   "note"    small print (.caption, textTertiary lightened to pass AA)
 */
export function AuthText({
  children,
  variant = "plain",
  size,
  align = "start",
  inset,
  lang,
  id,
  className,
  ...data
}: {
  children: ReactNode;
  variant?: "lede" | "plain" | "strong" | "note";
  size?: "callout";
  align?: "start" | "centre";
  /** the hero line's distance from the screen's edge: 28 on the welcome screen, 32 above a log-in */
  inset?: 28 | 32;
  lang?: string;
  id?: string;
  className?: string;
} & DataAttrs) {
  return (
    <p
      id={id}
      className={cx("rpa-ios-text", className)}
      data-rp="text"
      data-rp-role="body"
      data-variant={variant}
      data-size={size}
      data-align={align === "centre" ? "centre" : undefined}
      data-inset={inset ? String(inset) : undefined}
      lang={lang}
      {...data}
    >
      {children}
    </p>
  );
}

/** What went wrong, under the thing it is about (the iOS screens put it there as a footnote). Read out at once. */
export function AuthError({ children, align = "start", id, testId }: { children: ReactNode; align?: "start" | "centre"; id?: string; testId?: string }) {
  return (
    <p id={id} className="rpa-ios-error" role="alert" data-align={align === "centre" ? "centre" : undefined} data-testid={testId}>
      {children}
    </p>
  );
}

/** A line on its own surface with a small icon tile (AllSetView's rows): who should tap, what to mind. */
export function AuthHint({ children, icon = "person", testId }: { children: ReactNode; icon?: AuthIconName; testId?: string }) {
  return (
    <p className="rpa-ios-hint" data-rp="hint" data-testid={testId}>
      <span className="rpa-ios-tile" aria-hidden="true">
        <AuthIcon name={icon} />
      </span>
      <span>{children}</span>
    </p>
  );
}

/**
 * ProfileSetupView's circle above the name field: the first character of what he typed, or a person until he types.
 * Decoration only.
 */
export function AuthAvatar({ name }: { name: string }) {
  const initial = [...name.trim()][0]?.toUpperCase();
  return (
    <div className="rpa-ios-avatar" data-rp="avatar" aria-hidden="true">
      {initial ?? <AuthIcon name="person" />}
    </div>
  );
}

/**
 * A finished screen (AllSetView): the tick on its soft teal disc, a large centred title, a centred line; the button
 * goes in the dock after it.
 */
export function AuthDone({ children }: { children: ReactNode }) {
  return (
    <div className="rpa-ios-done" data-rp="done">
      <span className="rpa-ios-glyph" aria-hidden="true">
        <AuthIcon name="check" />
      </span>
      {children}
    </div>
  );
}

/** The welcome screen's rows (WelcomeView's FeatureRow list). */
export function AuthFeatures({ children }: { children: ReactNode }) {
  return (
    <div className="rpa-ios-features" data-rp="features">
      {children}
    </div>
  );
}

/** One row: a teal chip with its icon, a headline, a footnote. */
export function AuthFeatureRow({ icon, title, children }: { icon: AuthIconName; title: ReactNode; children: ReactNode }) {
  return (
    <div className="rpa-ios-feature" data-rp="feature">
      <span className="rpa-ios-chip" aria-hidden="true">
        <AuthIcon name={icon} />
      </span>
      <div className="rpa-ios-feature-text">
        <p className="rpa-ios-feature-title">{title}</p>
        <p className="rpa-ios-feature-sub">{children}</p>
      </div>
    </div>
  );
}
