/**
 * 「装到主屏」 on Android (C2 track I, follow-up; real-app 2.6: 「安卓：有安装提示时，显示『装到主屏』按钮」). Browser only.
 *
 * Chrome offers installing a web app once, with a `beforeinstallprompt` event, on whichever page happens to be open
 * when it decides the app is installable. A page that starts listening later never hears it. So the event is caught
 * once for the whole app: INSTALL_CATCH_SCRIPT (lib/push/install-script.ts) runs from the root layout before any page code and keeps the event on
 * `window.__rpInstall`; every page that shows the button reads it from there (useInstallOffer), whenever it was fired.
 *
 *   window.__rpInstall = { event, installed }
 *   "rp:install" on window        the offer arrived, was used, or the app was installed
 *
 * The browser's own install banner is held back (preventDefault): he gets one way to do it, a button that says what it
 * does, on 「我」, on 「提醒和通知」 and at the end of setting up.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { blockedState } from "./client";
import { INSTALL_EVENT } from "./install-script";

/** Chrome's install offer (not in the DOM's types). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  event: InstallPromptEvent | null;
  installed: boolean;
}

type WindowWithInstall = Window & { __rpInstall?: InstallState };

function state(): InstallState | null {
  return typeof window === "undefined" ? null : ((window as WindowWithInstall).__rpInstall ?? null);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(INSTALL_EVENT, onChange);
  return () => window.removeEventListener(INSTALL_EVENT, onChange);
}

const offered = () => !!state()?.event;
const installedNow = () => !!state()?.installed;
const never = () => false;

const nothingToWatch = () => () => undefined;
const needsHomeScreen = () => blockedState() === "needs_home_screen";

/**
 * An iPhone that did not open Ripple from the Home Screen (known only in the browser; false while the server renders):
 * the pages show the three pictured steps at once, before he taps anything (real-app 2.6).
 */
export function useNeedsHomeScreen(): boolean {
  return useSyncExternalStore(nothingToWatch, needsHomeScreen, never);
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallOffer {
  /** the browser offered installing and the offer is still unused */
  available: boolean;
  /** installed during this visit */
  installed: boolean;
  busy: boolean;
  /** call it straight from a tap: the browser's own install sheet opens */
  install(): Promise<InstallOutcome>;
}

/** The install offer, wherever in the app it was caught. */
export function useInstallOffer(): InstallOffer {
  const available = useSyncExternalStore(subscribe, offered, never);
  const installed = useSyncExternalStore(subscribe, installedNow, never);
  const [busy, setBusy] = useState(false);
  const install = useCallback(async (): Promise<InstallOutcome> => {
    const s = state();
    const event = s?.event;
    if (!s || !event) return "unavailable";
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice.catch(() => null);
      // an offer can be used once: whatever he chose, this one is spent
      s.event = null;
      if (choice?.outcome === "accepted") s.installed = true;
      window.dispatchEvent(new Event(INSTALL_EVENT));
      return choice?.outcome === "accepted" ? "accepted" : "dismissed";
    } catch {
      s.event = null;
      window.dispatchEvent(new Event(INSTALL_EVENT));
      return "unavailable";
    } finally {
      setBusy(false);
    }
  }, []);
  return { available, installed, busy, install };
}
