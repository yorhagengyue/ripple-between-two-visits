"use client";

/**
 * 我 · Reminders and notifications (entry "notifications"; C2 track I). The row says where THIS phone's reminders
 * stand; what to do about it is on the page the row opens (real-app 2.6):
 *
 *   提醒还没开                        the row opens the page that has 「开提醒」
 *   提醒没开：打开 app 时才看得到      he refused: the row opens the page that says where to allow it, and 「再试一次」
 *   iPhone 要先把 Ripple 加到主屏幕    the row opens the three pictured steps
 *   提醒开着                          the row opens what comes and when, 「发一条试试」, 「关掉这台手机的提醒」
 * and 「装到主屏」 whenever Android's browser has offered installing (caught once for the whole app).
 * 「开提醒」 and 「再试一次」 are no longer repeated under the row here (owner's tidy of 10-13).
 *
 * In the timeline draft's card (我-1) the state is the grey line under the row's name. 「装到主屏」, while it is offered,
 * sits inside the same card right under the row (.rpm-more, components/me/me.css), with what the tap just did.
 *
 * What the phone can do is known only on the phone (the browser's permission and subscription), so the server renders
 * the row with a plain line and the real state replaces it once read (lib/push/client.ts readPushStatus). The row is
 * always a link to /p/me/notifications, where everything else about reminders is.
 *
 * `live` turns that on (/p/me passes it). Without it the entry is the plain row only: the design gallery shows it
 * with nobody signed in, where there is no phone state to read.
 */
import { useEffect, useState } from "react";
import { InstallButton } from "@/components/push/InstallButton";
import { readPushStatus, type PushState } from "@/lib/push/client";
import { pushPageCopy } from "@/lib/push/copy";
import { useInstallOffer } from "@/lib/push/install";
import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";
import { Said } from "./parts";

export function NotificationsEntry({ locale, href = "/p/me/notifications", live = false }: { locale: UiLocale; href?: string; live?: boolean }) {
  if (live) return <LiveNotificationsEntry locale={locale} href={href} />;
  const c = pushPageCopy(locale);
  return <MeEntry entry="notifications" href={href} title={c.meTitle} status={c.meWaiting} />;
}

function LiveNotificationsEntry({ locale, href }: { locale: UiLocale; href: string }) {
  const c = pushPageCopy(locale);
  const [state, setState] = useState<PushState | null>(null);
  const [said, setSaid] = useState<{ text: string; tone: "done" | "problem" } | null>(null);

  useEffect(() => {
    let live = true;
    void readPushStatus()
      .then((s) => live && setState(s.state))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const status =
    state === "on"
      ? c.meOn
      : state === "denied"
        ? c.meDenied
        : state === "needs_home_screen"
          ? c.meIos
          : state === "unsupported"
            ? c.meUnsupported
            : state === null
              ? c.meWaiting
              : c.meOff;
  const offer = useInstallOffer();
  const row = <span data-testid="me-push-status" data-state={state ?? "checking"}>{status}</span>;

  // nothing to do from here: the plain row, as every other entry. Turning the reminders on, and trying again after a
  // refusal, are on the page the row opens (owner's tidy of 10-13)
  if (!said && !offer.available) return <MeEntry entry="notifications" href={href} title={c.meTitle} status={row} />;

  return (
    <>
      <MeEntry entry="notifications" href={href} title={c.meTitle} status={row} />
      {/* inside the card, under its row: 「装到主屏」 while the browser offers it, and what that tap did */}
      <div className="rpm-more" data-rp="me-entry-more" data-for="notifications">
        {said && (
          <Said tone={said.tone} testId="me-push-result">
            {said.text}
          </Said>
        )}
        <InstallButton locale={locale} testId="me-install" onDone={(o) => o === "accepted" && setSaid({ text: c.installed, tone: "done" })} />
      </div>
    </>
  );
}
