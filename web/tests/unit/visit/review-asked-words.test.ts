/**
 * 「你问：」 in the review is his own words, as his question list has them (C2 track F, fix round; found by the example
 * account's whole-line journey, web/progress/g.md 「旅程查到的」 6).
 *
 * The example's list holds 「读数高的时候（例如 150/95）可以多吃一粒吗？」 for the question Ripple refused on day 29: a recorded
 * summary, not what he typed. Once he asks it himself today (「今天 150/95，我能不能多吃一粒？」), his question list shows his
 * own words; the review showed the summary under 「你问：」. Now the visit view carries the words his list shows and whose
 * they are (lib/daily/questions.ts questionWords), and the review says 「你问：」 only in front of his own.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { reviewEntries } from "@/components/visit/elder/AccountReview";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { questionsView } from "@/lib/daily/questions";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import type { VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();
const HERO = "今天 150/95，我能不能多吃一粒？";
const SUMMARY = "读数高的时候（例如 150/95）可以多吃一粒吗？";
const saved = { ...process.env };

beforeAll(() => {
  process.env.LLM_PROVIDER = "mock";
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => {
  process.env = saved;
  setTestClock(null);
});

async function example(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `aw${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}

async function sampleVisit(scope: SessionRow): Promise<VisitView> {
  await startVisit(store, scope, { mode: "replay", fixture: "v3" });
  await processChunk(store, scope, "v3", fixtureUtterances("v3")!);
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
  await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
  return (await buildVisitView(store, scope.id, "v3", { session: scope }))!;
}

const extraTablet = (view: VisitView) => view.qlist!.items.find((q) => q.questionId === "q-extra-tablet")!;
const answerEntry = (view: VisitView) => reviewEntries(view).find((e) => e.text.startsWith("No, please don't take an extra tablet"))!;

describe("the question a line of the review answers", () => {
  it("he asked it himself today: the review shows his own words under 「你问：」, the words his question list shows", async () => {
    const { a, scope } = await example();
    const res = await askPost(
      new NextRequest("http://localhost/api/ask", { method: "POST", headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ text: HERO, locale: "zh-Hans" }) }),
    );
    expect(res.status).toBe(200);
    // the row itself keeps the summary; his list shows his words (track B's rule)
    expect((await store.getQuestion(scope.id, "q-extra-tablet"))!.text).toBe(SUMMARY);
    const list = await questionsView(store, scope, "zh-Hans");
    expect(list.doctor.find((q) => q.id === "q-extra-tablet")).toMatchObject({ text: HERO, wording: "own_words" });

    const view = await sampleVisit(scope);
    expect(extraTablet(view)).toMatchObject({ text: { own: HERO }, wording: "own_words" });
    // Dr Lim's answer to it is paired as before (the pairing reads the row, not the words shown)
    expect(extraTablet(view).answer).toMatchObject({ text: expect.stringContaining("please don't take an extra tablet") });
    expect(answerEntry(view)).toMatchObject({ question: HERO, questionOwn: true });
    expect(JSON.stringify(reviewEntries(view))).not.toContain(SUMMARY);
  });

  it("he never worded it himself: the summary is shown as a question on his list, never as what he asked", async () => {
    const { scope } = await example();
    const view = await sampleVisit(scope);
    expect(extraTablet(view)).toMatchObject({ text: { own: SUMMARY }, wording: "recorded_summary" });
    expect(answerEntry(view)).toMatchObject({ question: SUMMARY, questionOwn: false });
    // a question he wrote himself is his own words; the one Ripple worded from his records is not
    const byId = new Map(view.qlist!.items.map((q) => [q.questionId, q]));
    expect(byId.get("q-knee-2")).toMatchObject({ wording: "own_words" });
    expect(byId.get("q-tai-chi")).toMatchObject({ wording: "pattern" });
    for (const e of reviewEntries(view).filter((x) => x.question)) {
      const item = view.qlist!.items.find((q) => q.answer?.itemId && e.itemIds.includes(q.answer.itemId))!;
      expect(e.questionOwn, e.question!).toBe(item.wording === "own_words");
    }
  });

  it("the demo's view is unchanged: no wording, the row's own text", async () => {
    const { newSession } = await import("./helpers");
    const demo = await newSession({ story_day: 42 });
    await startVisit(store, demo, { mode: "replay", fixture: "v3" });
    const view = (await processChunk(store, demo, "v3", fixtureUtterances("v3")!)).view;
    const q = view.qlist!.items.find((x) => x.questionId === "q-extra-tablet")!;
    expect(q.text.own).toBe(SUMMARY);
    expect("wording" in q).toBe(false);
  });
});
