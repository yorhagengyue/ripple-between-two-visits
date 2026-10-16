import type { ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { QuotedBlock, type QuotedWords } from "./AnswerCards";
import { Icon, type IconName } from "./icons";
import { Tag } from "./Tag";

/** Where a question on his list came from (brief 6.7). Each one has an icon and a word. */
export type QuestionOrigin = "own" | "refused" | "pattern" | "unknown_medicine" | "prevention" | "watch" | "before_you_go" | "reading";

const ORIGIN_ICON: Record<QuestionOrigin, IconName> = {
  own: "user",
  refused: "ripple",
  pattern: "pattern",
  unknown_medicine: "box",
  prevention: "shield",
  watch: "watch",
  before_you_go: "list",
  reading: "pulse",
};

export const ORIGIN_WORDS: Record<UiLocale, Record<QuestionOrigin, string>> = {
  "zh-Hans": {
    own: "我自己想问的",
    refused: "Ripple 不能回答的",
    pattern: "Ripple 发现的规律",
    unknown_medicine: "认不出的药",
    prevention: "预防",
    watch: "手表",
    before_you_go: "离开前要问的",
    reading: "量血压时记下的",
  },
  en: {
    own: "My own question",
    refused: "Ripple couldn't answer",
    pattern: "A pattern Ripple noticed",
    unknown_medicine: "A medicine nobody could name",
    prevention: "Prevention",
    watch: "Watch",
    before_you_go: "Before you go",
    reading: "From a blood pressure reading",
  },
};

/**
 * One question on 「要问的」: for whom (问医生 / 问药剂师), where it came from (icon + words), the question in his own
 * words (sans), the evidence for a pattern, and, once asked, the answer as the doctor's or pharmacist's own words
 * with their listen button. Hairline under each; no card.
 */
export function QuestionRow({
  text,
  forWhom,
  origin,
  locale,
  when,
  evidence,
  answer,
  filming,
  className,
  style,
}: UiBaseProps & {
  /** his question, his words */
  text: ReactNode;
  forWhom: "doctor" | "pharmacist";
  origin: QuestionOrigin;
  locale: UiLocale;
  /** when it was added: 「9月22日」 */
  when?: string;
  /** a pattern's facts, described, never advice: 「漏吃的 4 个早上都在打太极的日子」 */
  evidence?: ReactNode;
  /** the answer, once asked: someone's exact words */
  answer?: QuotedWords;
}) {
  const copy = uiCopy(locale);
  return (
    <article className={cx("rpu rpu-q", className)} data-rp="question" data-status={answer ? "answered" : "open"} data-origin={origin} {...filmingAttr(filming)} style={style}>
      <div className="rpu-q-meta">
        <Tag tone={forWhom === "doctor" ? "doctor" : "ink"} icon={forWhom === "doctor" ? "steth" : "bottle"}>
          {forWhom === "doctor" ? copy.askDoctor : copy.askPharmacist}
        </Tag>
        <span className="rpu-q-origin">
          <Icon name={ORIGIN_ICON[origin]} />
          {ORIGIN_WORDS[locale][origin]}
          {when ? ` · ${when}` : ""}
        </span>
      </div>
      <p className="rpu-q-text">
        {text}
      </p>
      {evidence && <p className="rpu-q-evidence">{evidence}</p>}
      {answer ? (
        <div className="rpu-q-answer">
          <QuotedBlock quote={answer} locale={locale} />
        </div>
      ) : (
        <span>
          <Tag tone="neutral">{copy.notAskedYet}</Tag>
        </span>
      )}
    </article>
  );
}
