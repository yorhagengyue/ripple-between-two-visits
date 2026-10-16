/**
 * An answer from a visit that has not happened yet is not shown (10-10, the D42-morning glitch). The seed is the story's
 * end state: q-extra-tablet is answered at the D42 visit, q-machine at D0, q-knee-1 at D8, q-relative-box at the D12
 * pharmacy. On the visit's own day the answer counts only once it has been said by the story moment
 * (lib/safety/line-state.ts answerSaid, the rule the sources follow): the visit has happened (this session holds its
 * record, or the clock has no time of day) and a seeded answer for a replayed or recording visit is in that record.
 * Until then the question waits for the visit, the same on every screen that counts it:
 *   /p/questions (questionsView)   status open (等下次看诊问), no answer line
 *   Today's count (openQuestionCount), her count (familyView questions.waiting), the brief (buildBrief, GET /api/brief)
 * Checked before (D42 08:45 and 09:30, D0 08:00, D8 09:00, D12 10:00), mid-replay, and after the replay and his
 * confirmation; with no clock time the whole day counts, as before. Her visit records follow the same clock.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances } from "@/lib/asr";
import { openQuestionCount, questionsView } from "@/lib/daily/questions";
import { familyView } from "@/lib/family/view";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildBrief } from "@/lib/summary/brief";
import { confirmVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import { finalizeReplay, replayLive } from "../visit/helpers";

const D42_ANSWER =
  "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.";
const D0_ANSWER = "手腕的不太准。买一个绑手臂的，upper arm 的。";
const D12_ANSWER = "The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit.";
const R1 = "At home, we want it below 135 over 85.";

async function sessionAt(day: number, time: string | null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

/** The sample replay through the visit pipeline, the whole-visit pass, and his confirmation of every answer it holds. */
async function replayAndConfirm(s: SessionRow, visit: string) {
  await replayLive(s, visit);
  const view = await finalizeReplay(s, visit);
  const items: Record<string, "right"> = {};
  for (const q of view.qlist?.items ?? []) if (q.answer?.itemId) items[q.answer.itemId] = "right";
  return confirmVisit(getMemoryStore(), s, visit, { mine: view.lines.filter((l) => l.role === "patient").map((l) => l.id), items });
}

interface Row {
  status: string;
  answer: string | null;
  chip: string | null;
  inferred: boolean | null;
}

/** What each screen shows for the session as it is now: the list, Today's count, the brief, her count. */
async function seen(sessionId: string) {
  const store = getMemoryStore();
  const s = (await store.getSession(sessionId))!;
  const view = await questionsView(store, s, "zh-Hans");
  const all = [...view.doctor, ...view.pharmacist];
  const list: Record<string, Row> = Object.fromEntries(
    all.map((q) => [q.id, { status: q.status, answer: q.answer?.text ?? null, chip: q.answer?.chip.kind ?? null, inferred: q.answer ? !!q.answer.chip.inferred : null }]),
  );
  const count = await openQuestionCount(store, s);
  const brief = (await buildBrief(store, s, "zh-Hans")).questions.shown.map((q) => q.id);
  const her = (await familyView(store, s)).questions?.waiting ?? null;
  // one rule on every screen: Today's count, her count and the list's waiting questions agree
  expect(her, "her count").toBe(count);
  expect(all.filter((q) => q.status === "open").length, "the list's waiting questions").toBe(count);
  return { list, count, brief };
}

const WAITING = { status: "open", answer: null, chip: null, inferred: null };

describe("D42: q-extra-tablet waits until the third visit answers it", () => {
  it("08:45 and 09:30, before the visit: waiting on the list, counted on Today and for her, in the morning brief", async () => {
    for (const time of ["08:45", "09:30"]) {
      const s = await sessionAt(42, time);
      const { list, count, brief } = await seen(s.id);
      expect(list["q-extra-tablet"], time).toEqual(WAITING);
      expect(count, time).toBe(3); // q-extra-tablet, q-tai-chi, q-knee-2
      expect(brief, time).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    }
  });

  it("with no clock time the whole day counts (as before): the seed's answer, Dr Lim's words", async () => {
    const { list, count, brief } = await seen((await sessionAt(42, null)).id);
    expect(list["q-extra-tablet"]).toEqual({ status: "answered", answer: D42_ANSWER, chip: "doctor", inferred: false });
    expect(count).toBe(2);
    expect(brief).toEqual(["q-tai-chi", "q-knee-2"]);
  });

  it("mid-replay: still waiting when he asks it (v3-u18), answered once Dr Lim says it (v3-u19, 推断：医生 until he confirms)", async () => {
    const s = await sessionAt(42, "09:30");
    await startVisit(getMemoryStore(), s, { mode: "replay", fixture: "v3" });
    for (const u of fixtureUtterances("v3")!) {
      await processChunk(getMemoryStore(), s, "v3", [u]);
      if (u.id === "v3-u18") {
        const at18 = await seen(s.id);
        expect(at18.list["q-extra-tablet"], "v3-u18").toEqual(WAITING);
        expect(at18.brief, "v3-u18").toContain("q-extra-tablet");
      }
      if (u.id === "v3-u19") {
        const at19 = await seen(s.id);
        expect(at19.list["q-extra-tablet"], "v3-u19").toEqual({ status: "answered", answer: D42_ANSWER, chip: "doctor", inferred: true });
        expect(at19.brief, "v3-u19").not.toContain("q-extra-tablet");
      }
    }
  });

  it("after the v3 replay and his confirmation: Dr Lim's words (医生说); Today, her count and the brief drop it", async () => {
    const s = await sessionAt(42, "09:30");
    await replayAndConfirm(s, "v3");
    const { list, brief } = await seen(s.id);
    expect(list["q-extra-tablet"]).toEqual({ status: "answered", answer: D42_ANSWER, chip: "doctor", inferred: false });
    for (const id of ["q-extra-tablet", "q-tai-chi", "q-knee-2"]) {
      expect(list[id]?.status, id).toBe("answered");
      expect(brief, id).not.toContain(id);
    }
  });
});

