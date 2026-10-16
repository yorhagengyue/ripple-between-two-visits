"use client";

/**
 * His conversation with Ripple, one day at a time (journey 04; 老人端提示词 04.1-04.4; M13), drawn as the timeline
 * draft's group 04 「随时说一句」 (04-2, 04-3a, 04-3b, 04-4; web/progress/fe-04.md): the day is one line, and the node of
 * each entry says whose words they are. The server page hands it one day (lib/chat/view.ts chatDay) and draws the header
 * (the date, 「今天说过的话」). The screen is the day's record and nothing else: it has no field of its own (owner's tidy
 * of 10-13); he says or asks something on Today and on the ask screen (/p/ask), and it is here the next time the page is
 * read. After he adds a question from here the page's server data is read again (router.refresh), so what is on screen
 * is always what was kept.
 *
 *   each turn      his own node (the filled ink circle): 「你 · 早上 8:52」 and his words, plain; then Ripple's answer as
 *                  track S kept it, one entry per part (ChatAnswer): the purple square and the sentence in its bubble
 *   check-in       when Ripple asked 「今天的药吃了吗？」: 「去今天页记」 under that sentence (Today is where he answers
 *                  it; no dose is logged here)
 *   can't help     under S's 「这个我帮不上，要我记下来吗？」: 「记下来」 saves his words as today's note (POST /api/notes,
 *                  as the 问一句 screen does) and Ripple says 「记下了。」; 「不用」 puts the two buttons away (nothing
 *                  is kept of it: the back end has no such answer)
 *   under a note   about a symptom his doctor talked about (04-3a): the doctor's own line in a card on the doctor's
 *                  node: 「医生说 · 9月6日 · 0:37」, the words in the serif face, the checked Chinese under English
 *                  words, 「听原声」, and 「加进问题单」: only when he taps does his note go on the list. Then (04-3b) the
 *                  tick: 「已在下次看诊的问题单里」 and 「看问题单」
 *   a question     (the guided harness, 2026-10-16) Ripple's follow-up question under an answer, as the ask screen draws it
 *                  (components/daily/FollowUpQuestion.tsx), read only: answered, with what he chose marked (the turn
 *                  after it was his tap, its words his words), or closed. He answers it on the ask screen, where it was
 *                  asked; nothing here sends one (owner's tidy of 10-13: the record has no ask of its own)
 *   today          without a network a grey box says so (「要连上网才能问。」)
 *   nothing yet    one grey entry: 「想说什么，随时说一句。」
 *   other days     a card with a row per day he talked, newest first; such a day is read only
 *
 * Test hooks: chat-screen (data-day, data-today, data-turns), chat-turn (data-turn, data-route), chat-his, chat-write
 * (data-noted), chat-write-down, chat-write-skip, chat-noted, chat-related (data-source), chat-related-translation,
 * chat-related-add, chat-related-added (data-question), chat-checkin, chat-empty, chat-offline, chat-error, chat-days,
 * chat-day (data-date).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Act, Acts, Bubble, ListCard, ListItem, Said, SaidTranslation, Timeline, TimelineItem } from "@/components/ui";
import { askCopy } from "@/components/daily/ask-copy";
import { followUpOf } from "@/components/daily/follow-up";
import { FollowUpQuestion } from "@/components/daily/FollowUpQuestion";
import type { ChatDayView, ChatTurnView } from "@/lib/chat/view";
import { clockWords, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { uiCopy } from "@/lib/ui/copy";
import { ChatAnswer, SourceLine } from "./ChatAnswer";
import { CHAT_WORDS } from "./copy";
import { PlayClip } from "./PlayClip";
import "./chat.css";

export { CHAT_WORDS };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: {} };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * One turn: his entry, Ripple's entries, the doctor's line under a note, Ripple's follow-up question. `last`: the day's rule
 * ends with this turn. `replies`: the follow-up questions he answered that day, and with what.
 */
