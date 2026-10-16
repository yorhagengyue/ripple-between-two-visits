import type { ReactNode } from "react";
import { cx } from "@/lib/ui/props";

/**
 * What a not-yet-built section shows: a dashed frame with the section's name, the track that builds it, and what it
 * will show. Every stub in components/today and components/me renders one; the track replaces the whole stub file.
 */
export function SectionPlaceholder({
  name,
  owner,
  shows,
  section,
  className,
}: {
  name: ReactNode;
  /** the construction track that owns it: 「B 时钟和每一天」 */
  owner: ReactNode;
  /** one line: what it will show */
  shows: ReactNode;
  section: string;
  className?: string;
}) {
  return (
    <div className={cx("rpu rpu-placeholder", className)} data-rp="placeholder" data-section={section}>
      <p className="rpu-placeholder-name">{name}</p>
      <p className="rpu-placeholder-line">{shows}</p>
      <p className="rpu-placeholder-line">待建 · {owner}</p>
    </div>
  );
}
