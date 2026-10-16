import type { ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import { NODE_OF_SOURCE, type SourceKind, type UiLocale } from "@/lib/ui/tokens";
import { NodeMark } from "./Timeline";

/**
 * Who said it, or where it is written, on one line outside a timeline: the node of that source (the same shape as on
 * the timeline: lib/ui/tokens.ts NODE_OF_SOURCE), the words, then where or when in grey. There is no speaker colour:
 * the shape and the words say it.
 *
 *   <SourceTag kind="doctor" locale="zh-Hans" when="9月1日 · 0:43">Dr Lim 说过</SourceTag>   purple ring
 *   <SourceTag kind="family" locale="zh-Hans" when="8:45">女儿 Wei Ling 的语音</SourceTag>   ink ring
 *   <SourceTag kind="label" locale="zh-Hans" />                     → 「药袋上写着」, ink square outline
 *   <SourceTag kind="doctor" inferred locale="zh-Hans" when="0:49" /> → 「好像是医生说的」, dashed purple ring
 *
 * Without children it says the kind's own words (lib/ui/copy.ts sources).
 */
export function SourceTag({
  kind,
  locale,
  inferred = false,
  when,
  children,
  filming,
  className,
  style,
}: UiBaseProps & {
  kind: SourceKind;
  locale: UiLocale;
  /** the speaker is a guess not yet confirmed by him (visit lines before review): dashed ring, own words */
  inferred?: boolean;
  /** where or when, after the words: "8:45", "9月1日 · 0:43" */
  when?: string;
  children?: ReactNode;
}) {
  const copy = uiCopy(locale);
  const words = children ?? (inferred && kind === "doctor" ? copy.inferredDoctor : copy.sources[kind]);
  return (
    <p
      className={cx("rpu rpu-source", className)}
      data-rp="source-tag"
      data-kind={kind}
      data-inferred={inferred ? "true" : undefined}
      {...filmingAttr(filming)}
      style={style}
    >
      <NodeMark node={inferred && kind === "doctor" ? "unc" : NODE_OF_SOURCE[kind]} />
      <span className="rpu-source-name">{words}</span>
      {when && <span className="rpu-source-when">{when}</span>}
    </p>
  );
}
