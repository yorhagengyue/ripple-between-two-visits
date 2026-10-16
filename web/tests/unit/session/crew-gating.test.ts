/**
 * M8 judge-link gating, C2 crew gate (lib/crew/gate.ts, real-app 5.2): creating a filming session and switching filming
 * mode (on or off) are the film crew's. To anyone who is not the crew the answer is 404, as if the route did not take that
 * request: no credential, a stale cookie and a typed key that is wrong alike (C2 follow-up: one gate; only the sign-in
 * door, POST /api/session/crew, says "wrong key"). In a production build only SCRIPTED_FALLBACK_KEY counts; while the
 * developer tools are on the dev-only key also counts.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as filmingPOST } from "@/app/api/director/filming/route";
import { DELETE as crewDELETE, GET as crewGET, POST as crewPOST } from "@/app/api/session/crew/route";
import { POST as sessionPOST } from "@/app/api/session/route";
import { getBus } from "@/lib/bus";
import {
  acceptedCrewKeys,
  checkCrew,
  CREW_COOKIE,
  crewCookieAccepted,
  crewCookieValue,
  crewGateSource,
  crewKeyAccepted,
  MAX_WRONG_KEYS,
  resetCrewAttempts,
} from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const BASE = "http://localhost:3200";
const ENV_KEY = "crew-test-key-0042";

function post(path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function sandbox(): Promise<SessionRow> {
  const res = await sessionPOST(post("/api/session"));
  expect(res.status).toBe(201);
  return (await res.json()).session as SessionRow;
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

beforeEach(async () => {
  // C2 track L: these tests tell clients apart by X-Forwarded-For; that is only believed behind a proxy of ours (lib/guard/client-ip.ts)
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  await resetCrewAttempts();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setTestClock(null);
  await resetCrewAttempts();
});

describe("which keys count", () => {
  it("development: the env key and the dev-only key; production: only SCRIPTED_FALLBACK_KEY", () => {
    expect(acceptedCrewKeys({ NODE_ENV: "development" })).toEqual([DEV_ONLY_CREW_KEY]);
    expect(acceptedCrewKeys({ NODE_ENV: "test", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toEqual([ENV_KEY, DEV_ONLY_CREW_KEY]);
    expect(acceptedCrewKeys({ NODE_ENV: "production" })).toEqual([]);
    expect(acceptedCrewKeys({ NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toEqual([ENV_KEY]);
    expect(crewGateSource({ NODE_ENV: "production" })).toBe("none");
    expect(crewGateSource({ NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toBe("env");
    expect(crewGateSource({ NODE_ENV: "development" })).toBe("dev_default");
    expect(crewKeyAccepted(DEV_ONLY_CREW_KEY, { NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toBe(false);
    expect(crewKeyAccepted(` ${ENV_KEY} `, { NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toBe(true);
    expect(crewKeyAccepted("", { NODE_ENV: "development" })).toBe(false);
  });

  it("the cookie holds a sha256 of the key, never the key, and only matches an accepted key", () => {
    const v = crewCookieValue(DEV_ONLY_CREW_KEY);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(v).not.toContain(DEV_ONLY_CREW_KEY);
    expect(crewCookieAccepted(v, { NODE_ENV: "development" })).toBe(true);
    expect(crewCookieAccepted(v, { NODE_ENV: "production" })).toBe(false);
    expect(crewCookieAccepted(crewCookieValue(ENV_KEY), { NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toBe(true);
    expect(crewCookieAccepted("not-hex", { NODE_ENV: "development" })).toBe(false);
  });
});

describe("POST /api/session", () => {
  it("a judge sandbox needs no key; a filming session without the key is 404 and creates nothing", async () => {
    expect((await sessionPOST(post("/api/session", { kind: "sandbox", role: "judge" }))).status).toBe(201);
    const before = (await getMemoryStore().listSessions()).length;
    const bare = await sessionPOST(post("/api/session", { kind: "filming", role: "director" }));
    expect(bare.status).toBe(404);
    expect(await errorOf(bare)).toBe("not_found");
    expect(bare.headers.getSetCookie().join("\n")).not.toContain("rp_session=");
    // a typed wrong key is the same closed door: 404, never "wrong key"
    const wrong = await sessionPOST(post("/api/session", { kind: "filming", crew_key: "letmein" }));
    expect(wrong.status).toBe(404);
    expect(await errorOf(wrong)).toBe("not_found");
    // a sandbox born in filming mode is the same thing by another door
    const sneaky = await sessionPOST(post("/api/session", { kind: "sandbox", filming_mode: true }));
    expect(sneaky.status).toBe(404);
    expect((await getMemoryStore().listSessions()).length).toBe(before);
  });

  it("with the key (body, header or cookie) it is 201, never expires, and leaves the crew cookie (a hash) behind", async () => {
    const res = await sessionPOST(post("/api/session", { kind: "filming", crew_key: DEV_ONLY_CREW_KEY }));
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as { session: SessionRow };
    expect(session.expires_at).toBeNull();
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toContain(`${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`);
    expect(cookies).not.toContain(DEV_ONLY_CREW_KEY);
    expect(cookies.toLowerCase()).toContain("httponly");
    expect(JSON.stringify(session)).not.toContain(DEV_ONLY_CREW_KEY);

    const viaHeader = await sessionPOST(post("/api/session", { kind: "filming" }, { "x-ripple-crew-key": DEV_ONLY_CREW_KEY }));
    expect(viaHeader.status).toBe(201);
    const viaCookie = await sessionPOST(post("/api/session", { kind: "filming" }, { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` }));
    expect(viaCookie.status).toBe(201);
  });

  it("production build: only SCRIPTED_FALLBACK_KEY counts; without it nobody can create a filming session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
    expect((await sessionPOST(post("/api/session", { kind: "filming" }))).status).toBe(404);
    for (const crew_key of [DEV_ONLY_CREW_KEY, ENV_KEY]) {
      const res = await sessionPOST(post("/api/session", { kind: "filming", crew_key }));
      expect(res.status, String(crew_key)).toBe(404);
    }
    // the dev key's cookie is not a credential on a production build: as if there were none
    const devCookie = await sessionPOST(post("/api/session", { kind: "filming" }, { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` }));
    expect(devCookie.status).toBe(404);

    vi.stubEnv("SCRIPTED_FALLBACK_KEY", ENV_KEY);
    expect((await sessionPOST(post("/api/session", { kind: "filming", crew_key: DEV_ONLY_CREW_KEY }))).status).toBe(404);
    expect((await sessionPOST(post("/api/session", { kind: "filming", crew_key: ENV_KEY }))).status).toBe(201);
    // judges keep their sandbox in production
    expect((await sessionPOST(post("/api/session", { kind: "sandbox" }))).status).toBe(201);
  });
});

describe("POST /api/director/filming", () => {
  it("on and off are the crew's (404 without it); a refused switch changes nothing and publishes nothing", async () => {
    const s = await sandbox();
    const bare = await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true }));
    expect(bare.status).toBe(404);
    expect(await errorOf(bare)).toBe("not_found");
    expect((await getMemoryStore().getSession(s.id))!.filming_mode).toBe(false);
    expect(getBus().recent(s.id).map((e) => e.type)).not.toContain("session.filming_mode");
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true, crew_key: "guess" }))).status).toBe(404);

    const keyed = await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true, crew_key: DEV_ONLY_CREW_KEY }));
    expect(keyed.status).toBe(200);
    expect((await keyed.json()).session.filming_mode).toBe(true);
    // switching off was open to anyone until real-app 5.2 closed it
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: false }))).status).toBe(404);
    expect((await getMemoryStore().getSession(s.id))!.filming_mode).toBe(true);
    const off = await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: false, crew_key: DEV_ONLY_CREW_KEY }));
    expect(off.status).toBe(200);
    expect((await off.json()).session.filming_mode).toBe(false);
    const cookie = await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true }, { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` }));
    expect(cookie.status).toBe(200);
  });

  it("production build: the dev key and its cookie are refused; SCRIPTED_FALLBACK_KEY works", async () => {
    const s = await sandbox();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true, crew_key: DEV_ONLY_CREW_KEY }))).status).toBe(404);
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", ENV_KEY);
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true, crew_key: DEV_ONLY_CREW_KEY }))).status).toBe(404);
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true }, { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` }))).status).toBe(404);
    expect((await filmingPOST(post(`/api/director/filming?session=${s.id}`, { on: true, crew_key: ENV_KEY }))).status).toBe(200);
  });
});

describe("wrong keys and the crew browser", () => {
  it(`${MAX_WRONG_KEYS} wrong keys from one client lock its typed keys out: every route still says 404, the door says 429; other clients and the cookie are not affected`, async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < MAX_WRONG_KEYS; i++) {
      const res = await sessionPOST(post("/api/session", { kind: "filming", crew_key: `guess-${i}` }, headers));
      expect(res.status).toBe(404);
    }
    // locked: even the right key, typed, is the same 404 on a route, and the door says why
    expect((await sessionPOST(post("/api/session", { kind: "filming", crew_key: DEV_ONLY_CREW_KEY }, headers))).status).toBe(404);
    const door = await crewPOST(post("/api/session/crew", { key: DEV_ONLY_CREW_KEY }, headers));
    expect(door.status).toBe(429);
    expect(await errorOf(door)).toBe("crew_key_attempts");
    expect(door.headers.getSetCookie().join("\n")).not.toContain(CREW_COOKIE);
    // a browser behind the same address that already carries the cookie keeps working
    expect((await sessionPOST(post("/api/session", { kind: "filming" }, { ...headers, cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` }))).status).toBe(201);
    expect((await sessionPOST(post("/api/session", { kind: "filming", crew_key: DEV_ONLY_CREW_KEY }, { "x-forwarded-for": "198.51.100.7" }))).status).toBe(201);
    // the lockout lifts after ten minutes. The routes count in the process-wide store, on the app's clock: the test
    // moves that clock (nine minutes on: still locked; eleven: the typed key is the crew's again)
    const started = Date.now();
    const req = post("/api/session", {}, headers);
    expect(await checkCrew(req, DEV_ONLY_CREW_KEY)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    setTestClock({ at: started + 9 * 60_000, frozen: true });
    expect(await checkCrew(req, DEV_ONLY_CREW_KEY)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    expect((await crewPOST(post("/api/session/crew", { key: DEV_ONLY_CREW_KEY }, headers))).status).toBe(429);
    setTestClock({ at: started + 11 * 60_000, frozen: true });
    expect(await checkCrew(req, DEV_ONLY_CREW_KEY)).toMatchObject({ ok: true });
    expect((await crewPOST(post("/api/session/crew", { key: DEV_ONLY_CREW_KEY }, headers))).status).toBe(200);
  });

  it("the door counts too: the tenth wrong key there is 429, and the routes then ignore that client's typed keys", async () => {
    const headers = { "x-forwarded-for": "203.0.113.44" };
    for (let i = 1; i < MAX_WRONG_KEYS; i++) {
      const res = await crewPOST(post("/api/session/crew", { key: `guess-${i}` }, headers));
      expect([res.status, await errorOf(res)]).toEqual([403, "crew_key_wrong"]);
    }
    expect((await crewPOST(post("/api/session/crew", { key: "the-tenth" }, headers))).status).toBe(429);
    expect((await sessionPOST(post("/api/session", { kind: "filming" }, { ...headers, "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).status).toBe(404);
  });

  it("/api/session/crew sets the cookie for the right key only, reports it, and clears it", async () => {
    const wrong = await crewPOST(post("/api/session/crew", { key: "nope" }));
    expect(wrong.status).toBe(403);
    expect(wrong.headers.getSetCookie().join("\n")).not.toContain(CREW_COOKIE);
    const ok = await crewPOST(post("/api/session/crew", { key: DEV_ONLY_CREW_KEY }));
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().join("\n")).toContain(`${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`);
    const has = await crewGET(new NextRequest(`${BASE}/api/session/crew`, { headers: { cookie: `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}` } }));
    expect(await has.json()).toEqual({ crew: true });
    const none = await crewGET(new NextRequest(`${BASE}/api/session/crew`));
    expect(await none.json()).toEqual({ crew: false });
    const gone = await crewDELETE();
    expect(gone.headers.getSetCookie().join("\n")).toMatch(new RegExp(`${CREW_COOKIE}=;`));
  });
});
