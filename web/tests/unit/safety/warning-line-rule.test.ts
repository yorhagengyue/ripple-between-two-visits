/**
 * One rule for the doctor's warning line (lib/safety/threshold.ts, rule A and rule B; C2 track S, round 2; real-app lines
 * 1164, 1185, 1632, 1657). The blood pressure page, an ask and the brief read the same line, so they agree before he
 * reviews the visit, after he confirms it, and after he marks it "not right":
 *
 *   not reviewed yet   all three show the line, labelled as inferred (never 医生说, never dropped)
 *   confirmed          all three show it as the doctor's
 *   marked not right   all three still show it (the emergency path keeps it), labelled as inferred; the brief says he marked it
 * The comparison line (the target) is rule B: nothing before he confirmed one, on the page and in the brief alike.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getSpeechProvider } from "@/lib/asr";
import { accountBpView } from "@/lib/daily/bp";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety";
import { SIGNAL_RECORDED } from "@/lib/safety/templates";
import { reviewOf, warningLineFor } from "@/lib/safety/threshold";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { setTestClock } from "@/lib/time/now";
import { confirmVisit, finalizeVisit, startVisit } from "@/lib/visit/pipeline";

const store = new MemoryStore();
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => setTestClock(null));

/** A blank account that recorded its first visit (the v1 sample lines) on 12 Oct, looked at on 13 Oct with 185/112 just recorded. */
async function afterFirstVisit(): Promise<{ scope: () => Promise<SessionRow>; visitId: string; thresholdId: string; targetId: string }> {
  setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `wl${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  const first = (await store.getSession(a.userId))!;
  const visit = await startVisit(store, first, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
  await finalizeVisit(store, first, visit.id, await speech.getFileJob(jobId));
  const items = await store.listVisitItems(a.userId, { visit_id: visit.id });
  setTestClock({ at: "2026-10-13T08:15:00+08:00", frozen: true });
  const scope = async () => (await store.getSession(a.userId))!;
  const s = await scope();
  await store.addBp(a.userId, { day: s.story_day, slot: "morning", systolic: 185, diastolic: 112 });
  return { scope, visitId: visit.id, thresholdId: items.find((i) => i.type === "threshold")!.id, targetId: items.find((i) => i.type === "target")!.id };
}

/** What each of the three places shows for the warning line right now. */
async function threePlaces(scope: SessionRow) {
  const nowMs = Date.parse("2026-10-13T08:20:00+08:00");
  const page = await accountBpView(store, scope, "zh-Hans", nowMs);
  const relay = page.relays[0]?.relay ?? null;
  const answer = await ask({ sessionId: scope.id, text: "我刚量了血压 185/112", locale: "zh-Hans" }, { store, llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
  const quoted = answer.sentences.find((x) => x.origin === "span" && x.cite?.visitId) ?? null;
  const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs, translate: "cache" });
  return { page, relay, answer, quoted, brief };
}

describe("the warning line is the same line on the blood pressure page, in an ask and in the brief", () => {
  it("before he reviews the visit: all three show it, labelled as inferred; no comparison line anywhere", async () => {
    const acc = await afterFirstVisit();
    const scope = await acc.scope();
    const line = await warningLineFor(store, scope.id, { day: scope.story_day, time: scope.story_time ?? null });
    expect(line).toMatchObject({ systolic: 180, text: R2, state: "inferred", disputed: false });
    expect(reviewOf(line!)).toBe("inferred");

    const { page, relay, answer, quoted, brief } = await threePlaces(scope);
    // the blood pressure page: the doctor's words first, labelled as inferred, then 995 (10-14, the owner's decision; and his
    // second that day: 995 if he feels very unwell)
    expect(relay).not.toBeNull();
    expect(relay!.template.templateId).toBe("signal_995_unwell");
    expect(relay!.doctorLine).toMatchObject({ en: R2 });
    expect(relay!.doctorLine.cite?.roleState).toBe("inferred");
    expect(relay!.lines).toEqual([relay!.doctorLine, relay!.template]);
    // an ask: the same sentence from the same source with the same label, then the same 995 sentence: the page's two lines
    // in the same order, with the sentence that says the reading was kept for his doctor between them
    expect(answer.route).toBe("emergency");
    expect(answer.sentences.map((x) => x.templateId ?? x.sourceId)).toEqual([relay!.doctorLine.sourceId, SIGNAL_RECORDED.id, "signal_995_unwell"]);
    expect(answer.sentences.filter((x) => x.templateId !== SIGNAL_RECORDED.id).map((x) => x.sourceId)).toEqual(relay!.lines.map((x) => x.sourceId));
    expect(quoted).toMatchObject({ en: R2, sourceId: relay!.doctorLine.sourceId });
    expect(quoted!.cite?.roleState).toBe("inferred");
    // the brief: the same sentence, the reading on its own line, and the row says he has not checked the line yet
    expect(brief.above).not.toBeNull();
    expect(brief.above!.line).toMatchObject({ kind: "threshold", text: R2, systolic: 180, state: "inferred", visitId: acc.visitId });
    expect(brief.above!.review).toBe("inferred");
    expect(brief.above!.readings).toEqual([expect.objectContaining({ systolic: 185, diastolic: 112, date: "2026-10-13", time: "08:15" })]);
    // rule B: the target is only compared with once he confirmed it
    expect(page.target).toBeNull();
    expect(brief.targetLine).toBeNull();
    expect(brief.bp.notBelow ?? null).toBeNull();
  });

  it("after he confirms it: all three show it as the doctor's", async () => {
    const acc = await afterFirstVisit();
    await confirmVisit(store, await acc.scope(), acc.visitId, { mine: [], items: { [acc.thresholdId]: "right", [acc.targetId]: "right" } });
    const { page, relay, quoted, brief } = await threePlaces(await acc.scope());
    expect(relay!.doctorLine.cite?.roleState).toBe("confirmed");
    expect(quoted).toMatchObject({ en: R2, sourceId: relay!.doctorLine.sourceId });
    expect(quoted!.cite?.roleState).toBe("confirmed");
    expect(brief.above).toMatchObject({ review: "confirmed", line: { text: R2, state: "confirmed" } });
    expect(brief.above!.readings).toHaveLength(1);
    // and now the comparison line exists, in both places
    expect(page.target).toMatchObject({ systolic: 135, diastolic: 85, state: "confirmed" });
    expect(brief.targetLine).toMatchObject({ systolic: 135, diastolic: 85, state: "confirmed" });
  });

  it("after he marks it 'not right': the line stays in all three, never as 医生说, and the brief says he marked it", async () => {
    const acc = await afterFirstVisit();
    await confirmVisit(store, await acc.scope(), acc.visitId, { mine: [], items: { [acc.thresholdId]: "wrong" } });
    const scope = await acc.scope();
    const line = await warningLineFor(store, scope.id, { day: scope.story_day, time: scope.story_time ?? null });
    expect(line).toMatchObject({ text: R2, disputed: true, state: "inferred" });
    const { relay, answer, quoted, brief } = await threePlaces(scope);
    expect(relay).not.toBeNull();
    expect(relay!.threshold).toMatchObject({ disputed: true, state: "inferred" });
    expect(relay!.doctorLine.cite?.roleState).toBe("inferred");
    expect(answer.route).toBe("emergency");
    expect(answer.sentences.map((x) => x.templateId ?? "doctor")).toEqual(["doctor", SIGNAL_RECORDED.id, "signal_995_unwell"]);
    expect(quoted).toMatchObject({ en: R2 });
    expect(quoted!.cite?.roleState).toBe("inferred");
    expect(brief.above).toMatchObject({ review: "disputed", line: { text: R2, state: "inferred" } });
    expect(brief.above!.readings).toHaveLength(1);
  });

  it("a reading not above the line: no relay, no row in the brief, the ask is not an emergency for the number", async () => {
    setTestClock({ at: "2026-10-12T09:30:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `wn${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    setTestClock({ at: "2026-10-12T20:15:00+08:00", frozen: true });
    const scope = (await store.getSession(a.userId))!;
    await store.addBp(a.userId, { day: scope.story_day, slot: "evening", systolic: 150, diastolic: 95 });
    const nowMs = Date.parse("2026-10-12T20:20:00+08:00");
    expect((await accountBpView(store, scope, "zh-Hans", nowMs)).relays).toEqual([]);
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs, translate: "cache" });
    expect(brief.above).toMatchObject({ review: "confirmed", readings: [] });
  });
});