function Turn({
  turn,
  locale,
  today,
  last,
  onDone,
  replies,
}: {
  turn: ChatTurnView;
  locale: Locale;
  today: boolean;
  last: boolean;
  onDone: () => void;
  replies: ReadonlyMap<string, readonly string[]>;
}) {
  const w = CHAT_WORDS[locale];
  const copy = askCopy(locale);
  const ui = uiCopy(locale);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<null | "note" | "question">(null);
  const [addedNow, setAddedNow] = useState<string | null>(null);
  const [notedNow, setNotedNow] = useState(false);
  const [declined, setDeclined] = useState(false);
  // what the server kept, or what he just did on this screen (until the next read says the same)
  const added = turn.added?.questionId ?? addedNow;
  const noted = turn.noted || notedNow;
  const cantHelp = turn.answer?.route === "cant_help";
  const related = turn.related;

  // chit-chat (S's cant_help): his words as today's note, exactly as the 问一句 screen saves them
  async function writeDown() {
    setBusy(true);
    setFailed(null);
    const r = await postJson("/api/notes", { text: turn.text, source: "typed" });
    setBusy(false);
    if (!r.ok) return setFailed("note");
    setNotedNow(true);
  }

  async function addQuestion() {
    setBusy(true);
    setFailed(null);
    const r = await postJson("/api/chat/question", { turn: turn.id });
    setBusy(false);
    const id = (r.data.question as { id?: string } | undefined)?.id;
    if (!r.ok || !id) return setFailed("question");
    setAddedNow(id);
    onDone();
  }

  const error = (
    <p className="rpu-tl-note" role="alert" data-testid="chat-error">
      {w.failed}
    </p>
  );

  return (
    <article className="fe04-turn" data-testid="chat-turn" data-turn={turn.id} data-route={turn.answer?.route ?? ""}>
      <Timeline open={!last}>
        <TimelineItem node="me" who={w.you} meta={clockWords(locale, turn.time)}>
          <Bubble node="me" lang={turn.lang ?? undefined} testId="chat-his">
            {turn.text}
          </Bubble>
        </TimelineItem>

        {turn.answer ? (
          <ChatAnswer
            answer={turn.answer}
            locale={locale}
            slots={{
              // Ripple asked 「今天的药吃了吗？」: Today is where he answers it
              checkIn:
                turn.checkIn && today ? (
                  <div className="fe04-under" data-testid="chat-checkin">
                    <Acts>
                      <Act href="/p/today">{w.checkIn}</Act>
                    </Acts>
                  </div>
                ) : undefined,
              cantHelp: cantHelp ? (
                <div className="fe04-under" data-testid="chat-write" data-noted={noted ? "true" : "false"}>
                  {today && !noted && !declined ? (
                    <Acts cols={2}>
                      <Act variant="primary" pending={busy} onClick={() => void writeDown()} data-testid="chat-write-down">
                        {copy.writeDown}
                      </Act>
                      <Act disabled={busy} onClick={() => setDeclined(true)} data-testid="chat-write-skip">
                        {ui.noNote}
                      </Act>
                    </Acts>
                  ) : null}
                  {failed === "note" ? error : null}
                </div>
              ) : undefined,
            }}
          />
        ) : null}

        {cantHelp && noted ? (
          <TimelineItem node="rip">
            <div role="status" data-testid="chat-noted">
              <Bubble>{copy.written}</Bubble>
            </div>
          </TimelineItem>
        ) : null}

        {related ? (
          <TimelineItem
            node="doc"
            frame="card"
            testId="chat-related"
            attrs={{ "data-source": `${related.visitId}:${related.utteranceId}` }}
            actions={
              <div className="fe04-under">
                {added ? null : (
                  <Acts>
                    <Act variant="outline" pending={busy} onClick={() => void addQuestion()} data-testid="chat-related-add">
                      {w.addQuestion}
                    </Act>
                  </Acts>
                )}
                {failed === "question" ? error : null}
              </div>
            }
          >
            <SourceLine kind="doctor" node="doc" who={copy.doctorSaid} when={`${related.date} · ${related.at}`} />
            <Said lang={related.lang} source={{ kind: "doctor", ref: related.utteranceId }}>
              {related.lang === "en" ? `“${related.text}”` : `「${related.text}」`}
            </Said>
            {/* C2 track S (round 2): the checked Chinese under the doctor's English words; nothing in the English UI */}
            {related.zh && locale === "zh-Hans" ? (
              <div className="fe04-zh" data-testid="chat-related-translation" lang="zh-Hans">
                <SaidTranslation note={TRANSLATION_LABEL["zh-Hans"]}>{related.zh}</SaidTranslation>
              </div>
            ) : null}
            {related.clipUrl ? <PlayClip url={related.clipUrl} standIn={related.standIn} locale={locale} label={copy.listen} playingLabel={copy.listening} /> : null}
          </TimelineItem>
        ) : null}

        {related && added ? (
          <TimelineItem
            node="ok"
            title={ui.added}
            note={ui.askDoctor}
            testId="chat-related-added"
            attrs={{ "data-question": added }}
            actions={
              <Acts>
                <Act variant="outline" href="/p/questions">
                  {w.seeQuestions}
                </Act>
              </Acts>
            }
          />
        ) : null}

        {/* harness (10-16): Ripple's follow-up question, last, read only (he answers it on the ask screen) */}
        {turn.answer?.followUp ? <FollowUpQuestion followUp={turn.answer.followUp} locale={turn.answer.locale ?? locale} state={followUpOf(turn.answer, replies)} /> : null}
      </Timeline>
    </article>
  );
}

