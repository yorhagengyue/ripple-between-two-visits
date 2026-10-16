"use client";

/**
 * Her error screen (the fe-d track; the v3 draft's I2): when one of her pages cannot be rendered, most of all when the
 * store could not be read, the screen says so in her own look: 「现在连不上 Ripple。」, that his reminders are not
 * affected, 「再试一次」, and 「打电话给爸爸」 (his number is kept on this phone; shown when the address still names her
 * link). It never shows a page built from a guess and never an error's own text. The same rule as the app's own error
 * screen (app/error.tsx, track A), which keeps serving his pages.
 */
import { useEffect, useState } from "react";
import { CallDad } from "@/components/family/CallDad";
import { FamilyButton, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { dadWord } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";

function phoneLanguage(): Locale {
  if (typeof document === "undefined") return "zh-Hans";
  const cookie = /(?:^|;\s*)rp_lang=([^;]+)/.exec(document.cookie)?.[1];
  if (cookie === "en" || cookie === "zh-Hans") return cookie;
  return (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh-Hans";
}

// `retry` (Next 16.3): fetch the segment again and render it; `reset` would only render again what failed
export default function HerError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [linkId, setLinkId] = useState<string | null>(null);
  useEffect(() => {
    setLocale(phoneLanguage());
    setLinkId(new URLSearchParams(window.location.search).get("link"));
  }, []);
  // how she calls him is not known here (nothing could be read): the plain word, 爸爸 / Dad, and 他 / he
  const dad = dadWord(null, locale);
  return (
    <div className="contents" data-testid="family-app" data-state="error">
      <FamilyScreen locale={locale}>
        <FamilyTop brand locale={locale} />
        <FamilyHero tone="quiet" title={hc(locale, "loadingFail")} detail={hc(locale, "loadingFailBody", { dad })} />
        <p className="rpf rpf-note" style={{ marginTop: 14 }}>
          {hc(locale, "loadingFailNote", { dad })}
        </p>
        <FamilyDock foot="e">
          <FamilyButton onClick={() => retry()} data-testid="family-retry">
            {hc(locale, "retry")}
          </FamilyButton>
          {linkId && <CallDad linkId={linkId} locale={locale} dad={dad} variant="secondary" />}
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}
