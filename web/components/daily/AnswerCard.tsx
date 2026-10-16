"use client";

/**
 * One answer of /api/ask on Mr Tan's ask screen (C2 track S), drawn as the timeline draft's 07, 09 and 10 screens: a
 * line of entries whose nodes say where each one comes from. His question is the first entry (his own node; it is the
 * turn's heading), then each part lib/safety returned (answer-parts.ts), then where his question went:
 *
 *   his question      his node, 「你问」, his words plain
 *   Ripple            the purple square, 「Ripple」, the fixed sentence in its tinted bubble
 *   the doctor …      the purple ring (dashed while the speaker is still a guess), 「医生说」 with the date and time
 *                     point, the words in the serif face, a checked translation under English words, 「听原声」 and
 *                     「代录音」 for a stand-in voice. In a white card when it is the answer he was given at a visit
 *                     (07-4)
 *   the label         the ink square, 「药袋上写着」, the label's own line and the label as printed (mono, dashed frame)
 *   the leaflet       the ink square, 「单张写着」, the reviewed restatement and where it is from
 *   his own records   his node
 *   Ripple answers    (owner 10-15, lib/safety/general.ts; carried in the same slot as Ripple's explanation, kind general)
 *                     after his sources: Ripple's bubble with its own answer, the grey line 「以上是 Ripple 的一般健康信息，
 *                     不是医生的话。」 under it, and, when Ripple suggests asking his doctor or pharmacist and nothing was put on
 *                     his list, one button that puts his question there (POST /api/questions; nothing is added unless he
 *                     taps it)
 *   Ripple explains   (10-14, lib/safety/gloss.ts; only when the answer carries one) right after the last quote, before
 *                     Ripple's fixed referral: Ripple's bubble with its own words, each sentence followed by square chips
 *                     naming the quotes it rests on (医生 9月10日 / 药品标签 / 单张), and the grey line 「这段是 Ripple 根据上面
 *                     的原话写的说明，不是医嘱。」 under it
 *   on his list       the tick, 「已在下次看诊的问题单里」 (or when he asked it before), 「看问题单」
 *   995 (09)          the red card with its one call button, by itself between two stretches of the line (the only
 *                     red on the screen; it says 「Ripple」 itself); the doctor's warning line and the leaflet's line
 *                     follow as entries of the line under it. Nothing here sorts them: the card stands wherever its
 *                     sentence stands in the answer. 10-14 (the owner's decision: 「胸口痛就必须打 995」 was too absolute):
 *                     his own chest pain, a stroke sign or a reading above his doctor's number is kept for his doctor,
 *                     and its answer is one line with no card: Ripple's sentence that it was kept (with the date and
 *                     time), the doctor's warning line (first, for a reading alone), then Ripple's 995 sentence for when
 *                     it gets bad with its 打 995 button, drawn as the helplines are (answer-parts.ts)
 *   helplines (10)    Ripple's entries on the same line as his words, one per fixed sentence: the sentence in its
 *                     bubble, its numbers as buttons under it (the foundation's <Hotlines>); only 995 is red
 *
 * The words are lib/safety's and the app's own (ask-copy.ts, lib/ui/copy.ts): nothing here writes a sentence, and the
 * parts keep the order lib/safety gave them (on the hero question: the doctor's words, the label, then the fixed
 * referral; the draft's 07-3 puts Ripple's sentence first, the back end's order is kept).
 *
 * One look with the day's record (/p/chat, design group 04): the head line of a quoted source and the play pill are
 * that screen's own pieces (components/chat SourceLine, PlayClip), and the two answers both screens show the same way,
 * 「只记录」 (07-2d = 04-2) and 「帮不上」 (07-2g = 04-4), are drawn by its ChatAnswer itself: 「记下了。」 and, when Ripple asks
 * 「今天的药吃了吗？」, 「去今天页记」 under it; under 「这个我帮不上，要我记下来吗？」 the two buttons 「记下来 / 不用」, and
 * after 「记下来」 Ripple's own entry 「记下了。」 (his words are saved as today's note, POST /api/notes).
 *
 * Test hooks (the old answer box's names are kept, so scripts written for it still find their way):
 *   ask-answer      the latest answer (data-complete, data-route)          ask-turn   every answer (data-route, data-latest)
 *   answer-line     one part (data-source, data-kind)                       answer-text  the part's own words
 *   answer-clip     the play pill (data-src, data-playing)                  answer-translation  a checked translation
 *   ask-question-added  where his question went (data-question, data-reused, data-asked: the day a reused one was asked)
 *   answer-answered-before  answered at a visit (data-question: his question on the list; data-source: the answer's line;
 *                           data-by: who answered; data-answered: the visit's date). The store's fact, not a model's words
 *   ask-note-offer  under chit-chat (route cant_help; data-noted): 「记下来」 (ask-write-down) and 「不用」 (ask-write-skip);
 *                   ask-written is Ripple's 「记下了。」 after it; ask-checkin is 「去今天页记」
 *   Ripple's explanation: answer-line data-kind="gloss"; each sentence is an answer-text, each chip answer-gloss-from
 *                   (data-source: the quote it rests on); answer-gloss-note is the grey line
 * A quote's head line is [data-rp="source-tag"]; a helpline is .rpu-hotline and its numbers a[data-rp="call"].
 *
 * SSE (owner 10-15: 「需要非常完整的 SSE 的输出」): while the answer is on its way the screens draw what has come so far with
 * this same card and `draft` (components/today/AskSection.tsx draftAnswer): the sentences that are final already, Ripple's
 * own words as they are written with a soft caret after them (.rpu-caret; still under prefers-reduced-motion), and the
 * stage line under them (「在找医生说过的话……」, 「正在写……」; its hook is the screen's waiting line, ask-pending or
 * ask-thinking). A draft is never "the answer": it is ask-draft (data-complete="false", aria-busy) instead of ask-answer,
 * ask-draft-turn instead of ask-turn, offers nothing to tap (no offer, no way to the list, no 记下来, nothing plays by
 * itself), and draws chit-chat and notes as plain parts. When the final answer comes the screen draws it without `draft`:
 * exactly the card it always was.
 */
