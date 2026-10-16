/**
 * The visit brief on an account (C2 track B, journey 14; real-app 2.18), in the timeline design (design group 14:
 * 14-3 English, 14-4 华语, 14-5 his words not translated): the same lines in two places.
 *
 *   BriefBody            the brief's blocks: a section title over a white list card for the counts (readings, doses,
 *                        the diet check, his questions numbered, his medicines), and a timeline entry wherever someone's
 *                        own words are quoted (the doctor's target and warning line, his notes). The sentences are the
 *                        dictionary's, whole: a count sentence is a row's title, a sentence that ends in a list is split
 *                        at its colon into the title and the grey line under it. Readings next to the doctor's warning
 *                        line are a card of their own, one row each, with that line quoted under it. His notes and
 *                        questions stay in his words; read in English they carry the checked English under them,
 *                        labelled as a translation, or say that they are not translated. 「上次看诊后新出现」 is a tag on
 *                        a note and accent words on a medicine's row, never red. No judging word anywhere: only counts,
 *                        his words, and the doctor's words. 10-14 (the owner's decision): first, when there is any,
 *                        「要告诉医生的情况」 / "For the doctor": what he told Ripple that is for the doctor (chest pain, a
 *                        stroke sign, a reading above the doctor's line), his words with the date and time he said them,
 *                        as timeline entries of his, read-only (lib/summary/signals.ts); not repeated under his notes.
 *   AccountBriefScreen   his screen (/p/brief): in his language, with 「给医生看」 in the bar at the foot of the screen,
 *                        above the tab bar, there as the page opens (owner's tidy of 10-13)
 *   DoctorBriefScreen    (components/brief/DoctorBrief.tsx) the screen he hands over: English by default
 * Data: lib/summary/account-brief.ts. Nothing names a scope or a story day.
 */
import type { ReactNode } from "react";
import { ActionDock, BodyText, Box, ListCard, ListItem, ListenBar, PrimaryButton, Said, SaidTranslation, Screen, SectionTitle, Tag, Timeline, TimelineItem, TlControls } from "@/components/ui";
import type { DoctorLineView } from "@/lib/daily/bp";
import { clockWords, dateWords, dt, longDay, shortDay, type DailyKey } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { mt } from "@/lib/meds/i18n";
import type { AccountBriefView } from "@/lib/summary/account-brief";
import { bt } from "@/lib/summary/i18n";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { uiCopy } from "@/lib/ui/copy";
import { clipTime } from "@/lib/ui/props";
import { missedText, splitAtColon } from "./words";
import "./brief.css";

const ORIGIN_KEY: Record<string, DailyKey> = {
  own: "q.origin.own",
  before_you_go: "q.origin.before_you_go",
  refused_question: "q.origin.refused_question",
  pattern: "q.origin.pattern",
  unidentified_medicine: "q.origin.unidentified_medicine",
  understanding_check: "q.origin.understanding_check",
};

/**
 * The brief's period in words. On the day of a visit the period after it has no day yet (it starts tomorrow:
 * lib/summary/account-brief.ts sinceLastHappenedVisit, fromDay = toDay + 1): the line says when it starts instead of
 * reading 「10月12日到10月11日」.
 */
export function briefWindowLine(view: Pick<AccountBriefView, "window">, locale: Locale): string {
  const w = view.window;
  if (w.lastVisit && w.fromDay > w.toDay) return bt(locale, "brief.windowNotYet", { last: shortDay(locale, w.lastVisit.date), from: shortDay(locale, w.fromDate) });
  return w.lastVisit
    ? bt(locale, "brief.window", { last: shortDay(locale, w.lastVisit.date), from: shortDay(locale, w.fromDate), to: shortDay(locale, w.toDate) })
    : bt(locale, "brief.windowFirst", { from: shortDay(locale, w.fromDate), to: shortDay(locale, w.toDate) });
}

/**
 * The brief's period as the grey line of a header: the sentence as it is, in two pieces that each stay whole, so a
 * narrow header breaks it after 「…之后：」 and never inside a date. The words and the spaces are briefWindowLine's.
 */
