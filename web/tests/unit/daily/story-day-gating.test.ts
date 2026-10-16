/**
 * Story-day gating (literal requirement): the seed is the story's end state, so questions and answers recorded
 * after session.story_day are not shown: not on the question list, not as a source in /api/ask. Tested at D12 and
 * D29 (and D10 / D42 around them).
 */
import { describe, expect, it } from "vitest";
import { openQuestionCount, questionsView } from "@/lib/daily/questions";
import { buildCandidates } from "@/lib/safety/candidates";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { sessionAt } from "./helpers";

async function listed(s: SessionRow) {
  const view = await questionsView(getMemoryStore(), s, "zh-Hans");
  return Object.fromEntries([...view.doctor, ...view.pharmacist].map((q) => [q.id, { status: q.status, answer: q.answer?.text ?? null, chip: q.answer?.chip.kind ?? null }]));
}

describe("question list on the story day", () => {
  it("D12: questions from D25, D29, D30 are not there; answers from D0, D8 and the D12 pharmacy visit are", async () => {
    const s = await sessionAt(12);
    const q = await listed(s);
    expect(Object.keys(q).sort()).toEqual(["q-knee-1", "q-machine", "q-relative-box"]);
    expect(q["q-machine"]).toMatchObject({ status: "answered", answer: "手腕的不太准。买一个绑手臂的，upper arm 的。", chip: "doctor" });
    expect(q["q-knee-1"]).toMatchObject({ status: "answered", chip: "doctor" });
    expect(q["q-knee-1"].answer).toContain("Which one? Bring it next time and show me.");
    expect(q["q-relative-box"]).toMatchObject({ status: "answered", chip: "pharmacist" });
    expect(await openQuestionCount(getMemoryStore(), s)).toBe(0);
  });

  it("D10: the pharmacy visit (D12) has not happened, so its answer is not shown and the question is still open", async () => {
    const s = await sessionAt(10);
    const q = await listed(s);
    expect(q["q-relative-box"]).toEqual({ status: "open", answer: null, chip: null });
    expect(await openQuestionCount(getMemoryStore(), s)).toBe(1);
  });

  it("the relative's box question (no day in the seed, answered at the D12 pharmacy) appears at the D8 visit, not before", async () => {
    for (const day of [0, 1, 3, 5, 7]) {
      const s = await sessionAt(day);
      expect(Object.keys(await listed(s)), `D${day}`).not.toContain("q-relative-box");
      expect(await openQuestionCount(getMemoryStore(), s), `D${day}`).toBe(0);
      expect((await questionsView(getMemoryStore(), s, "en")).pharmacist.map((q) => q.id), `D${day}`).toEqual([]);
    }
    const d8 = await sessionAt(8);
    expect((await listed(d8))["q-relative-box"]).toEqual({ status: "open", answer: null, chip: null });
    expect(await openQuestionCount(getMemoryStore(), d8)).toBe(1);
    const view = await questionsView(getMemoryStore(), d8, "zh-Hans");
    expect(view.pharmacist.find((q) => q.id === "q-relative-box")?.createdDay).toBe(8);
    const d12 = await sessionAt(12);
    expect((await listed(d12))["q-relative-box"]).toMatchObject({ status: "answered", chip: "pharmacist" });
  });

  it("D29: q-tai-chi (D25) and q-extra-tablet (D29) are there, q-knee-2 (D30) is not", async () => {
    const s = await sessionAt(29);
    const q = await listed(s);
    expect(Object.keys(q).sort()).toEqual(["q-extra-tablet", "q-knee-1", "q-machine", "q-relative-box", "q-tai-chi"]);
    expect(q["q-extra-tablet"].status).toBe("open");
    expect(await openQuestionCount(getMemoryStore(), s)).toBe(2);
  });

  it("an answer recorded at a later visit (D42) is not shown on D29, and is on D42", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(29);
    const answer = "可以，回来再吃，每天差不多同一个时间就好。Same time every day.";
    await store.updateQuestion(s.id, "q-tai-chi", { status: "answered", answer_text: answer, answer_visit_id: "v3", answer_speaker: "doctor" });
    expect((await listed(s))["q-tai-chi"]).toEqual({ status: "open", answer: null, chip: null });
    // and it is not a source for /api/ask on D29
    const d29 = await buildCandidates(store, s.id, { day: 29, route: "explain", topics: [] });
    expect(d29.list.some((c) => c.span === answer)).toBe(false);
    await store.setStoryDay(s.id, 42);
    const at42 = (await store.getSession(s.id))!;
    expect((await listed(at42))["q-tai-chi"]).toMatchObject({ status: "answered", answer, chip: "doctor" });
    const d42 = await buildCandidates(store, s.id, { day: 42, route: "explain", topics: [] });
    expect(d42.list.some((c) => c.span === answer)).toBe(true);
  });

  it("/api/ask's sources follow the same rule at D12 and D29: the pharmacist's D12 answer only from D12", async () => {
    const store = getMemoryStore();
    const pharmacist = "The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit.";
    for (const [day, present] of [[10, false], [12, true], [29, true]] as const) {
      const s = await sessionAt(day);
      const set = await buildCandidates(store, s.id, { day, route: "explain", topics: [] });
      expect(set.list.some((c) => c.span === pharmacist), `D${day}`).toBe(present);
      // nothing from a visit after the story day
      expect(set.list.every((c) => c.kind !== "visit" || (c.cite?.day ?? 0) <= day), `D${day}`).toBe(true);
    }
  });

  it("questions he adds today carry today's day and show today, not before", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(29);
    await store.addQuestion(s.id, { id: "q-new", for: "doctor", origin: "own", text: "测试的问题", created_day: 29 });
    expect(Object.keys(await listed(s))).toContain("q-new");
    await store.setStoryDay(s.id, 28);
    expect(Object.keys(await listed((await store.getSession(s.id))!))).not.toContain("q-new");
  });
});
