/**
 * M5 understanding checklist: four items, 知道 / 不确定. 不确定 adds exactly one question per item (origin
 * understanding_check, his own words, for the doctor); 不确定 again does not duplicate it; 知道 writes nothing;
 * no model scores him; the question shows on his question list.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as understandingGET, POST as understandingPOST } from "@/app/api/understanding/route";
import { questionsView } from "@/lib/daily/questions";
import { itemLabel, itemQuestion } from "@/lib/explain/i18n";
import { UNDERSTANDING_ITEMS, understandingEvidence } from "@/lib/explain/types";
import { answerUnderstanding, understandingView } from "@/lib/explain/understanding";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { newSession } from "../visit/helpers";

interface Published {
  type: string;
  say: string;
  data: unknown;
}

function deps(events: Published[]) {
  return { store: getMemoryStore(), publish: (_sid: string, type: string, say: string, data: unknown) => void events.push({ type, say, data }) };
}

const understandingQuestions = async (s: SessionRow) => (await getMemoryStore().listQuestions(s.id)).filter((q) => q.origin === "understanding_check");

describe("the four items", () => {
  it("are exactly 药物用途 / 没有不适时是否服用 / 服药时间 / 漏服时如何处理 (and their English)", () => {
    expect(UNDERSTANDING_ITEMS.map((i) => itemLabel("zh-Hans", i))).toEqual(["药物用途", "没有不适时是否服用", "服药时间", "漏服时如何处理"]);
    expect(UNDERSTANDING_ITEMS.map((i) => itemLabel("en", i))).toEqual([
      "What this medicine is for",
      "Whether to take it when I feel fine",
      "When to take it",
      "What to do if I miss one",
    ]);
  });
});

describe("不确定 and 知道", () => {
  it("不确定 adds one question per item, in his words, for the doctor; again adds nothing; 知道 writes nothing", async () => {
    const s = await newSession({ story_day: 9 });
    const events: Published[] = [];
    const before = (await getMemoryStore().listQuestions(s.id)).length;

    const know = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "purpose", answer: "know", locale: "zh-Hans" }, deps(events));
    expect(know).toMatchObject({ answer: "know", question: null, created: false });
    expect((await getMemoryStore().listQuestions(s.id)).length).toBe(before);
    expect(events).toEqual([]);

    const first = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "unsure", locale: "zh-Hans" }, deps(events));
    expect(first.created).toBe(true);
    expect(first.question).toMatchObject({
      for: "doctor",
      origin: "understanding_check",
      status: "open",
      text: "Amlodipine：没感觉要不要吃？",
      lang: "zh-Hans",
      created_day: 9,
      evidence: understandingEvidence("med-amlodipine", "feel_fine"),
    });
    expect(events.map((e) => e.type)).toEqual(["question.created"]);
    expect(events[0].say).toContain("not sure");

    // 不确定 again, also from the other language, and 知道 afterwards: still exactly one question for this item
    const again = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "unsure", locale: "zh-Hans" }, deps(events));
    expect(again).toMatchObject({ created: false, question: { id: first.question!.id } });
    await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "unsure", locale: "en" }, deps(events));
    const thenKnow = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "feel_fine", answer: "know", locale: "zh-Hans" }, deps(events));
    expect(thenKnow.question?.id).toBe(first.question!.id); // his question stays his
    expect(await understandingQuestions(s)).toHaveLength(1);
    expect(events).toHaveLength(1);

    // each item has its own question
    for (const item of UNDERSTANDING_ITEMS) await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item, answer: "unsure", locale: "en" }, deps(events));
    const qs = await understandingQuestions(s);
    expect(qs).toHaveLength(4);
    expect(new Set(qs.map((q) => q.evidence)).size).toBe(4);
    expect(qs.find((q) => q.evidence === understandingEvidence("med-amlodipine", "missed"))!.text).toBe(itemQuestion("en", "missed", "Amlodipine"));
    expect((await getMemoryStore().listQuestions(s.id)).length).toBe(before + 4);

    const view = await understandingView(getMemoryStore(), s.id, "med-amlodipine");
    expect(view.items.map((i) => i.id)).toEqual([...UNDERSTANDING_ITEMS]);
    expect(view.items.every((i) => i.questionId && i.questionStatus === "open")).toBe(true);
  });

  it("the question is on his question list (/p/questions) as his own words, from that story day", async () => {
    const s = await newSession({ story_day: 9 });
    const out = await answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "when", answer: "unsure", locale: "zh-Hans" }, deps([]));
    const list = await questionsView(getMemoryStore(), s, "zh-Hans");
    const shown = list.doctor.find((q) => q.id === out.question!.id)!;
    expect(shown).toMatchObject({ origin: "understanding_check", text: "Amlodipine：什么时候吃？", status: "open" });
    const store = getMemoryStore();
    await store.setStoryDay(s.id, 8, null);
    const yesterday = await questionsView(store, (await store.getSession(s.id))!, "zh-Hans");
    expect(yesterday.doctor.some((q) => q.id === out.question!.id)).toBe(false);
  });

  it("before D8 there is no checklist to answer (409 not_yet); no model is involved anywhere", async () => {
    const s = await newSession({ story_day: 7 });
    await expect(answerUnderstanding({ sessionId: s.id, medId: "med-amlodipine", item: "purpose", answer: "unsure", locale: "zh-Hans" }, deps([]))).rejects.toMatchObject({ code: "not_yet" });
    expect(await understandingQuestions(s)).toHaveLength(0);
  });
});

describe("/api/understanding", () => {
  const post = (sid: string, body: unknown) =>
    new NextRequest(`http://localhost/api/understanding?session=${sid}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST answers, GET reports; 400 for a fifth item or a score, 404 unknown medicine, 409 before D8", async () => {
    const s = await newSession({ story_day: 29 });
    const res = await understandingPOST(post(s.id, { med_id: "med-amlodipine", item: "missed", answer: "unsure", locale: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ item: "missed", answer: "unsure", created: true, question: { origin: "understanding_check", text: "Amlodipine: what do I do if I miss one?" } });
    const again = await understandingPOST(post(s.id, { med_id: "med-amlodipine", item: "missed", answer: "unsure", locale: "en" }));
    expect(await again.json()).toMatchObject({ created: false, question: { id: body.question.id } });

    const got = await understandingGET(new NextRequest(`http://localhost/api/understanding?session=${s.id}&med_id=med-amlodipine`));
    const view = (await got.json()).view;
    expect(view.items.find((i: { id: string }) => i.id === "missed").questionId).toBe(body.question.id);
    expect(view.items.find((i: { id: string }) => i.id === "purpose").questionId).toBeNull();

    expect((await understandingPOST(post(s.id, { med_id: "med-amlodipine", item: "dose", answer: "unsure" }))).status).toBe(400);
    expect((await understandingPOST(post(s.id, { med_id: "med-amlodipine", item: "purpose", answer: "unsure", score: 3 }))).status).toBe(400);
    expect((await understandingPOST(post(s.id, { med_id: "med-amlodipine", item: "purpose", answer: "right" }))).status).toBe(400);
    expect((await understandingPOST(post(s.id, { med_id: "med-nope", item: "purpose", answer: "unsure" }))).status).toBe(404);
    const early = await newSession({ story_day: 7 });
    const r = await understandingPOST(post(early.id, { med_id: "med-amlodipine", item: "purpose", answer: "unsure" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("not_yet");
  });
});
