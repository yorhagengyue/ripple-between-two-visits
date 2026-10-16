import { notFound } from "next/navigation";
import { PhoneStatusBar } from "../../Gallery";
import { SCREENS, type ScreenName } from "../../screens/compose";

/**
 * The first gallery's three Today states, kept at their old addresses for e2e/ui-design.spec.ts and its committed
 * screenshots: m1 = today, morning not logged; m2 = right after 「吃了」; m3 = the hero answer.
 * ?lang=en for English, ?filming=1 for filming mode (body text 22px).
 */
const TODAY_STATE_SCREENS: Record<string, ScreenName> = { m1: "elder-today-pending", m2: "elder-today-done", m3: "elder-hero" };

export default async function TodayCompositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { state } = await params;
  const sp = await searchParams;
  const name = TODAY_STATE_SCREENS[state];
  if (!name) notFound();
  const locale = sp.lang === "en" ? "en" : "zh-Hans";
  const spec = SCREENS[name];
  return (
    <div
      className="rpd-phone-full"
      data-composition={state}
      data-side="elder"
      data-rp-side="elder"
      lang={locale}
      data-filming={sp.filming === "1" ? "true" : undefined}
    >
      <PhoneStatusBar time={spec.time} />
      {spec.render(locale)}
    </div>
  );
}
