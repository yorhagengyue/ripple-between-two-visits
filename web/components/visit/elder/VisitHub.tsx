"use client";

/**
 * The visit tab's first screen on his account (owner's decision of 10-14: the visit page and the question list are one
 * tab, and it is short). Drawn by AccountVisitFlow under what is not finished (a recording still on this phone, a
 * visit left half way); its one button, 「开始就诊」, is the flow's own and opens the card for the doctor. Top to bottom:
 *
 *   the timeline   one card of rows that runs down into the future: his earlier visits, the oldest first (the date,
 *                  where), then the next one (its day and place; on the example account a tap plays the sample visit;
 *                  「我约的日子」 where he can set it), then 「就诊简报」, the page for the doctor. A tap on an earlier
 *                  visit opens it in place: the lines he confirmed, word for word with their recording, as the record
 *                  groups them (医生交代的事, 要注意的), and 「看这次的全部记录」 (its review). Each row can be held for
 *                  Ripple's read of it (owner 10-14), and so can each line.
 *   要告诉医生的情况 what Ripple noted for the doctor since the last visit: his words, the date and the time; at most five,
 *                  the newest first; left out when there is nothing
 *   问题单          one list: still to ask, the doctor's and the pharmacist's together (a small tag on the pharmacist's),
 *                  at most five; 「看全部（N）」 to the whole list (/p/questions), 「加一个问题」, and 「提问」 (asking
 *                  Ripple, which the say bar opened before it was removed)
 *
 * No clinical words of its own: the lines are the record's (lib/visit/hub.ts), the notes and the questions his. Words:
 * ./words.ts, lib/visit/account-copy.ts, lib/profile/copy.ts. Test hooks: visit-timeline, visit-past-row (data-visit,
 * data-open), visit-past-toggle, visit-past-record, visit-record-told / -watch, visit-record-line, visit-record-all,
 * visit-planned-row, visit-next-none, visit-brief, visit-signals, visit-signal, visit-questions, visit-question
 * (data-for), visit-questions-all, visit-questions-add, visit-ask.
 */
import { useState } from "react";
import { Explainable } from "@/components/explain/Explainable";
import { Button, Chevron, ListCard, ListItem, ListMark, Said, SaidTranslation, SecondaryButton, SectionTitle, Tag, Timeline, TimelineItem } from "@/components/ui";
import { questionsCopy } from "@/lib/profile/copy";
import { uiCopy } from "@/lib/ui/copy";
import { at, clipTimeLabel, type AccountLocale } from "@/lib/visit/account-copy";
import type { HubLine, VisitHubData, VisitRecordLines } from "@/lib/visit/hub";
import type { PastVisit, PlannedVisit } from "./AccountVisitFlow";
import { ClipRow } from "./parts";
import { lineLang } from "./ReviewOne";
import { vw } from "./words";

/** An earlier visit opened in place shows this many of what the clinicians told him; the rest is in its whole record. */
export const TOLD_SHOWN = 3;

const SPEAKERS = ["doctor", "dispenser", "pharmacist"] as const;

/** Who said a line he confirmed, as the review says it: 「医生说」, 「柜台说」, 「药剂师说」. */
function saidBy(locale: AccountLocale, speaker: HubLine["speaker"]): string {
  return at(locale, speaker === "doctor" ? "review.verdict.right" : speaker === "dispenser" ? "review.verdict.right.dispenser" : "review.verdict.right.pharmacist");
}

/** One line of an earlier visit, as its record shows a line he confirmed (the review's entry, without 「改一下」). */
function RecordLine({ line, locale }: { line: HubLine; locale: AccountLocale }) {
  const copy = uiCopy(locale);
  return (
    <Explainable as="line" subject={{ type: "visit_line", ref: line.hold }} locale={locale} label={line.title ?? saidBy(locale, line.speaker)}>
      <TimelineItem node="doc" time={clipTimeLabel(line.tStartMs)} who={saidBy(locale, line.speaker)} title={line.title ?? undefined} testId="visit-record-line" attrs={{ "data-line": line.id, "data-speaker": line.speaker }}>
        <Said lang={lineLang(line.lang)} source={{ kind: line.speaker, ref: line.id }}>
          “{line.text}”
        </Said>
        {line.translation ? <SaidTranslation note={at(locale, "review.translationTag")}>{line.translation}</SaidTranslation> : null}
        <ClipRow clip={line.clip} label={copy.listenOriginal} locale={locale} />
      </TimelineItem>
    </Explainable>
  );
}

