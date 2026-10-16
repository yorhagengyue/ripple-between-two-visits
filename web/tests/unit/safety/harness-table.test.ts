/**
 * The harness's decision table (kb/pathways.json), its facts and questions (lib/safety/risk/pathways.ts) and decide()
 * (lib/safety/risk/table.ts), pure. Frames are built by hand here: what a careful reader of his words would fill in.
 *   - the table is well formed: every row has a source and is pending a clinician, shows lines that exist, asks questions
 *     that exist, the last row always holds;
 *   - every row is reachable (a scenario per row);
 *   - no question is ever asked before a 995 line when a level-1 row can still be reached by answering it (every answer to
 *     every question, three deep);
 *   - the 28 probes of D:/ripple-c2/audit/safety-harness-1016/probe.jsonl with hand-built frames;
 *   - reply sequences (chest pain, one tablet too many, the self-harm confirm and danger questions).
 */
import { describe, expect, it } from "vitest";
import { ALL_FOLLOW_UPS, FOLLOW_UPS, TEMPLATES, type FollowUpTemplateId } from "@/lib/safety/templates";
import { answerValue, buildFollowUp, typedOption, type Answers, type DecideContext, type MedChoice } from "@/lib/safety/risk/pathways";
import { decide, decisionTable, rowHolds, type Decision } from "@/lib/safety/risk/table";
import type { Frame, FrameSymptom } from "@/lib/safety/risk/types";

const MEDS: MedChoice[] = [
  { id: "med-amlodipine", name: "Amlodipine", drugId: "amlodipine" },
  { id: "med-ibuprofen", name: "Ibuprofen", drugId: "ibuprofen" },
];

type FrameIn = Partial<Omit<Frame, "selfHarm" | "amount">> & { sh?: Partial<Frame["selfHarm"]>; amount?: Frame["amount"]["relation"] };

function frame(o: FrameIn = {}): Frame {
  const { sh, amount, ...rest } = o;
  return {
    about: "self",
    acts: ["question"],
    medicines: [],
    amount: { relation: amount ?? "none", evidence: [] },
    when: "unclear",
    symptoms: [],
    looksDifferent: "no",
    stopOrChange: "none",
    selfHarm: { ideation: "none", plan: "no", means: "no", soon: "no", lethalityQuestion: "no", evidence: [], ...sh },
    distress: "no",
    missing: [],
    ...rest,
  };
}

const sym = (kind: FrameSymptom["kind"], o: Partial<FrameSymptom> = {}): FrameSymptom => ({ kind, now: "unclear", minutes: null, severe: "unclear", sudden: "unclear", evidence: [], ...o });
const med = (ref: string) => ({ ref, evidence: [] });

function ctx(o: Partial<DecideContext> = {}): DecideContext {
  return {
    watch: false,
    frameSource: "model+rules",
    rules: { route: null, signals: [], topics: [] },
    readingAboveLine: false,
    meds: MEDS,
    fits: ["med-amlodipine"],
    asksAmount: false,
    asksLargeAmount: false,
    sideEffect: false,
    missedDose: false,
    ...o,
  };
}

const has995 = (d: Pick<Decision, "show">) => d.show.some((t) => t in TEMPLATES && TEMPLATES[t as keyof typeof TEMPLATES].en.includes("995"));

describe("the decision table is well formed", () => {
  const rows = decisionTable();

  it("every row has a source, is pending a clinician, and has a level or a ladder step", () => {
    for (const r of rows) {
      expect(r.source.length, r.id).toBeGreaterThan(0);
      expect(r.review, r.id).toBe("pending_clinician");
      expect((r.level === undefined) !== (r.ladder === undefined), r.id).toBe(true);
    }
  });

  it("the last medical row holds for any facts; level-1 rows come before every lower medical row", () => {
    const medical = rows.filter((r) => r.level !== undefined);
    expect(rowHolds(medical[medical.length - 1], {})).toBe(true);
    const firstLower = medical.findIndex((r) => r.level !== 1);
    expect(medical.slice(firstLower).some((r) => r.level === 1)).toBe(false);
  });

  it("a row that asks shows a 995 line whenever its pathway has a level-1 row (995 before any question)", () => {
    const urgentPathways = new Set(rows.filter((r) => r.level === 1).map((r) => r.pathway));
    for (const r of rows.filter((x) => x.ask && x.level !== undefined && urgentPathways.has(x.pathway))) {
      expect(has995(r), r.id).toBe(true);
    }
    for (const r of rows.filter((x) => x.ask && x.ladder !== undefined)) {
      expect(has995(r), r.id).toBe(true);
    }
  });
});