export function BriefWindow({ view, locale, testId }: { view: Pick<AccountBriefView, "window">; locale: Locale; testId?: string }) {
  const whole = briefWindowLine(view, locale);
  const parts = splitAtColon(whole);
  if (!parts) return <span data-testid={testId}>{whole}</span>;
  const head = parts.head.trimEnd();
  return (
    <span data-testid={testId}>
      <span className="rp14b-piece">{head}</span>
      {parts.head.length > head.length ? " " : null}
      <span className="rp14b-piece">{parts.tail}</span>
    </span>
  );
}

/**
 * One line of the doctor's, quoted as said, as a timeline entry: the node says who (the dashed ring and 「好像是医生说的」
 * until he confirmed the speaker), the head line the visit's date and where in the recording, then the words in the
 * serif, the checked Chinese under them on his Chinese page, and the recording to listen to on his own page.
 */
function DoctorLine({
  line,
  locale,
  zh,
  time,
  listen,
  testId,
  translationTestId,
}: {
  line: DoctorLineView;
  locale: Locale;
  /** the checked Chinese of the line, when the page holds one */
  zh?: string | null;
  /** say where in the recording the line is */
  time: boolean;
  listen: boolean;
  testId?: string;
  translationTestId: string;
}) {
  const copy = uiCopy(locale);
  const inferred = line.state !== "confirmed";
  const when = [longDay(locale, line.date), time && line.tStartMs !== null ? clipTime(line.tStartMs) : null].filter(Boolean).join(" · ");
  return (
    <Timeline>
      <TimelineItem
        node={inferred ? "unc" : "doc"}
        who={inferred ? copy.inferredDoctor : copy.sources.doctor}
        meta={when}
        testId={testId}
        attrs={{ "data-state": line.state }}
        actions={listen && line.clipUrl ? <ListenBar src={line.clipUrl} kind="doctor" time="" label={copy.listenOriginal} locale={locale} standIn={line.standIn} /> : undefined}
      >
        <Said lang="en" source={{ kind: "doctor", ref: line.utteranceId ?? `${line.visitId}:${line.kind}` }}>
          “{line.text}”
        </Said>
        {zh && locale === "zh-Hans" ? (
          <div className="rp14b-zh" data-testid={translationTestId} lang="zh-Hans">
            <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{zh}</SaidTranslation>
          </div>
        ) : null}
      </TimelineItem>
    </Timeline>
  );
}

