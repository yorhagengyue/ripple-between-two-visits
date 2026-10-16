/**
 * Where a person goes after signing in (docs/plan/real-app.md 2.1, 2.3). Client-safe and pure.
 *
 *   ?next=<path>   back to the page he was sent away from, when it is a path on this site (never another site, never
 *                  the sign-in pages themselves, never an API)
 *   otherwise      his own space: /p/today once onboarding is done, else /onboard; a family member with no space of her
 *                  own: /f
 */

const NEVER_BACK_TO = /^\/(login|signup|recover|api)(\/|\?|$)/;

/** `next` when it is a safe path on this site, else null. */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  const n = next.trim();
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return null;
  if (n.length > 512 || /[\u0000-\u001f\u007f\\]/.test(n)) return null;
  if (NEVER_BACK_TO.test(n)) return null;
  return n;
}

/** His home after signing in: today, the onboarding, or (no space of his own) the family page. */
export function homeAfterSignIn(scope: { onboarding: string | null } | null): string {
  if (!scope) return "/f";
  return scope.onboarding === "done" ? "/p/today" : "/onboard";
}

/**
 * Where to go: `next` if it is safe and makes sense for him (a /p page needs a space of his own), else home. A blank
 * account whose onboarding is not done goes to /onboard even when `next` named a /p page.
 */
export function destinationAfterSignIn(next: unknown, scope: { onboarding: string | null } | null): string {
  const home = homeAfterSignIn(scope);
  const n = safeNext(next);
  if (!n) return home;
  if (/^\/p(\/|\?|$)/.test(n) && (!scope || scope.onboarding !== "done")) return home;
  return n;
}

/** The login page that brings him back to `path` afterwards. */
export function loginUrl(path: string | null | undefined): string {
  const n = safeNext(path);
  return n ? `/login?next=${encodeURIComponent(n)}` : "/login";
}
