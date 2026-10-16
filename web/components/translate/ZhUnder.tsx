/**
 * The checked Chinese under a doctor's or pharmacist's English line (C2 track S, round 2; real-app 12): draws a
 * translation the page already holds. Plain and client-safe, so it also works inside client components (the blood
 * pressure page's relay block); a server page that only has the English line uses <DoctorZh> (DoctorZh.tsx), which looks
 * the translation up and draws this.
 *
 * In the timeline draft's shape (the foundation's <SaidTranslation>): the Chinese in the serif face, 22px, #2C3644, a
 * 3px #D5DCE5 rule on its left, and under it one 18px line that says which of the two counts. That line's words are the
 * back end's (lib/translate/label.ts: 「中文翻译，以英文原话为准」). The English words, their source and their recording
 * stay above it as the authority. Nothing when there is no translation or the page is in English.
 *
 * Test hook: line-translation (or `testId`).
 */
import { SaidTranslation } from "@/components/ui";
import { TRANSLATION_LABEL } from "@/lib/translate/label";

export function ZhUnder({ text, locale, testId = "line-translation" }: { text?: string | null; locale: string; testId?: string }) {
  if (!text || locale !== "zh-Hans") return null;
  return (
    <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]} testId={testId}>
      {text}
    </SaidTranslation>
  );
}
