import { shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { WatchMetricView } from "@/lib/watch/view";
import { WATCH_WORDS } from "./copy";

/**
 * The last four weeks of one of the watch's numbers against his own usual range (design 12-1; the draft only reserves
 * the place, 「走势图」, so the picture is drawn from the draft's `chart` frame: a white card, ink marks, grey words).
 *
 *   the grey band   his usual range, a line along its top and its bottom, the two numbers in the margin on the right
 *   the ink line    one dot per day; the newest day's dot is the large one. A day without data leaves the line open
 *   under it        the first and the last day of the four weeks, and what the grey band is
 *
 * Nothing is coloured and nothing says good or bad: a day above or below the band is simply drawn there. No band when
 * there are too few days to say what is usual for him (the caption then says so, WatchTrend). Every position is a
 * percentage of the plot and every mark an element of its own, so the dots stay round at any width and text size; only
 * the line is an SVG path (its stroke does not scale). Server-safe (no state). Test hook: watch-chart.
 */

/** the plot's own margins, in percent of its box: the dots at the edges stay inside it */
const X0 = 2.5;
const X1 = 97.5;
const Y0 = 7;
const Y1 = 93;
/** the plot is 170 design px high; two margin labels nearer than this many px would touch */
const PLOT_H = 170;
const LABEL_H = 26;

const DAY_MS = 86_400_000;

/** The date `days` before an ISO date (YYYY-MM-DD), as an ISO date. */
function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Is a day of the four weeks missing between the first and the last one drawn? */
export function hasGaps(days: readonly { day: number }[]): boolean {
  return days.some((d, i) => i > 0 && d.day - days[i - 1].day > 1);
}

export function WatchChart({ m, locale }: { m: WatchMetricView; locale: Locale }) {
  const w = WATCH_WORDS[locale];
  if (m.days.length < 2) return null;
  const values = m.days.map((d) => d.value);
  const lo = Math.min(...values, m.band?.low ?? Infinity);
  const hi = Math.max(...values, m.band?.high ?? -Infinity);
  const span = hi - lo || 1;
  const first = m.days[0].day;
  const last = m.days[m.days.length - 1].day;
  const x = (day: number) => X0 + ((day - first) / Math.max(1, last - first)) * (X1 - X0);
  const y = (v: number) => Y0 + ((hi - v) / span) * (Y1 - Y0);

  // the line, left open where a day is missing
  const path = m.days.map((d, i) => `${i === 0 || d.day - m.days[i - 1].day > 1 ? "M" : "L"}${x(d.day).toFixed(2)},${y(d.value).toFixed(2)}`).join(" ");
  // where one week ends and the next begins, counted back from the newest day (as the weekly averages are)
  const weekEnds = [1, 2, 3].map((k) => last - 7 * k + 0.5).filter((d) => d > first);

  const band = m.band ? { top: y(m.band.high), bottom: y(m.band.low) } : null;
  const close = band ? ((band.bottom - band.top) / 100) * PLOT_H < LABEL_H : false;
  // the two days under the plot: the newest one is the view's own date, the oldest is counted back from it
  const lastDate = m.latest?.date ?? null;
  const firstDate = lastDate ? daysBefore(lastDate, last - first) : null;

  return (
    <>
      <div className="rp12-plot" role="img" aria-label={m.usual ? w.chart(m.name, m.usual.words) : w.chartPlain(m.name)} data-testid="watch-chart" data-band={band ? "true" : "false"}>
        {band && <div className="rp12-band" style={{ top: `${band.top.toFixed(2)}%`, height: `${Math.max(0.5, band.bottom - band.top).toFixed(2)}%` }} />}
        {weekEnds.map((d) => (
          <i key={d} className="rp12-week" style={{ left: `${x(d).toFixed(2)}%` }} />
        ))}
        <svg className="rp12-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d={path} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {m.days.map((d, i) => (
          <i key={d.day} className="rp12-dot" data-last={i === m.days.length - 1 ? "true" : undefined} style={{ left: `${x(d.day).toFixed(2)}%`, top: `${y(d.value).toFixed(2)}%` }} />
        ))}
        {band && m.usual && (
          <>
            <span className="rp12-band-t" data-edge="top" data-close={close ? "true" : undefined} style={{ top: `${band.top.toFixed(2)}%` }} translate="no">
              {m.usual.high}
            </span>
            <span className="rp12-band-t" data-edge="bottom" data-close={close ? "true" : undefined} style={{ top: `${band.bottom.toFixed(2)}%` }} translate="no">
              {m.usual.low}
            </span>
          </>
        )}
      </div>
      {firstDate && lastDate && (
        <div className="rp12-x">
          <span>{shortDay(locale, firstDate)}</span>
          <span>{shortDay(locale, lastDate)}</span>
        </div>
      )}
    </>
  );
}
