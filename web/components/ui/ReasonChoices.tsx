import type { MouseEvent } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { StatusHeadline } from "./StatusHeadline";
import { UiLink } from "./UiLink";

export interface ReasonOption {
  code: string;
  label: string;
}

/**
 * After 「还没吃」: why (the draft's 02-4a). One white option row per reason (the ring of a single choice in front), his
 * own routines first (打太极 on a tai-chi morning), then 忘了 / 出门了 / 药不在身边, and 「我自己说」 last. One tap answers;
 * no lecture after it. Reason words come from lib/daily (reasonOptions); the page passes them in.
 *
 * `showTitle` draws 「没吃是因为？」 above the rows; a timeline whose node already asks it passes false.
 */
export function ReasonChoices({
  reasons,
  locale,
  onPick,
  selfHref,
  showTitle = true,
  look = "rows",
  indent = false,
  filming,
  className,
  style,
}: UiBaseProps & {
  reasons: readonly ReasonOption[];
  locale: UiLocale;
  onPick?: (code: string, event: MouseEvent<HTMLButtonElement>) => void;
  /** where 「我自己说」 goes; left out, it is a button that calls onPick("self") */
  selfHref?: string;
  showTitle?: boolean;
  /** "buttons": centred buttons without the ring, 「我自己说」 last and filled, with the microphone (the canvas screen 02-4) */
  look?: "rows" | "buttons";
  /** start where a timeline's text starts */
  indent?: boolean;
}) {
  const copy = uiCopy(locale);
  const dot = look === "buttons" ? null : <span className="rpu-opt-dot" aria-hidden="true" />;
  const selfMark = look === "buttons" ? <Icon name="mic" size={24} /> : dot;
  return (
    <section className={cx("rpu", indent && "rpu-ind", className)} data-rp="reasons" data-look={look} {...filmingAttr(filming)} style={style}>
      {showTitle && <StatusHeadline variant="ask" lines={[copy.reasonTitle]} style={{ marginTop: 6 }} />}
      <div className="rpu-choices" style={showTitle ? undefined : { marginTop: 0 }}>
        {reasons.map((r) => (
          <button key={r.code} type="button" className="rpu-opt" data-rp="option" data-reason={r.code} onClick={onPick ? (e) => onPick(r.code, e) : undefined}>
            {dot}
            <span className="rpu-opt-main">
              <span className="rpu-opt-t">{r.label}</span>
            </span>
          </button>
        ))}
        {selfHref ? (
          <UiLink href={selfHref} className="rpu-opt" data-rp="option" data-reason="self">
            {selfMark}
            <span className="rpu-opt-main">
              <span className="rpu-opt-t">{copy.reasonSelf}</span>
            </span>
          </UiLink>
        ) : (
          <button type="button" className="rpu-opt" data-rp="option" data-reason="self" onClick={onPick ? (e) => onPick("self", e) : undefined}>
            {selfMark}
            <span className="rpu-opt-main">
              <span className="rpu-opt-t">{copy.reasonSelf}</span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
