import type { ReactNode } from "react";
import { cx, dataAttrs, filmingAttr, type DataAttrs, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { PageTransition } from "./PageTransition";

/**
 * One phone screen of Mr Tan's: paper ground, the 20px gutter, a flex column (so <ActionDock> can sit in the
 * lower half), then what stays at the bottom: the undo bar, the 「按一下说 / 打字」 strip and the tab bar. Marks itself
 * data-rp-side="elder": the page checks (e2e/_checks/page-checks.ts) hold everything inside to 18px text and 48px
 * targets.
 *
 * - fill="viewport" (pages) or "container" (fills a sized parent: the /design phones).
 * - tabBarPlacement="fixed" when the TabBar is fixed to the viewport, so the content and the undo bar clear it
 *   (and the say bar, when there is one; `sayBarSize="typing"` when the typing dock stands in its place: it is taller).
 * - foot: a screen with nothing fixed at its foot (no tab bar, no say bar) keeps the draft's room under its last
 *   block: "plain" 40px; "dock" 34px, for a screen that ends with its lower buttons (<ActionDock>). Without it the
 *   page keeps the 18px it always had.
 * - While an undo bar is on the screen its height is added to the room under the page's last block (<UndoToast> tells
 *   the screen how high it is: --rpu-toast-h), so the last entry can always be scrolled clear of the bar.
 * - A caller's own data-* attributes land on the screen's root (`data-locale`, `data-version`, a page's test id). The
 *   screen's own ones cannot be replaced that way: the page checks and the computer layout read them.
 * - A page's screen (fill="viewport") moves when a link that says which way it goes opens another page: in from the
 *   right, back to the right, or a crossfade for a place of the tab bar (components/ui/PageTransition.tsx,
 *   app/motion.css). The tab bar stands still meanwhile.
 */
export function Screen({
  locale,
  filming,
  fill = "viewport",
  tabBar,
  tabBarPlacement = "static",
  sayBar,
  sayBarSize,
  foot,
  toast,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UiBaseProps &
  DataAttrs & {
  locale: UiLocale;
  fill?: "viewport" | "container";
  tabBar?: ReactNode;
  tabBarPlacement?: "static" | "fixed" | "absolute";
  /** <SayBar>: the strip above the tab bar */
  sayBar?: ReactNode;
  /** "typing": the typing dock (a field over two buttons) is in the say bar's place */
  sayBarSize?: "typing";
  /** the room under the last block of a screen without a tab bar: "plain" 40px, "dock" 34px (it ends with <ActionDock>) */
  foot?: "plain" | "dock";
  toast?: ReactNode;
  children: ReactNode;
  /** the page's own test id, on the screen's root (as the buttons take theirs) */
  "data-testid"?: string;
}) {
  const screen = (
    <div
      className={cx("rpu rpu-screen", className)}
      lang={locale}
      {...dataAttrs(rest)}
      data-testid={testId}
      data-rp="screen"
      data-rp-side="elder"
      data-fill={fill}
      data-tabbar={tabBar ? tabBarPlacement : undefined}
      data-saybar={sayBar ? (tabBarPlacement === "fixed" ? "fixed" : "static") : undefined}
      data-saybar-size={sayBar ? sayBarSize : undefined}
      data-foot={foot}
      {...filmingAttr(filming)}
      style={style}
    >
      <div className="rpu-page">{children}</div>
      {toast}
      {sayBar}
      {tabBar}
    </div>
  );
  // the motion between two pages (components/ui/PageTransition.tsx): a page's screen only, not the /design phones
  return fill === "viewport" ? <PageTransition>{screen}</PageTransition> : screen;
}

/** Sets filming mode for everything inside without adding a box (display: contents). */
export function FilmingScope({ filming, children }: { filming: boolean; children: ReactNode }) {
  return (
    <div {...filmingAttr(filming)} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/**
 * The lower part of a screen: the one primary button and its secondary buttons. Pushed to the bottom of the column
 * (margin-top: auto), 10px between buttons.
 *
 * `bar`: the draft's fixed area (`dk`): a white strip with a hairline over it, as wide as the screen, that stays at the
 * foot of the screen while the page scrolls under it (above the tab bar when there is one). It is in the page's flow
 * and sticky, not fixed, so it takes its own room and stays inside the phone's column on a computer. Under its buttons
 * it leaves 34px, or 14px when a tab bar or the say bar is fixed below it. It has to be a child of the page's column
 * (or of a column that fills it), with nothing but the page's gutter at its sides.
 */
export function ActionDock({ children, bar = false, filming, className, style, ...rest }: UiBaseProps & DataAttrs & { children: ReactNode; bar?: boolean }) {
  return (
    <div className={cx("rpu rpu-dock", className)} data-rp="dock" data-bar={bar ? "true" : undefined} {...dataAttrs(rest)} {...filmingAttr(filming)} style={style}>
      {children}
    </div>
  );
}
