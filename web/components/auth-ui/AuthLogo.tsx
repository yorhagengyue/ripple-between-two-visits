import type { CSSProperties } from "react";
import { AUTH_LOGO } from "@/lib/ui/auth-tokens";
import type { DataAttrs } from "./AuthScreen";
import { LOGO_PATHS, LOGO_VIEW_BOX } from "./logo-paths";

/**
 * The Ripple mark (the iOS app's RippleLogoMark): the white logo straight on the ground, no tile. The paths are the
 * owner's own (logo-paths.ts); the colours come from the screen's variables, so the counters of p, p and e are the
 * ground showing through, whatever the ground is.
 *
 * `animated`: the mark draws itself in, once (RippleAnimatedLogo: each path's outline, then its fill). It is CSS only,
 * so it plays without waiting for scripts, and someone who asked the phone for less motion gets the finished mark.
 * `size`: 210px on the cold start's black screen (SplashView), 175px on the welcome screen (WelcomeView), 150px above
 * a log-in (SignInView); an image, so it does not grow with the text size.
 * A caller's own data-* marks go on the svg after the component's (the splash names its mark data-rp="splash-logo", so
 * data-rp="logo" stays the one mark of a screen).
 */
export function AuthLogo({
  size = "login",
  animated = false,
  decorative = false,
  ...data
}: { size?: keyof typeof AUTH_LOGO; animated?: boolean; /** next to the app's name in words: not read out a second time */ decorative?: boolean } & DataAttrs) {
  const side = AUTH_LOGO[size];
  return (
    <svg
      className="rpa-ios-logo"
      viewBox={LOGO_VIEW_BOX}
      width={side}
      height={side}
      data-rp="logo"
      data-animated={animated ? "true" : undefined}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Ripple" })}
      focusable="false"
      {...data}
    >
      {LOGO_PATHS.map((p, i) => (
        <path key={i} pathLength={1} d={p.d} data-hole={p.hole ? "true" : undefined} style={animated ? ({ "--rpa-logo-delay": `${p.delay}s` } as CSSProperties) : undefined} />
      ))}
    </svg>
  );
}
