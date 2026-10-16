/**
 * /p/bp while its data is read (the timeline draft's 通用-1): on an account the page's header and tab bar at once, quiet
 * bars in the screen's shape where the week will be, and after three seconds 「还在打开，网络有点慢」
 * (components/bp/BpPageStates.tsx). The header already carries today's date, as the page's own header will, so nothing
 * under it moves when the page arrives. The demo's page (judge sandbox, filming session) shows nothing meanwhile, as
 * before.
 *
 * Who the page is for was already read by the layout (lib/subject getPageSubject is read once per request), so this
 * does not wait for anything.
 */
import { BpSlowNote } from "@/components/bp/BpPageStates";
import { LoadingState, PageHeader, Screen, TabBar } from "@/components/ui";
import { dateWords } from "@/lib/daily/i18n";
import { t } from "@/lib/i18n";
import { RECORDS_HREF, rc } from "@/lib/records/copy";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0 } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject } from "@/lib/subject";

export default async function BpLoading() {
  const [ctx, locale] = await Promise.all([getPageSubject().catch(() => null), getPatientLocale()]);
  if (!ctx || ctx.subject.kind !== "account") return null;
  const session = ctx.session;
  return (
    <Screen locale={locale} tabBar={<TabBar active="records" locale={locale} />} tabBarPlacement="fixed">
      {/* the foundation's header itself (not ElderMeta): the page's own header keeps the only `elder-meta` hook. Its way
          back to 「记录」 is there at once too (owner 10-14: the page is under 「记录」), so the title does not move */}
      <PageHeader back={{ href: RECORDS_HREF, label: rc(locale, "title") }} title={t(locale, "nav.bp")} subtitle={dateWords(locale, storyDate(scopeD0(session), session.story_day))} locale={locale} />
      <div data-testid="page-bp-loading" className="rpu-stack">
        <LoadingState locale={locale} headline lines={3} button style={{ padding: 0 }} />
        <BpSlowNote locale={locale} />
      </div>
    </Screen>
  );
}
