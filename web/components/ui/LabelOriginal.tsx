import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";

/**
 * The words printed on the medicine label, in the mono face, exactly as printed (case kept, never translated):
 * "Take ONE tablet every MORNING". 18px. Put it under a <SourceTag kind="label"> so the bag icon and 「药袋上写着」
 * say where it comes from.
 */
export function LabelOriginal({
  children,
  lang = "en",
  filming,
  className,
  style,
}: UiBaseProps & { children: string; lang?: string }) {
  return (
    <p className={cx("rpu rpu-orig", className)} data-rp="label-original" lang={lang} translate="no" {...filmingAttr(filming)} style={style}>
      {children}
    </p>
  );
}
