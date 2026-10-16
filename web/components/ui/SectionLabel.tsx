import type { ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";

/**
 * A plain group name over a block: 「今天早上」, 「今天还要做的」 (18px, ink-3). It never names a speaker:
 * who said something is a <SourceTag> (icon + word + colour), because colour alone is not allowed to say it.
 */
export function SectionLabel({
  children,
  time,
  filming,
  className,
  style,
}: UiBaseProps & {
  children: ReactNode;
  /** "8:45", rendered as "· 8:45" */
  time?: string;
}) {
  return (
    <p className={cx("rpu rpu-label", className)} data-rp="label" {...filmingAttr(filming)} style={style}>
      {children}
      {time && <span> · {time}</span>}
    </p>
  );
}
