/**
 * /p/today — Mr Tan's Today screen.
 *
 * Demo (judge sandbox, crew filming session; task M4): Wei Ling's reminder at the reminder time, this morning's dose
 * check-in (吃了 / 没吃 / 等下, the reason after 没吃, Undo), the questions waiting for the next visit, and the box
 * where he says or asks one sentence (the hero question goes to /api/ask from here). Exactly as before.
 *
 * Account (C2 track B, journey 02; composition only): the elder screen as the timeline draft's 02 screens
 * (components/daily/elder/TodayAccount: the day is one line of nodes; web/progress/fe.md). Owner's decision of 10-14:
 * Today is short and says nothing twice; his month is at its top, today's line under it, the bar's four places under all.
 *   meta       the header: 「今天」, the real date and time under it, 「EN / 中」 at the right (components/daily/elder/
 *              ElderMeta; 「我」 is a place of the bottom bar now)
 *   month      his month (lib/daily/month.ts ownMonth, components/daily/elder/OwnMonth): each day marked by its doses,
 *              a reading outside his doctor's target, visit days in red, today outlined; a day he taps (?d=YYYY-MM-DD,
 *              today's too: owner 10-15) opens as a sheet over the page (OwnDay), today's line staying under it
 *   routine    his routine entries that fall on today (what he gave when he set up, lib/daily/doses routineOf): the
 *              grey entries at the top of the line; medSources: when each medicine's label was dispensed
 *   banner     this phone's notifications (PushPrompt) and C's 「家人写了 N 条」 prompt (only add); the example account's
 *              line 「示例资料：陈先生（虚构人物）」 is under the header, as on every screen of his
 *   the line   what matters now (the slot that needs him) and what he answered, each slot an entry of the day's line
 *   reminder   her clip at a reminder time, or when he opened the reminder notice (?remind=dose-<slot>)
 *   dose       the slot's medicines and his answer; the other slots one entry each (lib/daily/account-today.ts)
 *   visit      track V's entry for a visit whose recording waits for its text
 *   family     track D's 「Wei Ling 接受了邀请，是她吗？」 when someone accepted his invitation: the one thing on the screen
 *              (the rest is quiet) unless a medicine slot needs him right then; gone once he answered (是她 opens her
 *              switches, 不是 his family page); a link she bound herself, and a family text asked again, in its place
 * Not on Today any more (owner, 10-14): the visit's box with 「就诊简报」 / 「开始就诊」 (就诊 has the visits), the blood
 * pressure entry (记录), 「你 · 今天说过的话」, and the 「按一下说 / 打字」 strip (asking is in 就诊; /p/ask keeps its own
 * field); before that the diet question (owner 10-14, on its page /p/diet from 「我」) and the watch (ux pass 10-12).
 * Query: ?d=YYYY-MM-DD (a day of this month, opened as a sheet), ?change=<slot> (改一下), ?when=yesterday&slot=<slot>
 * (补记), ?remind=dose-<slot> (from the notice), ?lang=en|zh-Hans (this render in that language; the switch itself writes
 * the cookie), ?setup=done (from the last set-up step: the one-time notice 「建好了」, which takes the query out of the
 * address when it leaves).
 *
 * Reading this page first settles doses whose reminder window closed with no answer (unconfirmed, no reply) and
 * brings the routine-pattern question up to date (lib/daily); both are idempotent.
 */
