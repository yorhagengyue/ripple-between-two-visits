/**
 * /f/month?link=[&m=YYYY-MM][&d=YYYY-MM-DD] — 「日历」, the second place of her bottom bar (owner 10-14: 「日历页面应该是
 * 一份月份的日历，而周和主页重复了」; laid out as the iOS app's calendar). The top names the place with the month under it;
 * then the row that changes the month (no further back than his first day on Ripple, no further on than this month),
 * the weekday letters from Monday, the grid of days with their markers, a legend that says each marker in words, and
 * under it the chosen day (today, or the day whose cell she tapped) with the records she may see.
 *
 * Owner 10-15 (the demo video): the day she taps also opens as a sheet from the bottom (components/family-ui/
 * MonthDaySheet.tsx; ?d= in the address, so a reload shows it; 「关闭」 goes back to the month): that day's visit with its
 * time and the doctor, his readings (one outside the target his doctor set marked and tinted, with the doctor's numbers,
 * who and when, and what he said happened that day under it while he shares his notes), his medicine, his notes, the
 * questions he added. The same rows stand in the chosen day's part under the legend. A day with a reading outside the
 * target carries a small triangle in the doctor's colour instead of the reading's dot (lib/daily/bp-target.ts: the rule
 * his month and her 「留意」 use), and the legend says it.
 *
 * What is shown is what his switches for her link allow, kind by kind (lib/care/month.ts): his medicine under
 * 「每天吃药了没有」, his readings under the blood-pressure switch, the days of his visits (with where, what kind, the time
 * and the doctor) under the questions switch or the visit-records switch, the questions he added under the questions
 * switch, a visit's confirmed lines and the way to its record under the visit-records switch, his notes and what he said
 * about a reading under the notes switch. A kind whose switch is off is not read and not drawn. Each part leaves the page
 * the moment he switches it off (<WhileShared>), and the server then draws the page again. With none of the four
 * calendar switches on there is no calendar: back to her home, as the week does without his medicine.
 *
 * The week day by day (/f/week) is still reached from the week strip on her home.
 *
 * The long press (owner 10-14: his side's, on hers too): each row under the grid can be held for half a second, and
 * Ripple's read of that record opens through her link, cut by his switches (components/explain/Explainable.tsx): a
 * medicine's row is that part of the day's medicine, a reading's row that reading, a question's row that question, and
 * a visit's row that visit while he shares his visit records (with only the questions switch on, a visit's day is
 * shown and the visit itself is not hers to hold). A day still to come has no record to hold. The day cells stay taps.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DayClock } from "@/components/daily/elder/DayClock";
import { HerLive, WhileShared } from "@/components/family/HerLive";
import {
  BpDot,
  ConsentFoot,
  DayMark,
  FamilyDock,
  FamilyScreen,
  FamilyTabs,
  FamilyTop,
  MonthDayPanel,
  MonthGrid,
  MonthLegend,
  MonthLegendItem,
  MonthNav,
  MonthRow,
  VisitRing,
  familyTabHrefs,
  type MarkKind,
  type MonthGridCell,
} from "@/components/family-ui";
import { MonthDaySheet } from "@/components/family-ui/MonthDaySheet";
import { OutsideMark } from "@/components/family-ui/MonthGrid";
import { logLook } from "@/lib/care/access-log";
import { dateLine, privacyLine, weekdayShort } from "@/lib/care/copy";
import { herDayClock, herPage, herSwitches } from "@/lib/care/her-page";
import { quoted } from "@/lib/care/her-view";
import type { CellMark, DayMark as DayMarkKind } from "@/lib/care/home-types";
import { familyMonth, monthPath, monthShown, type MonthDay, type MonthTarget } from "@/lib/care/month";
import { doseRef, type HoldSubject } from "@/lib/explain/subjects";
import { linesWords, mc, monthWords, reasonWords, slotWord, stateWord, type MonthKey } from "@/lib/care/month-copy";
import { dayWords as shortDate } from "@/lib/care/copy";
import { hmIn } from "@/lib/care/time";
import { visitKindWords } from "@/lib/care/visit-words";
import { doctorWords } from "@/lib/daily/visit-details";
import type { Locale } from "@/lib/i18n";
import { nowMs } from "@/lib/time/now";
import { familyCopy } from "@/lib/ui/copy";

export const dynamic = "force-dynamic";

/** Monday first, as her week strip (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** The medicine marks the grid draws. A day with nothing to record ("none") draws no marker: its number is dimmed. */
const DOSE_MARKS: readonly Exclude<DayMarkKind, "none">[] = ["taken", "missed", "no_reply", "pending"];
/** One medicine's answer as her marks draw it; a cell from before he used Ripple is the short dash. */
const ROW_MARK: Record<CellMark, MarkKind> = { taken: "taken", missed: "missed", no_reply: "no_reply", waiting: "waiting", pending: "pending", untracked: "none" };
const ROW_TONE: Partial<Record<CellMark, "warn" | "quiet">> = { missed: "warn", no_reply: "warn", waiting: "quiet", pending: "quiet", untracked: "quiet" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** 「高于林医生设定的目标 135/85（9月3日）」 / "Above the target Dr Lim set: 135/85 (3 Sep)". */
function aboveWords(target: MonthTarget, locale: Locale): string {
  return mc(locale, "bpAbove", { doctor: doctorWords(target.doctor, locale, "short") ?? mc(locale, "theDoctor"), target: `${target.systolic}/${target.diastolic}`, date: shortDate(target.date, locale) });
}

// typed by hand: the generated PageProps<"/f/month"> knows a route only after `next typegen` has seen its folder
export default async function FamilyMonthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = await herPage(sp, "/f/month");
  const { ctx, link, locale, dad, tz, paths } = p;
  const { items: grants, version } = await herSwitches(ctx.store, ctx.session, link.id);
  const shown = monthShown(grants);
  if (!shown.length) redirect(paths.home);
  const now = nowMs();
  // the month, and her look: the row names the switches whose records this page shows
  const [month] = await Promise.all([
    familyMonth(ctx.store, ctx.session, grants, { m: one(sp.m), d: one(sp.d) }, now),
    logLook(ctx.store, ctx.session.id, { linkId: link.id, userId: p.userId, label: link.family_label, route: "/f/month", items: shown }, now),
  ]);
  const { day } = month;
  const visitsOn = grants.questions_count || grants.visit_transcripts;
  // his visits' days ride on either switch: with one on, the part leaves with it; with both on it stays while one is left
  const whileVisits = (node: ReactNode) => (grants.questions_count && grants.visit_transcripts ? node : <WhileShared grant={grants.visit_transcripts ? "visit_transcripts" : "questions_count"}>{node}</WhileShared>);
  const at = (ym: string) => monthPath(link.id, ym === month.today.slice(0, 7) ? null : ym);
  const todayWord = mc(locale, "today");
  /** a row that can be held: the record it stands for, through her link */
  const hold = (subject: HoldSubject, label: string) => ({ subject, link: link.id, locale, label });
  // owner 10-15: the day named in the address opens as a sheet (and stays the chosen day under the grid)
  const opened = one(sp.d) === day.date ? day.date : null;
  const anyAbove = month.cells.some((c) => c.bpAbove);

  const cells: MonthGridCell[] = month.cells.map((c) => {
    const dose = c.dose && c.dose !== "none" ? c.dose : null;
    return {
      date: c.date,
      dom: c.dom,
      href: monthPath(link.id, month.isCurrent ? null : month.ym, c.date),
      label: c.isToday ? `${dateLine(c.date, locale)} ${todayWord}` : dateLine(c.date, locale),
      isToday: c.isToday,
      future: c.future,
      chosen: c.date === day.date,
      // a record of his on that day (an answer or a window that closed, a reading, a visit that happened)
      has: !c.future && ((!!dose && dose !== "pending") || c.bp || c.visit === "past"),
      markers: (
        <>
          {dose && (
            <WhileShared grant="dose_summary">
              <DayMark mark={dose} size={18} today={c.isToday} label={mc(locale, `lg_${dose}` as MonthKey)} />
            </WhileShared>
          )}
          {c.bp && (
            <WhileShared grant="bp_summary">
              {/* owner 10-15: outside the target his doctor set, the triangle in the reading dot's place */}
              {c.bpAbove ? <OutsideMark label={mc(locale, "lg_bpAbove")} data-month-above="" /> : <BpDot label={mc(locale, "lg_bp")} />}
            </WhileShared>
          )}
          {c.visit && whileVisits(<VisitRing label={mc(locale, c.visit === "planned" ? "visitPlanned" : "lg_visit")} data-month-visit="" />)}
        </>
      ),
    };
  });

  /** The records of one day as rows, each part inside its switch's <WhileShared> (the chosen day under the grid, the sheet). */
  const dayRows = (d: MonthDay): ReactNode => (
    <>
      {d.visits &&
        d.visits.length > 0 &&
        whileVisits(
          d.visits.map((v) => {
            // where and what kind go with the day, with the time and the doctor (owner 10-15); the confirmed lines and the
            // way to the record only while he shares his visit records (with the questions switch on too the row stays
            // when that one goes off: that line leaves)
            const where = [v.time, visitKindWords(v.kind, locale), v.place].filter(Boolean).join("　");
            const doctor = doctorWords(v.doctor, locale);
            const lines = v.lines !== null ? linesWords(v.lines, dad, locale) : "";
            return (
              <MonthRow
                key={v.id}
                kind="visit"
                explainRef={v.id}
                mark={<VisitRing />}
                title={mc(locale, v.state === "planned" ? "visitPlanned" : "visitPast")}
                sub={[where, doctor ? <span key="doctor" data-testid="month-visit-doctor">{doctor}</span> : "", lines && grants.questions_count ? <WhileShared key="lines" grant="visit_transcripts">{lines}</WhileShared> : lines].filter(Boolean)}
                href={v.open ? paths.visit(v.id) : undefined}
                data-state={v.state}
                data-time={v.time ?? undefined}
                data-month-visit=""
                // the visit itself is his visit records' (with the questions switch alone, only its day is shown)
                hold={grants.visit_transcripts ? hold({ type: "visit", ref: v.id }, `${dateLine(d.date, locale)} ${mc(locale, v.state === "planned" ? "visitPlanned" : "visitPast")}`) : undefined}
              />
            );
          }),
        )}
      {d.bp && d.bp.length > 0 && (
        <WhileShared grant="bp_summary">
          {d.bp.map((r) => {
            const above = r.above && !!month.target;
            return (
              <MonthRow
                key={r.id}
                kind="bp"
                explainRef={r.id}
                mark={above ? <OutsideMark /> : <BpDot />}
                title={mc(locale, "bp")}
                sub={[
                  [r.at ? hmIn(r.at, tz) : slotWord(r.slot, locale), r.pulse !== null ? mc(locale, "pulse", { n: r.pulse }) : ""].filter(Boolean).join("　"),
                  above ? (
                    <span key="above" className="rpf-month-above" data-testid="month-bp-above">
                      {aboveWords(month.target!, locale)}
                    </span>
                  ) : (
                    ""
                  ),
                  // what he said happened that day: his words, while he shares his notes
                  r.reason ? (
                    <WhileShared key="reason" grant="notes">
                      <span className="rpf-month-reason" data-testid="month-bp-reason" lang={r.reason.lang ?? undefined}>
                        {mc(locale, "bpReason", { dad, words: r.reason.text })}
                      </span>
                    </WhileShared>
                  ) : (
                    ""
                  ),
                ].filter(Boolean)}
                value={`${r.systolic}/${r.diastolic}`}
                tone={above ? "outside" : undefined}
                data-outside={above ? "true" : undefined}
                hold={hold({ type: "bp", ref: r.id }, `${mc(locale, "bp")} ${r.systolic}/${r.diastolic}`)}
              />
            );
          })}
        </WhileShared>
      )}
      {d.doses && d.doses.length > 0 && (
        <WhileShared grant="dose_summary">
          {d.doses.map((x) => {
            const time = x.at ? hmIn(x.at, tz) : "";
            const why = reasonWords(x.reason, locale);
            return (
              <MonthRow
                key={x.ref}
                kind="dose"
                explainRef={x.ref}
                mark={<DayMark mark={ROW_MARK[x.mark]} size={22} />}
                title={x.strength ? `${x.name} ${x.strength}` : x.name}
                sub={why ? [slotWord(x.slot, locale), why] : [slotWord(x.slot, locale)]}
                value={time ? `${stateWord(x.mark, locale)} ${time}` : stateWord(x.mark, locale)}
                tone={ROW_TONE[x.mark]}
                data-mark={x.mark}
                // that part of the day's medicine (a day still to come has no record yet)
                hold={d.future ? undefined : hold({ type: "dose", ref: doseRef(d.date, x.slot) }, `${dateLine(d.date, locale)} ${slotWord(x.slot, locale)}`)}
              />
            );
          })}
        </WhileShared>
      )}
      {d.notes && d.notes.length > 0 && (
        <WhileShared grant="notes">
          {d.notes.map((n) => (
            <MonthRow
              key={n.id}
              kind="note"
              explainRef={n.id}
              mark={<i className="rpf-month-dash" />}
              title={quoted(n.text, locale)}
              lang={n.lang ?? undefined}
              sub={[[mc(locale, "noteSub", { dad }), hmIn(n.at, tz)].filter(Boolean).join("　")]}
            />
          ))}
        </WhileShared>
      )}
      {d.questions && d.questions.length > 0 && (
        <WhileShared grant="questions_count">
          {d.questions.map((q) => (
            <MonthRow
              key={q.id}
              kind="question"
              explainRef={q.id}
              mark={<i className="rpf-month-dash" />}
              title={quoted(q.text, locale)}
              lang={q.lang ?? undefined}
              sub={[[mc(locale, q.for === "pharmacist" ? "askPharmacist" : "askDoctor"), q.origin === "reading" ? mc(locale, "fromReading") : ""].filter(Boolean).join("　")]}
              data-origin={q.origin}
              hold={hold({ type: "question", ref: q.id }, q.text)}
            />
          ))}
        </WhileShared>
      )}
    </>
  );

  const nothing = !(day.doses?.length || day.bp?.length || day.visits?.length || day.questions?.length || day.notes?.length);
  const empty = nothing ? mc(locale, "dayEmpty", { dad }) : undefined;
  return (
    <HerLive linkId={link.id} since={ctx.since} version={version} locale={locale} dad={dad} langHref={p.langHref}>
      {/* today's reminder moments (when his medicine is on this page): the page reads itself again as each passes, and at his midnight */}
      <DayClock {...herDayClock(ctx.session, now, month.moments)} />
      <div className="contents" data-testid="family-month" data-month={month.ym} data-day={day.date}>
        <FamilyScreen locale={locale} tabs={<FamilyTabs locale={locale} active="week" hrefs={familyTabHrefs(paths)} />}>
          {/* a place of her bottom bar: the top names it (the bar's own word) and says which month */}
          <FamilyTop title={familyCopy(locale, dad).tabs.week} kicker={monthWords(month.ym, locale)} locale={locale} langHref={p.langHref} />
          <MonthNav
            label={mc(locale, "navLabel")}
            prev={{ href: month.prev ? at(month.prev) : undefined, label: mc(locale, "prev") }}
            today={month.isCurrent ? undefined : { href: monthPath(link.id), label: todayWord }}
            next={{ href: month.next ? at(month.next) : undefined, label: mc(locale, "next") }}
          />
          <MonthGrid label={monthWords(month.ym, locale)} weekdays={WEEK.map((i) => weekdayShort(i, locale))} lead={month.lead} cells={cells} />

          <MonthLegend label={mc(locale, "legendLabel")}>
            {grants.dose_summary && (
              <WhileShared grant="dose_summary">
                {DOSE_MARKS.map((m) => (
                  <MonthLegendItem key={m} mark={<DayMark mark={m} size={20} />} data-legend={m}>
                    {mc(locale, `lg_${m}` as MonthKey)}
                  </MonthLegendItem>
                ))}
              </WhileShared>
            )}
            {grants.bp_summary && (
              <WhileShared grant="bp_summary">
                <MonthLegendItem mark={<BpDot />} data-legend="bp">
                  {mc(locale, "lg_bp")}
                </MonthLegendItem>
                {anyAbove ? (
                  <MonthLegendItem mark={<OutsideMark />} data-legend="bp-above">
                    {mc(locale, "lg_bpAbove")}
                  </MonthLegendItem>
                ) : null}
              </WhileShared>
            )}
            {visitsOn &&
              whileVisits(
                <MonthLegendItem mark={<VisitRing />} data-legend="visit" data-month-visit="">
                  {mc(locale, "lg_visit")}
                </MonthLegendItem>,
              )}
          </MonthLegend>

          <MonthDayPanel title={dateLine(day.date, locale)} today={day.isToday ? todayWord : undefined} empty={empty}>
            {dayRows(day)}
          </MonthDayPanel>

          <FamilyDock style={{ gap: 0 }}>
            <ConsentFoot href={paths.shared} data-testid="open-shared" style={{ margin: "0 0 4px" }}>
              {privacyLine(dad, grants, locale)}
            </ConsentFoot>
          </FamilyDock>
        </FamilyScreen>
        {/* owner 10-15: the day she tapped, as a sheet over the calendar; 「关闭」 back to the month */}
        {opened ? (
          <MonthDaySheet
            key={opened}
            date={opened}
            title={dateLine(day.date, locale)}
            today={day.isToday ? todayWord : undefined}
            closeHref={monthPath(link.id, month.isCurrent ? null : month.ym)}
            closeLabel={mc(locale, "close")}
          >
            {empty ? (
              <p className="rpf-month-none" data-testid="month-sheet-empty">
                {empty}
              </p>
            ) : (
              <ul className="rpf-month-rows" data-testid="month-sheet-rows">
                {dayRows(day)}
              </ul>
            )}
          </MonthDaySheet>
        ) : null}
      </div>
    </HerLive>
  );
}