import { Fragment, useState, type ReactNode } from "react";
import { ChatAnswer, SourceLine } from "@/components/chat/ChatAnswer";
import { CHAT_WORDS } from "@/components/chat/copy";
import { PlayClip } from "@/components/chat/PlayClip";
import { Act, Acts, Bubble, EmergencyBlock, Hotlines, LabelOriginal, Said, SaidTranslation, Tag, Timeline, TimelineGroup, TimelineItem, TlNote } from "@/components/ui";
import type { StoredAnswer } from "@/lib/safety/turns";
import { uiCopy } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";
import { answerLine, type AnswerPart, type GlossPart } from "./answer-parts";
import { askCopy, questionRowWords } from "./ask-copy";

const words = (text: string) => <span data-testid="answer-text">{text}</span>;

const hooks = (part: { kind: string; source: string }) => ({ testId: "answer-line", attrs: { "data-kind": part.kind, "data-source": part.source } as const });

/**
 * One part as an entry of the line (995 and the helplines are drawn by the card itself: they are not single entries).
 * `card`: the entry stands in a white card (the doctor's answer to a question he asked at a visit); `after`: what hangs
 * under the entry's words.
 */
function PartItem({
  part,
  locale,
  card = false,
  after,
  caret = false,
}: {
  part: Exclude<AnswerPart | GlossPart, { kind: "emergency" } | { kind: "hotlines" }>;
  locale: UiLocale;
  card?: boolean;
  after?: ReactNode;
  /** SSE: Ripple's own words are still being written (the soft caret after them) */
  caret?: boolean;
}) {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  switch (part.kind) {
    case "gloss":
      // Ripple's own explanation of the quotes above (10-14; lib/safety/gloss.ts): Ripple's bubble, each sentence followed by
      // chips naming the quotes it rests on, and the quiet line that says whose words these are
      return (
        <TimelineItem node="rip" {...hooks(part)} actions={after}>
          <Bubble lang={part.lang}>
            {part.lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 ? "\n" : null}
                {words(l.text)}
                {l.chips.map((c) => (
                  <Fragment key={c.source}>
                    {" "}
                    <span data-testid="answer-gloss-from" data-source={c.source}>
                      <Tag>{c.words}</Tag>
                    </span>
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {caret ? <span className="rpu-caret" data-testid="answer-caret" aria-hidden="true" /> : null}
          </Bubble>
          <TlNote testId="answer-gloss-note">{part.note}</TlNote>
        </TimelineItem>
      );
    case "ripple":
      return (
        <TimelineItem node="rip" {...hooks(part)} actions={after}>
          <Bubble lang={part.lang}>
            {words(part.text)}
            {part.second ? (
              <>
                {"\n"}
                <span lang="zh-Hans">{part.second}</span>
              </>
            ) : null}
          </Bubble>
        </TimelineItem>
      );
    case "quote": {
      // who said it: the words that carry the rule stay as they are (「好像是医生说的」 until he confirmed the speaker)
      const guessed = part.inferred && part.speaker === "doctor";
      const who = guessed ? ui.inferredDoctor : part.speaker === "pharmacist" ? copy.pharmacistSaid : part.speaker === "dispenser" ? copy.dispenserSaid : copy.doctorSaid;
      const node = guessed ? "unc" : "doc";
      return (
        <TimelineItem node={node} frame={card ? "card" : guessed ? "dash" : undefined} {...hooks(part)} actions={after}>
          <SourceLine kind={part.speaker} node={node} who={who} when={part.when} inferred={part.inferred} />
          <Said lang={part.lang} source={{ kind: part.speaker, ref: part.ref }} style={{ marginTop: 0 }}>
            {part.lang === "en" ? "“" : "「"}
            {words(part.text)}
            {part.lang === "en" ? "”" : "」"}
          </Said>
          {part.translation ? (
            <SaidTranslation note={copy.translation} testId="answer-translation">
              {part.translation}
            </SaidTranslation>
          ) : null}
          {part.clipUrl ? <PlayClip url={part.clipUrl} standIn={part.standIn} locale={locale} label={copy.listen} playingLabel={copy.listening} testId="answer-clip-row" pillTestId="answer-clip" /> : null}
        </TimelineItem>
      );
    }
    case "label":
      return (
        <TimelineItem node="lab" {...hooks(part)} actions={after}>
          <SourceLine kind="label" node="lab" who={ui.sources.label} />
          {part.restated ? (
            <>
              <p className="rpu-said" data-rp="label-line" lang="zh-Hans" style={{ marginTop: 0 }}>
                {words(part.restated)}
              </p>
              <LabelOriginal style={{ marginTop: 0 }}>{part.printed}</LabelOriginal>
            </>
          ) : (
            <div data-testid="answer-text">
              <LabelOriginal style={{ marginTop: 0 }}>{part.printed}</LabelOriginal>
            </div>
          )}
        </TimelineItem>
      );
    case "leaflet":
      return (
        <TimelineItem node="lab" {...hooks(part)} note={part.from ? copy.leafletFrom(part.from) : undefined} actions={after}>
          <SourceLine kind="leaflet" node="lab" who={ui.sources.leaflet} />
          <p className="rpu-said" data-rp="leaflet-line" lang={part.lang} style={{ marginTop: 0 }}>
            {words(part.text)}
          </p>
        </TimelineItem>
      );
    case "record":
      return (
        <TimelineItem node="me" {...hooks(part)} actions={after}>
          <SourceLine kind="self" node="me" who={copy.recordFrom} />
          <Bubble node="me" lang={part.lang}>
            {words(part.text)}
          </Bubble>
        </TimelineItem>
      );
  }
}

/**
 * owner 10-15: under Ripple's own answer, when it suggests asking someone and his question is not on his list yet: one
 * button that puts it there (his own words, for that person). Hooks: ask-offer (data-for, data-added), ask-offer-add.
 */
function OfferToList({ text, who, locale }: { text: string; who: "doctor" | "pharmacist"; locale: UiLocale }) {
  const copy = askCopy(locale);
  const [added, setAdded] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const add = async () => {
    if (pending || added) return;
    setPending(true);
    setFailed(false);
    const res = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text, for: who, origin: "chat" }),
    }).catch(() => null);
    setPending(false);
    if (res?.ok) setAdded(true);
    else setFailed(true);
  };
  return (
    <div data-testid="ask-offer" data-for={who} data-added={added ? "true" : "false"}>
      {added ? (
        <p className="rpu-tl-note" role="status">
          {copy.offerAdded}
        </p>
      ) : (
        <Acts>
          <Act variant="outline" pending={pending} onClick={() => void add()} data-testid="ask-offer-add">
            {copy.offerToList(who)}
          </Act>
        </Acts>
      )}
      {failed ? (
        <p className="rpu-tl-note" role="alert">
          {copy.offerFailed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 「只记录」 and 「帮不上」 (07-2d, 07-2g), as the day's record draws them: its ChatAnswer for the entries, the same
 * buttons under the sentence they answer. `text`: his own words (what 「记下来」 saves as today's note).
 */
function NotedOrCantHelp({ text, answer, locale, noted: notedBefore }: { text: string; answer: StoredAnswer; locale: UiLocale; noted: boolean }) {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const w = CHAT_WORDS[locale];
  const [noted, setNoted] = useState(notedBefore);
  const [declined, setDeclined] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const cantHelp = answer.route === "cant_help";
  // Ripple asked 「今天的药吃了吗？」: Today is where he answers it
  const checkIn = answer.sentences.some((s) => s.templateId === "check_in_dose");
  const save = async () => {
    if (pending || noted) return;
    setPending(true);
    setFailed(false);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text, source: "typed" }),
    }).catch(() => null);
    setPending(false);
    if (res?.ok) setNoted(true);
    else setFailed(true);
  };
  return (
    <>
      <ChatAnswer
        answer={answer}
        locale={locale}
        hooks={{ answer: null, part: "answer-line", added: "ask-question-added", noAi: "answer-no-ai" }}
        slots={{
          checkIn: checkIn ? (
            <div className="fe04-under" data-testid="ask-checkin">
              <Acts>
                <Act href="/p/today">{w.checkIn}</Act>
              </Acts>
            </div>
          ) : undefined,
          cantHelp: cantHelp ? (
            <div className="fe04-under" data-testid="ask-note-offer" data-noted={noted ? "true" : "false"}>
              {!noted && !declined ? (
                <Acts cols={2}>
                  <Act variant="primary" pending={pending} onClick={() => void save()} data-testid="ask-write-down">
                    {copy.writeDown}
                  </Act>
                  <Act disabled={pending} onClick={() => setDeclined(true)} data-testid="ask-write-skip">
                    {ui.noNote}
                  </Act>
                </Acts>
              ) : null}
              {failed ? (
                <p className="rpu-tl-note" role="alert">
                  {copy.writeFailed}
                </p>
              ) : null}
            </div>
          ) : undefined,
        }}
      />
      {cantHelp && noted ? (
        <TimelineItem node="rip">
          <div role="status">
            <Bubble testId="ask-written">{copy.written}</Bubble>
          </div>
        </TimelineItem>
      ) : null}
    </>
  );
}

/** SSE: the answer is still on its way (see the header). */
export interface AnswerDraft {
  /** the stage line under what has come so far (「在找医生说过的话……」, 「正在写……」) */
  line: string;
  /** Ripple's own words are being written: the soft caret after them */
  writing: boolean;
  /** the stage line's hook: the screen's own waiting line (ask-pending, ask-thinking) */
  testId?: string;
}

export function AnswerCard({
  question,
  answer,
  locale,
  latest = true,
  showQuestion = true,
  noted = false,
  aiNote = true,
  draft,
  settled = false,
}: {
  question: string;
  answer: StoredAnswer;
  locale: UiLocale;
  latest?: boolean;
  /** SSE: the answer as it stands while it is being made (never the answer itself: see the header) */
  draft?: AnswerDraft;
  /** SSE: this answer takes the place of its draft, which was on the screen: it does not rise in again (app/motion.css) */
  settled?: boolean;
  /**
   * when he asked (ISO). Kept for the callers; nothing plays by itself any more (owner 10-15: the doctor's words are
   * on the screen and he chooses to play them; until then the first recorded line played as the answer came, 10-14)
   */
  askedAt?: string;
  /** false where the row that opens this answer already says his question (today's earlier questions) */
  showQuestion?: boolean;
  /** chit-chat only: his words are already written down today (AskTurn.noted) */
  noted?: boolean;
  /**
   * the "no consent to AI" sentence under an answer made without it; false where the screen already says it (the ask
   * screen while his consent is off). Never twice: an answer whose own template says it gets no footer.
   */
  aiNote?: boolean;
}) {
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const his: ReactNode = showQuestion ? (
    <TimelineItem key="question" node="me" who={ui.asked}>
      <h1 className="rpu-bubble" data-rp="bubble" data-rp-role="say">
        {question}
      </h1>
    </TimelineItem>
  ) : null;
  /** the answer said without his consent to AI processing says so, once, unless the screen already does */
  const noAi = aiNote && !!answer.noAiConsent && !answer.sentences.some((s) => s.templateId === "no_ai_consent");

  let body: ReactNode;
  if (!draft && (answer.route === "log_only" || answer.route === "cant_help")) {
    // the two answers the day's record shows too: one look, its own component
    body = (
      <Timeline>
        {his}
        <NotedOrCantHelp text={question} answer={aiNote ? answer : { ...answer, noAiConsent: undefined }} locale={locale} noted={noted} />
      </Timeline>
    );
  } else {
    // the parts in the order lib/safety gave them (the doctor's words first, the fixed referral last): never re-sorted here;
    // Ripple's own explanation, when the answer has one, where the answer says it stands (after the last quote)
    const parts = answerLine(answer.sentences, locale, answer.gloss);
    const lastAt = parts.length - 1;
    // answered at a visit already: the answer's own line stands in a card, and the way to the list hangs under the last entry
    const before = answer.answeredBefore;
    const toList = before ? (
      <div data-testid="answer-answered-before" data-question={before.questionId ?? ""} data-source={before.sourceId} data-by={before.by} data-answered={before.date}>
        <Acts>
          <Act href="/p/questions">{copy.questions}</Act>
        </Acts>
      </div>
    ) : null;
    // the line is drawn in stretches: 995 (a card by itself) stands between them
    const blocks: ReactNode[] = [];
    let line: ReactNode[] = his ? [his] : [];
    const flush = (key: string) => {
      if (line.length) blocks.push(<Timeline key={key}>{line}</Timeline>);
      line = [];
    };
    parts.forEach((part, i) => {
      const key = `${part.source}-${i}`;
      if (part.kind === "emergency") {
        flush(`line-${i}`);
        blocks.push(
          <div key={key} data-testid="answer-line" data-kind={part.kind} data-source={part.source}>
            <EmergencyBlock who={ui.sources.ripple} title={words(part.text)} call={{ number: "995" }} locale={locale} style={{ marginTop: 0 }} />
          </div>,
        );
        return;
      }
      if (part.kind === "hotlines") {
        // one entry of Ripple's per fixed sentence, on the same line as his words; the part's hook is the group that
        // holds them (a script counts the sentences inside it)
        line.push(
          <TimelineGroup key={key} testId="answer-line" attrs={{ "data-kind": part.kind, "data-source": part.source }}>
            {part.lines.map((l) => (
              <TimelineItem key={l.source} node="rip">
                <Hotlines locale={locale} lines={[{ text: words(l.text), calls: l.calls.map((c) => ({ number: c.number, href: c.href, urgent: c.urgent, ...(c.whatsapp ? { label: copy.whatsapp } : {}) })) }]} />
              </TimelineItem>
            ))}
          </TimelineGroup>,
        );
        return;
      }
      // owner 10-15: Ripple's own answer that suggests asking someone, his question not on his list yet: the offer under it
      // (not on a draft: the answer is not there yet)
      const offer =
        !draft && part.kind === "gloss" && part.source === "general" && part.offer && !answer.addedQuestionId ? <OfferToList text={question} who={part.offer} locale={locale} /> : null;
      const after = offer && i === lastAt && toList ? (
        <>
          {offer}
          {toList}
        </>
      ) : (offer ?? (i === lastAt ? toList : undefined));
      const caret = !!draft?.writing && part.kind === "gloss" && part.source === "general";
      line.push(<PartItem key={key} part={part} locale={locale} card={part.kind === "quote" && before?.sourceId === part.source} after={after ?? undefined} caret={caret} />);
    });
    // where his question went: on the list for the next visit (a tick), with the way to the list
    if (!before && answer.addedQuestionId) {
      line.push(
        <TimelineItem
          key="added"
          node="ok"
          title={questionRowWords(locale, answer, ui.added)}
          testId="ask-question-added"
          attrs={{ "data-question": answer.addedQuestionId, "data-reused": answer.questionReused ? "true" : "false", "data-asked": answer.reusedQuestion?.date }}
          actions={
            <Acts>
              <Act variant="outline" href="/p/questions">
                {CHAT_WORDS[locale].seeQuestions}
              </Act>
            </Acts>
          }
        />,
      );
    }
    // an answer made without his consent to AI processing says so, last and once: a plain point with the grey line
    if (noAi) line.push(<TimelineItem key="no-ai" node="dot" note={copy.noAi} testId="answer-no-ai" />);
    // SSE: the stage line under what has come so far
    if (draft) {
      line.push(
        <TimelineItem key="draft-stage" node="rip">
          <p className="rpu-tl-note" role="status" data-testid={draft.testId}>
            {draft.line}
          </p>
        </TimelineItem>,
      );
    }
    flush("line-end");
    // (an answered question whose last part is not an entry of the line: the way to the list stands under it by itself)
    const lastPart = parts[lastAt];
    if (toList && (!lastPart || lastPart.kind === "emergency" || lastPart.kind === "hotlines")) {
      blocks.push(
        <div key="to-list" className="rpu-ind">
          {toList}
        </div>,
      );
    }
    body = blocks;
  }

  if (draft) {
    // SSE: what has come so far, never "the answer" (see the header)
    return (
      <div data-testid="ask-draft" data-complete="false" data-route={answer.route} aria-busy="true">
        <section className="rpu-stack" data-testid="ask-draft-turn" data-route={answer.route}>
          {body}
        </section>
      </div>
    );
  }
  const card = (
    <section className="rpu-stack" data-testid="ask-turn" data-route={answer.route} data-latest={latest ? "true" : "false"}>
      {body}
    </section>
  );
  // the latest answer is also "the answer" (the old answer box's hook): complete as soon as it is drawn
  return latest ? (
    <div data-testid="ask-answer" data-complete="true" data-route={answer.route} data-settled={settled ? "true" : undefined}>
      {card}
    </div>
  ) : (
    card
  );
}
