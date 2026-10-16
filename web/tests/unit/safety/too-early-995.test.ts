/**
 * 10-14, the owner's decision: the rules were stricter than the challenge asks (its red lines: never give medication
 * advice, and say so when a medicine cannot be identified), and in three places the emergency sentence came too early.
 *
 *   1a. a hypothetical or general question about one tablet more is the dose question it is: his doctor's words about the
 *       dose, his label, the referral to his doctor. No emergency sentence.
 *   1b. he says he took one tablet too many, or today's dose twice, and names no symptom: not the emergency route. His
 *       doctor's words about the dose (with their recording), his label, then the fixed sentence extra_dose_taken, and his
 *       words go on the doctor's list. Reason rule:extra_dose_taken.
 *   2.  a plain note gets 「记下了。」 (and the check-in question when it applies) and nothing else; the fixed safety line
 *       follows a note only when its own words carry a crisis cue word.
 *   3.  a reading above the doctor's own number, and nothing else: his doctor's warning line first, the 995 sentence after it.
 * What stays exactly as it was: someone else's or a child's overdose, a large or unknown amount, anything with a symptom or
 * danger word, breathing, collapse, self-harm.
 *
 * The owner's second decision of 10-14 (「胸口痛就必须打 995」 was too absolute; symptom-signal.test.ts): his own chest pain, a
 * stroke sign or a reading above the doctor's line is kept for his doctor, and the 995 sentence is for when it gets bad. So
 * in 3 the sentence after the doctor's line is now 995 if he feels very unwell (signal_995_unwell), with the sentence that
 * says the reading was kept between them, and chest pain and stroke signs are kept too (no longer 995 first).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerCard } from "@/components/daily/AnswerCard";
import { answerParts } from "@/components/daily/answer-parts";
import { ThresholdRelayBlock } from "@/components/daily/elder/ThresholdRelayBlock";
import { createMockLlm } from "@/lib/llm";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { classifyRules, crisisCue, emergencyCue, extraDose } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { SIGNAL_RECORDED, TEMPLATES } from "@/lib/safety/templates";
import { relayDoctorThreshold } from "@/lib/safety/threshold";
import { storedAnswer } from "@/lib/safety/turns";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";

const CTX = { doctorThresholdSystolic: 180, meds: [] };
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
/** 10-14 (owner): a dose question that is not about high readings quotes only R4's sentence about the dose, and plays only that stretch of its recording (lib/asr/sentences.ts) */
const R4_DOSE = "Please don't change the dose yourself.";
const LABEL = "Take ONE tablet every MORNING";

type Published = { type: string; say: string; data: unknown }[];

async function askAt(text: string, opts: { day?: number; time?: string; llm?: LlmClient; locale?: "en" | "zh-Hans"; role?: string } = {}) {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: opts.day ?? 29, story_time: opts.time ?? "20:15", ttl_hours: 1 });
  const before = await store.listQuestions(s.id);
  const notesBefore = (await store.listNotes(s.id)).length;
  const published: Published = [];
  const res = await ask(
    { sessionId: s.id, text, role: opts.role ?? "patient", locale: opts.locale },
    { store, llm: opts.llm ?? createMockLlm(), checker: null, checkerReason: "test", publish: (_sid, type, say, data) => published.push({ type, say, data }), costGuard: null },
  );
  const after = await store.listQuestions(s.id);
  return {
    res,
    published,
    added: after.filter((q) => !before.some((b) => b.id === q.id)),
    notesAdded: (await store.listNotes(s.id)).length - notesBefore,
    shown: `${renderText(res, "en")}\n${renderText(res, "zh-Hans")}`,
  };
}

const ids = (r: AskResult) => r.sentences.map((s) => s.templateId ?? s.sourceId);
const EMERGENCY_TEMPLATES = ["emergency_995", "emergency_overdose", "emergency_overdose_other", "safety_line"] as const;
function noEmergencySentence(r: AskResult, text: string) {
  for (const id of EMERGENCY_TEMPLATES) expect(r.sentences.map((s) => s.templateId), `${text}: ${id}`).not.toContain(id);
}

