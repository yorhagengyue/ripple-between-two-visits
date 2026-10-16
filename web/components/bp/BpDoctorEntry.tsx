import type { ReactNode } from "react";
import { ListenBar, Said, SaidTranslation, Tag, TimelineItem, TlControls } from "@/components/ui";
import { longDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { hasHan } from "@/lib/safety/text";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { uiCopy } from "@/lib/ui/copy";
import { clipTime } from "@/lib/ui/props";
import { bpc } from "./copy";
import "./bp.css";

/**
 * One sentence of the doctor's on the blood pressure screens, as an entry of a line (the draft's `doc` and `unc`
 * nodes): the node and the words 「医生说」 once he confirmed the sentence, the dashed ring and 「好像是医生说的」 before
 * that; when it was said (the visit's date and the time point in the recording); the sentence itself, whole and word
 * for word, in the serif; the checked Chinese under an English sentence, with the line that says which one counts; the
 * play pill for the recording (「听原声」; 「听」 next to the 「代录音」 tag when the voice is a stand-in).
 *
 * A confirmed sentence stands in the white card, an unconfirmed one in the dashed card with the tag 「你还没认过这一句」
 * (the draft's 03-6). Nothing here is Ripple's own advice and nothing judges a reading.
 *
 * The root is the TimelineItem itself: put it straight inside a <Timeline>. `testId` goes on that root with
 * data-state ("confirmed" / "inferred"); `wordsTestId` on the block that holds the sentence and its Chinese;
 * `translationTestId` on the Chinese.
 */
export interface DoctorWordsOf {
  /** the whole sentence, as said */
  text: string;
  /** YYYY-MM-DD of the visit, when the record has it */
  date?: string | null;
  /** where in the recording (ms) */
  tStartMs?: number | null;
  clipUrl?: string | null;
  /** the clip is a stand-in voice (代录音), not his recording */
  standIn?: boolean;
  /** he confirmed it was the doctor */
  confirmed: boolean;
  /** the record that holds the words (an utterance id, a source id) */
  sourceRef: string;
  /** the checked Chinese of an English sentence, when the page holds one */
  zh?: string | null;
}

export function BpDoctorEntry({
  locale,
  words,
  testId,
  wordsTestId,
  translationTestId,
  attrs,
  tagUnconfirmed = false,
  children,
}: {
  locale: Locale;
  words: DoctorWordsOf;
  testId?: string;
  wordsTestId?: string;
  translationTestId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
  /** say 「你还没认过这一句」 under an unconfirmed sentence */
  tagUnconfirmed?: boolean;
  /** what follows the recording inside the card: the plan's line for today */
  children?: ReactNode;
}) {
  const copy = uiCopy(locale);
  const day = words.date ? longDay(locale, words.date) : null;
  const at = typeof words.tStartMs === "number" ? clipTime(words.tStartMs) : null;
  // the date and the time point each stay whole when the head line wraps (after 「好像是医生说的」 it does on a phone):
  // 「2026年10月12日」 is never cut before its 「日」. The words read the same as before: 「2026年10月12日 · 0:53」
  const when =
    day || at ? (
      <>
        {day ? <span className="rp03-whole">{day}</span> : null}
        {day && at ? " · " : null}
        {at ? <span className="rp03-whole">{at}</span> : null}
      </>
    ) : undefined;
  const lang = hasHan(words.text) ? "zh-Hans" : "en";
  const zh = locale === "zh-Hans" && lang === "en" ? words.zh : null;
  return (
    <TimelineItem
      node={words.confirmed ? "doc" : "unc"}
      frame={words.confirmed ? "card" : "dash"}
      who={words.confirmed ? copy.sources.doctor : copy.inferredDoctor}
      meta={when}
      testId={testId}
      attrs={{ "data-state": words.confirmed ? "confirmed" : "inferred", ...attrs }}
    >
      <div className="rp03-words" data-testid={wordsTestId}>
        <Said lang={lang} source={{ kind: "doctor", ref: words.sourceRef }}>
          “{words.text}”
        </Said>
        {zh ? (
          <div className="rp03-words" data-testid={translationTestId} lang="zh-Hans">
            <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{zh}</SaidTranslation>
          </div>
        ) : null}
      </div>
      {words.clipUrl ? <ListenBar src={words.clipUrl} kind="doctor" time="" label={words.standIn ? copy.listen : copy.listenOriginal} locale={locale} standIn={!!words.standIn} /> : null}
      {tagUnconfirmed && !words.confirmed ? (
        <TlControls>
          <Tag>{bpc(locale, "notConfirmedYet")}</Tag>
        </TlControls>
      ) : null}
      {children}
    </TimelineItem>
  );
}