import Link from "next/link";
import { AskBox } from "@/components/daily/AskBox";
import { DoseCheckIn } from "@/components/daily/DoseCheckIn";
import { ReminderClipPlayer } from "@/components/daily/ReminderClipPlayer";
import { ElderMeta } from "@/components/daily/elder/ElderMeta";
import { OwnDay, OwnMonth } from "@/components/daily/elder/OwnMonth";
import { TimeKeeper } from "@/components/daily/elder/TimeKeeper";
import { TodayAccount } from "@/components/daily/elder/TodayAccount";
import { PushPrompt } from "@/components/today/PushPrompt";
import { CareLive } from "@/components/family/HisFamily";
import { ConfirmCard } from "@/components/his-family/ConfirmCard";
// line bind (only add): 「Wei Ling 绑定了你的账号」, the card of a link a family member bound by typing his account
import { BoundCard } from "@/components/his-family/BoundCard";
import { unacknowledgedLinks } from "@/lib/care/ack";
// the family texts asked again (owner 10-14, only add): 「Wei Ling 能看到的内容更新了」, in the same place as the two above
import { cookies } from "next/headers";
import { ReconsentCard } from "@/components/his-family/ReconsentCard";
import { familyConsentText } from "@/lib/care/consent";
import { linkWaitingForHim } from "@/lib/care/reconsent";
import { closedToday, RECONSENT_LATER_COOKIE } from "@/lib/care/reconsent-later";
import { bindEntryStore } from "@/lib/subject/bind";
import { TabBar } from "@/components/ui";
import { helpedName, patientLinks } from "@/lib/care/links";
import type { PatientLinkView } from "@/lib/care/types";
import { accountToday } from "@/lib/daily/account-today";
import { d0Of, routineOf, scheduleFor, settleNoReply, todayDoses } from "@/lib/daily/doses";
import { routinesOnDay } from "@/lib/daily/schedule";
import { clockWords, dateWords, shortTime } from "@/lib/daily/i18n";
import { ownMonth } from "@/lib/daily/month";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { openQuestionCount } from "@/lib/daily/questions";
import { remindersView } from "@/lib/daily/reminders";
import { reasonOptions } from "@/lib/daily/schedule";
import { todayDoseData } from "@/lib/daily/today-view";
import { t, toLocale, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeTz } from "@/lib/store/scope";
import { getPageSubject, type PageSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs as appNowMs } from "@/lib/time/now";
// C2 track C (only-add): the example account's banner; B moves it into TodayLayout's `banner` slot
import { ExampleLine } from "@/components/today/ExampleBanner";
import { FamilyFactsLine } from "@/components/today/FamilyFactsLine";
import { isPending } from "@/lib/profile/facts";
// C2 track V (only add): 「录音已存，等转写」 for a visit that waits for its text (real-app 2.14)
import { TodayVisitWaiting, visitsWaiting } from "@/components/visit/elder/TodayVisitWaiting";
// C2 track A (only add): the line at the top after his password was reset (real-app 2.4, 3.6)
import { ResetNoticeLine } from "@/components/account/ResetNoticeLine";
import { passwordResetNotice } from "@/lib/auth/notices";
// owner 10-14 (only add): the long press, taught once (components/explain/ExplainCoach.tsx)
import { ExplainCoach } from "@/components/explain/ExplainCoach";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function TodayPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [ctx, cookieLocale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  if (ctx.subject.kind === "account") {
    const lang = one(sp.lang);
    const locale = lang === "en" || lang === "zh-Hans" ? toLocale(lang, cookieLocale) : cookieLocale;
    return <AccountToday ctx={ctx} locale={locale} sp={sp} />;
  }
  const locale = cookieLocale;
  const store = ctx.store;
  const session = ctx.session;
  const day = session.story_day;
  await settleNoReply(store, session);
  await syncPatternQuestions(store, session);
  const [doses, waiting, schedule, reminders] = await Promise.all([
    todayDoses(store, session),
    openQuestionCount(store, session),
    scheduleFor(store, session),
    remindersView(store, session),
  ]);
  const reasons = reasonOptions(routineOf(session), d0Of(session), day);

  return (
    <div className="flex flex-col gap-4" data-testid="page-today">
      <h1 className="text-[28px] font-bold">{t(locale, "today.title")}</h1>
      <ReminderClipPlayer key={`reminder-${day}`} locale={locale} clips={reminders.clips} schedule={schedule} doses={doses} />
      <DoseCheckIn key={day} locale={locale} initial={doses} reasons={reasons} reminderAt={schedule.first} />
      {waiting > 0 ? (
        <Link href="/p/questions" className="rp-qlist block px-4 py-3" data-testid="today-questions">
          <span className="rp-tag">{t(locale, "nav.questions")}</span>
          <span className="rp-qt mt-1 block">{t(locale, "today.openQuestions", { n: waiting })}</span>
        </Link>
      ) : null}
      <AskBox locale={locale} />
    </div>
  );
}

