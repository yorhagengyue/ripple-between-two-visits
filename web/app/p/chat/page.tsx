/**
 * /p/chat — 随时说一句: his conversation with Ripple, kept day by day (journey 04; M13; 老人端提示词 04), as the timeline
 * draft's group 04 draws a day's record (04-2 to 04-4; web/progress/fe-04.md). Today by default; ?date=YYYY-MM-DD shows
 * an earlier day (read only). The turns are read on the server from the scope's chat rows (lib/chat/view.ts), so a
 * refresh, another tab or a later look shows the same conversation. The page shows the day's conversation only: it has
 * no field of its own, asking is done from Today and the ask screen (owner's tidy of 10-13). The screen itself is
 * components/chat/ChatScreen.
 *
 * The header: 「‹ 记录」 back to 记录 (since the owner's four tabs of 10-14 the conversation is reached from there, and the bar
 * marks 记录), the day's date as the title, and under it what the screen holds
 * (「今天说过的话」; on an earlier day 「这一天说过的话」, and the way back is to today's). 「我」 and the example account's
 * line come from the account's header (components/ui/AccountHeader). ?lang=en|zh-Hans renders this screen in that
 * language (the switch itself lives under 「我」).
 */
import { ChatScreen } from "@/components/chat/ChatScreen";
import { CHAT_WORDS } from "@/components/chat/copy";
import { PageHeader, Screen, TabBar } from "@/components/ui";
import { chatDay } from "@/lib/chat/view";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0 } from "@/lib/store/scope";
import { dayOfDate } from "@/lib/story/clock";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function ChatPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const lang = typeof sp.lang === "string" ? sp.lang : null;
  const locale: Locale = lang === "en" || lang === "zh-Hans" ? lang : cookieLocale;
  const session = ctx.session;
  const d0 = scopeD0(session);
  const today = session.story_day;
  const asked = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? dayOfDate(d0, sp.date) : today;
  const day = Number.isInteger(asked) && asked <= today ? asked : today;
  const view = await chatDay(ctx.store, session, day, locale);
  const account = ctx.subject.kind === "account";
  const w = CHAT_WORDS[locale];
  return (
    <Screen locale={locale} tabBar={account ? <TabBar active="records" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <div data-testid="page-chat">
        <PageHeader
          back={view.isToday ? { href: "/p/records", label: uiCopy(locale).tabs.records } : { href: "/p/chat", label: w.today }}
          title={view.dateWords}
          subtitle={view.isToday ? w.today : w.thatDay}
          locale={locale}
        />
        <ChatScreen key={view.date} view={view} locale={locale} />
      </div>
    </Screen>
  );
}
