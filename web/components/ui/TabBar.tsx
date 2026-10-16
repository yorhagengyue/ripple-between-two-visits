import { TAB_HREFS, TAB_KEYS, TAB_OF, uiCopy, type TabKey, type TabPage } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon, TAB_ICON } from "./icons";
import { TabProbe, TabWaitScope } from "./TabWait";
import { UiLink } from "./UiLink";

/**
 * His bottom bar (owner, 10-14): four places, each an icon over its word, as her bar is drawn (components/family-ui/
 * FamilyTabs.tsx) but on his white ground and in his sizes: 今天 (Today), 就诊 (Visits), 记录 (Records), 我 (Me).
 * 「我」 is a place of the bar; the circle at the top right of his headers is gone (the language switch stays there).
 * The words are 18px; the place he is on is bold and purple under a 4px bar, so it is never told by colour alone.
 * Each place is a link at least 48px each way; four of them fit a 360px phone with the longest English word.
 *
 * `active` names the page's place. The three pages that were tabs until 10-14 may still name themselves (questions,
 * bp, meds): the bar marks the place they belong to now (lib/ui/copy.ts TAB_OF: the question list is part of 就诊,
 * blood pressure and the medicines of 记录). Jump menus, session codes and "connected" never go here (director mode).
 *
 * A tab he tapped whose page is still on its way looks chosen at once, and a line over the bar says 「正在打开……」
 * after a moment and 「还在打开，网络有点慢。」 after three seconds (TabWait.tsx; the draft's 通用-1).
 *
 * The motion pass (owner 10-14, 「仿 iOS」): a place's link changes the page with a short crossfade (`nav="tab"`), the
 * bar itself stands still over the moving pages, and the mark of the chosen place fades across (app/motion.css).
 */
export function TabBar({
  active,
  locale,
  hrefs,
  labels,
  placement = "fixed",
  filming,
  className,
  style,
}: UiBaseProps & {
  active?: TabPage;
  locale: UiLocale;
  hrefs?: Partial<Record<TabKey, string>>;
  labels?: Partial<Record<TabKey, string>>;
  placement?: "fixed" | "absolute" | "static";
}) {
  const copy = uiCopy(locale);
  const current = active ? TAB_OF[active] : undefined;
  const opening = Object.fromEntries(TAB_KEYS.map((key) => [key, key === "today" ? copy.tabOpeningToday : copy.tabOpening]));
  return (
    <nav
      className={cx("rpu rpu-tabs", className)}
      data-rp="tabbar"
      data-placement={placement}
      data-lang={locale === "en" ? "en" : "zh"}
      aria-label={copy.tabsLabel}
      lang={locale}
      {...filmingAttr(filming)}
      style={style}
    >
      <TabWaitScope opening={opening} slow={copy.tabSlow}>
        {TAB_KEYS.map((key) => (
          <UiLink key={key} href={hrefs?.[key] ?? TAB_HREFS[key]} nav="tab" className="rpu-tab" data-tab={key} aria-current={key === current ? "page" : undefined}>
            <Icon name={TAB_ICON[key]} />
            <span className="rpu-tab-label">{labels?.[key] ?? copy.tabs[key]}</span>
            <TabProbe tab={key} />
          </UiLink>
        ))}
      </TabWaitScope>
    </nav>
  );
}
