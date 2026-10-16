/**
 * risk/evidence.ts (the asymmetric check of the model's quotes) and risk/merge.ts (the rules' floor and the model's frame,
 * the higher risk winning). The order the engine calls them in: checkEvidence(model) first, then mergeFrames(rules, checked).
 */
import { describe, expect, it } from "vitest";
import { checkEvidence, quoteChecks } from "@/lib/safety/risk/evidence";
import { mergeFrames } from "@/lib/safety/risk/merge";
import { rulesFrame } from "@/lib/safety/risk/rules-floor";
import type { Frame, RiskScreenInput } from "@/lib/safety/risk/types";

const MEDS = [
  { id: "m-aml", name: "Amlodipine 5mg" },
  { id: "m-ator", name: "Atorvastatin 20mg" },
];
const input = (message: string, extra: Partial<RiskScreenInput> = {}): RiskScreenInput => ({ message, turns: [], meds: MEDS, watch: false, locale: "en", ...extra });

/** A blank frame (the baseline), with the given fields. */
function frame(over: Partial<Frame> = {}, selfHarm: Partial<Frame["selfHarm"]> = {}): Frame {
  return {
    about: "self",
    acts: ["other"],
    medicines: [],
    amount: { relation: "none", evidence: [] },
    when: "unclear",
    symptoms: [],
    looksDifferent: "no",
    stopOrChange: "none",
    distress: "no",
    missing: [],
    ...over,
    selfHarm: { ideation: "none", plan: "no", means: "no", soon: "no", lethalityQuestion: "no", evidence: [], ...selfHarm },
  };
}
const msg = (quote: string) => ({ quote, from: "message" });

describe("quoteChecks", () => {
  const inp = input("I counted my pills last night.  There are ENOUGH now．", {
    turns: [
      { role: "patient", text: "I'm so tired of all this lately" },
      { role: "ripple", text: "If you might hurt yourself, call SOS 1767." },
    ],
  });
  it.each([
    ["an exact substring", msg("There are ENOUGH now")],
    ["another case and spacing", msg("i counted my pills last night. there are enough")],
    ["a full-width mark", msg("enough now.")],
    ["his own turn, two back", { quote: "tired of all this", from: "turn:2" }],
  ])("%s checks", (_n, e) => expect(quoteChecks(e, inp)).toBe(true));
  it.each([
    ["words he did not say", msg("I want to die")],
    ["Ripple's turn", { quote: "hurt yourself", from: "turn:1" }],
    ["a turn that is not there", { quote: "tired", from: "turn:5" }],
    ["a bad source", { quote: "enough", from: "ripple" }],
    ["one character", msg("I")],
  ])("%s does not", (_n, e) => expect(quoteChecks(e, inp)).toBe(false));
  it("a quote of his words' reading checks (normalize.ts)", () => {
    expect(quoteChecks(msg("kill myself"), input("i wanna kil myslef"))).toBe(true);
  });
});

describe("checkEvidence: raising fields with no checked quote become possible", () => {
  it("passive ideation, a lethality question and distress on invented words: unclear, recorded, the words dropped", () => {
    const f = frame({ distress: "yes" }, { ideation: "passive", lethalityQuestion: "yes", evidence: [msg("I want to join my wife")] });
    const r = checkEvidence(f, input("I will be seeing her soon."));
    expect(r.frame.selfHarm).toMatchObject({ ideation: "unclear", lethalityQuestion: "unclear", evidence: [] });
    expect(r.frame.distress).toBe("unclear");
    expect(r.misses).toEqual(
      expect.arrayContaining([
        { field: "selfHarm.ideation", effect: "to_possible" },
        { field: "selfHarm.lethalityQuestion", effect: "to_possible" },
        { field: "distress", effect: "to_possible" },
      ]),
    );
  });
  it("checked words keep them", () => {
    const t = "I will be seeing my wife again soon. She passed last year.";
    const f = frame({ distress: "yes" }, { ideation: "passive", plan: "unclear", means: "unclear", soon: "unclear", evidence: [msg("seeing my wife again soon")] });
    const r = checkEvidence(f, input(t));
    expect(r.frame.selfHarm.ideation).toBe("passive");
    expect(r.misses).toEqual([]);
  });
  it("a symptom now and severe with no checked quote: unclear; minutes dropped", () => {
    const f = frame({ symptoms: [{ kind: "chest", now: "yes", minutes: 10, severe: "yes", sudden: "yes", evidence: [msg("crushing chest pain")] }] });
    const r = checkEvidence(f, input("my chest feels a bit odd"));
    expect(r.frame.symptoms[0]).toMatchObject({ now: "unclear", severe: "unclear", sudden: "unclear", minutes: null, evidence: [] });
  });
  it("an amount beyond the label with no checked quote: unknown (more, how much not known)", () => {
    const r = checkEvidence(frame({ amount: { relation: "double", evidence: [msg("took it twice")] } }), input("I think I took it again"));
    expect(r.frame.amount.relation).toBe("unknown");
    expect(r.misses).toContainEqual({ field: "amount", effect: "to_possible" });
  });
  it("looks different with no checked medicine words: unclear", () => {
    const r = checkEvidence(frame({ looksDifferent: "yes" }), input("Is this right?"));
    expect(r.frame.looksDifferent).toBe("unclear");
  });
});

