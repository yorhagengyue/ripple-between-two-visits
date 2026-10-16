/**
 * The visit brief on the phone (task M7): one page for the doctor, v3 cards. Presentational; the data comes from
 * lib/summary/brief.ts.
 *
 * Words: counts and averages of his records; the comparison mirrors R1 ("not below" / 不低于, never above / high),
 * next to R1 quoted word for word with its date; his notes and questions word for word. Quoted words carry
 * data-verbatim (doctor / note / question) so the judgement-word test can tell them from Ripple's own words.
 * "Changed since the last visit" (a new medicine, a note on a new topic) is marked by the accent rule on the left of
 * the item and a square tag in the accent, as the account's brief marks it (components/brief/AccountBrief.tsx): every
 * marked element sits in a data-changed="true" element. Nothing on this page is red: red is for the 995 line only
 * (the timeline design; front-end line fe-demo, 2026-10-11; tests: e2e/m7-brief.spec.ts).
 *
 * C2 follow-up (track E; real-app 12): the readings above the doctor's own warning line are listed one by one, next to
 * that line quoted word for word (no judging word, no red); read in English, his own words (notes, questions) carry
 * their checked English under them, labelled as a translation, or say that they are not translated.
 *
 * 10-14 (the owner's decision): first, when there is any, 「要告诉医生的情况」 / "For the doctor": what he told Ripple that is
 * for the doctor (chest pain, a stroke sign, a reading above the doctor's line; lib/summary/signals.ts), his words with
 * the day, read-only. Those words are not repeated under his notes.
 */
import { chipDetail, chipText } from "@/lib/daily/lines";
import { dt, shortDay, type DailyKey } from "@/lib/daily/i18n";
import type { LineChip } from "@/lib/daily/types";
import type { Locale } from "@/lib/i18n";
import { mt } from "@/lib/meds/i18n";
import type { BriefView } from "@/lib/summary/brief";
import { bt } from "@/lib/summary/i18n";
import { missedText } from "./words";

/** The first design's red for "changed since the last visit". No longer drawn (the mark is the accent); kept for importers. */
export const CHANGED_RED = "#B3261E";
/** The mark of "changed since the last visit": the accent rule on the item's left, the accent on its tag. */
const CHANGED_BOX = "border-l-4 border-l-accent pl-3";
const CHANGED_TAG = "text-accent-ink";

function ChangedTag({ locale }: { locale: Locale }) {
  return (
    <span className={`rp-tag ${CHANGED_TAG}`} data-testid="brief-changed-tag">
      ● {bt(locale, "brief.changed")}
    </span>
  );
}

const ORIGIN_KEY: Record<string, Parameters<typeof dt>[1]> = {
  own: "q.origin.own",
  before_you_go: "q.origin.before_you_go",
  refused_question: "q.origin.refused_question",
  pattern: "q.origin.pattern",
  unidentified_medicine: "q.origin.unidentified_medicine",
  understanding_check: "q.origin.understanding_check",
};

/**
 * Under his own words when the brief is read in English: the checked translation, labelled, or a note that there is none.
 * Nothing for words that are not Chinese, and nothing in 华语 (he reads his own words).
 */
function English({ view, locale, text, summary = false }: { view: BriefView; locale: Locale; text: string; summary?: boolean }) {
  if (locale !== "en" || !/\p{Script=Han}/u.test(text)) return null;
  const en = view.english?.[text.trim()];
  if (!en) {
    return (
      <p className="rp-src" data-testid="brief-not-translated">
        {bt(locale, summary ? "brief.notTranslatedSummary" : "brief.notTranslated")}
      </p>
    );
  }
  return (
    <>
      {/* his words in English, not Ripple's own: left out of the own-words scans like the other recorded words */}
      <p className="text-body" lang="en" data-testid="brief-english" data-translation="checked" data-recorded="translation">
        {en}
      </p>
      <p className="rp-src">{bt(locale, summary ? "brief.translationSummary" : "brief.translation")}</p>
    </>
  );
}

