/** M14 scoring: tokenisers, edit counts, per-language WER/CER with time assignment, percentiles. */
import { describe, expect, it } from "vitest";
import { editCounts, errorRate, percentile, refLang, scoreByLanguage, tokensEn, tokensZh } from "@/lib/asr/wer";

describe("tokens", () => {
  it("English: case, punctuation, ampersand, apostrophes", () => {
    expect(tokensEn("Go to A&E or call 995.")).toEqual(["go", "to", "a", "and", "e", "or", "call", "995"]);
    expect(tokensEn("Please don’t change the dose yourself.")).toEqual(["please", "don't", "change", "the", "dose", "yourself"]);
    expect(tokensEn("135/85, 'quoted'")).toEqual(["135", "85", "quoted"]);
  });
  it("Mandarin: one token per character, Latin runs as one token, punctuation dropped", () => {
    expect(tokensZh("手腕的不太准。买一个绑手臂的，upper arm 的。")).toEqual(["手", "腕", "的", "不", "太", "准", "买", "一", "个", "绑", "手", "臂", "的", "upper", "arm", "的"]);
  });
  it("language of a script line", () => {
    expect(refLang("en-SG")).toBe("en");
    expect(refLang("zh-en")).toBe("zh");
    expect(refLang("zh")).toBe("zh");
  });
});

describe("edit counts", () => {
  it("counts substitutions, deletions and insertions", () => {
    expect(editCounts(["a", "b", "c"], ["a", "x", "c"])).toEqual({ substitutions: 1, deletions: 0, insertions: 0, refTokens: 3 });
    expect(editCounts(["a", "b", "c"], ["a", "c"])).toEqual({ substitutions: 0, deletions: 1, insertions: 0, refTokens: 3 });
    expect(editCounts(["a", "b"], ["a", "b", "c", "d"])).toEqual({ substitutions: 0, deletions: 0, insertions: 2, refTokens: 2 });
    expect(errorRate(editCounts(["a", "b", "c", "d"], ["a", "x", "c"]))).toBe(0.5);
    expect(errorRate(editCounts([], []))).toBe(0);
  });
});

describe("scoreByLanguage", () => {
  const ref = [
    { id: "u1", lang: "en", text: "At home, we want it below 135 over 85.", t_start_ms: 1000, t_end_ms: 4000 },
    { id: "u2", lang: "zh", text: "医生，可以用吗？", t_start_ms: 5000, t_end_ms: 7000 },
    { id: "u3", lang: "zh-en", text: "买一个绑手臂的，upper arm 的。", t_start_ms: 8000, t_end_ms: 10_000 },
  ];
  it("perfect transcript: 0 for both", () => {
    const r = scoreByLanguage(ref, ref.map((x) => ({ ...x })));
    expect(r.en.rate).toBe(0);
    expect(r.zh.rate).toBe(0);
    expect(r.en.lines).toBe(1);
    expect(r.zh.lines).toBe(2);
  });
  it("hypotheses go to the line they overlap most; a line split in two still scores as one", () => {
    const r = scoreByLanguage(ref, [
      { text: "At home we want it", t_start_ms: 900, t_end_ms: 2500 },
      { text: "below 135/85", t_start_ms: 2600, t_end_ms: 4100 },
      { text: "医生可以用吗", t_start_ms: 5100, t_end_ms: 6900 },
    ]);
    expect(r.en).toMatchObject({ refTokens: 9, deletions: 1, substitutions: 0, insertions: 0 }); // "over" missing
    expect(r.zh.refTokens).toBe(6 + 10);
    expect(r.zh.deletions).toBe(10); // u3 not heard at all
    expect(r.perLine.find((l) => l.id === "u1")!.hyp).toBe("At home we want it below 135/85");
  });
});

describe("percentile", () => {
  it("interpolates; NaN when empty", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1);
    expect(percentile([], 50)).toBeNaN();
  });
});
