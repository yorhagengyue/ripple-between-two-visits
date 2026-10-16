/**
 * An account's visit screen counts as the brief does (C2 track F with track B's visitCheckSummary; real-app 4.4
 * 「核对卡和简报用同一口径」, 4.6): on the example's sample visit (v3, Mon 12 Oct) the readings and medicines cards are
 * what a brief opened when the visit started says, the question list carries the brief's three questions, and after he
 * confirms the visit the list still carries those three (answered in Dr Lim's words), not the next ones.
 * The demo keeps its own cards (tests/unit/visit/replay-extract.test.ts: 33 / 29 on the template's v3).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getMemoryStore } from "@/lib/store/memory";
import type { QuestionRow, SessionRow } from "@/lib/store/types";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { visitCheckSummary } from "@/lib/summary/visit-check";
import { setTestClock } from "@/lib/time/now";
import { questionsAsOfStart, visitStartedMs } from "@/lib/visit/account-check";
import { confirmVisit, finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import type { CheckCardView, VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();
const AT = "2026-10-12T10:00:00+08:00";
const START = Date.parse(AT);

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => setTestClock(null));

async function exampleAt(at: string): Promise<SessionRow> {
  setTestClock({ at, frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ac${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return (await store.getSession(a.scope!.id))!;
}

const check = <K extends CheckCardView["check"]>(view: VisitView, anchor: string, kind: K) =>
  view.cards.find((c): c is Extract<CheckCardView, { check: K }> => c.kind === "chk" && c.anchor === anchor && (c as CheckCardView).check === kind)!;
const listedQuestions = (view: VisitView) => view.qlist!.items.filter((q) => q.questionId && !q.questionId.startsWith("rq-")).map((q) => q.questionId);

describe("the example's sample visit on Mon 12 Oct, started at 10:00", () => {
  it("cards and question list equal a brief opened at 10:00; after he confirms, the list keeps the same three", async () => {
    const scope = await exampleAt(AT);
    // a fourth question for Dr Lim, written that morning: the brief shows three and says one more
    await store.addQuestion(scope.id, { for: "doctor", origin: "own", text: "我可以去游泳吗？", lang: "zh-Hans", created_day: 42 });
    // the brief he would show Dr Lim at 10:00, before the visit (once it has lines, the brief counts from it)
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs: START, translate: "cache" });
    const summary = await visitCheckSummary(store, scope, { visit: (await store.getVisit(scope.id, "v3"))!, startedMs: START, locale: "zh-Hans" });
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    const live = (await processChunk(store, scope, "v3", fixtureUtterances("v3")!)).view;

    // his "Around 130": the readings card is the brief's readings line
    const bp = check(live, "v3-u02", "bp");
    expect(bp).toMatchObject({ recorded: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9, fromDate: "2026-09-09", toDate: "2026-10-12" });
    expect(bp).toMatchObject({ recorded: brief.bp.count, unconfirmed: brief.bp.unconfirmed, avgSystolic: brief.bp.avgSystolic, avgDiastolic: brief.bp.avgDiastolic, notBelow: brief.bp.notBelow });
    expect(bp.target).toMatchObject({ systolic: 135, diastolic: 85, quote: "At home, we want it below 135 over 85.", display: "confirmed" });
    expect(bp.bars).toHaveLength(10);
    // "the small white one": the medicines card is the brief's doses line, the label's first line word for word
    const med = check(live, "v3-u04", "med");
    expect(med).toMatchObject({ total: 33, taken: 29, missed: 4, unconfirmed: 0 });
    expect(med).toMatchObject({ total: brief.doses.due, taken: brief.doses.taken, missed: brief.doses.missed, missedDays: brief.doses.missedDays });
    expect(med.meds.map((m) => m.labelLine)).toEqual(["AMLODIPINE 5MG TABLET"]);
    expect(med.routine?.days).toEqual(summary.doses.routine?.weekdays);
    // the question list: Ripple's two (losartan with amlodipine, the blood test) and the brief's three
    expect(live.qlist!.items.map((q) => q.why)).toEqual(["ripple_new_med", "ripple_test", "pattern", "own", "refused_question"]);
    expect(new Set(listedQuestions(live))).toEqual(new Set(brief.questions.shown.map((q) => q.id)));
    expect(new Set(listedQuestions(live))).toEqual(new Set(["q-extra-tablet", "q-tai-chi", "q-knee-2"]));
    expect(brief.questions.more).toBe(1);

    // the whole record, then he confirms every item: the three are answered in Dr Lim's words
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
    const items = (await store.listVisitItems(scope.id, { visit_id: "v3" })).filter((i) => i.slots?.superseded !== true);
    setTestClock({ at: "2026-10-12T11:30:00+08:00", frozen: true });
    const review = (await buildVisitView(store, scope.id, "v3"))!;
    const mine = review.lines.filter((l) => l.role === "patient").map((l) => l.id);
    await confirmVisit(store, scope, "v3", { mine, items: Object.fromEntries(items.map((i) => [i.id, "right" as const])) });
    const answered = (await store.listQuestions(scope.id)).filter((q) => ["q-extra-tablet", "q-tai-chi", "q-knee-2"].includes(q.id));
    expect(answered.map((q) => [q.id, q.status, q.answer_visit_id])).toEqual(
      expect.arrayContaining([
        ["q-extra-tablet", "answered", "v3"],
        ["q-tai-chi", "answered", "v3"],
        ["q-knee-2", "answered", "v3"],
      ]),
    );
    // the fourth question is still open and now first in line for the brief, but this visit's list stays as it was at 10:00
    const after = (await buildVisitView(store, scope.id, "v3"))!;
    expect(new Set(listedQuestions(after))).toEqual(new Set(["q-extra-tablet", "q-tai-chi", "q-knee-2"]));
    expect(after.qlist!.items.every((q) => q.state === "done")).toBe(true);
    // still the card of 10:00
    expect(check(after, "v3-u04", "med")).toMatchObject({ total: 33, taken: 29 });
  });

  it("laid out at 07:00, 吃了 at 08:52, a reading at 10:30: the card counts 34 / 30 and the ten readings before 10:00", async () => {
    const scope0 = await exampleAt("2026-10-12T07:00:00+08:00");
    setTestClock({ at: "2026-10-12T08:52:00+08:00", frozen: true });
    const { answerDose } = await import("@/lib/daily/doses");
    await answerDose(store, (await store.getSession(scope0.id))!, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, Date.parse("2026-10-12T08:52:00+08:00"));
    setTestClock({ at: AT, frozen: true });
    const scope = (await store.getSession(scope0.id))!;
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    const lines = fixtureUtterances("v3")!;
    await processChunk(store, scope, "v3", lines.slice(0, 6));
    setTestClock({ at: "2026-10-12T10:30:00+08:00", frozen: true });
    await store.addBp(scope.id, { day: 42, slot: "morning", systolic: 150, diastolic: 95 });
    const view = (await processChunk(store, scope, "v3", lines.slice(6))).view;
    expect(check(view, "v3-u04", "med")).toMatchObject({ total: 34, taken: 30, missed: 4, unconfirmed: 0 });
    expect(check(view, "v3-u02", "bp")).toMatchObject({ recorded: 10, avgSystolic: 140, avgDiastolic: 85 });
  });
});

describe("a blank account: a question he wrote that morning", () => {
  it("is on the visit's list, as it is on the brief", async () => {
    setTestClock({ at: "2026-10-12T08:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ab${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    let scope = (await store.getSession(a.scope!.id))!;
    const q = await store.addQuestion(scope.id, { for: "doctor", origin: "own", text: "我可以去游泳吗？", lang: "zh-Hans", created_day: scope.story_day });
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    scope = (await store.getSession(scope.id))!;
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs: Date.parse("2026-10-12T09:30:00+08:00"), translate: "cache" });
    expect(brief.questions.shown.map((x) => x.id)).toEqual([q.id]);
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
    const view = await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
    expect(view.visit.day).toBe(q.created_day);
    expect(listedQuestions(view)).toEqual([q.id]);
  });
});

describe("the moment a visit started, and his questions as they stood then", () => {
  it("the consent tap first, else the first line heard, else the row", () => {
    const visit = { id: "x", created_at: "2026-10-12T00:00:00.000Z" };
    const tap = [{ type: "consent" as const, slots: { variant: "screen", at: "2026-10-12T02:00:00.000Z" } }];
    const lines = [{ created_at: "2026-10-12T02:00:09.000Z" }, { created_at: "2026-10-12T02:00:04.000Z" }];
    expect(visitStartedMs(visit, tap, lines)).toBe(Date.parse("2026-10-12T02:00:00.000Z"));
    expect(visitStartedMs(visit, [], lines)).toBe(Date.parse("2026-10-12T02:00:04.000Z"));
    expect(visitStartedMs(visit, [], [])).toBe(Date.parse("2026-10-12T00:00:00.000Z"));
  });

  it("answers given in this visit are taken back, questions written after it started are left out", () => {
    const base = { session_id: "s", for: "doctor", origin: "own", lang: "zh-Hans", answer_speaker: null, asked_at_visit_id: null, created_day: 40, evidence: null } as const;
    const rows: QuestionRow[] = [
      { ...base, id: "a", text: "a", status: "answered", answer_text: "yes", answer_utterance_id: "v3-u19", answer_visit_id: "v3", created_at: "2026-10-01T00:00:00.000Z" },
      { ...base, id: "b", text: "b", status: "answered", answer_text: "no", answer_utterance_id: "v2-u11", answer_visit_id: "v2", created_at: "2026-09-01T00:00:00.000Z" },
      { ...base, id: "c", text: "c", status: "open", answer_text: null, answer_utterance_id: null, answer_visit_id: null, created_at: "2026-10-12T03:00:00.000Z" },
    ];
    const asOf = questionsAsOfStart(rows, "v3", Date.parse("2026-10-12T02:00:00.000Z"));
    expect(asOf.map((q) => [q.id, q.status, q.answer_visit_id])).toEqual([
      ["a", "open", null],
      ["b", "answered", "v2"],
    ]);
  });
});
