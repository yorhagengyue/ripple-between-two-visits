/**
 * Watching a visit again on the demo never changes that visit's labels (C2 follow-up, track E; real-app 12 「重放一次已经确认
 * 过的看诊，不改原来那次的标签（回放写进一份副本）… /demo 上评委也会碰到」).
 *
 * The demo's seed holds every visit as his confirmed record with no transcript. A judge's sandbox sits on Day 29: the
 * first and second visits already happened. Replaying one there is a re-watch, written to a copy:
 *   - the visit itself stays confirmed with no transcript; its lines read 医生说 on every screen, mid-replay too;
 *   - the copy shows what an in-place replay shows (the same lines, cards, clips and question list);
 *   - the copy is never a source, never "the last visit", never on her page; confirming it leaves the story's
 *     questions alone.
 * On the visit's own story day the replay is the visit happening (the crew films it): in place, as before.
 */
import { describe, expect, it } from "vitest";
import { fixtureUtterances } from "@/lib/asr";
import { bpView } from "@/lib/daily/bp";
import { familyView } from "@/lib/family/view";
import { buildCandidates } from "@/lib/safety";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildBrief } from "@/lib/summary/brief";
import { doctorNumbers } from "@/lib/visit/doctor-numbers";
import { copiedFrom, happenedVisits, isReplayCopy } from "@/lib/visit/happened";
import { confirmVisit, finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import type { DocCardView, VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();
const R3 = "visit:v2:R3";
const R4 = "visit:v2:R4";

async function sandboxAt(day: number, time: string | null = null): Promise<SessionRow> {
  return store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

/** Replay `fixture` line by line into the visit startVisit hands back (the copy, or the visit itself). */
async function replay(s: SessionRow, fixture: string, upTo?: number): Promise<{ id: string; view: VisitView }> {
  const visit = await startVisit(store, s, { mode: "replay", fixture });
  let view = (await buildVisitView(store, s.id, visit.id, { session: s }))!;
  for (const u of fixtureUtterances(fixture)!.slice(0, upTo)) view = (await processChunk(store, s, visit.id, [u])).view;
  return { id: visit.id, view };
}

async function labels(s: SessionRow): Promise<Record<string, string | undefined>> {
  const set = await buildCandidates(store, s.id, { day: s.story_day, route: "refuse_route", topics: ["dose_change", "purpose"] });
  const out: Record<string, string | undefined> = {};
  for (const id of [R3, R4]) out[id] = set.byId.get(id)?.cite?.roleState;
  return out;
}

describe("Day 29: the second visit watched again", () => {
  it("is written to a copy: the visit itself stays confirmed, with no transcript", async () => {
    const s = await sandboxAt(29, "20:15");
    const { id } = await replay(s, "v2", 4);
    expect(id).toMatch(/^v2-again-[a-z0-9]{6}$/);
    const copy = (await store.getVisit(s.id, id))!;
    const v2 = (await store.getVisit(s.id, "v2"))!;
    expect([copy.status, copy.day, copy.date, copy.kind, copy.place, copy.audio_fixture]).toEqual(["recording", v2.day, v2.date, v2.kind, v2.place, v2.audio_fixture]);
    expect([isReplayCopy(copy), copiedFrom(copy)]).toEqual([true, "v2"]);
    expect(v2.status).toBe("confirmed");
    expect(await store.listUtterances(s.id, "v2")).toEqual([]);
    expect((await store.listUtterances(s.id, id)).map((u) => u.id)).toEqual([1, 2, 3, 4].map((n) => `${id}-u0${n}`));
  });

  it("left before the end: R3 and R4 are still sources, still 医生说 (they were 推断：医生, or gone, when the replay wrote in place)", async () => {
    const s = await sandboxAt(29, "20:15");
    expect(await labels(s)).toEqual({ [R3]: "confirmed", [R4]: "confirmed" });
    await replay(s, "v2", 4); // not yet at R3 (line 6) or R4 (line 8)
    expect(await labels(s)).toEqual({ [R3]: "confirmed", [R4]: "confirmed" });
    const whole = await sandboxAt(29, "20:15");
    await replay(whole, "v2"); // every line, nothing confirmed
    expect(await labels(whole)).toEqual({ [R3]: "confirmed", [R4]: "confirmed" });
    // no line of the re-watch is a source
    const all = await buildCandidates(store, whole.id, { day: 29, route: "explain", topics: [] });
    expect(all.list.filter((c) => c.sourceId.includes("-again-") || c.cite?.visitId?.includes("-again-"))).toEqual([]);
    // the doctor's numbers and the measuring words on the blood pressure page: the visit's own, as before
    const first = await sandboxAt(29, "20:15");
    const before = { numbers: await doctorNumbers(store, first.id, { day: 29, time: "20:15" }), bp: await bpView(store, first) };
    await replay(first, "v1");
    expect(await doctorNumbers(store, first.id, { day: 29, time: "20:15" })).toEqual(before.numbers);
    expect(await bpView(store, first)).toEqual(before.bp);
    expect(before.numbers.target?.state).toBe("confirmed");
  });

  it("the copy's screen shows what the visit's own replay shows: the lines, the cards with their clips, the question list", async () => {
    const own = await replay(await sandboxAt(8, "10:00"), "v2"); // on its own day: in place
    expect(own.id).toBe("v2");
    const again = await replay(await sandboxAt(29, "20:15"), "v2");
    const shape = (v: VisitView, id: string) => ({
      lines: v.lines.map((l) => [l.id.replace(`${id}-`, ""), l.text, l.role, l.display, !!l.clip, l.inQuestion]),
      cards: v.cards.map((c) => (c.kind === "doc" ? [c.anchor.replace(`${id}-`, ""), (c as DocCardView).rows.map((r) => r.variant).join("+"), c.display, !!(c as DocCardView).clip] : [c.anchor.replace(`${id}-`, ""), c.kind])),
      questions: v.qlist?.items.map((q) => [q.questionId, q.state, q.answer?.text ?? null]),
      counts: v.counts,
    });
    expect(shape(again.view, again.id)).toEqual(shape(own.view, own.id));
    expect(again.view.qlist?.items.map((q) => q.questionId)).toContain("q-knee-1");
    expect(again.view.lines.filter((l) => l.clip).length).toBeGreaterThan(0);
    expect([again.view.rewatch, own.view.rewatch]).toEqual([true, undefined]);
  });

  it("it is never a visit that happened: the brief's window, her page and the visit list's samples are as before", async () => {
    const s = await sandboxAt(29, "20:15");
    // her page with his visits switched on
    const grants = { dose_summary: false, bp_summary: false, questions_count: false, visit_transcripts: true, notes: false, no_reply_alert: false };
    const before = { brief: await buildBrief(store, s, "zh-Hans"), her: (await familyView(store, s, { grants })).visits };
    const { id } = await replay(s, "v2");
    const visits = await store.listVisits(s.id);
    expect(visits.map((v) => v.id)).toContain(id);
    expect((await happenedVisits(store, s.id, visits)).map((v) => v.id).sort()).toEqual(["p1", "v1", "v2", "v3"]);
    expect((await buildBrief(store, s, "zh-Hans")).window).toEqual(before.brief.window);
    const her = (await familyView(store, s, { grants })).visits;
    expect(her?.length).toBeGreaterThan(0);
    expect(her).toEqual(before.her);
    expect(her?.some((v) => v.id === id)).toBe(false);
  });

  it("finished and confirmed: the copy holds his answers; the story's questions and the visit's labels are untouched", async () => {
    const s = await sandboxAt(29, "20:15");
    const questions = await store.listQuestions(s.id);
    const { id } = await replay(s, "v2");
    const lines = fixtureUtterances("v2")!;
    const done = await finalizeVisit(store, s, id, { status: "done", source: "fixture", utterances: lines.map((u) => ({ id: u.id, tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: u.speaker_cluster, text: u.text, lang: u.lang })) });
    expect(done.visit.status).toBe("review");
    const items: Record<string, "right"> = {};
    for (const c of done.cards) if (c.kind === "doc") for (const r of c.rows) items[r.itemId] = "right";
    for (const q of done.qlist?.items ?? []) if (q.answer?.itemId) items[q.answer.itemId] = "right";
    const after = await confirmVisit(store, s, id, { mine: [], items });
    expect(after.visit.status).toBe("confirmed");
    expect(after.rewatch).toBe(true);
    expect(await store.listQuestions(s.id)).toEqual(questions);
    expect((await store.getVisit(s.id, "v2"))!.status).toBe("confirmed");
    expect(await labels(s)).toEqual({ [R3]: "confirmed", [R4]: "confirmed" });
    // watched once more: another copy, the first one stays as he left it
    const second = await replay(s, "v2", 2);
    expect(second.id).not.toBe(id);
    expect(second.id).toMatch(/^v2-again-/);
    expect((await store.getVisit(s.id, id))!.status).toBe("confirmed");
  });
});

describe("on the visit's own day the replay is the visit itself", () => {
  it("Day 8, the second visit: written in place; its lines are 推断 until he confirms (the M4 rule, unchanged)", async () => {
    const s = await sandboxAt(8, "10:00");
    const { id } = await replay(s, "v2");
    expect(id).toBe("v2");
    expect((await store.getVisit(s.id, "v2"))!.status).toBe("recording");
    const set = await buildCandidates(store, s.id, { day: 8, time: "10:00", route: "refuse_route", topics: ["dose_change"] });
    expect(set.byId.get(R4)?.cite?.roleState).toBe("inferred");
  });

  it("Day 42, the third visit; and Day 0 the first: in place too", async () => {
    expect((await replay(await sandboxAt(42, "09:30"), "v3", 2)).id).toBe("v3");
    expect((await replay(await sandboxAt(0, "09:30"), "v1", 2)).id).toBe("v1");
  });

  it("a visit replayed in place on its day and left unconfirmed is not copied later (it is still his to finish)", async () => {
    const s = await sandboxAt(8, "10:00");
    await replay(s, "v2");
    const later = await store.setStoryDay(s.id, 9, "08:00");
    expect((await replay(later, "v2", 1)).id).toBe("v2");
  });
});
