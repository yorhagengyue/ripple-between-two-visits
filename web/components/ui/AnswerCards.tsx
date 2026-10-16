import type { MouseEventHandler, ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { SpeakerKind, UiLocale } from "@/lib/ui/tokens";
import { BodyText } from "./BodyText";
import { ButtonPair, PrimaryButton, SecondaryButton } from "./Buttons";
import { EmergencyBlock, Hotlines, type Hotline } from "./EmergencyBlock";
import { Icon } from "./icons";
import { LabelOriginal } from "./LabelOriginal";
import { AddedRow, Divider } from "./Rows";
import { Said } from "./Said";
import { SourceLink } from "./SourceLink";
import { SourceTag } from "./SourceTag";
import { StatusHeadline } from "./StatusHeadline";

/*
 * The answer to whatever he asks on Today (brief 7): one skeleton, every part labelled by where it comes from.
 * Seven shapes, each its own component; the safety layer decides which one and passes the words in:
 *   AnswerExplain     leaflet restatement + the doctor's words          (「这个药是做什么的」)
 *   AnswerRefer       Ripple's fixed referral + doctor's words + label + 「已在问题单里」  (the hero)
 *   AnswerUnknownMed  the fixed English sentence + one Chinese line + 「问药剂师」 added
 *   AnswerNoted       「记下了。」 (+ 「今天的药吃了吗？」 when today's is not logged)
 *   AnswerCantHelp    「这个我帮不上，要我记下来吗？」 + 要 / 不用
 *   AnswerEmergency   995 (the red block)
 *   AnswerSelfHarm    995, SOS 1767, CareText, mindline 1771 (+ Care Corner in 华语), calm
 * No component here writes a clinical sentence of its own: every clinical word is a prop.
 */

/** His question as the title, 「你问」 above it. */
export function AnswerQuestion({ question, locale, filming, className, style }: UiBaseProps & { question: readonly ReactNode[]; locale: UiLocale }) {
  return <StatusHeadline variant="question" kicker={uiCopy(locale).asked} lines={question} filming={filming} className={className} style={style} />;
}

/**
 * Ripple's own fixed sentence (sans: nobody's quoted words), with its name run in front: the Ripple icon, the word
 * 「Ripple」 and its colour, then the sentence on the same line (one row less than a separate tag).
 */
export function RippleLine({ children, locale, lang, filming, className, style }: UiBaseProps & { children: ReactNode; locale: UiLocale; lang?: string }) {
  return (
    <p className={cx("rpu rpu-text rpu-answer-part", className)} data-rp="ripple-line" data-rp-role="body" data-variant="answer" lang={lang} {...filmingAttr(filming)} style={{ marginTop: 10, ...style }}>
      <span className="rpu-runin" data-kind="ripple" lang="en">
        <span className="rpu-runin-badge" aria-hidden="true">
          <Icon name="ripple" />
        </span>
        {uiCopy(locale).sources.ripple}
      </span>
      {children}
    </p>
  );
}

export interface QuotedWords {
  /** whose words */
  kind: SpeakerKind;
  /** the tag words: 「Dr Lim 说过」 */
  who: ReactNode;
  /** date and clip time on the right of the tag: 「9月1日 · 0:43」 */
  when?: string;
  /** the record id (Said's source ref): "v2-u08" */
  ref: string;
  lang: UiLocale;
  text: ReactNode;
  /** the listen button: words, where it plays, clip time, stand-in voice */
  listen?: { label: ReactNode; href: string; time?: string; standIn?: boolean };
}

/** Someone's exact words with their tag, the coloured rule and the listen button. */
export function QuotedBlock({ quote, locale, filming, className, style }: UiBaseProps & { quote: QuotedWords; locale: UiLocale }) {
  return (
    <div className={cx("rpu rpu-answer-part", className)} data-rp="quoted" {...filmingAttr(filming)} style={style}>
      <SourceTag kind={quote.kind} locale={locale} when={quote.when}>
        {quote.who}
      </SourceTag>
      <Said lang={quote.lang} ruled source={{ kind: quote.kind, ref: quote.ref }}>
        {quote.text}
      </Said>
      {quote.listen && (
        <SourceLink kind={quote.kind} play href={quote.listen.href} time={quote.listen.time} standIn={quote.listen.standIn} locale={locale}>
          {quote.listen.label}
        </SourceLink>
      )}
    </div>
  );
}

export interface LabelWords {
  /** the restated line: 「每天早上吃一粒。」 (none in the English UI, where the printed line says it) */
  restated?: ReactNode;
  /** the label as printed: "Take ONE tablet every MORNING" */
  printed: string;
  /** the button to the label photo and its text */
  open?: { label: ReactNode; href: string; time?: string };
}

/** 「药袋上写着」: the restated line in sans, the printed line in mono, and the button to the label. */
export function LabelBlock({ label, locale, filming, className, style }: UiBaseProps & { label: LabelWords; locale: UiLocale }) {
  return (
    <div className={cx("rpu rpu-answer-part", className)} data-rp="label-block" {...filmingAttr(filming)} style={style}>
      <SourceTag kind="label" locale={locale} style={{ marginTop: 12 }} />
      {label.restated && <BodyText variant="strong">{label.restated}</BodyText>}
      <LabelOriginal>{label.printed}</LabelOriginal>
      {label.open && (
        <SourceLink kind="label" href={label.open.href} time={label.open.time} locale={locale}>
          {label.open.label}
        </SourceLink>
      )}
    </div>
  );
}

export interface LeafletWords {
  /** 「单张写着」 lines: our restatement of the official leaflet, with its citation */
  lines: readonly ReactNode[];
  /** where it is from, e.g. 「HealthHub 单张转述」 */
  from?: ReactNode;
  open?: { label: ReactNode; href: string; time?: string };
}

/** 「单张写着」: restated leaflet lines (sans, they are our words of the leaflet), the source, the open button. */
export function LeafletBlock({ leaflet, locale, filming, className, style }: UiBaseProps & { leaflet: LeafletWords; locale: UiLocale }) {
  return (
    <div className={cx("rpu rpu-answer-part", className)} data-rp="leaflet-block" {...filmingAttr(filming)} style={style}>
      <SourceTag kind="leaflet" locale={locale} style={{ marginTop: 14 }} />
      {leaflet.lines.map((line, i) => (
        <BodyText key={i}>{line}</BodyText>
      ))}
      {leaflet.from && <p className="rpu-cite">{leaflet.from}</p>}
      {leaflet.open && (
        <SourceLink kind="leaflet" href={leaflet.open.href} time={leaflet.open.time} locale={locale}>
          {leaflet.open.label}
        </SourceLink>
      )}
    </div>
  );
}

interface AnswerBase extends UiBaseProps {
  locale: UiLocale;
  /** his question, one entry per line */
  question: readonly ReactNode[];
}

function Answer({ kind, children, filming, className, style }: UiBaseProps & { kind: string; children: ReactNode }) {
  return (
    <section className={cx("rpu rpu-answer", className)} data-rp="answer" data-answer={kind} {...filmingAttr(filming)} style={style}>
      {children}
    </section>
  );
}

/** Explain (「这个药是做什么的」): the leaflet, restated and cited, then the doctor's own words. */
export function AnswerExplain({ locale, question, leaflet, quote, filming, className, style }: AnswerBase & { leaflet: LeafletWords; quote?: QuotedWords }) {
  return (
    <Answer kind="explain" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <LeafletBlock leaflet={leaflet} locale={locale} />
      {quote && (
        <>
          <Divider />
          <QuotedBlock quote={quote} locale={locale} />
        </>
      )}
    </Answer>
  );
}

/**
 * Refuse and refer (the hero: 「今天 150/95，我能不能多吃一粒？」): Ripple's one fixed sentence, the doctor's words,
 * the label, and 「✓ 已在下次看诊的问题单里 ›」 at the foot. The doctor's 995 line (R2) is not repeated here.
 */
export function AnswerRefer({
  locale,
  question,
  ripple,
  quote,
  label,
  addedHref,
  addedLabel,
  filming,
  className,
  style,
}: AnswerBase & { ripple: ReactNode; quote?: QuotedWords; label?: LabelWords; addedHref: string; addedLabel?: ReactNode }) {
  return (
    <Answer kind="refer" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <RippleLine locale={locale}>{ripple}</RippleLine>
      {(quote || label) && <Divider />}
      {quote && <QuotedBlock quote={quote} locale={locale} />}
      {label && <LabelBlock label={label} locale={locale} />}
      <AddedRow href={addedHref} atBottom>
        {addedLabel ?? uiCopy(locale).added}
      </AddedRow>
    </Answer>
  );
}

/**
 * A medicine Ripple cannot identify: the fixed English sentence as it is (character for character), one Chinese
 * line under it in the 华语 UI, and the question for the pharmacist added to the list.
 */
export function AnswerUnknownMed({
  locale,
  question,
  sentence,
  zhLine,
  addedHref,
  addedLabel,
  filming,
  className,
  style,
}: AnswerBase & { sentence: string; zhLine?: ReactNode; addedHref: string; addedLabel: ReactNode }) {
  return (
    <Answer kind="unknown_med" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <RippleLine locale={locale} lang="en">
        {sentence}
      </RippleLine>
      {zhLine && locale === "zh-Hans" && <BodyText variant="lede">{zhLine}</BodyText>}
      <AddedRow href={addedHref} atBottom>
        {addedLabel}
      </AddedRow>
    </Answer>
  );
}

/** Note only (「我今天好累」): 「记下了。」, and the check-in question when today's medicine is not logged yet. */
export function AnswerNoted({
  locale,
  question,
  noted,
  checkIn,
  checkInHref,
  checkInLabel,
  filming,
  className,
  style,
}: AnswerBase & { noted: ReactNode; checkIn?: ReactNode; checkInHref?: string; checkInLabel?: ReactNode }) {
  return (
    <Answer kind="noted" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <RippleLine locale={locale}>{noted}</RippleLine>
      {checkIn && (
        <>
          <Divider />
          <BodyText variant="strong" style={{ marginTop: 0 }}>
            {checkIn}
          </BodyText>
          {checkInHref && (
            <SecondaryButton href={checkInHref} style={{ marginTop: 14 }}>
              {checkInLabel ?? uiCopy(locale).taken}
            </SecondaryButton>
          )}
        </>
      )}
    </Answer>
  );
}

/** Can't help (the weather): 「这个我帮不上，要我记下来吗？」 and two worded buttons. */
export function AnswerCantHelp({
  locale,
  question,
  sentence,
  onYes,
  onNo,
  yesHref,
  noHref,
  filming,
  className,
  style,
}: AnswerBase & {
  sentence: ReactNode;
  onYes?: MouseEventHandler<HTMLButtonElement>;
  onNo?: MouseEventHandler<HTMLButtonElement>;
  yesHref?: string;
  noHref?: string;
}) {
  const copy = uiCopy(locale);
  return (
    <Answer kind="cant_help" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <RippleLine locale={locale}>{sentence}</RippleLine>
      <div className="rpu-dock">
        <ButtonPair>
          {yesHref ? <PrimaryButton href={yesHref}>{copy.yesNote}</PrimaryButton> : <PrimaryButton onClick={onYes}>{copy.yesNote}</PrimaryButton>}
          {noHref ? (
            <SecondaryButton href={noHref} style={{ minHeight: "var(--rp-h-primary)" }}>
              {copy.noNote}
            </SecondaryButton>
          ) : (
            <SecondaryButton onClick={onNo} style={{ minHeight: "var(--rp-h-primary)" }}>
              {copy.noNote}
            </SecondaryButton>
          )}
        </ButtonPair>
      </div>
    </Answer>
  );
}

/** Emergency: only 995, the red block, the number the biggest thing on screen. No model words. */
export function AnswerEmergency({ locale, question, sentence, filming, className, style }: AnswerBase & { sentence: ReactNode }) {
  return (
    <Answer kind="emergency" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <EmergencyBlock title={sentence} call={{ number: "995" }} locale={locale} />
    </Answer>
  );
}

/** Self-harm: the fixed sentences in order, each number one tap to call; calm, no lecture. */
export function AnswerSelfHarm({ locale, question, lines, filming, className, style }: AnswerBase & { lines: readonly Hotline[] }) {
  return (
    <Answer kind="self_harm" filming={filming} className={className} style={style}>
      <AnswerQuestion question={question} locale={locale} />
      <SourceTag kind="ripple" locale={locale} style={{ marginTop: 14 }} />
      <Hotlines lines={lines} locale={locale} />
    </Answer>
  );
}
