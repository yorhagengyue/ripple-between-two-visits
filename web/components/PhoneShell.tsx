import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { storyDayLabel } from "@/lib/story/clock";
// the demo phone in the timeline design's look: the old theme variables mapped onto the new palette inside .rp-patient
import "./patient/demo-phone.css";

/**
 * Column for Mr Tan's and Wei Ling's demo phone pages (judge sandbox, crew filming session): max 430px wide, with the
 * story day label pinned at the top ("Day 29 · Tue 8:15pm" / "第29天 · 周二 晚上8:15").
 * Presentational only: the page (or PatientFrame) passes session values in.
 *
 * The look is the timeline design's (components/patient/demo-phone.css: paper ground, ink, one accent, Noto Sans;
 * her phone in the daughter's dark tokens): `side` names whose phone it is, as data-rp-demo on the root, which is the
 * scope that stylesheet re-colours. The elements, their order and the test hooks are as they were.
 */
export function PhoneShell({
  locale,
  d0,
  day,
  time = null,
  filming = false,
  side = "patient",
  headerRight,
  footer,
  children,
}: {
  locale: Locale;
  d0: string;
  day: number;
  time?: string | null;
  filming?: boolean;
  /** whose phone: his (light) or hers (the daughter's dark look) */
  side?: "patient" | "family";
  /** small controls on the right of the day label (language switch) */
  headerRight?: ReactNode;
  /** pinned under the content (tab bar) */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rp-patient flex flex-col" lang={locale} data-filming={filming ? "true" : "false"} data-rp-demo={side}>
      <header className="rps-head sticky top-0 z-10 flex items-center justify-between gap-3">
        <p className="rps-day tabular-nums" data-testid="story-day-label">
          {storyDayLabel({ d0, day, time, locale })}
        </p>
        {headerRight}
      </header>
      <div className="rps-body flex-1">{children}</div>
      {footer}
    </div>
  );
}
