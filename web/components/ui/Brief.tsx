import type { ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import { Tag } from "./Tag";

/*
 * The visit brief he hands to the doctor (tone v2 ⑧, brief 6.8): large English by default, readable at arm's
 * length; numbers in mono; his own words kept in Chinese and marked "his own words, not translated"; no judging
 * words. "Changed since last visit" is an ink tag in words, not red (owner: red is only emergency and recording).
 */

/** 「FOR DR LIM · 5 OCT」 and 「Since the visit on 1 Sep」. */
export function BriefHeader({
  kicker,
  title,
  lang = "en",
  filming,
  className,
  style,
}: UiBaseProps & { kicker: ReactNode; title: ReactNode; lang?: string }) {
  return (
    <header className={cx("rpu", className)} data-rp="brief-header" lang={lang} {...filmingAttr(filming)} style={style}>
      <p className="rpu-brief-kicker">{kicker}</p>
      <h1 className="rpu-brief-title">{title}</h1>
    </header>
  );
}

/** One fact line; wrap numbers in <BriefNum>. */
export function BriefItem({ children, isNew, newLabel = "NEW", lang = "en", filming, className, style }: UiBaseProps & { children: ReactNode; isNew?: boolean; newLabel?: string; lang?: string }) {
  return (
    <p className={cx("rpu rpu-brief-item", className)} data-rp="brief-item" lang={lang} {...filmingAttr(filming)} style={style}>
      {isNew && (
        <>
          <Tag tone="ink" icon="sparkle">
            {newLabel}
          </Tag>{" "}
        </>
      )}
      {children}
    </p>
  );
}

/** A number in a brief line: mono, bold. */
export function BriefNum({ children }: { children: ReactNode }) {
  return <b className="rpu-brief-num">{children}</b>;
}

/** What he wrote, as he wrote it (his words: sans), with the note that it is not translated. */
export function BriefOwnWords({
  intro,
  words,
  wordsLang = "zh-Hans",
  note = "his own words, not translated",
  filming,
  className,
  style,
}: UiBaseProps & { intro: ReactNode; words: ReactNode; wordsLang?: string; note?: ReactNode }) {
  return (
    <p className={cx("rpu rpu-brief-item", className)} data-rp="brief-own" lang="en" {...filmingAttr(filming)} style={style}>
      {intro}
      <span className="rpu-brief-own" lang={wordsLang}>
        「{words}」
      </span>
      <span className="rpu-brief-note">{note}</span>
    </p>
  );
}

/** At most three questions, in the order refused > pattern > his own (the page orders them). */
export function BriefQuestions({ title = "His questions", items, lang = "en", filming, className, style }: UiBaseProps & { title?: ReactNode; items: readonly ReactNode[]; lang?: string }) {
  return (
    <section className={cx("rpu", className)} data-rp="brief-questions" lang={lang} {...filmingAttr(filming)} style={style}>
      <h2 className="rpu-brief-qtitle">{title}</h2>
      <ol className="rpu-brief-qs">
        {items.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
    </section>
  );
}
