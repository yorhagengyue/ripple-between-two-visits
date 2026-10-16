/**
 * /p/me/notifications — 「我 › 提醒和通知」 (C2 track I; real-app 2.6, 2.23, 2.24; the elder brief's 通用状态 通知):
 * whether this phone gets Ripple's reminders, and the one thing to do about it:
 *
 *   提醒还没开      「开提醒」: the browser asks (only on a tap), the phone subscribes, and 「提醒已经开好了」 arrives
 *   提醒开着        what comes and when (his own slots' times), what the lock screen says (never a medicine name),
 *                   his reminders of today and yesterday and whether he opened them; 「发一条试试」, 「关掉这台手机的提醒」
 *   提醒没开        he refused: no asking again; how to allow it in the phone's settings, 「再试一次」
 *   iPhone          Ripple must be on the Home Screen first: three steps
 *   不支持          this browser cannot: reminders still show on Today
 * Android's 「装到主屏」 appears when the browser offers it. The page links the web app manifest, so this is also where
 * an iPhone's 「添加到主屏幕」 picks up Ripple's name and icon.
 *
 * His own account only (the demo and her phone have no 「我」 here: 404 / the /p layout's own answer).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { doseDay } from "@/lib/daily/cells";
import { dt, shortTime, type DailyKey } from "@/lib/daily/i18n";
import { pushPageCopy, VISIT_READY_WORDS } from "@/lib/push/copy";
import { recentReminders } from "@/lib/push/deliveries";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0, scopeTz } from "@/lib/store/scope";
import { storyDate } from "@/lib/story/clock";
import { getPageSubject } from "@/lib/subject";
import { nowMs as appNowMs } from "@/lib/time/now";
import { NotificationsScreen, type RecentLine, type SlotLine } from "./NotificationsScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "提醒和通知 · Ripple",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ripple", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

function clockAt(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return shortTime(`${h === "24" ? "00" : h}:${m}`);
}

export default async function NotificationsPage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = pushPageCopy(locale);
  const session = ctx.session;
  const tz = scopeTz(session);
  const today = storyDate(scopeD0(session), session.story_day);

  const days = await doseDay(ctx.store, session, session.story_day, appNowMs());
  const slots: SlotLine[] = days.map((d) => ({
    slot: d.slot,
    name: dt(locale, `slotMed.${d.slot}` as DailyKey),
    when: c.slotLine(shortTime(d.schedule.first), shortTime(d.schedule.second)),
  }));

  const recent: RecentLine[] = (await recentReminders(ctx.store, session)).slice(0, 6).map((r) => {
    // one kind per line; only a dose reminder's slot names a medicine time, so only it is looked up by its slot
    const named: Record<string, string> = {
      bp_due: c.bp,
      // C2 track F (own line): 「看诊记录好了」 has no slot of the day
      visit_ready: VISIT_READY_WORDS[locale].title,
      family_accepted: c.accepted,
    };
    const what = named[r.kind] ?? `${dt(locale, `slotMed.${r.slot}` as DailyKey)} · ${r.kind === "dose_second" ? c.second : c.first}`;
    return {
      what,
      when: `${r.date === today ? c.today : c.yesterday} ${clockAt(r.sent_at, tz)}`,
      opened: r.opened_at ? c.recentOpened(clockAt(r.opened_at, tz)) : c.recentNotOpened,
      wasOpened: !!r.opened_at,
    };
  });

  return <NotificationsScreen locale={locale} slots={slots} recent={recent} />;
}
