/**
 * The question a line of the review answers, above that line (C2 track F, fix round; real-app 2.15).
 *
 * 「你问：」 only in front of his own words: what he typed or said, his latest words once he asked it again himself
 * (lib/daily/questions.ts questionWords, the words his question list shows). A question that is on his list in other
 * words (a summary kept for a question Ripple refused that he never worded himself, the question Ripple worded from
 * his records, Ripple's own question for this visit) is 「问题单上：」: never shown as what he said.
 *
 * One line inside the entry it belongs to: the grey lead-in, then the words in the plain face (his own words are never
 * set in the quote face). Hooks: data-testid="review-asked", data-wording; the lead-in and the words follow each other
 * with nothing between them.
 */
import { at, type AccountLocale } from "@/lib/visit/account-copy";

export interface AskedQuestion {
  text: string;
  /** his own words (true), or a question on his list worded by someone else (false) */
  own: boolean;
}

export function AskedWords({ question, locale }: { question: AskedQuestion; locale: AccountLocale }) {
  return (
    <p className="rpu-visit-asked" data-rp-role="body" data-testid="review-asked" data-wording={question.own ? "own_words" : "on_list"}>
      <b>{at(locale, question.own ? "review.youAsked" : "review.onYourList")}</b>
      {question.text}
    </p>
  );
}
