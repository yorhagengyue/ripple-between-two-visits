import { WatchCard } from "@/components/watch/WatchCard";
import type { WatchCardData } from "@/lib/watch/today";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · Watch (section "watch"). Track K (journey 12); the timeline design's 12-2.
 *
 * Only when there is something to say: one observation against his own usual range and 「要把这件事加进下次 check-in 的
 * 问题吗？」 要 / 不要 (components/watch/WatchCard, mode "today"). Never a cause, a medicine, an illness or blood pressure.
 * 要 puts a question on his list whose origin is the watch; 不要 folds the entry to one line. No watch, or nothing to
 * say: Today's page is given nothing and the entry is not on the day's line at all.
 *
 * Today's page (components/daily/elder/TodayAccount.tsx) draws the entry and its node, the watch's grey square, and
 * puts this inside it; so this is the entry's content, not an entry: the head line, the words, the buttons.
 *
 *   import { watchToday } from "@/lib/watch/today";
 *   const watch = await watchToday(ctx.store, ctx.session, locale);     // WatchCardData | null
 *   watch={watch ? <WatchSection locale={locale} data={watch} /> : undefined}
 *
 * Without `data` (the /design frames gallery) it renders nothing.
 */
export function WatchSection({ locale, data }: { locale: UiLocale; data?: WatchCardData | null }) {
  if (!data) return null;
  return (
    <div data-testid="today-watch">
      <WatchCard card={data} locale={locale} mode="today" />
    </div>
  );
}
