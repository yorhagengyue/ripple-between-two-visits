"use client";

/**
 * The header of an account's elder screens (C2 track B): components/ui MetaBar with the real date and time under the
 * screen's title (「今天」 on Today, as in the timeline draft), and the language switch on the right (「我」 is a place of
 * the bottom bar since the owner's decision of 10-14).
 *
 * A page that still passes `langHref` gets the first header's 「中/EN」: MetaBar's switch is a link; here a tap on it
 * writes the language cookie (rp_lang, lib/i18n.ts) and re-renders the page in place, like the demo's LangToggle. The
 * link itself (`?lang=…`) is the no-script way: the page then renders once in the other language. The draft's header
 * has no switch (the language is under 「我」): Today passes none.
 */
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { MetaBar } from "@/components/ui";
import { LOCALE_COOKIE, otherLocale, type Locale } from "@/lib/i18n";
// C2 track O: without a network the re-render waits for it (a failed one would replace the open page with a full load)
import { refreshWhenOnline } from "@/lib/offline/client";

export function ElderMeta({
  locale,
  title,
  story,
  back,
  langHref,
  filming,
}: {
  locale: Locale;
  /** the screen's title (「今天」); the date and time go under it */
  title?: string;
  /** the date and time as the page words it */
  story?: string;
  back?: { href: string; label?: string };
  /** where the switch points without script: the same page with ?lang=; none: no switch in this header */
  langHref?: string;
  filming?: boolean;
}) {
  const router = useRouter();
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    const link = target?.closest?.('[data-kind="lang"]');
    if (!link) return;
    e.preventDefault();
    document.cookie = `${LOCALE_COOKIE}=${otherLocale(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    refreshWhenOnline(router);
  }
  return (
    <div onClickCapture={onClick} data-testid="elder-meta" style={{ display: "contents" }}>
      <MetaBar title={title} story={story} locale={locale} back={back} langHref={langHref} filming={filming} />
    </div>
  );
}
