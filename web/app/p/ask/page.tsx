/**
 * /p/ask — 问一句, the answer's own screen (C2 track S; journey 07, real-app 2.10, tone v2 「一屏一件事」), drawn as the
 * timeline draft's 07 screens: the header (「‹ 就诊」 on an account, where asking lives since the owner's decision of 10-14;
 * 「‹ 今天」 on the demo; 「问一句」, the real date), today's latest answer as a line
 * (his question first, then the doctor's words, the label, the leaflet, Ripple's fixed sentences, where his question
 * went), today's earlier questions as a list under it, and at the bottom the dock with the field to ask again
 * (components/today/AskSection.tsx).
 *
 * Today's turns are read on the server from the scope's chat rows (lib/safety/turns.ts), so a refresh, another tab or a
 * later look shows the same conversation. On the demo the page sits inside the demo frame (app/p/layout.tsx) like every
 * other /p page; Wei Ling's phone never gets here (the layout sends her to /f first).
 *
 * The microphone is drawn only when a transcription service is connected (lib/safety/voice.ts askVoiceAvailable; real-app
 * 2.10 「没有 Whisper 时，不显示麦克风按钮」). `?speak=1` opens the screen listening (Today's 「按一下说」 strip is gone since
 * 10-14; the address still works for a page that links to it).
 *
 * His question is the screen's heading once he asked one (the tests and a screen reader find it as the h1), so the
 * header's 「问一句」 is not a heading here.
 */
import { AskSection } from "@/components/today/AskSection";
import { askCopy, dateLine } from "@/components/daily/ask-copy";
import { PageHeader, Screen, TabBar } from "@/components/ui";
import { t } from "@/lib/i18n";
import { aiConsent } from "@/lib/safety/consent";
import { askTurns } from "@/lib/safety/turns";
import { askVoiceAvailable } from "@/lib/safety/voice";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0 } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject } from "@/lib/subject";
import { uiCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function AskPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, locale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const session = ctx.session;
  // his consent to AI processing: while it is off the screen says so (real-app 2.10; the demo's story is always allowed)
  const [turns, aiAllowed] = await Promise.all([askTurns(ctx.store, session.id, session.story_day), aiConsent(ctx.store, session)]);
  const date = dateLine(storyDate(scopeD0(session), session.story_day), locale);
  const account = ctx.subject.kind === "account";
  const voice = askVoiceAvailable();
  // owner 10-14: asking lives in 就诊 on an account (the 「按一下说 / 打字」 strip under his pages is gone), so the screen
  // marks that place of the bar and goes back there; the demo keeps its way back to Today
  const back = account ? { href: "/p/visit", label: uiCopy(locale).tabs.visit } : { href: "/p/today", label: t(locale, "today.title") };
  return (
    <Screen locale={locale} tabBar={account ? <TabBar active="visit" locale={locale} placement="fixed" /> : undefined} tabBarPlacement="fixed">
      <PageHeader back={back} title={askCopy(locale).section} titleAs="p" subtitle={date} locale={locale} />
      <AskSection
        locale={locale}
        mode="screen"
        initialTurns={turns}
        aiOff={!aiAllowed}
        voice={voice}
        // an account on Mr Tan's example data: the start shows 「可以这样问」 (real-app 4.7)
        example={account && session.example_data === true}
        autoSpeak={voice && sp.speak === "1"}
      />
    </Screen>
  );
}
