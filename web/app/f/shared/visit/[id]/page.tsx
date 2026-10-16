/**
 * /f/shared/visit/[id]?link= — one visit he shares (C2 track D; relaid to the v3 draft's F4 by the fe-d track; F6
 * while he does not share his visit records): the way back to the list, the date and what kind of visit it was, its
 * weekday and the place, the line that says he agreed to show it, and the clinicians' words he confirmed, one by one:
 * who and the time point with 「听原声」 at the right, the words as said behind a thin rule and, when the translation
 * passed both checks, the Chinese under them. The page says once that the Chinese follows the English.
 *
 * Scene 1 (owner 10-15): Ripple's summary of the visit sits at the top, once it is made (the same notes his review
 * shows first: Ripple's words, not confirmed; a tap shows them large).
 *
 * Not drawn, because the data is not there: the doctor's name (a line knows only who spoke: doctor, counter,
 * pharmacist).
 */
import { ClipButton } from "@/components/family/HerBits";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import { NotShared } from "@/components/family/HerShared";
import { ReconsentLine } from "@/components/family/Reconsent";
import { AgreedRow, EmptyBlock, FamilyButton, FamilyDock, FamilyNote, FamilyScreen, FamilyTop, Quote } from "@/components/family-ui";
import { logLook } from "@/lib/care/access-log";
import { dayWords } from "@/lib/care/copy";
import { hc, type HerKey } from "@/lib/care/her-copy";
import { herPage, herSwitches } from "@/lib/care/her-page";
import { quoted, weekdayOf } from "@/lib/care/her-view";
import { visitKindWords } from "@/lib/care/visit-words";
import { sharedVisits } from "@/lib/care/shared";
// scene 1 (owner 10-15): Ripple's summary at the top of the record
import { SummaryFocus } from "@/components/visit/SummaryFocus";
import { storedSummary } from "@/lib/visit/summary-item";
import "@/components/family/live-visit.css";
import { nowMs } from "@/lib/time/now";

export const dynamic = "force-dynamic";

// whole seconds, cut, never rounded: the rule tests/unit/ui/clip-time.test.ts holds for every time point
const at = (ms: number | null) => (ms === null ? "" : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`);

export default async function FamilyVisitPage({ params, searchParams }: PageProps<"/f/shared/visit/[id]">) {
  const { id } = await params;
  const p = await herPage(await searchParams, `/f/shared/visit/${id}`);
  const { ctx, link, locale, dad, paths } = p;
  const zh = locale === "zh-Hans";
  const { items, version } = await herSwitches(ctx.store, ctx.session, link.id);
  if (!items.visit_transcripts) {
    return (
      <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
        <div className="contents" data-testid="family-visit" data-state="not_shared">
          <FamilyScreen locale={locale}>
            <FamilyTop back={{ href: paths.home, label: hc(locale, "dadToday", { dad }) }} locale={locale} langHref={p.langHref} />
            {/* the family texts asked again (only add): why while her link waits for both of them */}
            {p.reconsent && <ReconsentLine locale={locale} dad={dad} />}
            <NotShared locale={locale} dad={dad} what="visits" homeHref={paths.home} />
          </FamilyScreen>
        </div>
      </HerLive>
    );
  }
  const visit = (await sharedVisits(ctx.store, ctx.session, link.id)).find((v) => v.id === decodeURIComponent(id));
  // scene 1 (owner 10-15): Ripple's summary of the visit at the top of its record, as on his review, once it is made
  const summary = visit ? storedSummary(await ctx.store.listVisitItems(ctx.session.id, { visit_id: visit.id }), visit.id) : null;
  await logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/shared/visit", items: ["visit_transcripts"] }, nowMs());
  const kind = visit ? visitKindWords(visit.kind, locale) : null;
  const what = visit ? (kind ?? visit.place) : "";
  const day = visit ? dayWords(visit.date, locale) : "";
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      <div className="contents" data-testid="family-visit" data-state={visit ? "shown" : "missing"}>
        <FamilyScreen locale={locale}>
          <FamilyTop back={{ href: paths.visits, label: hc(locale, "visitsBack") }} locale={locale} langHref={p.langHref} />
          {visit ? (
            // the doctor's words leave the page the moment he switches his visit records off (the server then says so)
            <WhileShared grant="visit_transcripts">
              <h1 className="rpf rpf-h1" data-testid="family-headline" style={{ marginTop: 16 }}>
                {what ? (zh ? `${day}，${what}。` : `${day}: ${what}.`) : zh ? `${day}。` : `${day}.`}
              </h1>
              <p className="rpf rpf-sub" style={{ marginTop: 8 }} data-testid="family-lede">
                {[weekdayOf(visit.date, locale), kind ? visit.place : ""].filter(Boolean).join("　")}
              </p>
              <AgreedRow style={{ marginTop: 14 }}>{hc(locale, "visitsAgreed", { dad })}</AgreedRow>
              {summary ? (
                <section className="rpfl-section" data-testid="family-visit-summary" data-points={summary.points.length}>
                  <SummaryFocus
                    variant="family"
                    title={hc(locale, "visitSummary")}
                    note={hc(locale, "visitSummaryNote")}
                    points={summary.points.map((pt) => pt.text)}
                    lang={summary.lang}
                    openLabel={hc(locale, "liveSummaryOpen")}
                    testId="family-visit-summary"
                  >
                    <div className="rpf rpfl-summary">
                      <p className="rpfl-summary-title">{hc(locale, "visitSummary")}</p>
                      <ul className="rpfl-points" lang={summary.lang}>
                        {summary.points.map((pt, i) => (
                          <li key={`${i}-${pt.text}`} data-testid="family-visit-summary-point">
                            {pt.text}
                          </li>
                        ))}
                      </ul>
                      <p className="rpf rpf-note">{hc(locale, "visitSummaryNote")}</p>
                    </div>
                  </SummaryFocus>
                </section>
              ) : null}
              {visit.lines.length ? (
                <>
                  {zh && visit.lines.some((l) => l.zh) && (
                    <p className="rpf rpf-label" style={{ margin: "12px 0 0" }} data-testid="visit-translated">
                      {hc(locale, "translated")}
                    </p>
                  )}
                  {visit.lines.map((l) => (
                    <Quote
                      key={l.id}
                      who={`${hc(locale, `speaker_${l.speaker}` as HerKey)}${l.tStartMs !== null ? `　${at(l.tStartMs)}` : ""}`}
                      action={l.clipUrl ? <ClipButton url={l.clipUrl} locale={locale} standIn={l.standIn} /> : undefined}
                      words={quoted(l.text, locale)}
                      lang={l.lang ?? undefined}
                      zh={zh && l.zh ? `「${l.zh}」` : null}
                      data-testid="visit-line"
                    />
                  ))}
                </>
              ) : (
                <p className="rpf rpf-sub" style={{ marginTop: 20 }}>
                  {hc(locale, "visitNoLines")}
                </p>
              )}
              {/* what this page lists, as it always said */}
              <FamilyNote style={{ marginTop: 24 }}>{hc(locale, "visitOnly", { dad })}</FamilyNote>
            </WhileShared>
          ) : (
            <>
              <EmptyBlock title={hc(locale, "visitMissing")} />
              <FamilyDock foot="e">
                <FamilyButton href={paths.visits} nav="back" variant="secondary" data-testid="visit-missing-back">
                  {hc(locale, "visitsBack")}
                </FamilyButton>
              </FamilyDock>
            </>
          )}
        </FamilyScreen>
      </div>
    </HerLive>
  );
}
