import type { ReactNode } from "react";
import { cx } from "@/lib/ui/props";
import type { PlotModel } from "./week";
import "./bp.css";

/**
 * The week's picture on the blood pressure page (the draft's `chart`, in the foundation's frame: components/ui
 * BpWeekChart and its .rpu-chart rules). This one draws what an account's week really holds, which the foundation's
 * piece cannot yet:
 *
 *   - a day may have a morning and an evening reading (the doctor's 「早晚各一次」): the bars stand side by side, the
 *     morning one on the left;
 *   - the scale follows the model (components/bp/week.ts plotModel): 70 to 160, wider only when a reading or one of the
 *     doctor's numbers would fall outside, so no bar is cut short;
 *   - the reading is written over a bar only when the week leaves room for it (`labelled`); the list under the picture
 *     carries every reading as text either way;
 *   - the doctor's numbers stand in a gutter on the right, clear of Sunday's column.
 *
 * Ink bars only: nothing is coloured and nothing says good or bad. The caption says whose numbers the dashed lines are.
 */
export function BpWeekPlot({
  model,
  weekdays,
  refs = [],
  caption,
  label,
  testId,
  className,
}: {
  model: PlotModel;
  /** the seven short weekday words, Monday first: 「一」 … 「日」 */
  weekdays: readonly string[];
  /** the doctor's numbers: a dashed line at each */
  refs?: readonly { value: number; label: string }[];
  caption?: ReactNode;
  /** what the picture is, for a screen reader */
  label?: string;
  testId?: string;
  className?: string;
}) {
  const { low, high } = model;
  const span = high - low;
  const at = (v: number) => ((high - Math.min(Math.max(v, low), high)) / span) * 100;
  return (
    <figure className={cx("rpu rpu-chart rp03-plot", className)} data-rp="bp-week" data-testid={testId} data-low={low} data-high={high} data-labelled={model.labelled ? "true" : "false"} style={{ margin: 0 }}>
      <div className="rpu-chart-plot" role="img" aria-label={label}>
        {refs.map((r) => (
          <div key={`l-${r.value}`} className="rpu-chart-ref" style={{ top: `${at(r.value).toFixed(2)}%` }} />
        ))}
        {refs.map((r) => (
          <div key={`t-${r.value}`} className="rpu-chart-ref-t" style={{ top: `${at(r.value).toFixed(2)}%` }} translate="no">
            {r.label}
          </div>
        ))}
        <div className="rpu-chart-days">
          {model.days.map((d) => {
            const n = d.bars.length;
            // one bar is the draft's 14px; two stand 6px apart; more get thinner so a day still fits its column
            const width = n <= 1 ? 14 : n === 2 ? 12 : n === 3 ? 8 : 6;
            const gap = n === 2 ? 6 : 3;
            const total = n * width + Math.max(0, n - 1) * gap;
            return (
              <div key={d.date} className="rpu-chart-day" data-date={d.date} data-bars={n}>
                {d.bars.map((b, i) => {
                  const top = at(b.sys);
                  const height = Math.max(at(b.dia) - top, 2.6);
                  return (
                    <div
                      key={i}
                      className="rpu-chart-bar"
                      data-part={b.part}
                      style={{ top: `${top.toFixed(2)}%`, height: `${height.toFixed(2)}%`, width, marginLeft: 0, left: `calc(50% - ${total / 2}px + ${i * (width + gap)}px)`, borderRadius: width / 2 }}
                    />
                  );
                })}
                {model.labelled && n === 1 ? (
                  <div className="rpu-chart-v" style={{ top: `${at(d.bars[0].sys).toFixed(2)}%` }} translate="no">
                    {d.bars[0].sys}/{d.bars[0].dia}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rpu-chart-x">
        {model.days.map((d, i) => (
          <span key={d.date} data-today={d.today ? "true" : undefined}>
            <b>{weekdays[i]}</b>
            <span>{Number(d.date.slice(8, 10))}</span>
          </span>
        ))}
      </div>
      {caption != null && <figcaption className="rpu-chart-cap">{caption}</figcaption>}
    </figure>
  );
}
