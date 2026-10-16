"use client";

/**
 * The follow-up question under an answer (the guided harness, 2026-10-16; lib/safety/risk/types.ts FollowUp): ONE fixed
 * question of lib/safety's with two to five options, drawn as an entry of the answer's line right after its crisis lines
 * (the 995 card, the 995 lines, the helplines, the safety line) and before the rest of it (AnswerCard; the owner's
 * coordinator's decision of 10-16, so the question is seen on arrival: follow-up-place.ts scrolls to it, and when it cannot
 * show with the 995 line, FollowUpChip 「Ripple 想问你一句 ↓」 takes him there).
 *
 * Drawn with what the ask screen already has (the owner does not trust looks an AI invents): Ripple's entry with the
 * question in its tinted bubble, then one <Act> per option, one per row (the buttons of a row of actions, 56 high, the size
 * of the primary ones). Every option is an outline button (10-16, the coordinator's decision: the only filled red on the
 * screen is the real 995 call): the 995 side (tone "danger") with the red edge and red words of 「删掉这次读数」
 * (variant "danger-outline", .rpu-btn's danger-outline on the row's button), the neutral and the calm ones the plain
 * button alike, so nothing leans him towards the reassuring answer. A chosen option is the filled ink button his medicine
 * card's checklist uses for an answer he gave (variant "on", aria-pressed). Where several may be chosen, 「都没有」 stands
 * alone and 「不确定」 goes with anything (follow-up.ts toggleOption).
 *
 * The question and the options are in the answer's language (FollowUp.en / .zh by the answer's locale), and so is the one
 * word this file adds, 「好了」 / "Done" (ask-copy.ts followUpDone).
 *
 *   open       his to answer (the screen passes `onReply`): a tap on an option sends it at once; where several may be
 *              chosen (`multi`) a tap ticks or unticks one and 「好了」 sends what is ticked
 *   pending    his answer is on its way: the options he chose stay marked (busy), the others are off, the waiting line
 *              under them. A failure opens the question again; the screen says why where it says it for a typed question
 *   answered   a later turn of his was his answer (lib/safety/turns.ts AskTurn.reply): the options he chose marked, nothing
 *              to tap
 *   closed     not his to answer here (an earlier answer: only the latest answer's question is live; the day's record):
 *              every option off
 * His typed or spoken words while a question is open are a new ask like any other: the engine decides whether they answer it.
 *
 * Accessibility: the question is a group labelled by its own words; each option is a real button; the pending line is a
 * status. Test hooks: ask-followup (data-followup, data-pathway, data-step, data-of, data-multi, data-state),
 * ask-followup-question, ask-followup-option (data-option, data-tone, aria-pressed), ask-followup-done, ask-followup-pending.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Act, Acts, Bubble, TimelineItem } from "@/components/ui";
import type { FollowUp } from "@/lib/safety/risk/types";
import type { UiLocale } from "@/lib/ui/tokens";
import { askCopy } from "./ask-copy";
import { followUpReply, followUpWords, optionWords, toggleOption, type FollowUpState } from "./follow-up";

export type { FollowUpState };

/** The entry's body is a column 8px apart (.rpu-tl-body); the group that holds the question keeps that column. */
const COLUMN = { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } as const;

