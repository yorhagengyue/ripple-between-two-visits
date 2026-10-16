/**
 * The filming account is laid out in one store call (C2 follow-up; real-app 4.1 「在一个事务里写入」, as track C's example
 * seed since migration 0014): the transcripts of the visits that happened and his profile facts go in with the rest, so a
 * layout cannot be left half-filled. A database whose seed function is older than 0014 ignores the two tables: then
 * ensureLayoutWhole writes exactly what is missing, and a second run writes nothing.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { ensureLayoutWhole, filmingRef, findFilming, layoutAtMoment, markFilming, seedToMoment } from "@/lib/crew/filming-account";
import { MemoryStore } from "@/lib/store/memory";
import type { ReseedAccount, SessionRow } from "@/lib/store/types";
import { filmingEntry } from "@/lib/subject/filming";
import type { Subject } from "@/lib/subject/types";
import { setTestClock } from "@/lib/time/now";

const REAL = Date.parse("2026-10-10T14:00:00+08:00");
const login = () => `one${randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** A subject whose store counts the calls made through it (the subject's own store is a proxy already). */
function counting(subject: Subject): { subject: Subject; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const store = new Proxy(subject.store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== "function" || typeof prop !== "string") return v;
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { subject: { ...subject, store }, calls };
}

describe("the layout's tables carry the transcripts and the facts", () => {
  it("Day 29, 8:15pm: every line of v1, v2 and p1 and every fact is a row of the one call, stamped in the story", () => {
    const lay = layoutAtMoment("scope-x", { day: 29, time: "20:15" });
    const lines = lay.transcripts.flatMap((t) => t.rows.map((u) => `${t.visitId}:${u.id}`));
    expect(lay.tables.utterances.map((u) => `${u.visit_id}:${u.id}`)).toEqual(lines);
    expect(lines.length).toBeGreaterThan(20);
    expect(lay.tables.profile_facts.map((f) => f.id)).toEqual(lay.facts.map((f) => f.id));
    expect(lay.tables.profile_facts.find((f) => f.kind === "name")?.text).toBe("陈先生");
    // every row belongs to this scope and to a visit the layout holds; nothing is stamped after the moment
    const visits = new Set(lay.tables.visits.map((v) => v.id));
    for (const u of lay.tables.utterances) {
      expect(u.session_id).toBe("scope-x");
      expect(visits.has(u.visit_id), u.visit_id).toBe(true);
      expect(Date.parse(u.created_at)).toBeLessThanOrEqual(lay.at);
    }
    for (const f of lay.tables.profile_facts) expect(f.session_id).toBe("scope-x");
  });

  it("the first scene (Day 0, before the visit): no transcript yet, the facts are there", () => {
    const lay = layoutAtMoment("scope-y", { day: 0, time: "09:00" });
    expect(lay.tables.utterances).toEqual([]);
    expect(lay.tables.profile_facts.length).toBe(lay.facts.length);
    expect(lay.facts.length).toBeGreaterThan(0);
  });
});

describe("laying an account out writes it whole", () => {
  const store = new MemoryStore();
  const entry = filmingEntry(store);
  let him: TestAccount;
  const scope = async (): Promise<SessionRow> => (await store.getSession(him.userId))!;

  beforeAll(async () => {
    setTestClock({ at: REAL, frozen: true });
    him = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank", locale: null });
    await markFilming(store, await scope());
  });

  it("one call: no separate write of a transcript or a fact after the reseed", async () => {
    const found = (await findFilming(filmingRef(him.userId), entry))!;
    const { subject, calls } = counting(found);
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    expect(calls.reseedAccount).toBe(1);
    expect(calls.addUtterances ?? 0).toBe(0);
    expect(calls.addProfileFact ?? 0).toBe(0);
    const lay = layoutAtMoment(him.userId, { day: 29, time: "20:15" });
    expect((await store.listProfileFacts(him.userId)).map((f) => f.id).sort()).toEqual(lay.facts.map((f) => f.id!).sort());
    for (const tr of lay.transcripts) expect((await store.listUtterances(him.userId, tr.visitId)).map((u) => u.id)).toEqual(tr.rows.map((u) => u.id));
    // the lines are his confirmed record (as after each review), the doctor's words among them
    const r4 = (await store.listUtterances(him.userId, "v2")).find((u) => u.text.startsWith("Please don't change the dose"));
    expect([r4?.role, r4?.role_state]).toEqual(["doctor", "confirmed"]);
  });

  it("a seed function older than 0014 drops the two tables: the missing rows are written, once", async () => {
    const found = (await findFilming(filmingRef(him.userId), entry))!;
    const { subject, calls } = counting(found);
    // the older function: everything but the transcripts and the facts
    const older = new Proxy(subject.store, {
      get(target, prop, receiver) {
        if (prop !== "reseedAccount") return Reflect.get(target, prop, receiver) as unknown;
        return (id: string, reseed: ReseedAccount) => target.reseedAccount(id, { ...reseed, tables: { ...reseed.tables, utterances: [], profile_facts: [] } });
      },
    });
    await seedToMoment({ ...subject, store: older }, { scene: "d9-first-dose" }, REAL);
    const lay = layoutAtMoment(him.userId, { day: 9, time: "08:45" });
    expect(lay.transcripts.map((t) => t.visitId)).toEqual(["v1", "v2"]);
    expect(calls.addUtterances).toBe(2);
    expect(calls.addProfileFact).toBe(lay.facts.length);
    expect((await store.listProfileFacts(him.userId)).length).toBe(lay.facts.length);
    expect((await store.listUtterances(him.userId, "v1")).length).toBe(lay.transcripts[0].rows.length);
    // nothing is missing now: one read, no write
    expect(await ensureLayoutWhole(store, him.userId, lay)).toBe(false);
    // a run cut short after the transcripts (the facts come last): the next run completes it
    const facts = await store.listProfileFacts(him.userId);
    await store.reseedAccount(him.userId, { template: "mr-tan", d0: lay.d0, tables: { ...lay.tables, profile_facts: facts.slice(0, 1) } });
    expect(await ensureLayoutWhole(store, him.userId, lay)).toBe(true);
    expect((await store.listProfileFacts(him.userId)).length).toBe(lay.facts.length);
    expect(await ensureLayoutWhole(store, him.userId, lay)).toBe(false);
  });
});
