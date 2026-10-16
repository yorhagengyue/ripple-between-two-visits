/**
 * The filming account (C2 track J; real-app 5.4, 5.6 H2, 8.11 crew/filming-account and crew/offset; journey 21).
 *
 *   the layout    the story as it stood at a scene, on the story's own dates, each record stamped when it happened
 *   the clock     laid out to Day 29 8:15pm, "now" is 2026-09-22 20:15 and a minute later 20:16; forward only; the
 *                 skipped days are never "no reply"; "simulate no reply" writes only that slot, by the director; the
 *                 reminder pops once per stretch; ending filming is the real date again, offset gone
 *   the gate      no crew credential: 404 on every route; only his own account is marked; an ordinary account is never
 *                 listed or touched (404), and the store refuses it an offset
 *
 * Real time is the developer test clock, frozen at Sat 10 Oct 2026 14:00 (moved on by minutes where time flows).
 */
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as ownDelete, GET as ownGet, POST as ownPost } from "@/app/api/crew/filming-account/route";
import { GET as listGet } from "@/app/api/crew/filming-account/accounts/route";
import { GET as oneGet, POST as onePost } from "@/app/api/crew/filming-account/accounts/[ref]/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus } from "@/lib/bus";
import { familyRecipients } from "@/lib/care/recipients";
import {
  endFilming,
  FilmingError,
  filmingRef,
  filmingState,
  findFilming,
  fireReminder,
  FILMING_D0,
  layoutAtMoment,
  markFilming,
  moveForward,
  seedToMoment,
  simulateNoReply,
  storyMoment,
} from "@/lib/crew/filming-account";
import { accountToday } from "@/lib/daily/account-today";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import type { Notice } from "@/lib/jobs/notify";
import { CREW_COOKIE, crewCookieValue, resetCrewAttempts } from "@/lib/session/crew-key";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import { StoreError, type SessionRow, type Store } from "@/lib/store/types";
import { careEntryStore } from "@/lib/subject/care";
import { filmingEntry } from "@/lib/subject/filming";
import type { Subject } from "@/lib/subject/types";
import { setTestClock } from "@/lib/time/now";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const MIN = 60_000;
const PASSWORD = "a long test password";
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const REAL = Date.parse(SGT("2026-10-10", "14:00"));
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

function realAt(ms: number): number {
  setTestClock({ at: ms, frozen: true });
  return ms;
}

function collect(): { sent: Notice[]; send: (n: Notice) => Promise<{ sent: number }> } {
  const sent: Notice[] = [];
  return { sent, send: async (n) => (sent.push(n), { sent: 1 }) };
}

async function account(store: Store, space: "example" | "blank" | "none", locale: string | null = null): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "f" : "j"), password: PASSWORD, space, locale });
}

/** His active care link to her, his no-reply switch as given. */
async function linkHer(store: Store, him: TestAccount, her: TestAccount, noReplyAlert: boolean) {
  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  const made = await store.createInvite(
    { patient_id: him.userId, family_label: "Wei Ling", patient_label: "爸爸", relation: "daughter", invite_token_hash: hash, invite_expires_at: new Date(REAL + 7 * 86_400_000).toISOString() },
    { no_reply_alert: noReplyAlert, dose_summary: true },
  );
  if (!made.ok) throw new Error(made.code);
  const accepted = await store.acceptInvite(hash, her.userId, "Wei Ling");
  if (!accepted.ok) throw new Error(accepted.code);
  const confirmed = await store.confirmLink(made.link.id, him.userId, true);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.link;
}

afterAll(() => setTestClock(null));

// ---------------------------------------------------------------- the layout

