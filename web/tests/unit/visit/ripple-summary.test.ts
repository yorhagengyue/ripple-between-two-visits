/**
 * Ripple's summary of a visit (lib/visit/ripple-summary.ts; owner's decision of 10-14): the model's input (the lines under
 * short ids, who said each one as the transcript has it), the guards (no instruction of its own, nothing its lines do not
 * have, no illness, no reassurance, the speaker only where the lines name one), the gates (an account, a live model, his
 * consent, his day's spend), the live notes (at most one call per 15 s and only for new lines, published as
 * visit.summary next to the captions), the final summary (kept with the visit as its own item, drawn on the review,
 * announced), and that it is never a source: a verdict on it is refused, the candidates skip it even if its row were
 * confirmed, and an answer after the visit never quotes it.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { RippleNotes } from "@/components/visit/elder/RippleNotes";
import { vw } from "@/components/visit/elder/words";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getBus, type BusEvent } from "@/lib/bus";
import { createMockLlm, type ChatOpts, type LlmClient } from "@/lib/llm";
import type { SummaryPayload } from "@/lib/llm/protocol";
import { setAiConsent } from "@/lib/privacy/ai";
import { buildCandidates } from "@/lib/safety/candidates";
import { ask } from "@/lib/safety/pipeline";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, UtteranceRole, UtteranceRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, processChunk, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import {
  guardSummaryPoint,
  liveSummaryIdle,
  liveSummaryOf,
  noteVisitLines,
  readSummaryAnswer,
  setSummaryTestDeps,
  summaryPayload,
  SYSTEM_SUMMARY,
  writeFinalSummary,
  writeSummary,
  type SummaryDeps,
} from "@/lib/visit/ripple-summary";
import { isSummaryItem, storedSummary, SUMMARY_ITEM_TEXT, summaryItemId } from "@/lib/visit/summary-item";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
  delete process.env.LLM_PROVIDER;
});
afterEach(() => {
  setTestClock(null);
  setSummaryTestDeps(null);
});

let n = 0;
function line(text: string, role: UtteranceRole = "doctor", id = `l${++n}`): UtteranceRow {
  return { id, session_id: "s", visit_id: "v", t_start_ms: n * 1000, t_end_ms: n * 1000 + 900, speaker_cluster: null, role, role_state: "inferred", text, lang: null, clip_path: null, scripted_fallback: false, created_at: "2026-10-14T00:00:00.000Z" };
}

/** A live model that answers the summary task with what `answer` makes of the payload, and keeps every payload. */
function summaryModel(answer: (p: SummaryPayload) => unknown): { llm: LlmClient; calls: SummaryPayload[]; opts: ChatOpts[] } {
  const calls: SummaryPayload[] = [];
  const opts: ChatOpts[] = [];
  return {
    calls,
    opts,
    llm: {
      provider: "deepseek",
      model: "deepseek-flash",
      async chat(o: ChatOpts) {
        opts.push(o);
        const p = JSON.parse(o.user) as SummaryPayload;
        calls.push(p);
        return { content: JSON.stringify(answer(p)), tokens: 42 };
      },
    },
  };
}

