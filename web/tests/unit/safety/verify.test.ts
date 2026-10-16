import { describe, expect, it } from "vitest";
import { createDecidingChecker } from "@/lib/llm";
import { directiveHits, isDirective } from "@/lib/safety/directive";
import { extractSlots } from "@/lib/safety/slots";
import { TEMPLATES } from "@/lib/safety/templates";
import type { Candidate, Sentence } from "@/lib/safety/types";
import { layer1, layer2, layer3, originOf, verifySentences } from "@/lib/safety/verify";
import { referralCandidate } from "@/lib/safety/candidates";
import { zhFromSlots } from "@/lib/safety/zh";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";

const LABEL: Candidate = {
  sourceId: "label:med-amlodipine",
  kind: "label",
  span: "Take ONE tablet every MORNING",
  attribution: "label",
  instruction: true,
};
const R4C: Candidate = { sourceId: "visit:v2:R4", kind: "visit", span: R4, attribution: "doctor", instruction: true, topics: ["dose_change"] };

const map = (...cs: Candidate[]) => new Map(cs.map((c) => [c.sourceId, c]));

function s(over: Partial<Sentence>): Sentence {
  return { speechAct: "restate", sourceId: "", span: "", slots: {}, en: "", ...over };
}

describe("slots (glossary normalisation)", () => {
  it("reads drug, number, unit, time in English and Mandarin into the same ids", () => {
    expect(extractSlots("Take ONE tablet every MORNING")).toMatchObject({ numbers: ["1"], units: ["tablet"], times: ["morning"] });
    expect(extractSlots("药袋上写着：每天早上吃一粒。")).toMatchObject({ numbers: ["1"], units: ["tablet"], times: ["morning"] });
    expect(extractSlots("AMLODIPINE 5MG TABLET")).toMatchObject({ drugs: ["amlodipine"], numbers: ["5"], units: ["mg", "tablet"] });
    expect(extractSlots("氨氯地平 两粒")).toMatchObject({ drugs: ["amlodipine"], numbers: ["2"], units: ["tablet"] });
  });

  it("does not turn every 'a', 'one' or 一 into a number, nor 'on top' into a label time", () => {
    expect(extractSlots("This tablet works quietly. You won't feel it.").numbers).toEqual([]);
    expect(extractSlots("Some people get ankle swelling with this one.").numbers).toEqual([]);
    expect(extractSlots("这个药和其他的药一起吃").numbers).toEqual([]);
    expect(extractSlots("above 180 on top").times).toEqual([]);
    expect(extractSlots("Take ONE tablet ON").times).toEqual(["night"]);
    expect(extractSlots("a forgotten dose").numbers).toEqual(["1"]);
  });
});

describe("directive detection", () => {
  it("does not flag ordinary explanations", () => {
    expect(isDirective("这个药是早上吃的")).toBe(false);
    expect(isDirective("可以问药剂师")).toBe(false);
    expect(isDirective("Amlodipine lowers blood pressure.")).toBe(false);
    expect(isDirective("Have you taken today's tablet?")).toBe(false);
  });

  it("flags instructions aimed at the user, from glossary patterns and the imperative rule", () => {
    expect(isDirective("You can take an extra tablet when your reading is high.")).toBe(true);
    expect(isDirective("Take one tablet every morning.")).toBe(true);
    expect(isDirective(R4)).toBe(true);
    expect(isDirective("你可以多吃一粒")).toBe(true);
    expect(isDirective("停掉这个药")).toBe(true);
    expect(directiveHits("Double the dose today").map((h) => h.pattern)).toContain("\\bdouble (the |your )?dose\\b");
  });
});

