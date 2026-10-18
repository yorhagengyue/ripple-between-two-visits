/**
 * Ripple's own words under an answer's quotes (owner's decision of 10-14; lib/safety/gloss.ts). Since 10-15 (the owner: the
 * rules were too rigid) the pipeline writes Ripple's own answer instead (lib/safety/general.ts; general.test.ts), and no new
 * explanation is made. An answer kept with one before then is still drawn as it was (answerLine), and the guards of
 * gloss.ts are tested as they are.
 */
import { describe, expect, it } from "vitest";
import { answerLine, glossChip } from "@/components/daily/answer-parts";
import { guardGlossSentence } from "@/lib/safety/gloss";
import { GLOSS_NOTE } from "@/lib/safety/gloss-note";
import type { Gloss, Sentence } from "@/lib/safety/types";

/** a good explanation: what the doctor's words and the label are about, no dose, no instruction, no judgement */
const GOOD_DOCTOR = "医生的意思是，剂量的事由医生来定；读数的情况记下来，下次就诊时告诉医生。";

// Owner 10-15: the pipeline no longer writes this explanation (lib/safety/general.ts, Ripple's own answer, stands in its
// place: tests/unit/safety/general.test.ts). What stays is how an answer kept before then is drawn, and the guards as they are.
describe("an explanation kept with an answer before 10-15 is still drawn", () => {
  it("answerLine: the explanation stands before sentences[at]; a sentence whose quote is not in the answer is not drawn", () => {
    const quote: Sentence = { speechAct: "restate", sourceId: "visit:v2:R4", span: "x", slots: {}, en: "Please don't change the dose yourself.", attribution: "doctor", origin: "span", cite: { date: "2026-09-01", roleState: "confirmed" } };
    const leaflet: Sentence = { speechAct: "restate", sourceId: "hh-amlodipine:amlodipine.purpose", span: "y", slots: {}, en: "It is for blood pressure.", zh: "这是降压药。", attribution: "leaflet", origin: "patient_text" };
    const referral: Sentence = { speechAct: "referral", sourceId: "tpl:refer_doctor", span: "z", slots: {}, en: "Ask your doctor.", zh: "问医生。", origin: "template", templateId: "refer_doctor" };
    const gloss: Gloss = {
      kind: "gloss",
      lang: "zh-Hans",
      at: 2,
      sentences: [
        { text: "第一句。", sourceIds: ["visit:v2:R4", "hh-amlodipine:amlodipine.purpose"] },
        { text: "第二句。", sourceIds: ["label:gone"] },
      ],
    };
    const parts = answerLine([quote, leaflet, referral], "zh-Hans", gloss);
    expect(parts.map((p) => p.kind)).toEqual(["quote", "leaflet", "gloss", "ripple"]);
    const g = parts[2] as Extract<(typeof parts)[number], { kind: "gloss" }>;
    expect(g.lines).toEqual([
      {
        text: "第一句。",
        chips: [
          { source: "visit:v2:R4", words: "医生 9月1日" },
          { source: "hh-amlodipine:amlodipine.purpose", words: "单张" },
        ],
      },
    ]);
    expect(g.note).toBe(GLOSS_NOTE.zh);
    // a speaker he has not confirmed is named as its own entry names it
    expect(glossChip({ ...quote, cite: { date: "2026-09-01", roleState: "inferred" } }, "zh-Hans")).toBe("好像是医生 9月1日");
    expect(glossChip(quote, "en")).toBe("Doctor 1 Sep");
    // no explanation: the parts as they always were
    expect(answerLine([quote, leaflet, referral], "zh-Hans").map((p) => p.kind)).toEqual(["quote", "ripple", "leaflet"]);
  });
});

describe("guardGlossSentence on its own", () => {
  const r4: Sentence = { speechAct: "restate", sourceId: "visit:v2:R4", span: "", slots: {}, en: "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.", attribution: "doctor", origin: "span" };
  const r1: Sentence = { speechAct: "restate", sourceId: "visit:v1:R1", span: "", slots: {}, en: "At home, we want it below 135 over 85.", attribution: "doctor", origin: "span" };

  it("the professional register passes: 已服药 / 未服药 / 就诊 / 测量血压", () => {
    expect(guardGlossSentence(GOOD_DOCTOR, [r4], "zh-Hans")).toEqual([]);
    expect(guardGlossSentence("医生说，测量血压后把读数记下来，下次就诊时告诉他。", [r4], "zh-Hans")).toEqual([]);
    expect(guardGlossSentence("无论已服药还是未服药，剂量的事都由医生来定。", [r4], "zh-Hans")).toEqual([]);
  });

  it("the doctor's own number may be named; any other number may not, in digits or written out", () => {
    expect(guardGlossSentence("医生说在家的目标是 135/85 以下。", [r1], "zh-Hans")).toEqual([]);
    expect(guardGlossSentence("医生说在家的目标是一百四十以下。", [r1], "zh-Hans")).toContain("number_words");
    expect(guardGlossSentence("医生说在家的目标是 140 以下。", [r1], "zh-Hans")).toContain("number");
  });

  it("the brief's list: more, less, stop, change, may take; a dose; the wrong language", () => {
    for (const [text, code] of [
      ["可以少吃一点。", "instruction"],
      ["医生说加量的事要问他。", "instruction"],
      ["医生说减量要问他。", "instruction"],
      ["这个药可以吃。", "instruction"],
      ["医生说要按时服药。", "instruction"],
      ["The doctor said you should stop taking it.", "instruction"],
      ["You may take it with food.", "instruction"],
      ["Take less medicine when it is low.", "instruction"],
      ["每天服一粒。", "dose"],
      ["The label says 5 mg.", "dose"],
      ["The doctor said to write the readings down.", "language"],
    ] as const) {
      const locale = /[a-z]/i.test(text) && code !== "language" ? "en" : "zh-Hans";
      expect(guardGlossSentence(text, [r4], locale), text).toContain(code);
    }
  });
});
