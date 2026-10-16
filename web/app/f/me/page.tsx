/**
 * /f/me?link= — her own page (C2 track D; relaid to the v3 draft's G1 by the fe-d track): 「你在看爸爸的 Ripple。」, then
 * groups of hairline rows: her account (name, account, and one row for her own sign-in, 登录和设备, a small screen of
 * hers that also leads to 改密码 and 换一个恢复码; the words are the account's own, lib/auth/copy.ts); reminders and
 * contact (notifications, Dad's number, each opening its own screen); the language as two halves; and the three things
 * that end something, each a row: 退出登录, 不再看爸爸的 Ripple (its own screen says what follows, G4), 删除我的账号
 * (track H's /f/me/delete, G5).
 *
 * Not in the draft, kept, in a group of their own (「别的」): adding a line to his details (/f/facts); under the group,
 * Android's own 「装到主屏」 while the browser offers it.
 *
 * Owner's tidy of 10-13: the top bar has no 「中 EN」 here (the two halves below do the same; her other screens keep
 * it); 改密码 and 换一个恢复码 are rows of the screen 「登录和设备」 opens, as on his; the row 「加到主屏」 is gone (the
 * steps, /f/me/install, are reached from 「通知」, which always has 「怎么加到主屏」).
 *
 * Once her link has ended (he stopped sharing, she left, he said it was not her; the fe-d2 follow-up) the page still
 * opens, from 「我的」 at the top right of the screen that says so (the draft's H1, H2), with what concerns her own
 * account alone: the sentence is how her link stands now (the ended screen's own words), then her account's rows, the
 * language, 退出登录 and 删除我的账号. Everything that needs him is left out: notifications about him, his number,
 * adding to his details, Android's install button, leaving, and the line about what he cannot see.
 * lib/care/her-page.ts herOwnPage decides which of the two it is.
 *
 * Line bind (round two): the row 「再绑定一位长辈」 in the group 「别的」, in both states: it opens the form 「填长辈的
 * 账号」 (/f?bind=1), which needs her own account and no link.
 */
import { BIND_AGAIN_HREF } from "@/components/family/BindAgain";
import { LogoutButton, NotificationsRow, PhoneRow } from "@/components/family/HerBits";
import { HerInstall } from "@/components/family/HerInstall";
import { FamilyHero, FamilyNote, FamilyScreen, FamilySection, FamilyTabs, FamilyTop, FactRow, FactRows, LangSegment, familyTabHrefs } from "@/components/family-ui";
import { accountCopy } from "@/lib/auth/copy";
import { bc } from "@/lib/care/bind-copy";
import { hc, type HerKey } from "@/lib/care/her-copy";
import { herOwnPage, herSwitches, type HerEndedState } from "@/lib/care/her-page";
import { careEntryStore, getPageUser } from "@/lib/subject/care";

export const dynamic = "force-dynamic";

/** How her link stands once it is over, in the words of the screen that says so (app/f/page.tsx: H1, H2, 「没有确认是你」). */
const ENDED_TITLE: Record<HerEndedState, HerKey> = { revoked: "endedTitle", left: "leftTitle", declined: "declinedTitle" };

