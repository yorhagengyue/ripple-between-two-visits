/**
 * The fence between the film crew's controls and people's accounts (docs/plan/real-app.md 5.6 H2, line 1102: 「单元
 * subject/account-fence：逐个接口，带和不带 rp_crew、filming_mode 开和关各测一次」; 5.1 lines 1016-1023, 5.2, 5.4; 8.6 line
 * 1476, 8.11 lines 1532-1536; C2 track G).
 *
 * The rule, in the design's words: an ordinary account that calls the story clock, a cue, a reset, the scripted
 * fallback or the director's replay gets 404, with or without the crew's key; a filming account needs BOTH the crew's
 * cookie and its filming mark, and with either one missing it is refused. Here every crew, director, clock, cue,
 * reset, replay and filming endpoint is called for every cell of that matrix, and each cell is compared with the one
 * answer the design gives it:
 *
 *   whose account     ordinary (Mr Tan's example data), ordinary (blank), a filming account (marked by its owner and
 *                     laid out by the director), and an account whose filming was ended (the mark is off again)
 *   the crew's proof  none; a cookie that is not a key's digest at all; the digest of a key that is not accepted (a
 *                     stale cookie after the key changed); and the accepted ones: the cookie of the accepted key, the
 *                     key in the x-ripple-crew-key header, and the key in the body where a route reads one. A typed
 *                     key that is wrong has its own block: 404 like no key at all (one gate, one answer), ten of them
 *                     close that client's typed keys for ten minutes, and nothing moves.
 *
 *   the demo's own controls        POST /api/clock, /api/director/cue, /api/director/filming, /api/director/replay,
 *                                  /api/session/reset, GET /api/session, POST /api/visits/[id]/extract: 404 not_found
 *                                  in EVERY cell. They work on a demo session only; a filming account is moved from the
 *                                  director's desk, never through these.
 *   the scripted fallback          POST /api/visits/[id]/scripted: 404 in every cell but one: a filming account, on
 *                                  its own signed-in phone, with an accepted proof.
 *   his own filming mark           GET / POST / DELETE /api/crew/filming-account: 404 without an accepted proof (a
 *                                  marked account stays marked, an unmarked one unmarked); with it, his own account
 *                                  only, and 401 without his sign-in.
 *   the director's desk            GET /api/crew/filming-account/accounts, GET and POST .../accounts/[ref] (lay out,
 *                                  forward, reminder, no reply, script fallback, end): 404 without an accepted proof;
 *                                  with it, 404 for every account that is not marked (never marked, or ended), whoever
 *                                  is signed in on the calling browser; only a marked account answers.
 *   the example's samples          GET /api/labels/sample on a blank account: 403 example_only unless it is a filming
 *                                  account AND the request is the crew's.
 *   the crew's trial page          GET /api/real: the crew's proof alone opens it; an account's sign-in adds nothing
 *                                  and nothing of the account is in the answer.
 *
 * After every cell that must refuse, everything the store holds of that account is byte for byte what it was (its
 * clock, its filming mark, its rows). The accepted cookie is made from the key the process accepts
 * (lib/session/crew-key.ts crewCookieValue), never a made-up string. A route under app/api that uses the crew's gate or
 * the demo-only resolution and is not in this matrix fails the last test until it is added here or listed with a reason.
 *
 * tests/unit/subject/account-fence.test.ts (track E, written the same night) holds the four-way core of this matrix: an
 * ordinary and a marked account, without and with the cookie. This file is the whole of it: the blank and the ended
 * account, the stale and junk cookies, the header and body keys, the wrong typed key, his own mark, every action of the
 * director's desk, the samples, the byte-for-byte check after each refusal, and the list that a new crew route must be on.
 *
 * Real time is the developer test clock, frozen at Mon 12 Oct 2026 15:00 in Singapore (as track J's tests).
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as clockPost } from "@/app/api/clock/route";
import { GET as deskListGet } from "@/app/api/crew/filming-account/accounts/route";
import { GET as deskGet, POST as deskPost } from "@/app/api/crew/filming-account/accounts/[ref]/route";
import { DELETE as markDelete, GET as markGet, POST as markPost } from "@/app/api/crew/filming-account/route";
import { POST as cuePost } from "@/app/api/director/cue/route";
import { POST as filmingPost } from "@/app/api/director/filming/route";
import { POST as replayPost } from "@/app/api/director/replay/route";
import { GET as sampleGet } from "@/app/api/labels/sample/route";
import { GET as realGet } from "@/app/api/real/route";
import { POST as resetPost } from "@/app/api/session/reset/route";
import { GET as sessionGet } from "@/app/api/session/route";
import { POST as extractPost } from "@/app/api/visits/[id]/extract/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { endFilming, filmingRef, findFilming, markFilming, seedToMoment } from "@/lib/crew/filming-account";
import { CREW_COOKIE, CREW_HEADER, crewCookieAccepted, crewCookieValue, crewKeyAccepted, DEV_ONLY_CREW_KEY } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { filmingEntry } from "@/lib/subject/filming";
import { setTestClock } from "@/lib/time/now";
import { visitLive } from "@/lib/visit/state";
import { everythingOf, resetAllLimits } from "../../support/everything-of";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const REAL = Date.parse("2026-10-12T15:00:00+08:00");
const NOT_FOUND = { error: "not_found" };

// ------------------------------------------------------------------ the crew's proof

type Proof = "none" | "junk cookie" | "stale cookie" | "cookie" | "header" | "body";
const REFUSED_PROOFS: Proof[] = ["none", "junk cookie", "stale cookie"];
const ACCEPTED_PROOFS: Proof[] = ["cookie", "header"];
const PROOFS: Proof[] = [...REFUSED_PROOFS, ...ACCEPTED_PROOFS];
const accepted = (p: Proof) => p === "cookie" || p === "header" || p === "body";

/** The cookie a crew browser carries after /backstage/crew accepted the key: the digest of the key this process accepts. */
const ACCEPTED_COOKIE = crewCookieValue(DEV_ONLY_CREW_KEY);
/** The same digest for a key this process does not accept: what a crew browser still carries after the key changed. */
const STALE_COOKIE = crewCookieValue("last month's key");

