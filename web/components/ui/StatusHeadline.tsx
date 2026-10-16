import { Fragment, type ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";

function Lines({ lines }: { lines: readonly ReactNode[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The one big sentence at the top of a screen that says where things stand: 「早上的药，还没记。」 (34px, 800).
 * variant="question": his own question is the title (30px), with 「你问」 above it (the hero answer screen).
 * variant="ask": a question the screen asks him (28px), e.g. 「这句是医生说的吗？」.
 */
export function StatusHeadline({
  lines,
  variant = "status",
  kicker,
  filming,
  className,
  style,
}: UiBaseProps & {
  /** one entry per line; break where a person would pause */
  lines: readonly ReactNode[];
  variant?: "status" | "question" | "ask";
  /** question variant: the small label above ("你问" / "You asked") */
  kicker?: ReactNode;
}) {
  if (variant === "question") {
    return (
      <div className={cx("rpu", className)} data-rp="headline" data-variant="question" {...filmingAttr(filming)} style={style}>
        {kicker && <p className="rpu-asked">{kicker}</p>}
        <h1 className="rpu-question">
          <Lines lines={lines} />
        </h1>
      </div>
    );
  }
  if (variant === "ask") {
    return (
      <p className={cx("rpu rpu-ask", className)} data-rp="headline" data-variant="ask" {...filmingAttr(filming)} style={style}>
        <Lines lines={lines} />
      </p>
    );
  }
  return (
    <h1 className={cx("rpu rpu-headline", className)} data-rp="headline" data-variant="status" {...filmingAttr(filming)} style={style}>
      <Lines lines={lines} />
    </h1>
  );
}
