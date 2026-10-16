/**
 * Mr Tan's phone (/p/*). One live connection for all patient pages (the layout persists across tab
 * navigation). Without a session the device is offered /join or its own sandbox.
 *
 * Two kinds of scope, two frames:
 *   account   (his own space, C2) the new elder UI: each page draws its own screen with components/ui (Screen, MetaBar
 *             with the real date, TabBar). The layout opens the live connection and keeps the day for every page: no
 *             PatientFrame, no story-day header, no jump menu, no debug line, no join code. Nothing here names the
 *             scope (ctx.client has no id). Three things every account page gets from here (C2 track B, second round):
 *               DayClock      the day's clock (real-app 6.3): at his midnight and at every reminder moment the open
 *                             page reads its server data again, on blood pressure, the brief, the question list and
 *                             every other page, not only Today
 *               DueReminder   the reminder that is due now (real-app 6.5): her words and her clip, 「早上的药 · 还没记」
 *                             and the way to Today, a pop-up that comes down once per reminder window on whichever
 *                             page he is and leaves by itself (not on Today itself, the visit pages, the brief, adding
 *                             a medicine, asking, or blood pressure while he types: owner's tidy of 10-13)
 *               OneAudio      one sound at a time (real-app 12): starting any sound on any of his pages stops the one
 *                             that was playing (asking, blood pressure, the brief, the question list, Today, her
 *                             reminder, the medicine and visit pages)
 *   demo      (judge sandbox, crew filming session) exactly as before: PatientFrame with the day label, the tab bar, the
 *             director's reminder card and, M6, Wei Ling's recorded reminder (ReminderClipPlayer) mounted in the frame so
 *             at the reminder time her clip plays on whichever /p/* page he is on. The layout reads today's due doses,
 *             the reminder times and her clips; data events re-render it (router.refresh in LiveSession).
 *
 * M6 privacy: these are his pages. Wei Ling's phone (family role) is sent to /f before anything of his is read
 * (lib/family/role.ts sendFamilyToF). This is the second layer: web/proxy.ts (lib/family/gate.ts) already redirects
 * her before the request reaches any /p/* page, including client-side navigations, where a layout does not run.
 */
import { Suspense } from "react";
import { ReminderClipPlayer } from "@/components/daily/ReminderClipPlayer";
import { DayClock } from "@/components/daily/elder/DayClock";
import { DueReminder } from "@/components/daily/elder/DueReminder";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { PatientFrame } from "@/components/patient/PatientFrame";
import { NoSessionPhone } from "@/components/session/NoSession";
// C2 track E (only add): the filming account's phone follows the director's scene (see the account branch below)
import { SceneFollower } from "@/components/session/SceneFollower";
import { OneAudio } from "@/components/visit/elder/OneAudio";
import { accountDayClock } from "@/lib/daily/day-clock";
import { scheduleFor, todayDoses } from "@/lib/daily/doses";
import { remindersView } from "@/lib/daily/reminders";
import { sendFamilyToF } from "@/lib/family/role";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
// C2 track A (only add): real-app 3.7 页面跳转, 「只是家属，打开 /p/*：跳 /f」
import { redirect } from "next/navigation";
import { signedInWithoutSpace } from "@/lib/subject/account";
// C2 track C (only add): every header of an account's screens carries the language switch; the example's line under it
import { ExampleHeaderLine } from "@/components/today/ExampleBanner";
import { AccountHeaderProvider } from "@/components/ui/AccountHeader";
// owner 10-15: 提问 is one round button at the bottom right of his pages (tap to type, hold to speak), not a page
import { AskFab } from "@/components/ask/AskFab";
import { askVoiceAvailable } from "@/lib/safety/voice";
import { ensureExampleWhole } from "@/lib/story/example";
// C2 track S (only add): an example account's checked translations (real-app 12)
import { ensureExampleTranslations } from "@/lib/translate/shown";
import { translateVisitLines } from "@/lib/visit/translate";
// C2 track O (real-app 2.25): what his pages do without a network (the to-send list, the offline shell)
import { OfflineProvider } from "@/components/offline/OfflineProvider";
import { ownerTag } from "@/lib/offline/owner";
import { scopeNow } from "@/lib/store/scope";
import { nowMs as appNowMs } from "@/lib/time/now";

