/**
 * The cold start's numbers and its one script (components/auth-ui/AuthSplash.tsx draws it, splash.css has the rules).
 * Plain values: safe to import from a server component, a client component, a test and a Playwright spec.
 */
import { AUTH_SPLASH } from "@/lib/ui/auth-tokens";
import { LOGO_DRAW_SECONDS, LOGO_FILL_SECONDS, LOGO_PATHS } from "./logo-paths";

/** sessionStorage: this browser session has played the splash. */
export const SPLASH_SEEN_KEY = "rp_splash";

/**
 * How long the mark takes to draw itself, in seconds: the last path's delay, then its outline, then its fill (the
 * SVG's own numbers, logo-paths.ts). The splash is this long; no hold is added.
 */
export const SPLASH_DRAW_SECONDS = Math.round((Math.max(...LOGO_PATHS.map((p) => p.delay)) + LOGO_DRAW_SECONDS + LOGO_FILL_SECONDS) * 100) / 100;

/** The cross-fade into the welcome after it, in seconds. */
export const SPLASH_FADE_SECONDS = AUTH_SPLASH.fadeSeconds;

/**
 * Runs inside the layer while the page is read, before the layer is painted: when this session has played the splash
 * before, mark the layer (a marked layer is not drawn); else leave the note for next time. It only ever sets one
 * attribute on its own parent. Where sessionStorage is refused it does nothing, and the splash plays on every load.
 */
export const SPLASH_GATE = `try{var s=sessionStorage,k=${JSON.stringify(SPLASH_SEEN_KEY)};if(s.getItem(k))document.currentScript.parentNode.setAttribute("data-seen","true");else s.setItem(k,"1")}catch(e){}`;
