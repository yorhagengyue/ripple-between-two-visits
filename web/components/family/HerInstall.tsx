"use client";

/**
 * Putting Ripple on her home screen (C2 track D, round two; real-app 2.6, 2.21 「开通知……走 2.6」): what track I built for
 * his phone, on hers.
 *
 *   Android   「装到主屏」 while the browser has offered installing Ripple and the offer is unused, wherever in the app it
 *             was caught (lib/push/install.ts useInstallOffer: the same offer his pages read). One tap opens the
 *             browser's own install sheet. Her button, not his: components/family-ui.
 *   iPhone    the three pictured steps (components/push/HomeScreenSteps: the Share button, 「添加到主屏幕」, Ripple's
 *             icon), shown at once on an iPhone that did not open Ripple from the Home Screen, because iOS gives
 *             notifications only to a web app that is there. Track I's component as it is, in her dark colours: its
 *             elder tokens are set to the family ones on the wrapper, so nothing of his light look shows.
 *
 * Nothing is rendered when neither applies (a desktop browser, an installed app), unless `always` (her first-visit
 * step, which is about the iPhone and says so in its title).
 */
import type { CSSProperties } from "react";
import { FamilyButton } from "@/components/family-ui";
import { HomeScreenSteps } from "@/components/push/HomeScreenSteps";
import type { Locale } from "@/lib/i18n";
import { pushPageCopy } from "@/lib/push/copy";
import { useInstallOffer, useNeedsHomeScreen } from "@/lib/push/install";

/** Track I's elder tokens, set to her dark ones for everything inside. */
const HER_TOKENS = {
  "--rp-tint": "var(--rpf-surface-2)",
  "--rp-ink": "var(--rpf-ink)",
  "--rp-line": "var(--rpf-hair)",
  "--rp-font-sans": "var(--rpf-font)",
  "--rp-fs-body": "var(--rpf-fs-body)",
  "--rp-fs-secondary": "var(--rpf-fs-body)",
} as CSSProperties;

/** The third step in her words: her button says 「打开通知」, his says 「开提醒」. */
const LAST_STEP: Record<Locale, string> = {
  "zh-Hans": "回到主屏幕，点 Ripple 的图标打开，再进这一页点「打开通知」。",
  en: "Go to the Home Screen, open Ripple from its icon, come back here and tap “Turn on notifications”.",
};

export function HerInstall({ locale, always = false, pictured = true }: { locale: Locale; always?: boolean; /** false: only Android's button (her page 「我的」; the iPhone's steps have their own screen) */ pictured?: boolean }) {
  const c = pushPageCopy(locale);
  const offer = useInstallOffer();
  const ios = useNeedsHomeScreen();
  const steps = pictured && (ios || always);
  if (!offer.available && !offer.installed && !steps) return null;
  return (
    <div data-testid="her-install" data-android={offer.available ? "offered" : offer.installed ? "installed" : "none"} data-ios={ios ? "needs_home_screen" : "no"} style={{ marginTop: 14 }}>
      {offer.available && (
        <FamilyButton variant="secondary" size="small" pending={offer.busy} onClick={() => void offer.install()} data-testid="her-install-android">
          {offer.busy ? c.installing : c.install}
        </FamilyButton>
      )}
      {offer.installed && (
        <p className="rpf rpf-note" role="status" data-testid="her-install-done">
          {c.installed}
        </p>
      )}
      {steps && (
        <div style={HER_TOKENS}>
          <HomeScreenSteps locale={locale} testId="her-ios-steps" steps={[c.iosStep1, c.iosStep2, LAST_STEP[locale]]} style={{ marginTop: offer.available ? 14 : 0 }} />
        </div>
      )}
    </div>
  );
}