/** A fake live model: answers the crisis screen as told, composes nothing, records the calls. */
function liveScreen(crisis: "none" | "emergency" | "self_harm", calls: ChatOpts[] = []): LlmClient {
  return {
    provider: "fake-live",
    model: "fake",
    async chat(opts: ChatOpts) {
      calls.push(opts);
      const task = (JSON.parse(opts.user) as { task: string }).task;
      if (task === "crisis") return { content: JSON.stringify({ crisis }), tokens: 3 };
      return { content: JSON.stringify({ sentences: [] }), tokens: 1 };
    },
  };
}

// ---------------------------------------------------------------- 1a

/** A hypothetical or general question about one tablet more: two Chinese, two English, and their neighbours. */
const ASKED = [
  "要是多吃了一粒会怎么样",
  "多吃一粒算不算吃药过量",
  "what happens if I take one more",
  "is two tablets an overdose",
  "如果不小心吃了两粒怎么办？",
  "What happens if I accidentally take two tablets?",
  "If I took an extra tablet by mistake, what should I do?",
];

describe("1a. a hypothetical or general question about one tablet more is a dose question, with no emergency sentence", () => {
  it.each(ASKED)("%s: rule:dose_change by the rules", (text) => {
    const cls = classifyRules(text, CTX);
    expect(cls).toMatchObject({ route: "refuse_route", reason: "rule:dose_change", questionFor: "doctor" });
    expect(cls!.topics).toContain("dose_change");
    expect(cls!.signals).not.toContain("overdose");
  });

  it.each(ASKED)("%s: the doctor's words about the dose, the label, the referral to the doctor; a question is added", async (text) => {
    const { res, added, notesAdded } = await askAt(text);
    expect(res.route).toBe("refuse_route");
    expect(res.routeReason).toBe("rule:dose_change");
    const doctor = res.sentences.find((x) => x.sourceId === "visit:v2:R4");
    expect(doctor).toMatchObject({ en: R4_DOSE, span: R4_DOSE, attribution: "doctor", origin: "span" });
    expect(doctor?.cite?.clipUrl).toMatch(/^\/api\/visits\/v2\/clip\?u=v2-u08&.*s=0$/);
    expect(res.sentences.find((x) => x.sourceId === "label:med-amlodipine")?.en).toBe(LABEL);
    expect(res.sentences.map((x) => x.templateId)).toContain("refer_doctor");
    expect(res.sentences.map((x) => x.templateId)).not.toContain("extra_dose_taken");
    noEmergencySentence(res, text);
    for (const id of ["self_harm_sos", "self_harm_mindline", "self_harm_care_corner"]) expect(res.sentences.map((x) => x.templateId)).not.toContain(id);
    expect(res.addedQuestionId).toBeTruthy();
    expect(added.length + (res.questionReused ? 1 : 0)).toBe(1);
    expect(notesAdded).toBe(0);
    expect(res.blocked).toEqual([]);
  });

  it("the word 'overdose' in such a question is not taken for a crisis cue (no safety line, no helplines), and only there", async () => {
    expect(crisisCue("is two tablets an overdose")).toBe(true);
    expect(extraDose("is two tablets an overdose", true)).toBe("asked");
    const { res, published } = await askAt("is two tablets an overdose");
    expect((res.events[0].output as { safetyLine: unknown }).safetyLine).toBeNull();
    expect((published.find((e) => e.type === "ask.route")!.data as { signals: string[] }).signals).toEqual(["dose_change", "extra_dose_question"]);
    // an ordinary dose question next to a real cue word keeps the line
    const weak = await askAt("I feel weak, can I take an extra tablet tonight?");
    expect(weak.res.sentences.map((x) => x.templateId)).toContain("safety_line");
  });

  it("not a question, an amount past one more, a symptom, someone else, or no amount at all: the overdose emergency as before", () => {
    for (const text of [
      "What happens if I take 3 tablets by mistake, is that an overdose?",
      "Is it an overdose if I take five tablets?",
      "What happens if I overdose on my BP pills?",
      "要是多吃了三粒会怎么样",
      "如果药吃多了会怎么样",
      "要是多吃了一粒头晕怎么办",
      "If I took an extra tablet by mistake and feel dizzy, what should I do?",
    ]) {
      expect(classifyRules(text, CTX)?.route, text).toBe("emergency");
      expect(classifyRules(text, CTX)?.signals, text).toContain("overdose");
    }
  });
});