describe("checkEvidence: lowering fields with no checked quote become unknown", () => {
  it("ideation none while the rules see stockpiling: unclear", () => {
    const r = checkEvidence(frame({}, { ideation: "none", means: "yes", evidence: [] }), input("I counted my pills last night. There are enough now."));
    expect(r.frame.selfHarm.ideation).toBe("unclear");
    expect(r.misses).toContainEqual({ field: "selfHarm.ideation", effect: "to_unknown" });
  });
  it("ideation none on an everyday message is the baseline and stands", () => {
    const r = checkEvidence(frame(), input("What is amlodipine for?"));
    expect(r.frame.selfHarm.ideation).toBe("none");
    expect(r.frame.distress).toBe("no");
    expect(r.misses).toEqual([]);
  });
  it("an idiom quoted keeps ideation none even near a cue word", () => {
    const r = checkEvidence(frame({}, { evidence: [msg("dead tired")] }), input("I'm dead tired, my late wife used to cook"));
    expect(r.frame.selfHarm.ideation).toBe("none");
  });
  it("with his watch state on, ideation none needs a quote", () => {
    const r = checkEvidence(frame(), input("How many tablets do I take a day?", { watch: true }));
    expect(r.frame.selfHarm.ideation).toBe("unclear");
    expect(r.frame.selfHarm.lethalityQuestion).toBe("unclear");
  });
  it("no plan beside a wish to die needs words that say no", () => {
    const t = "Sometimes I wish I would not wake up. I have no plan, don't worry.";
    const without = checkEvidence(frame({ distress: "yes" }, { ideation: "passive", plan: "no", means: "no", soon: "no", evidence: [msg("I wish I would not wake up")] }), input(t));
    expect(without.frame.selfHarm).toMatchObject({ plan: "unclear", means: "unclear", soon: "unclear" });
    const withWords = checkEvidence(frame({ distress: "yes" }, { ideation: "passive", plan: "no", evidence: [msg("I wish I would not wake up"), msg("I have no plan")] }), input(t));
    expect(withWords.frame.selfHarm.plan).toBe("no");
  });
  it("a symptom not now must quote it being over; not severe must quote it being mild", () => {
    const t = "I had chest pain last year, a bit only";
    const ok = checkEvidence(frame({ symptoms: [{ kind: "chest", now: "no", minutes: null, severe: "no", sudden: "unclear", evidence: [msg("chest pain last year, a bit only")] }] }), input(t));
    expect(ok.frame.symptoms[0]).toMatchObject({ now: "no", severe: "no" });
    const bare = checkEvidence(frame({ symptoms: [{ kind: "chest", now: "no", minutes: null, severe: "no", sudden: "no", evidence: [msg("chest pain")] }] }), input(t));
    expect(bare.frame.symptoms[0]).toMatchObject({ now: "unclear", severe: "unclear", sudden: "unclear" });
    expect(bare.misses).toContainEqual({ field: "symptoms.chest.now", effect: "to_unknown" });
  });
  it("a stroke sign yesterday is not over unless it is said to have passed", () => {
    const s = (q: string) => [{ kind: "stroke" as const, now: "no" as const, minutes: null, severe: "unclear" as const, sudden: "unclear" as const, evidence: [msg(q)] }];
    expect(checkEvidence(frame({ symptoms: s("face drooped yesterday") }), input("My face drooped yesterday")).frame.symptoms[0].now).toBe("unclear");
    expect(checkEvidence(frame({ symptoms: s("went away") }), input("My face drooped yesterday but it went away")).frame.symptoms[0].now).toBe("no");
  });
  it("about another adult must name one", () => {
    expect(checkEvidence(frame({ about: "other_adult" }), input("can't breathe, help")).frame.about).toBe("unclear");
    expect(checkEvidence(frame({ about: "other_adult" }), input("My wife can't breathe")).frame.about).toBe("other_adult");
  });
});