describe("the three checks: literal acceptance cases", () => {
  it("'Take one tablet every morning.' cited to the confirmed amlodipine label, attribution label, passes all checks", async () => {
    const sentence = s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "Take one tablet every morning.", attribution: "label" });
    const { verdicts } = await verifySentences([sentence], { candidates: map(LABEL), checker: null, checkerReason: "no checker" });
    expect(verdicts[0]).toMatchObject({ pass: true, blockedBy: null });
    expect(verdicts[0].layer2).toMatchObject({ pass: true, directive: true });
    expect(verdicts[0].layer3).toMatchObject({ pass: true, needed: false });
  });

  it("its Mandarin template sentence passes too", async () => {
    const zh = zhFromSlots("Take one tablet every morning.", "label");
    expect(zh).toBe("药品标签：每天早上服用一片。");
    const withZh = s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "Take one tablet every morning.", zh: zh!, attribution: "label" });
    const zhOnly = s({ sourceId: LABEL.sourceId, span: LABEL.span, en: zh!, attribution: "label" });
    const { verdicts } = await verifySentences([withZh], { candidates: map(LABEL), checker: null, checkerReason: null });
    expect(verdicts[0].pass).toBe(true);
    expect(layer1(zhOnly, LABEL).pass).toBe(true);
    expect(layer2(zhOnly, LABEL).pass).toBe(true);
  });

  it("'You can take an extra tablet when your reading is high.' with no supporting source is blocked", async () => {
    const sentence = s({ en: "You can take an extra tablet when your reading is high.", sourceId: "", span: "" });
    const { verdicts } = await verifySentences([sentence], { candidates: map(LABEL, R4C), checker: null, checkerReason: null });
    expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 1 });
    expect(verdicts[0].layer1.reasons).toContain("unknown_source");
    // even pointed at a real source, it is still blocked (not in the span, a directive the source does not give)
    const cited = s({ en: "You can take an extra tablet when your reading is high.", sourceId: R4C.sourceId, span: R4, attribution: "doctor" });
    const r = await verifySentences([cited], { candidates: map(R4C), checker: null, checkerReason: null });
    expect(r.verdicts[0].pass).toBe(false);
  });

  it("a number that is not in the cited span is blocked by layer 1", () => {
    const r = layer1(s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "Take two tablets every morning.", attribution: "label" }), LABEL);
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("number_not_in_span");
    expect(r.missing).toContainEqual({ category: "numbers", value: "2" });
    const zh = layer1(s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "药品标签：每天早上服用两片。", attribution: "label" }), LABEL);
    expect(zh.reasons).toContain("number_not_in_span");
    const declared = layer1(s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "Take ONE tablet every MORNING", slots: { quantity: "2" }, attribution: "label" }), LABEL);
    expect(declared.reasons).toContain("number_not_in_span");
  });

  it("the 995 inside a referral template is not blocked", async () => {
    const ref = referralCandidate("B1-01")!;
    const t = TEMPLATES.emergency_995;
    const sentence = s({ speechAct: "referral", sourceId: ref.sourceId, span: ref.span, en: t.en, zh: t.zh, origin: "template", templateId: t.id });
    const { verdicts } = await verifySentences([sentence], { candidates: map(ref), checker: null, checkerReason: null });
    expect(verdicts[0].pass).toBe(true);
    expect(verdicts[0].layer1.sentenceSlots?.numbers).toEqual(["995"]);
  });

  it("'这个药是早上吃的' and '可以问药剂师' are not blocked by the directive check", () => {
    for (const text of ["这个药是早上吃的", "可以问药剂师"]) {
      const r = layer2(s({ en: text, speechAct: "logistics" }), undefined);
      expect(r).toMatchObject({ pass: true, directive: false });
    }
  });

  it("a directive needs a restatement, the right attribution and an instruction as its source", () => {
    const base = { sourceId: R4C.sourceId, span: R4, en: R4 };
    expect(layer2(s({ ...base, attribution: "doctor" }), R4C).pass).toBe(true);
    expect(layer2(s({ ...base }), R4C).reasons).toContain("directive_without_attribution");
    expect(layer2(s({ ...base, attribution: "label" }), R4C).reasons).toContain("attribution_mismatch");
    expect(layer2(s({ ...base, attribution: "doctor", speechAct: "logistics" }), R4C).reasons).toContain("directive_not_restate");
    expect(layer2(s({ ...base, attribution: "doctor" }), { ...R4C, instruction: false }).reasons).toContain("directive_span_not_instruction");
  });

  it("a do-not-display number is blocked whatever the source", () => {
    const r = layer1(s({ sourceId: LABEL.sourceId, span: LABEL.span, en: "Call 6389 2222." }), LABEL);
    expect(r.reasons).toContain("do_not_display_number");
  });

  it("a quoted span that is not in the source is blocked", () => {
    const r = layer1(s({ sourceId: LABEL.sourceId, span: "Take TWO tablets", en: "Take TWO tablets" }), LABEL);
    expect(r.reasons).toContain("span_not_in_source");
  });
});

