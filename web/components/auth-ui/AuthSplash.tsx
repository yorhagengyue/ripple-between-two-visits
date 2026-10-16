"use client";

/**
 * The cold start: the iOS app's SplashView (a pure black screen, the mark at 210 drawing itself in once, nothing else)
 * over the welcome screen, then a short cross-fade into it. Put it last inside the front door's screen.
 *
 * What it is made of (splash.css has the rules and why they are so; splash.ts the numbers and the script):
 * - It is in the HTML the server sends, drawn and ended by CSS alone: it plays before any script has loaded, and ends
 *   by itself if none ever does. Its length is the mark's own (SPLASH_DRAW_SECONDS, from the SVG's numbers) and the
 *   fade after it; no hold is added.
 * - Once in a browser session. The small script inside it runs while the page is read, before the layer is painted:
 *   when this session has played the splash before (sessionStorage), it marks the layer data-seen and the layer is not
 *   drawn; else it leaves the note for next time.
 * - Only on a cold start: when someone comes back to the door from another page of the app, React itself draws the
 *   screen, and then this draws nothing (a script that React puts on a page does not run, so nothing could hold the
 *   splash back there). `cold` is true for the server's HTML and while React takes it over, false for a screen made in
 *   the browser.
 * - Hidden from assistive technology; the welcome under it is on the page from the start.
 * - With reduced motion asked for it is not drawn at all (the CSS).
 */
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { AuthLogo } from "./AuthLogo";
import { SPLASH_DRAW_SECONDS, SPLASH_FADE_SECONDS, SPLASH_GATE } from "./splash";
import "./splash.css";

const never = () => () => {};

export function AuthSplash() {
  // the server's HTML (and React taking it over), or a screen React made in the browser
  const fromServer = useSyncExternalStore(
    never,
    () => false,
    () => true,
  );
  const [cold] = useState(fromServer);
  if (!cold) return null;
  return (
    // the script marks this element before React takes the page over: the mark is the script's, not a mismatch
    <div
      className="rpa-ios-splash"
      data-rp="splash"
      aria-hidden="true"
      suppressHydrationWarning
      style={{ "--rpa-splash-draw": `${SPLASH_DRAW_SECONDS}s`, "--rpa-splash-fade": `${SPLASH_FADE_SECONDS}s` } as CSSProperties}
    >
      <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
      <div className="rpa-ios-splash-stage">
        <AuthLogo size="splash" animated decorative data-rp="splash-logo" />
      </div>
    </div>
  );
}