/**
 * An earlier visit's record, opened in place: what the clinicians told him (the doctor's first, then the counter's and
 * the pharmacist's under their own names; three at most, the rest is in the whole record), then what to watch for (all
 * of it: a warning line is never left for later), then the way to the whole record. `record` absent: it could not be
 * read, and the way to the whole record is all there is.
 */
export function VisitRecord({ visitId, record, locale }: { visitId: string; record: VisitRecordLines | undefined; locale: AccountLocale }) {
  const told = record?.told ?? [];
  const watch = record?.watch ?? [];
  // the doctor's first, then the counter's and the pharmacist's: three in all
  const shown = SPEAKERS.flatMap((speaker) => told.filter((l) => l.speaker === speaker)).slice(0, TOLD_SHOWN);
  const groups = SPEAKERS.map((speaker) => ({ speaker, lines: shown.filter((l) => l.speaker === speaker) })).filter((g) => g.lines.length > 0);
  const more = told.length - shown.length;
  return (
    <div className="rpu-stack" data-testid="visit-past-record" data-visit={visitId} data-told={told.length} data-watch={watch.length}>
      {groups.map((g) => (
        <section key={g.speaker} className="rpu-visit-group" data-testid="visit-record-told" data-speaker={g.speaker}>
          <SectionTitle>{vw(locale, `summary.section.${g.speaker}`)}</SectionTitle>
          <Timeline>
            {g.lines.map((l) => (
              <RecordLine key={l.id} line={l} locale={locale} />
            ))}
          </Timeline>
        </section>
      ))}
      {more > 0 ? (
        <p className="rpu-visit-note" data-testid="visit-record-more" data-more={more}>
          {vw(locale, "hub.more", { n: more })}
        </p>
      ) : null}
      {watch.length ? (
        <section className="rpu-visit-group" data-testid="visit-record-watch">
          <SectionTitle>{vw(locale, "hub.watch")}</SectionTitle>
          <Timeline>
            {watch.map((l) => (
              <RecordLine key={l.id} line={l} locale={locale} />
            ))}
          </Timeline>
        </section>
      ) : null}
      {record && !told.length && !watch.length ? (
        <p className="rpu-visit-note" data-testid="visit-record-none">
          {vw(locale, "hub.none")}
        </p>
      ) : null}
      <Button variant="link" href={`/p/visit/${encodeURIComponent(visitId)}/review`} nav="forward" data-testid="visit-record-all">
        {vw(locale, "hub.all")}
      </Button>
    </div>
  );
}

