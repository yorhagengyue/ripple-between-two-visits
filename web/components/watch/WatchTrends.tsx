"use client";

/**
 * The watch's numbers on /p/watch, one at a time (design 12-1): the segmented control 「静息心率 / 睡眠 / 步数」, under it
 * the chosen number's card, then what the watch says today (`children`: the observation's entry, the same whichever
 * number is chosen), then the chosen number's weeks (WatchTrend, in its two parts). Only the numbers the watch really
 * has are offered; with one number there is nothing to choose and no control. The two that are not chosen stay in the
 * page, hidden, so a tap changes the picture at once and the page's hooks stay the same whichever is shown.
 *
 * It opens on the number the observation is about (`initial`), else on the first. Test hooks: watch-pick (data-shown;
 * its buttons carry data-seg="<metric>"), watch-trend (data-metric), watch-weeks (data-metric).
 */
import { useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { WatchMetric } from "@/lib/watch/metrics";
import type { WatchMetricView } from "@/lib/watch/view";
import { WATCH_WORDS } from "./copy";
import { WatchTrend } from "./WatchTrend";

export function WatchTrends({ metrics, locale, initial, children }: { metrics: readonly WatchMetricView[]; locale: Locale; initial?: WatchMetric | null; children?: ReactNode }) {
  const first = metrics.find((m) => m.id === initial)?.id ?? metrics[0]?.id ?? null;
  const [shown, setShown] = useState<WatchMetric | null>(first);
  return (
    <>
      {metrics.length > 1 && (
        <div data-testid="watch-pick" data-shown={shown ?? ""}>
          <Segmented label={WATCH_WORDS[locale].pick} items={metrics.map((m) => ({ key: m.id, label: m.name, on: m.id === shown, onClick: () => setShown(m.id) }))} />
        </div>
      )}
      {metrics.map((m) => (
        <WatchTrend key={m.id} m={m} locale={locale} part="chart" hidden={m.id !== shown} />
      ))}
      {children}
      {metrics.map((m) => (
        <WatchTrend key={m.id} m={m} locale={locale} part="weeks" hidden={m.id !== shown} />
      ))}
    </>
  );
}
