/**
 * /p/questions on his own account (track C; journey 07 「他能自己加、改、跳过问题」, journeys 14 and 22), in the timeline
 * design (design group 14). Since the owner's decision of 10-14 the list is one list and part of the visit tab (its first
 * five are on /p/visit; this is 「看全部」): the doctor's and the pharmacist's questions together, in the list's order, a
 * question for the pharmacist marked by a small tag 「药剂师」 (no sides to switch between any more). One screen: the
 * screen's name with its one sentence under it, then one line:
 *
 *   what is still to ask as entries of the line: the node is his own, or Ripple's mark on a question Ripple put there;
 *              the head line says where the question came from and when, then his words, then 「改」 「跳过」 as one
 *              row of words (and 「合并」 for a second row with the same words); under them 「加一个问题」 (the draft's
 *              place; owner's tidy of 10-13), which is the first thing on the screen while nothing is to ask
 * and a card with the ways on: every answered question on one page (the answers are not listed on this screen any
 * more), the ones he set aside (each row only when it holds something), and 「预防：筛查和疫苗」. The brief for the
 * doctor is reached from the visit tab (with the next visit).
 * Server component; the buttons are QuestionActions.tsx. The demo's page is unchanged (page.tsx).
 */
import type { ReactNode } from "react";
import { pageZh } from "@/components/translate/DoctorZh";
import { Box, Bubble, ListCard, ListItem, PageHeader, Said, SaidTranslation, Screen, SecondaryButton, TabBar, Tag, Timeline, TimelineItem, TlControls } from "@/components/ui";
import { ORIGIN_WORDS } from "@/components/ui/QuestionRow";
import { questionsCopy, uiOrigin, type CLocale } from "@/lib/profile/copy";
import { clipAt, shortDate } from "@/lib/profile/dates";
import type { ListQuestion, QuestionList } from "@/lib/profile/questions";
import type { SessionRow } from "@/lib/store/types";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { uiCopy } from "@/lib/ui/copy";
import { WatchCard } from "@/components/watch/WatchCard";
import type { WatchCardData } from "@/lib/watch/today";
import { ListenButton, RowActions, UndoBar } from "./QuestionActions";
// owner 10-14: each question can be held for Ripple's read of it
import { Explainable } from "@/components/explain/Explainable";
import "./questions.css";

export interface QuestionsNotice {
  /** what just happened: an add's outcome, an edit, a skip or merge (with undo), a put back */
  kind: "created" | "merged" | "reopened" | "answered" | "edited" | "skip" | "merge" | "put_back";
  id: string | null;
}

export function noticeFrom(sp: Record<string, string | string[] | undefined>): QuestionsNotice | null {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const kind = one("added") ?? one("done");
  const ok = ["created", "merged", "reopened", "answered", "edited", "skip", "merge", "put_back"];
  return kind && ok.includes(kind) ? { kind: kind as QuestionsNotice["kind"], id: one("q") } : null;
}

/**
 * Where a question came from and when it went on the list: the entry's head line. One a family member put there from
 * her 「留意」 (owner 10-14) says so in that place, quietly: 「家人加的」, never who.
 */
function originOf(q: ListQuestion, locale: CLocale): { who: string; when: string | undefined } {
  return { who: q.fromFamily ? questionsCopy(locale).fromFamily : ORIGIN_WORDS[locale][uiOrigin(q.origin)], when: q.createdDate ? shortDate(q.createdDate, locale) : undefined };
}

/** A question Ripple put on the list (one it could not answer, a pattern it noticed): the entry's node is Ripple's mark, not his. */
function fromRipple(q: ListQuestion): boolean {
  const from = uiOrigin(q.origin);
  return from === "refused" || from === "pattern";
}

/** His words, as an entry's words. The class is the hook the list's rows always had. */
function Words({ q }: { q: ListQuestion }) {
  return (
    <span className="rpu-q-text" lang={q.lang ?? undefined}>
      {q.text}
    </span>
  );
}

/**
 * One question of his as an entry of the line (it must be a direct child of <Timeline>): his node, where it came from
 * and when, his words, and under them what the words are (a summary on record, his changed words), the small tag of a
 * question for the pharmacist (`tag`; the list has no sides since 10-14), the tag of what just happened to it, and its
 * buttons.
 */
