import { ListCard, ListItem, ReadingNumber } from "@/components/ui";
import { shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { WatchMetricView } from "@/lib/watch/view";
import { WATCH_WORDS } from "./copy";
import { hasGaps, WatchChart } from "./WatchChart";
import "./watch.css";

/**
 * One of the watch's three numbers on /p/watch (journey 12; design 12-1), the part under the segmented control:
 *
 *   the card    the newest value and its day, the last four weeks as a line against his usual range (WatchChart),
 *               the two days it runs between, and what the grey band is
 *   the list    the last weeks' averages, newest first; a week outside his range says so in words (above / below his
 *               usual range: described, never judged; no red, no green)
 * `part` draws one of the two alone: on the screen the observation stands between them, as the draft has it (the
 * picture, what the watch says about it, then the weeks). Without `part` both follow each other in one section.
 * States the draft does not draw: too few days to say what is usual for him (no band, one sentence instead of the
 * band's caption); days without data (the line is left open there, and one sentence says so).
 * `hidden` keeps the part in the page without showing it (the two numbers that are not chosen).
 * Server-safe (no state). Test hooks: watch-trend (data-metric; the card), watch-chart, watch-weeks (data-metric; the
 * list), watch-week (data-outside), watch-no-usual, watch-gaps.
 */
export function WatchTrend({ m, locale, hidden = false, part }: { m: WatchMetricView; locale: Locale; hidden?: boolean; part?: "chart" | "weeks" }) {
  const w = WATCH_WORDS[locale];
  const gaps = hasGaps(m.days);
  // the caption's sentence around the range itself
  const [bandBefore, bandAfter = ""] = w.band("\u0000").split("\u0000");

  const card = (
    <figure className="rpu rpu-chart rp12-chart" data-rp="watch-chart">
      {m.latest && (
        <div className="rp12-latest">
          <ReadingNumber value={m.latest.value} unit={m.unitWords} />
          <p className="rp12-latest-when">{w.latest(m.latest.dateWords)}</p>
        </div>
      )}
      <WatchChart m={m} locale={locale} />
      {gaps && (
        <p className="rpu-chart-cap" data-testid="watch-gaps">
          {w.gaps}
        </p>
      )}
      {m.usual ? (
        <figcaption className="rpu-chart-cap">
          {/* the range and its unit stay on one line (「63–69 次/分」 never breaks at its slash) */}
          {bandBefore}
          <span className="rp12-nowrap">{m.usual.words}</span>
          {bandAfter}
        </figcaption>
      ) : (
        <figcaption className="rpu-chart-cap" data-testid="watch-no-usual">
          {w.noUsual}
        </figcaption>
      )}
    </figure>
  );

  const weeks =
    m.weeks.length > 0 ? (
      <ListCard heading={w.weeks}>
        {m.weeks.map((wk) => (
          <ListItem
            key={wk.to}
            title={`${shortDay(locale, wk.from)}–${shortDay(locale, wk.to)}`}
            sub={wk.outside ? (wk.outside === "above" ? w.above : w.below) : undefined}
            right={w.average(wk.mean)}
            testId="watch-week"
            attrs={{ "data-outside": wk.outside ?? "no" }}
          />
        ))}
      </ListCard>
    ) : null;

  if (part === "weeks") {
    return (
      <div data-testid="watch-weeks" data-metric={m.id} hidden={hidden || !weeks}>
        {weeks}
      </div>
    );
  }
  return (
    <section className="rpu-stack" data-testid="watch-trend" data-metric={m.id} aria-label={m.name} hidden={hidden}>
      {card}
      {part === "chart" ? null : (
        <div data-testid="watch-weeks" data-metric={m.id} hidden={!weeks}>
          {weeks}
        </div>
      )}
    </section>
  );
}
