import type { ReactNode } from "react";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";

/**
 * Someone's own words (the doctor's, Dad's, hers), as the v3 draft draws 引用原话: who and the time point in quiet grey
 * with one small action at the right (「听原声」), then the words behind a thin white rule on the left: no ground, no
 * card, no colour per speaker. English as said on top (17px, bright), a checked Chinese translation under it (16px,
 * quiet). The page says once that translations follow the English; `zhNote` is kept for a caller that still wants the
 * line under one quote.
 */
export function Quote({
  who,
  words,
  lang,
  zh,
  zhNote,
  source,
  action,
  kind = "family",
  className,
  style,
  ...rest
}: FamilyBaseProps & {
  who?: ReactNode;
  words: ReactNode;
  /** the language of the words as said */
  lang?: string;
  /** a translation that passed both checks, shown under the English */
  zh?: ReactNode;
  /** 「中文翻译 · 以英文原话为准」 under this quote (her pages say it once per page instead) */
  zhNote?: ReactNode;
  /** a quiet line under the words: why, or where it came from */
  source?: ReactNode;
  /** at the right of the head line: 「听原声」 */
  action?: ReactNode;
  kind?: "family" | "doctor" | "check";
  "data-testid"?: string;
}) {
  return (
    <figure className={cx("rpf rpf-quote", className)} data-kind={kind === "family" ? undefined : kind} data-rp="quote" data-testid={rest["data-testid"]} style={style}>
      {(who || action) && (
        <div className="rpf-quote-head">
          <p className="rpf-quote-who">{who}</p>
          {action}
        </div>
      )}
      <div className="rpf-quote-body">
        <blockquote className="rpf-quote-words" lang={lang}>
          {words}
        </blockquote>
        {zh && (
          <p className="rpf-quote-zh" lang="zh-Hans">
            {zh}
          </p>
        )}
      </div>
      {zhNote && <p className="rpf-quote-src">{zhNote}</p>}
      {source && <div className="rpf-quote-src">{source}</div>}
    </figure>
  );
}