export function ChatScreen({ view, locale }: { view: ChatDayView; locale: Locale }) {
  const router = useRouter();
  const w = CHAT_WORDS[locale];
  const list = useRef<HTMLDivElement | null>(null);
  const count = view.turns.length;
  /** harness (10-16): the follow-up questions he answered that day (a turn that was his tap names the question) */
  const replies = new Map(view.turns.flatMap((t) => (t.reply ? [[t.reply.followUpId, t.reply.optionIds] as const] : [])));
  /** how many turns the screen showed last (null before the first paint) */
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const before = shown.current;
    shown.current = count;
    // the same turns as before (development runs an effect twice): nothing new to show
    if (before === count) return;
    const turns = list.current?.querySelectorAll('[data-testid="chat-turn"]');
    const newest = turns?.[turns.length - 1];
    if (before === null) {
      // the first paint. An earlier day opens at its top. Today too (the date and the day's first words), unless the
      // newest turn starts far down or below the screen: then the screen opens on it
      if (!view.isToday || !newest || newest.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    }
    // the newest turn's top at the top of the screen: his words, then Ripple's answer under them (the bar at the foot
    // would hide the end of a turn scrolled to the bottom)
    newest?.scrollIntoView({ block: "start" });
  }, [count, view.isToday]);

  return (
    <div className="rpu-stack" data-testid="chat-screen" data-day={view.date} data-today={view.isToday ? "true" : "false"} data-turns={count}>
      {count ? (
        // the turns and nothing else: the day's rule ends with the last of them
        <div ref={list}>
          {view.turns.map((t, i) => (
            <Turn key={t.id} turn={t} locale={locale} today={view.isToday} last={i === count - 1} onDone={() => router.refresh()} replies={replies} />
          ))}
        </div>
      ) : (
        <Timeline>
          <TimelineItem node={view.isToday ? "next" : "miss"} title={view.isToday ? w.empty : w.noneThatDay} testId="chat-empty" />
        </Timeline>
      )}

      {/* no field here: the screen is the day's record; he says or asks something on Today and on the ask screen
          (owner's tidy of 10-13) */}

      {view.days.length > 0 && (
        <div data-testid="chat-days">
          <ListCard heading={w.earlier}>
            {view.days.map((d) => (
              <ListItem key={d.day} mark="me" title={`${shortDay(locale, d.date)} · ${w.dayCount(d.count)}`} chevron href={`/p/chat?date=${d.date}`} testId="chat-day" attrs={{ "data-date": d.date }} />
            ))}
          </ListCard>
        </div>
      )}
    </div>
  );
}
