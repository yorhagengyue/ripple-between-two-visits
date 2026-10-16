/**
 * What leaves her screen the moment he switches a section off (C2 track D, the one-second fix round; lib/care/hide.ts).
 * Her page cuts the copy of his day it already holds down to the new switches before any fresh copy arrives, so the
 * rule is tested on the copy itself: after hideOff nothing a switched-off section was showing is left in it, by field
 * and by a scan of the whole copy for the medicine's name. Since the owner's decision of 2026-10-14 a section holds its
 * kind in full (the reason of a dose he did not take, the readings, the questions' words): the scan covers those too.
 *
 * The copies are real ones, built by lib/care/home.ts familyHome from Mr Tan's example account on Tue 13 Oct 2026 at
 * 10:30, after a morning nobody answered (reminders 08:45 and 09:15, the window closed 09:45, she was told): the alert,
 * the timeline and the week all hold something. The jobs run through track B's runDoseDay on the developer test clock.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { alertTimeline, hideOff, wentOff } from "@/lib/care/hide";
import { familyHome } from "@/lib/care/home";
import type { FamilyHomeData, TimelineLine } from "@/lib/care/home-types";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import { NO_GRANTS } from "@/lib/family/types";
import { MemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";

const store = new MemoryStore();
const SGT = (hhmm: string) => `2026-10-13T${hhmm}:00+08:00`;
const ALL: FamilyGrantItems = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };

let him: TestAccount;
let link: CareLinkRow;
let now = 0;

function setClock(hhmm: string): number {
  setTestClock({ at: SGT(hhmm), frozen: true });
  return Date.parse(SGT(hhmm));
}

beforeAll(async () => {
  setClock("07:30");
  const auth = getAuthProvider();
  him = await createAccountWithSpace(store, auth, { login: `h${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  const her = await createAccountWithSpace(store, auth, { login: `w${randomUUID().slice(0, 10)}`, password: "a long test password", space: "none" });
  const inv = await store.createInvite({ patient_id: him.userId, patient_label: "爸爸", invite_token_hash: randomUUID(), invite_expires_at: "2099-01-01T00:00:00.000Z" }, ALL);
  if (!inv.ok) throw new Error(inv.code);
  const acc = await store.acceptInvite(inv.link.invite_token_hash!, her.userId, "Wei Ling");
  if (!acc.ok) throw new Error(acc.code);
  const ok = await store.confirmLink(inv.link.id, him.userId, true);
  if (!ok.ok) throw new Error(ok.code);
  link = ok.link;
  // the morning nobody answered: the two reminders, then the window closes and she is told
  for (const at of ["08:45", "09:15", "09:46"]) {
    const t = setClock(at);
    const links = async (): Promise<LinkWithSwitch[]> => [{ link: (await store.getCareLink(link.id))!, noReplyAlert: true, locale: "zh-Hans" }];
    await runDoseDay(store, (await store.getSession(him.userId))!, t, { links, send: async () => ({ sent: 1 }) });
  }
  now = setClock("10:30");
});

afterAll(() => setTestClock(null));

/** Her copy of his day at 10:30 under these switches, at change 4 of them. */
async function copy(grants: FamilyGrantItems = ALL): Promise<FamilyHomeData> {
  return familyHome(store, (await store.getSession(him.userId))!, { link, grants, version: 4 }, now);
}

const text = (home: FamilyHomeData) => JSON.stringify(home);

