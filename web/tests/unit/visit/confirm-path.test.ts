/**
 * What the review's buttons cost (C2 track F, fix round). The first run against the real database and the real model
 * (10-11, journeys 05 and 06): 「是，医生说的」 answered after about 5 s, 「就这样，存好」 after 9.3 s in one journey and not
 * within 10 s in the other, and an answer changed after confirming did not come back within 10 s either. Nothing was
 * lost and no model was asked: the path simply asked the database one call after another.
 *
 * Counted with tests/support/counting-store.ts (calls / round trips as the Supabase adapter makes them / round trips in
 * sequence), on a blank account's visit as journey 06 has it (the sample second visit: a prescription, the counter's two
 * lines):
 *
 *                              before (c2-real 4bff2ff)        now
 *   the visit view             30 calls, 51 trips, 26 in a row   11, 18, 2
 *   one 「是，医生说的」            36, 58, 33                        13, 20, 4
 *   「就这样，存好」                 72, 108, 66                       19, 25, 6
 *   an answer changed after    64-69, 96-108, 56-62              12-16, 17-22, 3-6
 *
 * (From this machine a round trip to the test database took about 150 ms in that run: 66 in a row is 10 s.)
 *
 * The ceilings below are what the path may cost; a change that makes a button read the store one call after another
 * again turns this red. The same tests hold what makes the saving safe: the view each call returns is the view a fresh
 * read of the store gives (nothing answered from before a write), and no model is created on any of these paths.
 *
 * The last part runs the review on model-shaped output with no model (lib/visit/devfake-extract.ts: the model adds two
 * lines and changes one): the lines nobody scripted are asked like any other, his answer on a line with two items
 * applies to both, and the review ends with the summary and 「就这样，存好」.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reviewEntries } from "@/components/visit/elder/AccountReview";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import * as llm from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitRow } from "@/lib/store/types";
import { scopedStore } from "@/lib/subject/scoped-store";
import { setTestClock } from "@/lib/time/now";
import { DEVFAKE_EXTRACT_ENV, DEVFAKE_EXTRACT_MODE, devfakeExtractor, extractionStandIn } from "@/lib/visit/devfake-extract";
import { confirmVisit, finalizeVisit, processChunk, setItemVerdict, setLineMine, startVisit } from "@/lib/visit/pipeline";
import type { VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";
import { countingStore } from "../../support/counting-store";

vi.mock("@/lib/llm", async (original) => {
  const real = await original<typeof import("@/lib/llm")>();
  return { ...real, createMainLlm: vi.fn(real.createMainLlm), createChecker: vi.fn(real.createChecker) };
});

const store = getMemoryStore();

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
  delete process.env[DEVFAKE_EXTRACT_ENV];
});
afterEach(() => setTestClock(null));

/** Let what the visit's end left running (the translation of the doctor's lines) finish. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const modelsCreated = () => vi.mocked(llm.createMainLlm).mock.calls.length + vi.mocked(llm.createChecker).mock.calls.length;

async function account(space: "blank" | "example"): Promise<{ scope: SessionRow; userId: string }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `cp${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return { scope: (await store.getSession(a.scope!.id))!, userId: a.userId };
}

async function record(scope: SessionRow, fixture: string, model?: LlmClient): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: `fixture:${fixture}`, lang: "zh-en-mixed", fixture });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId), model ? { llm: model } : {});
  await settle();
  return (await store.getVisit(scope.id, visit.id))!;
}

/** The view a fresh read of the store gives, for comparing with what a call returned. */
const fresh = async (scope: SessionRow, visitId: string) => (await buildVisitView(store, scope.id, visitId, { session: scope }))!;
const mineOf = (view: VisitView) => view.lines.filter((l) => l.role === "patient").map((l) => l.id);

