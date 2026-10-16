import { BodyText, LoadingState, PageHeader, Screen, TabBar } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { bt } from "@/lib/summary/i18n";

/**
 * What /p/brief shows while an account's brief is being put together (the timeline design's 通用-1: the screen's own
 * header, one grey line that says what is being opened, quiet bars in the place of the blocks). The brief can take a few
 * seconds: his words are translated for the doctor and checked twice before the page is drawn (lib/summary/account-brief.ts,
 * six seconds at most). `doctor`: the page he hands over, full screen: no tab bar and no way to 「我」.
 */
export function BriefLoading({ locale, doctor }: { locale: Locale; doctor: boolean }) {
  return (
    <Screen locale={locale} tabBar={doctor ? undefined : <TabBar active="visit" locale={locale} />} tabBarPlacement="fixed">
      {doctor ? (
        <div className="rpu rpu-meta" data-rp="meta">
          <div className="rpu-meta-row">
            <div className="rpu-meta-text">
              <h1 className="rpu-meta-title" data-rp="page-title" lang="en">
                {bt("en", "brief.for")}
              </h1>
            </div>
          </div>
        </div>
      ) : (
        <PageHeader locale={locale} back={{ href: "/p/today" }} title={bt(locale, "brief.title")} />
      )}
      <div className="rpu-stack" data-testid="brief-loading">
        <BodyText variant="lede" lang={doctor ? "en" : locale}>
          {bt(doctor ? "en" : locale, "brief.loading")}
        </BodyText>
        <LoadingState locale={locale} lines={3} headline />
        <LoadingState locale={locale} lines={2} button />
      </div>
    </Screen>
  );
}
