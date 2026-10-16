/** A medicine's check status (核对状态) as a small pill; states that still need checking use the check colour. */
import type { Locale } from "@/lib/i18n";
import { mt } from "@/lib/meds/i18n";
import type { MedStatus } from "@/lib/meds/types";
import { cx } from "./classes";

const NEEDS_CHECK: MedStatus[] = ["awaiting_label", "unverified", "unidentified"];

export function StatusPill({ status, locale }: { status: MedStatus; locale: Locale }) {
  return (
    <span className={`rp-tag ${cx.status}`} data-check={NEEDS_CHECK.includes(status)} data-testid="med-status" data-status={status}>
      {mt(locale, `status.${status}`)}
    </span>
  );
}
