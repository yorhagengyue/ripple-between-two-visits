/**
 * Her 「留意」 holds one card per conversation (the guided harness, 10-16; the owner's coordinator's decision): when he
 * answers Ripple's follow-up questions, each answer that she is told about is a notice of its own (lib/care/told.ts
 * toldNotices), and each carries the conversation so far (ToldNotice.steps). The later notice of a conversation takes the
 * earlier one's place: the card shows the latest steps, and her notice opened by an earlier one's address shows the latest
 * too. Client-safe, pure.
 *
 * A notice continues an earlier one when it starts from the same first message of his (`words`, `lang`), carries more
 * steps, the earlier one's steps are the first of its own, and it came within CONVERSATION_MS of it (a pathway asks at most
 * three questions, each answered within the reply's 30 minutes). The same sentence said twice without a question in between
 * stays two notices.
 */
import type { ToldNotice } from "./told";

export const CONVERSATION_MS = 2 * 60 * 60_000;

const sameStep = (a: { question: string; answer: string }, b: { question: string; answer: string }) => a.question === b.question && a.answer === b.answer;

/** `later` continues `earlier` (see the header). */
export function continues(later: ToldNotice, earlier: ToldNotice): boolean {
  if (later.id === earlier.id || later.words !== earlier.words || (later.lang ?? null) !== (earlier.lang ?? null)) return false;
  const a = earlier.steps ?? [];
  const b = later.steps ?? [];
  if (b.length <= a.length || !a.every((s, i) => sameStep(s, b[i]))) return false;
  const gap = Date.parse(later.at) - Date.parse(earlier.at);
  return Number.isFinite(gap) && gap >= 0 && gap <= CONVERSATION_MS;
}

/** One notice per conversation, the latest of each, in the order given (newest first from toldNotices). */
export function latestPerConversation(notices: readonly ToldNotice[]): ToldNotice[] {
  return notices.filter((n) => !notices.some((m) => continues(m, n)));
}

/** The latest notice of the conversation the notice `id` belongs to (itself when nothing continues it), or null. */
export function latestOfConversation(notices: readonly ToldNotice[], id: string): ToldNotice | null {
  let current = notices.find((n) => n.id === id) ?? null;
  for (let hops = 0; current && hops < 6; hops++) {
    const from: ToldNotice = current;
    const next = notices.filter((m) => continues(m, from)).sort((x, y) => (y.steps?.length ?? 0) - (x.steps?.length ?? 0))[0];
    if (!next) break;
    current = next;
  }
  return current;
}
