/**
 * The filming account's panel behaves like the demo console (C2 follow-up, track E; real-app 12):
 *   - laying the account out to a scene tells his phone to open that scene's page (a "show" cue on his own stream, with
 *     no scene id and no story day in it);
 *   - "Simulate no reply" is refused before the tap, with the reason, while today's tablets are already recorded.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus, type BusEvent } from "@/lib/bus";
import { showCueOf } from "@/lib/crew/cues";
import { filmingAccountView, filmingRef, findFilming, listFilmingAccounts, markFilming, moveForward, noReplyBlockedWords, seedToMoment, simulateNoReply } from "@/lib/crew/filming-account";
import { pageForBeat } from "@/lib/crew/story";
import type { SlotDay } from "@/lib/daily/cells";
import { createFamilyStream } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { filmingEntry } from "@/lib/subject/filming";
import type { Subject } from "@/lib/subject/types";
import { setTestClock } from "@/lib/time/now";

const REAL = Date.parse("2026-10-10T14:00:00+08:00");
const login = () => `pan${randomUUID().replace(/-/g, "").slice(0, 10)}`;

describe("the filming account's panel", () => {
  const store = new MemoryStore();
  const entry = filmingEntry(store);
  let him: TestAccount;
  let subject: Subject;
  const scope = async (): Promise<SessionRow> => (await store.getSession(him.userId))!;
  const cues = async (after: number): Promise<BusEvent[]> => (await getBus().after(him.userId, after)).filter((e) => e.type === "director.cue");
  const lastId = (): Promise<number> => getBus().head(him.userId);

  beforeAll(async () => {
    setTestClock({ at: REAL, frozen: true });
    him = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank", locale: null });
    await markFilming(store, await scope());
    subject = (await findFilming(filmingRef(him.userId), entry))!;
  });

  it("laid out to a scene: his phone is told to open that scene's page, with no scene id and no story day in the cue", async () => {
    for (const scene of ["d29-hero", "d0-visit", "d9-first-dose"]) {
      const before = await lastId();
      await seedToMoment(subject, { scene }, REAL);
      const sent = await cues(before);
      expect(sent.length, scene).toBe(1);
      const cue = showCueOf(sent[0].data);
      expect(cue, scene).toEqual({ cue: "show", path: pageForBeat(scene), why: "scene", beat: null });
      expect(JSON.stringify(sent[0].data), scene).not.toMatch(/d\d+-|Day \d|第\d+天/);
      // her stream never carries it (her filter drops every type it does not list)
      expect(createFamilyStream({ ...NO_GRANTS }, { linkId: "any" }).view(sent[0]).event).toBeNull();
    }
    expect(pageForBeat("d29-hero")).toBe("/p/today");
    expect(pageForBeat("d0-visit")).toBe("/p/visit");
  });

  it("a forward move sends no page cue (the phone re-reads the moment where it is)", async () => {
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    const before = await lastId();
    await moveForward(subject, { minutes: 1 }, REAL);
    expect(await cues(before)).toEqual([]);
  });

  it("Day 29, 8:15pm: this morning's tablet is recorded, so the panel says why \"no reply\" cannot be pressed", async () => {
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    const view = (await filmingAccountView(him.userId, entry, REAL))!;
    expect(view.noReplyWhy).toBe("This day is already recorded: Amlodipine taken.");
    expect((await listFilmingAccounts(entry, REAL)).find((a) => a.ref === view.ref)?.noReplyWhy).toBe(view.noReplyWhy);
    // the server says the same thing in its own words when the call is made anyway
    await expect(simulateNoReply(subject, {}, REAL, { recipients: async () => [] })).rejects.toMatchObject({ code: "nothing_waiting" });
  });

  it("the next morning before he answers: it can be pressed; after it was pressed: recorded as no reply", async () => {
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    await moveForward(subject, { time: "08:44" }, REAL);
    expect((await filmingAccountView(him.userId, entry, REAL))!.noReplyWhy).toBeNull();
    await simulateNoReply(subject, {}, REAL, { recipients: async () => [], send: async () => ({ sent: 0 }) });
    expect((await filmingAccountView(him.userId, entry, REAL))!.noReplyWhy).toBe("This day is already recorded: Amlodipine no reply.");
  });

  it("before the first tablet exists (Day 0): nothing is due, and the panel says so", async () => {
    await seedToMoment(subject, { scene: "d0-visit" }, REAL);
    expect((await filmingAccountView(him.userId, entry, REAL))!.noReplyWhy).toBe("No tablet is due on this day, so there is nothing to leave unanswered.");
  });
});

describe("noReplyBlockedWords", () => {
  const cell = (name: string, state: "taken" | "missed" | "unconfirmed" | null, reason: string | null = null) => ({ name, state, reason }) as unknown as SlotDay["cells"][number];
  const slot = (cells: SlotDay["cells"]) => ({ slot: "morning", cells }) as unknown as SlotDay;

  it("an open cell, or 「等一下」: it can be pressed", () => {
    expect(noReplyBlockedWords([slot([cell("Amlodipine", null)])])).toBeNull();
    expect(noReplyBlockedWords([slot([cell("Amlodipine", "taken")]), slot([cell("Losartan", "unconfirmed", "later")])])).toBeNull();
  });

  it("every cell answered: the day's record, cell by cell", () => {
    expect(noReplyBlockedWords([slot([cell("Amlodipine", "taken"), cell("Losartan", "missed")])])).toBe("This day is already recorded: Amlodipine taken, Losartan not taken.");
    expect(noReplyBlockedWords([slot([cell("Amlodipine", "unconfirmed", "no_reply")])])).toBe("This day is already recorded: Amlodipine no reply.");
  });

  it("no medicine that day", () => {
    expect(noReplyBlockedWords([])).toMatch(/^No tablet is due/);
    expect(noReplyBlockedWords([slot([])])).toMatch(/^No tablet is due/);
  });
});
