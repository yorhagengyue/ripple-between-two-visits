/**
 * /f/week?link=&offset= — 「这一周」 day by day (C2 track D; relaid to the v3 draft's C1 and C2 by the fe-d track): the
 * way back with the week's dates under its name (an earlier week: its dates alone), one sentence that counts the week
 * (「这一周，6 天里吃了 5 天。」, the server's count), 「往前一周」 and, on an earlier week, 「回到这一周」 above the list (three
 * weeks back at most), then seven rows, each the day's mark, the weekday, the date and one state at the right with the
 * time he tapped. One state per day: no medicine names, never a reason. The last line says all of it is what he agreed
 * to share (and what is not shared) and opens the list.
 * Only while he shares his medicine (else back to her home).
 * Opened from the week strip on her home; it is not a place of her bottom bar (owner 10-14: the bar's 日历 is the month
 * calendar, /f/month), so it has the way back and no bar.
 *
 * Not drawn, because nothing says it: the draft's C2 marks the days before he switched his medicine on as 「没有分享」.
 * The week her link is given has no such date, so an earlier week shows whatever his record holds for it.
 */
import { redirect } from "next/navigation";
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import { ChevronLeft, ChevronRight, ConsentFoot, DayList, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { UiLink } from "@/components/ui/UiLink";
import { logLook } from "@/lib/care/access-log";
import { dayWords, privacyLine } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { dayRows, weekHeadline } from "@/lib/care/her-view";
import { familyWeek, WEEKS_BACK } from "@/lib/care/home";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyWeekPage({ searchParams }: PageProps<"/f/week">) {
  const sp = await searchParams;
  const p = await herPage(sp, "/f/week");
  const { ctx, link, locale, dad, tz, paths } = p;
  const { items: grants, version } = await herSwitches(ctx.store, ctx.session, link.id);
  if (!grants.dose_summary) redirect(paths.home);
  const now = nowMs();
  const offset = Math.max(-WEEKS_BACK, Math.min(0, Number(typeof sp.offset === "string" ? sp.offset : 0) || 0));
  const week = await familyWeek(ctx.store, ctx.session, now, offset);
  await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/week", items: ["dose_summary"] }, now);
  // today's reminder moments (he shares his medicine here): the page reads itself again as each passes, and at his midnight
  const moments = week.days.find((d) => d.isToday)?.slots.flatMap((s) => [s.first, s.second, s.closes]) ?? [];
  const range = hc(locale, "weekRange", { from: dayWords(week.fromDate, locale), to: dayWords(week.toDate, locale) });
  const weekAt = (o: number) => (o === 0 ? paths.week : `${paths.week}&offset=${o}`);
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, now, moments)} />
      <div className="contents" data-testid="family-week" data-offset={offset}>
        <FamilyScreen locale={locale}>
          {/* reached from the week strip on her home, so the top is the way back there. Not a place of her bottom bar:
              the bar's 日历 is the month calendar (/f/month; owner 10-14: 「周和主页重复了」) */}
          <FamilyTop back={{ href: paths.home, label: offset === 0 ? hc(locale, "weekLabel") : range, sub: offset === 0 ? range : undefined }} locale={locale} langHref={p.langHref} />
          {/* gone from the page the moment he switches his medicine off; the server then sends her back to her home */}
          <WhileShared grant="dose_summary">
            <FamilyHero tone="quiet" title={weekHeadline(week, locale, offset === 0)} detail={hc(locale, "weekSub")} />
            <nav className="rpf rpf-weeknav" aria-label={hc(locale, "weekLabel")}>
              {offset > -WEEKS_BACK ? (
                <UiLink href={weekAt(offset - 1)} data-testid="week-earlier">
                  <ChevronLeft />
                  {hc(locale, "weekPrev")}
                </UiLink>
              ) : (
                <span aria-disabled="true" data-testid="week-earlier-off">
                  <ChevronLeft />
                  {hc(locale, "weekPrev")}
                </span>
              )}
              {/* 「回到这一周」 only on an earlier week (as before the relay): it goes to this week, not one week on */}
              {offset < 0 && (
                <UiLink href={weekAt(0)} data-testid="week-this">
                  {hc(locale, "weekNext")}
                  <ChevronRight />
                </UiLink>
              )}
            </nav>
            <DayList rows={dayRows(week, locale, tz)} />
          </WhileShared>
          <FamilyDock style={{ gap: 0 }}>
            <ConsentFoot href={paths.shared} data-testid="open-shared" style={{ margin: "0 0 4px" }}>
              {privacyLine(dad, grants, locale)}
            </ConsentFoot>
          </FamilyDock>
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
