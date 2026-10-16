/**
 * The follow-up question under an answer (the guided harness, 2026-10-16; lib/safety/risk/types.ts FollowUp): the words
 * the screens draw and send for it. Client-safe, no React. The question and its options are lib/safety's own fixed words
 * (templates.ts), in both languages; nothing here writes one.
 *
 * His tap is a new POST /api/ask: `text` is the chosen options' words in the answer's language (several joined with 「、」
 * in Mandarin, ", " in English), so his conversation shows his tap as his own words, and `reply` names the question and the
 * options (FollowUpReply). The options keep the question's order whatever order he ticked them in.
 */
import type { FollowUp, FollowUpOption, FollowUpReply } from "@/lib/safety/risk/types";
import type { UiLocale } from "@/lib/ui/tokens";

/** The question in the answer's language. */
export function followUpWords(followUp: Pick<FollowUp, "en" | "zh">, locale: UiLocale): string {
  return locale === "en" ? followUp.en : followUp.zh;
}

/** One option's words in the answer's language. */
export function optionWords(option: Pick<FollowUpOption, "en" | "zh">, locale: UiLocale): string {
  return locale === "en" ? option.en : option.zh;
}

/** His choice as the next ask: the options' words as his words, and the reply that names them. Null when none is an option. */
export function followUpReply(followUp: Pick<FollowUp, "id" | "options">, optionIds: readonly string[], locale: UiLocale): { text: string; reply: FollowUpReply } | null {
  const chosen = followUp.options.filter((o) => optionIds.includes(o.id));
  if (chosen.length === 0) return null;
  return {
    text: chosen.map((o) => optionWords(o, locale)).join(locale === "en" ? ", " : "、"),
    reply: { followUpId: followUp.id, optionIds: chosen.map((o) => o.id) },
  };
}

/**
 * Several may be chosen (`multi`): one tap on an option, ticked or unticked. 「都没有」 / "None of these" (id "none") stands
 * alone: ticking it clears the signs, and ticking a sign clears it; 「不确定」 / "Not sure" (and "I'd rather not say") goes
 * with anything (the owner's coordinator's decision, 10-16). The ids are the engine's (lib/safety/templates.ts FOLLOW_UPS).
 */
export const NONE_OPTION = "none";
const FREE_OPTIONS = new Set(["unsure", "rather_not"]);

export function toggleOption(ticked: readonly string[], id: string): string[] {
  if (ticked.includes(id)) return ticked.filter((x) => x !== id);
  if (id === NONE_OPTION) return [...ticked.filter((x) => FREE_OPTIONS.has(x)), id];
  if (FREE_OPTIONS.has(id)) return [...ticked, id];
  return [...ticked.filter((x) => x !== NONE_OPTION), id];
}

/**
 * Where the screen goes when an answer with a question arrives (10-16, the owner's coordinator's decision: the question is
 * never scrolled past unknowingly). All in the scroller's own pixels from the top of its content; `view` is how much of it
 * shows (the fixed bars at the foot taken off). The 995 line (`anchor`: the 995 card, or the first line with a number to
 * call) is kept in view:
 *   - the whole question shows from the top of the screen: the top
 *   - the 995 line and the whole question fit together: down until the question's last button shows
 *   - the 995 line and the question with its first answer fit: the 995 line at the top
 *   - neither: the top, and the chip 「Ripple 想问你一句 ↓」 that takes him to it
 * Without a 995 line the question follows his words, so the top shows it.
 */
export function followUpScroll(g: {
  view: number;
  question: { top: number; firstBottom: number; bottom: number };
  anchor: { top: number } | null;
  margin?: number;
}): { scrollTo: number; chip: boolean } {
  const m = g.margin ?? 12;
  const q = g.question;
  if (q.bottom + m <= g.view) return { scrollTo: 0, chip: false };
  if (!g.anchor) return { scrollTo: Math.max(0, q.top - m), chip: false };
  const top = Math.max(0, g.anchor.top - m);
  if (q.bottom + m - top <= g.view) return { scrollTo: Math.max(0, q.bottom + m - g.view), chip: false };
  if (q.firstBottom + m - top <= g.view) return { scrollTo: top, chip: false };
  return { scrollTo: 0, chip: true };
}

/** How the question stands on a screen, and what a tap does (FollowUpQuestion.tsx draws it). */
export interface FollowUpState {
  /** the options he chose: a later turn of his answered it (AskTurn.reply), or, with `pending`, his answer is on its way */
  chosen?: readonly string[];
  /** his answer (`chosen`) is on its way (the screen's own say; a tap on the question says so by itself until its ask is done) */
  pending?: boolean;
  /**
   * a tap: the screen asks with these words and this reply, the way it asks a typed question, and settles when that ask is
   * done (answered, or it did not go through). Left out, nothing can be tapped.
   */
  onReply?: (ask: { text: string; reply: FollowUpReply }) => Promise<unknown> | void;
}

/** The follow-up questions he answered in these turns: each question's id and the options he chose (lib/safety/turns.ts AskTurn.reply). */
export function answeredFollowUps(turns: readonly { reply?: FollowUpReply }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of turns) if (t.reply) out.set(t.reply.followUpId, t.reply.optionIds);
  return out;
}

/**
 * How an answer's question stands among today's turns: answered (a later turn of his answered it: `replies`), on its way
 * (`sending`: his tap on it), or his to answer (`onReply`, which a screen gives only to the latest answer: an earlier
 * answer's question that was never answered is closed, since what he said after it moved the conversation on). Undefined
 * for an answer without a question.
 */
export function followUpOf(
  answer: { followUp?: Pick<FollowUp, "id"> },
  replies: ReadonlyMap<string, readonly string[]>,
  sending?: FollowUpReply | null,
  onReply?: FollowUpState["onReply"],
): FollowUpState | undefined {
  const id = answer.followUp?.id;
  if (!id) return undefined;
  const chosen = replies.get(id);
  if (chosen) return { chosen };
  if (sending && sending.followUpId === id) return { chosen: sending.optionIds, pending: true };
  return onReply ? { onReply } : {};
}