describe("how often the review asks the store", () => {
  it("journey 06's visit on a blank account: one answer, the prescription, 「就这样，存好」, an answer changed afterwards", async () => {
    const { scope } = await account("blank");
    const visit = await record(scope, "v2");
    const c = countingStore(store);
    const before = modelsCreated();

    const view = await c.measure(() => buildVisitView(c.store, scope.id, visit.id, { session: scope }));
    expect(view).toMatchObject({ rounds: 2 });
    expect(view.calls).toBeLessThanOrEqual(12);
    expect(view.out).toEqual(await fresh(scope, visit.id));

    const entries = reviewEntries(view.out!);
    expect(entries).toHaveLength(8);
    for (const e of entries) {
      const prescription = e.text.startsWith("Amlodipine, 5 milligrams");
      const followUp = e.text.includes("Come back in five weeks");
      const m = await c.measure(() => setItemVerdict(c.store, scope, visit.id, { items: e.itemIds, verdict: "right" }));
      // two round trips of reads (the second is the adapter's check after an empty list: a blank account has several),
      // the items, then the line; a prescription or a follow-up writes its row and that list is read once more
      expect(m.rounds, e.text).toBeLessThanOrEqual(prescription || followUp ? 6 : 4);
      expect(m.calls, e.text).toBeLessThanOrEqual(prescription || followUp ? 17 : 14);
      expect(m.out, e.text).toEqual(await fresh(scope, visit.id));
    }
    expect((await store.listMeds(scope.id)).map((m) => [m.drug_id, m.status])).toEqual([["amlodipine", "awaiting_label"]]);

    const reviewed = await fresh(scope, visit.id);
    const confirm = await c.measure(() => confirmVisit(c.store, scope, visit.id, { mine: mineOf(reviewed), items: {} }));
    expect(confirm.rounds).toBeLessThanOrEqual(6);
    expect(confirm.calls).toBeLessThanOrEqual(20);
    expect(confirm.out.visit.status).toBe("confirmed");
    expect(confirm.out).toEqual(await fresh(scope, visit.id));
    // every read was made once; what he waits for is the writes, each kind side by side
    expect(Object.entries(confirm.byMethod).filter(([m, n]) => /^(?:list|get)/.test(m) && n > 2)).toEqual([]);

    const last = entries.at(-1)!;
    for (const verdict of ["wrong", "right", "unsure"] as const) {
      const edit = await c.measure(() => setItemVerdict(c.store, scope, visit.id, { items: last.itemIds, verdict }));
      expect(edit.rounds, verdict).toBeLessThanOrEqual(6);
      expect(edit.calls, verdict).toBeLessThanOrEqual(17);
      expect(edit.out, verdict).toEqual(await fresh(scope, visit.id));
    }
    // no model on any of these paths: none was created while he answered, saved and changed an answer
    expect(modelsCreated()).toBe(before);
  });

  it("journey 05's visit: 「不是」 (a question for the doctor), saving, then 「改一下」 back to 「是」 (the follow-up is planned)", async () => {
    const { scope } = await account("blank");
    const visit = await record(scope, "v1");
    const c = countingStore(store);
    const entries = reviewEntries(await fresh(scope, visit.id));
    expect(entries).toHaveLength(7);
    const back = entries.find((e) => e.text.startsWith("Come back in about a week"))!;
    for (const e of entries) {
      const m = await c.measure(() => setItemVerdict(c.store, scope, visit.id, { items: e.itemIds, verdict: e === back ? "wrong" : "right" }));
      expect(m.rounds, e.text).toBeLessThanOrEqual(e === back ? 5 : 4);
      expect(m.out, e.text).toEqual(await fresh(scope, visit.id));
    }
    expect((await store.listQuestions(scope.id)).filter((q) => q.evidence?.startsWith("visit_disputed:") && q.status === "open")).toHaveLength(1);

    const mine = mineOf(await fresh(scope, visit.id));
    const confirm = await c.measure(() => confirmVisit(c.store, scope, visit.id, { mine, items: {} }));
    expect(confirm.out.visit.status).toBe("confirmed");
    expect(confirm.rounds).toBeLessThanOrEqual(6);
    expect(confirm.out).toEqual(await fresh(scope, visit.id));

    const edit = await c.measure(() => setItemVerdict(c.store, scope, visit.id, { items: back.itemIds, verdict: "right" }));
    expect(edit.rounds).toBeLessThanOrEqual(6);
    expect(edit.out).toEqual(await fresh(scope, visit.id));
    expect(edit.out.account?.followUp).toMatchObject({ approx: true });
    expect((await store.listQuestions(scope.id)).filter((q) => q.evidence?.startsWith("visit_disputed:")).map((q) => q.status)).toEqual(["skipped"]);
  });

  it("the example account's sample visit (33 mornings, 24 readings, four seeded visits, three questions answered): the same ceilings", async () => {
    const { scope } = await account("example");
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    await processChunk(store, scope, "v3", fixtureUtterances("v3")!);
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
    await settle();
    const c = countingStore(store);

    const view = await c.measure(() => buildVisitView(c.store, scope.id, "v3", { session: scope }));
    // his tables together, then the other visits' transcripts together (the seeded visits have none: each such read
    // costs the adapter its second round trip)
    expect(view.rounds).toBeLessThanOrEqual(4);
    expect(view.calls).toBeLessThanOrEqual(16);
    expect(view.out).toEqual(await fresh(scope, "v3"));
    expect(view.out!.cards.filter((card) => card.kind === "chk").length).toBeGreaterThan(0);

    const entries = reviewEntries(view.out!);
    for (const e of entries) {
      const m = await c.measure(() => setItemVerdict(c.store, scope, "v3", { items: e.itemIds, verdict: "right" }));
      expect(m.rounds, e.text).toBeLessThanOrEqual(7);
      expect(m.calls, e.text).toBeLessThanOrEqual(20);
      expect(m.out, e.text).toEqual(await fresh(scope, "v3"));
    }
    const mine = mineOf(await fresh(scope, "v3"));
    const confirm = await c.measure(() => confirmVisit(c.store, scope, "v3", { mine, items: {} }));
    expect(confirm.out.visit.status).toBe("confirmed");
    expect(confirm.rounds).toBeLessThanOrEqual(7);
    // (his eight lines and five questions are written side by side: many calls, two round trips)
    expect(confirm.calls).toBeLessThanOrEqual(30);
    expect(confirm.out).toEqual(await fresh(scope, "v3"));
    const answered = (await store.listQuestions(scope.id)).filter((q) => ["q-extra-tablet", "q-tai-chi", "q-knee-2"].includes(q.id));
    expect(answered.map((q) => [q.status, q.answer_visit_id])).toEqual([["answered", "v3"], ["answered", "v3"], ["answered", "v3"]]);
  });

  it("through his own page's store (bound to his space, rows without its id): the same view, and 「是我说的」 costs no more", async () => {
    const { scope, userId } = await account("blank");
    const visit = await record(scope, "v1");
    const c = countingStore(store);
    const his = scopedStore(c.store, scope, "self", { userId, maskSessionId: true });
    const direct = scopedStore(store, scope, "self", { userId, maskSessionId: true });
    const entries = reviewEntries((await buildVisitView(direct, scope.id, visit.id, { session: scope }))!);
    const first = await c.measure(() => setItemVerdict(his, scope, visit.id, { items: entries[0].itemIds, verdict: "right" }));
    expect(first.rounds).toBeLessThanOrEqual(4);
    expect(first.out).toEqual(await buildVisitView(direct, scope.id, visit.id, { session: scope }));
    expect(JSON.stringify(first.out)).not.toContain(scope.id);

    const unclear = first.out.lines.find((l) => l.roleState === "unknown");
    if (unclear) {
      const mine = await c.measure(() => setLineMine(his, scope, visit.id, { line: unclear.id, mine: true }));
      expect(mine.rounds).toBeLessThanOrEqual(4);
      expect(mine.out).toEqual(await buildVisitView(direct, scope.id, visit.id, { session: scope }));
    }
  });
});

