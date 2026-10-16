/**
 * C2 track S: the ask on the real app (docs/plan/real-status.md v1, real-app.md 2.10 and 12, the architecture review's open
 * decisions). Each behaviour on the demo story and on accounts:
 *   - a question of his the doctor already answered, asked again: the doctor's answer first, no new question (the
 *     ibuprofen and the extra tablet after the D42 visit, the wrist machine on the example account); one the doctor put off
 *     ("Which one? Bring it next time") leads with his words and keeps the question;
 *   - two medicines together: the doctor's answer never next to "nothing answers this";
 *   - 补吃 is a missed dose (the leaflet's line), taking two to make up is a dose change;
 *   - "what did the doctor say about my BP": the doctor's number (R1), with its date;
 *   - a side effect: the doctor's line about the same symptom, and the question goes to the doctor;
 *   - chest pain "from the BP medicine?": 995 first, then the leaflet's side-effect line; one-sided heaviness by the rules;
 *   - 「最近很累」 stays a note; reuse since the last clinic visit; real dates on accounts; no AI consent: rules only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { questionRowWords, shortDate } from "@/components/daily/ask-copy";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { createMockLlm } from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/types";
import { classifyRules } from "@/lib/safety/classify";
import { ask, defersToNextVisit, matchDrugs, textOverlap } from "@/lib/safety/pipeline";
import { sameFacet } from "@/lib/safety/topics";
import { SIGNAL_RECORDED, TEMPLATES } from "@/lib/safety/templates";
import { pairTurns, storedAnswer } from "@/lib/safety/turns";
import type { AskResult, Sentence } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { ChatMessageRow, SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { translationKey } from "@/lib/translate";
import { confirmVisit } from "@/lib/visit/pipeline";
import { loadConfirmedTranscripts } from "@/scripts/eval";
import { finalizeReplay, replayLive } from "../visit/helpers";

const store = getMemoryStore();
const HERO = "今天 150/95，我能不能多吃一粒？";
const R1 = "At home, we want it below 135 over 85.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const V3_EXTRA = "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.";
const V3_KNEE = "Try not to take ibuprofen regularly. It can push your blood pressure up. For the knee, paracetamol is the safer one, and we'll look at the knee properly next time.";
const V3_TOGETHER = "Yes, both together after breakfast is fine.";
const V3_FAST = "No need to fast for this one. Just take your medicine as usual and come in.";
const ANKLE = "Some people get ankle swelling with this one. If you notice it, tell me.";
const WRIST = "手腕的不太准。买一个绑手臂的，upper arm 的。";

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});

const ids = (r: AskResult) => r.sentences.map((s) => s.sourceId);
const tpls = (r: AskResult) => r.sentences.map((s) => s.templateId).filter(Boolean);
const first = (r: AskResult): Sentence => r.sentences[0];
/** 10-14: the line that says his words were kept for his doctor cites his note (its id is the store's) */
const kept = (id: string) => (id.startsWith("signal:") ? "signal:<his note>" : id);

async function askIn(session: SessionRow, text: string, opts: { locale?: "en" | "zh-Hans"; llm?: LlmClient; aiAllowed?: boolean } = {}): Promise<{ result: AskResult; added: number }> {
  const before = (await store.listQuestions(session.id)).length;
  const result = await ask(
    { sessionId: session.id, text, locale: opts.locale, role: "patient" },
    { store, llm: opts.llm ?? createMockLlm(), checker: null, checkerReason: "no checker in unit tests", publish: () => {}, costGuard: null, aiAllowed: opts.aiAllowed },
  );
  return { result, added: (await store.listQuestions(session.id)).length - before };
}

const sessionAt = (day: number, time: string | null = null) => store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });

/** The D42 visit replayed through the visit pipeline, and every answer in it confirmed by him (as story-gaps-1010 does). */
async function afterTheD42Visit(): Promise<SessionRow> {
  const s = await sessionAt(42, "09:30");
  await replayLive(s, "v3");
  const view = await finalizeReplay(s, "v3");
  const items: Record<string, "right"> = {};
  for (const q of view.qlist?.items ?? []) if (q.answer?.itemId) items[q.answer.itemId] = "right";
  await confirmVisit(store, s, "v3", { mine: view.lines.filter((l) => l.role === "patient").map((l) => l.id), items });
  return store.setStoryDay(s.id, 43, "10:00");
}

