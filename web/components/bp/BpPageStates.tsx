"use client";

/**
 * The blood pressure page while it is not there (the timeline draft's 通用 group, on this page): what is said when it is
 * slow to open, and the screen when it could not be opened at all.
 *
 *   BpSlowNote      under the loading bars (app/p/bp/loading.tsx): after three seconds 「还在打开，网络有点慢」 (通用-1)
 *   BpErrorScreen   app/p/bp/error.tsx: the page's header and tab bar stay, a box with the red border says what
 *                   happened and what still holds, then 「再试一次」 and 「先看今天」 (通用-2). The two sentences are the
 *                   app's own fixed ones for a page that cannot be read (lib/subject/unavailable.ts), never an error's
 *                   text and never a guess about his readings.
 * Test hooks: store-unavailable, store-unavailable-retry (the names of the app's own error screen, app/error.tsx),
 * bp-loading-slow.
 */
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, useSyncExternalStore } from "react";
import { Box, PageHeader, PrimaryButton, Screen, SecondaryButton, TabBar } from "@/components/ui";
import { t, type Locale } from "@/lib/i18n";
import { STORE_UNAVAILABLE_WORDS } from "@/lib/subject/unavailable";
import { bpc } from "./copy";
import "./bp.css";

/** The phone's language as the browser has it (the rp_lang cookie; 华语 unless it says English). */
function phoneLanguage(): Locale {
  if (typeof document === "undefined") return "zh-Hans";
  const cookie = /(?:^|;\s*)rp_lang=([^;]+)/.exec(document.cookie)?.[1];
  return cookie === "en" ? "en" : "zh-Hans";
}

export function BpSlowNote({ locale, afterMs = 3000 }: { locale: Locale; afterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [afterMs]);
  if (!slow) return null;
  return (
    <p className="rpu rp03-note" role="status" data-testid="bp-loading-slow">
      {bpc(locale, "loadingSlow")}
    </p>
  );
}

/** Nothing to listen to: the language is read once, when the screen is drawn in the browser. */
const never = () => () => undefined;

export function BpErrorScreen({ reset }: { reset: () => void }) {
  const router = useRouter();
  // 华语 where there is no browser yet, the phone's own language as soon as there is one
  const locale = useSyncExternalStore<Locale>(never, phoneLanguage, () => "zh-Hans");
  const w = STORE_UNAVAILABLE_WORDS[locale];
  return (
    <Screen locale={locale} tabBar={<TabBar active="records" locale={locale} />} tabBarPlacement="fixed">
      <PageHeader title={t(locale, "nav.bp")} locale={locale} />
      <div className="rpu-stack" data-testid="store-unavailable" role="alert">
        <Box variant="red" title={w.title}>
          {w.body}
        </Box>
        <div className="rpu-btns">
          <PrimaryButton
            data-testid="store-unavailable-retry"
            onClick={() =>
              startTransition(() => {
                // read the page again from the server, then let the screen try to draw it
                router.refresh();
                reset();
              })
            }
          >
            {w.retry}
          </PrimaryButton>
          <SecondaryButton href="/p/today">{bpc(locale, "errToday")}</SecondaryButton>
        </div>
      </div>
    </Screen>
  );
}