describe("layer 3: paraphrases go to the second-vendor checker or are blocked", () => {
  const doctorParaphrase = s({ sourceId: R4C.sourceId, span: R4, en: "Don't change your dose; tell the doctor at your next visit.", attribution: "doctor" });
  // a leaflet paraphrase with no number, no new medicine, no directive and no judgement word: the only kind of
  // sentence that still reaches layer 3
  const PURPOSE: Candidate = {
    sourceId: "hh-amlodipine:amlodipine.purpose",
    kind: "patient_text",
    span: "The leaflet describes amlodipine as a medicine that brings blood pressure down; it does this by letting the blood vessels loosen and open wider.",
    attribution: "leaflet",
  };
  const leafletParaphrase = s({ sourceId: PURPOSE.sourceId, span: PURPOSE.span, en: "Amlodipine is a blood pressure medicine.", attribution: "leaflet" });

  it("R4 is relayed verbatim (no checker needed); a paraphrase is the model's own words", () => {
    expect(originOf(s({ sourceId: R4C.sourceId, span: R4, en: R4, attribution: "doctor" }), R4C)).toBe("span");
    expect(originOf(s({ sourceId: R4C.sourceId, span: R4, en: "Please don't change the dose yourself.", attribution: "doctor" }), R4C)).toBe("span");
    expect(originOf(doctorParaphrase, R4C)).toBe("model");
    // a fragment cut out of a sentence of R4 is not the doctor's words
    expect(originOf(s({ sourceId: R4C.sourceId, span: R4, en: "your readings are high", attribution: "doctor" }), R4C)).toBe("model");
    expect(originOf(leafletParaphrase, PURPOSE)).toBe("model");
  });

  it("a paraphrase of the doctor's words never reaches the checker: layer 1 blocks it, even when a checker would say yes", async () => {
    const { verdicts } = await verifySentences([doctorParaphrase], { candidates: map(R4C), checker: createDecidingChecker(() => true), checkerReason: null });
    expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 1, layer3: null });
    expect(verdicts[0].layer1.reasons).toContain("quote_not_verbatim");
  });

  it("with no checker configured a leaflet paraphrase is blocked at layer 3", async () => {
    const { verdicts } = await verifySentences([leafletParaphrase], { candidates: map(PURPOSE), checker: null, checkerReason: "CHECKER_PROVIDER not set" });
    expect(verdicts[0]).toMatchObject({ pass: false, blockedBy: 3 });
    expect(verdicts[0].layer1.pass).toBe(true);
    expect(verdicts[0].layer2?.pass).toBe(true);
    expect(verdicts[0].layer3?.reasons).toEqual(["no_checker"]);
  });

  it("the checker decides when configured; errors block", async () => {
    const yes = await layer3(leafletParaphrase, PURPOSE, createDecidingChecker(() => true), null);
    expect(yes).toMatchObject({ pass: true, needed: true, checker: "mock-checker" });
    const no = await layer3(leafletParaphrase, PURPOSE, createDecidingChecker(() => false), null);
    expect(no).toMatchObject({ pass: false, reasons: ["checker_not_supported"] });
    const broken = await layer3(leafletParaphrase, PURPOSE, { provider: "x", model: "y", chat: async () => { throw new Error("down"); } }, null);
    expect(broken).toMatchObject({ pass: false, reasons: ["checker_error"] });
    const { verdicts } = await verifySentences([leafletParaphrase], { candidates: map(PURPOSE), checker: createDecidingChecker(() => true), checkerReason: null });
    expect(verdicts[0]).toMatchObject({ pass: true, blockedBy: null });
  });
});