async function account(space: "blank" | "example", consents?: ("terms_privacy" | "ai_processing" | "example_data")[]): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `c2s${randomUUID().slice(0, 10)}`, password: "a long test password", space, ...(consents ? { consents } : {}) });
  return a.scope!;
}

describe("the pieces", () => {
  it("sameFacet: one more tablet is not half a tablet; ankle swelling is not dizziness; fasting is not when", () => {
    expect(sameFacet("dose_change", HERO, "读数高的时候（例如 150/95）可以多吃一粒吗？")).toBe(true);
    expect(sameFacet("dose_change", "我可以把降压药减半吗？", "读数高的时候（例如 150/95）可以多吃一粒吗？")).toBe(false);
    expect(sameFacet("side_effects", "脚踝肿是不是副作用？", ANKLE)).toBe(true);
    expect(sameFacet("side_effects", "吃了药头晕是不是副作用？", ANKLE)).toBe(false);
    expect(sameFacet("blood_test", "验血要空腹吗？", "The blood test, I need to fast or not?")).toBe(true);
    expect(sameFacet("blood_test", "什么时候验血？", "The blood test, I need to fast or not?")).toBe(false);
    expect(sameFacet("combination", "a", "b")).toBe(true);
  });

  it("an answer that puts the question off asks a question back or asks him to bring something", () => {
    expect(defersToNextVisit("Which one? Bring it next time and show me. For now, try not to take it every day.")).toBe(true);
    expect(defersToNextVisit(V3_KNEE)).toBe(false);
    expect(defersToNextVisit(V3_EXTRA)).toBe(false);
    expect(defersToNextVisit(WRIST)).toBe(false);
  });

  it("textOverlap and matchDrugs", () => {
    expect(textOverlap("我家的血压机是绑手腕的，能用吗？", "家里那个机器是绑手腕的，可以用吗？")).toBeGreaterThanOrEqual(0.5);
    expect(textOverlap("手腕的血压计准不准？", "家里那个机器是绑手腕的，可以用吗？")).toBeLessThan(0.5);
    const meds = [
      { id: "a", origin: "prescription", drug_id: "amlodipine" },
      { id: "i", origin: "self_bought", drug_id: "ibuprofen" },
    ] as never[];
    expect(matchDrugs("膝盖痛吃药房买的止痛药，可以一起吃吗？", meds)).toEqual(["amlodipine", "ibuprofen"]);
    expect(matchDrugs("膝盖止痛药还可以吃吗？", meds)).toEqual(["ibuprofen"]);
  });

  it("pairTurns: his line and the answer with the same safety event, oldest first", () => {
    const row = (over: Partial<ChatMessageRow>): ChatMessageRow => ({ id: randomUUID(), session_id: "", day: 42, role: "patient", text: "x", lang: "zh-Hans", safety_event_id: null, answer: null, created_at: "2026-10-10T01:00:00.000Z", ...over });
    const answer = { route: "explain", sentences: [], locale: "zh-Hans" };
    const turns = pairTurns([
      row({ id: "p1", text: "一", safety_event_id: "e1" }),
      row({ id: "r1", role: "ripple", safety_event_id: "e1", answer }),
      row({ id: "p2", text: "二", safety_event_id: "e2" }),
    ]);
    expect(turns.map((t) => [t.id, t.text, t.answer?.route ?? null])).toEqual([
      ["p1", "一", "explain"],
      ["p2", "二", null],
    ]);
  });
});