export function FollowUpQuestion({ followUp, locale, state }: { followUp: FollowUp; locale: UiLocale; state?: FollowUpState }) {
  const questionId = useId();
  const copy = askCopy(locale);
  /** multi: what he ticked so far */
  const [ticked, setTicked] = useState<string[]>([]);
  /** what he just sent from here, until that ask is done (the screen may not say `pending` itself) */
  const [sent, setSent] = useState<readonly string[] | null>(null);
  const lock = useRef(false);

  /** on its way: sent from here, or the screen says so */
  const pending = sent !== null || (!!state?.pending && !!state.chosen);
  const chosen = sent ?? state?.chosen;
  const live = !!state?.onReply && !chosen;
  const status = pending ? "pending" : chosen ? "answered" : live ? "open" : "closed";
  const marked: readonly string[] = chosen ?? (followUp.multi && live ? ticked : []);

  async function send(optionIds: readonly string[]) {
    const onReply = state?.onReply;
    const ask = followUpReply(followUp, optionIds, locale);
    if (!onReply || !ask || lock.current) return;
    lock.current = true;
    setSent(ask.reply.optionIds);
    try {
      await onReply(ask);
    } finally {
      // done: the next answer has the screen now, or the question is open again (the screen said why)
      lock.current = false;
      setSent(null);
    }
  }

  const tap = (id: string) => {
    if (!live) return;
    if (followUp.multi) setTicked((t) => toggleOption(t, id));
    else void send([id]);
  };

  return (
    <TimelineItem
      node="rip"
      testId="ask-followup"
      attrs={{
        "data-followup": followUp.id,
        "data-pathway": followUp.pathway,
        "data-step": followUp.step,
        "data-of": followUp.of,
        "data-multi": followUp.multi ? "true" : "false",
        "data-state": status,
      }}
    >
      <div role="group" aria-labelledby={questionId} lang={locale} style={COLUMN}>
        <Bubble id={questionId} lang={locale} testId="ask-followup-question">
          {followUpWords(followUp, locale)}
        </Bubble>
        <Acts cols={1}>
          {followUp.options.map((o) => {
            const on = marked.includes(o.id);
            const variant = on ? "on" : o.tone === "danger" ? "danger-outline" : "secondary";
            const hooks = { "data-testid": "ask-followup-option", "data-option": o.id, "data-tone": o.tone ?? "neutral" };
            if (live) {
              return (
                <Act key={o.id} variant={variant} aria-pressed={followUp.multi ? on : undefined} onClick={() => tap(o.id)} {...hooks}>
                  {optionWords(o, locale)}
                </Act>
              );
            }
            // not to be tapped: what he chose stays marked (busy while it is on its way; a plain disabled button would lose
            // its mark: .rpu-act:disabled greys it), the rest are off
            if (on) {
              return pending ? (
                <Act key={o.id} variant="on" aria-pressed pending {...hooks}>
                  {optionWords(o, locale)}
                </Act>
              ) : (
                <Act key={o.id} variant="on" aria-pressed aria-disabled="true" {...hooks}>
                  {optionWords(o, locale)}
                </Act>
              );
            }
            return (
              <Act key={o.id} variant={variant} disabled {...hooks}>
                {optionWords(o, locale)}
              </Act>
            );
          })}
          {followUp.multi && live ? (
            <Act variant="primary" disabled={ticked.length === 0} onClick={() => void send(ticked)} data-testid="ask-followup-done">
              {copy.followUpDone}
            </Act>
          ) : null}
        </Acts>
        {pending ? (
          <p className="rpu-tl-note" role="status" data-testid="ask-followup-pending">
            {copy.sending}
          </p>
        ) : null}
      </div>
    </TimelineItem>
  );
}

/**
 * 「Ripple 想问你一句 ↓」 / "Ripple has a question for you ↓" (10-16, the coordinator's decision): when the answer's question
 * cannot show on arrival together with the 995 line, the screen stays on the 995 line and this chip (the screens' chip,
 * .rpu-chip) stands at the foot of the view over what is under it; a tap takes him to the question. It goes away once the
 * question has been on the screen. `question`: finds the question's entry; `root`: the scroller when it is not the window
 * (the Ask sheet); `bottom`: how far above the foot of the view it stands (over the fixed bars there).
 */
export function FollowUpChip({
  locale,
  question,
  root,
  bottom,
  onSeen,
  style,
}: {
  locale: UiLocale;
  question: () => HTMLElement | null;
  root?: () => HTMLElement | null;
  bottom: string;
  onSeen: () => void;
  style?: CSSProperties;
}) {
  const copy = askCopy(locale);
  useEffect(() => {
    const el = question()?.querySelector('[data-testid="ask-followup-question"]') ?? question();
    if (!el || typeof IntersectionObserver === "undefined") return;
    // seen: the question's words wholly on the screen above the chip and the bars, or scrolled past
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 0.99 || e.boundingClientRect.bottom < (e.rootBounds?.top ?? 0))) onSeen();
    }, { root: root?.() ?? null, rootMargin: "0px 0px -140px 0px", threshold: [0, 0.99, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [question, root, onSeen]);
  return (
    <button
      type="button"
      className="rpu-chip"
      data-rp="chip"
      data-testid="ask-followup-chip"
      onClick={() => question()?.scrollIntoView({ block: "start" })}
      style={{ position: "sticky", bottom, zIndex: 5, alignSelf: "center", ...style }}
    >
      {copy.followUpChip}
    </button>
  );
}
