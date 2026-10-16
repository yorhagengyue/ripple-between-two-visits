import type { MouseEventHandler, ReactNode } from "react";
import { fill, uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ButtonPair, PrimaryButton, SecondaryButton } from "./Buttons";
import { Said } from "./Said";
import { ActionDock } from "./Screen";
import { SourceLink } from "./SourceLink";
import { SourceTag } from "./SourceTag";
import { StatusHeadline } from "./StatusHeadline";

export type ReviewAnswer = "yes" | "no" | "unsure";

/**
 * At home after the visit, one line at a time (tone v2 ⑤, brief 6.2-3): 「第 3 件 / 共 12 件」 and a segment bar,
 * the line in serif under 「好像是医生说的 · 0:49」 (dashed badge: a guess), 「听这一句」, then in the lower half
 * 「这句是医生说的吗？」 with 「是，医生说的」 / 「不是」 / 「不记得」. One tap per line; only 「是」 makes it
 * 「医生说」 anywhere else. 「不是」 marks the line, it never deletes the doctor's words.
 */
export function ReviewSentence({
  index,
  total,
  sentence,
  lang,
  utteranceId,
  at,
  locale,
  listenHref,
  onListen,
  standIn = false,
  onAnswer,
  answerHrefs,
  allowUnsure = true,
  context,
  filming,
  className,
  style,
}: UiBaseProps & {
  /** 1-based */
  index: number;
  total: number;
  /** the transcript line, exactly as heard */
  sentence: ReactNode;
  /** the line's own language */
  lang: UiLocale;
  /** the utterance id (Said's source ref), e.g. "v1-u08" */
  utteranceId: string;
  /** where in the recording: "0:49" */
  at: string;
  locale: UiLocale;
  listenHref?: string;
  onListen?: MouseEventHandler<HTMLButtonElement>;
  standIn?: boolean;
  onAnswer?: (answer: ReviewAnswer) => void;
  /** server pages: each answer as a link (e.g. a form action URL) */
  answerHrefs?: Partial<Record<ReviewAnswer, string>>;
  allowUnsure?: boolean;
  /** the line above the bar, e.g. 「刚才的看诊」 */
  context?: ReactNode;
}) {
  const copy = uiCopy(locale);
  const progress = fill(copy.reviewOf, { i: index, n: total });
  const button = (answer: ReviewAnswer, label: string, Variant: typeof PrimaryButton) =>
    answerHrefs?.[answer] ? (
      <Variant href={answerHrefs[answer]!}>{label}</Variant>
    ) : (
      <Variant onClick={onAnswer ? () => onAnswer(answer) : undefined} data-answer={answer}>
        {label}
      </Variant>
    );
  return (
    <section className={cx("rpu rpu-review", className)} data-rp="review" data-index={index} {...filmingAttr(filming)} style={style}>
      <p className="rpu-label" style={{ color: "var(--rp-ink-2)" }}>
        {context ? (
          <>
            {context} · {progress}
          </>
        ) : (
          progress
        )}
      </p>
      <div className="rpu-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index} aria-label={progress}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} data-on={i < index ? "true" : "false"} />
        ))}
      </div>
      <SourceTag kind="doctor" inferred locale={locale} when={at} style={{ marginTop: 18 }} />
      <Said lang={lang} source={{ kind: "doctor", ref: utteranceId }}>
        {sentence}
      </Said>
      <SourceLink kind="doctor" play href={listenHref} onClick={onListen} time={at} standIn={standIn} locale={locale}>
        {copy.listenThis}
      </SourceLink>
      <ActionDock>
        <StatusHeadline variant="ask" lines={[copy.reviewAsk]} />
        {button("yes", copy.reviewYes, PrimaryButton)}
        {allowUnsure ? (
          <ButtonPair>
            {button("no", copy.reviewNo, SecondaryButton)}
            {button("unsure", copy.reviewUnsure, SecondaryButton)}
          </ButtonPair>
        ) : (
          button("no", copy.reviewNo, SecondaryButton)
        )}
      </ActionDock>
    </section>
  );
}