describe("the demo story, D29 (the seed)", () => {
  it("补吃 alone is a missed dose: the leaflet's line, no dose-change refusal, no question", async () => {
    const { result, added } = await askIn(await sessionAt(29, "20:15"), "早上忘了吃，现在补吃可以吗？", { locale: "zh-Hans" });
    expect(result.route).toBe("explain");
    expect(ids(result)).toContain("hh-amlodipine:amlodipine.missed");
    expect(tpls(result)).not.toContain("refer_doctor");
    expect(result.addedQuestionId).toBeUndefined();
    expect(added).toBe(0);
  });

  it("taking two to make up is still a dose change: R4 and the label, the question for the doctor", async () => {
    const { result } = await askIn(await sessionAt(29, "20:15"), "昨天忘了吃，今天吃两粒补回来可以吗？", { locale: "zh-Hans" });
    expect(result.route).toBe("refuse_route");
    expect(ids(result)).toEqual(expect.arrayContaining(["visit:v2:R4", "label:med-amlodipine"]));
    expect(result.addedQuestionId).toBeDefined();
  });

  it("what the doctor said about his BP: the doctor's own number, R1, with its date", async () => {
    for (const text of ["总结一下医生说我血压怎么样", "Summarise what the doctor said about my blood pressure"]) {
      const { result } = await askIn(await sessionAt(29, "20:15"), text);
      expect(result.route, text).toBe("explain");
      expect(first(result)).toMatchObject({ sourceId: "visit:v1:R1", en: R1, attribution: "doctor" });
      expect(first(result).cite).toMatchObject({ date: "2026-08-24", roleState: "confirmed" });
    }
  });

  it("one side of the body heavy is an emergency by the rules; a heavy bag in his hand is not", () => {
    const ctx = { doctorThresholdSystolic: 180, meds: [] };
    for (const text of ["右边身体觉得很重", "左边的手很重", "我半边身子很沉", "右手突然很重"]) expect(classifyRules(text, ctx)?.route, text).toBe("emergency");
    for (const text of ["右手拿的袋子很重", "左边口袋很重"]) expect(classifyRules(text, ctx)?.route, text).not.toBe("emergency");
  });

  it("one side heavy: 995 now first, then the doctor's warning line (the harness's stroke row), no model call", async () => {
    const { result } = await askIn(await sessionAt(29, "20:15"), "右边身体觉得很重", { locale: "zh-Hans" });
    expect(result.route).toBe("emergency");
    // (the harness, 10-16, kb/pathways.json stroke-now: a stroke sign happening now or not said to be over is 995 now with no
    // question, time-critical. The 10-14 wording that kept it for his doctor first stays for a sign said to be over)
    expect(ids(result).map(kept)).toEqual(["referral:B1-03", "visit:v1:R2"]);
    expect(tpls(result)).toEqual(["emergency_995"]);
    expect(result.risk).toMatchObject({ level: 1, rows: ["stroke-now"] });
    expect(result.llm.calls).toBe(0);
  });

  it("chest pain asked as the BP medicine's doing: kept, the doctor's line, 995 if it gets bad, then the leaflet's side-effect line", async () => {
    for (const text of ["降压药会不会引起胸口痛？", "Can my blood pressure pill cause chest pain?"]) {
      const { result, added } = await askIn(await sessionAt(29, "20:15"), text);
      expect(result.route, text).toBe("emergency");
      expect(ids(result).map(kept), text).toEqual(["signal:<his note>", "visit:v1:R2", "referral:B1-01", "hh-amlodipine:amlodipine.common_side_effects"]);
      expect(result.sentences[2].en).toBe(TEMPLATES.signal_995_chest.en);
      expect(added).toBe(0);
    }
    // a chest pain that is not asked about a medicine: no leaflet line
    const { result } = await askIn(await sessionAt(29, "20:15"), "我胸口好痛");
    expect(ids(result).map(kept)).toEqual(["signal:<his note>", "visit:v1:R2", "referral:B1-01"]);
  });

  it("「最近很累，没有力气」 stays a note: no question for anyone", async () => {
    const s = await sessionAt(29, "20:15");
    const { result, added } = await askIn(s, "最近很累，没有力气", { locale: "zh-Hans" });
    expect(result.route).toBe("log_only");
    expect(added).toBe(0);
    expect((await store.listNotes(s.id)).some((n) => n.text === "最近很累，没有力气")).toBe(true);
  });

  it("a side effect he describes: the doctor's line about that symptom first, the leaflet, and a question for the doctor (once)", async () => {
    const s = await sessionAt(29, "20:15");
    await loadConfirmedTranscripts(store, s.id);
    const a = await askIn(s, "脚踝肿是不是副作用？", { locale: "zh-Hans" });
    expect(a.result.route).toBe("explain");
    expect(first(a.result)).toMatchObject({ sourceId: "visit:v2:v2-u07", en: ANKLE, attribution: "doctor" });
    expect(ids(a.result)).toContain("hh-amlodipine:amlodipine.common_side_effects");
    // (the harness, 10-16, kb/pathways.json side-effect rows: level 3, the safety-net line and the red-flag question)
    expect(tpls(a.result)).toEqual(["side_effect_995", "side_effect_noted"]);
    expect(a.result.followUp).toMatchObject({ pathway: "side_effect", templateId: "side_redflags" });
    const q = (await store.getQuestion(s.id, a.result.addedQuestionId!))!;
    expect(q).toMatchObject({ for: "doctor", origin: "own", text: "脚踝肿是不是副作用？" });
    const again = await askIn(s, "我的脚踝肿了，是药的副作用吗？", { locale: "zh-Hans" });
    expect(again.result).toMatchObject({ addedQuestionId: q.id, questionReused: true });
    expect(again.added).toBe(0);
    // dizziness is another symptom: not the ankle line
    const dizzy = await askIn(s, "吃了药头晕是不是副作用？", { locale: "zh-Hans" });
    expect(ids(dizzy.result)).not.toContain("visit:v2:v2-u07");
  });

  it("the symptom asked about with his medicine, without the words 'side effect', is a side-effect question too", async () => {
    const s = await sessionAt(29, "20:15");
    await loadConfirmedTranscripts(store, s.id);
    const { result } = await askIn(s, "My ankles are a bit swollen, is that from the amlodipine?", { locale: "en" });
    expect(result.route).toBe("explain");
    expect(ids(result).slice(0, 2)).toEqual(["visit:v2:v2-u07", "hh-amlodipine:amlodipine.common_side_effects"]);
    expect(tpls(result)).toEqual(["side_effect_995", "side_effect_noted"]);
    expect(result.addedQuestionId).toBeDefined();
    // a swollen ankle after a walk, with no medicine in it, stays a note
    const walk = await askIn(s, "今天在大巴窑中心走了一圈，脚踝有点肿", { locale: "zh-Hans" });
    expect(walk.result.route).toBe("log_only");
  });
});

