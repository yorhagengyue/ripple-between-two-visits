/**
 * What the server does with an answer or a reading that arrives late from the phone's to-send list (C2 track O;
 * real-app 2.25, 2.8): the moment he tapped, never the moment it arrived; sending it again changes nothing; a later
 * answer of his stands; older than yesterday is refused; another account's entry is refused before anything is read.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { POST as dosesPost } from "@/app/api/doses/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { settleNoReply } from "@/lib/daily/doses";
import { ownerTag, sentForAnotherAccount } from "@/lib/offline/owner";
import { cellWhen, OUTBOX_OWNER_HEADER, tapMoment } from "@/lib/offline/tap";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const utc = (date: string, hhmm: string) => new Date(SGT(date, hhmm)).toISOString();

function post(path: string, token: string, body: unknown, owner?: string): NextRequest {
  const headers: Record<string, string> = { cookie: `rp_at=${token}`, "content-type": "application/json" };
  if (owner) headers[OUTBOX_OWNER_HEADER] = owner;
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function newAccount(): Promise<TestAccount> {
  // laid out on Mon 12 Oct 2026 10:00 Singapore: that day is day 42 of the example, Tue 13 Oct is day 43
  setTestClock({ at: SGT("2026-10-12", "10:00"), frozen: true });
  return createAccountWithSpace(store, getAuthProvider(), { login: `o${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
}

let him: TestAccount;
beforeAll(async () => {
  him = await newAccount();
});
beforeEach(async () => {
  for (const d of await store.listDoses(him.userId)) if (d.day >= 41) await store.deleteDose(him.userId, d.id);
});
afterAll(() => setTestClock(null));

const taken = { medication_id: "med-amlodipine", slot: "morning", state: "taken" };
const cell = async (day: number) => (await store.listDoses(him.userId, { fromDay: day, toDay: day, medication_id: "med-amlodipine" })).filter((d) => d.slot === "morning");

describe("tapMoment: the moment he tapped, as the server takes it", () => {
  const scope = { d0: "2026-08-31", tz: "Asia/Singapore" };
  const now = Date.parse(SGT("2026-10-13", "10:20"));

  it("keeps a tap of today or yesterday, with its own day and clock time in his zone", () => {
    expect(tapMoment(scope, SGT("2026-10-13", "08:52"), now)).toEqual({ ms: Date.parse(SGT("2026-10-13", "08:52")), iso: utc("2026-10-13", "08:52"), day: 43, time: "08:52", daysAgo: 0 });
    expect(tapMoment(scope, SGT("2026-10-12", "23:55"), now)).toMatchObject({ day: 42, time: "23:55", daysAgo: 1 });
    // the zone decides the day, not UTC: 00:10 Singapore is still the day before in UTC
    expect(tapMoment(scope, "2026-10-12T16:10:00.000Z", now)).toMatchObject({ day: 43, time: "00:10", daysAgo: 0 });
  });

  it("a tap after now is now; older than yesterday is too late; not a time is refused", () => {
    expect(tapMoment(scope, SGT("2026-10-13", "11:00"), now)).toMatchObject({ ms: now, day: 43, time: "10:20", daysAgo: 0 });
    expect(tapMoment(scope, SGT("2026-10-11", "23:59"), now)).toBe("too_late");
    expect(tapMoment(scope, SGT("2026-09-01", "08:00"), now)).toBe("too_late");
    expect(tapMoment(scope, "yesterday morning", now)).toBe("bad_time");
  });

  it("cellWhen: the cell he answered, counted from the day of the tap (a page left open over midnight)", () => {
    const tz = "Asia/Singapore";
    expect(cellWhen("2026-10-13", Date.parse(SGT("2026-10-13", "08:52")), tz)).toBe("today");
    expect(cellWhen("2026-10-12", Date.parse(SGT("2026-10-13", "00:05")), tz)).toBe("yesterday");
    expect(cellWhen("2026-10-11", Date.parse(SGT("2026-10-13", "00:05")), tz)).toBeNull();
    expect(cellWhen("2026-10-14", Date.parse(SGT("2026-10-13", "23:59")), tz)).toBeNull();
    expect(cellWhen("2026-09-30", Date.parse(SGT("2026-10-01", "07:00")), tz)).toBe("yesterday");
  });
});

describe("POST /api/doses with `at`: an answer sent late", () => {
  it("is recorded with the moment he tapped, not the moment it arrived", async () => {
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const res = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-13", "08:52") }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dose).toMatchObject({ day: 43, slot: "morning", state: "taken", created_at: utc("2026-10-13", "08:52") });
    expect(body.kept).toBeUndefined();
    expect(await cell(43)).toHaveLength(1);
  });

  it("sent again, it changes nothing: the same row, no second one", async () => {
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const late = { ...taken, at: SGT("2026-10-13", "08:52") };
    const first = (await (await dosesPost(post("/api/doses", him.tokens.access_token, late))).json()).dose;
    setTestClock({ at: SGT("2026-10-13", "10:25"), frozen: true });
    const again = await dosesPost(post("/api/doses", him.tokens.access_token, late));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.kept).toBe(true);
    expect(body.dose).toEqual(first);
    expect(await cell(43)).toMatchObject([{ id: first.id, state: "taken", created_at: first.created_at }]);
    expect(await cell(43)).toHaveLength(1);
  });

  it("the first try reached the server and only its reply was lost: the row it wrote stands", async () => {
    setTestClock({ at: SGT("2026-10-13", "08:52"), frozen: true });
    // the direct try carries no `at`; the server stamps it itself, a few seconds after the tap
    setTestClock({ at: "2026-10-13T08:52:04+08:00", frozen: true });
    const direct = (await (await dosesPost(post("/api/doses", him.tokens.access_token, taken))).json()).dose;
    setTestClock({ at: SGT("2026-10-13", "09:30"), frozen: true });
    const resend = await (await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: "2026-10-13T08:52:01+08:00" }))).json();
    expect(resend.kept).toBe(true);
    // the two clocks need not agree to the second: the same answer a little after the server's own stamp is that tap too
    const after = await (await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: "2026-10-13T08:52:40+08:00" }))).json();
    expect(after.kept).toBe(true);
    // but another answer after it, or the same answer much later, is a new answer
    const changed = await (await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, state: "missed", at: "2026-10-13T08:53:00+08:00" }))).json();
    expect(changed.kept).toBeUndefined();
    await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: "2026-10-13T08:54:00+08:00" }));
    expect(await cell(43)).toMatchObject([{ state: "taken", created_at: utc("2026-10-13", "08:54") }]);
    expect((await cell(43))[0].id).not.toBe(direct.id);
    expect(await cell(43)).toHaveLength(1);
  });

  it("an answer he gave later (on another phone) is not undone by an older one arriving late", async () => {
    setTestClock({ at: SGT("2026-10-13", "09:10"), frozen: true });
    const newer = (await (await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, state: "missed", reason: "forgot", reason_text: "忘了" }))).json()).dose;
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const res = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-13", "08:52") }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kept: true, dose: { state: "missed", created_at: utc("2026-10-13", "09:10") } });
    expect(await cell(43)).toMatchObject([{ id: newer.id, state: "missed", reason: "forgot", created_at: newer.created_at }]);
    expect(await cell(43)).toHaveLength(1);
  });

  it("an older answer of his is overwritten by a later one from the list, and entries replay in order", async () => {
    setTestClock({ at: SGT("2026-10-13", "08:50"), frozen: true });
    await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, state: "unconfirmed", reason: "later" }));
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    // 没吃 at 8:52, the reason at 8:53, then 吃了 at 9:05: all kept on the phone, sent in that order
    for (const [at, answer] of [
      ["08:52", { state: "missed" }],
      ["08:53", { state: "missed", reason: "forgot", reason_text: "忘了" }],
      ["09:05", { state: "taken" }],
    ] as const) {
      const res = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, ...answer, at: SGT("2026-10-13", at) }));
      expect((await res.json()).kept, at).toBeUndefined();
    }
    expect(await cell(43)).toMatchObject([{ state: "taken", reason: null, created_at: utc("2026-10-13", "09:05") }]);
  });

  it("the system's 没回 is not his answer: what he tapped before the window closed replaces it", async () => {
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const scope = (await store.getSession(him.userId))!;
    await settleNoReply(store, scope);
    expect(await cell(43)).toMatchObject([{ state: "unconfirmed", reason: "no_reply" }]);
    const res = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-13", "08:52") }));
    expect((await res.json()).kept).toBeUndefined();
    expect(await cell(43)).toMatchObject([{ state: "taken", created_at: utc("2026-10-13", "08:52") }]);
  });

  it("tapped yesterday, sent today: it lands on yesterday; 「昨天」 is counted from the tap", async () => {
    setTestClock({ at: SGT("2026-10-13", "00:10"), frozen: true });
    const res = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-12", "23:55") }));
    expect((await res.json()).dose).toMatchObject({ day: 42, created_at: utc("2026-10-12", "23:55") });
    expect(await cell(43)).toEqual([]);
    // 「昨天」 tapped today is yesterday
    const y = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, state: "missed", when: "yesterday", at: SGT("2026-10-13", "00:05") }));
    expect((await y.json()).dose).toMatchObject({ day: 42, state: "missed", created_at: utc("2026-10-13", "00:05") });
    // 「昨天」 tapped yesterday is the day before: only today and yesterday can be written (real-app 2.8)
    const old = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, when: "yesterday", at: SGT("2026-10-12", "23:50") }));
    expect(old.status).toBe(409);
    expect((await old.json()).error).toBe("too_late");
    expect(await cell(41)).toEqual([]);
  });

  it("older than yesterday: 409 too_late and nothing written; a tap from the future is now; a bad time is 400", async () => {
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const old = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-11", "08:52") }));
    expect(old.status).toBe(409);
    expect((await old.json()).error).toBe("too_late");
    expect(await cell(41)).toEqual([]);
    const ahead = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: SGT("2026-10-14", "08:52") }));
    expect((await ahead.json()).dose).toMatchObject({ day: 43, created_at: utc("2026-10-13", "10:20") });
    expect((await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, at: "this morning" }))).status).toBe(400);
    // the day still never comes from the request
    expect((await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, day: 42, at: SGT("2026-10-13", "08:52") }))).status).toBe(400);
  });

  it("a medicine that is not his, or not taken in that slot, is refused as before", async () => {
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    expect((await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, medication_id: "nope", at: SGT("2026-10-13", "08:52") }))).status).toBe(404);
    const notDue = await dosesPost(post("/api/doses", him.tokens.access_token, { ...taken, slot: "night", at: SGT("2026-10-13", "08:52") }));
    expect(notDue.status).toBe(409);
    expect((await notDue.json()).error).toBe("not_due");
  });
});

describe("POST /api/bp with `at`: a reading sent late", () => {
  it("takes the day, the part of the day and the time of the tap; sent again, the same row comes back", async () => {
    setTestClock({ at: SGT("2026-10-13", "08:00"), frozen: true });
    const id = randomUUID();
    const late = { id, systolic: 141, diastolic: 88, pulse: 70, at: SGT("2026-10-12", "20:05") };
    const res = await bpPost(post("/api/bp", him.tokens.access_token, late));
    expect(res.status).toBe(201);
    const reading = (await res.json()).reading;
    expect(reading).toMatchObject({ id, day: 42, slot: "evening", systolic: 141, diastolic: 88, pulse: 70, state: "recorded", created_at: utc("2026-10-12", "20:05") });
    const again = await bpPost(post("/api/bp", him.tokens.access_token, late));
    expect(again.status).toBe(200);
    expect((await again.json()).reading).toEqual(reading);
    expect((await store.listBp(him.userId, { fromDay: 41, toDay: 43 })).filter((r) => r.id === id)).toHaveLength(1);
  });

  it("the direct try reached the server, the resend finds its row by the phone's uuid", async () => {
    setTestClock({ at: SGT("2026-10-13", "08:00"), frozen: true });
    const id = randomUUID();
    const direct = (await (await bpPost(post("/api/bp", him.tokens.access_token, { id, systolic: 138, diastolic: 82 }))).json()).reading;
    setTestClock({ at: SGT("2026-10-13", "09:00"), frozen: true });
    const resend = await bpPost(post("/api/bp", him.tokens.access_token, { id, systolic: 138, diastolic: 82, at: "2026-10-13T07:59:58+08:00" }));
    expect(resend.status).toBe(200);
    expect((await resend.json()).reading).toEqual(direct);
  });

  it("「这次没量」 kept on the phone is dated the same way; older than yesterday is refused; the future is now", async () => {
    setTestClock({ at: SGT("2026-10-13", "13:00"), frozen: true });
    const skipped = await bpPost(post("/api/bp", him.tokens.access_token, { id: randomUUID(), state: "unconfirmed", at: SGT("2026-10-13", "08:10") }));
    expect((await skipped.json()).reading).toMatchObject({ day: 43, slot: "morning", state: "unconfirmed", systolic: null, created_at: utc("2026-10-13", "08:10") });
    const oldId = randomUUID();
    const old = await bpPost(post("/api/bp", him.tokens.access_token, { id: oldId, systolic: 150, diastolic: 95, at: SGT("2026-10-10", "08:10") }));
    expect(old.status).toBe(409);
    expect((await old.json()).error).toBe("too_late");
    expect((await store.listBp(him.userId)).some((r) => r.id === oldId)).toBe(false);
    const ahead = await bpPost(post("/api/bp", him.tokens.access_token, { id: randomUUID(), systolic: 130, diastolic: 80, at: SGT("2026-10-13", "19:00") }));
    // C2 track B, second round (real-app 2.9): morning before noon, evening from noon on; 13:00 is the evening reading
    expect((await ahead.json()).reading).toMatchObject({ day: 43, slot: "evening", created_at: utc("2026-10-13", "13:00") });
    expect((await bpPost(post("/api/bp", him.tokens.access_token, { id: randomUUID(), systolic: 130, diastolic: 80, at: "soon" }))).status).toBe(400);
  });
});

describe("whose entry it is", () => {
  it("the tag is stable, one-way and not the id", () => {
    const tag = ownerTag(him.userId);
    expect(tag).toMatch(/^o[0-9a-f]{31}$/);
    expect(ownerTag(him.userId)).toBe(tag);
    expect(tag).not.toContain(him.userId);
    expect(tag).not.toContain(him.userId.replace(/-/g, "").slice(0, 12));
    expect(ownerTag(randomUUID())).not.toBe(tag);
  });

  it("a request names no owner (the page's own try), its own, or another account's", () => {
    const req = (owner?: string) => ({ headers: new Headers(owner ? { [OUTBOX_OWNER_HEADER]: owner } : {}) });
    expect(sentForAnotherAccount(req(), him.userId)).toBe(false);
    expect(sentForAnotherAccount(req(ownerTag(him.userId)), him.userId)).toBe(false);
    expect(sentForAnotherAccount(req(ownerTag(randomUUID())), him.userId)).toBe(true);
    expect(sentForAnotherAccount(req(ownerTag(him.userId)), null)).toBe(true);
  });

  it("an entry of another account is refused before anything is written, medicine or reading", async () => {
    const other = await newAccount();
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const hisEntry = { ...taken, at: SGT("2026-10-13", "08:52") };
    // the phone is now signed in as the other account; the list still holds his entry, tagged as his
    const res = await dosesPost(post("/api/doses", other.tokens.access_token, hisEntry, ownerTag(him.userId)));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("other_account");
    expect(text).not.toContain(him.userId);
    expect(text).not.toContain(other.userId);
    expect(await store.listDoses(other.userId, { fromDay: 43, toDay: 43 })).toEqual([]);
    const id = randomUUID();
    const bp = await bpPost(post("/api/bp", other.tokens.access_token, { id, systolic: 150, diastolic: 95, at: SGT("2026-10-13", "08:55") }, ownerTag(him.userId)));
    expect(bp.status).toBe(409);
    expect((await bp.json()).error).toBe("other_account");
    expect((await store.listBp(other.userId)).some((r) => r.id === id)).toBe(false);
    // under his own sign-in the same entries are his
    expect((await dosesPost(post("/api/doses", him.tokens.access_token, hisEntry, ownerTag(him.userId)))).status).toBe(200);
    expect((await bpPost(post("/api/bp", him.tokens.access_token, { id, systolic: 150, diastolic: 95, at: SGT("2026-10-13", "08:55") }, ownerTag(him.userId)))).status).toBe(201);
  });
});