export default async function PatientLayout({ children }: LayoutProps<"/p">) {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  // C2 track A (only add): someone signed in who only helps a family member has no pages of her own here
  if (!ctx && (await signedInWithoutSpace())) redirect("/f");
  if (!ctx) return <NoSessionPhone locale={locale} />;
  const store = ctx.store;
  await sendFamilyToF(ctx, store);

  if (ctx.subject.kind === "account") {
    // C2 track C (only add): an example account whose layout was cut short (a database whose seed function predates
    // 0014 writes the transcripts and profile facts after the rest) is completed when he next opens a page; one read
    // when nothing is missing, safe to repeat (lib/story/example.ts)
    if (ctx.session.example_data && ctx.subject.relation === "self") await ensureExampleWhole(store, ctx.session).catch(() => undefined);
    // C2 track S (only add): the sample visits' doctor lines have their checked Chinese before he opens the pages that
    // show them (lib/translate/shown.ts); in the background, the page does not wait, safe to repeat
    if (ctx.session.example_data && ctx.subject.relation === "self") {
      const scope = ctx.session;
      void ensureExampleTranslations(store, scope, { translateVisit: (visitId) => translateVisitLines(store, scope, visitId) }).catch(() => undefined);
    }
    // the new elder UI: the page is the whole screen (components/ui Screen); the layout keeps the live connection, the
    // day's clock, the reminder that is due and one sound at a time (C2 track B, second round). The clock is extra: if
    // the day cannot be read the page still renders, without it
    const clock = await accountDayClock(store, ctx.session, appNowMs()).catch((err: unknown) => {
      console.warn("[p/layout] the day's clock is unavailable", err instanceof Error ? err.message : err);
      return null;
    });
    // track O: the provider only when the account is known (an opaque tag of it, never the id) and the space is his own
    const owner = ctx.subject.relation === "self" && ctx.subject.userId ? ownerTag(ctx.subject.userId) : null;
    return (
      <LiveSessionProvider key="account" session={ctx.client} d0={ctx.d0} since={ctx.since}>
        {/* C2 track E (only add; real-app 12 「铺到那一拍时手机翻到那一页」): a filming account's own phone follows the
            director's "lay out to a scene" to that scene's page; no other account ever gets such a cue */}
        {ctx.session.filming === true && ctx.subject.relation === "self" ? <SceneFollower /> : null}
        {/* C2 track B: one sound at a time on every page of his; the day's clock (his midnight, every reminder moment) */}
        <OneAudio />
        {clock ? <DayClock stamp={clock.stamp} serverNowMs={clock.nowMs} tz={clock.tz} date={clock.date} nextAtMs={clock.nextAtMs} /> : null}
        {/* C2 track C (only add): on the example account 「示例资料：陈先生（虚构人物）」 under every header (4.7); MetaBar
            draws it (components/ui/AccountHeader.tsx). Owner's decisions of 10-14: 「中 EN」 at the top right of every
            screen (the header needs the language in use for it); 「我」 is a place of the bottom bar, not in the header */}
        <AccountHeaderProvider locale={locale} under={ctx.session.example_data ? <ExampleHeaderLine locale={locale} /> : null}>
          {/* C2 track B: the reminder that is due now, a pop-up that comes down once per reminder window over whichever
              page he is on and leaves by itself; the page gives up no height for it (owner's tidy of 10-13; which pages
              keep it off: components/daily/elder/DueReminder.tsx dueReminderHidden) */}
          {clock ? (
            <Suspense fallback={null}>
              <DueReminder locale={locale} date={clock.date} due={clock.due} />
            </Suspense>
          ) : null}
          {/* owner 10-15: 提问 at the bottom right of every page with his tab bar; the answer opens over the page */}
          {ctx.subject.relation === "self" ? <AskFab locale={locale} voice={askVoiceAvailable()} /> : null}
          {/* C2 track O (real-app 2.25): the to-send list and the offline shell, for the person this phone belongs to */}
          {owner ? (
            <OfflineProvider owner={owner} nowMs={scopeNow(ctx.session, appNowMs())}>
              {children}
            </OfflineProvider>
          ) : (
            children
          )}
        </AccountHeaderProvider>
      </LiveSessionProvider>
    );
  }

  // the demo: the player is extra; if its data cannot be read the page still renders, without it
  const data = await Promise.all([todayDoses(store, ctx.session), scheduleFor(store, ctx.session), remindersView(store, ctx.session)]).catch((err: unknown) => {
    console.warn("[p/layout] reminder player data unavailable", err instanceof Error ? err.message : err);
    return null;
  });
  return (
    <LiveSessionProvider key={ctx.client.id} session={ctx.client} d0={ctx.d0} since={ctx.since}>
      {/* one sound at a time on the demo's pages too (real-app 12: reported on the demo's medicine card) */}
      <OneAudio />
      <PatientFrame
        locale={locale}
        variant="patient"
        role={ctx.role}
        reminder={
          data ? (
            <ReminderClipPlayer key={`frame-reminder-${ctx.session.story_day}`} frame locale={locale} clips={data[2].clips} schedule={data[1]} doses={data[0]} />
          ) : null
        }
      >
        {children}
      </PatientFrame>
    </LiveSessionProvider>
  );
}
