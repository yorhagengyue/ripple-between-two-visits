/**
 * /p/prevent while its data is on the way (the screens' "loading" state; the draft's 通用-1 is its model): the real
 * header at once, one grey line and the foundation's quiet bars where the lines will stand. The tab bar is there from
 * the start on an account, so nothing jumps when the screen arrives.
 */
import { PREVENT_WORDS } from "@/components/prevent/copy";
import { BodyText, LoadingState, PageHeader, Screen, TabBar } from "@/components/ui";
import { t } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";

export default async function PreventLoading() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  const w = PREVENT_WORDS[locale];
  const ui = uiCopy(locale);
  return (
    <Screen locale={locale} tabBar={ctx?.subject.kind === "account" ? <TabBar active="visit" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <div data-testid="page-prevent-loading">
        {/* the same way back as the screen itself: the question list */}
        <PageHeader back={{ href: "/p/questions", label: t(locale, "nav.questions") }} title={w.title} subtitle={w.subtitle} locale={locale} />
        <div aria-hidden="true">
          <BodyText variant="lede" style={{ marginTop: 0 }}>
            {ui.loading}
          </BodyText>
        </div>
        <LoadingState locale={locale} headline lines={4} />
      </div>
    </Screen>
  );
}
