/**
 * Someone's words inside a timeline entry, as the prevention and diet screens relay them (design groups 11 and 13):
 *
 *   SourceHead    the entry's head line, drawn as the timeline draws it (who in bold, then where or when in grey), with
 *                 the first build's [data-rp="source-tag"] on it, so a script that reads who said a line and when still
 *                 finds both (the foundation's TimelineItem has no place for a hook on its own head line)
 *   DoctorWords   the doctor's line word for word in the serif face, the checked Chinese under English words with the
 *                 line that says which one counts, and 「听原声」 when the line has a recording (a stand-in voice says so)
 *
 * Both return what a <TimelineItem> holds directly, so the entry keeps its own rhythm. No sentence is written here.
 */
import type { ReactNode } from "react";
import { Said, SaidTranslation } from "@/components/ui";
import { PlayClip } from "@/components/chat/PlayClip";
import { askCopy } from "@/components/daily/ask-copy";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import type { NodeKind, SourceKind, UiLocale } from "@/lib/ui/tokens";
import "./diet.css";

export function SourceHead({
  kind,
  node,
  who,
  tail,
  when,
}: {
  kind: SourceKind;
  node: NodeKind;
  who: ReactNode;
  /** grey words that run on from `who` without a point between them (a source's own title after its name) */
  tail?: ReactNode;
  when?: ReactNode;
}) {
  return (
    <p className="rpu-tl-head" data-rp="source-tag" data-kind={kind}>
      <span className="rpu-tl-who" data-node={node}>
        {who}
      </span>
      {tail != null && tail !== "" ? <span>{tail}</span> : null}
      {when != null && when !== "" ? <span> · {when}</span> : null}
    </p>
  );
}

/** A doctor's line as the back end hands it to these screens (lib/prevent/view DoctorQuote, lib/diet/view DoctorWordsView). */
export interface DoctorLine {
  utteranceId: string;
  text: string;
  lang: "en" | "zh-Hans";
  clipUrl: string | null;
  standIn: boolean;
  zh?: string | null;
}

export function DoctorWords({
  line,
  locale,
  size,
  clip = true,
  translationTestId,
}: {
  line: DoctorLine;
  locale: UiLocale;
  /** "sub": inside a card's row (22) */
  size?: "sub";
  /** false: the words only (a line quoted as the reason for something else) */
  clip?: boolean;
  translationTestId?: string;
}) {
  const copy = askCopy(locale);
  return (
    <>
      <Said lang={line.lang} size={size} source={{ kind: "doctor", ref: line.utteranceId }}>
        {line.lang === "en" ? `“${line.text}”` : `「${line.text}」`}
      </Said>
      {/* C2 track S (round 2): the checked Chinese under the doctor's English words; nothing in the English interface */}
      {line.zh && locale === "zh-Hans" ? (
        <div className="fe13-col" data-testid={translationTestId} lang="zh-Hans">
          <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{line.zh}</SaidTranslation>
        </div>
      ) : null}
      {clip && line.clipUrl ? <PlayClip url={line.clipUrl} standIn={line.standIn} locale={locale} label={copy.listen} playingLabel={copy.listening} /> : null}
    </>
  );
}
