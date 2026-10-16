"use client";

/**
 * 「开通知：爸爸没回时告诉你」 at the top of her home (C2 track I's follow-up; real-app 2.21: 「开了『没回通知』时，出『开通
 * 知：爸爸没回时告诉你』，走 2.6」; drawn as the v3 draft's quiet line under the top bar, its I4, by the fe-d track). He
 * switched on "tell her when two reminders get no reply", but this phone of hers cannot be told: no notifications here.
 *
 *   never asked / off here   the line itself is the action, in real-app's words: the tap asks the browser, subscribes
 *                            this phone and has 「通知已经开好了」 sent to it (lib/push/client.ts enablePush); then the
 *                            line says 「通知开好了。」
 *   an iPhone not opened from the Home Screen
 *                            the line that says to add it there first (2.6), and 「去打开」
 *   refused, a browser without push
 *                            「通知关着，爸爸没回时你收不到。」 (the draft's I4) and 「去打开」
 * 「去打开」 opens 「我的」→「通知」, which says how to turn them on (G2). The browser is not asked again (2.6): the line
 * only says where things stand. Nothing is shown until this phone's state is read, and nothing while notifications are on.
 */
import { useEffect, useState } from "react";
import { NoticeRow } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import { enablePush, readPushStatus, type PushState } from "@/lib/push/client";
import { pushWords } from "./PushStep";

export function nudgeWords(dad: string, locale: Locale): string {
  return hc(locale, "pushNudge", { dad });
}

export function PushNudge({ locale, dad, openHref }: { locale: Locale; dad: string; /** 「我的」→「通知」 */ openHref?: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    void readPushStatus()
      .then((s) => live && setState(s.state))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (state === null) return null;
  if (done) {
    return (
      <div className="rpf-notice-wrap" data-testid="push-nudge" data-state="on">
        <NoticeRow icon="check" rise>
          <span data-testid="push-nudge-said">{pushWords("on", locale)}</span>
        </NoticeRow>
      </div>
    );
  }
  if (state === "on") return null;
  const askable = state === "default" || state === "off" || state === "failed";
  const label = hc(locale, "pushOpen");
  if (askable) {
    return (
      <div className="rpf-notice-wrap" data-testid="push-nudge" data-state={state}>
        {state === "failed" && (
          <NoticeRow icon="dash">
            <span data-testid="push-nudge-said">{pushWords("failed", locale)}</span>
          </NoticeRow>
        )}
        {/* the offer in real-app's words is the action itself: the whole line asks, from her tap */}
        <NoticeRow
          icon="bell-off"
          action={{
            label: nudgeWords(dad, locale),
            chevron: true,
            wide: true,
            pending,
            testId: "push-nudge-on",
            onClick: async () => {
              // straight from her tap: the browser asks only inside one
              setPending(true);
              const r = await enablePush({ welcome: true });
              setPending(false);
              if (r.state === "on") setDone(true);
              setState(r.state);
            },
          }}
        />
      </div>
    );
  }
  return (
    <div className="rpf-notice-wrap" data-testid="push-nudge" data-state={state}>
      <NoticeRow icon="bell-off" action={openHref ? { label, chevron: true, href: openHref, testId: "push-nudge-open" } : undefined}>
        {state === "needs_home_screen" ? <span data-testid="push-nudge-said">{pushWords(state, locale)}</span> : hc(locale, "pushOffLine", { dad })}
      </NoticeRow>
    </div>
  );
}
