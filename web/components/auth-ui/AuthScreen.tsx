import type { CSSProperties, ReactNode } from "react";
import { PageTransition } from "@/components/ui/PageTransition";
import { AUTH_SCHEME, AUTH_TIER, type AuthFace } from "@/lib/ui/auth-tokens";
import { cx } from "@/lib/ui/props";
import { AuthLink } from "./AuthLink";
import { AuthIcon } from "./icons";

export type AuthLocale = "zh-Hans" | "en";

/** data-* attributes a page hands on to a piece (its test id, the data-rp marks other tracks' tests look for). */
export type DataAttrs = { [key: `data-${string}`]: string | undefined };

/**
 * One screen of the welcome, log-in, sign-up and recovery pages, derived from the iOS app's (rippleScreen: one ground
 * under everything). `side` says whose screen it is: "elder" for Mr Tan's own pages, "family" for his son's or
 * daughter's log-in and sign-up, "door" for what both see before they have said which they are (the welcome and
 * 「你是哪一位？」). It picks the size of everything inside and tells the page checks which rules hold: his pages and
 * the door are one text size up (18px text, 48px targets; an elder reads the door too), the family's are the iOS sizes
 * (16px, 44px). On a wide screen it is a 430px column.
 *
 * The root is marked data-rp-phone="light" or "dark": the set of colour variables that face's screens are drawn in
 * (lib/ui/auth-tokens.ts AUTH_SCHEME, the one switch), so no page writes it. Every rule of app/ripple-auth.css that
 * differs between the sets is keyed by this mark, and the desktop layout (app/desktop.css) finds every phone page by
 * it, keeps it a 430px column in a wide window and takes the ground beside the column from its value. Nothing in here
 * is position: fixed (the welcome's bottom area is sticky, inside the column), no size is in vw, and no layer is
 * mounted on document.body.
 */
export function AuthScreen({
  locale,
  side = "elder",
  fill = "viewport",
  children,
  className,
  style,
  "data-testid": testId,
}: {
  locale: AuthLocale;
  side?: AuthFace;
  fill?: "viewport" | "container";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** the page's own test id, on the screen's root */
  "data-testid"?: string;
}) {
  // the size it is drawn at: the door has none of its own, it is the elder's
  const tier = AUTH_TIER[side];
  const screen = (
    <div className={cx("rpa-ios-screen", className)} lang={locale} data-testid={testId} data-rp={tier === "elder" ? "screen" : "family-screen"} data-rp-side={tier} data-rp-phone={AUTH_SCHEME[side]} data-fill={fill} style={style}>
      <div className="rpa-ios-page">{children}</div>
    </div>
  );
  // the motion between two pages (components/ui/PageTransition.tsx): a page's screen only, not a sized container's
  return fill === "viewport" ? <PageTransition>{screen}</PageTransition> : screen;
}

export interface AuthBack {
  /** what the button says: 「返回」, 「换一个账号」 */
  label: string;
  /** a link back (to a page), or … */
  href?: string;
  /** … a step back inside the flow */
  onClick?: () => void;
  testId?: string;
}

/**
 * The top bar (the iOS navigation bar): back on the left, as a capsule with its chevron and its word; on the right the
 * step he is on (「第 2 步，共 9 步」) and whatever the page puts there (the language). The bar wraps when the text is
 * very large.
 */
export function AuthNav({ back, step, end, className, ...data }: { back?: AuthBack; step?: string; end?: ReactNode; className?: string } & DataAttrs) {
  const inner = back ? (
    <>
      <AuthIcon name="back" />
      {back.label}
    </>
  ) : null;
  return (
    <div className={cx("rpa-ios-nav", className)} {...data}>
      {!back ? (
        <span />
      ) : back.onClick ? (
        <button type="button" className="rpa-ios-nav-btn" data-kind="back" onClick={back.onClick} data-testid={back.testId}>
          {inner}
        </button>
      ) : (
        <AuthLink href={back.href ?? "/"} nav="back" className="rpa-ios-nav-btn" data-kind="back" data-testid={back.testId}>
          {inner}
        </AuthLink>
      )}
      {(step || end) && (
        <span className="rpa-ios-nav-end">
          {step && <span className="rpa-ios-step">{step}</span>}
          {end}
        </span>
      )}
    </div>
  );
}

/** A link on the right of the top bar, in teal words (the iOS bar's trailing item): the other language. */
export function AuthNavLink({ href, children, lang, "aria-label": ariaLabel, ...data }: { href: string; children: ReactNode; lang?: string; "aria-label"?: string } & DataAttrs) {
  return (
    <AuthLink href={href} className="rpa-ios-nav-btn" data-tint="accent" lang={lang} aria-label={ariaLabel} {...data}>
      {children}
    </AuthLink>
  );
}

/**
 * The bottom of a screen: the one filled button, then the quieter ones under it. Pushed down by the free space
 * (ProfileSetupView's Spacer). `pinned`: it stays at the bottom of the phone and the content scrolls under it
 * (WelcomeView's bottom inset).
 */
export function AuthDock({ children, pinned = false, className, ...data }: { children: ReactNode; pinned?: boolean; className?: string } & DataAttrs) {
  return (
    <div className={cx("rpa-ios-dock", className)} data-rp="dock" data-pinned={pinned ? "true" : undefined} {...data}>
      {children}
    </div>
  );
}

/** Buttons right under a form, 24px below the field (EmailEntryView). */
export function AuthActions({ children, className, ...data }: { children: ReactNode; className?: string } & DataAttrs) {
  return (
    <div className={cx("rpa-ios-actions", className)} data-rp="dock" {...data}>
      {children}
    </div>
  );
}

/** A step of a flow: a column that fills the screen (put it on the step's <form> or <div>). */
export const authFlow = "rpa-ios-flow";
/** Left out when the page is printed (everything but the recovery card). */
export const authNoPrint = "rpa-ios-no-print";
