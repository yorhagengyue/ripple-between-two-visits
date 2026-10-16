/**
 * Which medicines count at a moment (C2 track S, round 2; real-app 12 「第 42 天看诊前，简报就列出当天才开的 Losartan」,
 * 「medsOnDay 按看诊时刻算」): one rule, lib/meds/on-day.ts medsOnDayAt, for the medicine list, the brief, and the sources and
 * the classifier of an ask. Losartan is prescribed at the D42 visit (09:30 in the story): before that visit has happened in
 * this session it is on no list; once the visit is replayed (or the clock has no time of day: the whole day) it is.
 */
import { describe, expect, it } from "vitest";
import { createMockLlm } from "@/lib/llm";
import { listMedGroups } from "@/lib/meds/list";
import { medsOnDayAt, prescribingLines } from "@/lib/meds/on-day";
import { ask, buildCandidates, medsOnDay } from "@/lib/safety";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildBrief } from "@/lib/summary/brief";
import { finalizeReplay, replayLive } from "../visit/helpers";

async function sessionAt(day: number, time: string | null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

const ids = (meds: { id: string }[]) => meds.map((m) => m.id).sort();

/** The same answer from the three readers: the medicine list, the brief, the ask's sources. */
async function everywhere(s: SessionRow) {
  const store = getMemoryStore();
  const fresh = (await store.getSession(s.id))!;
  const list = (await listMedGroups(store, s.id, fresh.story_day, "en", fresh.story_time)).flatMap((g) => g.items);
  const brief = (await buildBrief(store, fresh, "en")).meds;
  const cands = await buildCandidates(store, s.id, { day: fresh.story_day, route: "explain", topics: ["purpose"] });
  return { list: ids(list), brief: ids(brief), sources: ids(cands.meds) };
}

describe("one rule for which medicines are his at a moment", () => {
  it("D42 08:45, before the visit: losartan is on no list (the medicine list, the brief, the ask's sources)", async () => {
    const seen = await everywhere(await sessionAt(42, "08:45"));
    expect(seen.list).not.toContain("med-losartan");
    expect(seen.brief).toEqual(seen.list);
    expect(seen.sources).toEqual(seen.list);
    expect(seen.list).toContain("med-amlodipine");
  });

  it("D42 with no time of day (the whole day), and D43: losartan is on all three", async () => {
    for (const s of [await sessionAt(42, null), await sessionAt(43, "08:00")]) {
      const seen = await everywhere(s);
      expect(seen.list).toContain("med-losartan");
      expect(seen.brief).toEqual(seen.list);
      expect(seen.sources).toEqual(seen.list);
    }
  });

  it("D42 09:30, once the visit is replayed in this session: losartan is on all three, and not new to the doctor who prescribed it", async () => {
    const s = await sessionAt(42, "09:30");
    expect((await everywhere(s)).brief).not.toContain("med-losartan");
    await replayLive(s, "v3");
    await finalizeReplay(s, "v3");
    const seen = await everywhere(s);
    expect(seen.list).toContain("med-losartan");
    expect(seen.brief).toEqual(seen.list);
    expect(seen.sources).toEqual(seen.list);
  });

  it("an ask before the D42 visit is not about losartan: his prescriptions are the one he has", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(42, "08:45");
    const r = await ask({ sessionId: s.id, text: "我的降压药是做什么的？", locale: "zh-Hans" }, { store, llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
    const cited = r.sentences.map((x) => x.sourceId).join(" ");
    expect(cited).not.toMatch(/losartan/);
    expect(r.route).toBe("explain");
    // the whole day (no clock time): both medicines are his
    const whole = await sessionAt(42, null);
    const [meds, visits] = await Promise.all([store.listMeds(whole.id), store.listVisits(whole.id)]);
    const lines = await prescribingLines(store, whole.id, meds, visits, 42);
    expect(ids(medsOnDayAt(meds, visits, { day: 42, time: null }, lines))).toContain("med-losartan");
    expect(ids(medsOnDayAt(meds, visits, { day: 42, time: "08:45" }, lines))).not.toContain("med-losartan");
    // lib/safety's medsOnDay is the same rule for a whole day
    expect(ids(medsOnDay(meds, visits, 42, lines))).toEqual(ids(medsOnDayAt(meds, visits, { day: 42, time: null }, lines)));
    expect(ids(medsOnDay(meds, visits, 41, lines))).not.toContain("med-losartan");
  });

  it("an account's visit that prescribed a medicine counts only with a record: a planned visit never does", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(10, null);
    await store.upsertVisit(s.id, { id: "v-planned", day: 9, date: "2026-09-02", kind: "clinic", place: "Clinic", status: "planned" });
    await store.upsertMed(s.id, { id: "med-planned", drug_id: "losartan", origin: "prescription", status: "awaiting_label", start_day: null, prescribed_visit_id: "v-planned", label: null });
    const [meds, visits] = await Promise.all([store.listMeds(s.id), store.listVisits(s.id)]);
    const lines = await prescribingLines(store, s.id, meds, visits, 10);
    expect(lines.has("v-planned")).toBe(false);
    expect(ids(medsOnDayAt(meds, visits, { day: 10, time: null }, lines))).not.toContain("med-planned");
    expect(ids((await buildBrief(store, (await store.getSession(s.id))!, "en")).meds)).not.toContain("med-planned");
    expect(ids((await buildCandidates(store, s.id, { day: 10, route: "explain", topics: ["purpose"] })).meds)).not.toContain("med-planned");
  });
});
