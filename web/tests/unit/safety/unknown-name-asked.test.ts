/**
 * 10-14, the never-cross fault: on a fresh example account (memory store, the offline composer) 「阿司匹灵宝是做什么的？」 and
 * 「Aspiringbao是做什么的？」 went to explain by rule and were answered with amlodipine's leaflet line 「氨氯地平用来降血压，它让
 * 血管放松、变宽。」. No rule knew the name, so the question was an explain about no medicine, and the pipeline answers that from
 * his prescriptions. A question about one medicine is never answered with another medicine's lines: a question to explain (or
 * a bare "what is X") whose words hold a name that looks like a medicine Ripple knows and is not one of them now gets the
 * unknown-medicine answer (classify.ts unknownNameAsked: route unknown_med, rule:unknown_name, the fixed sentence, his words
 * on the list for the pharmacist), as unknown names already do elsewhere. His medicines in ordinary words, and the KB names,
 * are answered as before.
 */
import { describe, expect, it } from "vitest";
import { getKb } from "@/lib/kb/load";
import { createMockLlm } from "@/lib/llm";
import type { StoredLabel } from "@/lib/meds/types";
import { classifyRules, unknownNameAsked, type ClassifyContext } from "@/lib/safety/classify";
import { ask } from "@/lib/safety/pipeline";
import { allOutputText, renderText } from "@/lib/safety/render";
import { TEMPLATES, UNKNOWN_MED_SENTENCE } from "@/lib/safety/templates";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { QuestionRow, Store } from "@/lib/store/types";

const AMLODIPINE_PURPOSE = "hh-amlodipine:amlodipine.purpose";
const AMLODIPINE_PURPOSE_ZH = "氨氯地平用来降血压，它让血管放松、变宽。";

/** Every leaflet line of the KB (patient_text.json) by its source id, with the medicine it is about. */
const LEAFLET_DRUG = new Map(getKb().patientText.map((e) => [`${e.source_id}:${e.id}`, e.drug]));

interface Asked {
  res: AskResult;
  /** the questions this ask added to his list */
  added: QuestionRow[];
  /** the signals of the ask.route event */
  signals: string[];
}

/** One question on a fresh example account on Day 30 (Mr Tan takes amlodipine; losartan is not his yet). */
async function askOn(text: string, setup?: (store: Store, sessionId: string) => Promise<void>): Promise<Asked> {
  const store = getMemoryStore();
  const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
  if (setup) await setup(store, s.id);
  const before = new Set((await store.listQuestions(s.id)).map((q) => q.id));
  let signals: string[] = [];
  const publish = (_sid: string, type: string, _say: string, data: unknown) => {
    if (type === "ask.route") signals = (data as { signals: string[] }).signals;
  };
  const res = await ask({ sessionId: s.id, text, role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish, costGuard: null });
  const added = (await store.listQuestions(s.id)).filter((q) => !before.has(q.id));
  await store.deleteSession(s.id);
  return { res, added, signals };
}

/** The unknown-medicine answer, word for word, and nothing from any medicine's leaflet or label. */
function expectUnknownMedicine({ res, added, signals }: Asked, text: string, name: string) {
  expect(res.route, text).toBe("unknown_med");
  expect(res.routeReason, text).toBe("rule:unknown_name");
  expect(res.fixedText, text).toBe(UNKNOWN_MED_SENTENCE);
  expect(res.sentences.map((s) => s.en), text).toEqual([UNKNOWN_MED_SENTENCE]);
  expect(res.sentences.map((s) => s.templateId), text).toEqual(["unknown_med"]);
  expect(renderText(res, "en"), text).toBe(UNKNOWN_MED_SENTENCE);
  expect(renderText(res, "zh-Hans"), text).toBe(`${UNKNOWN_MED_SENTENCE}\n${TEMPLATES.unknown_med.zh}`);
  // no sentence quotes a leaflet (or a label) of any medicine
  for (const s of res.sentences) {
    expect(LEAFLET_DRUG.has(s.sourceId), `${text}: ${s.sourceId}`).toBe(false);
    expect(s.sourceId.startsWith("label:"), `${text}: ${s.sourceId}`).toBe(false);
  }
  const out = allOutputText(res);
  expect(out, text).not.toContain(AMLODIPINE_PURPOSE_ZH);
  expect(out.toLowerCase(), text).not.toContain("amlodipine");
  // his words go on the list for the pharmacist, as for any medicine nobody can identify
  expect(added.map((q) => [q.for, q.origin, q.text]), text).toEqual([["pharmacist", "unidentified_medicine", text]]);
  expect(signals, text).toEqual([`unknown_name:${name}`]);
}