// ---------------------------------------------------------------- 1b

/** He says he took one tablet too many, or today's dose twice, and names no symptom: two Chinese, one English, and more. */
const TAKEN = [
  "我多吃了一粒怎么办",
  "今天的药吃了两次",
  "I took two by mistake",
  "今天的药吃了两次，怎么办？",
  "I took my amlodipine twice today by mistake, what should I do?",
  "I accidentally took two tablets this morning",
  "I took an extra tablet today",
  "I took 2 tablets instead of 1",
  "我不小心吃了两粒",
  "药吃重了，怎么办",
  "I forgot I already took it and took it again",
];

describe("1b. one tablet too many, already taken, no symptom: not the emergency route", () => {
  it.each(TAKEN)("%s: refuse_route, rule:extra_dose_taken", (text) => {
    const cls = classifyRules(text, CTX);
    expect(cls).toMatchObject({ route: "refuse_route", reason: "rule:extra_dose_taken", signals: ["extra_dose_taken"], questionFor: "doctor" });
    expect(cls!.topics).toContain("dose_change");
  });

  it.each(TAKEN)("%s: the doctor's words about the dose, the label, then the fixed sentence; his words go on the doctor's list", async (text) => {
    const { res, added, notesAdded, shown } = await askAt(text);
    expect(res.route).toBe("refuse_route");
    expect(res.routeReason).toBe("rule:extra_dose_taken");
    // the order: the doctor's line (it carries the recording), the label, the new fixed sentence
    expect(ids(res)).toEqual(["visit:v2:R4", "label:med-amlodipine", "extra_dose_taken"]);
    // (10-14: R4's sentence about the dose, with that stretch of its recording; the line's own source and citation)
    expect(res.sentences[0]).toMatchObject({ en: R4_DOSE, span: R4_DOSE, attribution: "doctor", origin: "span" });
    expect(R4.startsWith(res.sentences[0].en)).toBe(true); // the line's own first sentence, word for word
    expect(res.sentences[0].cite).toMatchObject({ visitId: "v2", requiredLine: "R4", utteranceId: "v2-u08", clipPath: "visits/clips/v2-u08.wav" });
    expect(res.sentences[0].cite?.clipUrl).toMatch(/^\/api\/visits\/v2\/clip\?u=v2-u08&.*s=0$/);
    expect(res.sentences[1].en).toBe(LABEL);
    expect(res.sentences[2]).toMatchObject({ origin: "template", en: TEMPLATES.extra_dose_taken.en, zh: TEMPLATES.extra_dose_taken.zh, cite: { referralId: "B1-12" } });
    for (const id of ["emergency_995", "emergency_overdose", "emergency_overdose_other", "refer_doctor", "safety_line", "noted"]) expect(ids(res), id).not.toContain(id);
    expect(res.fixedText).toBeUndefined();
    expect(res.blocked).toEqual([]);
    expect(res.llm.calls).toBe(0);
    // 995 is still on the screen, after the doctor's words and the label: "if you feel very unwell"
    expect(shown.indexOf("995")).toBeGreaterThan(shown.indexOf(LABEL));
    // on the doctor's list as a question of its own, in his words (not folded into the seeded "may I take an extra tablet")
    expect(added.map((q) => ({ id: q.id, for: q.for, origin: q.origin, text: q.text }))).toEqual([{ id: res.addedQuestionId, for: "doctor", origin: "refused_question", text }]);
    expect(res.addedQuestionId).not.toBe("q-extra-tablet");
    expect(res.questionReused).toBeUndefined();
    expect(res.answeredBefore).toBeUndefined();
    expect(res.refusedRequest).toMatchObject({ rule: "rule:extra_dose_taken", replacedBy: "extra_dose_taken" });
    expect(notesAdded).toBe(0);
  });

  it("the fixed sentence is the owner's wording, cites the overdose row for its 995, and is drawn as Ripple's own sentence", async () => {
    expect(TEMPLATES.extra_dose_taken).toMatchObject({
      id: "extra_dose_taken",
      en: "Taking more than your label says is a question for your pharmacist or doctor: ask today. If you feel very unwell, call 995 or go to the nearest A&E.",
      zh: "多吃了药的事要问药剂师或医生，今天就问。要是很不舒服，打 995，或者去最近的急诊。",
      referralId: "B1-12",
      speechAct: "referral",
    });
    const { res } = await askAt("我多吃了一粒怎么办", { locale: "zh-Hans" });
    // the screen: the doctor's quote, the label, then the sentence as a line whose 995 dials; no red card anywhere
    expect(answerParts(res.sentences, "zh-Hans").map((p) => p.kind)).toEqual(["quote", "label", "hotlines"]);
    expect(renderText(res, "zh-Hans")).toContain(TEMPLATES.extra_dose_taken.zh);
  });

  it("asked again in the same words: the same question on the list, never a second one", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const deps = { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null };
    const first = await ask({ sessionId: s.id, text: "我多吃了一粒怎么办", role: "patient" }, deps);
    const again = await ask({ sessionId: s.id, text: "我多吃了一粒怎么办", role: "patient" }, deps);
    expect(again.addedQuestionId).toBe(first.addedQuestionId);
    expect(again.questionReused).toBe(true);
    expect((await store.listQuestions(s.id)).filter((q) => q.text === "我多吃了一粒怎么办")).toHaveLength(1);
  });

  it("after the visit that answered 'may I take an extra tablet' (D43): still his own question, never 'answered before'", async () => {
    const { res, added } = await askAt("我多吃了一粒怎么办", { day: 43, time: "08:00" });
    expect(res.routeReason).toBe("rule:extra_dose_taken");
    expect(res.answeredBefore).toBeUndefined();
    expect(ids(res)).not.toContain("answered_before_doctor");
    expect(ids(res).at(-1)).toBe("extra_dose_taken");
    expect(ids(res)).toContain("visit:v2:R4");
    expect(added).toHaveLength(1);
  });

  it("a live crisis screen that calls tablets already taken an emergency does not undo the rule; its self_harm still raises", async () => {
    const calls: ChatOpts[] = [];
    const held = await askAt("我多吃了一粒怎么办", { llm: liveScreen("emergency", calls) });
    expect(held.res.route).toBe("refuse_route");
    expect(held.res.routeReason).toBe("rule:extra_dose_taken");
    expect(ids(held.res)).toEqual(["visit:v2:R4", "label:med-amlodipine", "extra_dose_taken"]);
    // the screen was asked, and what it said is on record
    expect(calls.map((c) => c.purpose)).toEqual(["crisis"]);
    expect((held.res.events[0].output as { crisisScreen: unknown }).crisisScreen).toMatchObject({ route: "emergency", raisedFrom: null, heldBy: "rule:extra_dose_taken", awaited: true });
    const raised = await askAt("我多吃了一粒怎么办", { llm: liveScreen("self_harm") });
    expect(raised.res.route).toBe("self_harm");
    expect(raised.shown).toContain("1767");
    // and "none" changes nothing
    const none = await askAt("I took two by mistake", { llm: liveScreen("none") });
    expect(ids(none.res)).toEqual(["visit:v2:R4", "label:med-amlodipine", "extra_dose_taken"]);
    // an ordinary note is still raised by the screen's "emergency"
    const note = await askAt("I walked to the market this morning.", { llm: liveScreen("emergency") });
    expect(note.res.route).toBe("emergency");
  });

  it("with a symptom or a danger word the same words are the overdose emergency (995 first, no doctor's line before it)", async () => {
    for (const text of [
      "我多吃了一粒，现在头晕",
      "今天的药吃了两次，心跳得很快",
      "多吃了一粒，很不舒服",
      "I took two by mistake and feel dizzy",
      "I took an extra tablet and my chest hurts",
      "I took my amlodipine twice today and I feel sick",
      "I took one more and now I can't breathe",
    ]) {
      const cls = classifyRules(text, CTX);
      expect(cls?.route, text).toBe("emergency");
      expect(cls?.signals, text).toContain("overdose");
      const { res } = await askAt(text);
      expect(res.route, text).toBe("emergency");
      expect(res.sentences[0].templateId, text).toBe("emergency_overdose");
      expect(renderText(res, "en"), text).toContain("995");
    }
    // 「没有不舒服」 says he does not feel unwell
    expect(classifyRules("我多吃了一粒，没有不舒服，怎么办", CTX)?.reason).toBe("rule:extra_dose_taken");
  });

  it("a large or unknown amount, an overdose said as one, on purpose, or a medicine that is not his: the emergency as before", () => {
    for (const text of [
      "我刚吃了十粒",
      "I took 10 of my BP pills just now",
      "I accidentally took 3 tablets this morning",
      "我多吃了三粒怎么办",
      "我多吃了两粒怎么办",
      "我多吃了好几粒",
      "药吃多了",
      "我吃药过量了",
      "我吃药过量了，多吃了一粒",
      "I think I overdosed, I took two instead of one",
      "I took too many of my pills",
      "I took a few extra tablets by mistake",
      "I took my morning pill three times today because I forgot I took it",
      "I took two extra tablets by mistake",
      "我多吃了一粒安眠药",
      "I took two of the herbal pills my relative gave me by mistake",
    ]) {
      const route = classifyRules(text, CTX)?.route;
      expect(["emergency", "self_harm"], text).toContain(route);
      expect(classifyRules(text, CTX)?.reason, text).not.toBe("rule:extra_dose_taken");
    }
    expect(classifyRules("I took two on purpose", CTX)?.reason).not.toBe("rule:extra_dose_taken");
  });

  it("a large overdose he took: still the overdose template first, nothing before it, no question, no model call", async () => {
    for (const text of ["我刚吃了十粒", "I took 10 of my BP pills just now"]) {
      const { res, added } = await askAt(text);
      expect(res.route, text).toBe("emergency");
      expect(res.routeReason, text).toBe("rule:emergency");
      expect(res.sentences.map((s) => s.templateId), text).toEqual(["emergency_overdose"]);
      expect(res.sentences[0].cite?.referralId, text).toBe("B1-12");
      expect(res.fixedText, text).toBe(TEMPLATES.emergency_overdose.en);
      expect(added, text).toHaveLength(0);
      expect(res.llm.calls, text).toBe(0);
    }
  });

  it("someone else's or a child's is theirs, as before", async () => {
    for (const text of ["My wife took two of her tablets by mistake", "他多吃了一粒怎么办", "My wife took her amlodipine twice today"]) {
      const cls = classifyRules(text, CTX);
      expect(cls?.route, text).toBe("emergency");
      expect(cls?.signals, text).toEqual(expect.arrayContaining(["overdose", "third_person"]));
    }
    const { res } = await askAt("My wife took two of her tablets by mistake", { role: "family" });
    expect(res.sentences[0].templateId).toBe("emergency_overdose_other");
    const child = await askAt("My grandson swallowed a few of my amlodipine tablets", { role: "family" });
    expect(child.res.sentences[0]).toMatchObject({ templateId: "emergency_995", cite: { referralId: "B1-12" } });
  });

  it("a painkiller is a medicine's name, not a pain; 'one too many' is one", () => {
    for (const text of ["止痛药我多吃了一粒", "I took two of my painkiller tablets by mistake", "I took one too many"]) expect(classifyRules(text, CTX)?.reason, text).toBe("rule:extra_dose_taken");
    // but a pain he names keeps the emergency
    expect(classifyRules("我多吃了一粒，现在头很痛", CTX)?.route).toBe("emergency");
    expect(classifyRules("I took two by mistake and I am in pain", CTX)?.route).toBe("emergency");
  });

  it("'swallowed' and 吞 are crisis cue words: such a message is what it was before (a note with the safety line), not this rule", async () => {
    for (const text of ["I swallowed two by mistake", "我多吞了一粒"]) {
      expect(classifyRules(text, CTX)?.route, text).toBe("log_only");
      const { res } = await askAt(text);
      expect(res.sentences.map((x) => x.templateId), text).toEqual(["noted", "safety_line"]);
    }
  });

  it("words that only look like it are not it: how he takes it, a reading taken twice, one more of something else", () => {
    for (const text of [
      "I took my blood pressure twice today",
      "I took one more photo of the label",
      "I had another one of those dreams",
      "I ate one more bao at lunch",
      "I took two buses by mistake",
      "I had breakfast twice today",
      "The doctor said to take it twice a day",
      "我今天吃了两粒",
      "我能不能多吃一粒",
      "今天 150/95，我能不能多吃一粒？",
    ]) {
      const cls = classifyRules(text, CTX);
      expect(cls?.reason, text).not.toBe("rule:extra_dose_taken");
      expect(cls?.signals ?? [], text).not.toContain("overdose");
    }
    // the hero keeps its own answer
    expect(classifyRules("今天 150/95，我能不能多吃一粒？", CTX)).toMatchObject({ route: "refuse_route", reason: "rule:dose_change", signals: ["dose_change"] });
  });
});

