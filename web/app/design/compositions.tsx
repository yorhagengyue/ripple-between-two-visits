/**
 * The first gallery's three Today states under their old names (m1, m2, m3), now drawn by the composed screens in
 * app/design/screens/compose.tsx. Kept for /design/today/[state] and anything that linked to the old names.
 */
import type { UiLocale } from "@/lib/ui/tokens";
import { PhoneStatusBar } from "./Gallery";
import { SCREENS, type ScreenName } from "./screens/compose";

export type TodayState = "m1" | "m2" | "m3";
export const TODAY_STATES: readonly TodayState[] = ["m1", "m2", "m3"];

const SCREEN_OF: Record<TodayState, ScreenName> = { m1: "elder-today-pending", m2: "elder-today-done", m3: "elder-hero" };

export const compositionHref = (state: TodayState, locale: UiLocale, filming = false) =>
  `/design/today/${state}${locale === "en" ? "?lang=en" : ""}${filming ? `${locale === "en" ? "&" : "?"}filming=1` : ""}`;

/** Status bar + one Today screen; the caller gives the frame. */
export function TodayPhone({ state, locale }: { state: TodayState; locale: UiLocale }) {
  const spec = SCREENS[SCREEN_OF[state]];
  return (
    <>
      <PhoneStatusBar time={spec.time} />
      {spec.render(locale)}
    </>
  );
}
