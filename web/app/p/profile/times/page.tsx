/**
 * /p/profile/times — 「我 › 早饭时间和提醒」 (real-app 2.23, 2.16 line 252; track C; laid out with the timeline draft's
 * pieces by line fe-me): when he has breakfast, and when each part of the day's medicine is reminded (早上、中午、晚上、
 * 睡前). A card for breakfast, a card of the parts he uses under the grey heading 「几点提醒」 (the morning always; a
 * later part only when a medicine on his list is taken then or he set its time himself: lib/profile/reminder-times.ts
 * slotTimesInUse; owner's tidy of 10-13): one row each, the time on the right and under the name where the time comes
 * from (the time he set, his routine, or the time Ripple uses until he sets one); a tap opens the one screen that
 * changes it. The breakfast row opens the setting-up screen for breakfast and comes back here. Whether this phone gets the reminders at all is track I's screen (提醒和通知), the last row.
 * His own account only (the demo has no 「我」: 404).
 */
import { notFound } from "next/navigation";
import { P } from "@/components/me/parts";
import { ListCard, ListItem, PageHeader, Screen } from "@/components/ui";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { meCopy } from "@/lib/profile/copy";
import { clockWords } from "@/lib/profile/dates";
import { slotTimesInUse } from "@/lib/profile/reminder-times";
import { profileView } from "@/lib/profile/view";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

/** A row of a card keeps the hook the first build's rows had (data-rp="row"). */
const ROW = { "data-rp": "row" } as const;

export default async function TimesPage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") notFound();
  const c = meCopy(locale);
  const [view, meds] = await Promise.all([profileView(ctx.store, ctx.session), ctx.store.listMeds(ctx.session.id)]);
  // the morning, and the later parts of the day he has a medicine in or set a time for (owner's tidy of 10-13)
  const slots = slotTimesInUse(ctx.session, meds);
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me", label: c.me }} title={c.timesTitle.join(" ")} locale={locale} />
      <div className="rpu-stack">
        <P size="large">{c.timesLede}</P>
        <div data-rp="times-breakfast">
          <ListCard>
            <ListItem href="/onboard/breakfast?return=/p/profile/times" title={c.breakfast} right={view.breakfast ? clockWords(view.breakfast, locale) : c.notYet} chevron attrs={ROW} />
          </ListCard>
        </div>
        <div data-rp="slot-times">
          <ListCard heading={c.remindAt}>
            {slots.map((t) => (
              <ListItem
                key={t.slot}
                href={`/p/profile/times/${t.slot}`}
                title={
                  <span data-slot={t.slot} data-source={t.source}>
                    {dt(locale, `slotMed.${t.slot}` as DailyKey)}
                  </span>
                }
                sub={t.source === "own" ? c.sourceOwn : t.source === "routine" ? c.sourceRoutine(t.slot) : c.sourceApp}
                right={clockWords(t.first, locale)}
                chevron
                attrs={ROW}
              />
            ))}
          </ListCard>
        </div>
        <ListCard>
          <ListItem href="/p/me/notifications" title={c.phoneRow} sub={c.phoneValue} chevron attrs={ROW} />
        </ListCard>
      </div>
    </Screen>
  );
}