// ---------------------------------------------------------------- 2

describe("2. a plain note gets 「记下了。」 and nothing else; the safety line only with a crisis cue word of its own", () => {
  it.each(["头有点晕", "吃多了", "我今天好累", "Everything feels heavy today", "I ate too much at dinner."])("%s (offline, no crisis screen): the note alone", async (text) => {
    expect(crisisCue(text)).toBe(false);
    const { res, notesAdded, shown } = await askAt(text);
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    expect(shown).not.toContain("995");
    expect((res.events[0].output as { safetyLine: unknown }).safetyLine).toBeNull();
    expect(notesAdded).toBe(1);
    expect(res.blocked).toEqual([]);
  });

  it("the check-in question still follows when today's dose has no answer, and nothing after it", async () => {
    const tired = await askAt("我今天好累", { day: 42, time: "08:00" });
    expect(tired.res.sentences.map((x) => x.templateId)).toEqual(["noted", "check_in_dose"]);
    const ate = await askAt("吃多了", { day: 42, time: "08:00" });
    expect(ate.res.sentences.map((x) => x.templateId)).toEqual(["noted", "check_in_dose"]);
    // how he feels is never answered with the check-in question
    const dizzy = await askAt("头有点晕", { day: 42, time: "08:00" });
    expect(dizzy.res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
  });

  it("no AI at all (his consent is off): the plain note is still only the note", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const res = await ask({ sessionId: s.id, text: "头有点晕", role: "patient" }, { store, llm: liveScreen("emergency"), checker: null, checkerReason: "test", publish: () => {}, costGuard: null, aiAllowed: false });
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
  });

  it.each([
    ["I feel weak today", "offline"],
    ["我今天没力", "offline"],
    ["今天有点喘", "offline"],
  ] as const)("%s (a cue word of its own, no crisis screen): the note, then the safety line with its reason", async (text, reason) => {
    expect(crisisCue(text)).toBe(true);
    expect(emergencyCue(text)).toEqual([]);
    const { res, shown } = await askAt(text);
    expect(res.route).toBe("log_only");
    expect(res.sentences.map((x) => x.templateId)).toEqual(["noted", "safety_line"]);
    expect(res.sentences[1].cite?.referralId).toBe("B4-01");
    expect(shown).toContain("995");
    expect((res.events[0].output as { safetyLine: unknown }).safetyLine).toEqual({ reason, cue: true });
    expect(res.blocked).toEqual([]);
  });

  it("with a live screen: 'none' leaves a plain note alone and keeps the line on a note with a cue word; an error adds nothing to a plain note", async () => {
    const plain = await askAt("头有点晕", { llm: liveScreen("none") });
    expect(plain.res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    const cue = await askAt("I feel weak today", { llm: liveScreen("none") });
    expect(cue.res.sentences.map((x) => x.templateId)).toEqual(["noted", "safety_line"]);
    expect((cue.res.events[0].output as { safetyLine: unknown }).safetyLine).toEqual({ reason: "screen_none", cue: true });
    const down: LlmClient = { provider: "fake-live", model: "fake", chat: async () => { throw new Error("socket hang up"); } };
    const failed = await askAt("头有点晕", { llm: down });
    expect(failed.res.sentences.map((x) => x.templateId)).toEqual(["noted"]);
    expect((failed.res.events[0].output as { safetyLine: unknown; crisisScreen: { errorCode: string } }).safetyLine).toBeNull();
    expect((failed.res.events[0].output as { crisisScreen: { errorCode: string } }).crisisScreen.errorCode).toBe("error");
    const failedCue = await askAt("I feel weak today", { llm: down });
    expect(failedCue.res.sentences.map((x) => x.templateId)).toEqual(["noted", "safety_line"]);
    expect((failedCue.res.events[0].output as { safetyLine: unknown }).safetyLine).toEqual({ reason: "error", cue: true });
  });

  it("crisis words in a note are still read as the crisis they may be when no screen ran (unchanged)", async () => {
    const selfHarm = await askAt("Nobody would notice if I died");
    expect(selfHarm.res.route).toBe("self_harm");
    const stroke = await askAt("My arm went funny and heavy");
    expect(stroke.res.route).toBe("emergency");
    // (the owner's second decision of 10-14: his own stroke sign is kept for his doctor, then 995 if it gets bad)
    expect(ids(stroke.res)).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_stroke"]);
  });
});

// ---------------------------------------------------------------- 3

describe("3. a reading above the doctor's own number: his warning line first, the 995 sentence after it", () => {
  it.each(["今天 185/112", "我刚量了血压 185/112", "My reading is 190/110, what should I do?"])("%s: the doctor's line, kept for the doctor, then 995 if very unwell", async (text) => {
    const { res, published, notesAdded } = await askAt(text);
    expect(res.route).toBe("emergency");
    expect((published.find((e) => e.type === "ask.route")!.data as { signals: string[] }).signals).toEqual(["above_doctor_threshold"]);
    expect(ids(res)).toEqual(["visit:v1:R2", SIGNAL_RECORDED.id, "signal_995_unwell"]);
    expect(res.sentences[0]).toMatchObject({ en: R2, attribution: "doctor", origin: "span" });
    expect(res.sentences[0].cite).toMatchObject({ visitId: "v1", requiredLine: "R2", utteranceId: "v1-u09" });
    // (the owner's second decision of 10-14) the reading is kept for his doctor, with the story's date and time
    expect(res.sentences[1].zh).toBe("你说的已记下（9月22日 20:15），会放进下次要告诉医生的情况里。");
    expect(notesAdded).toBe(1);
    expect(res.sentences[2]).toMatchObject({ origin: "template", templateId: "signal_995_unwell", en: TEMPLATES.signal_995_unwell.en, cite: { referralId: "B1-01" } });
    expect(res.fixedText).toBe(TEMPLATES.signal_995_unwell.en);
    expect(res.blocked).toEqual([]);
    expect(res.llm.calls).toBe(0);
    // on the screen: the doctor's quote, Ripple's sentence, then Ripple's 995 line with its button
    expect(answerParts(res.sentences, "zh-Hans").map((p) => p.kind)).toEqual(["quote", "ripple", "hotlines"]);
  });

  it("the same reading with a bad headache keeps 995 first; with chest pain or a stroke sign it is kept for the doctor", async () => {
    const headache = await askAt("My reading is 185/110 and I have a bad headache", { day: 30 });
    expect(headache.res.route).toBe("emergency");
    expect(headache.res.sentences.map((s) => s.sourceId)).toEqual(["referral:B1-10", "visit:v1:R2"]);
    expect(headache.res.sentences[0].templateId).toBe("emergency_995");
    for (const [text, conditional, row] of [
      ["今天 185/112，胸口很痛", "signal_995_chest", "B1-01"],
      ["185/112 and my left arm is weak", "signal_995_stroke", "B1-03"],
    ] as const) {
      const { res } = await askAt(text, { day: 30 });
      expect(res.route, text).toBe("emergency");
      expect(ids(res), text).toEqual([SIGNAL_RECORDED.id, "visit:v1:R2", conditional]);
      expect(res.sentences[2].cite?.referralId, text).toBe(row);
    }
  });

  it("chest pain and stroke signs with no reading are kept for the doctor; breathing keeps 995 first, exactly as before", async () => {
    for (const [text, sources] of [
      ["我胸口好痛", [SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_chest"]],
      ["右边身体觉得很重", [SIGNAL_RECORDED.id, "visit:v1:R2", "signal_995_stroke"]],
      ["I can't breathe", ["emergency_995"]],
    ] as const) {
      const { res } = await askAt(text);
      expect(ids(res), text).toEqual(sources);
    }
  });

  it("the ask screen draws them in that order on one line: his question, the doctor's entry, Ripple's sentences, one call button", async () => {
    const question = "今天 185/112";
    const { res } = await askAt(question, { locale: "zh-Hans" });
    const out = renderToStaticMarkup(createElement(AnswerCard, { question, answer: storedAnswer(res), locale: "zh-Hans" }));
    // one stretch of the line and no red card: the 995 is for when he feels very unwell
    expect([...out.matchAll(/data-rp="(timeline|emergency)"/g)].map((m) => m[1])).toEqual(["timeline"]);
    const quoteAt = out.indexOf('data-kind="quote"');
    const lineAt = out.indexOf('data-kind="hotlines"');
    expect(quoteAt).toBeGreaterThan(-1);
    expect(lineAt).toBeGreaterThan(quoteAt);
    expect(out.indexOf("above 180 on top")).toBeLessThan(out.indexOf(TEMPLATES.signal_995_unwell.zh));
    expect((out.match(/href="tel:995"/g) ?? []).length).toBe(1);
    // chest pain: kept, the doctor's entry, then 995 if it gets bad, on the same line
    const chest = await askAt("我胸口好痛", { locale: "zh-Hans" });
    const chestOut = renderToStaticMarkup(createElement(AnswerCard, { question: "我胸口好痛", answer: storedAnswer(chest.res), locale: "zh-Hans" }));
    expect([...chestOut.matchAll(/data-rp="(timeline|emergency)"/g)].map((m) => m[1])).toEqual(["timeline"]);
    expect(chestOut.indexOf('data-kind="ripple"')).toBeLessThan(chestOut.indexOf('data-kind="quote"'));
    expect(chestOut.indexOf('data-kind="quote"')).toBeLessThan(chestOut.indexOf('data-kind="hotlines"'));
    expect((chestOut.match(/href="tel:995"/g) ?? []).length).toBe(1);
  });

  it("the blood pressure page: relayDoctorThreshold gives the doctor's line first, and ThresholdRelayBlock draws the 995 line after it", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const relay = await relayDoctorThreshold(store, s, { systolic: 185, diastolic: 112 });
    expect(relay!.lines.map((l) => l.templateId ?? l.sourceId)).toEqual(["visit:v1:R2", "signal_995_unwell"]);
    const out = renderToStaticMarkup(createElement(ThresholdRelayBlock, { relay: relay!, locale: "zh-Hans" }, createElement("div", { "data-testid": "his-reading" })));
    const doctorAt = out.indexOf('data-testid="relay-doctor"');
    const readingAt = out.indexOf('data-testid="his-reading"');
    const lineAt = out.indexOf('data-testid="relay-template"');
    expect(doctorAt).toBeGreaterThan(-1);
    // the doctor's sentence, his reading on the same line, then Ripple's 995 line with its button (no red card)
    expect(readingAt).toBeGreaterThan(doctorAt);
    expect(lineAt).toBeGreaterThan(readingAt);
    expect(out.indexOf("above 180 on top")).toBeLessThan(out.indexOf(TEMPLATES.signal_995_unwell.zh));
    expect(out).toContain('data-template="signal_995_unwell"');
    expect(out).not.toContain('data-rp="emergency"');
    expect((out.match(/href="tel:995"/g) ?? []).length).toBe(1);
  });

  it("a reading not above the doctor's number, or before he said it: no emergency for the number", async () => {
    expect(classifyRules("今天 150/95", CTX)?.route).not.toBe("emergency");
    expect(classifyRules("今天 180/100", CTX)?.route).not.toBe("emergency");
    const early = await askAt("今天 185/112", { day: 0, time: "08:00" });
    expect(early.res.route).not.toBe("emergency");
  });
});
