import Link from "next/link";
import type { ReactNode } from "react";
import { Explainable } from "@/components/explain/Explainable";
import { UiLink } from "@/components/ui/UiLink";
import type { HoldSubject } from "@/lib/explain/subjects";
import { cx, type DataAttrs, dataAttrs, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ChevronLeft, ChevronRight } from "./Glyphs";
import "./month.css";

/**
 * Her month calendar (owner 10-14: 「日历页面应该是一份月份的日历」), drawn as the iOS app's: a row to change the month, the
 * weekday letters, a grid of day cells with rounded corners (the day's number, small markers under it), a legend that
 * says each marker in words, and under it the chosen day's records as hairline rows. Presentational: plain props and
 * no state. A day is chosen by following its cell's link, so the page is the same on a reload.
 *
 * The page hands in each cell's markers, each legend entry and each row as nodes, so it can wrap what belongs to one of
 * his switches in <WhileShared> (components/family/HerLive.tsx): that part leaves the page the moment he switches it off.
 *
 * Marked for the step that makes his records long-pressable: a cell carries data-explain-type="day" and its date in
 * data-explain-ref; a row carries its kind ("dose", "bp", "visit", "question") and the record it stands for.
 *
 * That step (owner 10-14: the long press of his side is on hers too): a row given `hold` can be held for half a second
 * and Ripple's read of that record opens, through her link and cut by his switches (components/explain/Explainable.tsx).
 * The wrap is inside the row, around its line: the row keeps its marks, its test id and its hairline, and a row that
 * opens a screen still opens it on a tap. The day cells stay plain taps: a day stands for several records, not one.
 *
 * Owner 10-15 (the demo video): a day with a reading outside the target his doctor set carries a small upward triangle in
 * the doctor's colour instead of the reading's dot (OutsideMark); its row on the chosen day is tinted (tone "outside");
 * his notes are rows of their own (kind "note"); a tapped day also opens as a sheet (MonthDaySheet.tsx).
 */

/** The month's own row: one month back at the left, 「今天」 in the middle (only on another month), one month on at the right. */
export function MonthNav({
  label,
  prev,
  today,
  next,
  className,
  style,
}: FamilyBaseProps & {
  /** what the row is, for a screen reader: 「换月份」 */
  label: string;
  /** without `href` the month cannot be opened (before his first day, after the current month): shown dimmed */
  prev: { href?: string; label: ReactNode };
  today?: { href: string; label: ReactNode };
  next: { href?: string; label: ReactNode };
}) {
  return (
    <nav className={cx("rpf rpf-month-nav", className)} data-rp="month-nav" aria-label={label} style={style}>
      {prev.href ? (
        <UiLink href={prev.href} data-testid="month-prev">
          <ChevronLeft />
          {prev.label}
        </UiLink>
      ) : (
        <span aria-disabled="true" data-testid="month-prev-off">
          <ChevronLeft />
          {prev.label}
        </span>
      )}
      {today ? (
        <UiLink href={today.href} data-testid="month-today">
          {today.label}
        </UiLink>
      ) : (
        <span aria-hidden="true" />
      )}
      {next.href ? (
        <UiLink href={next.href} data-testid="month-next">
          {next.label}
          <ChevronRight />
        </UiLink>
      ) : (
        <span aria-disabled="true" data-testid="month-next-off">
          {next.label}
          <ChevronRight />
        </span>
      )}
    </nav>
  );
}

export interface MonthGridCell {
  /** "2026-10-14" */
  date: string;
  /** the number in the cell */
  dom: number;
  /** choosing this day: the same page with the day in its address */
  href: string;
  /** the day in words for a screen reader: 「10月14日 周三 今天」 */
  label: string;
  isToday?: boolean;
  /** a day still to come: dimmed */
  future?: boolean;
  /** the day whose records are listed under the grid */
  chosen?: boolean;
  /** he has a record on this day that she may see: the number in the main colour (else dimmed) */
  has?: boolean;
  /** the small markers under the number, each with its own words for a screen reader */
  markers?: ReactNode;
}

/**
 * The weekday letters and the days of one month, Monday first (as her week strip). Each cell is a link at least 44px
 * each way: the number (today in the accent colour, bold, on a tinted ground; a day with records in the main colour;
 * any other day dimmed) and its markers. `lead` empty cells stand before the 1st.
 */