export function QuestionLine({ q, locale, highlight, tag, actions }: { q: ListQuestion; locale: CLocale; highlight?: string | null; tag?: string | null; actions?: ReactNode }) {
  const c = questionsCopy(locale);
  const evidence = q.wording === "recorded_summary" ? c.summaryNote : q.summary ? `${c.summaryOf}${q.summary.text}` : q.edited ? c.edited : undefined;
  const { who, when } = originOf(q, locale);
  return (
    <TimelineItem
      node={fromRipple(q) ? "rip" : "me"}
      who={who}
      meta={when}
      note={evidence}
      attrs={{ "data-question": q.id, "data-for": q.for, "data-status": q.status, "data-wording": q.wording, "data-highlight": highlight ? "true" : undefined, "data-from-family": q.fromFamily ? "true" : undefined }}
      actions={
        highlight || tag || actions ? (
          <>
            {highlight || tag ? (
              <TlControls>
                {tag ? <Tag>{tag}</Tag> : null}
                {highlight ? <Tag tone="accent">{highlight}</Tag> : null}
              </TlControls>
            ) : null}
            {actions}
          </>
        ) : undefined
      }
    >
      {/* the words stay plain on Ripple's node too: the tinted bubble is for what Ripple says, and this is a question to ask */}
      <Bubble node="me">
        <Words q={q} />
      </Bubble>
    </TimelineItem>
  );
}

/** The answer's words: a clinician's in the serif with the checked Chinese under English ones; a line nobody was named for, plain. */
async function AnswerWords({ q, locale }: { q: ListQuestion; locale: CLocale }) {
  const c = questionsCopy(locale);
  const copy = uiCopy(locale);
  const a = q.answer;
  if (!a) return null;
  const when = c.at(shortDate(a.date, locale), clipAt(a.tStartMs));
  const speaker = a.speaker === "doctor" || a.speaker === "pharmacist" || a.speaker === "dispenser" ? a.speaker : null;
  const said = speaker === "pharmacist" ? c.pharmacistSaid : speaker === "dispenser" ? c.counterSaid : c.doctorSaid;
  // a speaker he has not confirmed keeps the foundation's own words for it (「好像是医生说的」)
  const who = !speaker ? c.recording : a.inferred ? (speaker === "doctor" ? copy.inferredDoctor : copy.sources[speaker]) : said;
  // C2 track S (round 2): the checked Chinese under a clinician's English answer (real-app 12)
  const zh = speaker && a.lang !== "zh-Hans" ? (await pageZh(locale))(a.text) : null;
  return (
    <div className="rp14q-answer" data-rp="question-answer" data-speaker={a.speaker} data-inferred={a.inferred ? "true" : "false"}>
      <p className="rpu-tl-head" data-rp="source-tag" data-kind={speaker ?? undefined} data-inferred={a.inferred ? "true" : undefined}>
        <span className="rpu-tl-who" data-node="doc">
          {who}
        </span>
        {when ? <span> · {when}</span> : null}
      </p>
      {speaker ? (
        <Said lang={a.lang === "zh-Hans" ? "zh-Hans" : "en"} source={{ kind: speaker, ref: `${a.visitId}:${q.id}` }}>
          {a.text}
        </Said>
      ) : (
        <Bubble node="dot" lang={a.lang}>
          {a.text}
        </Bubble>
      )}
      {zh ? (
        <div className="rp14q-zh" data-testid="answer-translation" lang="zh-Hans">
          <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{zh}</SaidTranslation>
        </div>
      ) : null}
      {a.clipUrl ? <ListenButton src={a.clipUrl} label={c.listen} standIn={a.standIn} locale={locale} /> : null}
    </div>
  );
}

/**
 * An answered question and its answer: two entries of the line (his node, then the node of who answered), kept as one
 * element (it must be a direct child of <Timeline>; questions.css lets the line run through it).
 */
export function AnsweredPair({ q, locale, highlight }: { q: ListQuestion; locale: CLocale; highlight?: boolean }) {
  const a = q.answer;
  const { who, when } = originOf(q, locale);
  const known = a && (a.speaker === "doctor" || a.speaker === "pharmacist" || a.speaker === "dispenser");
  return (
    <article className="rp14q-pair" data-rp="question" data-question={q.id} data-status="answered" data-highlight={highlight ? "true" : undefined}>
      <TimelineItem node={fromRipple(q) ? "rip" : "me"} who={who} meta={when}>
        <Bubble node="me">
          <Words q={q} />
        </Bubble>
      </TimelineItem>
      {a ? (
        <TimelineItem node={!known ? "dot" : a.inferred && a.speaker === "doctor" ? "unc" : "doc"}>
          <AnswerWords q={q} locale={locale} />
        </TimelineItem>
      ) : null}
    </article>
  );
}

