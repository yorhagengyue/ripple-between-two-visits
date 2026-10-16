/**
 * /f — Wei Ling's phone.
 *
 * Demo (judge sandbox, crew filming session; task M6), exactly as before: she sees only what Mr Tan switched on
 * (family_grant, changed on his /p/family): this week's medicine days, how many blood pressure readings, how many
 * questions wait for the next visit, and, only when he turns them on, his visit transcripts and his notes. The "no
 * reply after two reminders" card (M4) shows only while he allows it. She records her reminder here; his phone plays it
 * at the reminder time. She can look, not act: no dose, question or medicine buttons (the APIs answer her 403 anyway).
 * Sections that are off are left out on the server (lib/family/view.ts), so nothing hidden reaches this page.
 * M6 privacy (B1 wrap-up): who the device is comes from its member row (lib/family/role.ts pageIdentity), not from
 * the rp_role cookie: a device with no row in a session she has joined is sent to /join here too (the proxy gate does
 * it first), and the developer jump menu is left out for her phone by that role. The session row handed to the page's
 * client side is cut to what /f uses (lib/family/events.ts familySessionRow): the join code is not in this page.
 *
 * Her real account (C2 track D; the daughter brief A3, A4, B, H; real-app 2.21): signed out -> the login, back here;
 * her links (lib/care/links.ts): one open link opens at /f?link=<id>, several ask whose; a link waiting for him says so
 * and follows until he confirms (she sees nothing before that); an active link is her home (lib/care/home.ts, live:
 * components/family/FamilyApp.tsx) and her look is logged for him; an ended link says who ended it; a link that no
 * longer exists says the connection has ended. Her read writes nothing of his but that access-log row.
 * Her pages roll over at his midnight like his own (track B's DayClock, mounted here and on her other pages).
 *
 * The screens that only say one thing are drawn as the v3 draft draws them (the fe-d track): 「Ripple」 at the top, one
 * sentence in the middle of the screen, and what she can still do under it: he stopped sharing (H1: the solid
 * 「打电话给爸爸」), she left (H2: the outlined one and 「删除我的账号」), Ripple cannot be reached (I2: 「再试一次」 and
 * 「打电话给爸爸」). While his day is being read her home's own shape stands in its place (I1).
 * A link of hers that is over (he stopped, she left, he said it was not her) keeps 「我的」 at the top right, as the draft
 * draws H1 and H2: her own account's rows, which need no link in force (the fe-d2 follow-up; lib/care/her-page.ts
 * herOwnPage). A link that no longer exists, and no link at all, have no 「我的」: there is no link to name.
 *
 * Line bind: with no link at all she sees 「填长辈的账号」 under that screen's sentence: the account her elder signed up
 * with, how she calls him, and 「绑定」 links the two at once (components/family/BindElder.tsx; lib/care/bind.ts).
 * Round two, her way back to that form: /f?bind=1 shows it whatever links she has (with a way back to /f), and the
 * screens of a link that is over (he stopped, she left, he said it was not her, the link is gone) carry a quiet
 * 「绑定另一位长辈」 that leads there. 「我的」 has the row 「再绑定一位长辈」. The form refuses an elder who removed her
 * (403 bind_removed, lib/care/bind.ts): it tells her to ask him.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FamilyAlerts } from "@/components/daily/FamilyAlerts";
import { BIND_AGAIN_HREF, BindAgainButton } from "@/components/family/BindAgain";
import { BindElder } from "@/components/family/BindElder";
import { CallDad } from "@/components/family/CallDad";
import { FamilyApp } from "@/components/family/FamilyApp";
import { FamilyView } from "@/components/family/FamilyView";
import { LogoutButton } from "@/components/family/HerBits";
import { ReminderRecorder } from "@/components/family/ReminderRecorder";
import { WaitingForDad } from "@/components/family/WaitingForDad";
import { EmptyBlock, FamilyButton, FamilyDock, FamilyHero, FamilyHomeSkeleton, FamilyScreen, FamilyTabs, FamilyTop, familyTabHrefs } from "@/components/family-ui";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { PatientFrame } from "@/components/patient/PatientFrame";
import { NoSessionPhone } from "@/components/session/NoSession";
import { loginUrl } from "@/lib/auth/next";
import { DayClock } from "@/components/daily/elder/DayClock";
import { bc } from "@/lib/care/bind-copy";
import { dadWord, dateLine, privacyLine, relationWord } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { herDayClock } from "@/lib/care/her-page";
import { herPaths } from "@/lib/care/her-view";
import { herHomeNow } from "@/lib/care/home";
import { familyLinks, pickLink, vanishedLinks } from "@/lib/care/links";
import { scheduleFor, settleNoReply } from "@/lib/daily/doses";
import { remindersView } from "@/lib/daily/reminders";
import { preferredClip } from "@/lib/family/clips";
import { familySessionRow } from "@/lib/family/events";
import { actingRole } from "@/lib/family/identity";
import { pageIdentity, STRANGER_HOME } from "@/lib/family/role";
import { familyView } from "@/lib/family/view";
import { otherLocale, t, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeTz } from "@/lib/store/scope";
import type { CareLinkRow, SessionRow } from "@/lib/store/types";
import { getPageSubject, type PageSubject } from "@/lib/subject";
import { getPageUser } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";
// the family texts asked again (only add): her family_accept text in force, for her card
import { familyConsentText } from "@/lib/care/consent";

export const dynamic = "force-dynamic";

const langHrefFor = (locale: Locale, path: string) => `/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(path)}`;

export default async function FamilyPage(props?: PageProps<"/f">) {
  const sp = props?.searchParams ? await props.searchParams : {};
  const link = typeof sp.link === "string" ? sp.link : undefined;
  const [ctx, locale] = await Promise.all([getPageSubject(link), getPatientLocale()]);
  // called, not mounted: the demo's page element is the provider itself (tests/unit/family/f-page.test.ts), and a
  // redirect is thrown while the page runs
  if (ctx && ctx.subject.kind === "demo") return demoFamily(ctx, locale);
  if (sp.bind === "1") return bindAgain(locale);
  return accountFamily(ctx, link ?? null, locale);
}

/**
 * /f?bind=1: the form again, for a family member who already follows someone or whose link is over. Her own account
 * is all it needs (no link is read). An elder's own phone has his pages: he binds from 「邀请家人」.
 */