export function MonthGrid({
  label,
  weekdays,
  lead,
  cells,
  className,
  style,
}: FamilyBaseProps & { /** the month in words: 「2026年10月」 */ label: string; /** seven, Monday first */ weekdays: readonly string[]; lead: number; cells: readonly MonthGridCell[] }) {
  return (
    <div className={cx("rpf rpf-month", className)} data-rp="month" data-testid="month-grid" style={style}>
      <div className="rpf-month-wd" aria-hidden="true">
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <ol className="rpf-month-grid" aria-label={label}>
        {Array.from({ length: lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden="true" />
        ))}
        {cells.map((c) => (
          <li key={c.date}>
            {/* the grid stays where it is while the day under it changes; a day's page is read only when it is chosen */}
            <Link
              href={c.href}
              scroll={false}
              prefetch={false}
              className="rpf-month-cell"
              aria-current={c.chosen ? "true" : undefined}
              data-today={c.isToday ? "true" : undefined}
              data-future={c.future ? "true" : undefined}
              data-chosen={c.chosen ? "true" : undefined}
              data-has={c.has ? "true" : undefined}
              data-explain-type="day"
              data-explain-ref={c.date}
              data-testid={`month-day-${c.date}`}
            >
              <span className="rpf-month-num" aria-hidden="true">
                {c.dom}
              </span>
              <span className="rpf-month-sr">{c.label}</span>
              <span className="rpf-month-marks">{c.markers}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A blood-pressure reading was recorded: a small filled dot. With `label` it is said to a screen reader. */
export function BpDot({ label, className, style, ...rest }: FamilyBaseProps & { label?: string } & DataAttrs) {
  return <i className={cx("rpf-month-dot", className)} data-marker="bp" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style} {...dataAttrs(rest)} />;
}

/**
 * Owner 10-15: a reading that day outside the target his doctor set (lib/daily/bp-target.ts): a small upward triangle in
 * the doctor's colour, in the reading's dot's place. With `label` it is said to a screen reader.
 */
export function OutsideMark({ label, className, style, ...rest }: FamilyBaseProps & { label?: string } & DataAttrs) {
  return <i className={cx("rpf-month-tri", className)} data-marker="bp-above" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style} {...dataAttrs(rest)} />;
}

/** A visit that day, held or planned: a small ring. With `label` it is said to a screen reader. */
export function VisitRing({ label, className, style, ...rest }: FamilyBaseProps & { label?: string } & DataAttrs) {
  return <i className={cx("rpf-month-ring", className)} data-marker="visit" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style} {...dataAttrs(rest)} />;
}

/** The legend under the grid: each marker with what it means, in words. */
export function MonthLegend({ label, children, className, style }: FamilyBaseProps & { label: string; children: ReactNode }) {
  return (
    <ul className={cx("rpf rpf-month-legend", className)} data-rp="month-legend" data-testid="month-legend" aria-label={label} style={style}>
      {children}
    </ul>
  );
}

export function MonthLegendItem({ mark, children, ...rest }: { mark: ReactNode; children: ReactNode } & DataAttrs) {
  return (
    <li {...dataAttrs(rest)}>
      <span className="rpf-month-legend-mark" aria-hidden="true">
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The chosen day under the legend: its date as a heading (「今天」 after it on today) and its records as rows, or one
 * plain line when there is nothing she may see.
 */
export function MonthDayPanel({
  title,
  today,
  empty,
  children,
  className,
  style,
}: FamilyBaseProps & { title: ReactNode; today?: ReactNode; /** the one line of a day with nothing to list; the rows are then not drawn */ empty?: ReactNode; children?: ReactNode }) {
  return (
    <section className={cx("rpf rpf-month-day", className)} data-rp="month-day" data-testid="month-day" style={style}>
      <h2 className="rpf-month-dayhead">
        {title}
        {today && <span>{today}</span>}
      </h2>
      {empty ? (
        <p className="rpf-month-none" data-testid="month-day-empty">
          {empty}
        </p>
      ) : (
        <ul className="rpf-month-rows">{children}</ul>
      )}
    </section>
  );
}

/**
 * One record of the chosen day: its marker, what it is with quiet lines under it, and at the right its state or its
 * numbers. With `href` the whole row opens a screen (a visit's record) and ends in a chevron.
 */
export function MonthRow({
  kind,
  explainRef,
  mark,
  title,
  lang,
  sub,
  value,
  tone,
  href,
  hold,
  ...rest
}: {
  kind: "dose" | "bp" | "visit" | "question" | "note";
  /** the record this row stands for: its id, or date|slot|medicine for a medicine's cell */
  explainRef: string;
  mark?: ReactNode;
  title: ReactNode;
  /** the language of `title` when it is someone's own words */
  lang?: string;
  sub?: readonly ReactNode[];
  value?: ReactNode;
  /** warn: 「没吃」「没回」 in amber, as on her week; quiet: nothing happened yet; outside: a reading outside the doctor's target (tinted) */
  tone?: "warn" | "quiet" | "outside";
  href?: string;
  /** the record of his this row can be held for: what it is, her care link, the language, and its name for the sheet's head */
  hold?: { subject: HoldSubject; link: string; locale: UiLocale; label?: string };
} & DataAttrs) {
  const body = (
    <>
      <span className="rpf-month-rowmark" aria-hidden="true">
        {mark}
      </span>
      <span className="rpf-month-rowtext">
        <span className="rpf-month-rowtitle" lang={lang}>
          {title}
        </span>
        {(sub ?? []).map((s, i) => (
          <span key={i} className="rpf-month-rowsub">
            {s}
          </span>
        ))}
      </span>
      {value != null && value !== "" && <span className="rpf-month-rowvalue">{value}</span>}
      {href && <ChevronRight />}
    </>
  );
  const line = href ? (
    <UiLink href={href} nav="forward" className="rpf-month-rowin">
      {body}
    </UiLink>
  ) : (
    <div className="rpf-month-rowin">{body}</div>
  );
  return (
    <li className="rpf-month-row" data-kind={kind} data-tone={tone} data-explain-type={kind} data-explain-ref={explainRef} data-testid={`month-${kind}`} {...dataAttrs(rest)}>
      {hold ? (
        <Explainable subject={hold.subject} locale={hold.locale} link={hold.link} label={hold.label}>
          {line}
        </Explainable>
      ) : (
        line
      )}
    </li>
  );
}