async function account(): Promise<{ userId: string; scope: SessionRow }> {
  setTestClock({ at: "2026-10-14T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `rs${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  setTestClock(null);
  return { userId: a.userId, scope: (await store.getSession(a.scope!.id))! };
}

const events = (sessionId: string): BusEvent[] =>
  getBus()
    .recent(sessionId)
    .filter((e) => e.type === "visit.summary");

describe("what the model is given and asked", () => {
  it("the lines under short ids, who said each one as the transcript has it, and the points on screen while live", () => {
    const lines = [line("Amlodipine, 5 milligrams, one tablet every morning."), line("医生，我膝盖痛。", "patient"), line("Okay.", "unknown")];
    const { payload, ids } = summaryPayload(lines, "zh-Hans", "live", ["医生开了 amlodipine。"]);
    expect(payload).toEqual({
      task: "summary",
      stage: "live",
      locale: "zh-Hans",
      lines: [
        { id: "L1", by: "doctor", text: "Amlodipine, 5 milligrams, one tablet every morning." },
        { id: "L2", by: "the patient", text: "医生，我膝盖痛。" },
        { id: "L3", by: null, text: "Okay." },
      ],
      previous: ["医生开了 amlodipine。"],
    });
    expect([...ids.entries()]).toEqual([
      ["L1", lines[0].id],
      ["L2", lines[1].id],
      ["L3", lines[2].id],
    ]);
    expect(summaryPayload(lines, "en", "final", ["x"]).payload.previous).toBeUndefined();
    // the rules the guards hold it to are the ones it is told
    for (const rule of ["at most 4 short points (never more)", "lists their ids in `lines`", "only when its lines name the speaker", "add no number, dose, time, date, medicine name", "never 你 / 您 / you", "Never tell him to do anything", "Never name or suggest an illness", "Never reassure or alarm", "已服药 / 未服药 / 就诊", "Output JSON only"]) {
      expect(SYSTEM_SUMMARY).toContain(rule);
    }
  });

  it("reads { points } (or a bare array); anything else is no answer", () => {
    expect(readSummaryAnswer('{"points":[{"text":" A. ","lines":["L1","L1",3]}]}')).toEqual([{ text: "A.", lines: ["L1"] }]);
    expect(readSummaryAnswer('[{"text":"B","lines":"L2"}]')).toEqual([{ text: "B", lines: ["L2"] }]);
    expect(readSummaryAnswer("not json")).toBeNull();
    expect(readSummaryAnswer('{"sentences":[]}')).toBeNull();
  });
});

describe("the guards", () => {
  const doc = (text: string) => ({ text, role: "doctor" as const });
  const pat = (text: string) => ({ text, role: "patient" as const });
  const AMLO = doc("Amlodipine, 5 milligrams, one tablet every morning.");
  const DOSE = doc("Please don't change the dose yourself.");

  it("a verb on the blood pressure is no illness: 升高血压 / 降低血压 (10-14)", () => {
    const UP = doc("Try not to take ibuprofen. It can push your blood pressure up.");
    expect(guardSummaryPoint("医生说布洛芬会升高血压，请他不要服用。", [UP], "zh-Hans")).not.toContain("diagnosis");
    expect(guardSummaryPoint("The doctor said ibuprofen can push his blood pressure up, so not to take it.", [UP], "en")).not.toContain("diagnosis");
    // the illness itself, named by the point and not by its line, is still refused
    expect(guardSummaryPoint("医生说他有高血压，不要服用布洛芬。", [UP], "zh-Hans")).toContain("diagnosis");
  });

  it("let through what was said, attributed to the speaker its lines name, in his language", () => {
    expect(guardSummaryPoint("医生说每天早上服用一粒 amlodipine。", [AMLO], "zh-Hans")).toEqual([]);
    expect(guardSummaryPoint("医生提醒不要自己改变剂量。", [DOSE], "zh-Hans")).toEqual([]);
    expect(guardSummaryPoint("The doctor asked him not to change the dose himself.", [DOSE], "en")).toEqual([]);
    expect(guardSummaryPoint("医生说血压偏高，要开始服药。", [doc("Yes, these confirm it. Your blood pressure is high. We'll start a tablet.")], "zh-Hans")).toEqual([]);
    // the same illness in the other language counts as named
    expect(guardSummaryPoint("医生确认是高血压。", [doc("You have high blood pressure.")], "zh-Hans")).toEqual([]);
    expect(guardSummaryPoint("本人提到膝盖痛，服用了药房买的止痛药。", [pat("医生，我膝盖痛，有吃药房买的止痛药，这个可以一起吃吗？")], "zh-Hans")).toEqual([]);
  });

  it("drop an instruction in Ripple's own voice, and anything said to him", () => {
    expect(guardSummaryPoint("每天早上服用一粒 amlodipine。", [AMLO], "zh-Hans")).toContain("instruction");
    expect(guardSummaryPoint("Take one tablet every morning.", [AMLO], "en")).toContain("instruction");
    expect(guardSummaryPoint("记得按时服药。", [AMLO], "zh-Hans")).toContain("instruction");
    expect(guardSummaryPoint("医生请您每天早上服用一粒。", [AMLO], "zh-Hans")).toContain("second_person");
    expect(guardSummaryPoint("The doctor said you should take one tablet.", [AMLO], "en")).toContain("second_person");
  });

  it("drop a number, a dose or a medicine its lines do not have", () => {
    expect(guardSummaryPoint("医生说每天早上服用两粒。", [AMLO], "zh-Hans")).toEqual(expect.arrayContaining(["number"]));
    expect(guardSummaryPoint("The doctor said 10 milligrams every morning.", [AMLO], "en")).toEqual(expect.arrayContaining(["number"]));
    expect(guardSummaryPoint("The doctor said amlodipine can be taken with paracetamol.", [AMLO], "en")).toContain("medicine");
    expect(guardSummaryPoint("医生说下次就诊前空腹十二小时。", [doc("Come back in five weeks.")], "zh-Hans")).toContain("number");
  });

  it("drop the wrong speaker, an illness or a judgement the lines do not have, reassurance, a lost negation", () => {
    expect(guardSummaryPoint("医生说膝盖痛。", [pat("医生，我膝盖痛。")], "zh-Hans")).toContain("attribution");
    expect(guardSummaryPoint("医生说这是高血压。", [doc("Your blood pressure is high.")], "zh-Hans")).toContain("diagnosis");
    expect(guardSummaryPoint("The doctor said this may indicate a kidney problem.", [doc("Your blood pressure is high.")], "en")).toContain("suggests_illness");
    expect(guardSummaryPoint("医生说读数偏高。", [doc("So, how were the readings at home?")], "zh-Hans")).toContain("judgement_evaluation");
    expect(guardSummaryPoint("医生说不用担心。", [doc("Don't worry about it.")], "zh-Hans")).toContain("judgement_reassurance");
    expect(guardSummaryPoint("医生说可以自己调整剂量。", [DOSE], "zh-Hans")).toContain("negation");
  });

  it("read a real model's wording as it is meant: 此药 is this medicine; 饭前饭后均可 is the lines' either way, 饭后 alone is not", () => {
    const L12 = { text: "陈先生，这是 amlodipine，每天早上吃一粒，饭前饭后都可以。", role: "pharmacist" as const };
    const L13 = { text: "忘了吃的话，想起来就吃，但是不要一次吃两粒。", role: "pharmacist" as const };
    expect(guardSummaryPoint("药剂师说每天早上服一粒，饭前饭后均可；忘记服药时想起就服，但不要一次服两粒。", [L12, L13], "zh-Hans")).toEqual([]);
    expect(guardSummaryPoint("The pharmacist said one tablet every morning, before or after food.", [L12], "en")).toEqual([]);
    expect(guardSummaryPoint("药剂师说饭后服用。", [L12], "zh-Hans")).toContain("slot_times");
    expect(guardSummaryPoint("医生说此药需每天服用，即使无感觉；不要自行改剂量。", [doc("This tablet works quietly. You won't feel it, but take it every day, even when you feel fine."), DOSE], "zh-Hans")).toEqual([]);
  });

  it("drop the plain register, the warning line in Ripple's words, the wrong language, a long point, no line", () => {
    expect(guardSummaryPoint("本人说吃了药。", [pat("我吃了药。")], "zh-Hans")).toContain("register");
    expect(guardSummaryPoint("医生说超过180要打995。", [doc("If it's above 180 on top, call 995.")], "zh-Hans")).toContain("crisis");
    expect(guardSummaryPoint("The doctor prescribed amlodipine.", [AMLO], "zh-Hans")).toContain("language");
    expect(guardSummaryPoint(`医生说${"每天早上测量血压，".repeat(10)}`, [doc("Measure every morning.")], "zh-Hans")).toContain("too_long");
    expect(guardSummaryPoint("医生说每天早上服用一粒。", [], "zh-Hans")).toEqual(["untied"]);
  });
});

describe("one call", () => {
  it("keeps the points that pass, at most four, drops the untied and the guarded; the call says it is a summary", async () => {
    const lines = [line("Amlodipine, 5 milligrams, one tablet every morning."), line("Please don't change the dose yourself."), line("Come back in five weeks.")];
    const m = summaryModel(() => ({
      points: [
        { text: "The doctor started amlodipine, one tablet every morning.", lines: ["L1"] },
        { text: "Take two tablets when it is high.", lines: ["L1"] },
        { text: "The doctor asked him not to change the dose himself.", lines: ["L2"] },
        { text: "Something nobody said.", lines: ["L9"] },
        { text: "The doctor asked him to come back in five weeks.", lines: ["L3"] },
        { text: "The doctor asked him not to change the dose himself, again.", lines: ["L2"] },
        { text: "The doctor started amlodipine, again.", lines: ["L1"] },
      ],
    }));
    const out = await writeSummary({ lines, locale: "en", stage: "final", llm: m.llm });
    expect(out.points.map((p) => p.text)).toEqual([
      "The doctor started amlodipine, one tablet every morning.",
      "The doctor asked him not to change the dose himself.",
      "The doctor asked him to come back in five weeks.",
      "The doctor asked him not to change the dose himself, again.",
    ]);
    expect(out.points[1].lines).toEqual([lines[1].id]);
    expect(out.record).toMatchObject({ written: 7, kept: 4, tokens: 42 });
    expect(out.record.dropped).toEqual(expect.arrayContaining([["untied"], expect.arrayContaining(["instruction"])]));
    expect(m.opts[0]).toMatchObject({ purpose: "summary", json: true, system: SYSTEM_SUMMARY });
  });

  it("a garbled answer or a failed call gives no point, and says why in a code", async () => {
    const lines = [line("Come back in five weeks.")];
    const bad: LlmClient = { provider: "deepseek", model: "x", chat: async () => ({ content: "sure! here are the points", tokens: 1 }) };
    expect(await writeSummary({ lines, locale: "en", stage: "live", llm: bad })).toMatchObject({ points: [], record: { error: "bad_response" } });
    const down: LlmClient = { provider: "deepseek", model: "x", chat: async () => Promise.reject(Object.assign(new Error("secret prompt text"), { code: "timeout" })) };
    const out = await writeSummary({ lines, locale: "en", stage: "live", llm: down });
    expect(out).toMatchObject({ points: [], record: { error: "timeout" } });
    expect(JSON.stringify(out)).not.toContain("secret prompt text");
  });
});

async function recordingVisit(scope: SessionRow): Promise<string> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  return visit.id;
}

async function addLine(scope: SessionRow, visitId: string, text: string, role: UtteranceRole = "doctor"): Promise<void> {
  const k = (await store.listUtterances(scope.id, visitId)).length;
  await store.addUtterances(scope.id, visitId, [{ id: `${visitId}-w${k + 1}`, t_start_ms: k * 4000, t_end_ms: k * 4000 + 3000, text, role, role_state: "inferred", lang: "en" }]);
}

describe("the live notes", () => {
  it("at most one call per interval and only for new lines; published as visit.summary next to the captions; nothing once the recording ended", async () => {
    const { scope } = await account();
    const visitId = await recordingVisit(scope);
    const m = summaryModel((p) => ({ points: [{ text: p.lines.length === 1 ? "The doctor started amlodipine." : "The doctor started amlodipine, one tablet every morning.", lines: [p.lines[0].id] }] }));
    const deps: SummaryDeps = { llm: m.llm, aiAllowed: true, spend: null, locale: "en", everyMs: 150 };

    await addLine(scope, visitId, "Amlodipine, 5 milligrams, one tablet every morning.");
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ task: "summary", stage: "live", locale: "en" });
    expect(liveSummaryOf(scope.id, visitId)?.points.map((p) => p.text)).toEqual(["The doctor started amlodipine."]);
    const first = events(scope.id).filter((e) => (e.data as { visit_id: string }).visit_id === visitId);
    expect(first).toHaveLength(1);
    expect(first[0].data).toMatchObject({ visit_id: visitId, stage: "live", lang: "en", points: [{ text: "The doctor started amlodipine.", lines: [`${visitId}-w1`] }] });
    // its words are not in `say`
    expect(first[0].say).not.toContain("amlodipine");

    // a second line at once: no call yet (the interval), one when it has passed, with the points on screen given
    await addLine(scope, visitId, "Please don't change the dose yourself.");
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 250));
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1].previous).toEqual(["The doctor started amlodipine."]);
    expect(m.calls[1].lines.map((l) => l.text)).toEqual(["Amlodipine, 5 milligrams, one tablet every morning.", "Please don't change the dose yourself."]);
    expect(events(scope.id).filter((e) => (e.data as { visit_id: string }).visit_id === visitId).map((e) => (e.data as { points: { text: string }[] }).points[0].text)).toEqual([
      "The doctor started amlodipine.",
      "The doctor started amlodipine, one tablet every morning.",
    ]);

    // no new line: no call
    await new Promise((r) => setTimeout(r, 200));
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(2);
    expect(liveSummaryOf(scope.id, visitId)?.skipped).toBe("no_new_lines");

    // the recording ended: nothing more
    await store.updateVisit(scope.id, visitId, { status: "transcribing" });
    await addLine(scope, visitId, "Come back in five weeks.");
    await new Promise((r) => setTimeout(r, 200));
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(2);
    expect(liveSummaryOf(scope.id, visitId)?.skipped).toBe("not_recording");
  });

  it("the same points are not sent again", async () => {
    const { scope } = await account();
    const visitId = await recordingVisit(scope);
    const m = summaryModel(() => ({ points: [{ text: "The doctor asked him not to change the dose himself.", lines: ["L1"] }] }));
    const deps: SummaryDeps = { llm: m.llm, aiAllowed: true, spend: null, locale: "en", everyMs: 10 };
    await addLine(scope, visitId, "Please don't change the dose yourself.");
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    await new Promise((r) => setTimeout(r, 20));
    await addLine(scope, visitId, "Okay lah.", "patient");
    noteVisitLines(store, scope, visitId, deps);
    await liveSummaryIdle(scope.id, visitId);
    expect(m.calls).toHaveLength(2);
    expect(events(scope.id).filter((e) => (e.data as { visit_id: string }).visit_id === visitId)).toHaveLength(1);
  });

  it("no call without an account, a live model, his consent or room in his day's spend", async () => {
    const m = summaryModel(() => ({ points: [] }));
    // a demo session: never
    const demo = await store.createSession({ story_day: 0, ttl_hours: 1 });
    const demoVisit = await startVisit(store, demo, { mode: "record", consent: { given: true } });
    await store.addUtterances(demo.id, demoVisit.id, [{ id: `${demoVisit.id}-w1`, t_start_ms: 0, t_end_ms: 900, text: "Come back in five weeks.", role: "doctor", role_state: "inferred" }]);
    noteVisitLines(store, demo, demoVisit.id, { llm: m.llm, aiAllowed: true, spend: null });
    expect(liveSummaryOf(demo.id, demoVisit.id)).toBeNull();

    const { scope } = await account();
    const cases: [SummaryDeps, string][] = [
      [{ llm: createMockLlm(), aiAllowed: true, spend: null }, "no_model"],
      [{ llm: m.llm, aiAllowed: false, spend: null }, "no_consent"],
      [{ llm: m.llm, aiAllowed: true, spend: { capped: async () => true, wrap: (c) => c, settle: async () => {} } }, "spend_cap"],
    ];
    for (const [deps, why] of cases) {
      const visitId = await recordingVisit(scope);
      await addLine(scope, visitId, "Come back in five weeks.");
      noteVisitLines(store, scope, visitId, deps);
      await liveSummaryIdle(scope.id, visitId);
      expect(liveSummaryOf(scope.id, visitId)?.skipped, why).toBe(why);
    }
    expect(m.calls).toHaveLength(0);

    // his own consent record decides when nothing is handed in: he withdraws it, no call
    const { userId, scope: other } = await account();
    await setAiConsent({ store, texts: store }, { userId, scopeId: other.id, on: false, locale: "zh-Hans" });
    const visitId = await recordingVisit(other);
    await addLine(other, visitId, "Come back in five weeks.");
    noteVisitLines(store, other, visitId, { llm: m.llm, spend: null });
    await liveSummaryIdle(other.id, visitId);
    expect(liveSummaryOf(other.id, visitId)?.skipped).toBe("no_consent");
    expect(m.calls).toHaveLength(0);
  });

  it("a call counted in his day's spend is settled", async () => {
    const { scope } = await account();
    const visitId = await recordingVisit(scope);
    const m = summaryModel(() => ({ points: [{ text: "The doctor asked him to come back in five weeks.", lines: ["L1"] }] }));
    let wrapped = 0;
    let settled = 0;
    const spend = { capped: async () => false, wrap: <T,>(c: T) => (wrapped++, c), settle: async () => void settled++ };
    await addLine(scope, visitId, "Come back in five weeks.");
    noteVisitLines(store, scope, visitId, { llm: m.llm, aiAllowed: true, spend, locale: "en" });
    await liveSummaryIdle(scope.id, visitId);
    expect([m.calls.length, wrapped, settled]).toEqual([1, 1, 1]);
  });
});

