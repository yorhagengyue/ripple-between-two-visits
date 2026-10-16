"use client";

/**
 * Ripple's answer to one sentence in the day's record (journey 04; design group 04), as entries of that day's line:
 * one entry per part of the answer track S kept (lib/safety/turns.ts StoredAnswer; components/daily/answer-parts.ts
 * sorts the sentences, nothing here writes one). The node says where each part is from:
 *
 *   Ripple's fixed sentence   the purple square, 「Ripple」, the sentence in its tinted bubble (「记下了。」, 「今天的药
 *                             吃了吗？」, 「这个我帮不上，要我记下来吗？」)
 *   someone's own words       the purple ring (dashed while 「好像是医生说的」), who and when, the words in the serif
 *                             face, the checked Chinese under English words, 「听原声」
 *   the label, the leaflet    the ink square: what it says, the label as printed in its dashed frame
 *   995                       the red square and the foundation's red card
 *   a helpline                Ripple's entry: the sentence in its bubble, the foundation's call rows under it
 *   Ripple's own answer       (owner 10-15, lib/safety/general.ts) Ripple's entry where the answer says it stands (after
 *                             the quotes): its words in the bubble, the grey line 「以上是 Ripple 的一般健康信息，不是医生的话。」
 *   where his question went   the tick, 「已在下次看诊的问题单里」, 「看问题单」
 *   no consent to AI          a plain point with the design's one sentence in grey, last and once (real-app 2.10)
 *
 * The entries are returned side by side (a Fragment), so the caller's <Timeline> holds them directly. `slots` hangs
 * the turn's own buttons under the sentence they answer: 「去今天页记」 under the check-in question, 「记下来 / 不用」
 * under the can't-help sentence.
 *
 * The parts that answer a question (quotes, the label, the leaflet, 995, the helplines) are groups 07, 09 and 10's
 * to design; here they are placed on the line with the foundation's own pieces and nothing more.
 *
 * Test hooks: chat-answer (data-route; the first entry of the answer), chat-part (data-kind, data-source), chat-added
 * (data-question), chat-no-ai, and on a quoted, label or leaflet entry's head line the first build's
 * [data-rp="source-tag"]. Another screen that draws the same answer gives the hooks its own names (`hooks`: the ask
 * screen draws 「只记录」 and 「帮不上」 with this component and keeps its answer-line and ask-question-added).
 */
import type { ReactNode } from "react";
import { Act, Acts, Bubble, EmergencyBlock, Hotlines, LabelOriginal, Said, SaidTranslation, TimelineItem, TlNote } from "@/components/ui";
import { answerParts, type AnswerPart } from "@/components/daily/answer-parts";
import { askCopy, questionRowWords } from "@/components/daily/ask-copy";
import type { StoredAnswer } from "@/lib/safety/turns";
import { uiCopy } from "@/lib/ui/copy";
import type { NodeKind, SourceKind, UiLocale } from "@/lib/ui/tokens";
import { CHAT_WORDS } from "./copy";
import { PlayClip } from "./PlayClip";
import "./chat.css";

/**
 * The head line of an entry that quotes a source, drawn as the timeline draws it (who in bold, then where or when in
 * grey) with the first build's hook on it, so a script that reads who said a line and when still finds both.
 */
export function SourceLine({ kind, node, who, when, inferred = false }: { kind: SourceKind; node: NodeKind; who: ReactNode; when?: string; inferred?: boolean }) {
  return (
    <p className="rpu-tl-head" data-rp="source-tag" data-kind={kind} data-inferred={inferred ? "true" : undefined}>
      <span className="rpu-tl-who" data-node={node}>
        {who}
      </span>
      {when ? <span> · {when}</span> : null}
    </p>
  );
}

interface Entry {
  node: NodeKind;
  /** the name on the head line, where the node does not say it by itself (a "rip" entry says 「Ripple」) */
  who?: ReactNode;
  /** the part's own source, or the sentence's (each helpline is an entry of its own) */
  source: string;
  body: ReactNode;
}

