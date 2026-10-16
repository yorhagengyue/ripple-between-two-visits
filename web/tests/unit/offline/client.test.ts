/**
 * The phone's side, end to end without a browser (C2 track O; real-app 2.25): lib/offline/client.ts with a stand-in for
 * the browser (localStorage, navigator.onLine, fetch wired straight to the real route handlers on the memory store).
 * Covers what the brief asks of the to-send list: order, the tap's own time, a harmless resend, a refusal that stays
 * visible, clearing at logout, and never sending under another account.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { POST as dosesPost } from "@/app/api/doses/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { anchorClock, flushOutbox, LIST_KEY, OWNER_KEY, phoneStorage, rememberOwner, sendBp, sendDose, takeOut, tapNow, waitingDose, type OfflineKit } from "@/lib/offline/client";
import { forgetThisPhone } from "@/lib/offline/forget";
import { mine, readAll } from "@/lib/offline/outbox";
import { ownerTag } from "@/lib/offline/owner";
import { OUTBOX_OWNER_HEADER } from "@/lib/offline/tap";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const ms = (date: string, hhmm: string) => Date.parse(SGT(date, hhmm));
const TZ = "Asia/Singapore";

// ---- the stand-in browser

class FakeStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => (this.m.has(k) ? this.m.get(k)! : null);
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
  clear = () => this.m.clear();
  get length() {
    return this.m.size;
  }
}

interface Call {
  path: string;
  body: Record<string, unknown>;
  owner: string | null;
}

const net = {
  /** the browser's own idea (navigator.onLine) */
  online: true,
  /** requests really get through */
  reachable: true,
  /** answer every API call with this status instead of the route's (a gateway in the way) */
  gateway: null as number | null,
  /** whose sign-in cookie the phone carries; null: signed out */
  token: null as string | null,
  /** signed out with the cookies already gone: the routes answer 400 no_session instead of 401 not_signed_in */
  cookiesGone: false,
  calls: [] as Call[],
  assigned: [] as string[],
};

