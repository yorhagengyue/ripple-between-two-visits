import type { MouseEventHandler, ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import { Chevron } from "./Timeline";
import { UiLink } from "./UiLink";

/** The mark in front of a list row (the draft's MK table): done, to do, a count, and the node shapes in small. */
export type ListMarkKind = "ok" | "todo" | "sq" | "miss" | "doc" | "me" | "lab" | "num" | "dau" | "sos";

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon="check">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
const BANG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" aria-hidden="true" focusable="false" data-icon="bang">
    <path d="M12 5v9" />
    <path d="M12 19v.2" />
  </svg>
);

/** A 30px mark. `text` goes inside a "num" mark (a count: 「1」). Decorative; the row's words say what it is. */
export function ListMark({ kind, text }: { kind: ListMarkKind; text?: string }) {
  return (
    <span className="rpu-mk" data-mk={kind} aria-hidden="true">
      {kind === "ok" ? TICK : kind === "sos" ? BANG : kind === "num" ? text : null}
    </span>
  );
}

/**
 * A white card of rows (the draft's `list`), an optional grey heading over it.
 *
 *   <ListCard heading="这周">
 *     <ListItem title="142/85" sub="9月18日 周五" chevron href="/p/bp?reading=…" />
 *     <ListItem mark="miss" title="8月27日 晚上" right="未确认" />
 *   </ListCard>
 */
export function ListCard({ heading, children, testId, filming, className, style }: UiBaseProps & { heading?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className={cx("rpu rpu-list", className)} data-rp="list" data-testid={testId} {...filmingAttr(filming)} style={style}>
      {heading != null && <p className="rpu-label">{heading}</p>}
      <div className="rpu-list-card">{children}</div>
    </div>
  );
}

/** One row: a mark, the words and a grey line under them, words on the right, a chevron. A link, a button or plain. */
export function ListItem({
  mark,
  markText,
  title,
  sub,
  right,
  rightTone,
  rightPlacement = "side",
  chevron = false,
  href,
  onClick,
  dim = false,
  testId,
  attrs,
}: {
  mark?: ListMarkKind;
  markText?: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  /** "accent": the words on the right are a way on (「改」) */
  rightTone?: "accent";
  /**
   * "below": the words go under the title and its grey line instead of beside them. For an action of four characters
   * or more (「约个日子」): beside a title it takes the room the title needs and breaks it into two lines.
   */
  rightPlacement?: "side" | "below";
  chevron?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  dim?: boolean;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}) {
  const inner = (
    <>
      {mark && <ListMark kind={mark} text={markText} />}
      <span className="rpu-li-main">
        <span className="rpu-li-t">{title}</span>
        {sub != null && <span className="rpu-li-s">{sub}</span>}
        {right != null && rightPlacement === "below" && (
          <span className="rpu-li-r" data-tone={rightTone} data-placement="below">
            {right}
          </span>
        )}
      </span>
      {right != null && rightPlacement !== "below" && (
        <span className="rpu-li-r" data-tone={rightTone}>
          {right}
        </span>
      )}
      {chevron && <Chevron />}
    </>
  );
  const common = { className: "rpu-li", "data-rp": "list-item", "data-dim": dim ? "true" : undefined, "data-testid": testId, ...attrs };
  // a row with a chevron opens a page under this one: it slides in (lib/ui/nav-motion.ts)
  if (href !== undefined) return <UiLink href={href} nav={chevron ? "forward" : undefined} {...common}>{inner}</UiLink>;
  if (onClick) return <button type="button" onClick={onClick} {...common}>{inner}</button>;
  return <div {...common}>{inner}</div>;
}
