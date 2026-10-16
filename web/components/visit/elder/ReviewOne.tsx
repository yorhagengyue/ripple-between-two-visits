"use client";

/**
 * One line of the after-visit review on his phone, as entries of the review's timeline (the timeline draft's 05-4,
 * 05-5, 05-7): the line he is asked about is a dashed card with the dashed ring (the speaker is still a guess), the
 * line word for word in the serif face, 「听这一句」 when the line has a clip. Only 「是」 makes it 「医生说」 anywhere
 * else; 「不是」 flags the line, it never deletes the doctor's words.
 *
 *   ReviewOne      the line being asked about (data-testid="review-one"): 「0:49 好像是医生说的」, the line, its checked
 *                  Chinese under the English, the play pill. Every entry here must be a direct child of <Timeline>.
 *   ReviewedLine   the line before it, as he answered it: quieter, with what he said about it
 *   HeldLine       05-5, right after 「不是」: the same line stays on the screen with 「你说不对 · 已加进问题单」 and the
 *                  sentence that it is kept
 *   WaitingLine    「下一件，等你认」 at the next line's time point
 *   ReviewDock     the question and the three answers, in the strip at the foot of the screen
 *   HeldDock       05-5's strip: 「已记下：不是 · 撤销 12 秒」 and 「下一件」
 *
 * The doctor's English lines get their Chinese translation once, at the end of the visit (lib/visit/translate.ts through
 * track S's lib/translate: two checks), shown under the English with 「翻译 · 以原话为准」; a line without one (no consent
 * to AI processing, a check said no, the model offline) stays in English alone, with the original audio (05-7b).
 *
 * Test hooks kept from the first build: review-one (data-line, data-key, data-verdict, data-index), inside it
 * [data-rp="said"] (this line only), [data-rp="source-tag"] (the guess and the time point), review-asked,
 * review-translation, review-listen (data-clip-url, data-playing, one button); review-yes / review-no / review-unsure
 * (data-answer). The words 「第 3 件 / 共 8 件」 are in the header's second line, and once more inside review-one for a
 * screen reader (and the journeys that read it there).
 */
import type { ReactNode } from "react";
import { ButtonRow, PrimaryButton, Said, SaidTranslation, SecondaryButton, Tag, TimelineItem, TlNote, UndoToast } from "@/components/ui";
import type { UtteranceRole } from "@/lib/store/types";
import { at, clipTimeLabel, reviewSpeaker, type AccountLocale } from "@/lib/visit/account-copy";
import type { ClipView, DocVariant } from "@/lib/visit/types";
import type { ItemVerdict } from "@/lib/visit/verdict";
import { AskedWords } from "./AskedWords";
import { ClipRow, VisitDock } from "./parts";
import { vw } from "./words";

export interface ReviewEntry {
  /** a stable key: the card's anchor line, or the question list item */
  key: string;
  lineId: string;
  /** the items his answer applies to (a card's rows, or the answer's item) */
  itemIds: string[];
  /** the line as said */
  text: string;
  /** the line's language ("en", "zh", "zh-en", "en-SG") */
  lang: string | null;
  role: UtteranceRole;
  tStartMs: number;
  clip: ClipView | null;
  /** an answer to a question on his list: its words (as his question list shows them) */
  question: string | null;
  /** those words are his own (「你问：」); false: a question on his list worded by someone else (never shown as his) */
  questionOwn?: boolean;
  verdict: ItemVerdict | null;
  /** the kept Chinese of the clinician's English line (checked twice), or null */
  translation?: string | null;
  /** what the record holds this line as (a doctor's-note card's rows): the entry's small title in the record */
  rows?: { variant: DocVariant; drugName?: string; strength?: string }[];
  /** the warning line, or a line that sends him to 995 or A&E: 「不是」 keeps it on the emergency path (lib/visit/verdict.ts) */
  emergency?: boolean;
}

export const lineLang = (lang: string | null): AccountLocale => (lang && lang.startsWith("zh") ? "zh-Hans" : "en");

