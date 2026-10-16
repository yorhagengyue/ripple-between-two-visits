import type { ReactNode } from "react";
import { Explainable } from "@/components/explain/Explainable";
import { UiLink } from "@/components/ui/UiLink";
import type { HoldSubject } from "@/lib/explain/subjects";
import { familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ChevronRight } from "./Glyphs";
import "./home-detail.css";

/**
 * One fact of the week as a hairline row (the v3 draft's 信息行: no cards, no big number): the name on the left in
 * grey, the value on the right (「要问医生的　2 个」). state "off" says 「没有分享」; loading and error say so in words.
 * With `href` the row opens a screen and shows a chevron. Kept under its old name.
 *
 * The owner's decision of 2026-10-14 (each of his switches shows its kind in full while it is on; until then a row was
 * a count and never a reading): the value may be his latest reading (「血压　142/88」), and `lines` are small lines
 * under the row, the whole width: when that reading was taken and how many this week, the words of his questions, where
 * the next visit is. Each line is 16px in the quiet ink; a row without lines is drawn exactly as before.
 *
 * The long press on her side (owner 10-14, the same as his: components/explain/Explainable.tsx). With `holdLink` (her
 * care link) the row, its value and its lines can each stand for one of his records and be held: `hold` the row as a
 * whole (「血压」: this week's readings), `valueHold` its value (the latest reading), `lineHolds` each line under it (a
 * question's words). The wrap adds no text and nothing to see until she holds; without `holdLink` nothing is wrapped.
 */
export function StatusCard({
  label,
  value,
  unit,
  foot,
  lines,
  state = "normal",
  locale,
  href,
  holdLink,
  hold,
  valueHold,
  lineHolds,
  className,
  style,
}: FamilyBaseProps & {
  label: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
  /** small lines under the row (only while the row is in its normal state) */
  lines?: readonly ReactNode[];
  state?: "normal" | "off" | "loading" | "error";
  locale: UiLocale;
  href?: string;
  /** her care link's id: with it the parts named below can be held (see above) */
  holdLink?: string;
  /** the record the row as a whole stands for */
  hold?: HoldSubject | null;
  /** the record its value stands for */
  valueHold?: HoldSubject | null;
  /** the record each of `lines` stands for, by its place in `lines` */
  lineHolds?: readonly (HoldSubject | null | undefined)[];
}) {
  // 「没有分享」 and 「正在载入」 say nothing of him
  const copy = familyCopy(locale, null);
  // a line keeps its place in `lines`, so the record it stands for is found again after the empty ones are left out
  const under = state === "normal" ? (lines ?? []).map((line, at) => ({ line, at })).filter(({ line }) => line !== null && line !== undefined && line !== "") : [];
  const words = (node: ReactNode) => (typeof node === "string" ? node : undefined);
  const held = (subject: HoldSubject | null | undefined, node: ReactNode) =>
    holdLink && subject && state === "normal" ? (
      <Explainable as="inline" subject={subject} locale={locale} link={holdLink} label={words(node)}>
        {node}
      </Explainable>
    ) : (
      node
    );
  const body = (
    <>
      <span>
        <span className="rpf-stat-label">{label}</span>
        {foot && (
          <span className="rpf-stat-foot" style={{ display: "block" }}>
            {foot}
          </span>
        )}
      </span>
      {state === "off" ? (
        <span className="rpf-stat-value">{copy.notShared}</span>
      ) : state === "loading" ? (
        <span className="rpf-stat-value" aria-busy="true">
          <span className="rpf-bar" data-size="small" style={{ width: 56 }} aria-hidden="true" />
          <span className="rpu-sr">{copy.loading}</span>
        </span>
      ) : state === "error" ? (
        <span className="rpf-stat-value">—</span>
      ) : (
        <span className="rpf-stat-value">
          <span>
            {held(valueHold, value)}
            {unit && <span className="rpf-stat-unit">{unit}</span>}
          </span>
          {href && <ChevronRight />}
        </span>
      )}
      {under.length > 0 && (
        <span className="rpf-stat-lines" data-rp="family-stat-lines">
          {under.map(({ line, at }, i) => (
            <span key={i} className="rpf-stat-line">
              {held(lineHolds?.[at], line)}
            </span>
          ))}
        </span>
      )}
    </>
  );
  const hasLines = under.length > 0 ? "true" : undefined;
  const row = href ? (
    <UiLink href={href} nav="forward" className={cx("rpf rpf-stat", className)} data-rp="family-stat" data-state={state} data-lines={hasLines} style={style}>
      {body}
    </UiLink>
  ) : (
    <div className={cx("rpf rpf-stat", className)} data-rp="family-stat" data-state={state} data-lines={hasLines} style={style}>
      {body}
    </div>
  );
  // the row as a whole: a box of its own around the row, which keeps its hairline and its layout inside it
  if (holdLink && hold && state === "normal") {
    return (
      <Explainable subject={hold} locale={locale} link={holdLink} label={words(label)}>
        {row}
      </Explainable>
    );
  }
  return row;
}

/** The rows of the week's counts, one hairline each. */
export function StatusGrid({ children, className, style }: FamilyBaseProps & { children: ReactNode }) {
  return (
    <div className={cx("rpf rpf-grid", className)} data-rp="family-stats" style={style}>
      {children}
    </div>
  );
}

/**
 * A name and its value, a hairline under it (「下次看诊　约 10月5日」); with `href` the row opens a screen and ends in a
 * chevron. `off`: the value is the quiet one.
 */
export function FactRow({
  label,
  value,
  href,
  off,
  className,
  style,
  ...rest
}: FamilyBaseProps & { label: ReactNode; value: ReactNode; href?: string; off?: boolean; "data-testid"?: string }) {
  const inner = (
    <>
      <span>{label}</span>
      <span className="rpf-fact-value">
        {value !== null && value !== undefined && value !== "" && <span>{value}</span>}
        {href && <ChevronRight />}
      </span>
    </>
  );
  if (href) {
    return (
      <UiLink href={href} nav="forward" className={cx("rpf rpf-fact", className)} data-state={off ? "off" : undefined} data-testid={rest["data-testid"]} style={style}>
        {inner}
      </UiLink>
    );
  }
  return (
    <div className={cx("rpf rpf-fact", className)} data-state={off ? "off" : undefined} data-testid={rest["data-testid"]} style={style}>
      {inner}
    </div>
  );
}

/** Hairline rows. `kind="settings"`: the rows of 「我的」 (the name bright, the value quiet). */
export function FactRows({ children, kind, className, style }: FamilyBaseProps & { children: ReactNode; kind?: "settings" }) {
  return (
    <div className={cx("rpf rpf-facts", className)} data-rp="facts" data-kind={kind} style={style}>
      {children}
    </div>
  );
}
