/**
 * Fix round of 10-11 (track S): the first run of the journeys against the real database and the real model (the main
 * model of that day, since replaced by Hunyuan on 10-16) failed in the Ask path in ways the offline mock never showed. This file walks
 * the same asks with a stand-in for the live model (tests/unit/safety/live-stand-in.ts: not the mock; real recorded
 * replies where they exist) and states what must hold whatever the provider does.
 *
 *   1. A fact in the store is not the model's to decide. 「我家的血压机是绑手腕的，能用吗？」 is a question of his Dr Lim
 *      answered at the first visit. The real model sorted it as logistics, quoted the answer and nothing said it had been
 *      answered before. Now his own list is looked at before any model: the same answer, the same fact (which question,
 *      which line, who, which day), whatever a model would have called the ask, and when no model answers at all. The same
 *      for a question still waiting on his list.
 *   2. A generation that fails is not the end of the answer: the offline composer picks his sources by the topic table.
 *      "Nothing answers this" is said only when the model itself found nothing, or the sources hold nothing.
 *   3. A model call that starts late still gets a share of the budget of its own (lateCallMs), never past the total.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderEvent } from "@/components/backstage/sentences";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import type { BusEvent } from "@/lib/bus";
import { createMockLlm, createReplayClient } from "@/lib/llm";
import type { ComposePayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { ask, askDeadlineMs, lateCallMs, layer3ReserveMs, referralFor } from "@/lib/safety/pipeline";
import { pairTurns, recordAskTurn } from "@/lib/safety/turns";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { composeReply, deadline, liveStandIn, recorded, type StandIn } from "./live-stand-in";

const store = getMemoryStore();

const WRIST_Q = "我家的血压机是绑手腕的，能用吗？";
const WRIST = "手腕的不太准。买一个绑手臂的，upper arm 的。";
/** Dr Lim's answer as a line of the example account's first visit (the seeded transcript holds it). */
const WRIST_LINE = "visit:v1:v1-u12";
const HERO = "今天 150/95，我能不能多吃一粒？";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const PURPOSE_Q = "What is amlodipine for?";

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});

