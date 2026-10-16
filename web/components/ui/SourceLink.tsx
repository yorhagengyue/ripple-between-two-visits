import type { MouseEventHandler, ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { SourceKind, UiLocale } from "@/lib/ui/tokens";
import { Tag } from "./Tag";
import { PlayGlyph } from "./Timeline";
import { UiLink } from "./UiLink";

/**
 * Where a line comes from, as a real button that opens it: the draft's play pill (56 high, the accent outline, a
 * triangle and the words: 「听原声」, 「看原文」, 「打开出处」), then the date or clip time. A stand-in voice adds a
 * 「代录音」 tag next to it, in words. Every kind looks the same: who said it is on the line above (the node and its words).
 *
 *   <SourceLink kind="doctor" play href={clip} time="9月1日 · 0:43" standIn locale="zh-Hans">听医生原声</SourceLink>
 *   <SourceLink kind="label" href="/p/meds/med-amlodipine" time="9月1日" locale="zh-Hans">看药袋原文</SourceLink>
 *
 * `href` makes it a link (pages, /api clip URLs); `onClick` makes it a button (a client player).
 */
export function SourceLink({
  kind,
  href,
  onClick,
  locale,
  children,
  time,
  play = false,
  playing = false,
  standIn = false,
  disabled = false,
  filming,
  className,
  style,
}: UiBaseProps & {
  kind: SourceKind;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** UI language: decides the stand-in tag ("代录音" / "stand-in recording") */
  locale: UiLocale;
  /** the action in words: 「听医生原声」, 「看药袋原文」, 「看单张原文」 */
  children: ReactNode;
  /** the date or the clip time, shown in ink after the words */
  time?: string;
  /** the button plays a recording (kept for callers; the pill carries the triangle either way, as in the draft) */
  play?: boolean;
  /** it is playing now (a button only): the pill is filled and shows the two bars; the caller words it (「正在播」) */
  playing?: boolean;
  /** the recording is a stand-in voice */
  standIn?: boolean;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <PlayGlyph playing={playing} />
      <span>{children}</span>
      {time && <span className="rpu-src-time">{time}</span>}
    </>
  );
  const control =
    href !== undefined && !disabled ? (
      <UiLink href={href} className="rpu-src" data-rp="source" data-kind={kind} data-play={play ? "true" : undefined}>
        {inner}
      </UiLink>
    ) : (
      <button type="button" className="rpu-src" data-rp="source" data-kind={kind} data-play={play ? "true" : undefined} aria-pressed={playing ? true : undefined} onClick={onClick} disabled={disabled || (!onClick && href === undefined)}>
        {inner}
      </button>
    );
  return (
    <div className={cx("rpu rpu-src-row", className)} data-kind={kind} {...filmingAttr(filming)} style={style}>
      {control}
      {standIn && <Tag>{uiCopy(locale).standIn}</Tag>}
    </div>
  );
}
