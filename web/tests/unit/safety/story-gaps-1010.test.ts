/**
 * 10-10, the last story and chain gaps in lib/safety (docs/plan/e2e-chains.md 5.8, 7.5, 3.9, 6.4):
 *
 *   7.5  the story moment: on a visit's own day the visit counts once it has happened (line-state.ts visitHappened):
 *        D0 08:00, before the 09:30 visit nobody replayed, the emergency answer has the 995 template and no R2; with no
 *        clock time (the whole day), after the replay reached R2, and from D1 it has R2. A recorded answer the seed
 *        carries for a visit this session is replaying is a source only once its line is in the record.
 *   5.8  the seed answers q-extra-tablet at the D42 visit (Dr Lim's v3-u19, word for word): on D29 the hero question
 *        still reuses it and the backstage event carries no answer; after the v3 replay and his confirmation it is
 *        answered with the doctor's words and the time point of v3-u19.
 *   3.9  「验血要空腹吗？」 is about the test: no food topic, no label or "with or without food" leaflet line among its
 *        sources; at D43 after v3 it quotes Dr Lim's D42 answer (No need to fast for this one ...).
 *   6.4  the same unidentified medicine typed twice the same day keeps one question for the pharmacist.
 */
import { describe, expect, it } from "vitest";
import { questionsView } from "@/lib/daily/questions";
import { createMockLlm } from "@/lib/llm";
import { loadConfirmedTranscripts } from "@/scripts/eval";
import { asksAboutTestOnly, buildCandidates, statesWarningLine } from "@/lib/safety/candidates";
import { visitHappened } from "@/lib/safety/line-state";
import { ask, sameUnknownMedicineQuestion, waitingAt } from "@/lib/safety/pipeline";
import { detectTopics } from "@/lib/safety/topics";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { QuestionRow, SessionRow } from "@/lib/store/types";
import { fixtureUtterances } from "@/lib/asr";
import { confirmVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import { finalizeReplay, replayLive } from "../visit/helpers";

const HERO = "今天 150/95，我能不能多吃一粒？";
const D42_ANSWER =
  "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.";
const FAST_ANSWER = "No need to fast for this one. Just take your medicine as usual and come in.";
const CHEST = "我胸口好痛，左手没力";

interface Seen {
  result: AskResult;
  events: { type: string; say: string; data: unknown }[];
}

async function askAt(session: SessionRow, text: string, extra: { medIds?: string[] } = {}): Promise<Seen> {
  const store = getMemoryStore();
  const events: Seen["events"] = [];
  const result = await ask(
    { sessionId: session.id, text, role: "patient", ...extra },
    { store, llm: createMockLlm(), checker: null, checkerReason: "no checker in unit tests", publish: (_s, type, say, data) => events.push({ type, say, data }), costGuard: null },
  );
  return { result, events };
}

async function sessionAt(day: number, time: string | null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

/** The v3 replay through the visit pipeline, the whole-visit pass, and his confirmation of every answer. */
async function replayAndConfirmV3(s: SessionRow) {
  await replayLive(s, "v3");
  const view = await finalizeReplay(s, "v3");
  const items: Record<string, "right"> = {};
  for (const q of view.qlist?.items ?? []) if (q.answer?.itemId) items[q.answer.itemId] = "right";
  return confirmVisit(getMemoryStore(), s, "v3", { mine: view.lines.filter((l) => l.role === "patient").map((l) => l.id), items });
}

describe("7.5: a visit counts once it has happened by the story day and time", () => {
  it("visitHappened: before / after the day; on the day with a record, while recording, or with no clock time", () => {
    const v = { day: 0, status: "confirmed" as const };
    expect(visitHappened(v, { day: 1, time: "08:00" }, false)).toBe(true);
    expect(visitHappened({ ...v, day: 2 }, { day: 1, time: null }, true)).toBe(false);
    expect(visitHappened(v, { day: 0, time: "08:00" }, false)).toBe(false);
    expect(visitHappened(v, { day: 0, time: "08:00" }, true)).toBe(true);
    expect(visitHappened({ ...v, status: "recording" }, { day: 0, time: "09:30" }, false)).toBe(true);
    expect(visitHappened(v, { day: 0, time: null }, false)).toBe(true);
  });

  it("D0 08:00 (the 09:30 visit not replayed): 995 and no R2; no clock time, the replay past R2, and D1: R2", async () => {
    const early = await askAt(await sessionAt(0, "08:00"), CHEST);
    expect(early.result.route).toBe("emergency");
    expect(early.result.sentences.map((x) => x.sourceId)).toEqual(["referral:B1-03"]);
    for (const [day, time] of [[0, null], [1, "08:00"]] as const) {
      const r = await askAt(await sessionAt(day, time), CHEST);
      expect(r.result.sentences.map((x) => x.sourceId), `D${day} ${time}`).toEqual(["referral:B1-03", "visit:v1:R2"]);
    }
    // D0 09:30, the replay of v1 running: R2 only once the replay has reached it (v1-u09)
    const s = await sessionAt(0, "09:30");
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v1" });
    for (const u of fixtureUtterances("v1")!) {
      await processChunk(getMemoryStore(), s, "v1", [u]);
      if (u.id === "v1-u08") expect((await askAt(s, CHEST)).result.sentences.map((x) => x.sourceId)).toEqual(["referral:B1-03"]);
    }
    expect((await askAt(s, CHEST)).result.sentences.map((x) => x.sourceId)).toEqual(["referral:B1-03", "visit:v1:R2"]);
  });

  it("the doctor's warning number is not his before it is said: 190/110 on D0 08:00 is not above_doctor_threshold", async () => {
    const r = await askAt(await sessionAt(0, "08:00"), "My reading is 190/110, what should I do?");
    const signals = (r.events.find((e) => e.type === "ask.route")?.data as { signals: string[] }).signals;
    expect(signals).not.toContain("above_doctor_threshold");
    const later = await askAt(await sessionAt(1, "08:00"), "My reading is 190/110, what should I do?");
    expect((later.events.find((e) => e.type === "ask.route")?.data as { signals: string[] }).signals).toContain("above_doctor_threshold");
  });
});

describe("5.8: the seed answers the hero question at the D42 visit; story time keeps it waiting until then", () => {
  it("D29: the hero reuses q-extra-tablet, published as it stands then (open, no answer)", async () => {
    const s = await sessionAt(29, "20:15");
    const before = (await getMemoryStore().listQuestions(s.id)).length;
    const { result, events } = await askAt(s, HERO);
    expect(result).toMatchObject({ route: "refuse_route", addedQuestionId: "q-extra-tablet", questionReused: true });
    expect((await getMemoryStore().listQuestions(s.id)).length).toBe(before);
    const updated = events.filter((e) => e.type === "question.updated");
    expect(updated).toHaveLength(1);
    expect((updated[0].data as { question: QuestionRow }).question).toMatchObject({ id: "q-extra-tablet", status: "open", answer_text: null, answer_visit_id: null });
    expect(JSON.stringify(events)).not.toContain("adding losartan today");
    expect(result.sentences.map((x) => x.sourceId)).toEqual(["visit:v2:R4", "label:med-amlodipine", "tpl:refer_doctor"]);
  });

  it("waitingAt: an answer from a visit that has not happened yet leaves the question open", () => {
    const q = { id: "q", status: "answered", answer_text: "x", answer_visit_id: "v3", answer_utterance_id: null, answer_speaker: "doctor" } as unknown as QuestionRow;
    expect(waitingAt([q], new Set(["v1", "v2"]))).toMatchObject([{ id: "q", status: "open", answer_text: null }]);
    expect(waitingAt([q], new Set(["v1", "v2", "v3"]))).toEqual([]);
  });

  it("not a source before D42, nor at 09:00 before the visit, nor mid-replay before Dr Lim says it; from D43 it is", async () => {
    const store = getMemoryStore();
    const has = async (s: SessionRow) => (await buildCandidates(store, s.id, { day: s.story_day, route: "explain", topics: [] })).list.some((c) => c.span === D42_ANSWER);
    expect(await has(await sessionAt(41, "20:00"))).toBe(false);
    expect(await has(await sessionAt(42, "09:00"))).toBe(false);
    expect(await has(await sessionAt(43, "10:00"))).toBe(true);
    const s = await sessionAt(42, "09:30");
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v3" });
    for (const u of fixtureUtterances("v3")!) {
      await processChunk(getMemoryStore(), s, "v3", [u]);
      if (u.id === "v3-u18") expect(await has(s), "before v3-u19").toBe(false);
    }
    expect(await has(s), "after v3-u19").toBe(true);
  });

  it("Dr Lim's restated warning line (v3-u20) follows R2's rule: not a source for a dose question, only for an emergency", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(43, "10:00");
    await loadConfirmedTranscripts(store, s.id); // every visit's lines confirmed, no items (the eval's setup)
    const U20 = "If it's high, sit down, rest five minutes and measure again, then write it down for me. If it's above 180 on top, or you have chest pain, weakness on one side or slurred speech, call 995.";
    expect(statesWarningLine(U20)).toBe(true);
    expect(statesWarningLine(D42_ANSWER)).toBe(false);
    const dose = await buildCandidates(store, s.id, { day: 43, route: "refuse_route", topics: ["dose_change"] });
    expect(dose.list.some((c) => c.span === U20)).toBe(false);
    expect(dose.list.some((c) => c.span === D42_ANSWER)).toBe(true);
    const emergency = await buildCandidates(store, s.id, { day: 43, route: "emergency", topics: [] });
    expect(emergency.list.some((c) => c.span === U20)).toBe(true);
  });

  it("after the v3 replay and his confirmation: answered with Dr Lim's words, the time point of v3-u19 and its stand-in clip", async () => {
    const s = await sessionAt(42, "09:30");
    await replayAndConfirmV3(s);
    const row = (await getMemoryStore().getQuestion(s.id, "q-extra-tablet"))!;
    expect(row).toMatchObject({ status: "answered", answer_text: D42_ANSWER, answer_utterance_id: "v3-u19", answer_visit_id: "v3", answer_speaker: "doctor" });
    const view = await questionsView(getMemoryStore(), (await getMemoryStore().getSession(s.id))!, "zh-Hans");
    const q = view.doctor.find((x) => x.id === "q-extra-tablet")!;
    expect(q.status).toBe("answered");
    expect(q.answer).toMatchObject({ text: D42_ANSWER, tStartMs: 94772, visitId: "v3", date: "2026-10-05" });
    expect(q.answer!.chip).toMatchObject({ kind: "doctor", inferred: false, standInVoice: true });
    expect(q.answer!.clipUrl).toContain("/api/visits/v3/clip?u=v3-u19");
  });
});

describe("3.9: a blood-test question is about the test", () => {
  it("fasting words alone are not the food topic; a question about the tablets keeps it", () => {
    expect(detectTopics("验血要空腹吗？")).toEqual(["blood_test"]);
    expect(detectTopics("Do I need an empty stomach for the blood test?")).toEqual(["blood_test"]);
    expect(detectTopics("验血那天药要空腹吃吗？")).toContain("food");
    expect(detectTopics("Can I take it on an empty stomach?")).toContain("food");
    expect(asksAboutTestOnly(["blood_test"])).toBe(true);
    expect(asksAboutTestOnly(["blood_test", "food"])).toBe(false);
  });

  it("a test-only ask has no label and only the leaflets' lines about tests among its candidates", async () => {
    const s = await sessionAt(43, "10:00");
    const set = await buildCandidates(getMemoryStore(), s.id, { day: 43, route: "explain", topics: ["blood_test"] });
    expect(set.list.filter((c) => c.kind === "label")).toEqual([]);
    expect(set.list.filter((c) => c.kind === "patient_text").every((c) => c.topics?.includes("blood_test"))).toBe(true);
    const other = await buildCandidates(getMemoryStore(), s.id, { day: 43, route: "explain", topics: ["food"] });
    expect(other.list.some((c) => c.kind === "label")).toBe(true);
  });

  it("D43 after v3: 「验血要空腹吗？」 quotes Dr Lim's D42 answer first, no food line, no new question", async () => {
    const s = await sessionAt(42, "09:30");
    await replayAndConfirmV3(s);
    await getMemoryStore().setStoryDay(s.id, 43, "10:00");
    const before = (await getMemoryStore().listQuestions(s.id)).length;
    const { result } = await askAt((await getMemoryStore().getSession(s.id))!, "验血要空腹吗？");
    expect(result.sentences[0]).toMatchObject({ en: FAST_ANSWER, attribution: "doctor" });
    expect(result.sentences.map((x) => x.sourceId).filter((id) => /food|label:/.test(id))).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect((await getMemoryStore().listQuestions(s.id)).length).toBe(before);
  });
});

describe("6.4: the same unidentified medicine asked again the same day", () => {
  it("the same words keep one question for the pharmacist; other words get their own", async () => {
    const s = await sessionAt(29, "20:15");
    const a = (await askAt(s, "我亲戚给的宁和平压丸是什么药？")).result;
    const b = (await askAt(s, "我亲戚给的宁和平压丸是什么药？")).result;
    expect(a.route).toBe("unknown_med");
    expect(b).toMatchObject({ route: "unknown_med", addedQuestionId: a.addedQuestionId, questionReused: true });
    const c = (await askAt(s, "What is Ningheping pill that my relative gave me?")).result;
    expect(c.addedQuestionId).not.toBe(a.addedQuestionId);
    const mine = (await getMemoryStore().listQuestions(s.id)).filter((q) => q.origin === "unidentified_medicine" && q.created_day === 29);
    expect(mine).toHaveLength(2);
  });

  it("the same unrecognised name in other words reuses it; a different name does not", async () => {
    const s = await sessionAt(29, "20:15");
    const a = (await askAt(s, "What is Xyzoprilane 10mg for?")).result;
    expect(a.route).toBe("unknown_med");
    const b = (await askAt(s, "Can I take Xyzoprilane 10mg with my tablets?")).result;
    expect(b).toMatchObject({ addedQuestionId: a.addedQuestionId, questionReused: true });
    const c = (await askAt(s, "What is Brontozolane 20mg for?")).result;
    expect(c.addedQuestionId).not.toBe(a.addedQuestionId);
  });

  it("sameUnknownMedicineQuestion only reuses an open pharmacist question of the same day", () => {
    const q = (over: Partial<QuestionRow>) => ({ id: "x", status: "open", origin: "unidentified_medicine", for: "pharmacist", created_day: 29, text: "什么药？", ...over }) as QuestionRow;
    const want = { for: "pharmacist" as const, day: 29, text: "什么药？", names: [] };
    expect(sameUnknownMedicineQuestion([q({})], want)?.id).toBe("x");
    expect(sameUnknownMedicineQuestion([q({ created_day: 28 })], want)).toBeNull();
    expect(sameUnknownMedicineQuestion([q({ status: "answered" })], want)).toBeNull();
    expect(sameUnknownMedicineQuestion([q({ origin: "refused_question" })], want)).toBeNull();
  });
});