describe("after the D42 visit (replayed and confirmed): what Dr Lim answered is the answer", () => {
  it("the knee painkiller: Dr Lim's D42 words first, 'answered before', no new question", async () => {
    const s = await afterTheD42Visit();
    const { result, added } = await askIn(s, "膝盖痛能不能吃布洛芬？", { locale: "zh-Hans" });
    expect(first(result)).toMatchObject({ en: V3_KNEE, attribution: "doctor" });
    expect(result.answeredBefore).toMatchObject({ questionId: "q-knee-2", by: "doctor" });
    expect(tpls(result)).toEqual(["answered_before_doctor"]);
    expect(result.addedQuestionId).toBeUndefined();
    expect(added).toBe(0);
  });

  it("the extra tablet again: Dr Lim's answer leads, then R4 and the label; no 'I've added it', no new question", async () => {
    const s = await afterTheD42Visit();
    const { result, added } = await askIn(s, HERO, { locale: "zh-Hans" });
    expect(result.route).toBe("refuse_route");
    expect(first(result).en).toBe(V3_EXTRA);
    expect(first(result).cite).toMatchObject({ visitId: "v3", roleState: "confirmed" });
    expect(ids(result)).toEqual(expect.arrayContaining(["visit:v2:R4", "label:med-amlodipine"]));
    expect(result.answeredBefore).toMatchObject({ questionId: "q-extra-tablet" });
    expect(tpls(result)).toEqual(["answered_before_doctor"]);
    expect(added).toBe(0);
    expect(result.refusedRequest?.replacedBy).toBe("answered_before_doctor");
  });

  it("the two medicines together: the doctor's answer, never followed by 'nothing answers this'", async () => {
    const s = await afterTheD42Visit();
    const { result } = await askIn(s, "这两种药可以一起吃吗？", { locale: "zh-Hans" });
    expect(result.sentences.map((x) => x.en)).toContain(V3_TOGETHER);
    expect(tpls(result)).not.toContain("refer_pharmacist");
    expect(tpls(result)).not.toContain("uncertain_no_source");
  });

  it("fasting for the blood test: Dr Lim's answer first, no new question", async () => {
    const s = await afterTheD42Visit();
    const { result, added } = await askIn(s, "验血要空腹吗？", { locale: "zh-Hans" });
    expect(first(result).en).toBe(V3_FAST);
    expect(added).toBe(0);
  });

  it("halving the dose is another question: R4, the referral and a new question", async () => {
    const s = await afterTheD42Visit();
    const { result, added } = await askIn(s, "我可以把降压药减半吗？", { locale: "zh-Hans" });
    expect(result.route).toBe("refuse_route");
    expect(result.answeredBefore).toBeUndefined();
    expect(result.sentences.map((x) => x.en)).not.toContain(V3_EXTRA);
    expect(tpls(result)).toContain("refer_doctor");
    expect(added).toBe(1);
  });
});

