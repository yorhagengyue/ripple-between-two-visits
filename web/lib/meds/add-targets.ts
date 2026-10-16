/**
 * Where /p/meds/add goes when he is done or says 「以后再说」 (C2 track F; real-app 2.5 step 3: setting up his account
 * sends him here with 「去拍药袋」, and the next setting-up screen must follow). Pure; server and client safe.
 *
 *   ?from=onboard   opened from setting up his account: after the medicine is added, and on 「以后再说」, he goes on with
 *                   setting up. The target is the fixed path /onboard, which opens the screen that follows the
 *                   medicines one (lib/profile/onboarding.ts keeps where he is). Only while he is still setting up:
 *                   afterwards those screens are closed and the flow behaves as from his medicines.
 *   ?next=<path>    where 「以后再说」 goes: an internal path only (his own pages, the setting-up screens), no host, no
 *                   query; anything else is ignored.
 */

/** Where setting up his account goes on: /onboard opens the screen he is on. */
export const ONBOARD_RETURN = "/onboard";

/** An internal path a `?next=` may name, or null. */
export function internalNext(next: string | null | undefined): string | null {
  return typeof next === "string" && /^\/(?:p|onboard)(?:\/[A-Za-z0-9/_-]*)?$/.test(next) && !next.includes("//") ? next : null;
}

export interface AddFlowTargets {
  /** 「以后再说」 */
  laterHref: string;
  /** the way on once the medicine is added (null: he stays with his medicines) */
  returnHref: string | null;
}

export function addFlowTargets(input: { next: string | null | undefined; fromOnboard: boolean; onboarding: string | null | undefined }): AddFlowTargets {
  const returnHref = input.fromOnboard && input.onboarding !== "done" ? ONBOARD_RETURN : null;
  return { laterHref: returnHref ?? internalNext(input.next) ?? "/p/meds", returnHref };
}
