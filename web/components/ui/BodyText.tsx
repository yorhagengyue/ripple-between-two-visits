import type { ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";

/**
 * Running text in Ripple's own voice or his (sans), 20px; 22px in filming mode.
 * - "plain": a how-to line, a restated label line ("药袋上写着：每天早上吃一粒。")
 * - "lede": the grey line under a status sentence
 * - "answer": Ripple's fixed sentence in an answer (more line height)
 * - "strong": the one line that matters in a block (800)
 * `size` (the draft's paragraph sizes): "large" is 24px (a screen's opening sentence), "small" 18px; without it the
 * body size, which is the one filming mode enlarges. Any variant goes with any size.
 * Someone else's exact words go in <Said>, never here.
 */
export function BodyText({
  variant = "plain",
  size,
  lang,
  children,
  filming,
  className,
  style,
}: UiBaseProps & { variant?: "lede" | "plain" | "answer" | "strong"; size?: "large" | "small"; lang?: string; children: ReactNode }) {
  return (
    <p className={cx("rpu rpu-text", className)} data-rp="text" data-rp-role={size ? undefined : "body"} data-variant={variant} data-size={size} lang={lang} {...filmingAttr(filming)} style={style}>
      {children}
    </p>
  );
}

/** A medicine name, 25px 800 ("Amlodipine 5 mg"). Never translated. */
export function DrugName({ children, filming, className, style }: UiBaseProps & { children: ReactNode }) {
  return (
    <p className={cx("rpu rpu-drug", className)} data-rp="drug" translate="no" {...filmingAttr(filming)} style={style}>
      {children}
    </p>
  );
}