/** 「第 3 件 / 共 8 件」 */
export function progressWords(locale: AccountLocale, index: number, total: number): string {
  return locale === "en" ? `Item ${index} of ${total}` : `第 ${index} 件 / 共 ${total} 件`;
}

/** What he said about a line: 「医生说」, 「你说不对 · 已加进问题单」, 「不记得」, 「还没认」. */
export function verdictWords(locale: AccountLocale, e: Pick<ReviewEntry, "verdict" | "role">): string {
  if (e.verdict === "right") {
    const sp = reviewSpeaker(e.role);
    return at(locale, sp === "doctor" ? "review.verdict.right" : sp === "dispenser" ? "review.verdict.right.dispenser" : "review.verdict.right.pharmacist");
  }
  if (e.verdict === "wrong") return at(locale, "review.verdict.wrong");
  if (e.verdict === "unsure") return at(locale, "review.verdict.unsure");
  return at(locale, "review.verdict.none");
}

/** The head line of a line he has not said 「是」 to: the time point and the guess, in words (the hook the journeys read). */
function GuessHead({ entry, locale }: { entry: ReviewEntry; locale: AccountLocale }) {
  const speaker = reviewSpeaker(entry.role);
  return (
    <p className="rpu-tl-head" data-rp="source-tag" data-kind={speaker} data-inferred="true">
      <span className="rpu-tl-time">{clipTimeLabel(entry.tStartMs)}</span>
      <span className="rpu-tl-who">{at(locale, `review.inferred.${speaker}`)}</span>
    </p>
  );
}

function Translation({ entry, locale }: { entry: ReviewEntry; locale: AccountLocale }) {
  if (!entry.translation) return null;
  return (
    <div style={{ display: "contents" }} data-testid="review-translation">
      <SaidTranslation note={at(locale, "review.translationTag")}>{entry.translation}</SaidTranslation>
    </div>
  );
}

export function ReviewOne({
  entry,
  index,
  total,
  context,
  locale,
}: {
  entry: ReviewEntry;
  /** 1-based */
  index: number;
  total: number;
  /** 「10月12日的看诊」 */
  context: string;
  locale: AccountLocale;
}) {
  const speaker = reviewSpeaker(entry.role);
  return (
    <TimelineItem node="unc" frame="dash" testId="review-one" attrs={{ "data-index": index, "data-line": entry.lineId, "data-key": entry.key, "data-verdict": entry.verdict ?? "none" }}>
      <span className="rpu-sr">
        {context} · {progressWords(locale, index, total)}
      </span>
      {entry.question ? <AskedWords question={{ text: entry.question, own: entry.questionOwn !== false }} locale={locale} /> : null}
      <GuessHead entry={entry} locale={locale} />
      <Said lang={lineLang(entry.lang)} source={{ kind: speaker, ref: entry.lineId }}>
        “{entry.text}”
      </Said>
      <Translation entry={entry} locale={locale} />
      <ClipRow clip={entry.clip} label={at(locale, "review.listen")} locale={locale} testId="review-listen" />
    </TimelineItem>
  );
}

/** The line before the one on screen, as he answered it: the solid ring and 「医生说 · 你认过」 only after 「是」. */
export function ReviewedLine({ entry, locale }: { entry: ReviewEntry; locale: AccountLocale }) {
  const right = entry.verdict === "right";
  const speaker = reviewSpeaker(entry.role);
  return (
    <TimelineItem
      node={right ? "doc" : "unc"}
      className="rpu-visit-quiet"
      time={clipTimeLabel(entry.tStartMs)}
      who={right ? verdictWords(locale, entry) : at(locale, `review.inferred.${speaker}`)}
      meta={right ? vw(locale, "review.checked") : verdictWords(locale, entry)}
      testId="review-before"
      attrs={{ "data-line": entry.lineId, "data-verdict": entry.verdict ?? "none" }}
    >
      <blockquote className="rpu-visit-said" data-lang={lineLang(entry.lang) === "en" ? "en" : "zh"} lang={lineLang(entry.lang)}>
        “{entry.text}”
      </blockquote>
    </TimelineItem>
  );
}