describe("the final summary", () => {
  it("is written from the whole transcript, kept with the visit as its own item, drawn on the review and announced", async () => {
    const { scope } = await account();
    const visitId = await recordingVisit(scope);
    await addLine(scope, visitId, "Amlodipine, 5 milligrams, one tablet every morning.");
    await addLine(scope, visitId, "Please don't change the dose yourself.");
    const m = summaryModel(() => ({
      points: [
        { text: "The doctor started amlodipine, one tablet every morning.", lines: ["L1"] },
        { text: "The doctor asked him not to change the dose himself.", lines: ["L2"] },
      ],
    }));
    const view = await writeFinalSummary(store, scope, visitId, { llm: m.llm, aiAllowed: true, spend: null, locale: "en" });
    expect(view).toMatchObject({ stage: "final", lang: "en", points: [{ text: "The doctor started amlodipine, one tablet every morning." }, { text: "The doctor asked him not to change the dose himself." }] });
    expect(m.calls[0]).toMatchObject({ stage: "final" });
    const row = (await store.listVisitItems(scope.id, { visit_id: visitId })).find((i) => i.id === summaryItemId(visitId))!;
    // its own row: a neutral text (never the points), no line, never confirmed
    expect(row).toMatchObject({ type: "summary", text: SUMMARY_ITEM_TEXT, utterance_ids: [], confirmed_by: null });
    expect(isSummaryItem(row)).toBe(true);
    expect(storedSummary([row], visitId)?.points.map((p) => p.text)).toEqual(view!.points.map((p) => p.text));
    // the review draws it; it is no card and no question's answer
    const v = (await buildVisitView(store, scope.id, visitId, { session: scope }))!;
    expect(v.account?.summary?.points.map((p) => p.text)).toEqual(view!.points.map((p) => p.text));
    expect(JSON.stringify(v.cards)).not.toContain("The doctor started amlodipine");
    expect(JSON.stringify(v.qlist ?? null)).not.toContain("The doctor started amlodipine");
    const fin = events(scope.id).filter((e) => (e.data as { visit_id: string; stage: string }).visit_id === visitId && (e.data as { stage: string }).stage === "final");
    expect(fin).toHaveLength(1);
  });

  it("finalizeVisit starts it in the background, with his consent and a live model; with the offline model there is none", async () => {
    const { scope } = await account();
    const speech = getSpeechProvider();
    // offline: the record as before, no summary
    const plain = await recordingVisit(scope);
    const j1 = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
    await finalizeVisit(store, scope, plain, await speech.getFileJob(j1.jobId), { llm: null });
    await new Promise((r) => setTimeout(r, 50));
    expect((await buildVisitView(store, scope.id, plain, { session: scope }))!.account?.summary ?? null).toBeNull();

    const m = summaryModel((p) => ({ points: [{ text: "医生提醒不要自己改变剂量。", lines: [p.lines.find((l) => /don't change the dose/.test(l.text))!.id] }] }));
    setSummaryTestDeps({ llm: m.llm, spend: null });
    const visitId = await recordingVisit(scope);
    const j2 = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
    await finalizeVisit(store, scope, visitId, await speech.getFileJob(j2.jobId), { llm: null });
    for (let i = 0; i < 100 && !(await store.listVisitItems(scope.id, { visit_id: visitId })).some(isSummaryItem); i++) await new Promise((r) => setTimeout(r, 10));
    const v = (await buildVisitView(store, scope.id, visitId, { session: scope }))!;
    expect(v.account?.summary).toMatchObject({ stage: "final", lang: "zh-Hans", points: [{ text: "医生提醒不要自己改变剂量。" }] });
    expect(m.calls[0].lines.length).toBeGreaterThan(5);
  });
});

describe("the example account's sample replay (the judges' path)", () => {
  it("its lines come through the replay as through a recording: live notes while it plays, the final summary on its review", async () => {
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `rx${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const scope = (await store.getSession(a.scope!.id))!;
    setTestClock(null);
    const m = summaryModel((p) => {
      const line = p.lines.find((l) => /don't take an extra tablet/i.test(l.text)) ?? p.lines.find((l) => l.by === "doctor") ?? p.lines[0];
      return { points: [{ text: "医生提醒不要自己额外加服药片。", lines: [line.id] }] };
    });
    setSummaryTestDeps({ llm: m.llm, spend: null, aiAllowed: true, locale: "zh-Hans", everyMs: 10 });
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    // what the realtime replay does at each sentence's end (lib/visit/replay.ts): processChunk, with the account's scope row
    await processChunk(store, scope, "v3", fixtureUtterances("v3")!);
    await liveSummaryIdle(scope.id, "v3");
    expect(m.calls.filter((c) => c.stage === "live").length).toBeGreaterThanOrEqual(1);
    expect(events(scope.id).some((e) => (e.data as { visit_id: string; stage: string }).visit_id === "v3" && (e.data as { stage: string }).stage === "live")).toBe(true);

    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId), { llm: null });
    for (let i = 0; i < 100 && !(await store.listVisitItems(scope.id, { visit_id: "v3" })).some(isSummaryItem); i++) await new Promise((r) => setTimeout(r, 10));
    const view = (await buildVisitView(store, scope.id, "v3", { session: scope }))!;
    expect(view.account?.summary?.points.map((p) => p.text)).toEqual(["医生提醒不要自己额外加服药片。"]);
    expect(m.calls.some((c) => c.stage === "final")).toBe(true);
  });
});

describe("how the screens draw it", () => {
  it("named as Ripple's and as not confirmed, each point a bullet, in its language; the words of both screens", () => {
    const live = renderToStaticMarkup(
      createElement(RippleNotes, { title: vw("zh-Hans", "live.notes"), note: vw("zh-Hans", "live.notesNote"), points: ["医生开了 amlodipine。", "医生提醒不要自己改变剂量。"], lang: "zh-Hans", testId: "visit-notes", live: true }),
    );
    expect(live).toContain('data-testid="visit-notes"');
    expect(live).toContain('aria-live="polite"');
    expect(live).toContain("实时总结");
    expect(live).toContain("Ripple 根据录到的话整理，未经确认");
    expect(live).toContain('<ul class="rpu-visit-notes" lang="zh-Hans">');
    expect(live.match(/data-testid="visit-notes-point"/g)).toHaveLength(2);
    expect(vw("en", "live.notes")).toBe("Live summary");
    expect(vw("en", "live.notesNote")).toBe("Ripple's notes from what was said; not confirmed");
    const review = renderToStaticMarkup(createElement(RippleNotes, { title: vw("en", "review.notes"), note: vw("en", "review.notesNote"), points: ["The doctor started amlodipine."], lang: "en", testId: "review-notes" }));
    expect(review).toContain("Ripple&#x27;s summary");
    expect(review).toContain("Ripple&#x27;s notes from the recording; not confirmed. The doctor&#x27;s own words are below.");
    expect(review).not.toContain("aria-live");
    expect(vw("zh-Hans", "review.notes")).toBe("Ripple 的总结");
  });
});

describe("never a source", () => {
  const MARK = "The doctor asked him not to change the dose himself, quokka.";

  it("a verdict on it is refused; the candidates skip it even when its row says confirmed; an answer never quotes it", async () => {
    const { scope } = await account();
    const speech = getSpeechProvider();
    const visitId = await recordingVisit(scope);
    const job = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
    await finalizeVisit(store, scope, visitId, await speech.getFileJob(job.jobId), { llm: null });
    const m = summaryModel((p) => ({ points: [{ text: MARK, lines: [p.lines.find((l) => /don't change the dose/.test(l.text))!.id] }] }));
    expect(await writeFinalSummary(store, scope, visitId, { llm: m.llm, aiAllowed: true, spend: null, locale: "en" })).not.toBeNull();

    // he cannot answer it: it is not one of the visit's items to him
    await expect(setItemVerdict(store, scope, visitId, { items: [summaryItemId(visitId)], verdict: "right" })).rejects.toMatchObject({ code: "invalid" });
    // every line of the record he says is right, so the doctor's own words are sources
    const items = (await store.listVisitItems(scope.id, { visit_id: visitId })).filter((i) => !isSummaryItem(i) && i.type !== "consent" && i.slots?.superseded !== true);
    await setItemVerdict(store, scope, visitId, { items: items.map((i) => i.id), verdict: "right" });
    // and even a row that somehow says it is confirmed is not a source
    const row = (await store.listVisitItems(scope.id, { visit_id: visitId })).find(isSummaryItem)!;
    await store.updateVisitItem(scope.id, row.id, { confirmed_by: "patient" });

    const set = await buildCandidates(store, scope.id, { day: scope.story_day, time: null, route: "explain", topics: ["dose_change", "instruction"] });
    expect(set.list.length).toBeGreaterThan(0);
    expect(JSON.stringify(set.list)).not.toContain("quokka");
    expect(set.list.some((c) => /don't change the dose/.test(c.span))).toBe(true);

    for (const question of ["Can I change the dose myself?", "我可以自己改剂量吗？", "What did the doctor say at my visit?"]) {
      const result = await ask(
        { sessionId: scope.id, text: question, role: "patient" },
        { store, llm: createMockLlm(), checker: null, checkerReason: "no checker in unit tests", publish: () => {}, costGuard: null, aiAllowed: true },
      );
      expect(JSON.stringify(result), question).not.toContain("quokka");
    }
  });
});
