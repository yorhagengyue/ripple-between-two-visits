import type { ReactNode } from "react";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { EventKind } from "./EventCard";

/**
 * A count in words and a number (「医生交代 2」), no pill: the second draft keeps numbers in plain lines. 16px. Not a
 * button; the words say what is counted.
 */
export function CountPill({ kind, label, count, className, style }: FamilyBaseProps & { kind?: EventKind; label: ReactNode; count: number }) {
  return (
    <span className={cx("rpf rpf-pill", className)} data-rp="count-pill" data-kind={kind} style={style}>
      <span>{label}</span>
      <b>{count}</b>
    </span>
  );
}

/** Counts in a line that wraps. */
export function CountPills({ children, className, style }: FamilyBaseProps & { children: ReactNode }) {
  return (
    <div className={cx("rpf rpf-pills", className)} data-rp="count-pills" style={style}>
      {children}
    </div>
  );
}