describe("the same at the first visit (D0), the second (D8) and the pharmacy (D12)", () => {
  it("D0 08:00, before the 09:30 visit: q-machine waits; no clock time: answered; after the v1 replay and his confirmation: Dr Lim's words", async () => {
    const before = await seen((await sessionAt(0, "08:00")).id);
    expect(before.list["q-machine"]).toEqual(WAITING);
    expect(before.count).toBe(1);
    expect(before.brief).toEqual(["q-machine"]);
    const wholeDay = await seen((await sessionAt(0, null)).id);
    expect(wholeDay.list["q-machine"]).toMatchObject({ status: "answered", answer: D0_ANSWER, chip: "doctor" });
    expect(wholeDay.count).toBe(0);
    const s = await sessionAt(0, "09:30");
    await replayAndConfirm(s, "v1");
    const after = await seen(s.id);
    expect(after.list["q-machine"]).toEqual({ status: "answered", answer: D0_ANSWER, chip: "doctor", inferred: false });
    expect(after.brief).not.toContain("q-machine");
  });

  it("D8 09:00, before the second visit: q-knee-1 (asked there) waits, and the relative's box from that day", async () => {
    const { list, count, brief } = await seen((await sessionAt(8, "09:00")).id);
    expect(list["q-knee-1"]).toEqual(WAITING);
    expect(list["q-relative-box"]).toEqual(WAITING);
    expect(count).toBe(2);
    expect(brief).toEqual(["q-knee-1"]); // the pharmacist's question is not on the doctor's brief
  });

  it("D12 10:00, before the pharmacy: q-relative-box waits; no clock time: answered; after the p1 replay and his confirmation: the pharmacist's words", async () => {
    const before = await seen((await sessionAt(12, "10:00")).id);
    expect(before.list["q-relative-box"]).toEqual(WAITING);
    expect(before.count).toBe(1);
    const wholeDay = await seen((await sessionAt(12, null)).id);
    expect(wholeDay.list["q-relative-box"]).toMatchObject({ status: "answered", answer: D12_ANSWER, chip: "pharmacist" });
    expect(wholeDay.count).toBe(0);
    const s = await sessionAt(12, "11:00");
    await replayAndConfirm(s, "p1");
    const after = await seen(s.id);
    expect(after.list["q-relative-box"]).toMatchObject({ status: "answered", answer: D12_ANSWER, chip: "pharmacist" });
    expect(after.count).toBe(0);
  });
});

describe("her visit records follow the same clock (visit_transcripts on)", () => {
  it("a visit on the story day shows once it has happened: not at D0 08:00 or D42 08:45, there after the replay", async () => {
    const store = getMemoryStore();
    const herView = async (s: SessionRow) => {
      await store.setFamilyGrant(s.id, "wei-ling", { visit_transcripts: true });
      return familyView(store, (await store.getSession(s.id))!);
    };
    const d0 = await herView(await sessionAt(0, "08:00"));
    expect(d0.visits).toEqual([]);
    expect(JSON.stringify(d0)).not.toContain(R1);
    expect((await herView(await sessionAt(0, null))).visits?.map((v) => v.id)).toEqual(["v1"]);
    const d42 = await herView(await sessionAt(42, "08:45"));
    expect(d42.visits?.map((v) => v.id)).toEqual(["p1", "v2", "v1"]);
    expect(JSON.stringify(d42)).not.toContain(D42_ANSWER);
    const s = await sessionAt(42, "09:30");
    await replayLive(s, "v3");
    const after = await herView(s);
    expect(after.visits?.map((v) => v.id)).toEqual(["v3", "p1", "v2", "v1"]);
    expect(after.visits![0].lines.map((l) => l.text)).toContain(D42_ANSWER);
  });
});
