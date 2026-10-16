import type { ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { UiLink } from "./UiLink";

/**
 * Right after a tap: a big accent tick, 「记好了。」 and when (tone v2 ②). Takes the place of the status sentence.
 */
export function DoneHero({
  title,
  detail,
  locale,
  filming,
  className,
  style,
}: UiBaseProps & { title: ReactNode; detail?: ReactNode; locale: UiLocale }) {
  return (
    <div className={cx("rpu rpu-donehero", className)} data-rp="done-hero" {...filmingAttr(filming)} style={style}>
      <span className="rpu-bigcheck" role="img" aria-label={uiCopy(locale).done}>
        <Icon name="check" stroke={3} />
      </span>
      <div>
        <h1 className="rpu-donehero-title">{title}</h1>
        {detail && <p className="rpu-donehero-sub">{detail}</p>}
      </div>
    </div>
  );
}

/**
 * A finished thing folded into one line: tick, what and when, and a bordered 「改一下」 button.
 * "Amlodipine 5 mg / 早上 · 8:52 记的 / 改一下".
 */
export function DoneRow({
  title,
  detail,
  locale,
  changeHref,
  changeLabel,
  mark = "done",
  filming,
  className,
  style,
}: UiBaseProps & {
  title: ReactNode;
  /** the when line, "早上 · 8:52 记的" */
  detail?: ReactNode;
  locale: UiLocale;
  /** where 「改一下」 goes; no button without it */
  changeHref?: string;
  changeLabel?: string;
  /** "done" draws the tick; "noted" (没吃, 等一下, anything that is not done) draws a neutral dash, so a missed dose never looks taken */
  mark?: "done" | "noted";
}) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-done", className)} data-rp="done" {...filmingAttr(filming)} style={style}>
      <span className={cx("rpu-tick", mark === "noted" && "rpu-tick-noted")} role="img" aria-label={mark === "noted" ? copy.noted : copy.done} data-mark={mark}>
        <Icon name={mark === "noted" ? "dash" : "check"} stroke={2.8} />
      </span>
      <div className="rpu-done-text">
        <div className="rpu-done-t1">{title}</div>
        {detail && <div className="rpu-done-t2">{detail}</div>}
      </div>
      {changeHref && (
        <UiLink href={changeHref} className="rpu-chip-btn" data-rp="change">
          {changeLabel ?? copy.change}
        </UiLink>
      )}
    </div>
  );
}

/**
 * A label and its value on one line, hairline under it (「下次看诊 · 大约 10月5日」). With `href` the whole row is a
 * link with a chevron (「要问医生的 · 1 个 ›」). `count` puts a number in the mono slot before the words.
 */
export function KeyValueRow({
  label,
  value,
  href,
  count,
  filming,
  className,
  style,
}: UiBaseProps & { label: ReactNode; value?: ReactNode; href?: string; count?: number }) {
  const inner = (
    <>
      <span>
        {count !== undefined && <span className="rpu-row-num">{count}</span>}
        {label}
      </span>
      <span className="rpu-row-value">
        {value}
        {href && <Icon name="chevron" stroke={2.6} />}
      </span>
    </>
  );
  if (href) {
    return (
      <UiLink href={href} nav="forward" className={cx("rpu rpu-row", className)} data-rp="row" data-rp-role="body" {...filmingAttr(filming)} style={style}>
        {inner}
      </UiLink>
    );
  }
  return (
    <div className={cx("rpu rpu-row", className)} data-rp="row" data-rp-role="body" {...filmingAttr(filming)} style={style}>
      {inner}
    </div>
  );
}

/** A count and what is waiting, as a link with a chevron: 「3 个问题等下次看诊问 ›」. */
export function NextRow({ href, count, children, filming, className, style }: UiBaseProps & { href: string; count?: number; children: ReactNode }) {
  return <KeyValueRow href={href} count={count} label={children} filming={filming} className={className} style={style} />;
}

/** Several rows in a group, hairlines between them (no card). */
export function Rows({ children, className, style }: Omit<UiBaseProps, "filming"> & { children: ReactNode }) {
  return (
    <div className={cx("rpu rpu-rows", className)} data-rp="rows" style={style}>
      {children}
    </div>
  );
}

/**
 * 「✓ 已在下次看诊的问题单里 ›」: tick, words, chevron, a hairline on top. `atBottom` pushes it to the foot of the
 * column (the hero answer's last line).
 */
export function AddedRow({
  href,
  children,
  atBottom = false,
  filming,
  className,
  style,
}: UiBaseProps & { href: string; children: ReactNode; atBottom?: boolean }) {
  return (
    <UiLink
      href={href}
      nav="forward"
      className={cx("rpu rpu-added", className)}
      data-rp="added"
      data-at={atBottom ? "bottom" : undefined}
      {...filmingAttr(filming)}
      style={style}
    >
      <Icon name="check" stroke={2.6} />
      <span>{children}</span>
      <Icon name="chevron" stroke={2.4} className="rpu-added-chev" />
    </UiLink>
  );
}

/** One hairline. Groups are separated by whitespace and this line, never by a card. */
export function Divider({ top, bottom, className, style }: Omit<UiBaseProps, "filming"> & { top?: number; bottom?: number }) {
  return <hr className={cx("rpu rpu-hr", className)} data-rp="divider" style={{ marginTop: top, marginBottom: bottom, ...style }} />;
}

/**
 * A reading in the mono face, 46px, with its unit: "150/95 mmHg". No colour, no word that judges it: it only ever
 * sits next to the number the doctor gave.
 */
export function ReadingNumber({ value, unit, filming, className, style }: UiBaseProps & { value: string; unit?: string }) {
  return (
    <p className={cx("rpu rpu-reading", className)} data-rp="reading" {...filmingAttr(filming)} style={style}>
      <span className="rpu-reading-num" translate="no">
        {value}
      </span>
      {unit && <span className="rpu-reading-unit">{unit}</span>}
    </p>
  );
}
