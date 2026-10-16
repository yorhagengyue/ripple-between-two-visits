"use client";

/**
 * The watch's one observation and his answer (journey 12; design 12-1 and 12-2), as an entry of a timeline whose node
 * is the watch's (the grey square): the observation (a fixed sentence that only describes) with the question 「要把这件事
 * 加进下次 check-in 的问题吗？」 in the same paragraph, his usual range in grey under it, and two worded buttons, 要 / 不要.
 * Nothing happens until he taps: 要 puts a question for the doctor on his list (POST /api/watch/answer; the entry then
 * says so, with the way to the list, and stays answered for the rest of the day), 不要 keeps only this look. The
 * question and the two buttons are on Today's cell and on his question list; the watch screen has the words only.
 *
 *   mode "today"   the cell on Today (12-2). Today's page draws the entry and its node (components/daily/elder/
 *                  TodayAccount.tsx: one TimelineItem per cell), so this draws what is inside it: the head line
 *                  「手表 · 看手表上的走势 ›」, the words, the buttons. After 要 the tick and 「已在下次看诊的问题单里」 sit in
 *                  the same entry; after 不要 the entry folds to its head line and 「好，不加。」
 *   mode "screen"  the watch screen (12-1): the entry itself (a TimelineItem, so it must be a direct child of a
 *                  <Timeline>), headed 「手表 · 观察」: the observation and his usual range, no question and no buttons
 *                  (the draft's entry has none; owner's tidy of 10-13). Once he answered elsewhere that day: after 要
 *                  a second entry with the tick follows it, as on every other screen where something went on the
 *                  list; after 不要 「好，不加。」
 *   mode "list"    his question list (ux pass 10-12, round 3; app/p/questions/AccountQuestions.tsx): the entry itself,
 *                  headed 「手表 · 看手表上的走势 ›」 like Today's cell. After 要 the list is read again from the server: this
 *                  entry is gone and the question it added is there, marked 「刚加上的」. After 不要: 「好，不加。」
 *
 * The request names no scope (the phone's own sign-in cookie does). Test hooks: watch-card (data-key, data-state,
 * data-mode), watch-sentence, watch-ask, watch-usual, watch-yes, watch-no, watch-added, watch-declined, watch-error.
 */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Act, Acts, Bubble, Chevron, NodeMark, Tag, TimelineItem, TlControls, TlNote, UiLink } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { uiCopy } from "@/lib/ui/copy";
import { ANSWER_WORDS, DECLINED_SENTENCE } from "@/lib/watch/sentences";
import type { WatchCardData } from "@/lib/watch/today";
import { WATCH_WORDS } from "./copy";
import "./watch.css";

type State = "asking" | "sending" | "added" | "declined" | "error";

