import type { ReactNode } from "react";
import { cx, type UiBaseProps } from "@/lib/ui/props";
import { Icon, type IconName } from "./icons";

/**
 * A word in a square-cornered frame, 18px: 「代录音」, 「女儿的录音」, 「还在等药袋确认」, 「示例」. Not a button. Every
 * tone looks the same (grey frame, grey word) except "ink": the word says the meaning, never a colour.
 */
export function Tag({
  tone = "neutral",
  icon,
  children,
  className,
  style,
}: Omit<UiBaseProps, "filming"> & {
  tone?: "neutral" | "family" | "doctor" | "accent" | "ink";
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={cx("rpu rpu-tag", className)} data-rp="tag" data-tone={tone} style={style}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
