/**
 * A model-labelled R line must say what the seeded line says (10-09 DeepSeek fixer, defect 6 of the round-1 check).
 * The 0.75 word-overlap matcher ignored negation: all six negated variants matched, so a transcript that dropped a
 * "don't" could be quoted as the doctor's R4 in dose-change refusals. Now a different number of negations, an added
 * or dropped word that flips the instruction, or an extra number rejects the match; small ASR differences still match.
 */
import { describe, expect, it } from "vitest";
import { contentWords, FUNCTION_WORDS, matchesRequiredLine, requiredLineMismatch, tokens } from "@/lib/visit/model-extract";

const R1 = { text: "At home, we want it below 135 over 85.", slots: { systolic: 135, diastolic: 85 } };
const R2 = { text: "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.", slots: { systolic: 180 } };
const R3 = {
  text: "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.",
};
const R4 = { text: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit." };

describe("lines whose meaning changed are not the R line", () => {
  const NEGATED: [string, typeof R4, string][] = [
    ["Please do change the dose yourself. If your readings are high, write them down and tell me at your next visit.", R4, "negation_differs"],
    ["Please don't change the dose yourself. If your readings are high, take an extra tablet and tell me at your next visit.", R4, "meaning_word_differs"],
    ["At home, we want it above 135 over 85.", R1, "meaning_word_differs"],
    ["If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, don't go to A&E or call 995.", R2, "negation_differs"],
    [R3.text.replace("So you take it every day", "So you skip it every day"), R3, "meaning_word_differs"],
    [R3.text.replace("So you take it every day", "So you don't take it every day"), R3, "negation_differs"],
    ["At home, we want it below 145 over 85.", R1, "number_missing"],
    ["At home, we want it below 135 over 85, or 150.", R1, "number_added"],
  ];
  for (const [text, req, why] of NEGATED) {
    it(`${why}: ${text.slice(0, 70)}`, () => {
      expect(matchesRequiredLine(text, req)).toBe(false);
      expect(requiredLineMismatch(text, req)).toBe(why);
    });
  }
});

/**
 * Round 2 (10-09): the open list of meaning words let these through (the first three the live deepseek-flash
 * labelled R4 on the v2 transcript; the rest found offline). The closed rule rejects every one: apart from function
 * words, the same words in the same order.
 */
describe("the closed rule: only function words may differ", () => {
  const FLIPS: [string, typeof R4][] = [
    ["Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit, then you may add a tablet.", R4],
    ["Please don't change the dose yourself unless your readings are high, then write them down and tell me at your next visit.", R4],
    ["Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit. Otherwise you can adjust it.", R4],
    ["Please change the dose yourself. If your readings are not high, write them down and tell me at your next visit.", R4],
    ["Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit, or up the dose.", R4],
    ["Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit, and repeat the dose.", R4],
    ["Please don't change the dose yourself, except if your readings are high, write them down and tell me at your next visit.", R4],
    ["If your reading at home is above 180 on top, and you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.", R2],
    ["If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, rest first, then go to A&E or call 995.", R2],
    [R3.text.replace("So you take it every day, even when you feel fine.", "So you take it only when you feel unwell."), R3],
    [R3.text.replace("even when you feel fine", "until you feel fine"), R3],
    [R3.text.replace("even when you feel fine", "unless you feel fine"), R3],
    // the same words in another order are not accepted either (fails safe: the line then needs the rules' exact words)
    ["Please don't change the dose yourself. If your readings are high, tell me at your next visit and write them down.", R4],
  ];
  for (const [text, req] of FLIPS) {
    it(`content_words_differ: ${text.slice(0, 90)}`, () => {
      expect(matchesRequiredLine(text, req)).toBe(false);
      expect(requiredLineMismatch(text, req)).toBe("content_words_differ");
    });
  }
  it("FUNCTION_WORDS hold no word that can change an instruction", () => {
    for (const w of ["and", "or", "unless", "except", "otherwise", "until", "only", "then", "may", "can", "if", "when", "even", "just", "do", "not", "no", "never", "add", "take", "stop"]) {
      expect(FUNCTION_WORDS.has(w), w).toBe(false);
    }
  });
  it("A&E, A and E and accident and emergency are one word", () => {
    expect(contentWords("go to A&E")).toEqual(["go", "aande"]);
    expect(contentWords("go to A and E")).toEqual(["go", "aande"]);
    expect(contentWords("go to Accident and Emergency")).toEqual(["go", "aande"]);
  });
});

describe("small transcription differences still match (the scripts/llm/visit-extract.ts ASR variants)", () => {
  const VARIANTS: [string, typeof R4][] = [
    ["At home, we want it to be below 135 over 85.", R1],
    ["If your reading at home is above 180 on top, or you get chest pain, weakness on one side or your speech becomes slurred, go to A and E or call 995.", R2],
    [
      "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages your heart, your brain and the kidneys. So you take it every day, even when you feel fine.",
      R3,
    ],
    ["Please don't change the dose by yourself. If your readings are high, write them down and tell me at the next visit.", R4],
    ["Please do not change the dose yourself. If your readings are high, write them down and tell me at your next visit.", R4],
  ];
  for (const [text, req] of VARIANTS) it(text.slice(0, 70), () => expect(requiredLineMismatch(text, req)).toBeNull());
  for (const req of [R1, R2, R3, R4]) it(`the seeded line matches itself: ${req.text.slice(0, 40)}`, () => expect(matchesRequiredLine(req.text, req)).toBe(true));
});

describe("tokens spell out negative contractions", () => {
  it("don't / do not, can't / cannot, won't", () => {
    expect(tokens("Don't")).toEqual(["do", "not"]);
    expect(tokens("cannot")).toEqual(["can", "not"]);
    expect(tokens("can't")).toEqual(["can", "not"]);
    expect(tokens("won't")).toEqual(["will", "not"]);
    expect(tokens("doesn’t")).toEqual(["does", "not"]);
    expect(tokens("不要自己改")).toEqual(["不", "要", "自", "己", "改"]);
  });
});
