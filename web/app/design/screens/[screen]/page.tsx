import { notFound } from "next/navigation";
import { PhoneStatusBar } from "../../Gallery";
import { SCREEN_NAMES, SCREENS, type ScreenName } from "../compose";

/**
 * One composed screen filling the viewport, for the 390x844 screenshots and the page checks.
 * /design/screens/<name>, ?lang=en for English.
 */
export default async function ComposedScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { screen } = await params;
  const sp = await searchParams;
  if (!SCREEN_NAMES.includes(screen as ScreenName)) notFound();
  const spec = SCREENS[screen as ScreenName];
  const locale = sp.lang === "en" ? "en" : "zh-Hans";
  return (
    <div className="rpd-phone-full" data-composition={screen} data-side={spec.side} data-rp-side={spec.side} lang={locale}>
      <PhoneStatusBar time={spec.time} />
      {spec.render(locale)}
    </div>
  );
}