describe("accounts", () => {
  it("the example account's hero: R4 on its real date, the open q-extra-tablet (D29) reused since the last clinic visit", async () => {
    const scope = await account("example");
    const { result, added } = await askIn(scope, HERO, { locale: "zh-Hans" });
    expect(result.route).toBe("refuse_route");
    expect(first(result)).toMatchObject({ sourceId: "visit:v2:R4", en: R4 });
    expect(first(result).cite).toMatchObject({ clipUrl: "/api/visits/v2/clip?u=v2-u08" });
    expect(result).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
    expect(added).toBe(0);
    expect(JSON.stringify(result.sentences)).not.toContain(scope.id);
    // C2 round 2 (real-app 4.5): the answer says when he asked it before, with the real date (day 29 of his own days)
    const askedOn = storyDate(scope.d0!, 29);
    expect(result.reusedQuestion).toEqual({ date: askedOn });
    expect(questionRowWords("zh-Hans", result, "已在下次看诊的问题单里")).toBe(`${shortDate(askedOn, "zh-Hans")} 问过 · 已在问题单`);
    expect(storedAnswer(result).reusedQuestion).toEqual({ date: askedOn });
    expect((result.events[0].output as { reusedQuestion: unknown }).reusedQuestion).toEqual({ date: askedOn });
  });

  it("the demo's day 29 is as it was (the seeded question is the one this ask makes); from a later day: 9月22日, as the design writes it", async () => {
    const s = await sessionAt(29, "20:15");
    const first29 = await askIn(s, HERO, { locale: "zh-Hans" });
    expect(first29.result).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
    expect(first29.result.reusedQuestion).toBeUndefined();
    expect(questionRowWords("zh-Hans", first29.result, "已在下次看诊的问题单里")).toBe("已在下次看诊的问题单里");
    // looked at from day 35: the same question, asked on 22 Sep
    const later = await sessionAt(35, "20:15");
    const again = await askIn(later, HERO, { locale: "zh-Hans" });
    expect(again.result).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true, reusedQuestion: { date: "2026-09-22" } });
    expect(questionRowWords("zh-Hans", again.result, "x")).toBe("9月22日 问过 · 已在问题单");
    expect(questionRowWords("en", again.result, "x")).toBe("Asked on 22 Sep · on your list");
    // a question that is new says the plain row
    const fresh = await askIn(later, "我可以把降压药减半吗？", { locale: "zh-Hans" });
    expect(fresh.result.reusedQuestion).toBeUndefined();
    expect(questionRowWords("zh-Hans", fresh.result, "已在下次看诊的问题单里")).toBe("已在下次看诊的问题单里");
  });

  it("the example account: the wrist machine asked again gets the doctor's D0 answer first, no new question", async () => {
    const scope = await account("example");
    const { result, added } = await askIn(scope, "我家的血压机是绑手腕的，能用吗？", { locale: "zh-Hans" });
    expect(first(result)).toMatchObject({ en: WRIST, attribution: "doctor" });
    expect(first(result).cite?.date).toBe(scope.d0);
    expect(result.answeredBefore).toMatchObject({ questionId: "q-machine" });
    expect(added).toBe(0);
  });

  it("the example account: the knee painkiller before the follow-up reuses the open 「膝盖止痛药还可以吃吗？」", async () => {
    const scope = await account("example");
    const { result, added } = await askIn(scope, "膝盖痛能不能吃布洛芬？", { locale: "zh-Hans" });
    expect(result).toMatchObject({ addedQuestionId: "q-knee-2", questionReused: true });
    expect(added).toBe(0);
  });

  it("the same words already on his list (track C's rule): open from before the last visit is reused, set aside comes back, merged stays folded", async () => {
    const scope = await account("example");
    const HALF = "我可以把降压药减半吗？";
    // open since before v2 (day 8): outside the since-the-last-visit reuse, still the same words
    const old = await store.addQuestion(scope.id, { for: "doctor", origin: "refused_question", text: HALF, lang: "zh-Hans", created_day: 5 });
    const a = await askIn(scope, HALF, { locale: "zh-Hans" });
    expect(a.result).toMatchObject({ addedQuestionId: old.id, questionReused: true });
    expect(a.added).toBe(0);
    // he set it aside: asking it again puts it back
    await store.updateQuestion(scope.id, old.id, { status: "skipped" });
    const b = await askIn(scope, `  ${HALF}`, { locale: "zh-Hans" });
    expect(b.result).toMatchObject({ addedQuestionId: old.id, questionReused: true });
    expect(b.added).toBe(0);
    expect((await store.getQuestion(scope.id, old.id))?.status).toBe("open");
    // folded into another question: not brought back; the one he kept is not these words, so the ask makes its own row
    await store.updateQuestion(scope.id, old.id, { status: "skipped", merged_into: "q-knee-2" });
    const c = await askIn(scope, HALF, { locale: "zh-Hans" });
    expect(c.added).toBe(1);
    expect(c.result.addedQuestionId).not.toBe(old.id);
    expect((await store.getQuestion(scope.id, old.id))).toMatchObject({ status: "skipped", merged_into: "q-knee-2" });
  });

  it("an account's record summary is in real dates, never 第 N 天 / Day N", async () => {
    const scope = await account("example");
    await store.addBp(scope.id, { day: scope.story_day, slot: "morning", systolic: 140, diastolic: 88 });
    const zh = await askIn(scope, "这几天的血压怎么样？", { locale: "zh-Hans" });
    const en = await askIn(scope, "How have my readings been this week?", { locale: "en" });
    const shown = [...zh.result.sentences, ...en.result.sentences].filter((s) => s.sourceId === "log:bp");
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(`${s.en} ${s.zh ?? ""}`).not.toMatch(/第\d+天|\bDay \d+/);
  });

  it("no consent to AI processing: no model at all, rules and templates; the crisis rules still answer", async () => {
    const scope = await account("blank", ["terms_privacy"]);
    const spy: LlmClient & { calls: number } = {
      provider: "spy",
      model: "spy",
      calls: 0,
      async chat() {
        spy.calls++;
        return { content: "{}", tokens: 0 };
      },
    };
    // (chit-chat such as 「今天会下雨吗？」 is the cant_help rule's now: cant-help.test.ts)
    const swim = await askIn(scope, "我可以去游泳吗？", { locale: "zh-Hans", llm: spy, aiAllowed: false });
    expect(swim.result).toMatchObject({ route: "uncertain", noAiConsent: true });
    expect(tpls(swim.result)).toEqual(["no_ai_consent"]);
    expect(swim.added).toBe(1);
    const chest = await askIn(scope, "我胸口好痛", { locale: "zh-Hans", llm: spy, aiAllowed: false });
    expect(chest.result.route).toBe("emergency");
    // (10-14, the owner's decision) kept for his doctor, then 995 if it gets bad: rules and fixed sentences only
    expect(tpls(chest.result)).toEqual([SIGNAL_RECORDED.id, "signal_995_chest"]);
    expect(spy.calls).toBe(0);
  });
});

