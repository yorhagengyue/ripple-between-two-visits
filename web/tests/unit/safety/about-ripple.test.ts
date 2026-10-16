/**
 * 10-14, the coordinator's follow-up to the never-cross fault (unknown-name-asked.test.ts). On a fresh example account (memory
 * store, the offline composer) "What is Ripple for?", 「你能做什么？」, 「这个app是做什么的？」, 「验血是做什么的？」 and 「血压计是做什么的？」
 * went to explain by rule with no medicine named, and the pipeline answered them from his prescriptions: amlodipine's leaflet
 * line. Now:
 *   - a question about Ripple itself gets the fixed about_ripple sentence (classify.ts rule:about_ripple, route logistics): no
 *     model call, no crisis screen, no question on any list; never a question that names a medicine or a symptom;
 *   - what X is for, X plainly none of his medicines (classify.ts noMedicineSubject, rule:not_a_medicine), is not answered
 *     from his prescriptions; with no explicit subject or a subject that points at his medicine the answer is what it was.
 * Owner 10-15 (the rules were too rigid): such a question now gets Ripple's own answer (general.ts; offline the mock's one
 * canned answer), route explain, and nothing on his list unless he taps the offer; without his consent to AI processing it
 * is what it was (not sure, the question for his doctor). The about_ripple sentence says Ripple answers everyday questions.
 */
import { describe, expect, it } from "vitest";
import { getKb } from "@/lib/kb/load";
import { createMockLlm } from "@/lib/llm";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { buildCandidates } from "@/lib/safety/candidates";
import { classifyRules, noMedicineSubject, type ClassifyContext } from "@/lib/safety/classify";
import { ask, matchAnswered } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { QuestionRow, Store } from "@/lib/store/types";

const ABOUT_EN =
  "I'm Ripple. I keep your doctor's own words from your visits, show you what your medicine labels and leaflets say, answer everyday health questions in plain words, and write down the questions to ask your doctor or pharmacist. I never change your medicines, and I don't replace your doctor.";
const ABOUT_ZH = "我是 Ripple：我帮你记下就诊时医生说的原话，把药品标签和单张上写的告诉你，用平常话回答一般的健康问题，也帮你记下要问医生或药剂师的问题。我不会替你改药，也不能代替医生。";
const AMLODIPINE_PURPOSE = "hh-amlodipine:amlodipine.purpose";
const LEAFLETS = new Set(getKb().patientText.map((e) => `${e.source_id}:${e.id}`));

/** A live-looking model that counts its calls (the crisis screen answers none, anything else is empty). */
function countingModel(): LlmClient & { calls: number } {
  const m = {
    provider: "fake-live",
    model: "fake",
    calls: 0,
    async chat(opts: ChatOpts) {
      m.calls++;
      const task = (JSON.parse(opts.user) as { task: string }).task;
      return { content: task === "crisis" ? '{"crisis":"none"}' : '{"sentences":[]}', tokens: 1 };
    },
  };
  return m;
}

/** One question on a fresh example account on Day 30, and the questions it added to his list. */
async function askOn(
  text: string,
  opts: { llm?: LlmClient; aiAllowed?: boolean; setup?: (store: Store, sessionId: string) => Promise<void> } = {},
): Promise<{ res: AskResult; added: QuestionRow[] }> {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
  if (opts.setup) await opts.setup(store, s.id);
  const before = new Set((await store.listQuestions(s.id)).map((q) => q.id));
  const res = await ask(
    { sessionId: s.id, text, role: "patient" },
    { store, llm: opts.llm ?? createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null, aiAllowed: opts.aiAllowed },
  );
  const added = (await store.listQuestions(s.id)).filter((q) => !before.has(q.id));
  await store.deleteSession(s.id);
  return { res, added };
}