describe("a medicine name Ripple does not know, asked to explain: the unknown-medicine answer (classify.ts unknownNameAsked)", () => {
  it.each([
    ["阿司匹灵宝是做什么的？", "阿司匹灵宝"],
    ["Aspiringbao是做什么的？", "Aspiringbao"],
  ])("the fault: %s", async (text, name) => {
    expectUnknownMedicine(await askOn(text), text, name);
  });

  it.each([
    // the same name in the other shapes of the question (X 是什么药 / X 有什么用 / what is X for / what is X)
    ["阿司匹灵宝是什么药？", "阿司匹灵宝"],
    ["阿司匹灵宝有什么用？", "阿司匹灵宝"],
    ["阿司匹灵宝是什么？", "阿司匹灵宝"],
    ["What is Aspiringbao for?", "Aspiringbao"],
    ["What is Aspiringbao?", "Aspiringbao"],
    ["Aspiringbao for what ah?", "Aspiringbao"],
    // the same fault under the other topics an explain answers (amlodipine's side effects, its leaflet's food line and label)
    ["阿司匹灵宝有什么副作用？", "阿司匹灵宝"],
    ["阿司匹灵宝饭前吃还是饭后吃？", "阿司匹灵宝"],
    // a misspelt KB medicine he does not take (the KB matcher reaches it only by edit distance), one character away from a KB
    // Chinese name, and another medicine of a KB medicine's class
    ["What is Asprin for?", "Asprin"],
    ["布络芬是做什么的？", "布络芬"],
    // (a slip of the pinyin keyboard onto a word of asking: 不 for 布)
    ["不洛芬是做什么的？", "不洛芬"],
    ["硝苯地平是做什么的？", "硝苯地平"],
  ])("%s", async (text, name) => {
    expectUnknownMedicine(await askOn(text), text, name);
  });

  it("the name on one of his medicines nobody identified (the relative's box, once its label reads 宁和平压丸)", async () => {
    const text = "宁和平压丸是做什么的？";
    const named = async (store: Store, sid: string) => {
      const box = (await store.listMeds(sid)).find((m) => m.id === "med-relative-box");
      expect(box?.drug_id).toBeNull();
      const label: StoredLabel = { ...(box!.label ?? { text: "" }), drug_text: "宁和平压丸" };
      await store.updateMed(sid, box!.id, { label });
    };
    expectUnknownMedicine(await askOn(text, named), text, "宁和平压丸");
  });

  it("asked with a combination it stays the combination referral (rule:combination, the pharmacist)", async () => {
    const text = "阿司匹灵宝可以和我的药一起吃吗？";
    const { res, added } = await askOn(text);
    expect(res.route).toBe("refuse_route");
    expect(res.routeReason).toBe("rule:combination");
    expect(res.sentences.map((s) => s.templateId)).toContain("refer_pharmacist");
    expect(added.map((q) => [q.for, q.text])).toEqual([["pharmacist", text]]);
  });
});

