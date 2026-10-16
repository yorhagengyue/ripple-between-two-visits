/**
 * /p/prevent — 预防：筛查和疫苗 (journey 11; M10; 老人端提示词 11; design 11-1, web/progress/fe-1113.md). Track K's
 * screen, drawn as the timeline draft's 11-1. Reached from the question list (owner's tidy of 10-13: so 「‹ 问题单」 is
 * its way back, as the draft's 「‹ 要问的」; it was 「‹ 我」 while the entry was a row of 「我」); on Today prevention
 * shows only through track B's countdown.
 * The screen's data is lib/prevent/view.ts (the doctor's words about tests first, then the official tables' lines for
 * his age and recorded conditions, what he marked done, the caveat); the screen is components/prevent/PreventScreen.
 * ?lang=en|zh-Hans renders this screen in that language.
 */
import { PreventScreen } from "@/components/prevent/PreventScreen";
import { PREVENT_WORDS } from "@/components/prevent/copy";
import { PageHeader, Screen, TabBar } from "@/components/ui";
import { t, type Locale } from "@/lib/i18n";
import { preventView } from "@/lib/prevent/view";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function PreventPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const lang = typeof sp.lang === "string" ? sp.lang : null;
  const locale: Locale = lang === "en" || lang === "zh-Hans" ? lang : cookieLocale;
  const view = await preventView(ctx.store, ctx.session, locale);
  const account = ctx.subject.kind === "account";
  const w = PREVENT_WORDS[locale];
  return (
    // the question list is part of 就诊 (owner 10-14), so this screen marks that place of the bar
    <Screen locale={locale} tabBar={account ? <TabBar active="visit" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <div data-testid="page-prevent">
        <PageHeader back={{ href: "/p/questions", label: t(locale, "nav.questions") }} title={w.title} subtitle={w.subtitle} locale={locale} />
        <PreventScreen view={view} locale={locale} />
      </div>
    </Screen>
  );
}
