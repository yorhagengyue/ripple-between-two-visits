"use client";

/**
 * Mr Tan's bottom tabs on the demo phone: few, large, one screen each. The brief is reached from Today and Questions.
 * Labels are the short tab.* keys so English fits five columns on a 360px phone.
 *
 * The look is the timeline design's tab bar (components/patient/demo-phone.css .rps-tabs): white, words only, the
 * current one bold, purple and under a 4px bar, so it is not told by colour alone. It stays in the phone's column
 * (sticky, not fixed to the window): the demo phone is a 430px column on a computer too.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

const TABS: { href: string; key: MessageKey }[] = [
  { href: "/p/today", key: "tab.today" },
  { href: "/p/visit", key: "tab.visit" },
  { href: "/p/meds", key: "tab.meds" },
  { href: "/p/bp", key: "tab.bp" },
  { href: "/p/questions", key: "tab.questions" },
];

export function TabBar({ locale }: { locale: Locale }) {
  const path = usePathname();
  return (
    <nav className="rps-tabs sticky bottom-0 z-10 grid grid-cols-5" aria-label="Ripple" data-testid="tab-bar">
      {TABS.map((tab) => {
        const active = path === tab.href || path.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className="rps-tab">
            {t(locale, tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