describe("the follow-up questions", () => {
  it("two to five buttons, the last one not sure (or rather not say), ids unique, no judgement words", () => {
    for (const q of ALL_FOLLOW_UPS) {
      const ids = q.options.map((o) => o.id);
      expect(new Set(ids).size, q.id).toBe(ids.length);
      expect(q.options.length, q.id).toBeLessThanOrEqual(5);
      expect(q.options.length + (q.medicines ? 1 : 0), q.id).toBeGreaterThanOrEqual(2);
      const last = q.options[q.options.length - 1];
      // (the self-harm questions, and whether tablets were taken on purpose: "I'd rather not say")
      if (q.pathway === "self_harm_check" || q.id === "extra_purpose") expect([last.en, last.zh], q.id).toEqual(["I'd rather not say", "不想说"]);
      else expect([last.en, last.zh], q.id).toEqual(["Not sure", "不确定"]);
      for (const text of [q.en, q.zh, ...q.options.flatMap((o) => [o.en, o.zh])]) {
        for (const w of ["正常", "很好", "危险", "加药", "减药", "不要紧"]) expect(text.includes(w), `${q.id} ${w}`).toBe(false);
        for (const w of ["normal", "dangerous", "too high"]) expect(text.toLowerCase().includes(w), `${q.id} ${w}`).toBe(false);
        expect(/\d+\s*(?:mg|毫克)/i.test(text), `${q.id}: no strength`).toBe(false);
      }
    }
  });

  it("a medicines question names his medicines, the fitting one first, then Not sure; at most five buttons", () => {
    const { followUp, values } = buildFollowUp("extra_which", { id: "e1:extra_dose:2", step: 2, of: 3, meds: [...MEDS].reverse(), fits: ["med-amlodipine"] });
    expect(followUp.options.map((o) => o.en)).toEqual(["Amlodipine", "Ibuprofen", "Not sure"]);
    expect(values).toEqual({ "med:0": "med-amlodipine", "med:1": "med-ibuprofen" });
    expect(followUp.multi).toBe(true);
    // in Mandarin each button is the Chinese generic name his medicine list shows, else the English name
    const zh = buildFollowUp("extra_which", { id: "x", step: 1, of: 1, meds: [{ ...MEDS[0], nameZh: "氨氯地平" }, { id: "med-x", name: "Xyzo" }] });
    expect(zh.followUp.options.map((o) => [o.en, o.zh])).toEqual([
      ["Amlodipine", "氨氯地平"],
      ["Xyzo", "Xyzo"],
      ["Not sure", "不确定"],
    ]);
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: `Med ${i}` }));
    expect(buildFollowUp("missed_which", { id: "x", step: 1, of: 1, meds: many }).followUp.options.length).toBe(5);
  });

  it("not sure, rather not say and nothing chosen are the dangerous side; a sign chosen with none counts as a sign", () => {
    expect(answerValue("chest_now", ["unsure"])).toBe("unsure");
    expect(answerValue("chest_now", [])).toBe("unsure");
    expect(answerValue("chest_now", ["bogus"])).toBe("unsure");
    expect(answerValue("chest_now", ["gone"])).toBe("no");
    expect(answerValue("chest_with", ["none", "sweat"])).toBe("yes");
    expect(answerValue("chest_with", ["none"])).toBe("no");
    expect(answerValue("chest_long", ["comes_goes"])).toBe("yes");
    expect(answerValue("self_harm_confirm", ["rather_not"])).toBe("unsure");
    expect(answerValue("extra_who", ["unsure"])).toBe("unsure");
    expect(answerValue("extra_which", ["med:0", "med:1"], { "med:0": "a", "med:1": "b" })).toBe("yes");
    expect(answerValue("extra_which", ["med:0"], { "med:0": "a" })).toBe("no");
    expect(answerValue("extra_which", ["med:9"], { "med:0": "a" })).toBe("unsure");
  });

  it("typed words that are a button: its own words, or a short yes / no / not sure", () => {
    const fu = (id: FollowUpTemplateId) => ({ templateId: id, options: FOLLOW_UPS[id].options });
    expect(typedOption(fu("chest_now"), "No, it's gone")).toEqual(["gone"]);
    expect(typedOption(fu("chest_now"), "还在")).toEqual(["yes"]);
    expect(typedOption(fu("self_harm_confirm"), "没有")).toEqual(["no"]);
    expect(typedOption(fu("self_harm_confirm"), "不想说")).toEqual(["rather_not"]);
    expect(typedOption(fu("extra_symptoms"), "no")).toEqual(["none"]);
    expect(typedOption(fu("chest_now"), "no but my arm hurts and I feel sick")).toBeNull();
  });
});

/** A scenario per row: the frame, his answers so far, the context. */
interface Scenario {
  f?: FrameIn;
  answers?: Answers;
  c?: Partial<DecideContext>;
}
const chestF = (o: Partial<FrameSymptom> = {}) => ({ symptoms: [sym("chest", o)] });
const extraF = (o: FrameIn = {}): FrameIn => ({ when: "today", acts: ["event"], amount: "extra_one", ...o });

