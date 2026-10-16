import type { ReactNode } from "react";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import { DayMark, type DayMarkKind } from "./WeekStrip";

export interface DayListRow {
  key: string;
  /** 「周四」 */
  weekday: ReactNode;
  /** 「9月17日」 */
  date: ReactNode;
  mark: DayMarkKind;
  /** the day's state at the right of the row: 「吃了 8:52」, 「没吃」, 「还没到」 */
  markWords: ReactNode;
  /** kept for older callers: quiet lines under the row. The v3 draft has none (one state per day, no reason). */
  lines: readonly ReactNode[];
  isToday?: boolean;
  /** after the date on today's row: 「今天」 */
  todayWord?: ReactNode;
}

/**
 * 「这一周」 day by day (the v3 draft's C1): seven rows, each the day's mark (30px), the weekday, the date and, at the
 * right, the state with the time he tapped. One state per day; never a reason.
 */
export function DayList({ rows, className, style }: FamilyBaseProps & { rows: readonly DayListRow[] }) {
  return (
    <ol className={cx("rpf rpf-daylist", className)} data-rp="day-list" data-testid="day-list" style={style}>
      {rows.map((r) => (
        <li key={r.key} data-mark={r.mark} data-today={r.isToday ? "true" : undefined} data-testid={`day-${r.key}`} style={r.lines.length ? { display: "block" } : undefined}>
          <div className="rpf-dayrow" data-mark={r.mark} data-today={r.isToday ? "true" : undefined} style={r.lines.length ? { borderBottom: 0 } : undefined}>
            <DayMark mark={r.mark} size={30} today={r.isToday} />
            <span className="rpf-dayrow-wd">{r.weekday}</span>
            <span className="rpf-dayrow-date">
              {r.date}
              {r.isToday && r.todayWord ? <>　{r.todayWord}</> : null}
            </span>
            <span className="rpf-dayrow-state">{r.markWords}</span>
          </div>
          {r.lines.map((l, i) => (
            <p key={i} className="rpf-note" style={{ padding: "0 0 10px 44px" }}>
              {l}
            </p>
          ))}
          {r.lines.length > 0 && <div style={{ borderBottom: "1px solid var(--rpf-hair)" }} />}
        </li>
      ))}
    </ol>
  );
}
