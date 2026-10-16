"use client";

/**
 * One answer from POST /api/ask, shown exactly as lib/safety returned it (v3 card style). Each line carries its
 * source chip (医生说 / 推断：医生 / 药袋 / 单张 / Ripple) and, for a visit line, the visit date, the time point in
 * the recording and its clip (代录音 for a stand-in voice). A label line in the Mandarin UI shows the label
 * template and, under it, the label's own words. Nothing here writes a sentence.
 *
 * On a fixed template line (origin "template": the 995 and helpline templates, the safety line) the numbers are tap
 * links (e2e-chains.md 7.1, 8.1; components/daily/dial.ts): tel: for 995, SOS 1767, mindline 1771 and Care Corner
 * 1800-3535-800, WhatsApp for SOS CareText 9151 1767. The words stay the template's, character for character, and
 * break into lines as the plain text did; each link is at least 48 px tall. Any other line (the doctor's own "call
 * 995" in R2, a label, a leaflet) stays plain text. Functional only: the look waits for the designer (EmergencyBlock
 * is not used here).
 */
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { dt } from "@/lib/daily/i18n";
import { chipDetail, chipFromSentence, chipText } from "@/lib/daily/lines";
import type { AskResult, Sentence } from "@/lib/safety/types";
import { askCopy } from "./ask-copy";
import { ClipPlay } from "./ClipPlay";
import { dialLabel, dialRuns, type DialNumber } from "./dial";

/**
 * One number as a link around its digits. An inline-flex box at least 48 px tall: the line it sits on grows to fit it,
 * so the whole box is the tap target and no other line overlaps it.
 */
function DialLink({ text, dial, locale, testId = "answer-dial" }: { text: string; dial: DialNumber; locale: Locale; testId?: string }) {
  return (
    <a
      href={dial.href}
      className="inline-flex min-h-[48px] items-center whitespace-nowrap font-semibold underline underline-offset-4"
      data-testid={testId}
      data-dial={dial.kind}
      aria-label={dialLabel(dial, locale)}
      {...(dial.kind === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {text}
    </a>
  );
}

/**
 * A template line's text with its numbers as links; the visible text is `text` exactly. A closing mark right after a
 * number (「，」「。」「）」, "." ",") stays on the number's line (dialRuns), as it would in plain text.
 */
export function DialText({ text, locale, testId }: { text: string; locale: Locale; testId?: string }) {
  return (
    <>
      {dialRuns(text).map((r, i) => {
        if (!r.dial) return r.text;
        if (!r.after) return <DialLink key={i} text={r.text} dial={r.dial} locale={locale} testId={testId} />;
        return (
          <span key={i} className="whitespace-nowrap">
            <DialLink text={r.text} dial={r.dial} locale={locale} testId={testId} />
            {r.after}
          </span>
        );
      })}
    </>
  );
}

/**
 * Where an answer is drawn (C2 track E): "answer" the one just given (Today's box); "earlier" one of today's earlier
 * answers, read back after a refresh; "relay" the two lines next to a reading above the doctor's warning line (the
 * blood pressure page). The same card everywhere, under its own test ids ("answer-line", "earlier-line", "relay-line",
 * ...), so "the answer on screen" stays the one just given.
 */
export type AnswerPlace = "answer" | "earlier" | "relay";

function AnswerLine({ s, locale, place = "answer" }: { s: Sentence; locale: Locale; place?: AnswerPlace }) {
  const id = (name: string) => (place === "answer" ? name : name.replace(/^answer-/, `${place}-`));
  const chip = chipFromSentence(s);
  const detail = chipDetail(locale, chip);
  const shown = locale === "zh-Hans" && s.zh ? s.zh : s.en;
  const labelOriginal = s.sourceId.startsWith("label:") && shown !== s.en ? s.en : null;
  const doctorSaid = chip.kind === "doctor" && !chip.inferred;
  return (
    <div
      className={`rp-card ${doctorSaid ? "rp-card-doc" : ""}`}
      data-testid={id("answer-line")}
      data-source={s.sourceId}
      data-chip={chip.kind}
      data-inferred={chip.inferred ? "true" : "false"}
    >
      <div className="rp-tag" data-testid={id("answer-chip")}>
        ● {chipText(locale, chip)}
      </div>
      <p className="mt-1.5 whitespace-pre-line text-body leading-[1.42]" data-testid={id("answer-text")} lang={shown === s.en && /[A-Za-z]/.test(s.en) && !/\p{Script=Han}/u.test(s.en) ? "en" : undefined}>
        {s.origin === "template" ? <DialText text={shown} locale={locale} testId={id("answer-dial")} /> : shown}
      </p>
      {labelOriginal ? (
        <p className="mt-1 text-ink-2" data-testid={id("answer-label-original")} lang="en">
          {dt(locale, "answer.original", { text: labelOriginal })}
        </p>
      ) : null}
      {/* C2 (real-app 10 「医生的话只有英文」): the doctor's English words with their checked Chinese translation under them,
          labelled as one, when the scope holds it (lib/translate: made once, checked twice; the pipeline attaches it) */}
      {locale === "zh-Hans" && s.translation?.text && shown === s.en ? (
        <div className="mt-2" data-testid={id("answer-translation")}>
          <p className="rp-src">{askCopy("zh-Hans").translation}</p>
          <p className="text-body leading-[1.42]" lang="zh-Hans">
            {s.translation.text}
          </p>
        </div>
      ) : null}
      {detail ? (
        <div className="rp-src" data-testid={id("answer-detail")}>
          {detail}
        </div>
      ) : null}
      {s.cite?.clipUrl ? <ClipPlay url={s.cite.clipUrl} locale={locale} standIn={!!s.cite.standInVoice} label={s.cite.clipLabel} testId={id("answer-clip")} /> : null}
    </div>
  );
}

/** What AnswerView draws of an answer: POST /api/ask's result, or the same answer as it was kept (lib/safety/turns.ts). */
export type ShownAnswer = Pick<AskResult, "route" | "sentences" | "addedQuestionId" | "questionReused">;

/**
 * `place` (see AnswerPlace): the test ids are "ask-answer" / "ask-asked" / "answer-line" for the answer just given,
 * "ask-earlier-answer" / "ask-earlier-asked" / "earlier-line" for an earlier one, "ask-relay-answer" / "relay-line" for
 * the relay next to a reading. The words and the chips are the same in all three.
 */
export function AnswerView({ result, asked, locale, place = "answer" }: { result: ShownAnswer; asked: string | null; locale: Locale; place?: AnswerPlace }) {
  const outer = (name: string) => (place === "answer" ? `ask-${name}` : `ask-${place}-${name}`);
  return (
    <div className="flex flex-col gap-2" data-testid={outer("answer")} data-route={result.route} data-complete="true">
      {asked ? (
        <p className="font-semibold" data-testid={outer("asked")}>
          “{asked}”
        </p>
      ) : null}
      {result.sentences.map((s, i) => (
        <AnswerLine key={`${s.sourceId}-${i}`} s={s} locale={locale} place={place} />
      ))}
      {result.addedQuestionId ? (
        // the same words whether the question was just added or was already on today's list (reused, M4)
        <Link
          href="/p/questions"
          className="rp-qlist block px-4 py-3 no-underline"
          data-testid={outer("question-added")}
          data-question={result.addedQuestionId}
          data-reused={result.questionReused ? "true" : "false"}
        >
          <span className="rp-tag">{t(locale, "nav.questions")}</span>
          <span className="rp-qt mt-1 block">{dt(locale, "ask.added")} →</span>
        </Link>
      ) : null}
    </div>
  );
}