/** 05-5: the line he just said 「不是」 to. It stays, flagged; nothing is deleted. */
export function HeldLine({ entry, index, total, context, locale }: { entry: ReviewEntry; index: number; total: number; context: string; locale: AccountLocale }) {
  return (
    <TimelineItem node="unc" frame="dash" testId="review-held" attrs={{ "data-index": index, "data-line": entry.lineId, "data-key": entry.key, "data-verdict": entry.verdict ?? "none" }}>
      <span className="rpu-sr">
        {context} · {progressWords(locale, index, total)}
      </span>
      {entry.question ? <AskedWords question={{ text: entry.question, own: entry.questionOwn !== false }} locale={locale} /> : null}
      <GuessHead entry={entry} locale={locale} />
      <blockquote className="rpu-visit-said" data-lang={lineLang(entry.lang) === "en" ? "en" : "zh"} lang={lineLang(entry.lang)}>
        “{entry.text}”
      </blockquote>
      <Translation entry={entry} locale={locale} />
      <ClipRow clip={entry.clip} label={at(locale, "review.listen")} locale={locale} testId="review-listen">
        <Tag tone="ink">{verdictWords(locale, entry)}</Tag>
      </ClipRow>
      <TlNote>{vw(locale, entry.emergency ? "review.keptWarning" : "review.kept")}</TlNote>
    </TimelineItem>
  );
}

/** 「下一件，等你认」 at the next line's time point. */
export function WaitingLine({ entry, locale }: { entry: ReviewEntry; locale: AccountLocale }) {
  return <TimelineItem node="miss" time={clipTimeLabel(entry.tStartMs)} title={<span className="rpu-visit-waiting">{vw(locale, "review.next")}</span>} testId="review-after" />;
}

/** The question about the line on screen and its three answers. */
export function ReviewDock({ entry, locale, busy, onAnswer }: { entry: ReviewEntry; locale: AccountLocale; busy: boolean; onAnswer: (verdict: ItemVerdict) => void }) {
  const speaker = reviewSpeaker(entry.role);
  return (
    <VisitDock>
      <p className="rpu-visit-ask" data-rp="headline" data-variant="ask">
        {at(locale, `review.ask.${speaker}`)}
      </p>
      <PrimaryButton onClick={() => onAnswer("right")} pending={busy} data-answer="right" data-testid="review-yes">
        {at(locale, `review.yes.${speaker}`)}
      </PrimaryButton>
      <ButtonRow cols={2}>
        <SecondaryButton onClick={() => onAnswer("wrong")} disabled={busy} data-answer="wrong" data-testid="review-no">
          {at(locale, "review.no")}
        </SecondaryButton>
        <SecondaryButton onClick={() => onAnswer("unsure")} disabled={busy} data-answer="unsure" data-testid="review-unsure">
          {at(locale, "review.unsure")}
        </SecondaryButton>
      </ButtonRow>
    </VisitDock>
  );
}

/** 05-5's strip: his 「不是」 can be taken back for 12 seconds; 「下一件」 goes on. */
export function HeldDock({
  locale,
  busy,
  undo,
  last,
  onUndo,
  onUndoGone,
  onNext,
}: {
  locale: AccountLocale;
  busy: boolean;
  /** the undo bar is still up (a number that changes with each 「不是」: the bar's clock starts again) */
  undo: number | null;
  /** nothing is left to ask after this line */
  last: boolean;
  onUndo: () => void;
  onUndoGone: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <VisitDock>
      {undo !== null ? (
        <div data-testid="review-undo" key={undo}>
          <UndoToast placement="inline" message={vw(locale, "review.undoNo")} locale={locale} onUndo={onUndo} onExpire={onUndoGone} />
        </div>
      ) : null}
      <PrimaryButton onClick={onNext} pending={busy} data-testid="review-next">
        {vw(locale, last ? "review.toSummary" : "review.nextOne")}
      </PrimaryButton>
    </VisitDock>
  );
}