const SCENARIOS: Record<string, Scenario> = {
  // (round 2: someone else's self-harm signal is answered for them; a report with none, or an unclear wish, is not)
  "self-harm-someone-else": { f: { about: "other_adult", sh: { ideation: "active" } } },
  "self-harm-about-someone-else": { f: { about: "other_adult", sh: { ideation: "unclear" } } },
  "self-harm-cue": { f: { acts: ["other"] }, c: { frameSource: "rules", rules: { route: "log_only", signals: [], topics: [], selfHarmCue: true } } },
  "self-harm-danger-said": { f: { sh: { lethalityQuestion: "yes" } }, answers: { self_harm_confirm: ["yes"], self_harm_danger: ["rather_not"] }, c: { continuing: "self_harm_check" } },
  "self-harm-danger-plan": { f: { sh: { ideation: "active", plan: "yes", means: "yes", soon: "yes" } } },
  // (round 2: a passive wish with a plan and a time is danger with the means only)
  "self-harm-danger-plan-means": { f: { sh: { ideation: "passive", plan: "yes", means: "yes", soon: "yes" } } },
  "self-harm-danger-plan-confirmed": { f: { sh: { lethalityQuestion: "yes", plan: "yes", means: "yes", soon: "yes" } }, answers: { self_harm_confirm: ["yes"] }, c: { continuing: "self_harm_check" } },
  // (round 2: an explicit wish with tonight or today, no plan said)
  "self-harm-danger-intent": { f: { acts: ["emotion"], sh: { ideation: "active", soon: "yes", evidence: [] } } },
  "self-harm-thoughts-confirmed": { f: { sh: { lethalityQuestion: "yes" } }, answers: { self_harm_confirm: ["rather_not"] }, c: { continuing: "self_harm_check" } },
  "self-harm-confirm-no": { f: { sh: { lethalityQuestion: "yes" } }, answers: { self_harm_confirm: ["no"] }, c: { continuing: "self_harm_check" } },
  "self-harm-rules": { c: { rules: { route: "self_harm", signals: ["self_harm"], topics: [] } } },
  "self-harm-thoughts": { f: { sh: { ideation: "active" } } },
  "self-harm-lethality-watch": { f: { sh: { lethalityQuestion: "yes" } }, c: { watch: true } },
  "self-harm-means-watch": { f: { sh: { means: "yes" } }, c: { watch: true } },
  "self-harm-lethality": { f: { sh: { lethalityQuestion: "unclear" } } },
  "self-harm-means": { f: { sh: { means: "yes" } } },
  "self-harm-means-unclear": { f: { sh: { means: "unclear" } } },
  "self-harm-passive": { f: { sh: { ideation: "passive" } } },
  "self-harm-watch-amount": { c: { watch: true, asksAmount: true } },
  "self-harm-degraded-distress": { f: { distress: "yes" }, c: { frameSource: "rules" } },
  "self-harm-degraded-amount": { c: { frameSource: "rules", asksLargeAmount: true, asksAmount: true } },
  "chest-now-long": { f: chestF({ minutes: 10 }) },
  "chest-now-red-flag": { f: chestF({ now: "yes", severe: "yes" }) },
  "stroke-now": { f: { symptoms: [sym("stroke")] } },
  "breathing-blue": { f: { symptoms: [sym("breathing", { now: "yes" })] }, answers: { breathing_rest: ["no"], breathing_blue: ["yes"] }, c: { continuing: "breathing" } },
  "breathing-at-rest": { f: { symptoms: [sym("breathing", { now: "yes", severe: "yes" })] } },
  "collapse-now": { f: { about: "other_adult", symptoms: [sym("consciousness", { now: "yes" })] } },
  "allergy-now": { f: { symptoms: [sym("allergy")] } },
  "bleeding-now": { f: { symptoms: [sym("bleeding", { now: "yes" })] } },
  "headache-sudden-worst": { f: { symptoms: [sym("headache", { severe: "yes", sudden: "yes" })] } },
  "reading-red-flag": { f: { symptoms: [sym("headache", { severe: "yes" })] }, c: { readingAboveLine: true } },
  "extra-dose-child": { f: extraF({ about: "child", amount: "unknown" }) },
  "extra-dose-someone-else": { f: extraF({ about: "other_adult" }) },
  "extra-dose-on-purpose": { f: extraF({ sh: { plan: "yes" } }) },
  "extra-dose-symptoms": { f: extraF({ symptoms: [sym("dizziness", { now: "yes" })] }) },
  "extra-dose-two-or-more": { f: extraF({ amount: "extra_more" }) },
  "extra-dose-several-medicines": { f: extraF({ medicines: [med("med-amlodipine"), med("med-ibuprofen")] }) },
  "side-effect-red-flag": { f: { symptoms: [sym("swelling")] }, answers: { side_redflags: ["swelling"] }, c: { sideEffect: true, continuing: "side_effect" } },
  // (round 2: the rules' own fixed "call 995 now", a breathing rule, with a frame that names no sign)
  // (round 2: the question his last answer asked, left unanswered)
  "self-harm-question-ignored": { f: {}, c: { ignored: { pathway: "self_harm_check", question: "self_harm_confirm" } } },
  "self-harm-danger-question-ignored": { f: {}, c: { ignored: { pathway: "self_harm_check", question: "self_harm_danger" } } },
  "chest-question-ignored": { f: {}, c: { ignored: { pathway: "chest", question: "chest_now" } } },
  "breathing-question-ignored": { f: {}, c: { ignored: { pathway: "breathing", question: "breathing_rest" } } },
  "reading-question-ignored": { f: {}, c: { ignored: { pathway: "reading_high", question: "reading_redflags" } } },
  "side-effect-question-ignored": { f: {}, c: { ignored: { pathway: "side_effect", question: "side_redflags" } } },
  "extra-dose-question-ignored": { f: {}, c: { ignored: { pathway: "extra_dose", question: "extra_symptoms" } } },
  // (round 2: a faint he has come round from)
  "collapse-passed": { f: { symptoms: [sym("consciousness", { now: "no" })] } },
  "rules-995-now": { f: {}, c: { rules: { route: "emergency", signals: ["breathing"], topics: [], now995: true } } },
  "chest-ask-now": { f: chestF() },
  "chest-gone": { f: chestF(), answers: { chest_now: ["gone"] }, c: { continuing: "chest" } },
  "chest-ask-how-long": { f: chestF({ now: "yes" }) },
  "chest-ask-with": { f: chestF({ now: "yes" }), answers: { chest_long: ["under5"] }, c: { continuing: "chest" } },
  "chest-short-nothing-else": { f: chestF({ now: "yes" }), answers: { chest_long: ["under5"], chest_with: ["none"] }, c: { continuing: "chest" } },
  "stroke-passed": { f: { symptoms: [sym("stroke", { now: "no" })] } },
  "breathing-ask-at-rest": { f: { symptoms: [sym("breathing", { now: "yes" })] } },
  "breathing-ask-blue": { f: { symptoms: [sym("breathing")] }, answers: { breathing_rest: ["no"] }, c: { continuing: "breathing" } },
  "breathing-not-at-rest": { f: { symptoms: [sym("breathing")] }, answers: { breathing_rest: ["no"], breathing_blue: ["no"] }, c: { continuing: "breathing" } },
  "reading-ask-red-flags": { c: { readingAboveLine: true } },
  "reading-alone": { answers: { reading_redflags: ["none"] }, c: { readingAboveLine: true, continuing: "reading_high" } },
  "extra-dose-ask-who": { f: extraF({ about: "unclear" }) },
  "extra-dose-ask-symptoms": { f: extraF() },
  "extra-dose-ask-amount": { f: extraF({ amount: "unknown" }), answers: { extra_symptoms: ["none"] }, c: { continuing: "extra_dose" } },
  "extra-dose-ask-which": { f: extraF({ medicines: [med("unspecified")] }), answers: { extra_symptoms: ["none"] }, c: { continuing: "extra_dose", fits: [] } },
  "extra-dose-one-own": { f: extraF(), answers: { extra_symptoms: ["none"] }, c: { continuing: "extra_dose", accidental: true } },
  // (round 2: taken on purpose? asked last when his words do not say it was a mistake; on purpose or rather not say)
  "extra-dose-ask-purpose": { f: extraF(), answers: { extra_symptoms: ["none"] }, c: { continuing: "extra_dose" } },
  "self-harm-extra-on-purpose": { f: extraF(), answers: { extra_symptoms: ["none"], extra_purpose: ["rather_not"] }, c: { continuing: "extra_dose" } },
  "looks-different-ask-which": { f: { looksDifferent: "yes" }, c: { fits: [] } },
  "looks-different": { f: { looksDifferent: "yes" } },
  "stop-change-ask-stopped": { f: { stopOrChange: "suggested_by_other", medicines: [med("unknown")] } },
  "stop-change-ask-since": { f: { stopOrChange: "done" } },
  "stop-change-stopped-bp": { f: { stopOrChange: "done" }, answers: { stop_since: ["days"] }, c: { continuing: "stop_change" } },
  "stop-change": { f: { stopOrChange: "asked" } },
  "side-effect-ask-red-flags": { f: { symptoms: [sym("swelling")] }, c: { sideEffect: true } },
  "side-effect": { f: { symptoms: [sym("dizziness")] }, answers: { side_redflags: ["none"] }, c: { sideEffect: true, continuing: "side_effect" } },
  "missed-dose-ask-which": { c: { missedDose: true, fits: [], due: ["med-amlodipine", "med-losartan"] } },
  "missed-dose": { c: { missedDose: true } },
  general: {},
};

