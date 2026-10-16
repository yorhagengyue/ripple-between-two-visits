/**
 * How a tap on a link moves the screen (owner, 10-14: 「仿 iOS 的做就可以了」; the motion pass, app/motion.css). Safe to
 * import from server and client components: plain data, no React.
 *
 * A link says which way it goes (next/link `transitionTypes`, passed to React.addTransitionType inside the navigation);
 * every phone screen (components/ui Screen, family-ui FamilyScreen, auth-ui AuthScreen) is wrapped in
 * <PageTransition> (components/ui/PageTransition.tsx), which turns the type into the class its old and new pictures
 * are animated by:
 *   forward  deeper: a row with a chevron, a card or a button that opens a page under this one. The new page slides in
 *            from the right over the old one, which moves a little to the left and dims (iOS's push)
 *   back     the way back at the top of a page (「‹ 就诊」): the same, the other way (iOS's pop)
 *   tab      a place of a bottom bar: a short crossfade, nothing slides
 * A link without one (the language switch, a redirect, router.refresh, the browser's own back) changes the page with no
 * motion at all, and so does a link to the same page with another ?query (the page is updated in place, not replaced).
 */
export type NavMotion = "forward" | "back" | "tab";

/** The transition type each way puts on the navigation. */
export const NAV_TYPE: Record<NavMotion, string> = { forward: "nav-forward", back: "nav-back", tab: "nav-tab" };

/** next/link's `transitionTypes` for a way, or nothing (no motion) without one. */
export function navTypes(nav: NavMotion | undefined): string[] | undefined {
  return nav ? [NAV_TYPE[nav]] : undefined;
}

/**
 * The view-transition name every phone screen carries while a page changes. One screen leaves and one arrives in the
 * same navigation, so React pairs the two by this name (a "share") wherever each stands in its page's tree: many pages
 * wrap their screen in an element of their own (a test hook), which an enter/exit pair could not reach.
 */
export const SCREEN_NAME = "rpmo-screen";

/**
 * The class of the pair's pictures by the navigation's type (app/motion.css draws them). Anything else, a navigation
 * without a type included, is "none": no motion.
 */
export const SCREEN_SHARE = { "nav-forward": "rpmo-push", "nav-back": "rpmo-pop", "nav-tab": "rpmo-tab", default: "none" };