export function BriefSheet({ view, locale }: { view: BriefView; locale: Locale }) {
  const w = view.window;
  const { bp, target, doses } = view;
  const missed = missedText(locale, doses);
  const signals = view.signals ?? [];
  const above = view.aboveLine && view.aboveLine.readings.length > 0 ? view.aboveLine : null;
  const aboveChip: LineChip | null = above
    ? { kind: "doctor", inferred: above.line.state !== "confirmed", date: above.line.date, tStartMs: above.line.tStartMs, standInVoice: above.line.standIn }
    : null;
  return (
    <div className="flex flex-col gap-4" data-testid="page-brief" data-day={view.day} data-from={w.fromDay} data-to={w.toDay}>
      <header>
        <h1 className="text-[28px] font-bold">{bt(locale, "brief.title")}</h1>
        <p className="text-body text-ink-2" data-testid="brief-window">
          {bt(locale, "brief.for")} ·{" "}
          {w.lastVisit
            ? bt(locale, "brief.window", { last: shortDay(locale, w.lastVisit.date), from: shortDay(locale, w.fromDate), to: shortDay(locale, w.toDate) })
            : bt(locale, "brief.windowFirst", { from: shortDay(locale, w.fromDate), to: shortDay(locale, w.toDate) })}
        </p>
      </header>

      {/* 10-14 (the owner's decision): what he told Ripple to tell the doctor, his words with the day he said them; shown
          only when there is something, read-only */}
      {signals.length ? (
        <section className="rp-card" data-testid="brief-signals" data-count={signals.length}>
          <h2 className="text-[20px] font-bold">{bt(locale, "brief.signals.title")}</h2>
          <ul className="mt-1 flex flex-col gap-3">
            {signals.map((s) => (
              <li key={s.id} data-testid="brief-signal" data-signal={s.id} data-date={s.date}>
                <span className="rp-src">
                  {bt(locale, "brief.notes.chip")} · {shortDay(locale, s.date)}
                </span>
                <p className="text-body" lang={s.lang ?? undefined} data-verbatim="note">
                  「{s.text}」
                </p>
                <English view={view} locale={locale} text={s.text} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rp-card" data-testid="brief-bp" data-count={bp.count} data-avg={bp.avgSystolic !== null ? `${bp.avgSystolic}/${bp.avgDiastolic}` : ""} data-not-below={bp.notBelow ?? ""}>
        <h2 className="text-[20px] font-bold">{bt(locale, "brief.bp.title")}</h2>
        {bp.count === 0 ? (
          <p className="mt-1 text-body" data-testid="brief-bp-summary">
            {bt(locale, "brief.bp.none")}
          </p>
        ) : (
          <p className="mt-1 text-[20px] font-bold tabular-nums" data-testid="brief-bp-summary">
            {bp.count === 1
              ? bt(locale, "brief.bp.summaryOne", { s: bp.avgSystolic!, d: bp.avgDiastolic! })
              : bt(locale, "brief.bp.summary", { n: bp.count, s: bp.avgSystolic!, d: bp.avgDiastolic! })}
          </p>
        )}
        {bp.unconfirmed > 0 ? (
          <p className="text-body" data-testid="brief-bp-unconfirmed">
            {bt(locale, "brief.bp.unconfirmed", { n: bp.unconfirmed })}
          </p>
        ) : null}
        {target && bp.notBelow !== null && bp.count > 0 ? (
          <p className="mt-1 text-body tabular-nums" data-testid="brief-bp-mirror" data-mirror="R1">
            {bt(locale, "brief.bp.mirror", { n: bp.notBelow, s: target.systolic, d: target.diastolic, date: shortDay(locale, target.date) })}
          </p>
        ) : null}
        {target ? (
          <div className={`mt-3 rp-card ${target.chip.kind === "doctor" && !target.chip.inferred ? "rp-card-doc" : ""}`} data-testid="brief-r1" data-source={target.sourceId} data-inferred={target.chip.inferred ? "true" : "false"}>
            <div className="rp-tag">● {chipText(locale, target.chip)}</div>
            <p className="mt-1.5 text-body leading-[1.42]" lang="en" data-verbatim="doctor">
              {target.text}
            </p>
            {chipDetail(locale, target.chip) ? <div className="rp-src">{chipDetail(locale, target.chip)}</div> : null}
          </div>
        ) : (
          <p className="mt-1 text-body text-ink-2" data-testid="brief-bp-no-target">
            {bt(locale, "brief.bp.noTarget")}
          </p>
        )}
        {above && aboveChip ? (
          <div className="mt-3" data-testid="brief-above" data-count={above.readings.length}>
            <p className="text-body">{bt(locale, "brief.above.title", { s: above.line.systolic, date: shortDay(locale, above.line.date) })}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {above.readings.map((r) => (
                <li key={r.id} className="text-body font-semibold tabular-nums" data-testid="brief-above-reading" data-reading={`${r.systolic}/${r.diastolic ?? ""}`} data-day={r.day}>
                  {bt(locale, "brief.above.item", { date: shortDay(locale, r.date), time: dt(locale, `bp.slot.${r.slot}` as DailyKey), s: r.systolic, d: r.diastolic ?? "" })}
                </li>
              ))}
            </ul>
            <div className={`mt-2 rp-card ${aboveChip.inferred ? "" : "rp-card-doc"}`} data-testid="brief-r2" data-inferred={aboveChip.inferred ? "true" : "false"}>
              <div className="rp-tag">● {chipText(locale, aboveChip)}</div>
              <p className="mt-1.5 text-body leading-[1.42]" lang="en" data-verbatim="doctor">
                {above.line.text}
              </p>
              {chipDetail(locale, aboveChip) ? <div className="rp-src">{chipDetail(locale, aboveChip)}</div> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rp-card" data-testid="brief-doses" data-due={doses.due} data-taken={doses.taken} data-missed={doses.missed} data-unconfirmed={doses.unconfirmed}>
        <h2 className="text-[20px] font-bold">{bt(locale, "brief.doses.title")}</h2>
        {doses.due === 0 ? (
          <p className="mt-1 text-body">{bt(locale, "brief.doses.none")}</p>
        ) : (
          <>
            <p className="mt-1 text-[20px] font-bold tabular-nums" data-testid="brief-doses-headline">
              {bt(locale, "brief.doses.headline", { taken: doses.taken, due: doses.due })}
            </p>
            <dl className="mt-2 grid grid-cols-4 gap-1 text-center" data-testid="brief-doses-counts">
              {(
                [
                  ["brief.doses.due", doses.due],
                  ["brief.doses.taken", doses.taken],
                  ["brief.doses.missed", doses.missed],
                  ["brief.doses.unconfirmed", doses.unconfirmed],
                ] as const
              ).map(([k, n]) => (
                <div key={k} className="rounded-xl bg-surface-2 px-1 py-2">
                  <dt className="text-body text-ink-2">{bt(locale, k)}</dt>
                  <dd className="text-[20px] font-bold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            {missed ? (
              <p className="mt-2 text-body" data-testid="brief-doses-missed">
                {missed}
              </p>
            ) : null}
            {doses.meds.length ? (
              <p className="mt-1 text-body text-ink-2">{bt(locale, "brief.doses.meds", { names: doses.meds.map((m) => (m.strength ? `${m.name} ${m.strength}` : m.name)).join(", ") })}</p>
            ) : null}
          </>
        )}
      </section>

      <section className="rp-card" data-testid="brief-notes">
        <h2 className="text-[20px] font-bold">{bt(locale, "brief.notes.title")}</h2>
        {view.notes.length === 0 ? <p className="mt-1 text-body text-ink-2">{bt(locale, "brief.notes.none")}</p> : null}
        <ul className="mt-1 flex flex-col gap-3">
          {view.notes.map((n) => (
            <li key={n.id} className={n.newTopic ? CHANGED_BOX : ""} data-testid="brief-note" data-note={n.id} data-day={n.day} {...(n.newTopic ? { "data-changed": "true" } : {})}>
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="rp-src">
                  {bt(locale, "brief.notes.chip")} · {shortDay(locale, n.date)}
                </span>
                {n.newTopic ? <ChangedTag locale={locale} /> : null}
              </div>
              <p className="text-body" lang={n.lang ?? undefined} data-verbatim="note">
                「{n.text}」
              </p>
              <English view={view} locale={locale} text={n.text} />
            </li>
          ))}
        </ul>
      </section>

      <section className="rp-qlist" data-testid="brief-questions" data-count={view.questions.shown.length}>
        <div className="rp-q">
          <h2 className="text-[20px] font-bold">{bt(locale, "brief.questions.title")}</h2>
        </div>
        {view.questions.shown.length === 0 ? (
          <div className="rp-q">
            <p className="text-body text-ink-2">{bt(locale, "brief.questions.none")}</p>
          </div>
        ) : null}
        {view.questions.shown.map((q) => {
          // his own words are verbatim; a recorded summary (the seeded q-extra-tablet before he asks it himself) is
          // marked as such and never as his words (wave B); a pattern is Ripple's wording and stays in the scans
          const ownWords = q.wording === "own_words";
          const summaryOnly = q.wording === "recorded_summary";
          return (
            <div key={q.id} className="rp-q" data-testid="brief-question" data-question={q.id} data-origin={q.origin} data-wording={q.wording}>
              <span className="rp-tag">
                {dt(locale, ORIGIN_KEY[q.origin] ?? "q.origin.other")}
                {summaryOnly ? ` · ${bt(locale, "brief.questions.recordedSummary")}` : ""}
              </span>
              <p
                className="rp-qt mt-1"
                lang={q.lang ?? undefined}
                {...(ownWords ? { "data-verbatim": "question" } : summaryOnly ? { "data-recorded": "summary" } : {})}
              >
                {q.text}
              </p>
              {q.wording !== "pattern" ? <English view={view} locale={locale} text={q.text} summary={summaryOnly} /> : null}
              {q.summary ? (
                <p className="text-body text-ink-2" lang={q.summary.lang ?? undefined} data-recorded="summary" data-testid="brief-question-summary">
                  {bt(locale, "brief.questions.summaryOf")}
                  {q.summary.text}
                </p>
              ) : null}
            </div>
          );
        })}
        {view.questions.more > 0 ? (
          <div className="rp-q">
            <p className="text-body text-ink-2" data-testid="brief-questions-more">
              {bt(locale, "brief.questions.more", { n: view.questions.more })}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rp-card" data-testid="brief-meds">
        <h2 className="text-[20px] font-bold">{bt(locale, "brief.meds.title")}</h2>
        {view.meds.length === 0 ? <p className="mt-1 text-body text-ink-2">{bt(locale, "brief.meds.none")}</p> : null}
        <ul className="mt-1 flex flex-col gap-2">
          {view.meds.map((m) => (
            <li
              key={m.id}
              className={`flex flex-col ${m.newSinceLastVisit ? CHANGED_BOX : ""}`}
              data-testid="brief-med"
              data-med={m.id}
              {...(m.newSinceLastVisit ? { "data-changed": "true" } : {})}
            >
              <span className="text-body font-semibold">{m.strength ? `${m.name} ${m.strength}` : m.name}</span>
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="text-body text-ink-2">
                  {mt(locale, `origin.${m.origin}`)} · {mt(locale, `status.${m.status}`)}
                </span>
                {m.newSinceLastVisit ? <ChangedTag locale={locale} /> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
