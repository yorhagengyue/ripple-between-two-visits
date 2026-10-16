"use client";

/** One-tap switch between 华语 and English for the phone pages (cookie rp_lang, then re-render). */
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, otherLocale, t, type Locale } from "@/lib/i18n";

export function LangToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  return (
    <button
      type="button"
      // rps-chip: the small bordered button of the timeline design (components/patient/demo-phone.css)
      className="rp-btn rp-btn-ghost rps-chip shrink-0"
      data-testid="lang-toggle"
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${otherLocale(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        router.refresh();
      }}
    >
      {t(locale, "common.switchLanguage")}
    </button>
  );
}
