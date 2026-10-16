"use client";

/**
 * The place of her recorder while he has not acknowledged her link (line bind; lib/care/ack.ts): 「等他在自己的手机上点了
 * 「知道了」，你就可以给他录提醒。」 and the way back to her home. She bound his account by typing it, and until he has
 * answered nothing she records may play on his phone (POST /api/reminders answers 409 link_not_acknowledged), so the
 * screen offers no recorder at all.
 *
 * The page reads itself again every few seconds: the moment he taps 「知道了」 (or changes a switch for her), the
 * recorder is here without her doing anything.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EmptyBlock, FamilyButton, FamilyDock, FamilyTop } from "@/components/family-ui";
import { bc } from "@/lib/care/bind-copy";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";

const POLL_MS = 4000;

export function ReminderLocked({ locale, dad, homeHref, langHref }: { locale: Locale; dad: string; homeHref: string; langHref?: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <>
      <FamilyTop back={{ href: homeHref, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={langHref} />
      <div className="rpf-col" data-testid="reminder-locked">
        <EmptyBlock title={bc(locale, "locked", { dad })} />
        <FamilyDock foot="e">
          <FamilyButton href={homeHref} nav="back" variant="secondary" data-testid="reminder-locked-back">
            {hc(locale, "backHome")}
          </FamilyButton>
        </FamilyDock>
      </div>
    </>
  );
}