const run = (s: Scenario) => decide(frame(s.f), s.answers ?? {}, ctx(s.c));

describe("every row is reachable", () => {
  for (const row of decisionTable()) {
    it(row.id, () => {
      const s = SCENARIOS[row.id];
      expect(s, `a scenario for ${row.id}`).toBeDefined();
      expect(run(s).rows).toContain(row.id);
    });
  }
});

describe("never a question before a 995 line when 995 can still follow", () => {
  /** Every answer to every question, three deep: the decision that asked must already show a 995 line if any path reaches level 1 or danger. */
  function reachesUrgent(s: Scenario, depth: number): boolean {
    const d = run(s);
    if (d.level === 1 || d.ladder === "danger") return true;
    if (!d.ask || depth === 0) return false;
    const q = FOLLOW_UPS[d.ask.questionId];
    const options = q.medicines ? ["med:0", "med:1", "unsure"] : q.options.map((o) => o.id);
    return options.some((o) => reachesUrgent({ ...s, answers: { ...(s.answers ?? {}), [d.ask!.questionId]: [o] }, c: { ...s.c, continuing: d.ask!.pathway } }, depth - 1));
  }
  for (const [id, s] of Object.entries(SCENARIOS)) {
    const d = run(s);
    if (!d.ask) continue;
    it(`${id} asks ${d.ask.questionId}`, () => {
      if (reachesUrgent(s, 3)) expect(has995(d), `${id}: ${d.show.join(", ")}`).toBe(true);
      expect(d.level).not.toBe(1);
    });
  }
});

