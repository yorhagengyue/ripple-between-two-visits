import type { ReactNode } from "react";
import { AuthLink } from "./AuthLink";
import type { DataAttrs } from "./AuthScreen";
import { AuthIcon, type AuthIconName } from "./icons";

/**
 * One way on from a screen that asks one thing (「你是哪一位？」): a link as wide as the screen, with its icon chip, a
 * title, one line saying what is behind it, and a chevron. The whole card is the link; the icons are decoration. Put
 * the ways in the screen's <AuthDock>, one under another, where SignInView has its two ways to continue.
 *
 * The iOS app has no such row; it is made of its parts: RippleCard's surface block (a hairline, 20px corners),
 * FeatureRow's chip, headline and line, and the chevron of a row that leads on.
 */
export function AuthWay({ href, icon, title, children, ...data }: { href: string; icon: AuthIconName; title: ReactNode; children: ReactNode } & DataAttrs) {
  return (
    <AuthLink href={href} nav="forward" className="rpa-ios-way" data-rp="way" {...data}>
      <span className="rpa-ios-chip" aria-hidden="true">
        <AuthIcon name={icon} />
      </span>
      <span className="rpa-ios-way-text">
        <span className="rpa-ios-way-title">{title}</span>{" "}
        <span className="rpa-ios-way-sub">{children}</span>
      </span>
      <AuthIcon name="forward" />
    </AuthLink>
  );
}
