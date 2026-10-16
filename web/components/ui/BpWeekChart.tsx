import type { ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";

export interface BpWeekDay {
  /** the weekday's short word: 「一」 / "Mon" */
  weekday: string;
  /** the day of the month: 「14」 */
  day: string;
  /** a reading of that day; none: the column stays empty (never drawn as 0) */
  sys?: number | null;
  dia?: number | null;
  today?: boolean;
}

/**
 * A week of blood pressure (the draft's `chart`): one ink bar per day from the lower number to the upper one with the
 * reading above it, and the doctor's own numbers as dashed lines with their value. Nothing is coloured and nothing
 * says good or bad: the caption says whose numbers the lines are. The scale is fixed (70 to 160) so weeks compare.
 */
export function BpWeekChart({
  days,
  refs = [],
  caption,
  low = 70,
  high = 160,
  label,
  filming,
  className,
  style,
}: UiBaseProps & {
  days: readonly BpWeekDay[];
  /** the doctor's numbers: a dashed line at each */
  refs?: readonly { value: number; label: string }[];
  caption?: ReactNode;
  low?: number;
  high?: number;
  /** what the picture is, for a screen reader (the list under it carries every reading as text) */
  label?: string;
}) {
  const top = (v: number) => `${(((high - Math.min(Math.max(v, low), high)) / (high - low)) * 100).toFixed(2)}%`;
  return (
    <figure className={cx("rpu rpu-chart", className)} data-rp="bp-week" {...filmingAttr(filming)} style={{ margin: 0, ...style }}>
      <div className="rpu-chart-plot" role="img" aria-label={label}>
        {refs.map((r) => (
          <div key={`l-${r.value}`} className="rpu-chart-ref" style={{ top: top(r.value) }} />
        ))}
        {refs.map((r) => (
          <div key={`t-${r.value}`} className="rpu-chart-ref-t" style={{ top: top(r.value) }} translate="no">
            {r.label}
          </div>
        ))}
        <div className="rpu-chart-days">
          {days.map((d, i) => (
            <div key={i} className="rpu-chart-day">
              {d.sys != null && d.dia != null ? (
                <>
                  <div className="rpu-chart-bar" style={{ top: top(d.sys), height: `${(((Math.min(d.sys, high) - Math.max(d.dia, low)) / (high - low)) * 100).toFixed(2)}%` }} />
                  <div className="rpu-chart-v" style={{ top: top(d.sys) }} translate="no">
                    {d.sys}/{d.dia}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="rpu-chart-x">
        {days.map((d, i) => (
          <span key={i} data-today={d.today ? "true" : undefined}>
            <b>{d.weekday}</b>
            <span>{d.day}</span>
          </span>
        ))}
      </div>
      {caption != null && <figcaption className="rpu-chart-cap">{caption}</figcaption>}
    </figure>
  );
}
