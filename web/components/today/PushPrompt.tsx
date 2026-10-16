"use client";

/**
 * Today · reminders on this phone (the timeline draft's 通用-5a to 5d; real-app 2.6). A box at the top of the day's
 * overview, only while there is something to say about this phone's notifications and only until he answered once:
 *
 *   ask      (通用-5a) this browser was never asked: 「8:45 提醒你吃药，要打开通知吗？」, what happens without, and
 *            「以后再说」 / 「开提醒」. The browser's own question (通用-5b) comes only after his tap on 「开提醒」
 *            (lib/push/client.ts enablePush: permission, the subscription, the server's 「提醒已经开好了」).
 *   on       it worked: 「提醒已经开好了。」, said once.
 *   denied   (通用-5c) he refused just now: 「提醒没开：打开 app 时才看得到。」 and the way to 「我 › 提醒和通知」, where
 *            the steps for the phone's settings and 「再试一次」 are (a web page cannot open the phone's settings).
 *            Never asked again after that (real-app 2.6 「他拒绝通知权限时，不反复问」): on the next visit a refused
 *            browser shows nothing here.
 *   failed   the notice did not reach this phone: the notifications screen's sentence, and 「开提醒」 again.
 *   ios      (通用-5d) an iPhone that did not open Ripple from the Home Screen: 「iPhone 要先把 Ripple 加到主屏幕，才收
 *            得到提醒。」 and the three steps with their pictures (components/push/HomeScreenSteps.tsx), 「以后再说」.
 *
 * What the phone can do is known only in the browser, so nothing is drawn on the server or before it was looked at, and
 * nothing is fetched to decide: the browser's own permission says whether it was ever asked. 「以后再说」 is remembered
 * on this phone (localStorage; logging out forgets it with everything else, lib/offline/forget.ts) and the box does not
 * come back; 「我 › 提醒和通知」 keeps the button.
 *
 * `time`: the first reminder of his day (「8:45」); without a medicine to remind him of there is nothing to offer.
 * Test hooks: today-push (data-state), today-push-on, today-push-later, today-push-settings.
 */
import { useEffect, useState } from "react";
import { HomeScreenSteps } from "@/components/push/HomeScreenSteps";
import { Button, PrimaryButton } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { blockedState, enablePush } from "@/lib/push/client";
import { pushPageCopy } from "@/lib/push/copy";
import type { UiLocale } from "@/lib/ui/tokens";

const LATER_KEY = "rp_push_later";

type View = "hidden" | "ask" | "on" | "denied" | "failed" | "ios";

const WORDS: Record<UiLocale, { ask: (time: string) => string; later: string }> = {
  "zh-Hans": { ask: (time) => `服药提醒 · ${time}`, later: "以后再说" },
  en: { ask: (time) => `Medicine reminder · ${time}`, later: "Later" },
};

function saidLater(): boolean {
  try {
    return window.localStorage.getItem(LATER_KEY) !== null;
  } catch {
    return false;
  }
}

/** Where this phone stands, from what the browser itself knows (nothing is asked, nothing is fetched). */
function firstView(): View {
  if (saidLater()) return "hidden";
  const blocked = blockedState();
  if (blocked === "needs_home_screen") return "ios";
  if (blocked) return "hidden";
  return Notification.permission === "default" ? "ask" : "hidden";
}

export function PushPrompt({ locale, time }: { locale: UiLocale; time: string }) {
  const c = pushPageCopy(locale);
  const w = WORDS[locale];
  /**
   * a headline the notifications screen breaks over lines, as one sentence (where a Chinese line ends and the next one
   * starts with a Latin word, the space the copy writes between the two everywhere else)
   */
  const one = (lines: readonly string[]) => lines.join(locale === "en" ? " " : "").replace(/([\u4e00-\u9fff])([A-Za-z])/g, "$1 $2");
  const [view, setView] = useState<View>("hidden");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setView(firstView()), 0);
    return () => window.clearTimeout(t);
  }, []);

  const later = () => {
    try {
      window.localStorage.setItem(LATER_KEY, "1");
    } catch {
      // storage blocked: the box is back on the next visit, nothing else is lost
    }
    setView("hidden");
  };
  // straight from the tap: the browser asks for permission only inside one
  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    setView(r.state === "on" ? "on" : r.state === "denied" ? "denied" : r.state === "needs_home_screen" ? "ios" : r.state === "default" ? "ask" : r.state === "unsupported" ? "hidden" : "failed");
  };

  if (view === "hidden") return null;
  return (
    <section className="rpu rpu-pushpop" data-rp="today-push" data-rp-phone-fixed="" data-testid="today-push" data-state={view} lang={locale}>
      {/* a card that comes down over the top of Today (ux pass, 10-12); the cross puts it away for good, as 「以后再说」 did */}
      <div className="rpu-pushpop-card">
        <button type="button" className="rpu-pushpop-x" data-testid="today-push-later" aria-label={w.later} disabled={busy} onClick={later}>
          <Icon name="close" size={26} stroke={2.6} />
        </button>
        {view === "ask" || view === "failed" ? (
          <>
            <p className="rpu-pushpop-t">{view === "failed" ? c.failed : w.ask(time)}</p>
            <PrimaryButton data-testid="today-push-on" pending={busy} onClick={() => void turnOn()}>
              {c.turnOn}
            </PrimaryButton>
          </>
        ) : null}
        {view === "on" ? <p className="rpu-pushpop-t">{c.turnedOn}</p> : null}
        {view === "denied" ? (
          <>
            <p className="rpu-pushpop-t">{one(c.deniedTitle)}</p>
            <Button variant="link" href="/p/me/notifications" data-testid="today-push-settings">
              {c.meTitle}
            </Button>
          </>
        ) : null}
        {view === "ios" ? (
          <>
            <p className="rpu-pushpop-t">{one(c.iosTitle)}</p>
            <HomeScreenSteps locale={locale} />
          </>
        ) : null}
      </div>
    </section>
  );
}
