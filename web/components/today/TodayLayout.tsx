import type { ReactNode } from "react";
import { ActionDock, Screen } from "@/components/ui/Screen";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * The Today screen (/p/today) as named sections, for the pages that pass whole sections: the /design frames, and the
 * one-thing screens of an account's Today (track D's 「是她吗？」). An account's own day is one timeline and is composed
 * in components/daily/elder/TodayAccount.tsx. Each section is one file in components/today owned by one track
 * (web/progress/f2.md has the table); a page passes the sections it has and leaves the others out.
 *
 * Order top to bottom: meta, banner, headline, focus, reminder, dose, bp, countdown, watch, chat, ask
 * (a section given as `focus` is not repeated in its usual place). Blocks are 18px apart, as in the timeline draft.
 */
export type TodaySectionKey = "reminder" | "dose" | "bp" | "countdown" | "watch" | "chat" | "ask";

export const TODAY_ORDER: readonly TodaySectionKey[] = ["reminder", "dose", "bp", "countdown", "watch", "chat", "ask"];

export interface TodayLayoutProps {
  locale: UiLocale;
  filming?: boolean;
  fill?: "viewport" | "container";
  /** the header: <PageHeader> / <MetaBar> */
  meta: ReactNode;
  /** <ExampleBanner> when the account runs on the example data */
  banner?: ReactNode;
  /** the one status sentence (<StatusHeadline>, <DoneHero>, or the asked question) */
  headline: ReactNode;
  /** the section that needs him now; it goes right under the headline */
  focus?: TodaySectionKey;
  /** buttons for the focus section, placed in the lower part (<ActionDock>) */
  actions?: ReactNode;
  reminder?: ReactNode;
  dose?: ReactNode;
  bp?: ReactNode;
  countdown?: ReactNode;
  watch?: ReactNode;
  chat?: ReactNode;
  ask?: ReactNode;
  /** <TabBar active="today"> */
  tabBar?: ReactNode;
  tabBarPlacement?: "static" | "fixed" | "absolute";
  /** <SayBar>: the strip above the tab bar */
  sayBar?: ReactNode;
  /** <UndoToast> after a tap */
  toast?: ReactNode;
}

export function TodayLayout(props: TodayLayoutProps) {
  const { locale, filming, fill, meta, banner, headline, focus, actions, tabBar, tabBarPlacement = "fixed", sayBar, toast } = props;
  const order = focus ? [focus, ...TODAY_ORDER.filter((k) => k !== focus)] : TODAY_ORDER;
  const present = order.filter((k) => props[k] !== undefined && props[k] !== null && props[k] !== false);
  return (
    <Screen locale={locale} filming={filming} fill={fill} tabBar={tabBar} tabBarPlacement={tabBarPlacement} sayBar={sayBar} toast={toast}>
      {meta}
      {banner}
      {headline}
      {present.length ? (
        <div className="rpu-stack" style={{ marginTop: 18 }}>
          {present.map((key) => (
            <section key={key} className="rpu-section" data-today-section={key} data-focus={key === focus ? "true" : undefined}>
              {props[key]}
            </section>
          ))}
        </div>
      ) : null}
      {actions && <ActionDock>{actions}</ActionDock>}
    </Screen>
  );
}
