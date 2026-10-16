/**
 * H2 (docs/plan/real-app.md 5.6, 8.6): the demo's operations are never an account's, and the crew acts on an account only
 * when it is a filming account. Route by route, each tried four ways: an ordinary account and a filming account, each
 * without and with the film crew's cookie (the real rp_crew of an accepted key, not a made-up value).
 *
 *   the demo's own operations   the story clock, the director's cue, filming mode, the replay script, a reset: 404 for an
 *                               account in all four cases. They belong to a judge's sandbox and the crew's filming
 *                               session; an account's clock is moved through the filming-account routes only.
 *   the scripted fallback       404 unless BOTH: the crew's cookie and the filming mark (real-app 5.2).
 *   the filming account itself  the director's routes (/api/crew/filming-account/accounts[/ref]) need the crew's cookie,
 *                               and reach an account only while it is marked: an ordinary account is never listed and
 *                               answers 404 by its code.
 * And nothing changed for the ordinary account afterwards: its day, its clock offset and its records.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as clockPost } from "@/app/api/clock/route";
import { GET as listGet } from "@/app/api/crew/filming-account/accounts/route";
import { GET as oneGet, POST as onePost } from "@/app/api/crew/filming-account/accounts/[ref]/route";
import { POST as cuePost } from "@/app/api/director/cue/route";
import { POST as filmingPost } from "@/app/api/director/filming/route";
import { POST as replayScriptPost } from "@/app/api/director/replay/route";
import { POST as resetPost } from "@/app/api/session/reset/route";
import { POST as scriptedPost } from "@/app/api/visits/[id]/scripted/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { filmingRef, markFilming } from "@/lib/crew/filming-account";
import { CREW_COOKIE, crewCookieValue, DEV_ONLY_CREW_KEY, resetCrewAttempts } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
const CREW = { [CREW_COOKIE]: crewCookieValue(DEV_ONLY_CREW_KEY) };

function req(p: string, opts: { token: string; crew: boolean; body?: unknown; method?: string }): NextRequest {
  const jar: Record<string, string> = { rp_at: opts.token, ...(opts.crew ? CREW : {}) };
  const headers: Record<string, string> = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const makeAccount = (): Promise<TestAccount> =>
  createAccountWithSpace(store, getAuthProvider(), { login: `fence${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });

let ordinary: TestAccount;
let filming: TestAccount;

beforeAll(async () => {
  setTestClock({ at: "2026-10-10T10:00:00+08:00", frozen: true });
  ordinary = await makeAccount();
  filming = await makeAccount();
  await markFilming(store, (await store.getSession(filming.userId))!);
});
beforeEach(() => resetCrewAttempts());

const CASES = [
  { who: "an ordinary account, no crew cookie", account: () => ordinary, crew: false },
  { who: "an ordinary account, the crew's cookie", account: () => ordinary, crew: true },
  { who: "a filming account, no crew cookie", account: () => filming, crew: false },
  { who: "a filming account, the crew's cookie", account: () => filming, crew: true },
] as const;

describe("the demo's own operations answer an account 404, whoever asks", () => {
  for (const c of CASES) {
    it(`${c.who}: the story clock, the cue, filming mode, the replay script and a reset are 404; nothing moves`, async () => {
      const a = c.account();
      const before = (await store.getSession(a.userId))!;
      const o = { token: a.tokens.access_token, crew: c.crew };
      const answers: [string, Response][] = [
        ["POST /api/clock (day)", await clockPost(req("/api/clock", { ...o, body: { day: 3 } }))],
        ["POST /api/clock (scene)", await clockPost(req("/api/clock", { ...o, body: { beat: "d0-visit" } }))],
        ["POST /api/director/cue reminder", await cuePost(req("/api/director/cue", { ...o, body: { cue: "reminder" } }))],
        ["POST /api/director/cue no_reply", await cuePost(req("/api/director/cue", { ...o, body: { cue: "no_reply" } }))],
        ["POST /api/director/filming on", await filmingPost(req("/api/director/filming", { ...o, body: { on: true } }))],
        ["POST /api/director/filming off", await filmingPost(req("/api/director/filming", { ...o, body: { on: false } }))],
        ["POST /api/director/replay start", await replayScriptPost(req("/api/director/replay", { ...o, body: { action: "start" } }))],
        ["POST /api/director/replay stop", await replayScriptPost(req("/api/director/replay", { ...o, body: { action: "stop" } }))],
        ["POST /api/session/reset", await resetPost(req("/api/session/reset", { ...o, body: {} }))],
      ];
      for (const [what, res] of answers) {
        expect([res.status, ((await res.json()) as { error?: string }).error], what).toEqual([404, "not_found"]);
      }
      const after = (await store.getSession(a.userId))!;
      expect([after.story_day, after.clock_offset_ms ?? null, after.filming_mode, after.filming === true]).toEqual([before.story_day, before.clock_offset_ms ?? null, before.filming_mode, before.filming === true]);
    });
  }
});

describe("the scripted fallback: the crew's cookie AND the filming mark, never one without the other", () => {
  for (const c of CASES) {
    const open = c.crew && c.account === CASES[3].account;
    it(`${c.who}: ${open ? "the switch is set" : "404"}`, async () => {
      const a = c.account();
      // his own recording today (the visit the switch belongs to), started on his own phone
      const started = await visitsPost(req("/api/visits", { token: a.tokens.access_token, crew: false, body: { mode: "record", consent: { given: true }, place: "clinic" } }));
      expect(started.status).toBe(200);
      const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
      const res = await scriptedPost(req(`/api/visits/${visitId}/scripted`, { token: a.tokens.access_token, crew: c.crew, body: { on: true } }), { params: Promise.resolve({ id: visitId }) });
      if (open) {
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ fallback: { allowed: true, on: true, unlockable: false } });
      } else {
        expect([res.status, ((await res.json()) as { error?: string }).error]).toEqual([404, "not_found"]);
      }
    });
  }
});

describe("the director's filming-account routes: the crew's cookie, and only an account that is marked", () => {
  it("without the crew's cookie they do not exist, for either account", async () => {
    for (const a of [ordinary, filming]) {
      const o = { token: a.tokens.access_token, crew: false };
      const ref = filmingRef(a.userId);
      const answers = [
        await listGet(req("/api/crew/filming-account/accounts", o)),
        await oneGet(req(`/api/crew/filming-account/accounts/${ref}`, o), { params: Promise.resolve({ ref }) }),
        await onePost(req(`/api/crew/filming-account/accounts/${ref}`, { ...o, body: { action: "seed", scene: "d29-hero" } }), { params: Promise.resolve({ ref }) }),
        await onePost(req(`/api/crew/filming-account/accounts/${ref}`, { ...o, body: { action: "no_reply" } }), { params: Promise.resolve({ ref }) }),
      ];
      for (const res of answers) expect([res.status, ((await res.json()) as { error?: string }).error]).toEqual([404, "not_found"]);
    }
  });

  it("with the crew's cookie: the filming account is listed and can be laid out; the ordinary one is not listed and is 404 by its code", async () => {
    const o = { token: ordinary.tokens.access_token, crew: true };
    const list = (await (await listGet(req("/api/crew/filming-account/accounts", o))).json()) as { accounts: { ref: string }[] };
    expect(list.accounts.map((x) => x.ref)).toContain(filmingRef(filming.userId));
    expect(list.accounts.map((x) => x.ref)).not.toContain(filmingRef(ordinary.userId));

    const plain = filmingRef(ordinary.userId);
    const before = (await store.getSession(ordinary.userId))!;
    for (const body of [{ action: "seed", scene: "d29-hero" }, { action: "forward", minutes: 5 }, { action: "reminder" }, { action: "no_reply" }, { action: "end" }]) {
      const res = await onePost(req(`/api/crew/filming-account/accounts/${plain}`, { ...o, body }), { params: Promise.resolve({ ref: plain }) });
      expect([res.status, ((await res.json()) as { error?: string }).error], JSON.stringify(body)).toEqual([404, "not_found"]);
    }
    const after = (await store.getSession(ordinary.userId))!;
    expect([after.d0, after.story_day, after.clock_offset_ms ?? null, after.tracking_since]).toEqual([before.d0, before.story_day, before.clock_offset_ms ?? null, before.tracking_since]);

    const marked = filmingRef(filming.userId);
    const seeded = await onePost(req(`/api/crew/filming-account/accounts/${marked}`, { ...o, body: { action: "seed", scene: "d29-hero" } }), { params: Promise.resolve({ ref: marked }) });
    expect(seeded.status).toBe(200);
    expect((await store.getSession(filming.userId))!.story_day).toBe(29);
  });
});