/** The account's Today (C2 track B): data from lib/daily, the screen from components/today and components/daily/elder. */
async function AccountToday({ ctx, locale, sp }: { ctx: PageSubject; locale: Locale; sp: Search }) {
  const store = ctx.store;
  const session = ctx.session;
  const nowMs = appNowMs();
  await settleNoReply(store, session);
  await syncPatternQuestions(store, session);
  // track D (C2-PENDING(B)): someone accepted his invitation and waits for his 「是她」 (his own account only)
  const selfId = ctx.subject.kind === "account" && ctx.subject.relation === "self" ? ctx.subject.userId : null;
  const [today, month, links] = await Promise.all([
    accountToday(store, session, nowMs, { change: one(sp.change), when: one(sp.when), slot: one(sp.slot), remind: one(sp.remind) }, locale),
    // owner 10-14: his month at the top (his doses' marks, his visits), and the day he chose in it (?d=), else today
    ownMonth(store, session, one(sp.d), nowMs),
    selfId ? patientLinks(store, careEntryStore(), session, selfId, nowMs) : Promise.resolve([]),
  ]);
  const waiting = links.find((l) => l.state === "accepted") ?? null;
  // owner 10-15: the day named in the address (a day of this month; today's too) opens as a sheet over the page
  const opened = one(sp.d) === month.day.date ? month.day.date : null;
  // track D: someone is helping him on this phone (his sign-up says so): the confirm card says the tap is his own
  const helped = waiting && selfId ? await helpedName(store, selfId) : null;
  // line bind (only add): a link a family member bound herself and he has not answered yet (lib/care/ack.ts); its card
  // stands where 「是她吗？」 stands, and the notice 「… 绑定了你的账号」 lands on it (?confirm=1 puts it first too)
  const bound = !waiting && selfId ? ((await unacknowledgedLinks(store, selfId, links))[0] ?? null) : null;
  const boundHelped = bound && selfId ? await helpedName(store, selfId) : null;
  // the family texts asked again (owner 10-14, only add): a link whose family text in force he has not agreed to
  // (lib/care/reconsent.ts); its card stands where the two above stand, unless he closed it on this phone today (「先不」)
  const later = closedToday((await cookies()).get(RECONSENT_LATER_COOKIE)?.value, today.date);
  const renew = !waiting && !bound && selfId && !later ? await linkWaitingForHim(store, bindEntryStore(), selfId, links) : null;
  const renewHelped = renew && selfId ? await helpedName(store, selfId) : null;
  const data = todayDoseData(today, locale, scopeTz(session));
  // his routine entries that fall on today (the daily ones and this weekday's), earliest first: the grey entries of the line
  const allRoutine = routineOf(session);
  const weekly = new Set(routinesOnDay(allRoutine, d0Of(session), today.day));
  const routine = allRoutine
    .filter((r) => (r.days === "daily" || weekly.has(r)) && /^\d{2}:\d{2}$/.test(r.time))
    .map((r) => ({ time: r.time, label: locale === "zh-Hans" ? (r.label_zh ?? r.label) : r.label }))
    .sort((a, b) => a.time.localeCompare(b.time));
  // the first reminder of his day (「8:45」), for the box that offers this phone's notifications; none without a slot today
  const firstReminder = [...(data.focus ? [data.focus.slot] : []), ...data.others]
    .filter((slot) => slot.when === "today")
    .map((slot) => slot.schedule.first)
    .sort()[0];
  // when each medicine's label was dispensed (「药袋 · 9月1日 配药」 next to what the label says)
  const medSources = Object.fromEntries((await store.listMeds(session.id)).map((m) => [m.id, { dispensed: m.label?.dispensed ?? null }]));
  // C2 track C (only add): facts a family member wrote that wait for his 对 (the banner's 「家人写了 N 条」)
  const pendingFacts = (await store.listProfileFacts(session.id)).filter(isPending).length;
  // C2 track V (only add): his visits whose recording is saved and waits for its text
  const waitingVisits = await visitsWaiting(store, session.id);
  // C2 track A (only add): 「你的密码在 10月9日 20:15 用恢复码重设过」 / 「… 由 Wei Ling 协助重设」, said until he taps 知道了
  const resetNotice = selfId ? passwordResetNotice(await store.listAccountEvents(selfId).catch(() => []), nowMs, locale === "en" ? "en" : "zh-Hans") : null;
  return (
    <div data-testid="page-today" data-scope="account" data-day={today.date}>
      <TimeKeeper nextAtMs={today.nextChangeMs} serverNowMs={nowMs} />
      {/* track D: a link changing (she accepts, his other phone confirms) re-reads Today */}
      {selfId ? <CareLive /> : null}
      <TodayAccount
        locale={locale}
        data={data}
        reminder={today.reminder}
        routine={routine}
        medSources={medSources}
        meta={
          <>
            {/* the draft's header: 「今天」, the date under it (with the time: a filming account's clock is not the phone's), 「EN / 中」 */}
            <ElderMeta locale={locale} title={t(locale, "today.title")} story={`${dateWords(locale, today.date)} · ${clockWords(locale, today.time)}`} />
            {/* C2 track A (only add): the password-reset line, above everything else of the day */}
            {resetNotice ? <ResetNoticeLine notice={resetNotice} /> : null}
          </>
        }
        banner={
          <>
            {/* this phone's notifications, while it was never asked (the draft's 通用-5a to 5d): his own phone only */}
            {selfId && firstReminder ? <PushPrompt locale={locale} time={shortTime(firstReminder)} /> : null}
            {/* C2 track C (only add): 「家人写了 N 条，等你确认」 goes here, under the example's banner */}
            <FamilyFactsLine locale={locale} count={pendingFacts} />
          </>
        }
        // while a slot needs him or he is answering, the banner is only the example's quiet line (one thing per screen)
        bannerQuiet={session.example_data ? <ExampleLine locale={locale} /> : undefined}
        // C2 track V (only add): 「录音已存，等转写」 for a visit, an entry of the line
        visitWaiting={waitingVisits.length ? <TodayVisitWaiting locale={locale} visits={waitingVisits} /> : undefined}
        // owner 10-14: his month at the top of the overview (owner 10-15: a day he taps opens as a sheet, below)
        month={<OwnMonth month={month} locale={locale} />}
        familyConfirm={
          waiting ? (
            <FamilyConfirm locale={locale} link={waiting} helped={helped} />
          ) : bound ? (
            <BoundCard locale={locale} link={bound} helped={boundHelped} tz={scopeTz(session)} testId="today-family-bound" />
          ) : renew ? (
            <ReconsentCard locale={locale} link={renew} paragraphs={familyConsentText("family_share", locale).paragraphs} helped={renewHelped} date={today.date} testId="today-family-reconsent" />
          ) : undefined
        }
        // track D: the notice 「Wei Ling 已经接受」 opens /p/today?confirm=1 (lib/push/accepted.ts): the card first
        familyConfirmFirst={!!one(sp.confirm)}
        // the last set-up step lands here with ?setup=done: 「建好了」, said once (owner's tidy of 10-13)
        setupDone={one(sp.setup) === "done"}
        tabBar={<TabBar active="today" locale={locale} />}
      />
      {/* owner 10-14: 「按住任何一样东西，Ripple 帮你看」, once per browser; never while a medicine waits for his answer, nor
          with the family card or 「建好了」 (what only the browser knows, the coach reads off the screen itself) */}
      <ExplainCoach locale={locale} quiet={(!!today.focus && today.focus.why !== "coming" && today.focus.why !== "untracked") || !!waiting || !!bound || !!renew || one(sp.setup) === "done" || !!opened} />
      {/* owner 10-15: the day he opened in his month, as a sheet over Today (its visit, readings, medicine, notes, questions) */}
      {opened ? <OwnDay key={opened} month={month} locale={locale} tz={scopeTz(session)} /> : null}
    </div>
  );
}

/**
 * Track D's confirmation (real-app 2.20 step 3), on Today as on 「我 → 家人」: 「Wei Ling 接受了邀请，是她吗？」, her name
 * and account, why it matters, 是她 / 不是 (components/family/HisFamily ConfirmHer, its own buttons in the lower half).
 * A wrapper with display: contents, so the buttons still dock at the bottom of the screen.
 */
function FamilyConfirm({ locale, link, helped }: { locale: Locale; link: PatientLinkView; helped: string | null }) {
  // the card itself is the family line's (the timeline draft's 18-1): components/his-family/ConfirmCard.tsx
  return <ConfirmCard locale={locale} link={link} helped={helped} testId="today-family-confirm" />;
}
