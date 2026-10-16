/**
 * The end of the leak watch in the whole-line journeys of track G (e2e/real/_leak.ts is imported as it is).
 *
 * `watch.settle()` waits, without a limit, for the body of every response the watch started to read. On a walk like
 * these (full page loads while the router's own prefetches are still under way, uploads through a signed link)
 * Playwright never settles the body of a few of them: the `?_rsc=` prefetches cut short by the next page load, and the
 * PUT to /api/blob/upload. Nothing more will ever come of those, and the plain call would hold the journey until its
 * time-out. So: settle, but for at most `ms`; every body that did arrive has been looked at long before that.
 * Returns whether the watch settled by itself.
 */
import type { LeakWatch } from "../../real/_leak";

export async function settleWithin(watch: LeakWatch, ms = 10_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    watch.settle().then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return settled;
}
