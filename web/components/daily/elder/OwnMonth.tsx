import Link from "next/link";
import { Explainable } from "@/components/explain/Explainable";
import { ORIGIN_WORDS } from "@/components/ui/QuestionRow";
import { Icon } from "@/components/ui/icons";
import { ListCard } from "@/components/ui/List";
import { weekdayShort } from "@/lib/care/copy";
import type { CellMark, DayMark } from "@/lib/care/home-types";
import type { MonthBp, MonthCell, MonthDose, MonthNote, MonthQuestion, MonthTarget, MonthView, MonthVisit } from "@/lib/care/month";
import { monthWords } from "@/lib/care/month-copy";
import { visitKindWords } from "@/lib/care/visit-words";
import { dc } from "@/lib/daily/day-copy";
import { clockWords, dateWords, dt, shortDay, shortTime, type DailyKey } from "@/lib/daily/i18n";
import { doctorWords } from "@/lib/daily/visit-details";
import { doseRef } from "@/lib/explain/subjects";
import type { Locale } from "@/lib/i18n";
import { uiOrigin } from "@/lib/profile/copy";
import { localHHMM } from "@/lib/time/clock";
import { OwnDaySheet } from "./OwnDaySheet";
import "./month.css";

/**
 * His month at the top of Today (owner 10-14), drawn from his own records (lib/daily/month.ts ownMonth): the month's
 * name, the weekday letters from Monday, a grid of days, a legend in words. Presentational, no state: a day is opened by
 * following its link (/p/today?d=…, today's too), so the page is the same on a reload. Each day is marked as her month
 * marks it (components/family-ui/MonthGrid.tsx, lib/care/month.ts), in his light theme (month.css):
 *
 *   the day's doses    all taken (a teal disc with a tick), one not taken (an amber ring), a reminder with no
 *                      response (an amber ring with a bell), not yet (a dashed ring); a day with nothing to record, and
 *                      a day still to come, has no mark and its number is dimmed
 *   a reading outside  (owner 10-15) a reading that day outside the target his doctor set: a small upward triangle in
 *   the target         the doctor's colour beside the dose mark (lib/daily/bp-target.ts, the rule her month uses)
 *   a visit day        its number in red: on a red disc when the visit happened, in a red ring when it is planned
 *   today              outlined in ink; the day whose sheet is open is tinted
 * Shape as well as colour, and every mark has its words: in the legend (only the marks this month has) and in each
 * day's words for a screen reader (「10月3日 周六 全部已服药 就诊」). No word judges a day.
 *
 * The day he taps (owner 10-15: every day, today too) opens as a sheet from the bottom over Today (`OwnDay`,
 * components/daily/elder/OwnDaySheet.tsx): its visit with the time and the doctor, each reading (one outside the
 * target with the doctor's numbers, who and when, and what he said happened that day under it), each medicine with
 * his answer, his notes, and the questions added to his list that day.
 *
 * Test hooks: own-month (data-month), own-month-day-<date> (data-today, data-chosen, data-visit, data-mark, data-has,
 * data-outside), own-month-legend with [data-legend], own-day (data-date) with own-day-visit (data-state), own-day-bp
 * (data-outside), own-day-reason, own-day-dose (data-mark), own-day-note, own-day-question (data-origin), own-day-close,
 * own-day-today (the way back), own-day-empty.
 */

/** Monday first, as her month (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

type DoseDayMark = Exclude<DayMark, "none">;
/** The day marks in the legend's order. */
const DAY_MARKS: readonly DoseDayMark[] = ["taken", "missed", "no_reply", "pending"];
const DAY_WORDS: Record<DoseDayMark, DailyKey> = {
  taken: "today.month.taken",
  missed: "today.month.missed",
  no_reply: "today.month.noReply",
  pending: "today.month.pending",
};
const VISIT_WORDS: Record<MonthVisit["state"], DailyKey> = { past: "today.month.visit", planned: "today.month.planned" };
/** One medicine's answer on the chosen day, in words. */
const STATE_WORDS: Record<CellMark, DailyKey> = {
  taken: "today.month.st.taken",
  missed: "today.month.st.missed",
  no_reply: "today.month.st.noReply",
  waiting: "today.month.st.waiting",
  pending: "today.month.st.pending",
  untracked: "today.month.st.untracked",
};

/** The address that opens a day's sheet (today's too: owner 10-15, every day can be opened). */
export function ownDayHref(date: string): string {
  return `/p/today?d=${date}`;
}