describe("checkEvidence: medicines", () => {
  it("one of his, named in a checked quote (name, Chinese name, what it is for): kept", () => {
    for (const [t, q] of [
      ["Can I stop my amlodipine?", "amlodipine"],
      ["我的氨氯地平可以停吗", "氨氯地平"],
      ["Can I stop my BP pill?", "BP pill"],
    ]) {
      expect(checkEvidence(frame({ medicines: [{ ref: "m-aml", evidence: [msg(q)] }] }), input(t)).frame.medicines.map((m) => m.ref)).toEqual(["m-aml"]);
    }
  });
  it("one of his not named in his words (the model picked one): unspecified", () => {
    const r = checkEvidence(frame({ medicines: [{ ref: "m-ator", evidence: [msg("the white one")] }] }), input("Can I stop the white one?"));
    expect(r.frame.medicines.map((m) => m.ref)).toEqual(["unspecified"]);
    expect(r.misses).toContainEqual({ field: "medicines.m-ator", effect: "to_unknown" });
  });
  it("a ref not on his list: unknown", () => {
    expect(checkEvidence(frame({ medicines: [{ ref: "m-x", evidence: [msg("panadol")] }] }), input("Can I take panadol?")).frame.medicines.map((m) => m.ref)).toEqual(["unknown"]);
  });
});

describe("mergeFrames", () => {
  it("no model frame: the rules' frame", () => {
    const rules = rulesFrame("I counted my pills last night. There are enough now.", { meds: MEDS });
    expect(mergeFrames(rules, null)).toEqual(rules);
  });
  it("the higher risk wins; the rules are never lowered", () => {
    const rules = frame({ distress: "yes" }, { ideation: "passive", means: "unclear", evidence: [msg("a")] });
    const model = frame({ distress: "no" }, { ideation: "none", means: "yes", lethalityQuestion: "unclear", evidence: [msg("b")] });
    const m = mergeFrames(rules, model);
    expect(m.selfHarm).toMatchObject({ ideation: "passive", means: "yes", lethalityQuestion: "unclear" });
    expect(m.distress).toBe("yes");
    expect(m.selfHarm.evidence.map((e) => e.quote)).toEqual(["a", "b"]);
    expect(mergeFrames(frame({}, { ideation: "unclear" }), frame({}, { ideation: "active" })).selfHarm.ideation).toBe("active");
  });
  it("symptoms by kind: unioned, now / severe the higher, minutes the longer known", () => {
    const rules = frame({ symptoms: [{ kind: "chest", now: "unclear", minutes: null, severe: "yes", sudden: "unclear", evidence: [] }] });
    const model = frame({
      symptoms: [
        { kind: "chest", now: "yes", minutes: 10, severe: "unclear", sudden: "no", evidence: [] },
        { kind: "breathing", now: "unclear", minutes: null, severe: "unclear", sudden: "unclear", evidence: [] },
      ],
    });
    const m = mergeFrames(rules, model);
    expect(m.symptoms.map((s) => s.kind)).toEqual(["chest", "breathing"]);
    expect(m.symptoms[0]).toMatchObject({ now: "yes", minutes: 10, severe: "yes", sudden: "unclear" });
    expect(m.missing).toContain("now");
  });
  it("facts agree or become unknown", () => {
    expect(mergeFrames(frame({ amount: { relation: "none", evidence: [] } }), frame({ amount: { relation: "double", evidence: [] } })).amount.relation).toBe("double");
    expect(mergeFrames(frame({ amount: { relation: "double", evidence: [] } }), frame({ amount: { relation: "extra_one", evidence: [] } })).amount.relation).toBe("unknown");
    expect(mergeFrames(frame({ about: "unclear" }), frame({ about: "self" })).about).toBe("self");
    expect(mergeFrames(frame({ about: "self" }), frame({ about: "other_adult" })).about).toBe("unclear");
    expect(mergeFrames(frame({ when: "past" }), frame({ when: "now" })).when).toBe("unclear");
  });
  it("medicines: the union, unspecified dropped once one of his is named", () => {
    const m = mergeFrames(frame({ medicines: [{ ref: "unspecified", evidence: [msg("my pill")] }] }), frame({ medicines: [{ ref: "m-aml", evidence: [msg("amlodipine")] }, { ref: "unknown", evidence: [] }] }));
    expect(m.medicines.map((x) => x.ref)).toEqual(["m-aml", "unknown"]);
  });
  it("stopOrChange: done > suggested_by_other > asked > none; acts the union", () => {
    const m = mergeFrames(frame({ stopOrChange: "asked", acts: ["question"] }), frame({ stopOrChange: "done", acts: ["event", "other"] }));
    expect(m.stopOrChange).toBe("done");
    expect(m.acts).toEqual(["question", "event"]);
  });
  it("the probe's sh-a10 with a model that missed it: the rules keep it passive", () => {
    const t = "I will be seeing my wife again soon. She passed last year.";
    const rules = rulesFrame(t, { meds: MEDS });
    const { frame: checked } = checkEvidence(frame({}, { evidence: [msg("seeing my wife again soon")] }), input(t));
    expect(mergeFrames(rules, checked).selfHarm.ideation).toBe("passive");
  });
});