const local = new FakeStorage();
const session = new FakeStorage();

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (input === "/api/doses" || input === "/api/bp") net.calls.push({ path: input, body: JSON.parse(String(init.body)), owner: headers.get(OUTBOX_OWNER_HEADER) });
  if (!net.reachable) throw new TypeError("Failed to fetch");
  if (net.gateway !== null) return new Response("<html>Bad gateway</html>", { status: net.gateway });
  if (net.token) headers.set("cookie", `rp_at=${net.token}`);
  const req = new NextRequest(`http://localhost${input}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : String(init.body) });
  const signedOut = () => (net.cookiesGone ? Response.json({ error: "no_session" }, { status: 400 }) : Response.json({ error: "not_signed_in" }, { status: 401 }));
  if (input === "/api/doses") return net.token ? dosesPost(req) : signedOut();
  if (input === "/api/bp") return net.token ? bpPost(req) : signedOut();
  if (input === "/api/auth/refresh") return Response.json({ error: "not_signed_in" }, { status: 401 });
  return Response.json({ error: "not_found" }, { status: 404 });
}

let him: TestAccount;
let her: TestAccount;
let kit: OfflineKit;

beforeAll(async () => {
  vi.stubGlobal("window", {
    localStorage: local,
    sessionStorage: session,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    location: { pathname: "/p/today", search: "", assign: (u: string) => void net.assigned.push(u) },
  });
  vi.stubGlobal("navigator", {
    get onLine() {
      return net.online;
    },
  });
  vi.stubGlobal("fetch", fakeFetch);
  // laid out on Mon 12 Oct 2026: that day is day 42 of the example, Tue 13 Oct is day 43
  setTestClock({ at: SGT("2026-10-12", "10:00"), frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  her = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  kit = { owner: ownerTag(him.userId) };
  // a second morning medicine for both (the example has one whose label names a time)
  for (const account of [him, her]) {
    await store.upsertMed(account.userId, { id: "med-second", origin: "prescription", status: "label_confirmed", start_day: 9, label: { text: "SECOND 10MG TABLET. Take ONE tablet every MORNING", directions: "Take ONE tablet every MORNING" } });
  }
});

beforeEach(async () => {
  local.clear();
  session.clear();
  Object.assign(net, { online: true, reachable: true, gateway: null, token: him.tokens.access_token, cookiesGone: false, calls: [], assigned: [] });
  for (const account of [him, her]) {
    for (const d of await store.listDoses(account.userId)) if (d.day >= 41) await store.deleteDose(account.userId, d.id);
    for (const r of await store.listBp(account.userId)) if (r.day >= 41) await store.deleteBp(account.userId, r.id);
  }
  // Tue 13 Oct 08:52, on the server and (anchored) on the phone
  setTestClock({ at: SGT("2026-10-13", "08:52"), frozen: true });
  anchorClock(ms("2026-10-13", "08:52"));
});

afterAll(() => {
  setTestClock(null);
  vi.unstubAllGlobals();
});

const amlodipine = { medicationId: "med-amlodipine", slot: "morning", when: "today" as const, date: "2026-10-13", tz: TZ };
const second = { ...amlodipine, medicationId: "med-second" };
const takenAnswer = { state: "taken" as const, reason: null, reason_text: null };
const hisDoses = (day = 43) => store.listDoses(him.userId, { fromDay: day, toDay: day });
const hisReadings = async () => (await store.listBp(him.userId, { fromDay: 42, toDay: 43 })).filter((r) => r.state === "recorded");
const near = (iso: string, date: string, hhmm: string) => {
  const d = Date.parse(iso) - ms(date, hhmm);
  return d >= 0 && d < 5_000;
};

describe("with a network nothing changes", () => {
  it("the answer goes straight to the server, exactly as the page always sent it, and nothing is kept on the phone", async () => {
    const r = await sendDose(kit, amlodipine, takenAnswer);
    expect(r.kind).toBe("sent");
    expect(net.calls).toEqual([{ path: "/api/doses", body: { medication_id: "med-amlodipine", slot: "morning", state: "taken", reason: null, reason_text: null }, owner: null }]);
    expect(await hisDoses()).toMatchObject([{ state: "taken", created_at: new Date(ms("2026-10-13", "08:52")).toISOString() }]);
    const id = randomUUID();
    const b = await sendBp<{ reading?: { id: string } }>(kit, { id, systolic: 138, diastolic: 82, pulse: null });
    expect(b).toMatchObject({ kind: "sent", json: { reading: { id } } });
    expect(net.calls[1]).toEqual({ path: "/api/bp", body: { id, systolic: 138, diastolic: 82 }, owner: null });
    expect(local.getItem(LIST_KEY)).toBeNull();
    // a refusal is the page's ordinary failure, not something to keep
    const refused = await sendDose(kit, { ...amlodipine, slot: "night" }, takenAnswer);
    expect(refused).toEqual({ kind: "failed", status: 409 });
    expect(local.getItem(LIST_KEY)).toBeNull();
  });
});

describe("without a network", () => {
  it("a medicine and a reading are kept with the moment he tapped, then sent in order, once, when the network is back", async () => {
    net.online = false;
    net.reachable = false;
    const d1 = await sendDose(kit, amlodipine, takenAnswer);
    const d2 = await sendDose(kit, second, takenAnswer);
    const id = randomUUID();
    const b = await sendBp(kit, { id, systolic: 138, diastolic: 82, pulse: 70 });
    expect([d1.kind, d2.kind, b.kind]).toEqual(["queued", "queued", "queued"]);
    // the browser said offline: nothing was even tried
    expect(net.calls).toEqual([]);
    const kept = mine(phoneStorage, kit.owner);
    expect(kept.map((e) => [e.kind, e.state, e.owner])).toEqual([
      ["dose", "waiting", kit.owner],
      ["dose", "waiting", kit.owner],
      ["bp", "waiting", kit.owner],
    ]);
    expect(kept.every((e) => near(e.at, "2026-10-13", "08:52"))).toBe(true);
    // what the phone keeps: the medicine's id (it has to say which), never its name, strength or label words, and no
    // id of his account or his space; what the list shows (label) names no medicine at all, only the part of the day
    const raw = local.getItem(LIST_KEY)!;
    expect(raw).not.toContain(him.userId);
    expect(raw).not.toMatch(/TABLET|5 ?mg|10 ?MG|Take ONE/i);
    expect(JSON.stringify(kept.map((e) => e.label))).not.toMatch(/med-|amlodipine|second/i);
    expect(await hisDoses()).toEqual([]);

    // still no network at 9:30: the flush sends nothing and everything waits
    setTestClock({ at: SGT("2026-10-13", "09:30"), frozen: true });
    expect(await flushOutbox(kit)).toMatchObject({ sent: [], waiting: 0, stopped: null }); // offline: not even tried
    net.online = true;
    expect(await flushOutbox(kit)).toMatchObject({ stopped: "no_network", waiting: 3 });
    expect(net.calls).toHaveLength(1);

    // 10:20, the network is back
    net.calls = [];
    net.reachable = true;
    setTestClock({ at: SGT("2026-10-13", "10:20"), frozen: true });
    const report = await flushOutbox(kit);
    expect(report).toMatchObject({ stopped: null, waiting: 0 });
    expect(report.sent.map((e) => e.id)).toEqual(kept.map((e) => e.id));
    // in the order he tapped, each with its own moment and the owner tag
    expect(net.calls.map((c) => [c.path, c.body.medication_id ?? c.body.id, c.body.at, c.owner])).toEqual([
      ["/api/doses", "med-amlodipine", kept[0].at, kit.owner],
      ["/api/doses", "med-second", kept[1].at, kit.owner],
      ["/api/bp", id, kept[2].at, kit.owner],
    ]);
    // on the server: the time he tapped (8:52), not the time it went out (10:20)
    const doses = await hisDoses();
    expect(doses.map((d) => [d.medication_id, d.state]).sort()).toEqual([
      ["med-amlodipine", "taken"],
      ["med-second", "taken"],
    ]);
    expect(doses.every((d) => near(d.created_at, "2026-10-13", "08:52"))).toBe(true);
    const readings = await hisReadings();
    expect(readings).toMatchObject([{ id, day: 43, slot: "morning", systolic: 138, diastolic: 82, pulse: 70 }]);
    expect(near(readings[0].created_at, "2026-10-13", "08:52")).toBe(true);
    expect(local.getItem(LIST_KEY)).toBeNull();

    // nothing left to send: a second flush asks the server nothing
    net.calls = [];
    await flushOutbox(kit);
    expect(net.calls).toEqual([]);
    expect(await hisDoses()).toHaveLength(2);
    expect(await hisReadings()).toHaveLength(1);
  });

  it("the browser says online but nothing gets through, or a gateway answers 503: kept the same way", async () => {
    net.reachable = false;
    expect((await sendDose(kit, amlodipine, takenAnswer)).kind).toBe("queued");
    expect(net.calls).toHaveLength(1); // the direct try was made
    net.reachable = true;
    for (const status of [502, 503, 504]) {
      net.gateway = status;
      const r = await sendBp(kit, { id: randomUUID(), systolic: 130, diastolic: 80 });
      expect(r.kind, String(status)).toBe("queued");
    }
    net.gateway = 500;
    expect(await sendBp(kit, { id: randomUUID(), systolic: 131, diastolic: 81 })).toEqual({ kind: "failed", status: 500 });
    expect(mine(phoneStorage, kit.owner)).toHaveLength(4);
    net.gateway = null;
    expect(await flushOutbox(kit)).toMatchObject({ stopped: null, waiting: 0 });
    expect(await hisDoses()).toHaveLength(1);
    expect(await hisReadings()).toHaveLength(3);
  });

  it("the reply was lost: the entry is sent again and the server holds one row", async () => {
    // the direct try reaches the server, its answer does not reach the phone
    const id = randomUUID();
    const realFetch = fakeFetch;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      await realFetch(input, init);
      throw new TypeError("Failed to fetch");
    });
    try {
      expect((await sendDose(kit, amlodipine, takenAnswer)).kind).toBe("queued");
      expect((await sendBp(kit, { id, systolic: 138, diastolic: 82 })).kind).toBe("queued");
      expect(await hisDoses()).toHaveLength(1);
      expect(await hisReadings()).toHaveLength(1);
      // the resend's answer is lost too
      expect(await flushOutbox(kit)).toMatchObject({ stopped: "no_network", waiting: 2 });
    } finally {
      vi.stubGlobal("fetch", fakeFetch);
    }
    setTestClock({ at: SGT("2026-10-13", "09:40"), frozen: true });
    expect(await flushOutbox(kit)).toMatchObject({ stopped: null, waiting: 0 });
    // the row the first try wrote stands: the same row, not a second one, not rewritten
    expect(await hisDoses()).toMatchObject([{ medication_id: "med-amlodipine", state: "taken", created_at: new Date(ms("2026-10-13", "08:52")).toISOString() }]);
    expect(await hisReadings()).toMatchObject([{ id, systolic: 138, diastolic: 82 }]);
  });

  it("a later answer for the same cell replaces the one still on the phone; undo takes it out before it is ever sent", async () => {
    net.online = false;
    await sendDose(kit, amlodipine, { state: "missed", reason: null, reason_text: null });
    await sendDose(kit, amlodipine, { state: "missed", reason: "forgot", reason_text: "忘了" });
    const waiting = waitingDose(kit, amlodipine);
    expect(mine(phoneStorage, kit.owner)).toHaveLength(1);
    expect(waiting?.body).toMatchObject({ state: "missed", reason: "forgot" });
    // no reason text in what the list shows
    expect(waiting?.label).toEqual({ kind: "dose", slot: "morning", state: "missed", reason: null });
    expect(takeOut(kit, waiting!.id)).toBe(true);
    expect(waitingDose(kit, amlodipine)).toBeNull();
    net.online = true;
    await flushOutbox(kit);
    expect(net.calls).toEqual([]);
    expect(await hisDoses()).toEqual([]);
  });

  it("the phone's clock is anchored on the server's: a phone with the wrong time still records the right moment", async () => {
    // the phone thinks it is whatever Date.now() says; the server said 08:52 when the page was drawn
    expect(Math.abs(tapNow() - ms("2026-10-13", "08:52"))).toBeLessThan(5_000);
    anchorClock(ms("2026-10-13", "21:07"));
    net.online = false;
    const r = await sendBp(kit, { id: randomUUID(), systolic: 141, diastolic: 88 });
    expect(r.kind === "queued" && near(r.at, "2026-10-13", "21:07")).toBe(true);
  });

  it("a page left open over midnight: the cell he answered is 「昨天」 counted from the tap", async () => {
    anchorClock(ms("2026-10-14", "00:05"));
    net.online = false;
    expect((await sendDose(kit, amlodipine, takenAnswer)).kind).toBe("queued");
    expect(mine(phoneStorage, kit.owner)[0].body).toMatchObject({ when: "yesterday" });
    // a page two days old cannot place its answer: not kept, the page says it failed
    anchorClock(ms("2026-10-15", "00:05"));
    expect(await sendDose(kit, second, takenAnswer)).toEqual({ kind: "failed", status: 0 });
    net.online = true;
    setTestClock({ at: SGT("2026-10-14", "07:00"), frozen: true });
    await flushOutbox(kit);
    expect(await hisDoses(43)).toMatchObject([{ medication_id: "med-amlodipine", day: 43, state: "taken" }]);
    expect(await hisDoses(44)).toEqual([]);
  });

  it("an entry the server refuses stays on the phone with the reason; the rest goes out", async () => {
    net.online = false;
    await sendDose(kit, amlodipine, takenAnswer);
    await sendBp(kit, { id: randomUUID(), systolic: 138, diastolic: 82 });
    await sendDose(kit, { ...second, slot: "night" }, takenAnswer); // not taken at night
    net.online = true;
    // three days pass before the phone is online again
    setTestClock({ at: SGT("2026-10-16", "09:00"), frozen: true });
    const report = await flushOutbox(kit);
    expect(report.stopped).toBeNull();
    expect(report.sent).toEqual([]);
    expect(mine(phoneStorage, kit.owner).map((e) => [e.kind, e.state, e.why])).toEqual([
      ["dose", "refused", "too_late"],
      ["bp", "refused", "too_late"],
      ["dose", "refused", "too_late"],
    ]);
    expect(await hisDoses()).toEqual([]);
    // still there after another flush and another page load; only he puts it away
    net.calls = [];
    await flushOutbox(kit);
    expect(net.calls).toEqual([]);
    const first = mine(phoneStorage, kit.owner)[0];
    expect(takeOut(kit, first.id)).toBe(true);
    expect(mine(phoneStorage, kit.owner)).toHaveLength(2);
  });

  it("not_due is refused with its own reason while the entry before and after it go out", async () => {
    net.online = false;
    await sendDose(kit, amlodipine, takenAnswer);
    await sendDose(kit, { ...second, slot: "night" }, takenAnswer);
    const id = randomUUID();
    await sendBp(kit, { id, systolic: 138, diastolic: 82 });
    net.online = true;
    const report = await flushOutbox(kit);
    expect(report.sent).toHaveLength(2);
    expect(mine(phoneStorage, kit.owner).map((e) => [e.state, e.why])).toEqual([["refused", "not_due"]]);
    expect(await hisDoses()).toHaveLength(1);
    expect(await hisReadings()).toHaveLength(1);
  });

  it("outside an account's own pages (no owner) nothing is ever kept", async () => {
    net.online = false;
    expect(await sendDose({ owner: null }, amlodipine, takenAnswer)).toEqual({ kind: "failed", status: 0 });
    expect(await sendBp({ owner: null }, { id: randomUUID(), systolic: 138, diastolic: 82 })).toEqual({ kind: "failed", status: 0 });
    expect(local.getItem(LIST_KEY)).toBeNull();
  });
});

describe("a sign-in that ended", () => {
  it("keeps the answer, sends the page to the login, and the list goes out when he is back", async () => {
    net.token = null;
    const r = await sendDose(kit, amlodipine, takenAnswer);
    expect(r.kind).toBe("queued");
    expect(net.assigned).toEqual(["/login?next=%2Fp%2Ftoday"]);
    // a flush while signed out keeps everything and sends him to the login as well
    net.assigned = [];
    expect(await flushOutbox(kit)).toMatchObject({ stopped: "signed_out", waiting: 1 });
    expect(net.assigned).toEqual(["/login?next=%2Fp%2Ftoday"]);
    net.token = him.tokens.access_token;
    setTestClock({ at: SGT("2026-10-13", "09:15"), frozen: true });
    expect(await flushOutbox(kit)).toMatchObject({ stopped: null, waiting: 0 });
    expect(await hisDoses()).toMatchObject([{ state: "taken" }]);
    expect(near((await hisDoses())[0].created_at, "2026-10-13", "08:52")).toBe(true);
  });
});

describe("a sign-in whose cookies are already gone (the routes answer 400 no_session)", () => {
  it("is the same thing on an account's page: kept, to the login, sent when he is back", async () => {
    net.token = null;
    net.cookiesGone = true;
    const id = randomUUID();
    expect((await sendBp(kit, { id, systolic: 138, diastolic: 82 })).kind).toBe("queued");
    expect(net.assigned).toEqual(["/login?next=%2Fp%2Ftoday"]);
    expect(await flushOutbox(kit)).toMatchObject({ stopped: "signed_out", waiting: 1 });
    expect(mine(phoneStorage, kit.owner).map((e) => e.state)).toEqual(["waiting"]);
    net.token = him.tokens.access_token;
    expect(await flushOutbox(kit)).toMatchObject({ stopped: null, waiting: 0 });
    expect((await hisReadings()).map((r) => r.id)).toEqual([id]);
  });
});

describe("another account on the same phone", () => {
  it("his entries are not sent, not listed and not touched under her sign-in; under his own again, they go out", async () => {
    net.online = false;
    await sendDose(kit, amlodipine, takenAnswer);
    const id = randomUUID();
    await sendBp(kit, { id, systolic: 150, diastolic: 95 });
    net.online = true;
    // his sign-in ended without a logout; she signs in on this phone and her pages draw with her tag
    net.token = her.tokens.access_token;
    const hers: OfflineKit = { owner: ownerTag(her.userId) };
    rememberOwner(hers.owner);
    expect(mine(phoneStorage, hers.owner)).toEqual([]);
    expect(await flushOutbox(hers)).toMatchObject({ sent: [], waiting: 0 });
    expect(net.calls).toEqual([]);
    expect(await store.listDoses(her.userId, { fromDay: 43, toDay: 43 })).toEqual([]);
    expect((await store.listBp(her.userId, { fromDay: 43, toDay: 43 })).filter((r) => r.id === id)).toEqual([]);
    // a page of his still open in another tab tries to flush with her cookie: the server refuses, nothing is written
    const stale = await flushOutbox(kit);
    expect(stale).toMatchObject({ stopped: "other_account", waiting: 2 });
    expect(net.calls).toHaveLength(1);
    expect(await store.listDoses(her.userId, { fromDay: 43, toDay: 43 })).toEqual([]);
    expect(mine(phoneStorage, kit.owner).every((e) => e.state === "waiting")).toBe(true);
    // she records her own while his wait: only hers go out
    net.calls = [];
    net.online = false;
    await sendDose(hers, amlodipine, takenAnswer);
    net.online = true;
    expect((await flushOutbox(hers)).sent).toHaveLength(1);
    expect(net.calls.map((c) => c.owner)).toEqual([hers.owner]);
    expect(await store.listDoses(her.userId, { fromDay: 43, toDay: 43 })).toHaveLength(1);
    expect(await hisDoses()).toEqual([]);
    // he signs in again: his two go out under his own account
    net.token = him.tokens.access_token;
    expect((await flushOutbox(kit)).sent).toHaveLength(2);
    expect(await hisDoses()).toHaveLength(1);
    expect((await hisReadings()).map((r) => r.id)).toEqual([id]);
  });
});

describe("logging out", () => {
  it("clears the to-send list (waiting and refused, his and anyone's), the owner tag, her per-link keys and the session storage", async () => {
    net.online = false;
    await sendDose(kit, amlodipine, takenAnswer);
    await sendBp(kit, { id: randomUUID(), systolic: 138, diastolic: 82 });
    await sendBp({ owner: ownerTag(her.userId) }, { id: randomUUID(), systolic: 120, diastolic: 80 });
    rememberOwner(kit.owner);
    local.setItem("rp_f_phone_link-1", "+65 0000 0000");
    local.setItem("rp_f_welcomed_link-1", "1");
    session.setItem("anything", "x");
    expect(readAll(phoneStorage)).toHaveLength(3);
    expect(local.getItem(OWNER_KEY)).toBe(kit.owner);

    await forgetThisPhone();

    expect(readAll(phoneStorage)).toEqual([]);
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
    // the next person on this phone sends nothing of his, and he himself has nothing left to send
    net.online = true;
    net.calls = [];
    await flushOutbox(kit);
    net.token = her.tokens.access_token;
    await flushOutbox({ owner: ownerTag(her.userId) });
    expect(net.calls).toEqual([]);
    expect(await hisDoses()).toEqual([]);
  });
});