type MarkKind = CellMark | "visit" | "planned" | "outside" | "reading";

/** One mark: shape and colour (month.css), said in words only where `label` is given (else the words beside it say it). */
export function MonthMark({ mark, size, label }: { mark: MarkKind; size?: "row" | "legend"; label?: string }) {
  return (
    <span className="rpu-month-mark" data-mark={mark} data-size={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {mark === "taken" ? <Icon name="check" stroke={3.4} /> : mark === "no_reply" ? <Icon name="bell" stroke={2.8} /> : null}
    </span>
  );
}

/** The grid's marks for one day: its doses' mark (none on a day with nothing to record). */
function cellMark(c: MonthCell): DoseDayMark | null {
  return c.dose && c.dose !== "none" ? c.dose : null;
}

/** His month: its name, the weekday letters, the days, and the legend of the marks this month has. */
export function OwnMonth({ month, locale }: { month: MonthView; locale: Locale }) {
  const today = dt(locale, "today.month.today");
  const marks = new Set(month.cells.map(cellMark).filter((m): m is DoseDayMark => m !== null));
  const visits = new Set(month.cells.map((c) => c.visit).filter((v): v is MonthVisit["state"] => v !== null));
  const outside = month.cells.some((c) => c.bpAbove);
  const title = monthWords(month.ym, locale);
  return (
    <section className="rpu rpu-month" data-rp="own-month" data-testid="own-month" data-month={month.ym} aria-label={title}>
      <h2 className="rpu-month-title">{title}</h2>
      <div className="rpu-month-wd" aria-hidden="true">
        {WEEK.map((i) => (
          <span key={i}>{weekdayShort(i, locale)}</span>
        ))}
      </div>
      <ol className="rpu-month-grid" aria-label={title}>
        {Array.from({ length: month.lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden="true" />
        ))}
        {month.cells.map((c) => {
          const mark = cellMark(c);
          const chosen = c.date === month.day.date;
          const words = [
            dateWords(locale, c.date),
            c.isToday ? today : "",
            c.visit ? dt(locale, VISIT_WORDS[c.visit]) : "",
            mark ? dt(locale, DAY_WORDS[mark]) : "",
            c.bpAbove ? dc(locale, "cellOutside") : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={c.date}>
              {/* the grid stays where it is while the day's sheet opens over the page; a day is read only when it is opened */}
              <Link
                href={ownDayHref(c.date)}
                replace
                scroll={false}
                prefetch={false}
                className="rpu-month-cell"
                aria-current={chosen ? "true" : undefined}
                data-today={c.isToday ? "true" : undefined}
                data-future={c.future ? "true" : undefined}
                data-chosen={chosen ? "true" : undefined}
                data-has={!c.future && ((!!mark && mark !== "pending") || c.visit === "past" || c.bpAbove) ? "true" : undefined}
                data-visit={c.visit ?? undefined}
                data-mark={mark ?? undefined}
                data-outside={c.bpAbove ? "true" : undefined}
                data-testid={`own-month-day-${c.date}`}
              >
                <span className="rpu-month-num" aria-hidden="true">
                  {c.dom}
                </span>
                <span className="rpu-month-sr">{words}</span>
                <span className="rpu-month-marks" aria-hidden="true">
                  {mark ? <MonthMark mark={mark} /> : null}
                  {c.bpAbove ? <MonthMark mark="outside" /> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {marks.size || visits.size || outside ? (
        <ul className="rpu-month-legend" data-testid="own-month-legend" aria-label={dt(locale, "today.month.legend")}>
          {DAY_MARKS.filter((m) => marks.has(m)).map((m) => (
            <li key={m} data-legend={m}>
              <MonthMark mark={m} size="legend" />
              <span>{dt(locale, DAY_WORDS[m])}</span>
            </li>
          ))}
          {outside ? (
            <li data-legend="outside">
              <MonthMark mark="outside" size="legend" />
              <span>{dc(locale, "legendOutside")}</span>
            </li>
          ) : null}
          {(["past", "planned"] as const)
            .filter((v) => visits.has(v))
            .map((v) => (
              <li key={v} data-legend={v === "past" ? "visit" : "planned"}>
                <MonthMark mark={v === "past" ? "visit" : "planned"} size="legend" />
                <span>{dt(locale, VISIT_WORDS[v])}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}

/** His time zone's clock time of an instant, as his screens say it (「早上 10:05」 / "10:05 am"). */
const timeOf = (iso: string | null, locale: Locale, tz: string) => (iso ? clockWords(locale, localHHMM(Date.parse(iso), tz)) : "");

/** A medicine's line on the chosen day: its name, the part of the day and his reason, his answer and when he tapped. */
function DoseRow({ d, date, future, locale, tz }: { d: MonthDose; date: string; future: boolean; locale: Locale; tz: string }) {
  const name = d.strength ? `${d.name} ${d.strength}` : d.name;
  const part = dt(locale, `slot.${d.slot}` as DailyKey);
  const state = dt(locale, STATE_WORDS[d.mark]);
  const time = d.at ? shortTime(localHHMM(Date.parse(d.at), tz)) : "";
  const row = (
    <div className="rpu-li" data-rp="list-item" data-testid="own-day-dose" data-mark={d.mark} data-slot={d.slot}>
      <MonthMark mark={d.mark} size="row" />
      <span className="rpu-li-main">
        <span className="rpu-li-t" translate="no">
          {name}
        </span>
        <span className="rpu-li-s">{[part, d.reason ? dt(locale, "dose.reason.saved", { reason: d.reason }) : ""].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="rpu-li-r">{time ? `${state} ${time}` : state}</span>
    </div>
  );
  // that part of the day's medicine can be held for Ripple's read of it; a day still to come has no record yet
  return future ? (
    row
  ) : (
    <Explainable as="row" subject={{ type: "dose", ref: doseRef(date, d.slot) }} locale={locale} label={`${dateWords(locale, date)} ${dt(locale, `slotMed.${d.slot}` as DailyKey)}`}>
      {row}
    </Explainable>
  );
}

/** A visit of the chosen day: planned or held, at what time, its kind and place, and the doctor (owner 10-15). */
function VisitRow({ v, date, locale }: { v: MonthVisit; date: string; locale: Locale }) {
  const title = [dt(locale, VISIT_WORDS[v.state]), v.time ? clockWords(locale, v.time) : ""].filter(Boolean).join(" · ");
  const where = [visitKindWords(v.kind, locale), v.place].filter(Boolean).join(" · ");
  const doctor = doctorWords(v.doctor, locale);
  return (
    <Explainable as="row" subject={{ type: "visit", ref: v.id }} locale={locale} label={`${dateWords(locale, date)} ${title}`}>
      <div className="rpu-li" data-rp="list-item" data-testid="own-day-visit" data-state={v.state} data-time={v.time ?? undefined}>
        <MonthMark mark={v.state === "past" ? "visit" : "planned"} size="row" />
        <span className="rpu-li-main">
          <span className="rpu-li-t">{title}</span>
          {where ? <span className="rpu-li-s">{where}</span> : null}
          {doctor ? (
            <span className="rpu-li-s" data-testid="own-day-doctor">
              {doctor}
            </span>
          ) : null}
        </span>
      </div>
    </Explainable>
  );
}

/** The words under a reading outside the target: 「超出了林医生定的目标：135/85（9月3日）」. */
export function outsideWords(target: MonthTarget, locale: Locale): string {
  return dc(locale, "outsideLine", {
    doctor: doctorWords(target.doctor, locale, "short") ?? dc(locale, "yourDoctor"),
    target: `${target.systolic}/${target.diastolic}`,
    date: shortDay(locale, target.date),
  });
}

/** A reading of the chosen day; one outside the target is marked, says so, and has what he said that day under it. */
function BpRow({ r, target, locale, tz }: { r: MonthBp; target: MonthTarget | null; locale: Locale; tz: string }) {
  const outside = r.above && !!target;
  const sub = [timeOf(r.at, locale, tz) || dt(locale, `bp.slot.${r.slot}` as DailyKey), r.pulse !== null ? dc(locale, "pulse", { n: r.pulse }) : ""].filter(Boolean).join(" · ");
  const lang = r.reason?.lang ?? undefined;
  return (
    <Explainable as="row" subject={{ type: "bp", ref: r.id }} locale={locale} label={`${r.systolic}/${r.diastolic}`}>
      <div className="rpu-li rpu-month-bp" data-rp="list-item" data-testid="own-day-bp" data-outside={outside ? "true" : undefined} data-reading={`${r.systolic}/${r.diastolic}`}>
        <MonthMark mark={outside ? "outside" : "reading"} size="row" />
        <span className="rpu-li-main">
          <span className="rpu-li-t" translate="no">
            {r.systolic}/{r.diastolic}
          </span>
          {sub ? <span className="rpu-li-s">{sub}</span> : null}
          {outside ? (
            <span className="rpu-li-s rpu-month-outside" data-testid="own-day-outside">
              {outsideWords(target, locale)}
            </span>
          ) : null}
          {r.reason ? (
            <span className="rpu-month-reason" data-testid="own-day-reason" lang={lang}>
              {dc(locale, "noted", { words: r.reason.text })}
            </span>
          ) : null}
        </span>
      </div>
    </Explainable>
  );
}

function NoteRow({ n, locale, tz }: { n: MonthNote; locale: Locale; tz: string }) {
  return (
    <div className="rpu-li" data-rp="list-item" data-testid="own-day-note">
      <span className="rpu-li-main">
        <span className="rpu-li-t" lang={n.lang ?? undefined}>
          {n.text}
        </span>
        <span className="rpu-li-s">{timeOf(n.at, locale, tz)}</span>
      </span>
    </div>
  );
}

function QuestionLine({ q, locale }: { q: MonthQuestion; locale: Locale }) {
  const origin = ORIGIN_WORDS[locale][uiOrigin(q.origin)];
  return (
    <Explainable as="row" subject={{ type: "question", ref: q.id }} locale={locale} label={q.text}>
      <div className="rpu-li" data-rp="list-item" data-testid="own-day-question" data-origin={q.origin}>
        <span className="rpu-li-main">
          <span className="rpu-li-t" lang={q.lang ?? undefined}>
            {q.text}
          </span>
          <span className="rpu-li-s">{[dc(locale, q.for === "pharmacist" ? "forPharmacist" : "forDoctor"), origin].join(" · ")}</span>
        </span>
      </div>
    </Explainable>
  );
}

/**
 * The day he opened, as a sheet over Today (owner 10-15; the frame: OwnDaySheet): its date (and 「今天」), then what the day
 * holds, each kind under its own heading: the visit, his readings, his medicine, his notes, the questions added to his
 * list; one plain line when the day has nothing. 「关闭」 goes back to Today without a day.
 */
export function OwnDay({ month, locale, tz }: { month: MonthView; locale: Locale; tz: string }) {
  const day = month.day;
  const visits = day.visits ?? [];
  const bp = day.bp ?? [];
  const doses = day.doses ?? [];
  const notes = day.notes ?? [];
  const questions = day.questions ?? [];
  const title = day.isToday ? `${dateWords(locale, day.date)} · ${dt(locale, "today.month.today")}` : dateWords(locale, day.date);
  const any = visits.length || bp.length || doses.length || notes.length || questions.length;
  return (
    <OwnDaySheet date={day.date} title={title} closeHref="/p/today" closeLabel={dc(locale, "close")}>
      {any ? (
        <>
          {visits.length ? (
            <ListCard heading={dc(locale, "visitHead")} testId="own-day-visits">
              {visits.map((v) => (
                <VisitRow key={v.id} v={v} date={day.date} locale={locale} />
              ))}
            </ListCard>
          ) : null}
          {bp.length ? (
            <ListCard heading={dc(locale, "bpHead")} testId="own-day-readings">
              {bp.map((r) => (
                <BpRow key={r.id} r={r} target={month.target} locale={locale} tz={tz} />
              ))}
            </ListCard>
          ) : null}
          {doses.length ? (
            <ListCard heading={dc(locale, "doseHead")} testId="own-day-rows">
              {doses.map((d) => (
                <DoseRow key={d.ref} d={d} date={day.date} future={day.future} locale={locale} tz={tz} />
              ))}
            </ListCard>
          ) : null}
          {notes.length ? (
            <ListCard heading={dc(locale, "notesHead")} testId="own-day-notes">
              {notes.map((n) => (
                <NoteRow key={n.id} n={n} locale={locale} tz={tz} />
              ))}
            </ListCard>
          ) : null}
          {questions.length ? (
            <ListCard heading={dc(locale, "questionsHead")} testId="own-day-questions">
              {questions.map((q) => (
                <QuestionLine key={q.id} q={q} locale={locale} />
              ))}
            </ListCard>
          ) : null}
        </>
      ) : (
        <p className="rpu-month-none" data-testid="own-day-empty">
          {dt(locale, "today.month.empty")}
        </p>
      )}
    </OwnDaySheet>
  );
}
