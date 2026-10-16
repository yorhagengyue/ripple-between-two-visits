/**
 * Where a signed-in person's request for one of his pages lands (C2 track L; docs/plan/real-app.md 3.7 页面跳转,
 * lines 612-615). Pure and client-safe; lib/subject/landing.ts reads who he is and makes the redirect.
 *
 *   「登录了，但建档没完成：跳 /onboard。」     an account whose onboarding is not "done" opening a /p page
 *   「只是家属，打开 /p/*：跳 /f。」              an account with no space of its own (a family member who only looks)
 *   「NoSessionPhone / NoSessionDesk 只留在演示。」
 *
 * Two parts of /p stay open while he is setting up, because setting up itself sends him there (track C,
 * app/onboard/[step]/steps.tsx): the medicines (「拍药袋」 goes to /p/meds/add, then to the new card) and the family
 * pages (「请家人」 goes to /p/family and its invitation). Any other /p page brings him back to the screen he was on.
 */

/** The parts of /p that setting up hands him to. */
export const OPEN_WHILE_ONBOARDING: readonly string[] = ["/p/meds", "/p/family"];

export const ONBOARD_HOME = "/onboard";
export const FAMILY_HOME = "/f";

/** Who is asking: his own space with its onboarding state, an account without a space, or nobody we know. */
export type Lander = { kind: "self"; onboarding: string | null } | { kind: "family_only" } | { kind: "nobody" };

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/** One of his pages (/p and everything under it)? */
export function isPatientPage(pathname: string): boolean {
  return under(pathname, "/p");
}

export function openWhileOnboarding(pathname: string): boolean {
  return OPEN_WHILE_ONBOARDING.some((root) => under(pathname, root));
}

/** Where this person is sent instead of the /p page he asked for, or null when the page is his to open. */
export function landingFor(pathname: string, who: Lander): string | null {
  if (!isPatientPage(pathname)) return null;
  if (who.kind === "family_only") return FAMILY_HOME;
  if (who.kind === "self" && who.onboarding !== "done" && !openWhileOnboarding(pathname)) return ONBOARD_HOME;
  return null;
}