/** One part as entries of the line: one each, except the helplines, which are an entry per sentence (the draft's 10-1). */
function entriesOf(part: AnswerPart, locale: UiLocale): Entry[] {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const one = (e: Omit<Entry, "source">): Entry[] => [{ ...e, source: part.source }];
  switch (part.kind) {
    case "emergency":
      return one({ node: "sos", who: ui.sources.ripple, body: <EmergencyBlock title={part.text} call={{ number: "995" }} locale={locale} /> });
    case "hotlines":
      // Ripple's fixed sentence in its bubble and its numbers as buttons under it: the foundation's <Hotlines> draws
      // both (the timeline draft's 10-1), one sentence per entry of the line
      return part.lines.map((l) => ({
        node: "rip" as const,
        source: l.source,
        body: <Hotlines locale={locale} lines={[{ text: l.text, calls: l.calls.map((c) => ({ number: c.number, href: c.href, urgent: c.urgent, ...(c.whatsapp ? { label: copy.whatsapp } : {}) })) }]} />,
      }));
    case "ripple":
      return one({
        node: "rip",
        body: (
          <Bubble lang={part.lang}>
            {part.text}
            {part.second ? (
              <>
                {"\n"}
                <span lang="zh-Hans">{part.second}</span>
              </>
            ) : null}
          </Bubble>
        ),
      });
    case "quote": {
      // who said it: the words that carry the rule stay as they are (「好像是医生说的」 until he confirmed the speaker)
      const guessed = part.inferred && part.speaker === "doctor";
      const who = guessed ? ui.inferredDoctor : part.inferred ? ui.sources[part.speaker] : part.speaker === "pharmacist" ? copy.pharmacistSaid : part.speaker === "dispenser" ? copy.dispenserSaid : copy.doctorSaid;
      const node: NodeKind = guessed ? "unc" : "doc";
      return one({
        node,
        body: (
          <>
            <SourceLine kind={part.speaker} node={node} who={who} when={part.when} inferred={part.inferred} />
            <Said lang={part.lang} source={{ kind: part.speaker, ref: part.ref }}>
              {part.lang === "en" ? `“${part.text}”` : `「${part.text}」`}
            </Said>
            {part.translation ? (
              <div className="fe04-zh" lang="zh-Hans">
                <SaidTranslation note={copy.translation}>{part.translation}</SaidTranslation>
              </div>
            ) : null}
            {part.clipUrl ? <PlayClip url={part.clipUrl} standIn={part.standIn} locale={locale} label={copy.listen} playingLabel={copy.listening} /> : null}
          </>
        ),
      });
    }
    case "label":
      return one({
        node: "lab",
        body: (
          <>
            <SourceLine kind="label" node="lab" who={ui.sources.label} />
            {part.restated ? (
              <p className="rpu-said" data-rp="label-line" lang="zh-Hans">
                {part.restated}
              </p>
            ) : null}
            <LabelOriginal>{part.printed}</LabelOriginal>
          </>
        ),
      });
    case "leaflet":
      return one({
        node: "lab",
        body: (
          <>
            <SourceLine kind="leaflet" node="lab" who={ui.sources.leaflet} />
            <p className="rpu-said" data-rp="leaflet-line" lang={part.lang}>
              {part.text}
            </p>
            {part.from ? <p className="rpu-tl-note">{copy.leafletFrom(part.from)}</p> : null}
          </>
        ),
      });
    case "record":
      return one({
        node: "me",
        body: (
          <>
            <SourceLine kind="self" node="me" who={copy.recordFrom} />
            <Bubble node="me" lang={part.lang}>
              {part.text}
            </Bubble>
          </>
        ),
      });
  }
}