async function exampleAccount(): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `any${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return a.scope!;
}

const demoAt = (day: number, time: string | null = "20:15") => store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });

async function askIn(scope: SessionRow, text: string, llm: LlmClient, opts: { locale?: "en" | "zh-Hans"; deadlineMs?: number; checker?: LlmClient | null } = {}) {
  const before = await store.listQuestions(scope.id);
  const notesBefore = (await store.listNotes(scope.id)).length;
  const events: BusEvent[] = [];
  const t0 = performance.now();
  const result = await ask(
    { sessionId: scope.id, text, locale: opts.locale, role: "patient" },
    {
      store,
      llm,
      checker: opts.checker ?? null,
      checkerReason: "no checker in unit tests",
      publish: (sid, type, say, data) => void events.push({ id: events.length + 1, type, session_id: sid, at: "", say, data } as BusEvent),
      costGuard: null,
      deadlineMs: opts.deadlineMs,
    },
  );
  const after = await store.listQuestions(scope.id);
  return {
    result,
    /** the backstage rows of this ask, in words */
    rows: events.map((e) => ({ type: e.type, ...renderEvent(e) })),
    ms: performance.now() - t0,
    added: after.filter((q) => !before.some((b) => b.id === q.id)),
    notesAdded: (await store.listNotes(scope.id)).length - notesBefore,
    output: result.events[0].output as { generationError: string | null; composedBy: string | null; routeReason: string },
  };
}

/** A replay client whose cassette folder is empty: every call fails at once (cassette_missing), as a model that is down. */
const nothingRecorded = () => createReplayClient({ provider: "hunyuan", model: "hy3", dir: mkdtempSync(path.join(os.tmpdir(), "rp-empty-cassettes-")) });

/** The real model's route for the wrist question on 10-11 (read off the server log: one classify call, then a compose call, and a bare quote on screen). */
const SORTED_AS_LOGISTICS = '{"route":"logistics","topic":"other","reason":"asking whether a device can be used"}';
/** A classification that leads to a compose call for a question no rule knows (the model names the topic). */
const SORTED_AS_A_DOSE_CHANGE = '{"route":"refuse_route","topic":"dose_change","reason":"asks to change the dose"}';

describe("the stand-in is shaped like the real model", () => {
  it("replays a real model's compose replies recorded on 10-09: the hero's compose cites R4 and the label, word for word", () => {
    const reply = JSON.parse(recorded("compose", HERO)) as { sentences: { sourceId: string; en: string; speechAct: string; slots: unknown; attribution?: string }[] };
    expect(reply.sentences.map((s) => s.sourceId)).toEqual(["visit:v2:R4", "label:med-amlodipine"]);
    expect(reply.sentences[0]).toMatchObject({ en: R4, speechAct: "restate", attribution: "doctor" });
    const purpose = JSON.parse(recorded("compose", PURPOSE_Q)) as { sentences: { sourceId: string }[] };
    expect(purpose.sentences.map((s) => s.sourceId)).toEqual(["hh-amlodipine:amlodipine.purpose"]);
    // what a real compose takes was measured on the main model of 10-09 (its recordings went with it); Hunyuan's times
    // are not recorded yet, so the deadline's numbers are not read against a measurement here
  });
});

describe("answered before: the wrist machine on the example account, whatever the provider", () => {
  /** What he must get: the doctor's answer first, the fact with its question, line, speaker and day, and no new question. */
  function expectAnswered(r: Awaited<ReturnType<typeof askIn>>, scope: SessionRow, label: string) {
    const { result } = r;
    expect(result.answeredBefore, label).toEqual({ questionId: "q-machine", sourceId: result.sentences[0].sourceId, by: "doctor", date: scope.d0 });
    expect(result.sentences[0], label).toMatchObject({ en: WRIST, attribution: "doctor", origin: "span" });
    expect(result.sentences.map((s) => s.templateId).filter(Boolean), label).toEqual(["answered_before_doctor"]);
    expect(result.route, label).toBe("explain");
    expect(result.routeReason, label).toBe("rule:answered_before");
    expect(result.addedQuestionId, label).toBeUndefined();
    expect(r.added, label).toHaveLength(0);
    expect(r.notesAdded, label).toBe(0);
    expect(result.blocked, label).toEqual([]);
  }

  it("the offline mock (as before)", async () => {
    const scope = await exampleAccount();
    expectAnswered(await askIn(scope, WRIST_Q, createMockLlm(), { locale: "zh-Hans" }), scope, "mock");
  });

  it("the real run's case: a model that sorts it as logistics and quotes the answer. The list decides first; the classification is never asked for", async () => {
    const scope = await exampleAccount();
    const calls: NonNullable<StandIn["calls"]> = [];
    const llm = liveStandIn({
      classify: SORTED_AS_LOGISTICS,
      compose: (_o, p) => composeReply(p as unknown as ComposePayload, [WRIST_LINE]),
      calls,
    });
    const r = await askIn(scope, WRIST_Q, llm, { locale: "zh-Hans" });
    expectAnswered(r, scope, "logistics");
    expect(r.result.sentences[0].sourceId).toBe(WRIST_LINE);
    // the backstage names the rule in words
    expect(r.rows.find((x) => x.type === "ask.route")?.sentence).toBe("Sorted as a question Ripple can answer from its sources, by a fixed rule (it repeats a question of his that a clinician answered at a visit).");
    // only the crisis screen and Ripple's own answer (owner 10-15; general.ts: nothing usable from the stand-in here, so the
    // answer is the doctor's alone) saw the words: no classification, and no compose for an ask with no topic
    expect(calls.map((c) => c.task)).toEqual(["crisis", "general"]);
    expect(r.result.llm).toMatchObject({ provider: "hunyuan", calls: 2 });
  });

  it("every route a model could have given it leads to the same answer and the same fact", async () => {
    const routes = [
      '{"route":"explain","topic":"other","reason":"x"}',
      '{"route":"uncertain","topic":"other","reason":"x"}',
      '{"route":"refuse_route","topic":"other","reason":"asks for a recommendation"}',
      '{"route":"refuse_route","topic":"dose_change","reason":"x"}',
      '{"route":"log_only","topic":"other","reason":"x"}',
      '{"route":"unknown_med","topic":"other","reason":"a product that cannot be identified"}',
      "Sure! This is a logistics question.",
      "{}",
    ];
    for (const classify of routes) {
      const scope = await exampleAccount();
      expectAnswered(await askIn(scope, WRIST_Q, liveStandIn({ classify }), { locale: "zh-Hans" }), scope, classify);
    }
  });

  it("no model answers in time (every call hangs until the deadline): the same answer and fact, inside the budget", async () => {
    const scope = await exampleAccount();
    const r = await askIn(scope, WRIST_Q, liveStandIn({ classify: "hang", crisis: "hang", compose: "hang" }), { locale: "zh-Hans", deadlineMs: 600 });
    expectAnswered(r, scope, "hanging");
    expect(r.ms).toBeLessThan(1500);
  });

  it("the model is down (every call fails at once; a replay client with nothing recorded): the same answer and fact", async () => {
    const scope = await exampleAccount();
    const failing = await askIn(scope, WRIST_Q, liveStandIn({ classify: deadline(), crisis: deadline(), compose: deadline() }), { locale: "zh-Hans" });
    expectAnswered(failing, scope, "failing");
    const other = await exampleAccount();
    const replay = nothingRecorded();
    expect(replay.provider).toBe("replay:hunyuan");
    expectAnswered(await askIn(other, WRIST_Q, replay, { locale: "zh-Hans" }), other, "replay, nothing recorded");
  });

  it("a crisis is still a crisis: the screen can raise the same words, and then nothing of the old answer is shown", async () => {
    const scope = await exampleAccount();
    const r = await askIn(scope, WRIST_Q, liveStandIn({ crisis: '{"crisis":"emergency","reason":"test"}' }), { locale: "zh-Hans" });
    expect(r.result.route).toBe("emergency");
    expect(r.result.answeredBefore).toBeUndefined();
    expect(r.result.sentences.some((s) => s.en === WRIST)).toBe(false);
    expect(r.result.sentences[0].templateId).toBe("emergency_995");
  });

  it("the fact is kept with the turn: a refresh reads the same question, line, speaker and day back", async () => {
    const scope = await exampleAccount();
    const { result } = await askIn(scope, WRIST_Q, liveStandIn({ classify: SORTED_AS_LOGISTICS }), { locale: "zh-Hans" });
    await recordAskTurn(store, scope.id, { day: scope.story_day, text: WRIST_Q, lang: "zh-Hans", result });
    const turns = pairTurns(await store.listChatMessages(scope.id, { fromDay: scope.story_day, toDay: scope.story_day }));
    expect(turns.at(-1)?.answer?.answeredBefore).toEqual({ questionId: "q-machine", sourceId: WRIST_LINE, by: "doctor", date: scope.d0 });
  });

  it("another question about the machine is not that question: the model sorts it, and nothing claims it was answered", async () => {
    const scope = await exampleAccount();
    const calls: NonNullable<StandIn["calls"]> = [];
    const r = await askIn(scope, "血压机的电池要多久换一次？", liveStandIn({ classify: SORTED_AS_LOGISTICS, compose: (_o, p) => composeReply(p as unknown as ComposePayload, [WRIST_LINE]), calls }), { locale: "zh-Hans" });
    expect(calls.map((c) => c.task)).toContain("classify");
    expect(r.result.answeredBefore).toBeUndefined();
    expect(r.result.routeReason).toBe("model:hunyuan");
    // "logistics" is the rules' route to give: sorted so by a model, the ask is "not sure". No line of the model's choosing
    // is shown under it (no compose call for an ask with no topic), and the question is kept for the doctor
    expect(r.result.route).toBe("uncertain");
    expect(calls.map((c) => c.task)).not.toContain("compose");
    expect(r.result.sentences.map((s) => s.templateId)).toEqual(["uncertain_no_source"]);
    expect(r.added).toHaveLength(1);
    expect(r.notesAdded).toBe(0);
  });
});

describe("asked before and still waiting: a question on his list that no rule knows", () => {
  const TAI_CHI = "我可以去打太极吗？";

  async function withOpenQuestion(): Promise<{ scope: SessionRow; id: string }> {
    const scope = await exampleAccount();
    const q = await store.addQuestion(scope.id, { for: "doctor", origin: "own", text: TAI_CHI, lang: "zh-Hans", created_day: scope.story_day - 3 });
    return { scope, id: q.id };
  }

  function expectReused(r: Awaited<ReturnType<typeof askIn>>, scope: SessionRow, id: string, label: string) {
    // owner 10-15: with Ripple's own answer (the mock's canned one here) it is answered (explain) in place of "I won't
    // guess"; without it (the stand-ins reply nothing usable) it is what it was. The question on his list is named either way
    const general = r.result.gloss?.kind === "general";
    expect(general, label).toBe(label === "mock");
    expect(r.result.route, label).toBe(general ? "explain" : "uncertain");
    expect(r.result.routeReason, label).toBe("rule:asked_before");
    expect(r.result, label).toMatchObject({ addedQuestionId: id, questionReused: true, reusedQuestion: { date: storyDate(scope.d0!, scope.story_day - 3) } });
    expect(r.result.sentences.map((s) => s.templateId), label).toEqual(general ? [] : ["uncertain_no_source"]);
    expect(r.added, label).toHaveLength(0);
    expect(r.notesAdded, label).toBe(0);
  }

  it("the mock, and a model that would have noted it, called it logistics or an unknown medicine: the same row every time", async () => {
    for (const [label, llm] of [
      ["mock", () => createMockLlm()],
      ["log_only", () => liveStandIn({ classify: '{"route":"log_only","topic":"other","reason":"x"}' })],
      ["logistics", () => liveStandIn({ classify: SORTED_AS_LOGISTICS, compose: (_o, p) => composeReply(p as unknown as ComposePayload, ["visit:v1:R1"]) })],
      ["unknown_med", () => liveStandIn({ classify: '{"route":"unknown_med","topic":"other","reason":"x"}' })],
      ["down", () => liveStandIn({ classify: deadline(), crisis: deadline(), compose: deadline() })],
    ] as const) {
      const { scope, id } = await withOpenQuestion();
      expectReused(await askIn(scope, TAI_CHI, llm(), { locale: "zh-Hans" }), scope, id, label);
    }
  });

  it("a question he set aside, asked again in the same words, comes back onto the list whatever a model would have called it", async () => {
    for (const classify of ['{"route":"log_only","topic":"other","reason":"x"}', SORTED_AS_LOGISTICS]) {
      const { scope, id } = await withOpenQuestion();
      await store.updateQuestion(scope.id, id, { status: "skipped" });
      const r = await askIn(scope, TAI_CHI, liveStandIn({ classify }), { locale: "zh-Hans" });
      expect(r.result, classify).toMatchObject({ route: "uncertain", routeReason: "rule:asked_before", addedQuestionId: id, questionReused: true });
      expect(r.added, classify).toHaveLength(0);
      expect((await store.listQuestions(scope.id)).find((q) => q.id === id)?.status, classify).toBe("open");
    }
  });

  it("the classification is not asked for; a question that is not on his list still goes to the model", async () => {
    const { scope, id } = await withOpenQuestion();
    const calls: NonNullable<StandIn["calls"]> = [];
    expectReused(await askIn(scope, TAI_CHI, liveStandIn({ classify: SORTED_AS_LOGISTICS, calls }), { locale: "zh-Hans" }), scope, id, "listed");
    expect(calls.map((c) => c.task)).toEqual(["crisis", "general"]);
    const more: NonNullable<StandIn["calls"]> = [];
    const other = await askIn(scope, "我可以去游泳吗？", liveStandIn({ classify: '{"route":"uncertain","topic":"other","reason":"x"}', calls: more }), { locale: "zh-Hans" });
    expect(more.map((c) => c.task)).toContain("classify");
    expect(other.result.routeReason).toBe("model:hunyuan");
    expect(other.added).toHaveLength(1);
  });
});

describe("a generation that fails: the answer is still made from his sources", () => {
  it("what the real model said, replayed: the leaflet's purpose line", async () => {
    const s = await demoAt(29);
    const r = await askIn(s, PURPOSE_Q, liveStandIn({ compose: recorded("compose", PURPOSE_Q) }));
    expect(r.result.route).toBe("explain");
    expect(r.result.sentences.map((x) => x.sourceId)).toEqual(["hh-amlodipine:amlodipine.purpose"]);
    expect(r.output).toMatchObject({ generationError: null, composedBy: null });
  });

  it("the compose call stopped at the deadline (the real run's log line): not 'I won't guess' and a question, but the same sources by rule", async () => {
    for (const [label, compose] of [
      ["deadline", deadline()],
      ["hang", "hang"],
      ["not JSON", "Sure! Amlodipine is used to treat high blood pressure."],
      ["no sentences array", '{"answer":"it lowers blood pressure"}'],
    ] as const) {
      const s = await demoAt(29);
      const r = await askIn(s, PURPOSE_Q, liveStandIn({ compose }), { deadlineMs: 600 });
      expect(r.result.route, label).toBe("explain");
      expect(r.result.routeChangedFrom, label).toBeUndefined();
      expect(r.result.sentences.map((x) => x.sourceId), label).toContain("hh-amlodipine:amlodipine.purpose");
      expect(r.result.sentences.every((x) => x.origin === "patient_text" || x.origin === "span"), label).toBe(true);
      expect(r.result.sentences.some((x) => x.templateId === "uncertain_no_source"), label).toBe(false);
      expect(r.added, label).toHaveLength(0);
      expect(r.output.generationError, label).toMatch(/generation_failed: deadline|bad_json|bad_shape/);
      expect(r.output.composedBy, label).toBe("rules_after_generation_failed");
      expect(r.ms, label).toBeLessThan(1500);
      // the model's words never reach him, however the reply failed
      expect(JSON.stringify(r.result.sentences), label).not.toMatch(/Sure!|it lowers blood pressure/);
      // and the backstage says who picked the sources
      expect(r.rows.find((x) => x.type === "ask.answered")?.sentence, label).toMatch(/The model gave no usable answer in time, so the fixed rules picked his sources\.$/);
    }
  });

  it("a model that answered 'none of these' is believed: the fallback is for a failure, not for an empty answer", async () => {
    const s = await demoAt(29);
    const r = await askIn(s, PURPOSE_Q, liveStandIn({ compose: '{"sentences": []}' }));
    expect(r.result.route).toBe("uncertain");
    expect(r.result.routeChangedFrom).toBe("explain");
    expect(r.output).toMatchObject({ generationError: null, composedBy: null });
    expect(r.added).toHaveLength(1);
  });

  it("the hero question when the model is late: R4, the label as printed, the referral, the question he already had", async () => {
    const s = await demoAt(29);
    const r = await askIn(s, HERO, liveStandIn({ compose: "hang", crisis: "hang" }), { locale: "zh-Hans", deadlineMs: 600 });
    expect(r.result.route).toBe("refuse_route");
    expect(r.result.sentences.map((x) => x.sourceId).slice(0, 2)).toEqual(["visit:v2:R4", "label:med-amlodipine"]);
    expect(r.result.sentences.find((x) => x.sourceId === "visit:v2:R4")?.en).toBe(R4);
    expect(r.result.sentences.map((x) => x.templateId).filter(Boolean)).toEqual(["refer_doctor"]);
    expect(r.result).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
    expect(r.added).toHaveLength(0);
  });

  it("every route that composes has something to show when the model fails, and it is never the model's", async () => {
    const asks: [string, string][] = [
      ["Can I take it with food?", "explain"],
      ["Can I stop taking amlodipine?", "refuse_route"],
      ["Can I take ibuprofen together with amlodipine?", "refuse_route"],
      ["When is my next appointment?", "logistics"],
      ["我忘了吃药怎么办？", "explain"],
      ["Auntie at the counter said after food but the leaflet says any time. Which one?", "uncertain"],
      ["Can I go swimming?", "uncertain"],
    ];
    for (const [text, route] of asks) {
      const s = await demoAt(29);
      const r = await askIn(s, text, liveStandIn({ compose: deadline(), crisis: deadline() }));
      expect(r.result.route, text).toBe(route);
      expect(r.result.sentences.length, text).toBeGreaterThan(0);
      expect(r.result.sentences.every((x) => ["template", "span", "patient_text", "slot_template"].includes(x.origin ?? "")), text).toBe(true);
      expect(r.result.blocked, text).toEqual([]);
    }
  });
});

describe("the referral sentence fits the question (a case only a live model produces)", () => {
  it("the doctor's 'questions about changing your medicine' only for a dose change or stopping; the pharmacist's for the pharmacist", () => {
    expect(referralFor({ questionFor: "doctor", topics: ["dose_change"] })).toBe("refer_doctor");
    expect(referralFor({ questionFor: "doctor", topics: ["stopping", "why_take"] })).toBe("refer_doctor");
    expect(referralFor({ questionFor: "doctor", topics: [] })).toBe("uncertain_no_source");
    expect(referralFor({ questionFor: "doctor", topics: ["target"] })).toBe("uncertain_no_source");
    expect(referralFor({ questionFor: "pharmacist", topics: ["combination"] })).toBe("refer_pharmacist");
  });

  it("a question no rule knows that the model calls a refused request about nothing in particular: no word of changing his medicine", async () => {
    const s = await demoAt(29);
    const r = await askIn(s, "Which blood pressure machine should I buy?", liveStandIn({ classify: '{"route":"refuse_route","topic":"other","reason":"asks for a recommendation"}' }));
    // owner 10-15: only a change, stop or combination of his medicines stays a refusal; this one is "not sure" (and gets
    // Ripple's own answer when the model gives one: general.test.ts; this stand-in gives none, so it is what it was)
    expect(r.result.route).toBe("uncertain");
    expect(r.result.sentences.map((x) => x.templateId)).toEqual(["uncertain_no_source"]);
    expect(r.result.sentences.map((x) => x.en).join(" ")).not.toMatch(/changing your medicine/);
    expect(r.added).toHaveLength(1);
    expect(r.added[0].for).toBe("doctor");
  });
});

describe("the deadline: what it is, and a call that starts late", () => {
  it("8 s in all, 2.5 s of it kept for layer 3, and at most 3 s of its own for a model call that starts late", () => {
    expect(askDeadlineMs({})).toBe(8000);
    expect(layer3ReserveMs(8000)).toBe(2500);
    expect(lateCallMs(8000)).toBe(3000);
    expect(lateCallMs(800)).toBe(300);
  });

  it("a compose call that starts after most of the budget is gone still gets its share and its answer is used", async () => {
    // budget 800: generation must end by 534; a late call gets 300. The classification takes 400, so the compose call
    // starts with about 130 left and takes 220: cut before this fix, answered now.
    const s = await demoAt(29);
    const calls: NonNullable<StandIn["calls"]> = [];
    const llm = liveStandIn({
      classify: SORTED_AS_A_DOSE_CHANGE,
      compose: (_o, p) => composeReply(p as unknown as ComposePayload, ["visit:v2:R3"]),
      ms: { classify: 400, compose: 220 },
      calls,
    });
    const r = await askIn(s, "Is the clinic open on Sunday?", llm, { deadlineMs: 800 });
    expect(calls.map((c) => c.task)).toEqual(["crisis", "classify", "compose"]);
    expect(r.output.generationError).toBeNull();
    expect(r.output.composedBy).toBeNull();
    // the sentence the model picked reached the checks (shown, or stopped by one of them: never lost to the clock)
    expect([...r.result.sentences, ...r.result.blocked.map((b) => b.sentence)].map((x) => x.sourceId)).toContain("visit:v2:R3");
    expect(r.ms).toBeLessThan(800 + 400);
  });

  it("the total still holds: a late compose that never answers ends with the answer's deadline, and the rules compose", async () => {
    const s = await demoAt(29);
    const llm = liveStandIn({ classify: SORTED_AS_A_DOSE_CHANGE, compose: "hang", ms: { classify: 400 } });
    const r = await askIn(s, "Is the clinic open on Sunday?", llm, { deadlineMs: 800 });
    expect(r.output.generationError).toMatch(/deadline/);
    expect(r.output.composedBy).toBe("rules_after_generation_failed");
    expect(r.ms).toBeGreaterThan(600);
    expect(r.ms).toBeLessThan(800 + 500);
  });
});