interface Call {
  /** the signed-in person's token, or none */
  token?: string | null;
  proof: Proof;
  body?: Record<string, unknown>;
  /** the body field a route reads the key from ("crew_key", "key"), for proof "body" */
  keyField?: string;
  query?: string;
}

function request(method: string, pathname: string, c: Call): NextRequest {
  const cookies: string[] = [];
  if (c.token) cookies.push(`rp_at=${c.token}`);
  if (c.proof === "junk cookie") cookies.push(`${CREW_COOKIE}=anything`);
  if (c.proof === "stale cookie") cookies.push(`${CREW_COOKIE}=${STALE_COOKIE}`);
  if (c.proof === "cookie") cookies.push(`${CREW_COOKIE}=${ACCEPTED_COOKIE}`);
  const headers: Record<string, string> = {};
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (c.proof === "header") headers[CREW_HEADER] = DEV_ONLY_CREW_KEY;
  const sendsBody = method !== "GET" && method !== "DELETE";
  const body = sendsBody ? { ...(c.body ?? {}), ...(c.proof === "body" && c.keyField ? { [c.keyField]: DEV_ONLY_CREW_KEY } : {}) } : undefined;
  if (body) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${pathname}${c.query ? `?${c.query}` : ""}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function answerOf(res: Response): Promise<{ status: number; body: unknown; text: string }> {
  const text = (res.headers.get("content-type") ?? "").includes("json") ? await res.text() : "";
  if (!text) await res.body?.cancel().catch(() => undefined);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

// ------------------------------------------------------------------ whose account

type Whose = "ordinary (example)" | "ordinary (blank)" | "filming" | "ended";
const WHOSE: Whose[] = ["ordinary (example)", "ordinary (blank)", "filming", "ended"];

interface Person {
  whose: Whose;
  account: TestAccount;
  token: string;
  ref: string;
  /** a visit of his own that is being recorded right now (the scripted fallback and extract have something to act on) */
  visitId: string;
  scope: () => Promise<SessionRow>;
}

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function person(whose: Whose): Promise<Person> {
  const space = whose === "ordinary (blank)" ? "blank" : "example";
  const account = await createAccountWithSpace(store, getAuthProvider(), { login: login("fence"), password: PASSWORD, space });
  const scope = async () => (await store.getSession(account.userId))!;
  if (whose === "filming" || whose === "ended") {
    await markFilming(store, await scope());
    const subject = (await findFilming(filmingRef(account.userId), filmingEntry(store)))!;
    // the scene of the second visit, a little before it: the visit he records next is the one the script belongs to
    await seedToMoment(subject, { scene: "d8-visit" }, REAL);
  }
  if (whose === "ended") await endFilming(store, await scope(), REAL, "director");
  const started = await visitsPost(request("POST", "/api/visits", { token: account.tokens.access_token, proof: "none", body: { mode: "record", consent: { given: true }, place: "clinic" } }));
  expect(started.status, `${whose}: his own visit starts`).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const p: Person = { whose, account, token: account.tokens.access_token, ref: filmingRef(account.userId), visitId, scope };
  const row = await scope();
  expect([whose, row.kind, row.filming, row.clock_offset_ms !== null]).toEqual([whose, "account", whose === "filming", whose === "filming"]);
  return p;
}

const snapshot = (p: Person) => everythingOf(store, p.account.userId);

beforeAll(() => {
  setTestClock({ at: REAL, frozen: true });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => {
  setTestClock(null);
  vi.restoreAllMocks();
});
beforeEach(() => resetAllLimits(store));

// ------------------------------------------------------------------ the proofs themselves

describe("the crew's proof used in this file is the real one", () => {
  it("the accepted cookie is the digest of the key this process accepts; the stale one has the same shape and is refused", () => {
    expect(crewKeyAccepted(DEV_ONLY_CREW_KEY)).toBe(true);
    expect(crewCookieAccepted(ACCEPTED_COOKIE)).toBe(true);
    expect(ACCEPTED_COOKIE).toMatch(/^[0-9a-f]{64}$/);
    expect(STALE_COOKIE).toMatch(/^[0-9a-f]{64}$/);
    expect(crewCookieAccepted(STALE_COOKIE)).toBe(false);
    expect(crewCookieAccepted("anything")).toBe(false);
  });

  it("on a demo session the accepted proofs do open these controls (so a 404 below is the fence, not a broken call)", async () => {
    const demo = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    for (const proof of ACCEPTED_PROOFS) {
      const moved = await answerOf(await clockPost(request("POST", "/api/clock", { proof, body: { day: 30 }, query: `session=${demo.id}` })));
      expect([proof, moved.status]).toEqual([proof, 200]);
      const cue = await answerOf(await cuePost(request("POST", "/api/director/cue", { proof, body: { cue: "reminder" }, query: `session=${demo.id}` })));
      expect([proof, cue.status]).toEqual([proof, 200]);
    }
    for (const proof of REFUSED_PROOFS) {
      const r = await answerOf(await clockPost(request("POST", "/api/clock", { proof, body: { day: 31 }, query: `session=${demo.id}` })));
      expect([proof, r.status, r.body]).toEqual([proof, 404, NOT_FOUND]);
    }
    expect((await store.getSession(demo.id))!.story_day).toBe(30);
  });
});

// ------------------------------------------------------------------ the demo's own controls: 404 in every cell

interface Control {
  name: string;
  /** the route file, for the last test's count */
  route: string;
  keyField?: string;
  call: (p: Person, c: Call) => Promise<Response>;
}

const DEMO_CONTROLS: Control[] = [
  { name: "POST /api/clock { day }", route: "app/api/clock/route.ts", call: (_p, c) => clockPost(request("POST", "/api/clock", { ...c, body: { day: 3 } })) },
  { name: "POST /api/clock { beat, show }", route: "app/api/clock/route.ts", call: (_p, c) => clockPost(request("POST", "/api/clock", { ...c, body: { beat: "d29-hero", show: true } })) },
  { name: "POST /api/director/cue reminder", route: "app/api/director/cue/route.ts", call: (_p, c) => cuePost(request("POST", "/api/director/cue", { ...c, body: { cue: "reminder" } })) },
  { name: "POST /api/director/cue no_reply", route: "app/api/director/cue/route.ts", call: (_p, c) => cuePost(request("POST", "/api/director/cue", { ...c, body: { cue: "no_reply" } })) },
  { name: "POST /api/director/filming on", route: "app/api/director/filming/route.ts", keyField: "crew_key", call: (_p, c) => filmingPost(request("POST", "/api/director/filming", { ...c, keyField: "crew_key", body: { on: true } })) },
  { name: "POST /api/director/filming off", route: "app/api/director/filming/route.ts", keyField: "crew_key", call: (_p, c) => filmingPost(request("POST", "/api/director/filming", { ...c, keyField: "crew_key", body: { on: false } })) },
  { name: "POST /api/director/replay start", route: "app/api/director/replay/route.ts", call: (_p, c) => replayPost(request("POST", "/api/director/replay", { ...c, body: { action: "start" } })) },
  { name: "POST /api/director/replay stop", route: "app/api/director/replay/route.ts", call: (_p, c) => replayPost(request("POST", "/api/director/replay", { ...c, body: { action: "stop" } })) },
  { name: "POST /api/session/reset", route: "app/api/session/reset/route.ts", call: (_p, c) => resetPost(request("POST", "/api/session/reset", { ...c, body: {} })) },
  { name: "GET /api/session", route: "app/api/session/route.ts", call: (_p, c) => sessionGet(request("GET", "/api/session", c)) },
  {
    name: "POST /api/visits/[id]/extract",
    route: "app/api/visits/[id]/extract/route.ts",
    call: (p, c) =>
      extractPost(request("POST", `/api/visits/${p.visitId}/extract`, { ...c, body: { utterances: [{ t_start_ms: 0, t_end_ms: 1000, text: "Doctor: take two tablets" }] } }), {
        params: Promise.resolve({ id: p.visitId }),
      }),
  },
];

describe("the demo's own controls on an account: 404 not_found in every cell, and nothing of the account moves", () => {
  for (const whose of WHOSE) {
    it(`${whose} account: clock, cues, filming mode, replay, reset, the session row and extract, with every proof`, async () => {
      const p = await person(whose);
      const before = snapshot(p);
      const wrong: string[] = [];
      for (const control of DEMO_CONTROLS) {
        const proofs: Proof[] = control.keyField ? [...PROOFS, "body"] : PROOFS;
        for (const proof of proofs) {
          const r = await answerOf(await control.call(p, { token: p.token, proof }));
          if (r.status !== 404 || JSON.stringify(r.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`${control.name} [${proof}]: ${r.status} ${r.text.slice(0, 80)}`);
          if (snapshot(p) !== before) wrong.push(`${control.name} [${proof}]: something of the account changed`);
        }
      }
      expect(wrong).toEqual([]);
      expect(await store.listUtterances(p.account.userId, p.visitId)).toEqual([]);
    });
  }
});

describe("a typed key that is wrong, on an account: 404 like no key at all, and nothing moves", () => {
  // One gate, one answer (real-app 5.2 line 1034: 「没有拍摄组 cookie 一律 404」; lib/crew/gate.ts since track E's second
  // round): a key that was typed (the header or a body field) and is wrong gets the same 404 as no key, so nobody can
  // tell a wrong key from a route that does not exist. Only the sign-in door (POST /api/session/crew) answers a typed
  // key in words. A wrong typed key still counts against the client: after ten, that client's typed keys are not looked
  // at for ten minutes, the right one included; a cookie still is. On an account none of it opens or moves anything.
  const cookieOf = (p: Person) => `rp_at=${p.token}`;
  const typed = (p: Person, method: string, pathname: string, key: string): NextRequest =>
    new NextRequest(`http://localhost${pathname}`, {
      method,
      headers: { cookie: cookieOf(p), [CREW_HEADER]: key, ...(method === "GET" || method === "DELETE" ? {} : { "content-type": "application/json" }) },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });

  for (const whose of WHOSE) {
    it(`${whose} account`, async () => {
      const p = await person(whose);
      const before = snapshot(p);
      const call = (method: string, pathname: string) => typed(p, method, pathname, "not the crew's key");
      const ref = { params: Promise.resolve({ ref: p.ref }) };
      const id = { params: Promise.resolve({ id: p.visitId }) };
      const cells: [string, () => Promise<Response>][] = [
        ["POST /api/clock", async () => clockPost(call("POST", "/api/clock"))],
        ["POST /api/director/cue", async () => cuePost(call("POST", "/api/director/cue"))],
        ["POST /api/director/filming", async () => filmingPost(call("POST", "/api/director/filming"))],
        ["POST /api/director/replay", async () => replayPost(call("POST", "/api/director/replay"))],
        ["POST /api/session/reset", async () => resetPost(call("POST", "/api/session/reset"))],
        ["GET /api/session", async () => sessionGet(call("GET", "/api/session"))],
        ["GET /api/crew/filming-account", async () => markGet(call("GET", "/api/crew/filming-account"))],
        ["POST /api/crew/filming-account", async () => markPost(call("POST", "/api/crew/filming-account"))],
        ["DELETE /api/crew/filming-account", async () => markDelete(call("DELETE", "/api/crew/filming-account"))],
        ["GET /api/crew/filming-account/accounts", async () => deskListGet(call("GET", "/api/crew/filming-account/accounts"))],
        ["GET /api/crew/filming-account/accounts/[ref]", async () => deskGet(call("GET", `/api/crew/filming-account/accounts/${p.ref}`), ref)],
        ["POST /api/crew/filming-account/accounts/[ref]", async () => deskPost(call("POST", `/api/crew/filming-account/accounts/${p.ref}`), ref)],
        ["GET /api/real", async () => realGet(call("GET", "/api/real"))],
        ["POST /api/visits/[id]/scripted", async () => scriptedPost(call("POST", `/api/visits/${p.visitId}/scripted`), id)],
      ];
      const wrong: string[] = [];
      for (const [name, ask] of cells) {
        // each cell is a first try (ten wrong keys close the client's typed keys: the last lines of this test)
        resetAllLimits(store);
        const r = await answerOf(await ask());
        if (r.status !== 404 || JSON.stringify(r.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`${name}: ${r.status} ${r.text.slice(0, 80)}`);
      }
      expect(wrong).toEqual([]);
      expect(snapshot(p)).toBe(before);
      expect(visitLive(p.account.userId, p.visitId).fallbackOn).toBe(false);
    });
  }

  it("ten wrong typed keys: that client's typed keys are closed, the right one included; the cookie still opens the one cell it may", async () => {
    const film = await person("filming");
    const scripted = (req: NextRequest) => scriptedPost(req, { params: Promise.resolve({ id: film.visitId }) });
    resetAllLimits(store);
    for (let i = 1; i <= 10; i++) expect((await clockPost(typed(film, "POST", "/api/clock", `not the key ${i}`))).status).toBe(404);
    // the right key, typed: not looked at while the client is locked out
    const locked = await answerOf(await scripted(new NextRequest(`http://localhost/api/visits/${film.visitId}/scripted`, { method: "POST", headers: { cookie: cookieOf(film), [CREW_HEADER]: DEV_ONLY_CREW_KEY, "content-type": "application/json" }, body: JSON.stringify({ on: true }) })));
    expect([locked.status, locked.body]).toEqual([404, NOT_FOUND]);
    expect(visitLive(film.account.userId, film.visitId).fallbackOn).toBe(false);
    // the crew's browser, which holds the cookie, is not locked out by someone else's wrong tries
    const withCookie = await answerOf(await scripted(request("POST", `/api/visits/${film.visitId}/scripted`, { token: film.token, proof: "cookie", body: { on: true } })));
    expect([withCookie.status, withCookie.body]).toEqual([200, { fallback: { allowed: true, on: true, unlockable: false } }]);
    resetAllLimits(store);
  });
});

// ------------------------------------------------------------------ the scripted fallback: one cell answers

describe("POST /api/visits/[id]/scripted: only a filming account, on its own phone, with an accepted proof", () => {
  const scripted = (p: Person, c: Call, on: boolean) =>
    scriptedPost(request("POST", `/api/visits/${p.visitId}/scripted`, { ...c, keyField: "key", body: { on } }), { params: Promise.resolve({ id: p.visitId }) });

  for (const whose of WHOSE) {
    it(`${whose} account`, async () => {
      const p = await person(whose);
      const before = snapshot(p);
      const cells: string[] = [];
      for (const proof of [...PROOFS, "body"] as Proof[]) {
        for (const on of [true, false]) {
          const r = await answerOf(await scripted(p, { token: p.token, proof }, on));
          const opens = whose === "filming" && accepted(proof);
          const designed = opens ? { status: 200, body: { fallback: { allowed: true, on, unlockable: false } } } : { status: 404, body: NOT_FOUND };
          if (r.status !== designed.status || JSON.stringify(r.body) !== JSON.stringify(designed.body)) cells.push(`[${proof}, on ${on}]: ${r.status} ${r.text.slice(0, 100)}, designed ${designed.status}`);
          if (!opens && snapshot(p) !== before) cells.push(`[${proof}, on ${on}]: something of the account changed`);
          // the switch itself: on only after the one cell that may set it, off again after its "off"
          const isOn = visitLive(p.account.userId, p.visitId).fallbackOn;
          if (isOn !== (opens && on)) cells.push(`[${proof}, on ${on}]: the visit's switch is ${isOn ? "on" : "off"}`);
        }
      }
      expect(cells).toEqual([]);
      expect(visitLive(p.account.userId, p.visitId).fallbackOn).toBe(false);
    });
  }

  it("the crew's proof without his sign-in, or with someone else's sign-in, does not reach a filming account's visit", async () => {
    const film = await person("filming");
    const other = await person("ordinary (example)");
    const before = snapshot(film);
    for (const proof of ACCEPTED_PROOFS) {
      // nobody signed in: the route has no account to act on
      const anon = await answerOf(await scripted(film, { token: null, proof }, true));
      expect([proof, anon.status, anon.body]).toEqual([proof, 400, { error: "no_session" }]);
      // another person signed in: his own space has no such visit, and he is not filming
      const theirs = await answerOf(await scripted(film, { token: other.token, proof }, true));
      expect([proof, theirs.status, theirs.body]).toEqual([proof, 404, NOT_FOUND]);
    }
    expect(snapshot(film)).toBe(before);
    expect(visitLive(film.account.userId, film.visitId).fallbackOn).toBe(false);
  });
});

// ------------------------------------------------------------------ his own filming mark

describe("/api/crew/filming-account (his own mark): the crew's proof and his own sign-in, both", () => {
  const own = {
    GET: (c: Call) => markGet(request("GET", "/api/crew/filming-account", c)),
    POST: (c: Call) => markPost(request("POST", "/api/crew/filming-account", c)),
    DELETE: (c: Call) => markDelete(request("DELETE", "/api/crew/filming-account", c)),
  };

  for (const whose of WHOSE) {
    it(`${whose} account without an accepted proof: GET, POST and DELETE are 404, and the mark stays as it was`, async () => {
      const p = await person(whose);
      const before = snapshot(p);
      const wrong: string[] = [];
      for (const proof of REFUSED_PROOFS) {
        for (const method of ["GET", "POST", "DELETE"] as const) {
          const r = await answerOf(await own[method]({ token: p.token, proof }));
          if (r.status !== 404 || JSON.stringify(r.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`${method} [${proof}]: ${r.status} ${r.text.slice(0, 80)}`);
          if (snapshot(p) !== before) wrong.push(`${method} [${proof}]: something of the account changed`);
        }
      }
      expect(wrong).toEqual([]);
      const row = await p.scope();
      expect([row.filming, row.clock_offset_ms !== null]).toEqual([whose === "filming", whose === "filming"]);
    });
  }

  it("an accepted proof alone (nobody signed in) is 401 not_signed_in; a signed-in person with no space of their own is 404", async () => {
    const her = await createAccountWithSpace(store, getAuthProvider(), { login: login("fenceher"), password: PASSWORD, space: "none" });
    for (const proof of ACCEPTED_PROOFS) {
      for (const method of ["GET", "POST", "DELETE"] as const) {
        const anon = await answerOf(await own[method]({ token: null, proof }));
        expect([method, proof, anon.status, anon.body]).toEqual([method, proof, 401, { error: "not_signed_in" }]);
        const hers = await answerOf(await own[method]({ token: her.tokens.access_token, proof }));
        expect([method, proof, hers.status, hers.body]).toEqual([method, proof, 404, NOT_FOUND]);
      }
    }
  });

  for (const proof of ACCEPTED_PROOFS) {
    it(`with the accepted ${proof}: he reads, sets and ends his own mark, and nobody else's account moves`, async () => {
      const p = await person("ordinary (example)");
      const bystander = await person("ordinary (example)");
      const marked = await person("filming");
      const others = [snapshot(bystander), snapshot(marked)];
      const c = { token: p.token, proof };
      const first = await answerOf(await own.GET(c));
      expect([first.status, first.body]).toEqual([200, { filming: false, ref: p.ref, date: "2026-10-12", time: "15:00" }]);
      const set = await answerOf(await own.POST(c));
      expect([set.status, set.body]).toEqual([200, { filming: true, ref: p.ref, date: "2026-10-12", time: "15:00" }]);
      expect((await p.scope()).filming).toBe(true);
      // no id and no story day in his phone's answer
      expect(set.text).not.toContain(p.account.userId);
      expect(Object.keys(set.body as object).sort()).toEqual(["date", "filming", "ref", "time"]);
      const ended = await answerOf(await own.DELETE(c));
      expect([ended.status, ended.body]).toEqual([200, { filming: false, ref: p.ref, date: "2026-10-12", time: "15:00" }]);
      const row = await p.scope();
      expect([row.filming, row.clock_offset_ms]).toEqual([false, null]);
      expect([snapshot(bystander), snapshot(marked)]).toEqual(others);
    });
  }
});

// ------------------------------------------------------------------ the director's desk

describe("the director's desk (/api/crew/filming-account/accounts): an accepted proof, and only accounts that are marked", () => {
  const ACTIONS: Record<string, unknown>[] = [
    { action: "seed", scene: "d29-hero" },
    { action: "seed", day: 29, time: "20:15" },
    { action: "forward", minutes: 5 },
    { action: "forward", time: "08:45" },
    { action: "reminder" },
    { action: "no_reply" },
    { action: "fallback", on: true },
    { action: "fallback", on: false },
    { action: "end" },
  ];
  const one = (ref: string, c: Call) => deskGet(request("GET", `/api/crew/filming-account/accounts/${ref}`, c), { params: Promise.resolve({ ref }) });
  const act = (ref: string, c: Call, body: Record<string, unknown>) => deskPost(request("POST", `/api/crew/filming-account/accounts/${ref}`, { ...c, body }), { params: Promise.resolve({ ref }) });
  const list = (c: Call) => deskListGet(request("GET", "/api/crew/filming-account/accounts", c));

  for (const whose of WHOSE) {
    it(`${whose} account as the target, without an accepted proof: the list, the account and every action are 404; nothing moves`, async () => {
      const p = await person(whose);
      const before = snapshot(p);
      const wrong: string[] = [];
      for (const proof of REFUSED_PROOFS) {
        // the calling browser: signed in as nobody, and as the target himself
        for (const token of [null, p.token]) {
          const who = token ? "his own sign-in" : "nobody signed in";
          const cells: [string, Response][] = [
            ["GET list", await list({ token, proof })],
            ["GET account", await one(p.ref, { token, proof })],
          ];
          for (const body of ACTIONS) cells.push([`POST ${JSON.stringify(body)}`, await act(p.ref, { token, proof }, body)]);
          for (const [name, res] of cells) {
            const r = await answerOf(res);
            if (r.status !== 404 || JSON.stringify(r.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`${name} [${proof}, ${who}]: ${r.status} ${r.text.slice(0, 80)}`);
          }
          if (snapshot(p) !== before) wrong.push(`[${proof}, ${who}]: something of the account changed`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  for (const whose of ["ordinary (example)", "ordinary (blank)", "ended"] as Whose[]) {
    it(`${whose} account as the target, WITH an accepted proof: it is not on the list, its code is 404, no action touches it`, async () => {
      const p = await person(whose);
      const marked = await person("filming");
      const before = snapshot(p);
      const wrong: string[] = [];
      for (const proof of ACCEPTED_PROOFS) {
        for (const token of [null, p.token, marked.token]) {
          const c = { token, proof };
          const listed = await answerOf(await list(c));
          expect(listed.status).toBe(200);
          const refs = (listed.body as { accounts: { ref: string }[] }).accounts.map((a) => a.ref);
          if (refs.includes(p.ref)) wrong.push(`[${proof}] the list names an account that is not marked`);
          if (!refs.includes(marked.ref)) wrong.push(`[${proof}] the list misses the marked account`);
          if (listed.text.includes(p.account.userId) || listed.text.includes(marked.account.userId)) wrong.push(`[${proof}] the list carries an account id`);
          const got = await answerOf(await one(p.ref, c));
          if (got.status !== 404 || JSON.stringify(got.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`GET account [${proof}]: ${got.status}`);
          for (const body of ACTIONS) {
            const r = await answerOf(await act(p.ref, c, body));
            if (r.status !== 404 || JSON.stringify(r.body) !== JSON.stringify(NOT_FOUND)) wrong.push(`POST ${JSON.stringify(body)} [${proof}]: ${r.status} ${r.text.slice(0, 80)}`);
          }
          if (snapshot(p) !== before) wrong.push(`[${proof}]: something of the account changed`);
        }
      }
      expect(wrong).toEqual([]);
      // the last fence is the store's own: an account that is not marked cannot be given an offset at all (8.11)
      await expect(store.setClockOffset(p.account.userId, 3600_000)).rejects.toMatchObject({ code: "account_scope" });
      const row = await p.scope();
      expect([row.filming, row.clock_offset_ms]).toEqual([false, null]);
    });
  }

  for (const proof of ACCEPTED_PROOFS) {
    it(`a filming account with the accepted ${proof}: each action gives its designed answer, and after "end" the fence is closed again`, async () => {
      const p = await person("filming");
      const bystander = await person("ordinary (example)");
      const other = snapshot(bystander);
      const c = { token: null, proof };
      const json = async (res: Response) => {
        const r = await answerOf(res);
        return { status: r.status, body: r.body as { account?: Record<string, unknown> | null; done?: Record<string, unknown>; error?: string } };
      };
      const got = await json(await one(p.ref, c));
      expect([got.status, got.body.account?.ref]).toEqual([200, p.ref]);
      const seeded = await json(await act(p.ref, c, { action: "seed", scene: "d29-hero" }));
      expect([seeded.status, seeded.body.account?.date, seeded.body.account?.time]).toEqual([200, "2026-09-22", "20:15"]);
      const again = await json(await act(p.ref, c, { action: "seed", day: 29, time: "20:15" }));
      expect([again.status, again.body.account?.date, again.body.account?.time]).toEqual([200, "2026-09-22", "20:15"]);
      const five = await json(await act(p.ref, c, { action: "forward", minutes: 5 }));
      expect([five.status, five.body.account?.time]).toEqual([200, "20:20"]);
      const morning = await json(await act(p.ref, c, { action: "forward", time: "08:45" }));
      expect([morning.status, morning.body.account?.date, morning.body.account?.time]).toEqual([200, "2026-09-23", "08:45"]);
      const back = await json(await act(p.ref, c, { action: "forward", time: "08:00", date: "2026-09-23" }));
      expect([back.status, back.body.error]).toEqual([409, "forward_only"]);
      const reminder = await json(await act(p.ref, c, { action: "reminder" }));
      expect([reminder.status, reminder.body.done]).toMatchObject([200, { kind: "dose_first", slot: "morning", date: "2026-09-23" }]);
      const noReply = await json(await act(p.ref, c, { action: "no_reply" }));
      expect([noReply.status, noReply.body.done]).toMatchObject([200, { written: 1, movedTo: "09:46" }]);
      // no visit is being recorded on the story's 23 Sep: the switch says so in words, and stays off
      const fallback = await json(await act(p.ref, c, { action: "fallback", on: true }));
      expect([fallback.status, fallback.body.error]).toEqual([409, "no_visit"]);
      const ended = await json(await act(p.ref, c, { action: "end" }));
      expect([ended.status, ended.body.account, ended.body.done?.ended, ended.body.done?.date]).toEqual([200, null, true, "2026-10-12"]);
      // filming off again: every cell is 404 once more, with the same accepted proof
      const row = await p.scope();
      expect([row.filming, row.clock_offset_ms]).toEqual([false, null]);
      const after = snapshot(p);
      expect((await answerOf(await one(p.ref, c))).status).toBe(404);
      for (const body of ACTIONS) expect([(await answerOf(await act(p.ref, c, body))).status, JSON.stringify(body)]).toEqual([404, JSON.stringify(body)]);
      expect(snapshot(p)).toBe(after);
      expect(snapshot(bystander)).toBe(other);
    });
  }
});

// ------------------------------------------------------------------ the example's samples, the crew's trial page

describe("what the crew's proof adds on an account besides the controls", () => {
  it("GET /api/labels/sample on a blank account: 403 example_only, except a filming account asked by the crew", async () => {
    const blank = await person("ordinary (blank)");
    const film = await createAccountWithSpace(store, getAuthProvider(), { login: login("fencefilm"), password: PASSWORD, space: "blank" });
    await markFilming(store, (await store.getSession(film.userId))!);
    const sample = (token: string, proof: Proof) => sampleGet(request("GET", "/api/labels/sample", { token, proof, query: "name=amlodipine" }));
    for (const proof of PROOFS) {
      const plain = await answerOf(await sample(blank.token, proof));
      expect([proof, plain.status, plain.body]).toEqual([proof, 403, { error: "example_only" }]);
      const res = await sample(film.tokens.access_token, proof);
      if (accepted(proof)) expect([proof, res.status, res.headers.get("content-type")]).toEqual([proof, 200, "image/png"]);
      else expect([proof, res.status, (await answerOf(res)).body]).toEqual([proof, 403, { error: "example_only" }]);
    }
  });

  it("GET /api/real: the crew's proof alone decides; an account's sign-in opens nothing, and nothing of the account is in the answer", async () => {
    const p = await person("ordinary (example)");
    for (const proof of PROOFS) {
      const r = await answerOf(await realGet(request("GET", "/api/real", { token: p.token, proof })));
      if (accepted(proof)) {
        expect([proof, r.status]).toEqual([proof, 200]);
        expect(r.text).not.toContain(p.account.userId);
      } else expect([proof, r.status, r.body]).toEqual([proof, 404, NOT_FOUND]);
    }
  });

  it("the store's own fence: the demo's writes are refused on every account, a filming one too", async () => {
    for (const whose of ["ordinary (example)", "filming"] as Whose[]) {
      const p = await person(whose);
      const before = snapshot(p);
      await expect(store.setStoryDay(p.account.userId, 3), whose).rejects.toMatchObject({ code: "account_scope" });
      await expect(store.resetSession(p.account.userId), whose).rejects.toMatchObject({ code: "account_scope" });
      await expect(store.setFilmingMode(p.account.userId, true), whose).rejects.toMatchObject({ code: "account_scope" });
      await expect(store.addMember(p.account.userId, { role: "director" }), whose).rejects.toMatchObject({ code: "account_scope" });
      expect(snapshot(p)).toBe(before);
    }
  });
});

// ------------------------------------------------------------------ nothing is left out

describe("every route that uses the crew's gate or the demo-only resolution is in this matrix", () => {
  /** How a route's source shows that it is a crew control or a demo-only route. */
  const MARKS = /\b(crewGate|isCrew|checkCrew|crewCredential|crewSignIn|crewKeyAccepted|demoAccess|requireDemoSubject|samplesAllowed|filmingSession|findFilming|markFilming|endFilming|filmingEntry)\b/;

  /** The routes the tests above call (a route counts once, whatever its methods: every exported method is called above). */
  const IN_MATRIX = new Set([
    ...DEMO_CONTROLS.map((c) => c.route),
    "app/api/visits/[id]/scripted/route.ts",
    "app/api/crew/filming-account/route.ts",
    "app/api/crew/filming-account/accounts/route.ts",
    "app/api/crew/filming-account/accounts/[ref]/route.ts",
    "app/api/labels/sample/route.ts",
    "app/api/real/route.ts",
  ]);

  /** Routes that carry one of the marks and are not a control over anyone's account, and why. */
  const NOT_A_CONTROL: Record<string, string> = {
    "app/api/asr/health/route.ts": "which speech service is in use; the crew's proof only adds the service's own details, nothing of a person",
    "app/api/session/crew/route.ts": "the crew's sign-in itself: it sets or clears the rp_crew cookie and reads no account",
    "app/api/session/join/route.ts": "the demo's door: a join code names a demo session, never an account; the crew's key is asked for the staff roles",
    "app/api/real/[id]/route.ts": "one run of the crew's real-recording trial, behind the same gate as GET /api/real above; it holds a public dataset's recording, never an account's",
  };

  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) out.push(...routeFiles(p));
      else if (name === "route.ts") out.push(path.relative(process.cwd(), p).split(path.sep).join("/"));
    }
    return out.sort();
  }

  it("a marked route is in the matrix or listed with its reason; the lists name routes that exist and still carry a mark", () => {
    const all = routeFiles(path.join(process.cwd(), "app", "api"));
    expect(all.length).toBeGreaterThan(100);
    const marked = all.filter((r) => MARKS.test(readFileSync(path.join(process.cwd(), r), "utf8")));
    expect(marked.length).toBeGreaterThanOrEqual(15);
    expect(marked.filter((r) => !IN_MATRIX.has(r) && !(r in NOT_A_CONTROL))).toEqual([]);
    for (const r of [...IN_MATRIX, ...Object.keys(NOT_A_CONTROL)]) expect(marked, `${r} is listed here but carries no mark any more`).toContain(r);
    for (const why of Object.values(NOT_A_CONTROL)) expect(why.length).toBeGreaterThan(30);
    // and by path: everything under /api/director, /api/crew and /api/clock is in the matrix
    expect(all.filter((r) => /^app\/api\/(director|crew|clock)\//.test(r) && !IN_MATRIX.has(r))).toEqual([]);
  });
});