describe("the 28 probes, with the frame a careful reader would fill in", () => {
  const amlo = [med("med-amlodipine")];
  const cases: { id: string; f?: FrameIn; c?: Partial<DecideContext>; level: number; ladder: string; row: string; ask?: string; noAmounts?: boolean }[] = [
    { id: "sh-a1", f: { acts: ["event"], when: "past", sh: { means: "yes", ideation: "unclear" } }, level: 4, ladder: "possible", row: "self-harm-means", ask: "self_harm_confirm", noAmounts: true },
    { id: "sh-a2", f: { medicines: amlo, sh: { lethalityQuestion: "yes" } }, c: { asksAmount: true, asksLargeAmount: true }, level: 4, ladder: "possible", row: "self-harm-lethality", ask: "self_harm_confirm", noAmounts: true },
    { id: "sh-a3", f: { about: "unclear", when: "hypothetical", sh: { lethalityQuestion: "yes" } }, level: 4, ladder: "possible", row: "self-harm-lethality", ask: "self_harm_confirm", noAmounts: true },
    { id: "sh-a4", f: { acts: ["emotion"], sh: { ideation: "active" } }, level: 4, ladder: "thoughts", row: "self-harm-thoughts", ask: "self_harm_danger" },
    { id: "sh-a5", f: { acts: ["emotion"], distress: "yes", sh: { ideation: "passive" } }, level: 4, ladder: "possible", row: "self-harm-passive", ask: "self_harm_confirm" },
    { id: "sh-a6", f: { acts: ["event"], stopOrChange: "done", sh: { means: "yes", ideation: "unclear" } }, level: 3, ladder: "possible", row: "self-harm-means", ask: "self_harm_confirm", noAmounts: true },
    { id: "sh-a7", f: { acts: ["emotion"], distress: "yes", sh: { ideation: "passive" } }, level: 4, ladder: "possible", row: "self-harm-passive", ask: "self_harm_confirm" },
    { id: "sh-a8", f: { sh: { lethalityQuestion: "yes" } }, c: { asksAmount: true, asksLargeAmount: true }, level: 4, ladder: "possible", row: "self-harm-lethality", ask: "self_harm_confirm", noAmounts: true },
    { id: "sh-a9", f: { sh: { ideation: "active" } }, level: 4, ladder: "thoughts", row: "self-harm-thoughts", ask: "self_harm_danger" },
    { id: "sh-a10", f: { acts: ["emotion"], sh: { ideation: "passive" } }, level: 4, ladder: "possible", row: "self-harm-passive", ask: "self_harm_confirm" },
    { id: "em-a1", f: { acts: ["symptom"], when: "now", symptoms: [sym("chest", { now: "yes", minutes: 10, severe: "yes" })] }, level: 1, ladder: "none", row: "chest-now-long" },
    { id: "em-a2", f: { acts: ["symptom"], symptoms: [sym("stroke", { now: "yes" })] }, level: 1, ladder: "none", row: "stroke-now" },
    { id: "em-a3", f: { acts: ["symptom"], symptoms: [sym("breathing", { now: "yes", severe: "yes" })] }, level: 1, ladder: "none", row: "breathing-at-rest" },
    { id: "em-a4", f: { about: "other_adult", acts: ["symptom"], symptoms: [sym("consciousness", { now: "yes" })] }, level: 1, ladder: "none", row: "collapse-now" },
    { id: "em-a5", f: { acts: ["symptom"], symptoms: [sym("headache", { now: "yes", severe: "yes" })] }, c: { readingAboveLine: true }, level: 1, ladder: "none", row: "reading-red-flag" },
    { id: "em-a6", f: { about: "child", acts: ["event"], when: "today", amount: "unknown" }, level: 1, ladder: "none", row: "extra-dose-child" },
    { id: "md-a1", f: { medicines: [med("unspecified")] }, c: { missedDose: true }, level: 4, ladder: "none", row: "missed-dose" },
    {
      id: "md-a2",
      f: { acts: ["event"], when: "today", amount: "double", medicines: [med("unspecified")] },
      c: { rules: { route: "refuse_route", reason: "rule:extra_dose_taken", signals: ["extra_dose_taken"], topics: ["dose_change"] } },
      level: 2,
      ladder: "none",
      row: "extra-dose-ask-symptoms",
      ask: "extra_symptoms",
    },
    { id: "md-a3", f: { medicines: [med("unknown"), med("unspecified")] }, level: 4, ladder: "none", row: "general" },
    { id: "md-a4", f: { acts: ["event"], looksDifferent: "yes", medicines: [med("unspecified")] }, level: 2, ladder: "none", row: "looks-different" },
    { id: "md-a5", f: { stopOrChange: "asked" }, level: 3, ladder: "none", row: "stop-change" },
    { id: "md-a6", f: {}, level: 4, ladder: "none", row: "general" },
    { id: "md-a7", f: { acts: ["symptom"], symptoms: [sym("swelling", { now: "yes" })], medicines: [med("unspecified")] }, c: { sideEffect: true }, level: 3, ladder: "none", row: "side-effect-ask-red-flags", ask: "side_redflags" },
    { id: "md-a8", f: { acts: ["event"], stopOrChange: "suggested_by_other", medicines: [med("unknown")] }, level: 3, ladder: "none", row: "stop-change-ask-stopped", ask: "stop_already" },
    { id: "md-a9", f: { acts: ["symptom", "question"], symptoms: [sym("dizziness", { now: "yes" })], medicines: [med("unspecified")] }, c: { sideEffect: true }, level: 3, ladder: "none", row: "side-effect-ask-red-flags", ask: "side_redflags" },
    { id: "md-a10", f: {}, level: 4, ladder: "none", row: "general" },
    { id: "mt-a1", f: { medicines: amlo, sh: { lethalityQuestion: "yes" } }, c: { watch: true, asksAmount: true, asksLargeAmount: true }, level: 4, ladder: "thoughts", row: "self-harm-lethality-watch", ask: "self_harm_danger", noAmounts: true },
    { id: "mt-a2", f: { sh: { lethalityQuestion: "yes" } }, c: { watch: true, asksAmount: true, asksLargeAmount: true }, level: 4, ladder: "thoughts", row: "self-harm-lethality-watch", ask: "self_harm_danger", noAmounts: true },
  ];
  for (const k of cases) {
    it(k.id, () => {
      const d = decide(frame(k.f), {}, ctx(k.c));
      expect(d.level).toBe(k.level);
      expect(d.ladder).toBe(k.ladder);
      expect(d.rows).toContain(k.row);
      expect(d.ask?.questionId ?? null).toBe(k.ask ?? null);
      // (round 2: no amount whenever the ladder is above none, too)
      expect(d.noAmounts).toBe(!!k.noAmounts || d.ladder !== "none");
      // 995 or the helplines before any question; a level-1 answer has 995 first and asks nothing
      if (d.ask) expect(has995(d) || d.ladder === "none").toBe(true);
      if (d.level === 1) expect(TEMPLATES[d.show[0] as keyof typeof TEMPLATES].en).toContain("995");
      if (d.ladder !== "none") expect(d.show).toContain("self_harm_sos");
      // never his family for "possible"
      if (d.ladder === "possible" && d.level > 1) expect(d.notifyFamily).toBe(false);
    });
  }

  it("mt-a1 and mt-a2 without the watch state: possible, the confirm question, no amount", () => {
    const d = decide(frame({ sh: { lethalityQuestion: "yes" } }), {}, ctx({ asksAmount: true, asksLargeAmount: true }));
    expect([d.ladder, d.ask?.questionId, d.noAmounts]).toEqual(["possible", "self_harm_confirm", true]);
  });

  it("a look or an amount the frame cannot vouch for is no pathway: looksDifferent unclear, an amount that did not happen", () => {
    expect(decide(frame({ looksDifferent: "unclear" }), {}, ctx()).rows).toEqual(["general"]);
    expect(decide(frame({ amount: "unknown", when: "today", acts: ["question"] }), {}, ctx()).rows).toEqual(["general"]);
  });

  it("a missed dose with no medicine named: his one prescription due, so which one is not asked", () => {
    expect(decide(frame(), {}, ctx({ missedDose: true, fits: [], due: ["med-amlodipine"] })).ask).toBeNull();
    expect(decide(frame(), {}, ctx({ missedDose: true, fits: [], due: [] })).ask?.questionId).toBe("missed_which");
  });

  it("an ordinary dose question is none of this: one more tablet, two tablets, half a tablet", () => {
    for (const f of [frame({ amount: "extra_one", when: "hypothetical" }), frame({ amount: "double", when: "hypothetical" }), frame({ stopOrChange: "asked" })]) {
      const d = decide(f, {}, ctx({ asksAmount: true }));
      expect(d.ladder).toBe("none");
      expect(d.level).toBeGreaterThanOrEqual(3);
      expect(d.ask).toBeNull();
    }
    // the same offline (no model): an ordinary amount is not a large one
    expect(decide(frame({ amount: "double", when: "hypothetical" }), {}, ctx({ asksAmount: true, frameSource: "rules" })).ladder).toBe("none");
  });
});

