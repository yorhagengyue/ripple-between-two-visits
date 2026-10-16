import { KeyValueRow, Rows } from "@/components/ui";
import { dt } from "@/lib/daily/i18n";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · 「我约的日子」 (C2 track B, second round; real-app 2.15 「复诊事项建一行计划中的看诊，日期写『大约 11月20日』，他可以
 * 改成『我约的日子』」). Under the next-visit row of the countdown: one row that opens the screen where he sets the day he
 * booked. That screen is track V's (/p/visit?plan=<id>, saved through track F's PATCH /api/visits/[id]): one place sets
 * the day, Today and the visit list both lead to it. While the date is still the doctor's "about six weeks" the row
 * says 「我约的日子」; once he gave his own day it says 「改日子」.
 */
export function FollowUpDay({ locale, visitId, approx }: { locale: UiLocale; visitId: string; approx: boolean }) {
  return (
    <div data-testid="follow-up-day" data-approx={approx ? "true" : "false"}>
      <Rows style={{ marginTop: 0 }}>
        <KeyValueRow label={<span data-testid="follow-up-set">{dt(locale, approx ? "today.next.booked" : "today.next.change")}</span>} href={followUpHref(visitId)} />
      </Rows>
    </div>
  );
}

/** Track V's screen for the day he booked. */
export function followUpHref(visitId: string): string {
  return `/p/visit?plan=${encodeURIComponent(visitId)}`;
}