export function BriefBody({ view, locale, listen = false }: { view: AccountBriefView; locale: Locale; listen?: boolean }) {
  const { bp, doses } = view;
  const target = view.targetLine;
  const w = view.window;
  // the period's two dates under the first count (the draft's grey line); none on the day of a visit, when it has no day yet
  const range = w.fromDay <= w.toDay ? `${shortDay(locale, w.fromDate)} – ${shortDay(locale, w.toDate)}` : undefined;
  const missed = missedText(locale, doses);
  const missedParts = missed ? splitAtColon(missed) : null;
  const above = view.above && view.above.readings.length ? view.above : null;
  // (a brief kept before 10-14 has none: lib/summary/brief-snapshot.ts)
  const signals = view.signals ?? [];
  return (
    <div className="rpu-stack" data-testid="brief-body" data-from={w.fromDate} data-to={w.toDate}>
      {signals.length ? (
        <>
          {/* 10-14 (the owner's decision): what he told Ripple to tell the doctor, first, his words with when he said them */}
          <SectionTitle>{bt(locale, "brief.signals.title")}</SectionTitle>
          <div data-testid="brief-signals" data-count={signals.length}>
            <Timeline>
              {signals.map((s) => {
                // read in English: the checked English under his words, labelled; Chinese words without one say so
                const english = locale === "en" ? view.english[s.text.trim()] : undefined;
                const plain = locale === "en" && !english && /\p{Script=Han}/u.test(s.text);
                const when = s.time ? `${shortDay(locale, s.date)} · ${clockWords(locale, s.time)}` : shortDay(locale, s.date);
                return (
                  <TimelineItem
                    key={s.id}
                    node="me"
                    who={bt(locale, "brief.notes.chip")}
                    meta={when}
                    testId="brief-signal"
                    attrs={{ "data-signal": s.id, "data-date": s.date, "data-time": s.time ?? undefined }}
                    actions={
                      plain ? (
                        <TlControls>
                          <Tag>{bt(locale, "brief.notTranslated")}</Tag>
                        </TlControls>
                      ) : undefined
                    }
                  >
                    <div className="rp14b-words" data-rp="brief-own" data-translated={english ? "true" : undefined}>
                      <p className="rp14b-own" lang={s.lang ?? (locale === "en" ? "zh-Hans" : undefined)} data-verbatim="note">
                        「{s.text}」
                      </p>
                      {english ? (
                        <>
                          <p className="rp14b-own" lang="en" data-testid="brief-english">
                            {english}
                          </p>
                          <p className="rpu-said-note">{bt(locale, "brief.translation")}</p>
                        </>
                      ) : null}
                    </div>
                  </TimelineItem>
                );
              })}
            </Timeline>
          </div>
        </>
      ) : null}
      <SectionTitle>{bt(locale, "brief.bp.title")}</SectionTitle>
      <div className="rpu-stack" data-testid="brief-bp" data-count={bp.count} data-avg={bp.avgSystolic !== null ? `${bp.avgSystolic}/${bp.avgDiastolic}` : ""} data-not-below={bp.notBelow ?? ""}>
        <ListCard>
          {bp.count === 0 ? (
            <ListItem title={bt(locale, "brief.bp.none")} />
          ) : (
            <ListItem
              title={bp.count === 1 ? bt(locale, "brief.bp.summaryOne", { s: bp.avgSystolic!, d: bp.avgDiastolic! }) : bt(locale, "brief.bp.summary", { n: bp.count, s: bp.avgSystolic!, d: bp.avgDiastolic! })}
              sub={range}
            />
          )}
          {bp.unconfirmed > 0 ? <ListItem title={bt(locale, "brief.bp.unconfirmed", { n: bp.unconfirmed })} /> : null}
          {target && bp.notBelow !== null && bp.count > 0 ? (
            <ListItem
              testId="brief-bp-mirror"
              attrs={{ "data-mirror": "R1" }}
              title={bt(locale, "brief.bp.mirror", { n: bp.notBelow, s: target.systolic, d: target.diastolic ?? "", date: shortDay(locale, target.date) })}
            />
          ) : null}
          {target ? null : <ListItem title={bt(locale, "brief.bp.noTarget")} />}
        </ListCard>
        {target ? <DoctorLine line={target} locale={locale} zh={view.doctorZh?.[target.text]} time listen={listen} testId="brief-target" translationTestId="brief-target-translation" /> : null}
      </div>

      {above ? (
        <div className="rpu-stack" data-testid="brief-above" data-count={above.readings.length}>
          {/* C2 track S (round 2): the title says how the line stands in his review (lib/safety/threshold.ts rule A) */}
          <ListCard
            heading={
              <span data-testid="brief-above-title" data-review={above.review}>
                {bt(locale, above.review === "confirmed" ? "brief.above.title" : above.review === "disputed" ? "brief.above.titleDisputed" : "brief.above.titleInferred", {
                  s: above.line.systolic,
                  date: shortDay(locale, above.line.date),
                })}
              </span>
            }
          >
            {above.readings.map((r) => {
              // 「10月12日 早上 10:05：185/112」: the reading is the row's words, its date and time the grey line under it
              const whole = bt(locale, "brief.above.item", { date: shortDay(locale, r.date), time: clockWords(locale, r.time), s: r.systolic, d: r.diastolic ?? "" });
              const parts = splitAtColon(whole);
              return <ListItem key={r.id} testId="brief-above-reading" attrs={{ "data-reading": `${r.systolic}/${r.diastolic ?? ""}` }} title={parts ? parts.tail : whole} sub={parts ? parts.lead : undefined} />;
            })}
          </ListCard>
          {/* C2 track S (round 2): the checked Chinese under the doctor's English words, on his Chinese brief only */}
          <DoctorLine line={above.line} locale={locale} zh={view.doctorZh?.[above.line.text]} time={false} listen={false} translationTestId="brief-above-translation" />
        </div>
      ) : null}

      <SectionTitle>{bt(locale, "brief.doses.title")}</SectionTitle>
      <div data-testid="brief-doses" data-due={doses.due} data-taken={doses.taken} data-missed={doses.missed} data-unconfirmed={doses.unconfirmed}>
        <ListCard>
          {doses.due === 0 ? (
            <ListItem title={bt(locale, "brief.doses.none")} />
          ) : (
            <>
              <ListItem
                title={bt(locale, "brief.doses.headline", { taken: doses.taken, due: doses.due })}
                sub={[
                  `${bt(locale, "brief.doses.due")} ${doses.due}`,
                  `${bt(locale, "brief.doses.taken")} ${doses.taken}`,
                  `${bt(locale, "brief.doses.missed")} ${doses.missed}`,
                  `${bt(locale, "brief.doses.unconfirmed")} ${doses.unconfirmed}`,
                ].join(" · ")}
              />
              {missed ? <ListItem testId="brief-doses-missed" title={missedParts ? missedParts.head : missed} sub={missedParts ? missedParts.tail : undefined} /> : null}
              {doses.meds.length ? <ListItem title={bt(locale, "brief.doses.meds", { names: doses.meds.map((m) => (m.strength ? `${m.name} ${m.strength}` : m.name)).join(", ") })} /> : null}
            </>
          )}
        </ListCard>
      </div>

      {view.diet ? (
        <>
          <SectionTitle>{bt(locale, "brief.diet.title")}</SectionTitle>
          <div data-testid="brief-diet" data-item={view.diet.item} data-answered={view.diet.answered} data-days={view.diet.days}>
            <ListCard>
              <ListItem title={view.diet.text} />
            </ListCard>
          </div>
        </>
      ) : null}

      <SectionTitle>{bt(locale, "brief.notes.title")}</SectionTitle>
      <div data-testid="brief-notes">
        {view.notes.length === 0 ? (
          <ListCard>
            <ListItem title={bt(locale, "brief.notes.none")} />
          </ListCard>
        ) : (
          <Timeline>
            {view.notes.map((n) => {
              // read in English: the checked English under his words, labelled; without one, a tag that says so
              const english = locale === "en" ? view.english[n.text.trim()] : undefined;
              const plain = locale === "en" && !english;
              const when = n.source === "voice_note" ? `${shortDay(locale, n.date)} · ${bt(locale, "brief.notes.voice")}` : shortDay(locale, n.date);
              return (
                <TimelineItem
                  key={n.id}
                  node="me"
                  who={bt(locale, "brief.notes.chip")}
                  meta={when}
                  testId="brief-note"
                  attrs={{ "data-note": n.id, "data-changed": n.newTopic ? "true" : undefined }}
                  actions={
                    plain || n.newTopic ? (
                      <TlControls>
                        {plain ? <Tag>{bt(locale, "brief.notTranslated")}</Tag> : null}
                        {n.newTopic ? <Tag>{bt(locale, "brief.changed")}</Tag> : null}
                      </TlControls>
                    ) : undefined
                  }
                >
                  <div className="rp14b-words" data-rp="brief-own" data-translated={english ? "true" : undefined}>
                    <p className="rp14b-own" lang={n.lang ?? (locale === "en" ? "zh-Hans" : undefined)} data-verbatim="note">
                      「{n.text}」
                    </p>
                    {english ? (
                      <>
                        <p className="rp14b-own" lang="en" data-testid="brief-english">
                          {english}
                        </p>
                        <p className="rpu-said-note">{bt(locale, "brief.translation")}</p>
                      </>
                    ) : null}
                  </div>
                </TimelineItem>
              );
            })}
          </Timeline>
        )}
      </div>

      <SectionTitle>{bt(locale, "brief.questions.title")}</SectionTitle>
      <div data-testid="brief-questions" data-count={view.questions.shown.length}>
        <ListCard>
          {view.questions.shown.length === 0 ? <ListItem title={bt(locale, "brief.questions.none")} /> : null}
          {view.questions.shown.map((q, i) => {
            // his own words are verbatim; a recorded summary (the example's q-extra-tablet before he asks it
            // himself) is said to be one, never passed off as his words, in either language
            const summaryOnly = q.wording === "recorded_summary";
            const english = view.english[q.text.trim()];
            const translate = locale === "en" && q.wording !== "pattern" && /\p{Script=Han}/u.test(q.text);
            return (
              <ListItem
                key={q.id}
                mark="num"
                markText={String(i + 1)}
                testId="brief-question"
                attrs={{ "data-question": q.id, "data-origin": q.origin, "data-wording": q.wording }}
                title={
                  <span lang={q.lang ?? undefined} {...(q.wording === "own_words" ? { "data-verbatim": "question" } : summaryOnly ? { "data-recorded": "summary" } : {})}>
                    {q.text}
                  </span>
                }
                sub={
                  <>
                    {translate && english ? (
                      <>
                        <span className="rp14b-li-en" lang="en" data-testid="brief-english">
                          {english}
                        </span>
                        <span className="rp14b-li-line">{bt(locale, summaryOnly ? "brief.translationSummary" : "brief.translation")}</span>
                      </>
                    ) : null}
                    {translate && !english ? <span className="rp14b-li-line">{bt(locale, summaryOnly ? "brief.notTranslatedSummary" : "brief.notTranslated")}</span> : null}
                    <span className="rp14b-li-line">
                      {dt(locale, ORIGIN_KEY[q.origin] ?? "q.origin.other")}
                      {summaryOnly ? ` · ${bt(locale, "brief.questions.recordedSummary")}` : ""}
                    </span>
                    {q.summary ? (
                      <span className="rp14b-li-line" lang={q.summary.lang ?? undefined} data-recorded="summary" data-testid="brief-question-summary">
                        {bt(locale, "brief.questions.summaryOf")}
                        {q.summary.text}
                      </span>
                    ) : null}
                  </>
                }
              />
            );
          })}
          {view.questions.more > 0 ? <ListItem title={bt(locale, "brief.questions.more", { n: view.questions.more })} /> : null}
        </ListCard>
      </div>

      <SectionTitle>{bt(locale, "brief.meds.title")}</SectionTitle>
      <div className="rp14b-meds" data-testid="brief-meds">
        <ListCard>
          {view.meds.length === 0 ? <ListItem title={bt(locale, "brief.meds.none")} /> : null}
          {view.meds.map((m) => (
            <ListItem
              key={m.id}
              testId="brief-med"
              attrs={{ "data-med": m.id, "data-changed": m.newSinceLastVisit ? "true" : undefined }}
              title={<span translate="no">{m.strength ? `${m.name} ${m.strength}` : m.name}</span>}
              sub={mt(locale, `origin.${m.origin}`)}
              right={m.newSinceLastVisit ? bt(locale, "brief.changed") : undefined}
              rightTone={m.newSinceLastVisit ? "accent" : undefined}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}

export function AccountBriefScreen({
  view,
  locale,
  meta,
  tabBar,
  lastShown,
  showHref = "/p/brief?show=doctor",
}: {
  view: AccountBriefView;
  locale: Locale;
  /** the screen's header: 「‹ 返回」, 「看诊简报」 and the brief's period under it (app/p/brief/page.tsx) */
  meta: ReactNode;
  tabBar: ReactNode;
  /** the page he last showed the doctor (components/brief/LastShown.tsx), or nothing */
  lastShown?: ReactNode;
  /** where 「给医生看」 goes: the page for the doctor (the page adds where he came from, so 「看完了」 brings him back the same way) */
  showHref?: string;
}) {
  const empty =
    !view.window.lastVisit && view.bp.count === 0 && view.doses.due === 0 && view.notes.length === 0 && view.questions.shown.length === 0 && !view.signals?.length;
  return (
    <Screen locale={locale} tabBar={tabBar} tabBarPlacement="fixed">
      {meta}
      <div className="rpu-stack" data-testid="page-brief" data-scope="account" data-day={view.date} data-from={view.window.fromDate} data-to={view.window.toDate}>
        {view.nextVisit ? <BodyText variant="lede">{bt(locale, "brief.nextVisit", { date: dateWords(locale, view.nextVisit.date) })}</BodyText> : null}
        {empty ? (
          <Box variant="dash" testId="brief-empty">
            {bt(locale, "brief.acc.empty")}
          </Box>
        ) : (
          <BriefBody view={view} locale={locale} listen />
        )}
        {lastShown}
      </div>
      {/* 「给医生看」 stays at the foot of the screen, above the tab bar, while the brief scrolls under it (owner's tidy
          of 10-13): the bar is in the page's flow, so it takes its own room under the last block */}
      {!empty ? (
        <ActionDock bar>
          <PrimaryButton href={showHref} data-testid="brief-show-doctor">
            {bt(locale, "brief.showDoctor")}
          </PrimaryButton>
        </ActionDock>
      ) : null}
    </Screen>
  );
}