/** The tag on the row the last action was about. */
function highlightWords(kind: QuestionsNotice["kind"], locale: CLocale): string | null {
  const c = questionsCopy(locale);
  if (kind === "created") return c.justAdded;
  if (kind === "merged") return c.alreadyThere;
  if (kind === "reopened" || kind === "put_back") return c.putBackTag;
  if (kind === "edited") return c.changedTag;
  return null;
}

export function AccountQuestions({
  list,
  locale,
  notice,
  watch = null,
}: {
  scope: SessionRow;
  list: QuestionList;
  locale: CLocale;
  notice: QuestionsNotice | null;
  /** the watch's observation he has not answered yet (要 puts a question for the doctor on this list) */
  watch?: WatchCardData | null;
}) {
  const c = questionsCopy(locale);
  const n = list.counts.open;
  // one list (owner 10-14): the doctor's and the pharmacist's together, in the list's order
  const open = list.open;
  // the watch's question would be one for the doctor: it is asked after his own questions (ux pass 10-12, round 8)
  const asks = watch;
  const message =
    notice?.kind === "created"
      ? c.noticeCreated
      : notice?.kind === "merged"
        ? c.noticeMerged
        : notice?.kind === "reopened" || notice?.kind === "put_back"
          ? c.noticeReopened
          : notice?.kind === "edited"
            ? c.noticeEdited
            : null;
  return (
    <Screen
      locale={locale}
      className="rp14q"
      // the list is part of 就诊 (owner 10-14): its first five are on the visit tab, which this page goes back to
      tabBar={<TabBar active="visit" locale={locale} placement="fixed" />}
      tabBarPlacement="fixed"
      toast={notice && (notice.kind === "skip" || notice.kind === "merge") && notice.id ? <UndoBar id={notice.id} kind={notice.kind} locale={locale} /> : undefined}
    >
      <PageHeader
        locale={locale}
        back={{ href: "/p/visit", label: uiCopy(locale).tabs.visit }}
        title={c.backToList}
        subtitle={
          // the screen's one sentence: how many questions wait for the next visit
          <span className="rp14q-headline" data-rp="headline" data-variant="status">
            {(n > 0 ? c.headlineSome(n) : c.headlineNone).join(" ")}
          </span>
        }
      />
      <div className="rpu-stack">
        {message && (
          <div role="status" data-rp="questions-notice" data-notice={notice?.kind}>
            <Box variant="tint" title={message} />
          </div>
        )}
        {open.length > 0 || asks ? (
          <section className="rpu-stack" data-rp="questions-open" aria-label={c.stillToAsk} data-count={open.length}>
            <Timeline>
              {open.map((q) => (
                <Explainable key={q.id} as="line" subject={{ type: "question", ref: q.id }} locale={locale} label={q.text}>
                  <QuestionLine
                    q={q}
                    locale={locale}
                    highlight={notice?.id === q.id ? highlightWords(notice.kind, locale) : null}
                    tag={q.for === "pharmacist" ? c.pharmacistTag : null}
                    actions={<RowActions id={q.id} locale={locale} canEdit={q.canEdit} duplicateOf={q.duplicateOf} editHref={`/p/questions/${encodeURIComponent(q.id)}/edit`} />}
                  />
                </Explainable>
              ))}
              {asks ? <WatchCard card={asks} locale={locale} mode="list" /> : null}
            </Timeline>
          </section>
        ) : null}
        {/* 「加一个问题」 is under what is still to ask and above 「回答过的」 (the draft's place; owner's tidy of 10-13).
            With nothing to ask it is the first thing on the screen */}
        <SecondaryButton href="/p/questions/add" nav="forward" data-testid="questions-add">
          <span aria-hidden="true">＋ </span>
          {c.add}
        </SecondaryButton>
        {/* a row for the answered ones and for the skipped ones only when there are some; the brief's row is gone, and
            prevention is reached from here (owner's tidy of 10-13) */}
        <ListCard>
          {list.counts.answered > 0 ? <ListItem title={c.answeredLink} right={c.count(list.counts.answered)} chevron href="/p/questions/answered" /> : null}
          {list.counts.skipped > 0 ? <ListItem title={c.skippedLink} right={c.count(list.counts.skipped)} chevron href="/p/questions/skipped" /> : null}
          <ListItem title={c.preventLink} chevron href="/p/prevent" testId="questions-prevent" />
        </ListCard>
      </div>
    </Screen>
  );
}
