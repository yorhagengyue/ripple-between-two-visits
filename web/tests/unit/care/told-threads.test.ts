/**
 * Her 「留意」 holds one card per conversation (the guided harness, 10-16; lib/care/told-threads.ts): the later notice of a
 * conversation (his answer to the next follow-up question) takes the earlier one's place, an earlier notice's address opens
 * the latest, and the same sentence said twice without a question in between stays two notices.
 */
import { describe, expect, it } from "vitest";
import type { ToldNotice } from "@/lib/care/told";
import { continues, latestOfConversation, latestPerConversation } from "@/lib/care/told-threads";

const base = { lines: [], answerLang: "en" as const, openedAt: null, lang: "en" };
const Q1 = { question: "Are you having thoughts of ending your life or hurting yourself?", answer: "I'd rather not say" };
const Q2 = { question: "Are you thinking of doing it soon, or do you have something ready to do it with?", answer: "I'd rather not say" };
const WORDS = "I counted my pills last night. There are enough now.";

const first: ToldNotice = { ...base, id: "d1", at: "2026-10-16T05:00:30.000Z", words: WORDS, steps: [Q1] };
const second: ToldNotice = { ...base, id: "d2", at: "2026-10-16T05:01:10.000Z", words: WORDS, steps: [Q1, Q2] };
const other: ToldNotice = { ...base, id: "d0", at: "2026-10-16T03:00:00.000Z", words: "My chest feels tight", steps: undefined };

describe("one card per conversation on her 「留意」", () => {
  it("the later notice of a conversation replaces the earlier one; other notices stay", () => {
    expect(latestPerConversation([second, first, other]).map((n) => n.id)).toEqual(["d2", "d0"]);
  });

  it("an earlier notice's address opens the latest of its conversation", () => {
    expect(latestOfConversation([second, first, other], "d1")?.id).toBe("d2");
    expect(latestOfConversation([second, first, other], "d0")?.id).toBe("d0");
    expect(latestOfConversation([second, first], "nope")).toBeNull();
  });

  it("not the same conversation: other words, steps that do not start the same, too far apart, or no more steps", () => {
    expect(continues({ ...second, words: "something else" }, first)).toBe(false);
    expect(continues({ ...second, steps: [{ ...Q1, answer: "No" }, Q2] }, first)).toBe(false);
    expect(continues({ ...second, at: "2026-10-16T08:30:00.000Z" }, first)).toBe(false);
    // the same sentence said twice, no question in between: two notices
    const again: ToldNotice = { ...base, id: "d3", at: "2026-10-16T05:30:00.000Z", words: WORDS, steps: undefined };
    const once: ToldNotice = { ...base, id: "d4", at: "2026-10-16T05:00:00.000Z", words: WORDS, steps: undefined };
    expect(latestPerConversation([again, once]).map((n) => n.id)).toEqual(["d3", "d4"]);
    // his first message's own notice is continued by the notice of his answer to its question
    expect(latestPerConversation([first, once]).map((n) => n.id)).toEqual(["d1"]);
  });
});
