/**
 * The few lines that catch Android's install offer for the whole app (C2 track I, follow-up; real-app 2.6 「装到主屏」).
 * No imports: the root layout (a server component) puts INSTALL_CATCH_SCRIPT in the page before any page code runs;
 * lib/push/install.ts (browser) reads what it caught. Why and how: see lib/push/install.ts.
 */

/** Fired on window when the offer arrives, is used, or the app is installed. */
export const INSTALL_EVENT = "rp:install";

/** window.__rpInstall = { event, installed }; the browser's own banner is held back (preventDefault). */
export const INSTALL_CATCH_SCRIPT = `(function(){var w=window;if(w.__rpInstall)return;var s=w.__rpInstall={event:null,installed:false};function tell(){try{w.dispatchEvent(new Event("${INSTALL_EVENT}"))}catch(e){}}w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();s.event=e;tell()});w.addEventListener("appinstalled",function(){s.event=null;s.installed=true;tell()})})();`;