describe("the story laid out to a scene, on the story's own dates", () => {
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  it("Day 29, 8:15pm (the hero question): three visits happened, the third is planned; his records up to that evening", () => {
    const lay = layoutAtMoment("scope-x", { day: 29, time: "20:15" });
    expect(lay.d0).toBe("2026-08-24");
    expect(lay.at).toBe(Date.parse(SGT("2026-09-22", "20:15")));
    expect(lay.tables.visits.map((v) => [v.id, v.status, v.date])).toEqual([
      ["v1", "confirmed", "2026-08-24"],
      ["v2", "confirmed", "2026-09-01"],
      ["p1", "confirmed", "2026-09-05"],
      ["v3", "planned", "2026-10-05"],
    ]);
    expect(ids(lay.tables.medications)).toEqual(["med-amlodipine", "med-ibuprofen", "med-relative-box"]);
    // the bag's dispensed date is the props' 9月1日
    expect(lay.tables.medications.find((m) => m.id === "med-amlodipine")?.label?.dispensed).toBe("2026-09-01");
    const doses = lay.tables.dose_logs;
    expect(Math.max(...doses.map((d) => d.day))).toBe(29);
    expect(doses.find((d) => d.day === 29)?.created_at).toBe(new Date(Date.parse(SGT("2026-09-22", "08:47"))).toISOString());
    expect(doses.filter((d) => d.state === "missed").map((d) => d.day)).toEqual([15, 17, 24]);
    // he measured 150/95 at 20:05: it is there when he asks at 20:15
    const hero = lay.tables.bp_readings.find((b) => b.day === 29);
    expect([hero?.systolic, hero?.diastolic, hero?.created_at]).toEqual([150, 95, new Date(Date.parse(SGT("2026-09-22", "20:05"))).toISOString()]);
    expect(lay.tables.notes.map((n) => n.day)).toEqual([20]);
    const q = new Map(lay.tables.questions.map((x) => [x.id, x]));
    // the hero question is asked in the scene itself; Day 30's knee question is still to come
    expect([...q.keys()].sort()).toEqual(["q-knee-1", "q-machine", "q-relative-box", "q-tai-chi"]);
    expect([q.get("q-relative-box")?.status, q.get("q-machine")?.status, q.get("q-tai-chi")?.status]).toEqual(["answered", "answered", "open"]);
    expect(q.get("q-machine")?.answer_utterance_id).toBeTruthy();
    expect(lay.tables.reminder_clips.map((c) => [c.by_label, c.by_user_id])).toEqual([["Wei Ling", null]]);
    expect(lay.facts.find((f) => f.kind === "name")?.text).toBe("陈先生");
    expect(lay.facts.map((f) => f.text).join(" ")).not.toContain("示例");
    expect(lay.transcripts.map((t) => t.visitId)).toEqual(["v1", "v2", "p1"]);
    const r4 = lay.transcripts.find((t) => t.visitId === "v2")?.rows.find((u) => u.text.startsWith("Please don't change the dose"));
    expect([r4?.role, r4?.role_state]).toEqual(["doctor", "confirmed"]);
    expect((lay.settings.routine as { label: string; days: unknown }[]).find((r) => r.label === "Tai chi")?.days).toEqual(["Tue", "Thu"]);
    // nothing of the template is changed, nothing is invented: every row is the template's or a replay line
    expect(lay.tables.visit_items.map((i) => i.required_line).sort()).toEqual(["R1", "R2", "R3", "R4"]);
  });

  it("a scene that films a visit has it still to come: Day 8 10:00 (v2 planned, no amlodipine yet, his question open)", () => {
    const lay = layoutAtMoment("scope-x", { day: 8, time: "10:00" });
    expect(lay.tables.visits.map((v) => [v.id, v.status])).toEqual([
      ["v1", "confirmed"],
      ["v2", "planned"],
      ["v3", "planned"],
    ]);
    expect(ids(lay.tables.medications)).toEqual(["med-ibuprofen", "med-relative-box"]);
    expect(lay.tables.visit_items.map((i) => i.required_line).sort()).toEqual(["R1", "R2"]);
    const knee = lay.tables.questions.find((q) => q.id === "q-knee-1");
    expect([knee?.status, knee?.answer_text]).toEqual(["open", null]);
    expect(lay.tables.dose_logs).toEqual([]);
    expect(lay.transcripts.map((t) => t.visitId)).toEqual(["v1"]);
  });

  it("Day 9 8:45 (his first tablet): amlodipine is his, today's dose is still to be logged", () => {
    const lay = layoutAtMoment("scope-x", { day: 9, time: "08:45" });
    expect(lay.tables.medications.some((m) => m.id === "med-amlodipine")).toBe(true);
    expect(lay.tables.dose_logs).toEqual([]);
  });

  it("Day 3 9pm: the morning reading is there, the evening one (not measured) only comes when the evening ends; Day 37 6pm: the ankle is still to say", () => {
    const d3 = layoutAtMoment("scope-x", { day: 3, time: "21:00" });
    expect(d3.tables.bp_readings.filter((b) => b.day === 3).map((b) => b.slot)).toEqual(["morning"]);
    const d37 = layoutAtMoment("scope-x", { day: 37, time: "18:00" });
    expect(d37.tables.notes.map((n) => n.day)).toEqual([20]);
  });

  it("Day 0 9:30: the first visit is still to come, his question for it is ready", () => {
    const lay = layoutAtMoment("scope-x", { day: 0, time: "09:30" });
    expect(lay.tables.visits.find((v) => v.id === "v1")?.status).toBe("planned");
    expect(lay.tables.questions.map((q) => [q.id, q.status])).toEqual([["q-machine", "open"]]);
    expect(lay.transcripts).toEqual([]);
  });

  it("her own recordings stay across a layout; the stand-in is only for an account she never recorded on", () => {
    const own = { id: "clip-own", session_id: "scope-x", by: "wei-ling", audio_path: "a1/reminders/x.wav", plays_at: "after_breakfast", text: "爸，吃药了吗", lang: "zh-Hans", created_at: new Date(REAL).toISOString(), by_user_id: randomUUID(), by_label: "Wei Ling", link_id: "l1" };
    const lay = layoutAtMoment("scope-x", { day: 29, time: "20:15" }, { keepClips: [own] });
    expect(lay.tables.reminder_clips.map((c) => c.id)).toEqual(["clip-own"]);
  });

  it("the code on the director's desk: six letters or digits, the same for the same account, never the id", () => {
    const id = randomUUID();
    expect(filmingRef(id)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(filmingRef(id)).toBe(filmingRef(id));
    expect(filmingRef(id)).not.toBe(filmingRef(randomUUID()));
    expect(storyMoment(29, "20:15")).toBe(Date.parse(SGT("2026-09-22", "20:15")));
    expect(FILMING_D0).toBe("2026-08-24");
  });
});

// ---------------------------------------------------------------- the clock

describe("the director plays the story on a filming account", () => {
  const store = new MemoryStore();
  const entry = filmingEntry(store);
  const recipients = (id: string) => familyRecipients(id, { store: careEntryStore(store) });
  let him: TestAccount;
  let subject: Subject;
  const scope = async (): Promise<SessionRow> => (await store.getSession(him.userId))!;
  const dosesOf = async (from: number, to = from) => (await store.listDoses(him.userId, { fromDay: from, toDay: to })).map((d) => `${d.day}:${d.state}:${d.reason}`);

  beforeAll(async () => {
    realAt(REAL);
    him = await account(store, "example");
    await markFilming(store, await scope());
    subject = (await findFilming(filmingRef(him.userId), entry))!;
  });

  it("laid out to Day 29 8:15pm, his now is 2026-09-22 20:15; a minute later it is 20:16", async () => {
    const row = await seedToMoment(subject, { scene: "d29-hero" }, realAt(REAL));
    expect([row.d0, row.story_day, row.story_time, row.example_data, row.onboarding]).toEqual(["2026-08-24", 29, "20:15", false, "done"]);
    expect(row.tracking_since).toBe(new Date(Date.parse(SGT("2026-09-22", "20:15"))).toISOString());
    expect(row.clock_offset_ms).toBe(Date.parse(SGT("2026-09-22", "20:15")) - REAL);
    realAt(REAL + MIN);
    expect((await scope()).story_time).toBe("20:16");
    realAt(REAL);
    const st = filmingState(await scope());
    expect([st.date, st.time, st.scene, st.laidOut]).toEqual(["2026-09-22", "20:15", "d29-hero", true]);
    // his profile says who he is in the story, his transcripts are there, and the pattern question speaks of real dates
    expect((await store.listProfileFacts(him.userId)).find((f) => f.kind === "name")?.text).toBe("陈先生");
    expect((await store.listUtterances(him.userId, "v2")).length).toBeGreaterThan(5);
    const t = await accountToday(store, await scope(), REAL, {}, "zh-Hans");
    expect([t.date, t.time, t.focus]).toEqual(["2026-09-22", "20:15", null]);
  });

  it("forward only: to 8:44 the next morning; back is refused in words; beyond Day 45 too", async () => {
    const row = await moveForward(subject, { time: "08:44" }, realAt(REAL));
    expect([row.story_day, row.story_time]).toEqual([30, "08:44"]);
    expect(row.tracking_since).toBe(new Date(Date.parse(SGT("2026-09-23", "08:44"))).toISOString());
    await expect(moveForward(subject, { time: "08:00", date: "2026-09-23" }, REAL)).rejects.toMatchObject({ code: "forward_only", message: expect.stringContaining("only moves forward") });
    await expect(moveForward(subject, { time: "20:00", date: "2026-09-22" }, REAL)).rejects.toBeInstanceOf(FilmingError);
    await expect(moveForward(subject, { time: "08:00", date: "2026-10-09" }, REAL)).rejects.toMatchObject({ code: "beyond_clock" });
    expect(((await scope()).story_time)).toBe("08:44");
    const t = await accountToday(store, await scope(), REAL, {}, "zh-Hans");
    expect([t.time, t.focus?.why]).toEqual(["08:44", "coming"]);
  });

  it("the reminder: first at his 8:45, then the second, then the second again; never after he answered", async () => {
    await moveForward(subject, { minutes: 1 }, REAL);
    const c = collect();
    const first = await fireReminder(subject, {}, REAL, { send: c.send });
    expect(first).toEqual({ slot: "morning", kind: "dose_first", date: "2026-09-23", sent: 1, again: false });
    expect(c.sent[0]).toMatchObject({ kind: "dose_first", title: "早间药物", body: "尚未记录", url: "/p/today?remind=dose-morning", to: { role: "patient", userId: him.userId } });
    expect((await fireReminder(subject, {}, REAL, { send: c.send })).kind).toBe("dose_second");
    expect((await fireReminder(subject, {}, REAL, { send: c.send })).again).toBe(true);
    // the phone opened from the notice shows the slot and her clip
    const t = await accountToday(store, await scope(), REAL, { remind: "dose-morning" }, "zh-Hans");
    expect([t.focus?.why, t.reminder?.by_label, t.reminder?.stand_in]).toEqual(["remind", "Wei Ling", true]);
  });

  it("simulate no reply: the clock goes to 9:46, only this slot is recorded, by the director; nobody linked, nobody told", async () => {
    const events: { type: string; data: unknown }[] = [];
    const stop = getBus().subscribe(him.userId, (e) => events.push(e));
    const c = collect();
    const r = await simulateNoReply(subject, {}, REAL, { send: c.send, recipients });
    stop();
    expect(r).toEqual({ slot: "morning", date: "2026-09-23", written: 1, movedTo: "09:46", family: 0, familyWhy: "no_link" });
    expect(await dosesOf(30)).toEqual(["30:unconfirmed:no_reply"]);
    expect(events.filter((e) => e.type === "dose.logged").map((e) => (e.data as { by: string }).by)).toEqual(["director"]);
    expect(c.sent).toEqual([]);
    const s = await scope();
    expect(s.story_time).toBe("09:46");
    // his phone: 「早上的药，到 9:45 还没记。」 with 吃了 / 还没吃 to log it late
    expect((await accountToday(store, s, REAL, {}, "zh-Hans")).focus).toMatchObject({ why: "closed" });
    // the job finds nothing more to settle, and a second press has nothing left to record
    expect((await runDoseDay(store, s, REAL, { send: c.send })).settled).toBe(0);
    await expect(simulateNoReply(subject, {}, REAL, { recipients })).rejects.toMatchObject({ code: "nothing_waiting", message: "This slot is already recorded: Amlodipine no reply." });
    await expect(fireReminder(subject, {}, REAL)).rejects.toMatchObject({ code: "nothing_waiting" });
  });

  it("skipped days are never 'no reply': forward to Day 33 8:40; the job settles nothing for Days 31 and 32", async () => {
    const row = await moveForward(subject, { time: "08:40", date: "2026-09-26" }, REAL);
    expect([row.story_day, row.story_time]).toEqual([33, "08:40"]);
    const c = collect();
    const counts = await runDoseDay(store, await scope(), REAL, { send: c.send });
    expect([counts.settled, counts.first, counts.second]).toEqual([0, 0, 0]);
    expect(await dosesOf(31, 33)).toEqual([]);
    const t = await accountToday(store, await scope(), REAL, {}, "zh-Hans");
    expect([t.focus?.why, t.yesterday]).toEqual(["coming", []]);
    // time flows: his 8:45 comes five real minutes later, and the job reminds him
    expect((await runDoseDay(store, await scope(), realAt(REAL + 5 * MIN), { send: c.send })).first).toBe(1);
    realAt(REAL);
  });

  it("end filming: the real date again (10月10日), no offset, unmarked; the time in between is never settled", async () => {
    const row = await endFilming(store, await scope(), realAt(REAL + 5 * MIN));
    expect([row.filming, row.clock_offset_ms, row.d0]).toEqual([false, null, "2026-08-24"]);
    const s = await scope();
    expect(filmingState(s).date).toBe("2026-10-10");
    expect(s.tracking_since).toBe(new Date(REAL + 5 * MIN).toISOString());
    expect((await runDoseDay(store, s, REAL + 5 * MIN, collect())).settled).toBe(0);
    expect(await dosesOf(33, 47)).toEqual([]);
    // no longer the crew's: the code answers like a missing account, and the store refuses it an offset
    expect(await findFilming(filmingRef(him.userId), entry)).toBeNull();
    await expect(store.setClockOffset(him.userId, -MIN)).rejects.toBeInstanceOf(StoreError);
    realAt(REAL);
  });
});

describe("her alert when he lets her know (D's link, his no-reply switch)", () => {
  const store = new MemoryStore();
  const entry = filmingEntry(store);
  const recipients = (id: string) => familyRecipients(id, { store: careEntryStore(store) });

  it("simulate no reply tells her once, in track B's words; the job does not tell her twice", async () => {
    realAt(REAL);
    const him = await account(store, "example");
    const her = await account(store, "none");
    const link = await linkHer(store, him, her, true);
    await markFilming(store, (await store.getSession(him.userId))!);
    const subject = (await findFilming(filmingRef(him.userId), entry))!;
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    await moveForward(subject, { time: "08:44" }, REAL);
    const c = collect();
    const r = await simulateNoReply(subject, {}, REAL, { send: c.send, recipients });
    expect([r.family, r.familyWhy]).toEqual([1, null]);
    expect(c.sent.map((n) => [n.kind, n.title, n.url, n.to])).toEqual([["family_no_reply", "爸爸尚未回应早间药物提醒", `/f?link=${encodeURIComponent(link.id)}`, { role: "family", userId: her.userId, linkId: link.id }]]);
    // her link and its switch survived the layout
    expect((await store.getFamilyGrant(him.userId, link.id))?.items.no_reply_alert).toBe(true);
    const links = async (): Promise<LinkWithSwitch[]> => [{ link, noReplyAlert: true, locale: "zh-Hans" }];
    expect((await runDoseDay(store, (await store.getSession(him.userId))!, REAL, { send: c.send, links })).family).toBe(0);
  });

  it("the job tells her of a real no reply on his clock: she was linked before that window closed on his clock", async () => {
    realAt(REAL);
    const him = await account(store, "example");
    const her = await account(store, "none");
    const link = await linkHer(store, him, her, true);
    await markFilming(store, (await store.getSession(him.userId))!);
    const subject = (await findFilming(filmingRef(him.userId), entry))!;
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    await moveForward(subject, { time: "09:40", date: "2026-09-24" }, REAL);
    const c = collect();
    const links = async (): Promise<LinkWithSwitch[]> => [{ link, noReplyAlert: true, locale: "zh-Hans" }];
    const counts = await runDoseDay(store, (await store.getSession(him.userId))!, realAt(REAL + 6 * MIN), { send: c.send, links });
    expect([counts.settled, counts.family]).toEqual([1, 1]);
    realAt(REAL);
  });

  it("his switch off: nobody is told, and the director reads why", async () => {
    realAt(REAL);
    const him = await account(store, "example");
    const her = await account(store, "none");
    await linkHer(store, him, her, false);
    await markFilming(store, (await store.getSession(him.userId))!);
    const subject = (await findFilming(filmingRef(him.userId), entry))!;
    await seedToMoment(subject, { scene: "d29-hero" }, REAL);
    await moveForward(subject, { time: "08:44" }, REAL);
    const r = await simulateNoReply(subject, {}, REAL, { send: collect().send, recipients });
    expect([r.family, r.familyWhy]).toEqual([0, "switch_off"]);
  });
});

// ---------------------------------------------------------------- the routes and the gate

describe("the routes: crew only, his own account only, ordinary accounts never", () => {
  const store = getMemoryStore();
  const crewCookie = `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`;
  let him: TestAccount;
  let other: TestAccount;

  const req = (path: string, method: string, cookies: string[], body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: cookies.join("; "), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const params = (ref: string) => ({ params: Promise.resolve({ ref }) });

  beforeAll(async () => {
    realAt(REAL);
    him = await account(store, "example");
    other = await account(store, "example");
  });
  beforeEach(() => resetCrewAttempts());

  it("without the crew's cookie or key every route answers 404 not_found, signed in or not", async () => {
    const mine = [`rp_at=${him.tokens.access_token}`];
    const ref = filmingRef(him.userId);
    const rs = [
      await ownGet(req("/api/crew/filming-account", "GET", mine)),
      await ownPost(req("/api/crew/filming-account", "POST", mine)),
      await ownDelete(req("/api/crew/filming-account", "DELETE", mine)),
      await listGet(req("/api/crew/filming-account/accounts", "GET", [])),
      await oneGet(req(`/api/crew/filming-account/accounts/${ref}`, "GET", mine), params(ref)),
      await onePost(req(`/api/crew/filming-account/accounts/${ref}`, "POST", mine, { action: "seed", scene: "d29-hero" }), params(ref)),
    ];
    expect(rs.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
    for (const r of rs) expect(await r.json()).toEqual({ error: "not_found" });
    expect((await store.getSession(him.userId))?.filming).toBe(false);
  });

  it("a typed wrong key is the same 404 as no key (one gate); the crew without his sign-in is 401", async () => {
    const wrong = await ownPost(req("/api/crew/filming-account", "POST", [`rp_at=${him.tokens.access_token}`], undefined, { "x-ripple-crew-key": "not the key" }));
    expect([wrong.status, (await wrong.json()).error]).toEqual([404, "not_found"]);
    const anon = await ownPost(req("/api/crew/filming-account", "POST", [crewCookie]));
    expect([anon.status, (await anon.json()).error]).toEqual([401, "not_signed_in"]);
  });

  it("his phone with the crew's cookie: not marked yet, its code; marking it changes nothing else; no id, no story day", async () => {
    const mine = [`rp_at=${him.tokens.access_token}`, crewCookie];
    const before = await (await ownGet(req("/api/crew/filming-account", "GET", mine))).json();
    expect(before).toEqual({ filming: false, ref: filmingRef(him.userId), date: "2026-10-10", time: "14:00" });
    const res = await ownPost(req("/api/crew/filming-account", "POST", mine));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...before, filming: true });
    expect(JSON.stringify(body)).not.toContain(him.userId);
    expect(Object.keys(body)).not.toContain("day");
  });

  it("the director's list has his account only; the other account's code answers 404 and its records do not move", async () => {
    const list = await (await listGet(req("/api/crew/filming-account/accounts", "GET", [crewCookie]))).json();
    const refs = (list.accounts as { ref: string }[]).map((a) => a.ref);
    expect(refs).toContain(filmingRef(him.userId));
    expect(refs).not.toContain(filmingRef(other.userId));
    const theirs = filmingRef(other.userId);
    const before = await store.listDoses(other.userId, {});
    for (const body of [{ action: "seed", scene: "d29-hero" }, { action: "forward", minutes: 5 }, { action: "reminder" }, { action: "no_reply" }, { action: "end" }]) {
      const r = await onePost(req(`/api/crew/filming-account/accounts/${theirs}`, "POST", [crewCookie], body), params(theirs));
      expect(r.status, body.action).toBe(404);
    }
    expect((await oneGet(req(`/api/crew/filming-account/accounts/${theirs}`, "GET", [crewCookie]), params(theirs))).status).toBe(404);
    const after = await store.getSession(other.userId);
    expect([after?.d0, after?.clock_offset_ms, after?.filming]).toEqual([(await store.getSession(other.userId))?.d0, null, false]);
    expect(await store.listDoses(other.userId, {})).toEqual(before);
    // an ordinary account cannot even be given an offset by the store
    await expect(store.setClockOffset(other.userId, 3600_000)).rejects.toMatchObject({ code: "account_scope" });
  });

  it("the director through the route: seed, a refused move back in words, the reminder, no reply, end; then the code is gone", async () => {
    const ref = filmingRef(him.userId);
    const call = async (body: unknown) => onePost(req(`/api/crew/filming-account/accounts/${ref}`, "POST", [crewCookie], body), params(ref));
    const seeded = await (await call({ action: "seed", scene: "d29-hero" })).json();
    expect([seeded.account.date, seeded.account.time, seeded.account.scene]).toEqual(["2026-09-22", "20:15", "d29-hero"]);
    // no display name on this test account: the list calls it by its username
    expect(seeded.account.name).toBe(seeded.account.username);
    const fwd = await (await call({ action: "forward", time: "08:45" })).json();
    expect([fwd.account.date, fwd.account.time]).toEqual(["2026-09-23", "08:45"]);
    const back = await call({ action: "forward", time: "08:00", date: "2026-09-23" });
    expect([back.status, (await back.json()).error]).toEqual([409, "forward_only"]);
    expect((await (await call({ action: "reminder" })).json()).done).toMatchObject({ kind: "dose_first", slot: "morning", date: "2026-09-23" });
    expect((await (await call({ action: "no_reply" })).json()).done).toMatchObject({ written: 1, movedTo: "09:46", familyWhy: "no_link" });
    const bad = await call({ action: "seed" });
    expect(bad.status).toBe(400);
    const ended = await (await call({ action: "end" })).json();
    expect([ended.account, ended.done.ended, ended.done.date]).toEqual([null, true, "2026-10-10"]);
    expect((await call({ action: "forward", minutes: 5 })).status).toBe(404);
  });

  it("DELETE from his phone ends filming too (marked again first)", async () => {
    const mine = [`rp_at=${him.tokens.access_token}`, crewCookie];
    await ownPost(req("/api/crew/filming-account", "POST", mine));
    const ref = filmingRef(him.userId);
    await onePost(req(`/api/crew/filming-account/accounts/${ref}`, "POST", [crewCookie], { action: "seed", scene: "d15-tai-chi" }), params(ref));
    const res = await ownDelete(req("/api/crew/filming-account", "DELETE", mine));
    expect(await res.json()).toEqual({ filming: false, ref, date: "2026-10-10", time: "14:00" });
    expect((await store.getSession(him.userId))?.clock_offset_ms).toBeNull();
  });
});