describe("a question about Ripple itself: the fixed about_ripple sentence (classify.ts rule:about_ripple)", () => {
  it("the sentence is the coordinator's, word for word, in both languages", () => {
    expect(TEMPLATES.about_ripple.en).toBe(ABOUT_EN);
    expect(TEMPLATES.about_ripple.zh).toBe(ABOUT_ZH);
  });

  it.each([
    "What is Ripple for?",
    "What is Ripple?",
    "What can you do?",
    "What are you?",
    "Who are you?",
    "What does this app do?",
    "What is this app for?",
    "How can you help me?",
    "Tell me about yourself",
    "你能做什么？",
    "这个app是做什么的？",
    "Ripple是什么？",
    "Ripple是做什么的？",
    "你是谁？",
    "这个应用有什么用？",
    "您能帮我做什么？",
    "介绍一下你自己",
  ])("%s: logistics, the fixed sentence alone, no model call, nothing on his list", async (text) => {
    const model = countingModel();
    const { res, added } = await askOn(text, { llm: model });
    expect(res.route).toBe("logistics");
    expect(res.routeReason).toBe("rule:about_ripple");
    expect(res.sentences.map((s) => s.templateId)).toEqual(["about_ripple"]);
    expect(renderText(res, "en")).toBe(ABOUT_EN);
    expect(renderText(res, "zh-Hans")).toBe(ABOUT_ZH);
    // no model call: no crisis screen, no generation
    expect(model.calls).toBe(0);
    expect(res.llm.calls).toBe(0);
    expect(res.addedQuestionId).toBeUndefined();
    expect(added).toEqual([]);
  });

  it("without his consent to AI processing the sentence is the same, with nothing said about consent", async () => {
    const { res } = await askOn("What can you do?", { aiAllowed: false });
    expect(res.sentences.map((s) => s.templateId)).toEqual(["about_ripple"]);
    expect(res.noAiConsent).toBeUndefined();
  });

  it("a question that names a medicine stays what it was: 「你能告诉我氨氯地平是做什么的吗？」 is an explain about amlodipine", async () => {
    const { res } = await askOn("你能告诉我氨氯地平是做什么的吗？");
    expect(res.route).toBe("explain");
    expect(res.sentences.map((s) => s.sourceId)).toContain(AMLODIPINE_PURPOSE);
  });

  it.each(["你能做什么？我的药是做什么的？", "你是谁？我今天头晕", "Who are you? Can I take two tablets tonight?", "你是什么意思？", "你能做什么检查？"])(
    "%s: not a question about Ripple alone (a medicine, a symptom, a dose, or not about Ripple)",
    (text) => {
      expect(classifyRules(text, { doctorThresholdSystolic: 180, meds: [] })?.reason).not.toBe("rule:about_ripple");
    },
  );
});