export default async function FamilyMePage({ searchParams }: PageProps<"/f/me">) {
  const p = await herOwnPage(await searchParams, "/f/me");
  const me = await getPageUser();
  const { locale, dad, paths, active } = p;
  const account = me?.user.account;
  const a = accountCopy(locale);
  const lang = (to: "zh-Hans" | "en") => `/api/profile/lang?to=${to}&next=${encodeURIComponent(paths.me)}`;
  // the link itself, as rows of this page (owner 10-14: who she is bound to, since when, what it shows, and the way
  // out, all under 「我的」): the day it took force in his zone, and how many of his switches are on
  const since = active ? (active.link.confirmed_at ?? active.link.accepted_at ?? active.link.created_at) : null;
  const sinceWords = since ? new Intl.DateTimeFormat(locale === "en" ? "en-SG" : "zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: active?.tz }).format(new Date(since)) : "";
  const on = active ? Object.values((await herSwitches(active.ctx.store, active.ctx.session, active.link.id)).items).filter(Boolean).length : 0;
  // who the link is with, by his own name and account (owner 10-14: 「绑定的名称应该是 ID 本身、全名」). Her own store may
  // not read another person's account row; the care flow's narrow store may, as his side reads hers for the bound card
  const his = active ? await careEntryStore().getAccount(active.link.patient_id).catch(() => null) : null;
  const hisName = his?.display_name?.trim() || dad;
  const boundTo = his?.username ? `${hisName}（${his.username}）` : hisName;
  return (
    <div className="contents" data-testid="family-me" data-state={active ? "active" : (p.ended ?? undefined)}>
      <FamilyScreen locale={locale} tabs={active ? <FamilyTabs locale={locale} active="me" hrefs={familyTabHrefs(paths)} /> : undefined}>
        {/* no 「中 EN」 in this top bar: the two halves under 「语言」 do the same (owner's tidy of 10-13). With a link in
            force this is a place of her bottom bar (owner 10-14): the top names it; without one the way back stays */}
        {active ? <FamilyTop title={hc(locale, "meBack")} locale={locale} /> : <FamilyTop back={{ href: paths.home, label: hc(locale, "meBack") }} locale={locale} />}
        <FamilyHero tone="quiet" title={hc(locale, p.ended ? ENDED_TITLE[p.ended] : "meTitle", { dad })} />

        {active && (
          <>
            <FamilySection>{hc(locale, "meBinding")}</FamilySection>
            <FactRows kind="settings">
              <FactRow label={hc(locale, "meBoundTo")} value={boundTo} data-testid="me-bound-to" />
              <FactRow label={hc(locale, "meBoundSince")} value={sinceWords} data-testid="me-bound-since" />
              <FactRow label={hc(locale, "sharedTitle", { dad })} value={hc(locale, "meSharedCount", { n: on })} href={paths.shared} data-testid="me-shared" />
              <FactRow label={bc(locale, "bindMore")} value="" href={BIND_AGAIN_HREF} data-testid="me-bind" />
              {/* the way out of the link: the screen that says what follows (G4), under the name he asked for */}
              <FactRow label={hc(locale, "meUnbind")} value="" href={paths.leave} data-testid="me-leave-open" />
            </FactRows>
          </>
        )}

        <FamilySection>{hc(locale, "meAccount")}</FamilySection>
        <FactRows kind="settings">
          <FactRow label={hc(locale, "meName")} value={account?.display_name ?? "—"} data-testid="me-name" />
          <FactRow label={hc(locale, "meAccount")} value={account?.username ?? hc(locale, "meAccountEmail")} data-testid="me-sign-in" />
          {/* her own sign-in (the draft does not draw it; his is under 「我 → 登录和设备」, which she cannot open). One
              row: 改密码 and 换一个恢复码 are rows of the screen it opens (owner's tidy of 10-13) */}
          <FactRow label={a.devicesTitle} value="" href={paths.devices} data-testid="me-devices" />
        </FactRows>

        {active && (
          <>
            <FamilySection>{hc(locale, "meReach")}</FamilySection>
            <FactRows kind="settings">
              <NotificationsRow locale={locale} href={paths.notifications} />
              <PhoneRow linkId={active.link.id} locale={locale} dad={dad} href={paths.phone(paths.me)} />
            </FactRows>
          </>
        )}

        <FamilySection>{hc(locale, "meLanguage")}</FamilySection>
        <LangSegment current={locale} zhHref={lang("zh-Hans")} enHref={lang("en")} />

        {/* not in the draft, kept: what she can still do from here */}
        <FamilySection>{hc(locale, "meMore")}</FamilySection>
        <FactRows kind="settings">
          {active && <FactRow label={hc(locale, "meFacts", { dad })} value="" href={paths.facts} data-testid="open-facts" />}
          {/* line bind (round two): the form 「填长辈的账号」 again. Her own account is all it needs, so the row stays
              once her link has ended (it is then the only one of this group); with a link in force it is a row of
              「绑定」 above (owner 10-14) */}
          {!active && <FactRow label={bc(locale, "bindMore")} value="" href={BIND_AGAIN_HREF} data-testid="me-bind" />}
        </FactRows>
        {/* Android: the browser's own install offer, while it stands (the iPhone's steps have their own screen, reached
            from 「通知」 → 「怎么加到主屏」) */}
        {active && <HerInstall locale={locale} pictured={false} />}

        <FactRows kind="settings" style={{ marginTop: 32, marginBottom: active ? undefined : 24 }}>
          <LogoutButton locale={locale} row />
          <FactRow label={hc(locale, "deleteAccount")} value="" href={paths.remove} data-testid="me-delete" />
        </FactRows>
        {active && <FamilyNote style={{ margin: "20px 0 24px" }}>{hc(locale, "meOnlyYours", { dad })}</FamilyNote>}
      </FamilyScreen>
    </div>
  );
}
