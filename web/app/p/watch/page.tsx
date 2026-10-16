/**
 * /p/watch — his watch (journey 12; M12 step 8; the timeline design's 12-1 「走势」). Track K's screen, relaid by
 * front-end line fe-12 (web/progress/fe-12.md).
 *
 *   the header   「‹ 今天」, 「手表」, 「只和你自己平时比」. No tab bar: the draft gives this screen none (it is reached from
 *                Today's cell and goes back there), so the screen keeps the draft's 40px under its last block (the
 *                foundation's `foot`)
 *   the choice   resting heart rate / sleep / steps, one at a time (components/watch/WatchTrends): the newest value, the
 *                last four weeks as a line against his own usual range, the weekly averages
 *   the entry    the one observation, on the watch's own node: words only (owner's tidy of 10-13). 要 / 不要 are on
 *                Today's cell and on his question list; the day he answered there, this entry says so. Nothing to say
 *                today: no entry, and nothing in its place
 *   at the foot  where the numbers come from (the example account's watch is synthetic example data, 示例数据)
 * No watch data: one dashed box that says so, nothing invented. Blood pressure, medicines, illnesses and causes never
 * appear. ?lang=en|zh-Hans renders this screen in that language.
 */
import { WatchCard } from "@/components/watch/WatchCard";
import { WatchTrends } from "@/components/watch/WatchTrends";
import { WATCH_WORDS } from "@/components/watch/copy";
import "@/components/watch/watch.css";
import { Box, PageHeader, Screen, Timeline } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";
import { sourceWords, watchView } from "@/lib/watch/view";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function WatchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const lang = typeof sp.lang === "string" ? sp.lang : null;
  const locale: Locale = lang === "en" || lang === "zh-Hans" ? lang : cookieLocale;
  const view = await watchView(ctx.store, ctx.session, locale);
  const w = WATCH_WORDS[locale];
  return (
    <Screen locale={locale} foot="plain">
      <div data-testid="page-watch" data-has={view.has ? "true" : "false"}>
        <PageHeader back={{ href: "/p/today", label: uiCopy(locale).tabs.today }} title={w.title} subtitle={w.subtitle} locale={locale} />
        <div className="rpu-stack">
          {!view.has ? (
            <Box variant="dash" title={w.none} testId="watch-none">
              {w.noneBody}
            </Box>
          ) : (
            <>
              <WatchTrends metrics={view.metrics} locale={locale} initial={view.card?.metric ?? null}>
                {view.card ? (
                  <Timeline>
                    <WatchCard card={view.card} locale={locale} mode="screen" />
                  </Timeline>
                ) : null}
              </WatchTrends>
              <p className="rpu-cite" data-testid="watch-source">
                {sourceWords(view, locale)}
              </p>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