describe("reply sequences", () => {
  /** Answer the decision's question with `option`, continuing its pathway. */
  const answer = (f: Frame, answers: Answers, d: Decision, option: string[], c: Partial<DecideContext> = {}) => {
    const next = { ...answers, [d.ask!.questionId]: option };
    return { answers: next, d: decide(f, next, ctx({ ...c, continuing: d.ask!.pathway })) };
  };

  it("chest pain: still there, under 5 minutes, nothing with it -> level 3 after three questions; 5 minutes -> 995", () => {
    const f = frame({ symptoms: [sym("chest")] });
    const d1 = decide(f, {}, ctx());
    expect([d1.level, d1.ask?.questionId, d1.ask?.step]).toEqual([3, "chest_now", 1]);
    expect(d1.show).toContain("signal_995_chest");
    const s2 = answer(f, {}, d1, ["yes"]);
    expect([s2.d.ask?.questionId, s2.d.ask?.step]).toEqual(["chest_long", 2]);
    const long = answer(f, s2.answers, s2.d, ["over5"]);
    expect([long.d.level, long.d.ask, long.d.show[0]]).toEqual([1, null, "emergency_995"]);
    const notSure = answer(f, s2.answers, s2.d, ["unsure"]);
    expect(notSure.d.level).toBe(1);
    const s3 = answer(f, s2.answers, s2.d, ["under5"]);
    expect([s3.d.ask?.questionId, s3.d.ask?.step]).toEqual(["chest_with", 3]);
    const sweat = answer(f, s3.answers, s3.d, ["sweat"]);
    expect(sweat.d.level).toBe(1);
    const none = answer(f, s3.answers, s3.d, ["none"]);
    expect([none.d.level, none.d.ask, none.d.rows]).toEqual([3, null, ["chest-short-nothing-else"]]);
  });

  it("chest pain gone: settled at once at level 3 (the owner's 10-14 wording)", () => {
    const f = frame({ symptoms: [sym("chest")] });
    const d1 = decide(f, {}, ctx());
    const gone = answer(f, {}, d1, ["gone"]);
    expect([gone.d.level, gone.d.ask, gone.d.show]).toEqual([3, null, ["signal_recorded", "signal_995_chest"]]);
  });

  it("chest pain answered earlier today and back now: no question again, the unknown counts as unsure -> 995", () => {
    const d = decide(frame({ symptoms: [sym("chest", { now: "yes" })] }), {}, ctx({ history: { answered: ["chest"], unanswered: [], asks: { chest: 1 } } }));
    expect([d.level, d.ask]).toEqual([1, null]);
  });

  it("an unanswered chest question does not turn a later, unrelated message into 995", () => {
    const d = decide(frame(), {}, ctx({ history: { answered: [], unanswered: ["chest_now"], asks: { chest: 1 } } }));
    expect([d.level, d.rows]).toEqual([4, ["general"]]);
  });

  it("an unanswered medical question is asked again when the pathway comes up again, until three were asked", () => {
    const again = decide(frame({ symptoms: [sym("chest")] }), {}, ctx({ history: { answered: [], unanswered: ["chest_now"], asks: { chest: 1 } } }));
    expect([again.level, again.ask?.questionId]).toEqual([3, "chest_now"]);
    const spent = decide(frame({ symptoms: [sym("chest")] }), {}, ctx({ history: { answered: [], unanswered: ["chest_now"], asks: { chest: 3 } } }));
    expect([spent.level, spent.ask]).toEqual([1, null]);
  });

  it("one tablet too many: a sign question; none -> level 2; a sign or not sure -> 995", () => {
    const f = frame(extraF());
    const c = { rules: { route: "refuse_route" as const, reason: "rule:extra_dose_taken", signals: ["extra_dose_taken"], topics: ["dose_change"] }, accidental: true };
    const d1 = decide(f, {}, ctx(c));
    expect([d1.level, d1.ask?.questionId, d1.show]).toEqual([2, "extra_symptoms", ["extra_dose_taken"]]);
    expect(answer(f, {}, d1, ["none"], c).d.rows).toEqual(["extra-dose-one-own"]);
    // (round 2: not said to be a mistake, the last question is whether it was on purpose; yes or rather not say -> 995 and
    // the ladder's thoughts, a mistake -> level 2)
    const open = { ...c, accidental: false };
    const p = answer(f, {}, decide(f, {}, ctx(open)), ["none"], open);
    expect(p.d.ask?.questionId).toBe("extra_purpose");
    for (const [o, level, ladder] of [["purpose", 1, "thoughts"], ["rather_not", 1, "thoughts"], ["mistake", 2, "none"]] as const) {
      const r = answer(f, p.answers, p.d, [o], open).d;
      expect([r.level, r.ladder], o).toEqual([level, ladder]);
    }
    expect(answer(f, {}, d1, ["none"], c).d.level).toBe(2);
    expect(answer(f, {}, d1, ["heart_chest"], c).d.level).toBe(1);
    expect(answer(f, {}, d1, ["unsure"], c).d.level).toBe(1);
  });

  it("extra dose, nothing known: who, a sign, how many, then the fourth unknown is unsure (at most three questions)", () => {
    const f = frame({ when: "today", acts: ["event"], about: "unclear", amount: "unknown", medicines: [med("unspecified")] });
    const c = { fits: [] as string[] };
    const d1 = decide(f, {}, ctx(c));
    expect(d1.ask?.questionId).toBe("extra_who");
    const s2 = answer(f, {}, d1, ["me"], c);
    expect(s2.d.ask?.questionId).toBe("extra_symptoms");
    const s3 = answer(f, s2.answers, s2.d, ["none"], c);
    expect(s3.d.ask?.questionId).toBe("extra_amount");
    const s4 = answer(f, s3.answers, s3.d, ["one"], c);
    expect([s4.d.level, s4.d.ask, s4.d.rows]).toEqual([1, null, ["extra-dose-several-medicines"]]);
  });

  it("the self-harm confirm question: No -> none and the row the watch state reads; rather not say -> thoughts, family told, the danger question", () => {
    const f = frame({ sh: { lethalityQuestion: "yes" } });
    const d1 = decide(f, {}, ctx({ asksAmount: true, asksLargeAmount: true }));
    expect([d1.ladder, d1.ask?.questionId]).toEqual(["possible", "self_harm_confirm"]);
    expect(d1.notifyFamily).toBe(false);
    const no = answer(f, {}, d1, ["no"]);
    expect([no.d.ladder, no.d.rows[0], no.d.show]).toEqual(["none", "self-harm-confirm-no", ["self_harm_here"]]);
    expect(no.d.rows[0].startsWith("self-harm-confirm-no")).toBe(true);
    const rather = answer(f, {}, d1, ["rather_not"]);
    expect([rather.d.ladder, rather.d.notifyFamily, rather.d.ask?.questionId]).toEqual(["thoughts", true, "self_harm_danger"]);
    expect(rather.d.show.slice(0, 3)).toEqual(["self_harm_995", "self_harm_sos", "self_harm_mindline"]);
    const danger = answer(f, rather.answers, rather.d, ["yes"]);
    expect([danger.d.ladder, danger.d.show[0], danger.d.ask]).toEqual(["danger", "self_harm_danger_995", null]);
    const safe = answer(f, rather.answers, rather.d, ["no"]);
    expect([safe.d.ladder, safe.d.ask]).toEqual(["thoughts", null]);
  });

  it("a stroke sign only cue words saw (no crisis rule, not the model's) fires no level-1 row of its own", () => {
    const d = decide(frame({ symptoms: [sym("stroke", { now: "yes" })] }), {}, ctx({ cueOnly: ["stroke"] }));
    expect([d.level, d.rows]).toEqual([4, ["general"]]);
    expect(decide(frame({ symptoms: [sym("stroke", { now: "yes" })] }), {}, ctx()).level).toBe(1);
  });

  it("a self-harm signal said only in earlier turns does not decide this message's ladder (the watch state carries it)", () => {
    const earlier = frame({ distress: "yes", sh: { ideation: "active", evidence: [{ quote: "I want to die", from: "turn:2" }] } });
    expect(decide(earlier, {}, ctx()).ladder).toBe("none");
    const here = frame({ distress: "yes", sh: { ideation: "active", evidence: [{ quote: "I want to die", from: "message" }] } });
    expect(decide(here, {}, ctx()).ladder).toBe("thoughts");
  });

  it("after a confirm answered earlier today, a new lethality question shows the helplines without asking again", () => {
    const d = decide(frame({ sh: { lethalityQuestion: "yes" } }), {}, ctx({ history: { answered: ["self_harm_check"], unanswered: [], asks: { self_harm_check: 1 } } }));
    expect([d.ladder, d.ask]).toEqual(["possible", null]);
    // never answered (he typed something else): asked again while asks are left; once three were asked, the more dangerous side
    const ignored = decide(frame({ sh: { lethalityQuestion: "yes" } }), {}, ctx({ history: { answered: [], unanswered: ["self_harm_confirm"], asks: { self_harm_check: 1 } } }));
    expect([ignored.ladder, ignored.ask?.questionId]).toEqual(["possible", "self_harm_confirm"]);
    const spent = decide(frame({ sh: { lethalityQuestion: "yes" } }), {}, ctx({ history: { answered: [], unanswered: ["self_harm_confirm"], asks: { self_harm_check: 3 } } }));
    expect([spent.ladder, spent.ask]).toEqual(["thoughts", null]);
    // with the watch state on (the first "possible" answer turns it on) the same question is thoughts at once
    expect(decide(frame({ sh: { lethalityQuestion: "yes" } }), {}, ctx({ watch: true, history: { answered: [], unanswered: ["self_harm_confirm"], asks: { self_harm_check: 1 } } })).ladder).toBe("thoughts");
  });
});