describe("hideOff", () => {
  it("the copy it starts from holds his day (the control)", async () => {
    const home = await copy();
    expect(home.week?.days).toHaveLength(7);
    expect(home.status?.slot?.cells.length).toBeGreaterThan(0);
    expect(text(home)).toContain("Amlodipine");
    expect(home.bp).not.toBeNull();
    expect(home.questions).not.toBeNull();
    expect(home.grantsVersion).toBe(4);
    // the morning went unanswered: the alert is open, with the medicine in it
    expect(home.status?.state).toBe("no_reply");
    expect(home.noReply?.answeredSince).toBe(false);
    expect(home.noReply?.slot.cells.length).toBeGreaterThan(0);
    expect(home.timeline.length).toBeGreaterThan(0);
  });

  it("his medicine off, the alert still on: the week, the medicines and his answers are gone; the alert stays without them", async () => {
    const home = await copy();
    const cut = hideOff(home, { ...ALL, dose_summary: false }, 5);
    expect(cut.grants.dose_summary).toBe(false);
    expect(cut.grantsVersion).toBe(5);
    expect(cut.week).toBeNull();
    expect(text(cut)).not.toContain("Amlodipine");
    expect(text(cut)).not.toContain("medicationId");
    // owner, 10-14: a cell now carries the reason of a dose he did not take; no cell is left, so no reason is
    expect(text(home)).toContain('"reason"');
    expect(text(cut)).not.toContain('"reason"');
    if (home.noReply) {
      // the alert in its own form, as lib/care/home.ts builds it with the dose switch off
      expect(cut.noReply).toMatchObject({ answer: null, slot: { cells: [] } });
      expect(cut.status?.state === "no_reply" || cut.status?.state === "answered").toBe(true);
      expect(cut.status?.slot?.cells).toEqual([]);
      expect(cut.timeline.every((l) => ["reminded", "reminded_again", "no_reply", "told_you", "answered"].includes(l.kind) && l.meds.length === 0)).toBe(true);
    } else {
      expect(cut.status).toBeNull();
      expect(cut.timeline).toEqual([]);
    }
    // his last record was a dose: she may not know of it any more
    if (home.lastRecord?.what === "dose") expect(cut.lastRecord).toBeNull();
    // what the other switches show is untouched
    expect(cut.bp).toEqual(home.bp);
    expect(cut.questions).toEqual(home.questions);
  });

  it("is the same copy the server builds with that switch off (for what it keeps)", async () => {
    const home = await copy();
    const cut = hideOff(home, { ...ALL, dose_summary: false }, 5);
    const server = await copy({ ...ALL, dose_summary: false });
    expect(cut.week).toEqual(server.week);
    expect(cut.status?.state ?? null).toEqual(server.status?.state ?? null);
    expect(cut.noReply?.slot.cells ?? []).toEqual(server.noReply?.slot.cells ?? []);
    expect(cut.timeline.map((l) => l.kind)).toEqual(server.timeline.map((l) => l.kind));
  });

  it("both of them off: nothing of his medicine, no alert, no status", async () => {
    const cut = hideOff(await copy(), { ...ALL, dose_summary: false, no_reply_alert: false });
    expect(cut.status).toBeNull();
    expect(cut.noReply).toBeNull();
    expect(cut.timeline).toEqual([]);
    expect(cut.week).toBeNull();
    expect(text(cut)).not.toContain("Amlodipine");
  });

  it("the alert off, his medicine still on: 「没回」 reads 「没有记录」, the alert is gone, the week stays", async () => {
    const home = await copy();
    const cut = hideOff(home, { ...ALL, no_reply_alert: false });
    expect(cut.noReply).toBeNull();
    expect(cut.week).toEqual(home.week);
    if (home.status?.state === "no_reply") expect(cut.status?.state).toBe("not_logged");
  });

  it("blood pressure and questions off: the counts are gone, and a last record that was a reading with them", async () => {
    const home = await copy();
    const withBp: FamilyHomeData = { ...home, lastRecord: { at: null, date: home.today, slot: "morning", what: "bp" } };
    const cut = hideOff(withBp, { ...ALL, bp_summary: false, questions_count: false });
    expect(cut.bp).toBeNull();
    expect(cut.questions).toBeNull();
    expect(cut.lastRecord).toBeNull();
    expect(cut.week).toEqual(home.week);
  });

  // The owner's decision of 2026-10-14: the two parts hold the readings themselves and the questions' words now. They
  // leave with their kind: nothing of them is anywhere else in the copy (tests/unit/care/home-detail.test.ts goes
  // through each kind with words and numbers of its own).
  it("the readings and the questions' words leave with their kind, by a scan of the whole copy", async () => {
    const home = await copy();
    const reading: FamilyHomeData["bp"] = { count: 1, readings: [{ id: "bp-held", date: home.today, slot: "morning", at: null, systolic: 147, diastolic: 93, pulse: 61 }] };
    const held: FamilyHomeData = { ...home, bp: reading };
    expect(home.questions?.items.length).toBeGreaterThan(0);
    const cut = hideOff(held, { ...ALL, bp_summary: false, questions_count: false });
    for (const key of ['"systolic"', '"diastolic"', '"pulse"', '"readings"', '"items"', '"nextVisitPlace"']) {
      expect(text(held), key).toContain(key);
      expect(text(cut), key).not.toContain(key);
    }
    for (const q of home.questions!.items) expect(text(cut), q.text).not.toContain(q.text);
    // each alone: the other part stays whole
    expect(hideOff(held, { ...ALL, bp_summary: false }).questions).toEqual(home.questions);
    expect(hideOff(held, { ...ALL, questions_count: false }).bp).toEqual(reading);
  });

  it("the two links follow their switches; everything off leaves only what is hers", async () => {
    const home = await copy();
    expect(hideOff(home, { ...ALL, notes: false, visit_transcripts: false })).toMatchObject({ notesShared: false, visitsShared: false });
    const none = hideOff(home, { ...NO_GRANTS });
    expect(none).toMatchObject({ status: null, week: null, noReply: null, bp: null, questions: null, lastRecord: null, timeline: [], visitsShared: false, notesShared: false });
    expect(none.reminder).toEqual(home.reminder);
    expect(none.facts).toEqual(home.facts);
  });

  it("a switch that went ON shows nothing from the old copy (its data comes with the fresh one)", async () => {
    const off = await copy({ ...NO_GRANTS });
    const on = hideOff(off, { ...NO_GRANTS, dose_summary: true, bp_summary: true }, 9);
    expect(on.grants).toMatchObject({ dose_summary: true, bp_summary: true });
    expect(on.week).toBeNull();
    expect(on.status).toBeNull();
    expect(on.bp).toBeNull();
  });
});

describe("alertTimeline and wentOff", () => {
  it("keeps the reminders and the no-reply lines without medicine names, and adds a neutral 「他回了提醒」", () => {
    const lines: TimelineLine[] = [
      { at: "2026-10-13T00:45:00.000Z", kind: "reminded", meds: [], unanswered: true },
      { at: "2026-10-13T01:15:00.000Z", kind: "reminded_again", meds: [], unanswered: true },
      { at: "2026-10-13T01:45:00.000Z", kind: "told_you", meds: [] },
      { at: "2026-10-13T02:02:00.000Z", kind: "late_taken", meds: ["Amlodipine"] },
    ];
    const kept = alertTimeline(lines, "2026-10-13T02:02:00.000Z");
    expect(kept.map((l) => l.kind)).toEqual(["reminded", "reminded_again", "told_you", "answered"]);
    expect(JSON.stringify(kept)).not.toContain("Amlodipine");
  });

  it("names the switches that went off", () => {
    expect(wentOff(ALL, { ...ALL, notes: false, dose_summary: false }).sort()).toEqual(["dose_summary", "notes"]);
    expect(wentOff({ ...NO_GRANTS }, ALL)).toEqual([]);
  });
});