export function WatchCard({ card, locale, mode = "today" }: { card: WatchCardData; locale: Locale; mode?: "today" | "screen" | "list" }) {
  const router = useRouter();
  const [state, setState] = useState<State>(card.answered ? (card.answered.answer === "yes" ? "added" : "declined") : "asking");
  const w = WATCH_WORDS[locale];
  const ui = uiCopy(locale);
  const answers = ANSWER_WORDS[locale];

  async function answer(a: "yes" | "no") {
    setState("sending");
    const res = await fetch(`/api/watch/answer?locale=${encodeURIComponent(locale)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ key: card.key, answer: a }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setState("error");
      return;
    }
    // on his question list 要 is read back from the server: this entry gives way to the question it just put there,
    // marked 「刚加上的」 the way a question he added himself is
    if (mode === "list" && a === "yes") {
      const said = (await res.json().catch(() => null)) as { question?: { id?: string; outcome?: string } | null } | null;
      const q = said?.question;
      router.replace(q?.id ? `/p/questions?added=${encodeURIComponent(q.outcome ?? "created")}&q=${encodeURIComponent(q.id)}` : "/p/questions", { scroll: false });
      router.refresh();
      return;
    }
    // elsewhere no refresh is needed: the server keeps today's answered card (watchToday), so a later refresh shows the same thing
    setState(a === "yes" ? "added" : "declined");
  }

  // the watch screen shows the observation as words only: neither the question nor 要 / 不要 (owner's tidy of 10-13).
  // He answers on Today's cell or on his question list's entry
  const asking = mode !== "screen" && (state === "asking" || state === "sending" || state === "error");
  /** Today's cell after 不要: only the head line and 「好，不加。」 */
  const folded = mode === "today" && state === "declined";

  const words: ReactNode = (
    <>
      <Bubble node="wch">
        <span data-testid="watch-sentence">{card.sentence}</span>
        {asking && (
          <>
            {locale === "en" ? " " : ""}
            <span data-testid="watch-ask">{card.ask}</span>
          </>
        )}
      </Bubble>
      <TlNote testId="watch-usual">{w.usual(card.usual)}</TlNote>
      {card.example && (
        <TlControls>
          <Tag>{w.example}</Tag>
        </TlControls>
      )}
    </>
  );

  const buttons: ReactNode = asking ? (
    <>
      <Acts cols={2}>
        <Act pending={state === "sending"} onClick={() => void answer("yes")} data-testid="watch-yes">
          {answers.yes}
        </Act>
        <Act disabled={state === "sending"} onClick={() => void answer("no")} data-testid="watch-no">
          {answers.no}
        </Act>
      </Acts>
      {state === "error" && (
        <p className="rpu-f-error" role="alert" data-testid="watch-error">
          {w.failed}
        </p>
      )}
    </>
  ) : null;

  const toList = (
    <Acts cols={1}>
      <Act variant="outline" href="/p/questions">
        {w.seeQuestions}
      </Act>
    </Acts>
  );

  if (mode === "list") {
    return (
      <TimelineItem
        node="wch"
        who={w.who}
        meta={
          <UiLink href="/p/watch" nav="forward" className="rpu-inline-link" data-rp="inline-link" data-testid="watch-trends-link">
            {w.trends}
            <Chevron />
          </UiLink>
        }
        testId="watch-card"
        attrs={{ "data-key": card.key, "data-state": state, "data-mode": mode }}
        actions={buttons}
      >
        {words}
        {state === "declined" && <TlNote testId="watch-declined">{DECLINED_SENTENCE[locale]}</TlNote>}
      </TimelineItem>
    );
  }

  if (mode === "screen") {
    return (
      <>
        <TimelineItem node="wch" who={w.who} meta={w.observation} testId="watch-card" attrs={{ "data-key": card.key, "data-state": state, "data-mode": mode }} actions={buttons}>
          {words}
          {state === "declined" && <TlNote testId="watch-declined">{DECLINED_SENTENCE[locale]}</TlNote>}
        </TimelineItem>
        {state === "added" && <TimelineItem node="ok" title={ui.added} note={ui.askDoctor} testId="watch-added" actions={toList} />}
      </>
    );
  }

  return (
    <div className="rp12-cell" data-testid="watch-card" data-key={card.key} data-state={state} data-mode={mode}>
      <p className="rpu-tl-head">
        <span className="rpu-tl-who" data-node="wch">
          {w.who}
        </span>
        {" · "}
        <UiLink href="/p/watch" nav="forward" className="rpu-inline-link" data-rp="inline-link" data-testid="watch-trends-link">
          {w.trends}
          <Chevron />
        </UiLink>
      </p>
      {folded ? (
        <div data-testid="watch-declined">
          <Bubble node="wch">{DECLINED_SENTENCE[locale]}</Bubble>
        </div>
      ) : (
        <>
          {words}
          {buttons}
          {state === "added" && (
            <div className="rp12-cell" data-testid="watch-added">
              <p className="rpu-tl-title rp12-done">
                <NodeMark node="ok" />
                <span>{ui.added}</span>
              </p>
              <TlNote>{ui.askDoctor}</TlNote>
              {toList}
            </div>
          )}
        </>
      )}
    </div>
  );
}
