import type { ReactNode } from "react";
import { Screen } from "@/components/ui/Screen";
import { StatusHeadline } from "@/components/ui/StatusHeadline";
import type { UiLocale } from "@/lib/ui/tokens";
import { cx } from "@/lib/ui/props";
import { MeGroup } from "./MeGroup";
import "./me.css";

/**
 * The 「我」 screen (/p/me) as the timeline draft draws it (我-1, 21-1): the header (「‹ 今天」, 「我」, his name), white
 * cards of rows 18px apart, and under them what the page puts at its foot (「退出登录」). Entries are
 * components/me/*Entry, each a <MeEntry> row.
 *
 * - `grouped`: `entries` already come as <MeGroup> cards (the page groups its rows). Without it the rows are put in one
 *   card (the /design gallery and the unit tests hand in bare rows).
 * - the filming-account entry appears only when `crew` is true (a crew member's phone): in the one card when the rows
 *   are bare, in a card of its own when they are grouped (the page may place it itself instead, as 21-1 draws it:
 *   next to the example's rows).
 * - `headline`: the sentence under the header. The draft has none: the page passes `null` and names the screen in its
 *   header. Left out, the first build's 「我的资料和设置」 is drawn (the gallery's frame has no title in its header).
 */
export function MeLayout({
  locale,
  filming,
  fill,
  meta,
  headline,
  entries,
  grouped = false,
  crewEntry,
  crew = false,
  foot,
  tabBar,
  tabBarPlacement = "fixed",
  className,
}: {
  locale: UiLocale;
  filming?: boolean;
  fill?: "viewport" | "container";
  /** <PageHeader back={...} title="我" subtitle={his name}> (or the first build's <MetaBar>) */
  meta: ReactNode;
  /** the sentence under the header; `null` for none; left out: 「我的资料和设置」 */
  headline?: ReactNode;
  /** the rows in order, bare or (with `grouped`) in <MeGroup> cards */
  entries: ReactNode;
  grouped?: boolean;
  /** <FilmingAccountEntry>, rendered only when `crew` */
  crewEntry?: ReactNode;
  crew?: boolean;
  /** under the cards: <LogoutRow> */
  foot?: ReactNode;
  tabBar?: ReactNode;
  tabBarPlacement?: "static" | "fixed" | "absolute";
  className?: string;
}) {
  const crewRow = crew && crewEntry ? crewEntry : null;
  return (
    <Screen locale={locale} filming={filming} fill={fill} tabBar={tabBar} tabBarPlacement={tabBarPlacement} className={cx(!tabBar && "rpm-screen", className)}>
      {meta}
      {headline === undefined ? <StatusHeadline lines={[locale === "zh-Hans" ? "我的资料和设置" : "My details and settings"]} style={{ margin: "0 0 14px" }} /> : headline}
      <nav className="rpu rpm-menu" data-rp="me-menu" aria-label={locale === "zh-Hans" ? "我" : "Me"}>
        {grouped ? (
          <>
            {entries}
            {crewRow && <MeGroup>{crewRow}</MeGroup>}
          </>
        ) : (
          <MeGroup>
            {entries}
            {crewRow}
          </MeGroup>
        )}
      </nav>
      {foot}
    </Screen>
  );
}
