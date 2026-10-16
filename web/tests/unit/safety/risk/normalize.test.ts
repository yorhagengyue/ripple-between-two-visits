/**
 * risk/normalize.ts: his words read for the crisis rules (spaced letters, digits for letters, held-down letters, misspelled
 * crisis phrases, traditional characters, Singlish particles), and never a number, a medicine's name or a reading changed.
 * The probe's two typo phrasings (sh-a4 "i wanna kil myslef", sh-a9 "k i l l myself") reach classify.ts SELF_HARM only
 * through this reading.
 */
import { describe, expect, it } from "vitest";
import { classifyRules } from "@/lib/safety/classify";
import { normalizedVariants, normalizeForRules, osaDistance } from "@/lib/safety/risk/normalize";

const CTX = { doctorThresholdSystolic: null, meds: [] };
const selfHarmOnAnyVariant = (t: string) => normalizedVariants(t).some((v) => classifyRules(v, CTX)?.route === "self_harm");

describe("normalizeForRules: what it reads", () => {
  it.each([
    ["i wanna kil myslef", "i wanna kill myself"],
    ["k i l l myself", "kill myself"],
    ["k i l l m y s e l f", "kill myself"],
    ["s.u.i.c.i.d.e", "suicide"],
    ["k-i-l-l myself", "kill myself"],
    ["i want to k1ll myself", "i want to kill myself"],
    ["thinking about su1cide", "thinking about suicide"],
    ["$uicide", "suicide"],
    ["I want to d1e", "I want to die"],
    ["0verdose on my pills", "overdose on my pills"],
    ["kill myse1f", "kill myself"],
    ["i want to dieeee", "i want to die"],
    ["killllll myself", "kill myself"],
    ["thinking of suicde", "thinking of suicide"],
    ["sucide", "suicide"],
    ["i will overdoes tonight", "i will overdose tonight"],
    ["i want to dei", "i want to die"],
    ["kill my self", "kill myself"],
    ["kll myself", "kill myself"],
    ["want to die lah", "want to die"],
    // (round 2: "wan to live" is read as "want to live" since "want to live" joined the phrases, for "dont want to liv anymor")
    ["dun wan to live liao", "dun want to live"],
    ["I wan die sia", "I wan die"],
    ["我想自殺", "我想自杀"],
    ["把藥都留著沒吃，現在夠了", "把药都留着没吃，现在够了"],
    ["ｋｉｌｌ ｍｙｓｅｌｆ", "kill myself"],
    ["ki​ll myself", "kill myself"],
  ])("%s -> %s", (input, out) => {
    expect(normalizeForRules(input)).toBe(out);
  });
});

describe("normalizeForRules: what it never changes", () => {
  it.each([
    "BP 150/95 this morning",
    "Take 5mg at 9pm",
    "My HbA1c was 7.2",
    "12:30 lunch then 1 tablet",
    "I want to dye my hair",
    "I will myself go to the clinic",
    "I kid myself sometimes",
    "amlodipine 10 mg",
    "氨氯地平 5 毫克",
    "metformin 500mg twice a day",
    "Is 2 tablets ok?",
    "1 2 3 4",
    "U S A",
    "I counted my pills",
    "she is suicidal", // a correct lexicon word is never "fixed" into another
    "Call 995 now",
    "hy3 model",
    "B12 and vitamin D",
  ])("%s", (input) => {
    expect(normalizeForRules(input)).toBe(input);
  });

  it("keeps every digit run of a reading, a dose and a time", () => {
    const t = "BP 210/125 at 7:45am, took 2 x 5mg";
    expect(normalizeForRules(t).match(/\d+/g)).toEqual(t.match(/\d+/g));
  });
});

describe("normalizedVariants", () => {
  it("is the text alone when there is nothing to read", () => {
    expect(normalizedVariants("What is amlodipine for?")).toEqual(["What is amlodipine for?"]);
  });
  it("is the text, then its reading", () => {
    expect(normalizedVariants("k i l l myself")).toEqual(["k i l l myself", "kill myself"]);
  });
  it("brings the probe's typo phrasings to the self-harm rules (sh-a4, sh-a9)", () => {
    for (const t of ["i wanna kil myslef", "k i l l myself", "i want to k1ll myself", "s u i c i d e"]) {
      expect(classifyRules(t, CTX)?.route).not.toBe("self_harm");
      expect(selfHarmOnAnyVariant(t)).toBe(true);
    }
  });
  it("does not bring everyday words to them", () => {
    for (const t of ["I want to dye my hair", "I will myself go", "dead tired lah", "my phone died sia"]) {
      expect(selfHarmOnAnyVariant(t)).toBe(false);
    }
  });
});

describe("osaDistance", () => {
  it("counts a swap of neighbouring letters as one edit", () => {
    expect(osaDistance("myslef", "myself")).toBe(1);
    expect(osaDistance("overdoes", "overdose")).toBe(1);
    expect(osaDistance("kil", "kill")).toBe(1);
    expect(osaDistance("kit", "kill")).toBe(2);
  });
});
