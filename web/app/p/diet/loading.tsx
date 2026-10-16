/**
 * /p/diet while its data is on the way (the screens' "loading" state; the draft's 通用-1 is its model): the real header
 * at once, one grey line and the foundation's quiet bars where the lines will stand. The tab bar is there from the
 * start on an account, so nothing jumps when the screen arrives. (The same file stands in for 「我常吃的」, the route's
 * second screen: a loading file is not told which of the two is coming.)
 */
import { DIET_WORDS } from "@/components/diet/copy";
import { BodyText, LoadingState, PageHeader, Screen, TabBar } from "@/components/ui";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";

export default async function DietLoading() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  const w = DIET_WORDS[locale];
  const ui = uiCopy(locale);
  return (
    <Screen locale={locale} tabBar={ctx?.subject.kind === "account" ? <TabBar active="me" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <div data-testid="page-diet-loading">
        <PageHeader back={{ href: "/p/me", label: ui.me }} title={w.title} locale={locale} />
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