describe("his medicines in ordinary words and the KB's names are answered as before", () => {
  it.each(["这个药是做什么的？", "我的药是做什么的？", "早上那粒是做什么的？", "降压药是做什么的？", "氨氯地平是做什么的？", "What is amlodipine for?"])(
    "%s: explain, from amlodipine's own leaflet line",
    async (text) => {
      const { res } = await askOn(text);
      expect(res.route).toBe("explain");
      expect(res.routeReason).toBe("rule:explain");
      expect(res.sentences.map((s) => s.sourceId)).toContain(AMLODIPINE_PURPOSE);
      for (const s of res.sentences) if (LEAFLET_DRUG.has(s.sourceId)) expect(LEAFLET_DRUG.get(s.sourceId), s.sourceId).toBe("amlodipine");
    },
  );

  it.each(["阿司匹林是做什么的？", "What is aspirin for?"])(
    "%s (a KB medicine he does not take): its own leaflet line or a referral, never amlodipine's",
    async (text) => {
      const { res, added } = await askOn(text);
      expect(["explain", "uncertain"]).toContain(res.route);
      expect(res.routeReason).toBe("rule:explain");
      const leaflets = res.sentences.filter((s) => LEAFLET_DRUG.has(s.sourceId));
      for (const s of leaflets) expect(LEAFLET_DRUG.get(s.sourceId), s.sourceId).toBe("aspirin");
      expect(allOutputText(res)).not.toContain(AMLODIPINE_PURPOSE_ZH);
      // (the KB has no aspirin leaflet line today: owner 10-15, Ripple's own answer, offline the canned one, and nothing
      // added to his list)
      if (leaflets.length === 0) {
        expect(res.gloss?.kind).toBe("general");
        expect(res.sentences.map((s) => s.templateId)).not.toContain("uncertain_no_source");
        expect(added).toHaveLength(0);
      }
    },
  );
});

describe("left as they were (unknownNameAsked finds no name in them)", () => {
  const ctx: ClassifyContext = { doctorThresholdSystolic: 180, meds: [] };
  it.each([
    // his medicines in ordinary words, with everyday words close to a KB brand name (芬必得, 络活喜) or a class ending (地平)
    "这个药我必得每天吃吗？",
    "这个药想必得吃很久吧？",
    "我平时生活喜欢喝茶，这个药有什么副作用？",
    "这个药吃了心地平和吗？",
    "我感觉很好，为什么还要吃？",
    "这个白色的小药是做什么的？",
    "What is the medicine for?",
    // a KB name said exactly, inside a longer product name
    "阿司匹林肠溶片是做什么的？",
    // a name like no KB medicine, and subjects that are no medicine: not this fault's (their answers did not change)
    "立普妥是做什么的？",
    "What is Concor for?",
    "验血是做什么的？",
    "就诊是做什么的？",
    "What is Ripple for?",
  ])("%s", (text) => {
    expect(unknownNameAsked(text, ctx), text).toBeNull();
    expect(classifyRules(text, ctx)?.route, text).not.toBe("unknown_med");
  });

  it("a misspelt name of one of his own medicines stays his (as unknownDrugName reads it), not with a low-confidence transcript", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 30, ttl_hours: 1 });
    const meds = await store.listMeds(s.id);
    await store.deleteSession(s.id);
    expect(meds.some((m) => m.drug_id === "amlodipine")).toBe(true);
    expect(unknownNameAsked("What is Amlodipin for?", { meds })).toBeNull();
    expect(classifyRules("What is Amlodipin for?", { doctorThresholdSystolic: 180, meds })?.route).toBe("explain");
    expect(unknownNameAsked("What is Amlodipin for?", { meds, asrLowConfidence: true })).toBe("Amlodipin");
  });

  it("fish oil is a known supplement: still the combination rule's (rule:combination)", () => {
    expect(classifyRules("鱼油是做什么的？", ctx)).toMatchObject({ route: "refuse_route", reason: "rule:combination" });
  });

  it("a statement with such a name is still a note (log_only)", () => {
    expect(classifyRules("我今天买了阿司匹灵宝", ctx)?.route).toBe("log_only");
    expect(classifyRules("I bought some Aspiringbao today.", ctx)?.route).toBe("log_only");
  });
});
