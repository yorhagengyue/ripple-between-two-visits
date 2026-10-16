/**
 * /p/diet — 饮食 (journey 13; M16; 老人端提示词 13; design group 13, web/progress/fe-1113.md). Track K's screen, drawn as
 * the timeline draft's 13-1 and 13-2. Reached from 「我」 (integrator, 10-10: so 「‹ 我」 is its way back; the draft's
 * 「‹ 今天」 is not where the app comes from); the day's question also shows on Today while the doctor gave a diet
 * instruction, and its answered entry has a way here.
 *
 *   /p/diet               13-1: the doctor's own words about food first, the day's question and the week's count on the
 *                         same line, the official lines for the conditions recorded about him, grapefruit from the
 *                         leaflet, the way to his own dishes, the referral for a special diet (components/diet/DietScreen)
 *   /p/diet?view=foods    13-2: 「我常吃的」, the hawker dishes he picks and the official lines for each
 *                         (components/diet/DietFoods). An account only; while a special diet comes first, or in a demo
 *                         session (it keeps no picks), this address shows the diet screen itself
 * The screen's data is lib/diet/view.ts. ?lang=en|zh-Hans renders this screen in that language.
 */
import { DietFoods } from "@/components/diet/DietFoods";
import { DietScreen } from "@/components/diet/DietScreen";
import { DIET_WORDS } from "@/components/diet/copy";
import { PageHeader, Screen, TabBar } from "@/components/ui";
import { dietView } from "@/lib/diet/view";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function DietPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const lang = typeof sp.lang === "string" ? sp.lang : null;
  const locale: Locale = lang === "en" || lang === "zh-Hans" ? lang : cookieLocale;
  const view = await dietView(ctx.store, ctx.session, locale);
  const account = ctx.subject.kind === "account";
  const w = DIET_WORDS[locale];
  // the second screen: his own dishes, where he can pick them and the general lines are listed at all
  const foods = sp.view === "foods" && view.foods.canPick && !view.special.first;
  return (
    // reached from 「我」, so this screen marks that place of the bar
    <Screen locale={locale} tabBar={account ? <TabBar active="me" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <div data-testid="page-diet" data-view={foods ? "foods" : "diet"}>
        {foods ? (
          <>
            <PageHeader back={{ href: "/p/diet", label: w.title }} title={w.foods} subtitle={w.foodsHint} locale={locale} />
            <DietFoods view={view} locale={locale} />
          </>
        ) : (
          <>
            <PageHeader back={{ href: "/p/me", label: uiCopy(locale).me }} title={w.title} locale={locale} />
            {/* 「问医生」 goes to an account's 「加一个问题」 (a demo session has no such screen) */}
            <DietScreen view={view} locale={locale} askHref={account ? "/p/questions/add" : undefined} />
          </>
        )}
      </div>
    </Screen>
  );
}