async function bindAgain(locale: Locale) {
  const me = await getPageUser();
  if (!me) redirect(loginUrl(BIND_AGAIN_HREF));
  if (me.scope) redirect("/p/today");
  return <BindElder locale={locale} testState="bind_again" langHref={langHrefFor(locale, BIND_AGAIN_HREF)} title={bc(locale, "bindMore")} back={{ href: "/f", label: bc(locale, "bindBack") }} />;
}

/** The demo's /f, unchanged. */
async function demoFamily(ctx: PageSubject, locale: Locale) {
  const store = ctx.store;
  const session = ctx.session;
  const who = await pageIdentity(ctx, store);
  if (who.kind === "stranger") redirect(STRANGER_HOME);
  await settleNoReply(store, session);
  const [view, schedule, reminders] = await Promise.all([familyView(store, session, {}), scheduleFor(store, session), remindersView(store, session)]);
  const clip = preferredClip(reminders.clips);
  const current = clip?.audio_url ? (clip.stand_in ? "stand_in" : "hers") : null;
  // the client side gets the fields /f uses only (no join code); LiveSessionProvider's type is the whole row
  const row = familySessionRow(ctx.client) as SessionRow;
  return (
    <LiveSessionProvider key={ctx.client.id} session={row} d0={ctx.d0} since={ctx.since}>
      <PatientFrame locale={locale} variant="family" role={actingRole(who)}>
        <div className="flex flex-col gap-4" data-testid="page-family">
          <h1 className="text-[28px] font-bold">{t(locale, "family.title")}</h1>
          {/* M4: "no reply after two reminders", only while he allows it (family_grant.no_reply_alert) */}
          <FamilyAlerts locale={locale} />
          <FamilyView key={`${ctx.client.id}-${session.story_day}`} locale={locale} initial={view} />
          <ReminderRecorder key={`rec-${ctx.client.id}`} locale={locale} firstReminder={schedule.first} current={current} />
        </div>
      </PatientFrame>
    </LiveSessionProvider>
  );
}

/**
 * One screen of hers that only says one thing: 「Ripple」 at the top, the sentence and the line under it in the middle
 * (`top`: at the top instead, with a note, as the draft draws 「现在连不上 Ripple。」), and under them what she can still
 * do: a solid button (`action`), 「打电话给爸爸」 (`call`: his number is on this phone, or asked for once), 「删除我的账号」
 * (`removeHref`), 「退出登录」 (`logout`: she is signed in and has nothing to open). `meHref`: 「我的」 at the top right
 * (her link is over; her own account is still hers to look after). `bindAgain` (line bind, round two): the quiet
 * 「绑定另一位长辈」 on the screens of a link that is over, leading to the form.
 */
