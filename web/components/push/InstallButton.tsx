"use client";

/**
 * 「装到主屏」 (C2 track I, follow-up; real-app 2.6): there only while Android's browser has offered installing Ripple
 * and the offer is unused, wherever in the app the offer was caught (lib/push/install.ts). One tap opens the browser's
 * own install sheet. Nothing is rendered otherwise, so a page can always mount it.
 */
import { SecondaryButton } from "@/components/ui";
import { pushPageCopy, type PushPageLocale } from "@/lib/push/copy";
import { useInstallOffer } from "@/lib/push/install";

export function InstallButton({ locale, disabled, testId = "push-install", onDone }: { locale: PushPageLocale; disabled?: boolean; testId?: string; onDone?: (outcome: "accepted" | "dismissed" | "unavailable") => void }) {
  const c = pushPageCopy(locale);
  const offer = useInstallOffer();
  if (!offer.available) return null;
  return (
    <SecondaryButton icon="home" pending={offer.busy} disabled={disabled} onClick={() => void offer.install().then((o) => onDone?.(o))} data-testid={testId}>
      {offer.busy ? c.installing : c.install}
    </SecondaryButton>
  );
}
