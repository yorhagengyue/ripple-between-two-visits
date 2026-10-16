/**
 * lib/visit/read-once.ts: one request reads each of his tables once, a narrower read is answered from the wider one,
 * and nothing is ever answered from before a write that could have changed it (C2 track F, fix round).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, Store } from "@/lib/store/types";
import { isReadOnce, readOnce, warm } from "@/lib/visit/read-once";
import { countingStore, type CountingStore } from "../../support/counting-store";
import { newSession } from "./helpers";

const store = getMemoryStore();
let s: SessionRow;
let c: CountingStore<Store>;
let once: Store;

beforeEach(async () => {
  s = await newSession({ story_day: 12 });
  c = countingStore(store as Store);
  once = readOnce(c.store);
});

describe("reads", () => {
  it("the same read twice asks the store once; each caller gets its own copy", async () => {
    const a = await once.listVisits(s.id);
    const b = await once.listVisits(s.id);
    expect(c.count.byMethod).toEqual({ listVisits: 1 });
    expect(b).toEqual(a);
    a[0].place = "changed by one caller";
    expect((await once.listVisits(s.id))[0].place).not.toBe("changed by one caller");
    // an empty filter is the same read
    await once.listVisitItems(s.id);
    await once.listVisitItems(s.id, {});
    expect(c.count.byMethod.listVisitItems).toBe(1);
  });

  it("asked for together, then everything narrower comes from memory, and says what the store itself says", async () => {
    await warm([once.listVisits(s.id), once.listVisitItems(s.id), once.listMeds(s.id), once.listQuestions(s.id), once.listBp(s.id), once.listDoses(s.id), once.listNotes(s.id)]);
    const asked = { ...c.count.byMethod };
    expect(c.count.rounds).toBe(1);
    expect(await once.getVisit(s.id, "v2")).toEqual(await store.getVisit(s.id, "v2"));
    expect(await once.getVisit(s.id, "no-such-visit")).toBeNull();
    expect(await once.getMed(s.id, "med-amlodipine")).toEqual(await store.getMed(s.id, "med-amlodipine"));
    expect(await once.getQuestion(s.id, "q-knee-2")).toEqual(await store.getQuestion(s.id, "q-knee-2"));
    expect(await once.listVisitItems(s.id, { visit_id: "v1" })).toEqual(await store.listVisitItems(s.id, { visit_id: "v1" }));
    expect(await once.listVisitItems(s.id, { required_only: true })).toEqual(await store.listVisitItems(s.id, { required_only: true }));
    expect(await once.listVisitItems(s.id, { type: "target" })).toEqual(await store.listVisitItems(s.id, { type: "target" }));
    expect(await once.listQuestions(s.id, { status: "open", for: "doctor" })).toEqual(await store.listQuestions(s.id, { status: "open", for: "doctor" }));
    expect(await once.listBp(s.id, { fromDay: 3, toDay: 9 })).toEqual(await store.listBp(s.id, { fromDay: 3, toDay: 9 }));
    expect(await once.listBp(s.id, { toDay: 5 })).toEqual(await store.listBp(s.id, { toDay: 5 }));
    expect(await once.listDoses(s.id, { fromDay: 9, toDay: 12 })).toEqual(await store.listDoses(s.id, { fromDay: 9, toDay: 12 }));
    expect(await once.listDoses(s.id, { medication_id: "med-amlodipine", toDay: 10 })).toEqual(await store.listDoses(s.id, { medication_id: "med-amlodipine", toDay: 10 }));
    expect(await once.listNotes(s.id, { fromDay: 0, toDay: 12 })).toEqual(await store.listNotes(s.id, { fromDay: 0, toDay: 12 }));
    expect(c.count.byMethod).toEqual(asked);
  });

  it("a narrower read with nothing kept fetches the wide list once and keeps it", async () => {
    expect(await once.getVisit(s.id, "v1")).toMatchObject({ id: "v1" });
    expect(await once.getVisit(s.id, "v2")).toMatchObject({ id: "v2" });
    expect(c.count.byMethod).toEqual({ listVisits: 1 });
    // a read the wide list cannot answer is its own read (deleted readings are not in the plain list)
    await once.listBp(s.id, { includeDeleted: true });
    await once.listBp(s.id);
    expect(c.count.byMethod.listBp).toBe(2);
  });

  it("a read that fails is not kept: the next caller asks again", async () => {
    await expect(once.listVisits("no-such-session")).rejects.toThrow();
    await expect(once.listVisits("no-such-session")).rejects.toThrow();
    expect(c.count.byMethod.listVisits).toBe(2);
  });

  it("a readOnce store of a readOnce store is the same store (the pieces of one request share it)", () => {
    expect(isReadOnce(once)).toBe(true);
    expect(isReadOnce(store)).toBe(false);
    expect(readOnce(once)).toBe(once);
  });
});

describe("writes", () => {
  it("an item's answer, a line's speaker, a question's status, a visit's status: the returned row takes its copy's place, nothing is read again", async () => {
    const [items, questions, visits] = await Promise.all([once.listVisitItems(s.id), once.listQuestions(s.id), once.listVisits(s.id)]);
    const item = items[0];
    await once.updateVisitItem(s.id, item.id, { slots: { ...item.slots, verdict: "right" } });
    await once.updateQuestion(s.id, questions[0].id, { status: "skipped" });
    await once.updateVisit(s.id, visits[0].id, { status: "review" });
    expect(await once.listVisitItems(s.id)).toEqual(await store.listVisitItems(s.id));
    expect((await once.listVisitItems(s.id, { visit_id: item.visit_id })).find((i) => i.id === item.id)!.slots.verdict).toBe("right");
    expect(await once.listQuestions(s.id)).toEqual(await store.listQuestions(s.id));
    expect(await once.getQuestion(s.id, questions[0].id)).toMatchObject({ status: "skipped" });
    expect(await once.listVisits(s.id)).toEqual(await store.listVisits(s.id));
    expect(await once.getVisit(s.id, visits[0].id)).toMatchObject({ status: "review" });
    expect(c.count.byMethod).toMatchObject({ listVisitItems: 1, listQuestions: 1, listVisits: 1 });
  });

  it("a write that can change the list's rows or their order drops the list: the next reader gets the store's own answer", async () => {
    await warm([once.listVisits(s.id), once.listQuestions(s.id), once.listMeds(s.id), once.listUtterances(s.id, "v1")]);
    await once.addQuestion(s.id, { for: "doctor", origin: "own", text: "我可以去游泳吗？", lang: "zh-Hans", created_day: 12 });
    await once.upsertVisit(s.id, { id: "v-new", kind: "clinic", place: "Clinic", day: 5 });
    // a visit's day decides its place in the list
    await once.updateVisit(s.id, "v1", { day: 30 });
    await once.addUtterances(s.id, "v1", [{ id: "v1-x01", t_start_ms: 10, t_end_ms: 20, text: "hello" }]);
    await once.updateUtterance(s.id, "v1-x01", { t_start_ms: 5 });
    const med = await once.upsertMed(s.id, { id: "med-new", origin: "prescription", status: "awaiting_label", drug_id: "losartan", label: null, start_day: null, prescribed_visit_id: "v1", note: null, pharmacist_answer: null });
    await once.deleteMed(s.id, med.id);
    expect(await once.listQuestions(s.id)).toEqual(await store.listQuestions(s.id));
    expect(await once.listVisits(s.id)).toEqual(await store.listVisits(s.id));
    expect(await once.listUtterances(s.id, "v1")).toEqual(await store.listUtterances(s.id, "v1"));
    expect(await once.listMeds(s.id)).toEqual(await store.listMeds(s.id));
    await once.deleteVisit(s.id, "v-new");
    expect(await once.getVisit(s.id, "v-new")).toBeNull();
    expect(await once.listVisits(s.id)).toEqual(await store.listVisits(s.id));
  });

  it("a write made straight on the store behind it is not seen (one request, one reading): a new readOnce store sees it", async () => {
    const before = await once.listQuestions(s.id);
    await store.addQuestion(s.id, { for: "doctor", origin: "own", text: "另一个请求写的", lang: "zh-Hans", created_day: 12 });
    expect(await once.listQuestions(s.id)).toEqual(before);
    expect(await readOnce(c.store).listQuestions(s.id)).toHaveLength(before.length + 1);
  });

  it("a write this file does not know drops everything kept", async () => {
    await warm([once.listVisits(s.id), once.listQuestions(s.id)]);
    await once.setStoryDay(s.id, 13);
    await once.listVisits(s.id);
    await once.listQuestions(s.id);
    expect(c.count.byMethod).toMatchObject({ listVisits: 2, listQuestions: 2 });
  });

  it("a write that fails still drops what it could have changed", async () => {
    await once.listVisitItems(s.id);
    await expect(once.updateVisitItem(s.id, "no-such-item", { slots: {} })).rejects.toThrow();
    await once.listVisitItems(s.id);
    expect(c.count.byMethod.listVisitItems).toBe(2);
  });
});
