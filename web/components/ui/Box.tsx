import type { ReactNode } from "react";
import { cx, dataAttrs, filmingAttr, type DataAttrs, type UiBaseProps } from "@/lib/ui/props";
import { Chevron } from "./Timeline";
import { UiLink } from "./UiLink";

export type BoxVariant = "line" | "tint" | "ink" | "dash" | "grey" | "acc" | "red";

/**
 * A box of one or two sentences (the draft's `box`):
 *   line  white with the hairline (a plain fact)          tint  the accent tint (「Wei Ling 会看到：今天吃了」)
 *   ink   ink ground, white words                         dash  white with a dashed frame (something not there yet)
 *   grey  the grey ground (「旧的恢复码已经作废。」)          acc   white with the accent border (something waits for him)
 *   red   white with the red border (an error he must read: 「连续错了 5 次。」)
 * `title` is the bold line, `children` the line under it, `link` a worded way on (「看问题单 ›」). With `href` the whole
 * box is the link. A caller's own data-* attributes (as props, or in `attrs`) land on the box itself, and so does
 * `role` (not on a box that is a link).
 */
export function Box({
  variant = "line",
  title,
  children,
  link,
  href,
  indent = false,
  testId,
  attrs,
  role,
  filming,
  className,
  style,
  ...rest
}: UiBaseProps &
  DataAttrs & {
  variant?: BoxVariant;
  title?: ReactNode;
  children?: ReactNode;
  link?: { href: string; label: ReactNode; testId?: string };
  /** the whole box opens this */
  href?: string;
  /** start where a timeline's text starts */
  indent?: boolean;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
  /** what the box is to a screen reader: an error he must hear ("alert"), a result ("status"), an aside ("note") */
  role?: "alert" | "status" | "note";
}) {
  const own = { ...attrs, ...dataAttrs(rest) };
  const inner = (
    <>
      {title != null && <p className="rpu-box-t">{title}</p>}
      {children != null && <div className="rpu-box-s">{children}</div>}
      {link && (
        <UiLink href={link.href} nav="forward" className="rpu-box-link" data-rp="box-link" data-testid={link.testId}>
          {link.label}
          <Chevron />
        </UiLink>
      )}
    </>
  );
  const cls = cx("rpu rpu-box", indent && "rpu-ind", className);
  if (href !== undefined) {
    return (
      <UiLink href={href} nav="forward" className={cls} data-rp="box" data-variant={variant} data-testid={testId} {...own} {...filmingAttr(filming)} style={style}>
        {inner}
      </UiLink>
    );
  }
  return (
    <div className={cls} role={role} data-rp="box" data-variant={variant} data-testid={testId} {...own} {...filmingAttr(filming)} style={style}>
      {inner}
    </div>
  );
}