export function VisitHub({
  locale,
  past,
  planned,
  sample,
  onSample,
  hub,
}: {
  locale: AccountLocale;
  /** his earlier visits as the flow has them: the newest first, five at most */
  past: PastVisit[];
  /** the planned visits from today on, the soonest first */
  planned: PlannedVisit[];
  /** the example account's sample visit: its planned row plays it */
  sample: { fixture: string } | null;
  onSample: () => void;
  hub: VisitHubData;
}) {
  const q = questionsCopy(locale);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // the oldest first: the line runs down from what happened into what comes next
  const earlier = [...past].reverse();
  const questions = hub.questions;
  return (
    <>
      <section className="rpu-visit-group" data-testid="visit-timeline" data-past={earlier.length} data-planned={planned.length}>
        <ListCard>
          {earlier.length === 0 ? (
            <div className="rpu-visit-row" data-testid="visit-past-none">
              <ListItem mark="miss" title={at(locale, "visit.empty")} />
            </div>
          ) : (
            earlier.map((p) => {
              const isOpen = open.has(p.id);
              const body = `rpu-visit-record-${p.id}`;
              return (
                <div key={p.id} className="rpu-visit-row" data-testid="visit-past-row" data-visit={p.id} data-open={isOpen ? "true" : "false"}>
                  <Explainable as="row" subject={{ type: "visit", ref: p.id }} locale={locale} label={p.label}>
                    {/* the row itself is the button (a row that is a button can be held: components/explain/Explainable.tsx) */}
                    <button type="button" className="rpu-li rpu-visit-fold" aria-expanded={isOpen} aria-controls={isOpen ? body : undefined} onClick={() => toggle(p.id)} data-testid="visit-past-toggle">
                      <ListMark kind="ok" />
                      <span className="rpu-li-main">
                        <span className="rpu-li-t">{p.date ?? p.label}</span>
                        {p.date && p.place ? <span className="rpu-li-s">{p.place}</span> : null}
                      </span>
                      <Chevron />
                    </button>
                  </Explainable>
                  {isOpen ? (
                    <div className="rpu-fold-body" id={body}>
                      <VisitRecord visitId={p.id} record={hub.records[p.id]} locale={locale} />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {planned.length === 0 ? (
            <div className="rpu-visit-row" data-testid="visit-next-none">
              <ListItem mark="todo" title={vw(locale, "hub.nextNone")} />
            </div>
          ) : (
            planned.map((p) => {
              const where = p.place ?? null;
              return (
                <div key={p.id} className="rpu-visit-row" data-testid="visit-planned-row" data-visit={p.id} data-today={p.today ? "true" : "false"}>
                  <Explainable as="row" subject={{ type: "visit", ref: p.id }} locale={locale} label={p.label}>
                    {p.id === sample?.fixture ? (
                      // the example's sample visit is this row: a tap plays it, and the row says it is a replay, as every
                      // screen of the replay does (real-app 4.6)
                      <ListItem
                        mark="todo"
                        title={p.label}
                        sub={
                          <>
                            {where ? `${where}\n` : null}
                            <span className="rpu-visit-row-act">{at(locale, "visit.sample")}</span> <Tag>{at(locale, "visit.sampleLabel")}</Tag>
                          </>
                        }
                        chevron
                        onClick={onSample}
                        testId="visit-sample-start"
                      />
                    ) : p.canBook ? (
                      // the row's words are long (「大约 11月20日的复诊（计划）」): what a tap does goes under them
                      <ListItem
                        mark="todo"
                        title={p.label}
                        sub={
                          <>
                            {where ? `${where}\n` : null}
                            <span className="rpu-visit-row-act">{at(locale, "visit.planned.book")}</span>
                          </>
                        }
                        chevron
                        href={`/p/visit?plan=${encodeURIComponent(p.id)}`}
                      />
                    ) : (
                      <ListItem mark="todo" title={p.label} sub={where ?? undefined} />
                    )}
                  </Explainable>
                </div>
              );
            })
          )}
          {/* the page for the doctor, with the next visit (it comes back here: ?from=visit) */}
          <div className="rpu-visit-row">
            <ListItem title={at(locale, "visit.before")} sub={at(locale, "visit.beforeSub")} chevron href="/p/brief?from=visit" testId="visit-brief" />
          </div>
        </ListCard>
      </section>

      {hub.signals.length ? (
        <section className="rpu-visit-group" data-testid="visit-signals" data-count={hub.signals.length}>
          <ListCard heading={vw(locale, "hub.signals")}>
            {hub.signals.map((s) => (
              <ListItem
                key={s.id}
                mark="me"
                title={<span lang={s.lang ?? undefined}>{s.text}</span>}
                sub={s.time ? `${s.date} ${s.time}` : s.date}
                testId="visit-signal"
                attrs={{ "data-signal": s.id }}
              />
            ))}
          </ListCard>
        </section>
      ) : null}

      <section className="rpu-visit-group" data-testid="visit-questions" data-total={questions?.total ?? undefined}>
        <ListCard heading={q.listName}>
          {questions === null ? (
            <ListItem title={q.openList} chevron href="/p/questions" testId="visit-questions-all" />
          ) : (
            <>
              {questions.shown.length === 0 ? <ListItem mark="todo" title={q.headlineNone.join(" ")} /> : null}
              {questions.shown.map((x) => (
                <Explainable key={x.id} as="row" subject={{ type: "question", ref: x.id }} locale={locale} label={x.text}>
                  <ListItem
                    mark="todo"
                    title={<span lang={x.lang ?? undefined}>{x.text}</span>}
                    right={x.pharmacist ? <Tag>{q.pharmacistTag}</Tag> : undefined}
                    testId="visit-question"
                    attrs={{ "data-question": x.id, "data-for": x.pharmacist ? "pharmacist" : "doctor" }}
                  />
                </Explainable>
              ))}
              {questions.total > 0 ? <ListItem title={q.seeAll(questions.total)} chevron href="/p/questions" testId="visit-questions-all" /> : null}
            </>
          )}
        </ListCard>
        {/* (asking Ripple is the round button at the bottom right of every page since the owner's 10-15: components/ask/AskFab.tsx) */}
        <SecondaryButton href="/p/questions/add" nav="forward" data-testid="visit-questions-add">
          {q.add}
        </SecondaryButton>
      </section>
    </>
  );
}
