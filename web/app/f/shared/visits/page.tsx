/**
 * /f/shared/visits?link= — his visit records (the fe-d track; the v3 draft's F3, and F6 while he does not share
 * them): 「爸爸的看诊记录。」, the line that says he agreed to show them, then one row per visit that happened, newest
 * first: the date over its weekday, what kind of visit it was over where, and the way in. Through her active link (else
 * back to /f). The list leaves the page the moment he switches his visit records off; the server then says so (F6).
 *
 * Not drawn, because the data is not there: the draft's first row, a visit still to come (「还没到」).
 */
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import { NotShared } from "@/components/family/HerShared";
import { ReconsentLine } from "@/components/family/Reconsent";
import { AgreedRow, ChevronRight, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { UiLink } from "@/components/ui/UiLink";
import { logLook } from "@/lib/care/access-log";
import { dayWords } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { weekdayOf } from "@/lib/care/her-view";
import { visitKindWords } from "@/lib/care/visit-words";
import { sharedVisits } from "@/lib/care/shared";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

export default async function FamilyVisitsPage({ searchParams }: PageProps<"/f/shared/visits">) {
  const p = await herPage(await searchParams, "/f/shared/visits");
  const { ctx, link, locale, dad, paths } = p;
  const { items, version } = await herSwitches(ctx.store, ctx.session, link.id);
  const now = nowMs();
  const visits = items.visit_transcripts ? await sharedVisits(ctx.store, ctx.session, link.id) : null;
  if (visits) await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/shared/visits", items: ["visit_transcripts"] }, now);
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <DayClock {...herDayClock(ctx.session, now)} />
      <div className="contents" data-testid="family-visits" data-state={visits ? "shown" : "not_shared"}>
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: paths.home, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={p.langHref} />
          {/* the family texts asked again (only add): why his visits are not shown while her link waits for both of them */}
          {p.reconsent && <ReconsentLine locale={locale} dad={dad} />}
          {visits ? (
            // his visits leave the page the moment he switches them off (the server then renders the sentence of F6)
            <WhileShared grant="visit_transcripts">
              <FamilyHero tone="quiet" title={hc(locale, "visitsTitle", { dad })} detail={hc(locale, visits.length ? "visitsSub" : "visitsNone")} />
              <AgreedRow>{hc(locale, "visitsAgreed", { dad })}</AgreedRow>
              <ul className="rpf rpf-visits" data-testid="shared-visits">
                {visits.map((v) => {
                  const kind = visitKindWords(v.kind, locale);
                  return (
                    <li key={v.id}>
                      <UiLink href={paths.visit(v.id)} nav="forward" className="rpf-visit" data-testid="shared-visit">
                        <span>
                          <b>{dayWords(v.date, locale)}</b>
                          <i>{weekdayOf(v.date, locale)}</i>
                        </span>
                        <span>
                          <em>{kind ?? v.place}</em>
                          <i>{[kind ? v.place : "", hc(locale, "visitLines", { n: v.lines.length })].filter(Boolean).join("　")}</i>
                        </span>
                        <ChevronRight />
                      </UiLink>
                    </li>
                  );
                })}
              </ul>
            </WhileShared>
          ) : (
            <NotShared locale={locale} dad={dad} what="visits" homeHref={paths.home} />
          )}
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
