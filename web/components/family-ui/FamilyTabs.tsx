import { Icon, type IconName } from "@/components/ui/icons";
import { UiLink } from "@/components/ui/UiLink";
import { familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";

/** "week" is the bar's second place, 日历: the key kept its first name (the copy and the test ids hang on it). */
export type FamilyTabKey = "home" | "week" | "notice" | "me";

const ORDER: readonly FamilyTabKey[] = ["home", "week", "notice", "me"];
const ICONS: Record<FamilyTabKey, IconName> = { home: "home", week: "calendar", notice: "bell", me: "user" };

/**
 * Her bottom bar (owner 10-14: both sides have one; hers is copied from the iOS app's RootTabView): four places, an
 * icon over its word, the one she is on in teal: 主页 (her home), 日历 (the month calendar, /f/month: owner 10-14
 * 「日历页面应该是一份月份的日历，而周和主页重复了」), 留意 (what needs her attention: the 「没回」 screen), 我的. Flat and dark,
 * on the page's own ground: iOS 26 draws its bar as a floating glass pill, which is the system's drawing and is not
 * imitated here. Only on those four screens: a screen where she does one thing (recording, saving his number, leaving)
 * or that is reached from one of the four (the week day by day, from her home) has none, as on his side.
 * A place's link changes the page with a short crossfade (`nav="tab"`); the bar stands still meanwhile (app/motion.css).
 */
export function FamilyTabs({ locale, active, hrefs, className, style }: FamilyBaseProps & { locale: UiLocale; active: FamilyTabKey; hrefs: Record<FamilyTabKey, string> }) {
  // the names of her places say nothing of him
  const copy = familyCopy(locale, null);
  return (
    <nav className={cx("rpf rpf-tabs", className)} data-rp="family-tabs" aria-label={copy.tabsLabel} style={style}>
      {ORDER.map((key) => (
        <UiLink key={key} href={hrefs[key]} nav="tab" className="rpf-tab" data-tab={key} aria-current={key === active ? "page" : undefined} data-testid={`family-tab-${key}`}>
          <Icon name={ICONS[key]} />
          <span>{copy.tabs[key]}</span>
        </UiLink>
      ))}
    </nav>
  );
}

/**
 * The four addresses of her bar, from her paths (lib/care/her-view.ts herPaths). 日历 leads to the month calendar:
 * `paths.month` when her paths name it, else the same link's /f/month, read off the week's address (/f/week?link=…).
 */
export function familyTabHrefs(paths: { home: string; week: string; alert: string; me: string; month?: string }): Record<FamilyTabKey, string> {
  return { home: paths.home, week: paths.month ?? paths.week.replace(/^\/f\/week(?=\?|$)/, "/f/month"), notice: paths.alert, me: paths.me };
}
