/** lib/asr/wer-normalise.ts: numbers spelled out, fillers dropped, the three WERs, the alignment and the averages. */
import { describe, expect, it } from "vitest";
import { alignWords, averageScores, cardinal, digitsToWords, ordinal, scoreAll, scoreWords, topErrors, wordsFor, yearWords } from "@/lib/asr/wer-normalise";

describe("numbers as they are said", () => {
  it("cardinals, ordinals, years", () => {
    expect([0, 7, 13, 20, 42, 100, 105, 999, 1500, 2000, 12_345].map(cardinal)).toEqual([
      "zero",
      "seven",
      "thirteen",
      "twenty",
      "forty two",
      "one hundred",
      "one hundred and five",
      "nine hundred and ninety nine",
      "one thousand five hundred",
      "two thousand",
      "twelve thousand three hundred and forty five",
    ]);
    expect([1, 2, 3, 5, 12, 20, 22, 100].map(ordinal)).toEqual(["first", "second", "third", "fifth", "twelfth", "twentieth", "twenty second", "one hundredth"]);
    expect([1990, 1905, 1900, 2005, 2010, 2023].map(yearWords)).toEqual(["nineteen ninety", "nineteen oh five", "nineteen hundred", "two thousand and five", "twenty ten", "twenty twenty three"]);
  });

  it("digits in running text", () => {
    expect(digitsToWords("Born on the 22nd of December, 1990.")).toBe("Born on the twenty second of December, nineteen ninety.");
    expect(digitsToWords("Take 2 puffs at 10:30 and 7:05")).toBe("Take two puffs at ten thirty and seven oh five");
    expect(digitsToWords("2.5 mg, 50% better, £20, 1,500 steps")).toBe("two point five mg, fifty percent better, twenty pounds, one thousand five hundred steps");
    expect(digitsToWords("two or three days")).toBe("two or three days");
  });
});

describe("the three normalisations", () => {
  it("raw keeps everything; numbers spells digits; full also drops fillers and writes okay as ok", () => {
    const text = "Um, OK, okay, take 2 tablets, uh, twice.";
    expect(wordsFor(text, "raw")).toEqual(["um", "ok", "okay", "take", "2", "tablets", "uh", "twice"]);
    expect(wordsFor(text, "numbers")).toEqual(["um", "ok", "okay", "take", "two", "tablets", "uh", "twice"]);
    expect(wordsFor(text, "full")).toEqual(["ok", "ok", "take", "two", "tablets", "twice"]);
  });

  it("scores a human transcript against a recogniser's: writing conventions count only in raw", () => {
    const ref = "Um, date of birth twenty second of December, nineteen ninety. Uh, OK.";
    const hyp = "Date of birth 22nd of December 1990. Okay.";
    const s = scoreAll(ref, hyp);
    expect(s.raw.refTokens).toBe(12);
    expect(s.raw.wer).toBeGreaterThan(0.3);
    // numbers: only the two fillers (deleted) and okay / ok (substituted) are left
    expect(s.numbers).toMatchObject({ substitutions: 1, deletions: 2, insertions: 0, refTokens: 12 });
    expect(s.full).toMatchObject({ substitutions: 0, deletions: 0, insertions: 0, wer: 0, refTokens: 10 });
  });
});

describe("alignment and averages", () => {
  it("aligns with the same counts as editCounts and lists the frequent errors", () => {
    const ref = "take one tablet in the morning please".split(" ");
    const hyp = "take 1 tablet in morning please now".split(" ");
    const ops = alignWords(ref, hyp);
    const n = (op: string) => ops.filter((o) => o.op === op).length;
    const s = scoreWords(ref, hyp);
    expect([n("sub"), n("del"), n("ins")]).toEqual([s.substitutions, s.deletions, s.insertions]);
    expect(topErrors(ops)).toEqual([
      { error: "+now", count: 1 },
      { error: "-the", count: 1 },
      { error: "one -> 1", count: 1 },
    ]);
    expect(alignWords([], ["a"])).toEqual([{ op: "ins", hyp: "a" }]);
    expect(alignWords(["a"], [])).toEqual([{ op: "del", ref: "a" }]);
  });

  it("pooled (word-weighted) and simple mean", () => {
    const a = scoreWords("a b c d".split(" "), "a b c x".split(" ")); // 1/4
    const b = scoreWords("a b".split(" "), "a b".split(" ")); // 0/2
    const avg = averageScores([a, b]);
    expect(avg.pooled).toMatchObject({ substitutions: 1, refTokens: 6, wer: 1 / 6 });
    expect(avg.mean_wer).toBeCloseTo(0.125);
    expect(Number.isNaN(averageScores([]).mean_wer)).toBe(true);
  });
});