export function ChatAnswer({
  answer,
  locale,
  slots,
  hooks,
}: {
  answer: StoredAnswer;
  locale: UiLocale;
  /** the turn's own buttons, hung under the sentence they answer (under the answer's last entry when it is not there) */
  slots?: { checkIn?: ReactNode; cantHelp?: ReactNode };
  /**
   * the test hooks' names where another screen's scripts know them by other names (the day's record's own by default);
   * `answer: null` leaves the first entry without one
   */
  hooks?: { answer?: string | null; part?: string; added?: string; noAi?: string };
}) {
  const hook = { answer: hooks?.answer === undefined ? "chat-answer" : hooks.answer, part: hooks?.part ?? "chat-part", added: hooks?.added ?? "chat-added", noAi: hooks?.noAi ?? "chat-no-ai" };
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const w = CHAT_WORDS[locale];
  const partEntries = (sentences: StoredAnswer["sentences"]) =>
    answerParts(sentences, locale).flatMap((part) => entriesOf(part, locale).map((entry) => ({ part: part as { kind: string }, entry })));
  // owner 10-15: Ripple's own answer (kept in the gloss slot, kind general) stands where the answer says, after the quotes
  const general = answer.gloss?.kind === "general" ? answer.gloss : null;
  const generalText = general ? general.sentences.map((g) => g.text).filter((t) => t.trim()).join(" ") : "";
  const at = general ? Math.max(0, Math.min(general.at, answer.sentences.length)) : answer.sentences.length;
  const entries =
    general && generalText
      ? [
          ...partEntries(answer.sentences.slice(0, at)),
          {
            part: { kind: "general" },
            entry: {
              node: "rip",
              source: "general",
              body: (
                <>
                  <Bubble lang={general.lang}>{generalText}</Bubble>
                  <TlNote>{copy.generalNote}</TlNote>
                </>
              ),
            } as Entry,
          },
          ...partEntries(answer.sentences.slice(at)),
        ]
      : partEntries(answer.sentences);
  const lastAt = entries.length - 1;
  /** the entry of one of Ripple's fixed sentences (an entry carries the sentence's source, not the template's name) */
  const entryAt = (templateId: string): number => {
    const source = answer.sentences.find((s) => s.templateId === templateId)?.sourceId;
    const at = source === undefined ? -1 : entries.findIndex((e) => e.part.kind === "ripple" && e.entry.source === source);
    return at < 0 ? lastAt : at;
  };
  const checkInAt = slots?.checkIn ? entryAt("check_in_dose") : -1;
  const cantHelpAt = slots?.cantHelp ? entryAt("cant_help") : -1;
  // C2 track S (round 2): one sentence (lib/safety/no-ai.ts), never twice in one answer
  const noAi = !!answer.noAiConsent && !answer.sentences.some((s) => s.templateId === "no_ai_consent");
  return (
    <>
      {entries.map(({ part, entry }, i) => (
        <TimelineItem
          key={`${entry.source}-${i}`}
          node={entry.node}
          who={entry.who}
          testId={i === 0 && hook.answer ? hook.answer : undefined}
          attrs={i === 0 ? { "data-route": answer.route } : undefined}
          actions={
            <>
              {i === checkInAt ? slots?.checkIn : null}
              {i === cantHelpAt ? slots?.cantHelp : null}
              {/* answered at a visit already: nothing is added, the list has the doctor's answer */}
              {i === lastAt && answer.answeredBefore ? (
                <Acts>
                  <Act href="/p/questions">{copy.questions}</Act>
                </Acts>
              ) : null}
            </>
          }
        >
          <div className="fe04-part" data-testid={hook.part} data-kind={part.kind} data-source={entry.source}>
            {entry.body}
          </div>
        </TimelineItem>
      ))}
      {!answer.answeredBefore && answer.addedQuestionId ? (
        <TimelineItem
          node="ok"
          // C2 track S (round 2): a question he asked before says when (real-app 4.5)
          title={questionRowWords(locale, answer, ui.added)}
          testId={hook.added}
          attrs={{ "data-question": answer.addedQuestionId }}
          actions={
            <Acts>
              <Act variant="outline" href="/p/questions">
                {w.seeQuestions}
              </Act>
            </Acts>
          }
        />
      ) : null}
      {/* an answer made without his consent to AI processing says so, last and once: a plain point with the grey line */}
      {noAi ? <TimelineItem node="dot" note={copy.noAi} testId={hook.noAi} /> : null}
    </>
  );
}
