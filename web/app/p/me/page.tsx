/**
 * /p/me — 「我」 on his own account (C2; composition only, track C; laid out after the timeline draft's 我-1 and 21-1 by
 * line fe-me). 「我」 is the fourth place of his bottom bar (owner, 10-14: 今天 / 就诊 / 记录 / 我), so the header has no way
 * back, only 「我」 and his name; under it white cards of rows, one row per thing he can look at or change, each a link
 * to its own page (the pages are the tracks'; they have no bar, as on her side, and go back here):
 *
 *   about him       称呼 /p/profile/name, 语言 /p/profile/language, 早饭时间和提醒 /p/profile/times (C; real-app 2.23 lists
 *                   these as rows of their own, first), 我的档案 /p/profile
 *   family, phone   家人能看到什么 /p/family (D), 提醒和通知 /p/me/notifications (I; this phone's real state; 「开提醒」 and
 *                   「再试一次」 are on that page)
 *   to read         饮食 /p/diet (K)
 *   signing in      登录和设备 /p/me/devices (A), which has 改密码 and 恢复码
 *   his data        AI 处理 /p/me/ai, 我的数据 /p/me/export, 删除账号 /p/me/delete (H)
 *   the example     示例资料 /p/me/example (C), only while the account runs on the example data; 拍摄账号 /p/me/filming
 *                   (J) in the same card, only on a browser with the film crew's cookie
 * and last 退出登录, a button that signs this phone out (real-app 2.23; no dialog). The demo has no 「我」 (404).
 *
 * Rows that left this page (owner's tidy of 10-13), each because the same entry is elsewhere: 改密码 and 恢复码 (inside
 * 登录和设备), 忘记密码时请家人帮忙 (on the family member's own page, /p/family/<id>), 预防 (its entry is on the question
 * list), the example's two rows (one row now, both buttons are on its page).
 */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AccountEntry, AiConsentEntry, DataEntry, ExampleDataEntry, FamilyEntry, FilmingAccountEntry, MeEntry, MeGroup, MeLayout, NotificationsEntry, ProfileEntry } from "@/components/me";
import { PageHeader, TabBar } from "@/components/ui";
import { listDevices } from "@/lib/auth/service";
import { aiState } from "@/lib/privacy/ai";
import { meCopy } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";
import { isPending } from "@/lib/profile/facts";
import { hisName } from "@/lib/profile/identity";
import { profileView } from "@/lib/profile/view";
import { CREW_COOKIE, crewCookieAccepted } from "@/lib/session/crew-key";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { accountDeps, pageFacts, pageUser } from "@/lib/subject/account";
// C2 track K (only add): the diet row (integrator, 10-10)
import { DietEntry } from "@/components/diet/DietEntry";
import { LogoutRow } from "./LogoutRow";

export const dynamic = "force-dynamic";

/** How many devices are signed in now (the draft's 「1 台」); undefined when it cannot be read: the row then has no number. */
async function signedInDevices(): Promise<number | undefined> {
  try {
    const me = await pageUser();
    if (!me) return undefined;
    const devices = await listDevices(accountDeps(), me, await pageFacts());
    return devices.filter((d) => d.signed_in).length;
  } catch {
    return undefined;
  }
}

export default async function MePage() {
  const [ctx, locale, jar] = await Promise.all([getPageSubject(), getPatientLocale(), cookies()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account") notFound();
  const zh = locale === "zh-Hans";
  const facts = await ctx.store.listProfileFacts(ctx.session.id);
  const pending = facts.filter(isPending).length;
  const name = facts.find((f) => f.kind === "name" && f.confirmed_by !== null && f.hidden !== true)?.text ?? null;
  const crew = crewCookieAccepted(jar.get(CREW_COOKIE)?.value);
  // track C's own rows (real-app 2.23): 称呼, 语言, 早饭时间和提醒 at the top, 退出登录 at the foot
  const mc = meCopy(locale);
  const own =ctx.subject.relation === "self" && ctx.subject.userId ? ctx.subject.userId : null;
  const [called, view, ai, devices] = await Promise.all([
    hisName(ctx.store, ctx.session),
    profileView(ctx.store, ctx.session),
    // the states the draft writes on the right of two rows (「开」, 「1 台」): read with what the pages behind them read
    own ? aiState(ctx.store, own).then((s) => s.on, () => undefined) : undefined,
    own ? signedInDevices() : undefined,
  ]);
  return (
    <MeLayout
      locale={locale}
      grouped
      headline={null}
      // a place of the bar: the title names it, no way back (the bar is the way to the other three)
      meta={<PageHeader title={mc.me} subtitle={called ?? undefined} locale={locale} />}
      tabBar={<TabBar active="me" locale={locale} />}
      foot={
        /* track C (real-app 2.23): 退出登录 straight from 「我」, the same rules as the button on 登录和设备 */
        <LogoutRow locale={locale} />
      }
      entries={
        <>
          <MeGroup>
            {/* track C (real-app 2.23): 称呼, 语言, 早饭时间和提醒 as rows of their own */}
            <MeEntry entry="name" href="/p/profile/name" title={mc.nameRow} right={called ?? mc.notYet} />
            <MeEntry entry="language" href="/p/profile/language" title={mc.langRow} right={mc.langName(locale)} />
            <MeEntry entry="times" href="/p/profile/times" title={mc.timesRow} status={mc.timesStatus(view.breakfast ? clockWords(view.breakfast, locale) : null, clockWords(view.reminderAt, locale))} />
            <ProfileEntry locale={locale} pending={pending} name={name} />
          </MeGroup>
          <MeGroup>
            <FamilyEntry locale={locale} />
            {/* C2 track I: live, so 「我」 itself says whether this phone's reminders are on (real-app 2.6) */}
            <NotificationsEntry locale={locale} live />
          </MeGroup>
          <MeGroup>
            {/* C2 track K (only add): 饮食 */}
            <DietEntry locale={locale} />
          </MeGroup>
          <MeGroup>
            <AccountEntry locale={locale} count={devices} />
          </MeGroup>
          <MeGroup>
            <AiConsentEntry locale={locale} on={ai} />
            <DataEntry locale={locale} />
            <MeEntry entry="delete" href="/p/me/delete" tone="danger" title={zh ? "删除账号" : "Delete my account"} status={zh ? "删掉账号和全部记录" : "Remove the account and all its records"} />
          </MeGroup>
          {(ctx.session.example_data || crew) && (
            <MeGroup>
              {ctx.session.example_data && <ExampleDataEntry locale={locale} />}
              {/* C2 track J: only on a phone that carries the film crew's cookie (the draft's 21-1: next to the example's rows) */}
              {crew && <FilmingAccountEntry locale={locale} />}
            </MeGroup>
          )}
        </>
      }
    />
  );
}
