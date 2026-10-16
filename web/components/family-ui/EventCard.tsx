import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";

export type EventKind = "doctor" | "check" | "ripple";

const KIND_ICON: Record<EventKind, IconName> = { doctor: "steth", check: "bell", ripple: "ripple" };

/**
 * An event, quietly (the second draft has no cards): a thin rule in the event's colour on the left (doctor blue,
 * amber for something to look at, Ripple teal), a tag that names the kind in words with an icon (colour never alone),
 * then the content, its source and actions.
 * - doctor: what the doctor said (only when Dad shares visit words): the words in 「」, the source with date and time;
 * - check: something to look at (no reply, not confirmed);
 * - ripple: Ripple's own items (her reminder).
 */
export function EventCard({
  kind,
  tag,
  title,
  children,
  quote,
  quoteLang,
  source,
  actions,
  rise = false,
  className,
  style,
}: FamilyBaseProps & {
  kind: EventKind;
  /** the kind in words: 「医生说」, 「提醒没有回」, 「你的提醒」 */
  tag: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  /** someone's exact words, shown in 「」 */
  quote?: ReactNode;
  quoteLang?: string;
  /** where it is from: 「9月1日 看诊，0:43」 */
  source?: ReactNode;
  actions?: ReactNode;
  /** fade in when it appears (one motion per screen at most: a new reminder coming in) */
  rise?: boolean;
}) {
  return (
    <article className={cx("rpf rpf-event", rise && "rpf-rise", className)} data-rp="event-card" data-kind={kind} style={style}>
      <p className="rpf-tag">
        <Icon name={KIND_ICON[kind]} />
        <span>{tag}</span>
      </p>
      {title && <h2 className="rpf-event-title">{title}</h2>}
      {quote && (
        <p className="rpf-event-quote" lang={quoteLang} data-verbatim="true">
          「{quote}」
        </p>
      )}
      {children && <div className="rpf-event-body">{children}</div>}
      {source && <p className="rpf-event-src">{source}</p>}
      {actions && <div className="rpf-event-acts">{actions}</div>}
    </article>
  );
}