describe("a doctor's English line in the Mandarin UI carries its checked translation (from the cache only)", () => {
  it("R4 with a translation in the cache: under the original in zh-Hans, nothing in English", async () => {
    const s = await sessionAt(29, "20:15");
    await store.putTranslation(s.id, { direction: "en>zh-Hans", source_sha256: translationKey(R4), source_text: R4, text: "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。", status: "checked" });
    const zh = await askIn(s, HERO, { locale: "zh-Hans" });
    expect(zh.result.sentences.find((x) => x.sourceId === "visit:v2:R4")).toMatchObject({ en: R4, translation: { lang: "zh-Hans", text: "请不要自己改药量。如果读数高，把它们写下来，下次看诊时告诉我。" } });
    const en = await askIn(s, "Today 150/95, can I take one more tablet?", { locale: "en" });
    expect(en.result.sentences.find((x) => x.sourceId === "visit:v2:R4")?.translation).toBeUndefined();
  });

  it("a rejected translation is never shown", async () => {
    const s = await sessionAt(29, "20:15");
    await store.putTranslation(s.id, { direction: "en>zh-Hans", source_sha256: translationKey(R4), source_text: R4, status: "rejected" });
    const zh = await askIn(s, HERO, { locale: "zh-Hans" });
    expect(zh.result.sentences.find((x) => x.sourceId === "visit:v2:R4")?.translation).toBeUndefined();
  });
});