function Plain({
  locale,
  title,
  body,
  note,
  testState,
  langHref,
  action,
  call,
  removeHref,
  logout,
  top,
  meHref,
  bindAgain: again,
}: {
  locale: Locale;
  title: string;
  body?: string;
  note?: string;
  testState: string;
  langHref: string;
  action?: { label: string; href: string };
  call?: { linkId: string; dad: string; variant: "primary" | "secondary" };
  removeHref?: string;
  logout?: boolean;
  top?: boolean;
  meHref?: string;
  bindAgain?: boolean;
}) {
  return (
    <div className="contents" data-testid="family-app" data-state={testState}>
      <FamilyScreen locale={locale}>
        <FamilyTop brand locale={locale} langHref={langHref} meHref={meHref} />
        {top ? (
          <>
            <FamilyHero tone="quiet" title={title} detail={body} />
            {note && (
              <p className="rpf rpf-note" style={{ marginTop: 14 }}>
                {note}
              </p>
            )}
          </>
        ) : (
          <EmptyBlock title={title} detail={body} note={note} />
        )}
        <FamilyDock foot={removeHref || logout || again ? "h" : "e"}>
          {action && (
            <FamilyButton href={action.href} data-testid="family-retry">
              {action.label}
            </FamilyButton>
          )}
          {call && <CallDad linkId={call.linkId} locale={locale} dad={call.dad} variant={call.variant} />}
          {again && <BindAgainButton locale={locale} />}
          {removeHref && (
            <FamilyButton href={removeHref} variant="quiet" data-testid="ended-delete">
              {hc(locale, "deleteAccount")}
            </FamilyButton>
          )}
          {logout && <LogoutButton locale={locale} />}
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}

/** Her home once his day is read (her switches, every section that is on, her look logged). */
async function HerHome({ ctx, link, userId, locale, langHref, now }: { ctx: PageSubject; link: CareLinkRow; userId: string; locale: Locale; langHref: string; now: number }) {
  // the family texts asked again (lib/care/reconsent.ts): her store has cut the switches; the copy says so, and while she
  // has not agreed herself her card carries her text in force
  const consent = ctx.subject.consent ?? null;
  const home = await herHomeNow(ctx.store, ctx.session, { link, userId, consent }, now);
  const mine = consent && !consent.hers ? familyConsentText("family_accept", locale) : null;
  const herText = mine ? { title: mine.title, paragraphs: mine.paragraphs } : null;
  // keyed by his date: at his midnight the day clock reads the page again and her home starts over on the new day
  // (during the day it keeps itself current: its stream, and a read every 15 seconds)
  return <FamilyApp key={`${link.id}|${home.today}`} locale={locale} linkId={link.id} since={ctx.since} tz={scopeTz(ctx.session)} initial={home} langHref={langHref} herText={herText} />;
}

async function accountFamily(ctx: PageSubject | null, link: string | null, locale: Locale) {
  const me = await getPageUser();
  if (!me) redirect(loginUrl(link ? `/f?link=${encodeURIComponent(link)}` : "/f"));
  const now = nowMs();
  const here = link ? `/f?link=${encodeURIComponent(link)}` : "/f";
  const langHref = langHrefFor(locale, here);

  // her active link: the home
  if (ctx && ctx.subject.relation === "family" && ctx.subject.link) {
    const l = ctx.subject.link;
    const clock = herDayClock(ctx.session, now);
    const paths = herPaths(l.id);
    const dad = dadWord(l.patient_label, locale);
    // I1: while his day is read, the home's own shape in still grey, the date (his clock, nothing of his records) and
    // the two buttons, which already work
    const loading = (
      <FamilyHomeSkeleton
        locale={locale}
        dad={dad}
        title={hc(locale, "dadToday", { dad })}
        kicker={dateLine(clock.date, locale)}
        loadingText={hc(locale, "loading", { dad })}
        privacy={privacyLine(dad, null, locale)}
        langHref={langHref}
        meHref={paths.me}
        tabs={<FamilyTabs locale={locale} active="home" hrefs={familyTabHrefs(paths)} />}
        recordHref={paths.reminder}
        sharedHref={paths.shared}
        call={<CallDad linkId={l.id} locale={locale} dad={dad} variant="secondary" />}
        todayIndex={(new Date(`${clock.date}T00:00:00Z`).getUTCDay() + 6) % 7}
      />
    );
    return (
      <>
        <DayClock {...clock} />
        <Suspense fallback={loading}>
          <HerHome ctx={ctx} link={l} userId={me.user.userId} locale={locale} langHref={langHref} now={now} />
        </Suspense>
      </>
    );
  }

  const links = await familyLinks(me.store, me.user.userId, now);
  if (!links.length) {
    if (me.scope) redirect("/p/today"); // his own phone: his pages
    // a link in the address that is gone (he ended it, or deleted his account) says so, even when it was her only one
    if (link) return <Plain locale={locale} testState="gone" langHref={langHref} title={hc(locale, "goneTitle")} body={hc(locale, "goneBody")} logout bindAgain />;
    // no link in the address either (she opened Ripple from her home screen): she did follow someone, and that link's
    // row went with his account (real-app 3.11 删除账号 「她的 /f 显示『这个联系已经结束』」). Her own family_accept record
    // is what still says so; without one she never followed anyone.
    if ((await vanishedLinks(me.store, me.user.userId, links)).length) return <Plain locale={locale} testState="gone" langHref={langHref} title={hc(locale, "goneTitle")} body={hc(locale, "goneBody")} logout bindAgain />;
    // line bind: she follows nobody yet. The screen's sentence stays as its quiet first line, and under it she types her
    // elder's account and is linked at once (components/family/BindElder.tsx; POST /api/family/bind). 「退出登录」 stays.
    return <BindElder locale={locale} testState="no_link" langHref={langHref} title={hc(locale, "noLinkTitle")} />;
  }
  const chosen = pickLink(links, link);
  if (!chosen) {
    if (link) return <Plain locale={locale} testState="gone" langHref={langHref} title={hc(locale, "goneTitle")} body={hc(locale, "goneBody")} logout bindAgain />;
    const open = links.filter((x) => x.state === "active" || x.state === "accepted");
    return (
      <div className="contents" data-testid="family-app" data-state="choose">
        <FamilyScreen locale={locale}>
          <FamilyTop brand locale={locale} langHref={langHref} />
          <FamilyHero tone="quiet" title={hc(locale, "chooseTitle")} />
          <FamilyDock foot="e">
            {open.map((x) => (
              <FamilyButton key={x.id} href={`/f?link=${encodeURIComponent(x.id)}`} variant="secondary">
                {`${dadWord(x.patientLabel, locale)}${x.relation ? ` (${relationWord(x.relation, locale)})` : ""}`}
              </FamilyButton>
            ))}
          </FamilyDock>
        </FamilyScreen>
      </div>
    );
  }
  if (!link) redirect(`/f?link=${encodeURIComponent(chosen.id)}`);
  const dad = dadWord(chosen.patientLabel, locale);
  switch (chosen.state) {
    case "accepted":
      return (
        <div className="contents" data-testid="family-app" data-state="waiting">
          <WaitingForDad locale={locale} linkId={chosen.id} dad={dad} langHref={langHref} />
        </div>
      );
    case "left":
      // H2: she left by herself
      return (
        <Plain
          locale={locale}
          testState="left"
          langHref={langHref}
          title={hc(locale, "leftTitle", { dad })}
          body={hc(locale, "leftBody", { dad })}
          call={{ linkId: chosen.id, dad, variant: "secondary" }}
          removeHref={herPaths(chosen.id).remove}
          meHref={herPaths(chosen.id).me}
          bindAgain
        />
      );
    case "declined":
      return <Plain locale={locale} testState="declined" langHref={langHref} title={hc(locale, "declinedTitle", { dad })} body={hc(locale, "declinedBody", { dad })} logout meHref={herPaths(chosen.id).me} bindAgain />;
    case "active":
      // I2: active, yet the page subject did not resolve (a race with his change): one more tap reads it again
      return (
        <Plain
          locale={locale}
          testState="retry"
          langHref={langHref}
          top
          title={hc(locale, "loadingFail", { dad })}
          body={hc(locale, "loadingFailBody", { dad })}
          note={hc(locale, "loadingFailNote", { dad })}
          action={{ label: hc(locale, "retry"), href: here }}
          call={{ linkId: chosen.id, dad, variant: "secondary" }}
        />
      );
    default:
      // H1: he stopped sharing
      return (
        <Plain
          locale={locale}
          testState="ended"
          langHref={langHref}
          title={hc(locale, "endedTitle", { dad })}
          body={hc(locale, "endedBody", { dad })}
          call={{ linkId: chosen.id, dad, variant: "primary" }}
          meHref={chosen.state === "revoked" ? herPaths(chosen.id).me : undefined}
          bindAgain
        />
      );
  }
}