describe("a review on model-shaped output, with no model (the stand-in: the model adds two lines and changes one)", () => {
  it("the stand-in is off unless a server was started for it with the developer tools on", () => {
    expect(devfakeExtractor({})).toBeNull();
    expect(devfakeExtractor({ [DEVFAKE_EXTRACT_ENV]: DEVFAKE_EXTRACT_MODE, NODE_ENV: "production" })).toBeNull();
    expect(devfakeExtractor({ [DEVFAKE_EXTRACT_ENV]: "something else", NODE_ENV: "test" })).toBeNull();
    expect(devfakeExtractor({ [DEVFAKE_EXTRACT_ENV]: DEVFAKE_EXTRACT_MODE, NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })?.model).toBe(DEVFAKE_EXTRACT_MODE);
  });

  it("the sample third visit: two lines the rules gave nothing are in the review, one line carries an item more; every line is answered, then saved", async () => {
    const { scope } = await account("blank");
    const rules = reviewEntries(await fresh(scope, (await record(scope, "v3")).id));

    const other = await account("blank");
    const visit = await record(other.scope, "v3", extractionStandIn());
    const view = await fresh(other.scope, visit.id);
    const entries = reviewEntries(view);
    const text = (list: typeof entries) => list.map((e) => e.text);
    // two lines more, each the transcript's own sentence, in their place in time
    expect(entries).toHaveLength(rules.length + 2);
    const added = entries.filter((e) => !text(rules).includes(e.text));
    expect(text(added)).toEqual(["So Mr Tan, how has your blood pressure been at home?", "And your medicine, you take it every day?"]);
    expect(text(entries)).toEqual([...text(entries)].sort((a, b) => entries.find((e) => e.text === a)!.tStartMs - entries.find((e) => e.text === b)!.tStartMs));
    // one line changed: the same sentence, one item more under it
    const changed = entries.filter((e) => {
      const was = rules.find((r) => r.text === e.text);
      return was && was.itemIds.length !== e.itemIds.length;
    });
    expect(changed).toHaveLength(1);
    expect(changed[0].itemIds).toHaveLength(rules.find((r) => r.text === changed[0].text)!.itemIds.length + 1);
    // the model wrote nothing: every item is a line of the transcript, word for word
    const said = new Set(view.lines.map((l) => l.text));
    const fromTheTranscript = (await store.listVisitItems(other.scope.id, { visit_id: visit.id })).filter((it) => it.utterance_ids.length > 0);
    expect(fromTheTranscript.length).toBeGreaterThan(entries.length);
    for (const item of fromTheTranscript) expect(said.has(item.text), item.id).toBe(true);

    // he answers whatever comes up until nothing is left to ask (what the journeys do): 「不记得」 for the lines nobody
    // scripted, 「是」 for the rest; an answer applies to every item of its line
    let current = view;
    for (let i = 0; i < 40; i++) {
      const pending = reviewEntries(current).filter((e) => e.verdict === null);
      if (!pending.length) break;
      const e = pending[0];
      current = await setItemVerdict(store, other.scope, visit.id, { items: e.itemIds, verdict: added.some((a) => a.text === e.text) ? "unsure" : "right" });
    }
    const done = reviewEntries(current);
    expect(done.every((e) => e.verdict !== null)).toBe(true);
    expect(done.filter((e) => e.verdict === "unsure").map((e) => e.text)).toEqual(text(added));
    expect(done.find((e) => e.text === changed[0].text)!.verdict).toBe("right");
    const items = await store.listVisitItems(other.scope.id, { visit_id: visit.id });
    for (const id of changed[0].itemIds) expect(items.find((it) => it.id === id)!.slots.verdict).toBe("right");

    const saved = await confirmVisit(store, other.scope, visit.id, { mine: mineOf(current), items: {} });
    expect(saved.visit.status).toBe("confirmed");
    // a line he did not say 「是」 to is never the doctor's confirmed word
    for (const a of added) expect(saved.lines.find((l) => l.text === a.text)!.roleState).not.toBe("confirmed");
    // (a blank account has no amlodipine yet, so 「We keep amlodipine …, and I'll add losartan」 puts both on his list)
    expect((await store.listMeds(other.scope.id)).map((m) => [m.drug_id, m.status])).toEqual([["amlodipine", "awaiting_label"], ["losartan", "awaiting_label"]]);
  });
});
