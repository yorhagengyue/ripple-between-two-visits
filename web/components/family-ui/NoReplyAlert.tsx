import type { ReactNode } from "react";
import { familyCopy } from "@/lib/ui/copy";
import { cx, telHref, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { FamilyButton } from "./FamilyButton";
import { FactRow, FactRows } from "./StatusCard";
import { FamilyDock, FamilyNote } from "./FamilyScreen";
import { Timeline, type TimelineItem } from "./Timeline";

/**
 * Two reminders, no reply (the v3 draft's D2): the sentence, the morning as a timeline whose last line carries the
 * amber bell, his last entry he lets her see, ONE action, the amber 「打电话给爸爸」, and what Ripple will not do, so she
 * does not think someone is already on it. Amber, never red: this is 「去问问」, not an emergency.
 * Without `phone` the button opens `savePhoneHref`; a caller that asks for the number in the bottom sheet (D4) passes
 * its own button as `call`.
 */
export function NoReplyAlert({
  locale,
  title,
  detail,
  lastEntry,
  phone,
  savePhoneHref,
  call,
  timeline,
  timelineLabel,
  foot,
  fill = false,
  dad,
  className,
  style,
}: FamilyBaseProps & {
  locale: UiLocale;
  /** her word for him: 「打电话给妈妈」, 「她上一次记录」; null: 爸爸 / 他 */
  dad?: string | null;
  /** 「爸爸还没回早上的药。」 */
  title: ReactNode;
  /** a line under it (the draft's D2 has none) */
  detail?: ReactNode;
  /** his last entry: when and what (「昨晚 9:12」 / 「量了血压」), only what he shares */
  lastEntry?: { when: ReactNode; what: ReactNode };
  /** Dad's number, dialled by the one button */
  phone?: string | null;
  /** where she saves his number when there is none yet */
  savePhoneHref?: string;
  /** the call button itself, when the caller draws it (it then owns asking for the number) */
  call?: ReactNode;
  /** the morning: 8:45 放了你的提醒，没有回。 / 9:15 又提醒了一次，没有回。 / 9:45 记成「没回」，告诉你。 */
  timeline?: readonly TimelineItem[];
  timelineLabel?: ReactNode;
  /** after the bottom group: the line that opens what he shares */
  foot?: ReactNode;
  /** the alert is the whole screen: the call button goes to the bottom (thumb reach) */
  fill?: boolean;
}) {
  const copy = familyCopy(locale, dad);
  return (
    <section className={cx("rpf", fill && "rpf-col", className)} data-rp="no-reply" data-kind="check" data-testid="no-reply" style={style}>
      <div className="rpf-hero" data-lede={detail ? "true" : undefined}>
        <h1 className="rpf-h1" data-testid="family-headline">
          {title}
        </h1>
        {detail && <p className="rpf-sub">{detail}</p>}
      </div>
      {/* the draft's D2: 30px under a sentence that stands alone, 26px under one with a line of its own */}
      {timeline && timeline.length > 0 && <Timeline items={timeline} label={timelineLabel} sep={locale === "en" ? ", " : "，"} style={{ marginTop: detail ? 26 : 30 }} />}
      {lastEntry && (
        <FactRows style={{ marginTop: 30 }}>
          <FactRow label={copy.lastRecord} value={`${lastEntry.when} ${lastEntry.what}`} data-testid="no-reply-last" style={{ minHeight: "calc(56 * var(--rp-u))" }} />
        </FactRows>
      )}
      <FamilyDock>
        {call ??
          (phone ? (
            <FamilyButton href={telHref(phone)} variant="warn" data-testid="call-dad">
              {copy.call}
            </FamilyButton>
          ) : (
            <FamilyButton href={savePhoneHref ?? "#"} variant="warn" data-testid="call-dad">
              {copy.call}
            </FamilyButton>
          ))}
        <FamilyNote>{copy.noReplyNote}</FamilyNote>
      </FamilyDock>
      {foot}
    </section>
  );
}