describe("what X is for, X plainly none of his medicines: no sources, Ripple's own answer (classify.ts rule:not_a_medicine)", () => {
  it.each([
    "验血是做什么的？",
    "血压计是做什么的？",
    "就诊是做什么的？",
    "记录是做什么的？",
    "问题单是做什么的？",
    "心电图是做什么的？",
    "量血压有什么用？",
    "血压计用来做什么？",
    "What is the blood test for?",
    "What is HealthHub for?",
  ])("%s: Ripple's own answer (offline: the canned one), nothing from his medicines, nothing added to his list", async (text) => {
    const { res, added } = await askOn(text);
    expect(res.route).toBe("explain");
    expect(res.routeChangedFrom).toBe("uncertain");
    expect(res.routeReason).toBe("rule:not_a_medicine");
    // "I won't guess" is gone: Ripple's own answer stands in its place, offered to his list, not added
    expect(res.sentences.map((s) => s.templateId)).toEqual([]);
    expect(res.gloss).toMatchObject({ kind: "general", offer: "doctor" });
    for (const s of res.sentences) {
      expect(LEAFLETS.has(s.sourceId), s.sourceId).toBe(false);
      expect(s.sourceId.startsWith("label:") || s.sourceId.startsWith("visit:"), s.sourceId).toBe(false);
    }
    expect(res.addedQuestionId).toBeUndefined();
    expect(added).toEqual([]);
  });

  it("without his consent to AI processing it is what it was: not sure, and the question for his doctor", async () => {
    const { res, added } = await askOn("验血是做什么的？", { aiAllowed: false });
    expect(res.route).toBe("uncertain");
    expect(res.routeReason).toBe("rule:not_a_medicine");
    expect(res.sentences.map((s) => s.templateId)).toEqual(["no_ai_consent"]);
    expect(res.gloss).toBeUndefined();
    expect(added.map((q) => [q.for, q.origin, q.text])).toEqual([["doctor", "refused_question", "验血是做什么的？"]]);
  });

  it.each([
    ["这个是做什么的？", AMLODIPINE_PURPOSE],
    ["这个药是做什么的？", AMLODIPINE_PURPOSE],
    ["早上那粒是做什么的？", AMLODIPINE_PURPOSE],
    ["What is this pill for?", AMLODIPINE_PURPOSE],
    ["What is it for?", AMLODIPINE_PURPOSE],
    // his medicine described, not named: a counter, his BP medicine, what the doctor gave him
    ["小白片是做什么的？", AMLODIPINE_PURPOSE],
    ["降压的是做什么的？", AMLODIPINE_PURPOSE],
    ["医生开的是做什么的？", AMLODIPINE_PURPOSE],
    // a misspelt name of his own medicine (unknown-name-asked.test.ts) stays his
    ["What is Amlodipin for?", AMLODIPINE_PURPOSE],
    // no explicit subject: the doctor's "why take it" line (R3)
    ["我感觉很好，为什么还要吃？", "visit:v2:R3"],
  ])("%s: as before (explain, %s)", async (text, source) => {
    const { res } = await askOn(text);
    expect(res.route).toBe("explain");
    expect(res.routeReason).toBe("rule:explain");
    expect(res.sentences.map((s) => s.sourceId)).toContain(source);
  });

  it("noMedicineSubject names the subject only when it is plainly none of his medicines", () => {
    const ctx: Pick<ClassifyContext, "meds"> = { meds: [] };
    expect(noMedicineSubject("验血是做什么的？", ctx)).toBe("验血");
    expect(noMedicineSubject("我今天吃了降压药，血压计是做什么的？", ctx)).toBe("血压计");
    expect(noMedicineSubject("What is the blood test for?", ctx)).toBe("the blood test");
    for (const text of [
      "这个是做什么的？",
      "它有什么用？",
      "那粒是做什么的？",
      "白色的东西是做什么的？",
      "氨氯地平是做什么的？",
      "What are these for?",
      "What is the white thing for?",
      "What are Concor tablets for?",
      "我感觉很好，为什么还要吃？",
      "是做什么的？",
    ]) {
      expect(noMedicineSubject(text, ctx), text).toBeNull();
    }
  });

  it("never \"answered before\" with the doctor's answer about his tablet (matchAnswered would take it: it compares his prescriptions)", async () => {
    // his own 「这个药是做什么的？」, answered by his doctor at the D9 visit
    const answered = async (store: Store, sid: string) => {
      const q = await store.addQuestion(sid, { for: "doctor", origin: "own", text: "这个药是做什么的？", created_day: 9 });
      await store.updateQuestion(sid, q.id, { status: "answered", answer_text: "It keeps your blood pressure down.", answer_visit_id: "v2", answer_speaker: "doctor" });
    };
    // the setup works: asked again, his own question is answered before
    const again = await askOn("这个药是做什么的？", { setup: answered });
    expect(again.res.answeredBefore?.by).toBe("doctor");
    // matchAnswered alone would lead 「验血是做什么的？」 with that answer
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    await answered(store, s.id);
    const set = await buildCandidates(store, s.id, { day: 30, route: "uncertain", topics: [] });
    const meds = await store.listMeds(s.id);
    expect(matchAnswered("验血是做什么的？", { route: "uncertain", topics: [], drugs: [], injection: false }, set.answered, set.byId, { meds })?.question.text).toBe("这个药是做什么的？");
    await store.deleteSession(s.id);
    // the pipeline does not: Ripple's own answer, never his doctor's words about his tablet
    const { res } = await askOn("验血是做什么的？", { setup: answered });
    expect(res.route).toBe("explain");
    expect(res.answeredBefore).toBeUndefined();
    expect(res.sentences.map((x) => x.templateId)).toEqual([]);
    expect(res.gloss?.kind).toBe("general");
  });
});
