/**
 * Who may join a session with its code, and as which role (lib/family/join.ts behind POST /api/session/join; M6
 * privacy, B1 wrap-up 10-10). The route is called directly, with no proxy in front, the way a private window or a
 * fresh phone reaches it (the gate lets a device with no row through to the join):
 *   - family: anyone with the code; the same device joining again gets its own row back (no new row, no event);
 *   - patient: the first patient device only, then 403 patient_exists; his own phone joining again gets its row back;
 *     two phones asking at the same moment: exactly one becomes his;
 *   - director, backstage: only for the film crew (the rp_crew cookie or the key header: lib/crew/gate.ts): 403
 *     crew_key_required for anyone else, a wrong typed key included;
 *   - judge: never with a code (403 role_not_joinable), crew key or not;
 *   - Wei Ling's phone (its row here, its row in its own session, or rp_role=family): family only (403 patient_only);
 *   - nothing is added on any refusal; an unknown code is 404; member rows that cannot be read are 503.
 * And joinRefusal, the rule itself, case by case.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as joinPOST } from "@/app/api/session/join/route";
import { getBus } from "@/lib/bus";
import { joinRefusal, joinWithCode, oneAtATime, PATIENT_EXISTS, ROLE_NOT_JOINABLE } from "@/lib/family/join";
import { crewCookieValue, resetCrewAttempts, type CrewCheck } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { DemoSessionRow, MemberRole, SessionMemberRow, SessionRow, Store } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const BASE = "http://localhost:3200";

function join(code: string, role: string, opts: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`${BASE}/api/session/join`, { method: "POST", headers, body: JSON.stringify({ code, role }) });
}

async function session(): Promise<DemoSessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}

async function device(s: SessionRow, role: MemberRole): Promise<{ cookie: string; member: string }> {
  const m = await getMemoryStore().addMember(s.id, { role });
  return { cookie: `rp_session=${s.id}; rp_member=${m.id}; rp_role=${role}`, member: m.id };
}

const roles = async (s: SessionRow) => (await getMemoryStore().listMembers(s.id)).map((m) => m.role).sort();
const joinedEvents = (s: SessionRow) => getBus().recent(s.id, { limit: 500 }).filter((e) => e.type === "session.member_joined").length;

async function answer(res: Response): Promise<{ status: number; error?: string; member?: SessionMemberRow; next?: string; cookies: string }> {
  const body = (await res.json()) as { error?: string; member?: SessionMemberRow; next?: string };
  return { status: res.status, error: body.error, member: body.member, next: body.next, cookies: res.headers.get("set-cookie") ?? "" };
}

beforeEach(() => resetCrewAttempts());
afterEach(async () => {
  await resetCrewAttempts();
  vi.restoreAllMocks();
});

describe("POST /api/session/join: what the code can make a device", () => {
  it("family: anyone with the code; the same phone again gets its own row back, with no new row and no event", async () => {
    const s = await session();
    await device(s, "patient");
    const first = await answer(await joinPOST(join(s.join_code, "family")));
    expect(first.status).toBe(200);
    expect(first.member?.role).toBe("family");
    expect(first.next).toBe("/f");
    expect(first.cookies).toContain(`rp_member=${first.member!.id}`);
    const events = joinedEvents(s);
    const again = await answer(await joinPOST(join(s.join_code, "family", { cookie: `rp_session=${s.id}; rp_member=${first.member!.id}; rp_role=family` })));
    expect(again.status).toBe(200);
    expect(again.member?.id).toBe(first.member!.id);
    expect(await roles(s)).toEqual(["family", "patient"]);
    expect(joinedEvents(s)).toBe(events);
    // a second, different phone with the code is another family member (two family phones are allowed)
    expect((await joinPOST(join(s.join_code, "family"))).status).toBe(200);
    expect(await roles(s)).toEqual(["family", "family", "patient"]);
  });

  it("patient: the first phone only; then 403 patient_exists and nothing is added; his own phone again gets its row back", async () => {
    const s = await session();
    await device(s, "judge"); // a judge's sandbox: the judge's row is not his phone
    const him = await answer(await joinPOST(join(s.join_code, "patient")));
    expect(him.status).toBe(200);
    expect(him.next).toBe("/p/today");
    // a private window (or any other phone) with the same code
    const second = await answer(await joinPOST(join(s.join_code, "patient")));
    expect(second.status).toBe(403);
    expect(second.error).toBe(PATIENT_EXISTS);
    expect(second.cookies).toBe("");
    // a device with cookies of another session, or a forged rp_role=patient, is no different
    const other = await session();
    const elsewhere = await device(other, "judge");
    expect((await answer(await joinPOST(join(s.join_code, "patient", { cookie: elsewhere.cookie })))).error).toBe(PATIENT_EXISTS);
    expect((await answer(await joinPOST(join(s.join_code, "patient", { cookie: `rp_session=${s.id}; rp_role=patient` })))).error).toBe(PATIENT_EXISTS);
    expect(await roles(s)).toEqual(["judge", "patient"]);
    // his own phone joining again (it holds the patient row): its row back, nothing new
    const mine = await answer(await joinPOST(join(s.join_code, "patient", { cookie: `rp_session=${s.id}; rp_member=${him.member!.id}; rp_role=patient` })));
    expect(mine.status).toBe(200);
    expect(mine.member?.id).toBe(him.member!.id);
    expect(await roles(s)).toEqual(["judge", "patient"]);
  });

  it("patient: two phones asking at the same moment; exactly one becomes his", async () => {
    const s = await session();
    await device(s, "director");
    const both = await Promise.all([joinPOST(join(s.join_code, "patient")), joinPOST(join(s.join_code, "patient")), joinPOST(join(s.join_code, "patient"))]);
    const statuses = both.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 403, 403]);
    expect(await roles(s)).toEqual(["director", "patient"]);
  });

  it("director and backstage: only with the film crew's key (header or the rp_crew cookie)", async () => {
    const s = await session();
    await device(s, "patient");
    for (const role of ["director", "backstage"]) {
      const bare = await answer(await joinPOST(join(s.join_code, role)));
      expect(bare.status, role).toBe(403);
      expect(bare.error, role).toBe("crew_key_required");
      // a typed wrong key is not the crew either: the same refusal (the sign-in door is where a key is answered)
      const wrong = await answer(await joinPOST(join(s.join_code, role, { headers: { "x-ripple-crew-key": "letmein" } })));
      expect(wrong.status, role).toBe(403);
      expect(wrong.error, role).toBe("crew_key_required");
    }
    expect(await roles(s)).toEqual(["patient"]);
    const viaHeader = await answer(await joinPOST(join(s.join_code, "director", { headers: { "x-ripple-crew-key": DEV_ONLY_CREW_KEY } })));
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.next).toBe("/director");
    const viaCookie = await answer(await joinPOST(join(s.join_code, "backstage", { cookie: `rp_crew=${crewCookieValue(DEV_ONLY_CREW_KEY)}` })));
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.next).toBe("/backstage");
    expect(await roles(s)).toEqual(["backstage", "director", "patient"]);
  });

  it("judge: never with a code, crew key or not", async () => {
    const s = await session();
    const keys: Record<string, string>[] = [{}, { "x-ripple-crew-key": DEV_ONLY_CREW_KEY }];
    for (const headers of keys) {
      const res = await answer(await joinPOST(join(s.join_code, "judge", { headers })));
      expect(res.status).toBe(403);
      expect(res.error).toBe(ROLE_NOT_JOINABLE);
    }
    expect(await roles(s)).toEqual([]);
  });

  it("Wei Ling's phone joins as family only: by its row here, by its row in its own session, or by rp_role=family", async () => {
    const s = await session();
    const t = await session();
    const her = await device(s, "family");
    const crew = { "x-ripple-crew-key": DEV_ONLY_CREW_KEY };
    for (const [what, code, cookie] of [
      ["her row in this session", s.join_code, her.cookie],
      ["her row with a forged rp_role=patient", s.join_code, her.cookie.replace("rp_role=family", "rp_role=patient")],
      ["her row in her own session, another session's code", t.join_code, her.cookie],
      ["her member id without rp_role", t.join_code, `rp_session=${s.id}; rp_member=${her.member}`],
      ["rp_role=family alone", t.join_code, "rp_role=family"],
    ] as const) {
      for (const role of ["patient", "director", "backstage", "judge"]) {
        const res = await answer(await joinPOST(join(code, role, { cookie, headers: crew })));
        expect(res.status, `${what}: ${role}`).toBe(403);
        expect(res.error, `${what}: ${role}`).toBe("patient_only");
      }
    }
    expect(await roles(s)).toEqual(["family"]);
    expect(await roles(t)).toEqual([]);
    // as family she may join (another session too: its code was given to her)
    expect((await joinPOST(join(t.join_code, "family", { cookie: her.cookie }))).status).toBe(200);
    expect(await roles(t)).toEqual(["family"]);
  });

  it("an unknown code is 404 before anything else; a body that is not a join is 400", async () => {
    expect((await answer(await joinPOST(join("NOPE99", "patient")))).error).toBe("join_code_not_found");
    expect((await answer(await joinPOST(join("NOPE99", "judge")))).status).toBe(404);
    const bad = new NextRequest(`${BASE}/api/session/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "ABC123", role: "admin" }) });
    expect((await joinPOST(bad)).status).toBe(400);
  });

  it("member rows that cannot be read: 503 role_unavailable, nothing added", async () => {
    const s = await session();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = getMemoryStore();
    const broken = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "listMembers") return async () => Promise.reject(new Error("database unreachable"));
        return Reflect.get(target, prop, receiver);
      },
    }) as Store;
    const out = await joinWithCode(join(s.join_code, "patient"), { code: s.join_code, role: "patient" }, broken);
    expect(out).toMatchObject({ ok: false, status: 503, code: "role_unavailable" });
    expect(await roles(s)).toEqual([]);
    warn.mockRestore();
  });
});

describe("joinRefusal: the rule", () => {
  const row = (role: MemberRole, id = `m-${role}`): SessionMemberRow => ({ id, session_id: "s", role, device_label: null, created_at: "x" });
  const ok = async (): Promise<CrewCheck> => ({ ok: true, via: "header" });
  const none = async (): Promise<CrewCheck> => ({ ok: false, status: 403, error: "crew_key_required" });
  const base = { members: [] as SessionMemberRow[], ownRow: null, deviceIsFamily: false, crew: none };

  it("each role with the code alone", async () => {
    expect(await joinRefusal({ ...base, role: "family" })).toBeNull();
    expect(await joinRefusal({ ...base, role: "patient" })).toBeNull();
    expect(await joinRefusal({ ...base, role: "patient", members: [row("judge"), row("family")] })).toBeNull();
    expect((await joinRefusal({ ...base, role: "patient", members: [row("patient")] }))?.code).toBe(PATIENT_EXISTS);
    expect((await joinRefusal({ ...base, role: "judge" }))?.code).toBe(ROLE_NOT_JOINABLE);
    expect((await joinRefusal({ ...base, role: "director" }))?.code).toBe("crew_key_required");
    expect((await joinRefusal({ ...base, role: "backstage" }))?.code).toBe("crew_key_required");
  });

  it("with the crew key, and for the device that already is the role", async () => {
    expect(await joinRefusal({ ...base, role: "director", crew: ok })).toBeNull();
    expect(await joinRefusal({ ...base, role: "backstage", crew: ok })).toBeNull();
    expect((await joinRefusal({ ...base, role: "judge", crew: ok }))?.code).toBe(ROLE_NOT_JOINABLE);
    expect((await joinRefusal({ ...base, role: "patient", crew: ok, members: [row("patient")] }))?.code).toBe(PATIENT_EXISTS);
    // his own phone: its patient row is the one there
    const his = row("patient", "his");
    expect(await joinRefusal({ ...base, role: "patient", members: [his], ownRow: his })).toBeNull();
    // a judge's own row in its sandbox, joining as judge again: its row back
    const judge = row("judge", "j");
    expect(await joinRefusal({ ...base, role: "judge", members: [judge], ownRow: judge })).toBeNull();
  });

  it("her device: family only, whatever else it holds", async () => {
    for (const role of ["patient", "director", "backstage", "judge"] as const) {
      expect((await joinRefusal({ ...base, role, deviceIsFamily: true, crew: ok }))?.code, role).toBe("patient_only");
    }
    expect(await joinRefusal({ ...base, role: "family", deviceIsFamily: true })).toBeNull();
  });

  it("the crew check runs only for director and backstage (a wrong key is never counted for another role)", async () => {
    const crew = vi.fn(none);
    for (const role of ["family", "patient", "judge"] as const) await joinRefusal({ ...base, role, crew });
    expect(crew).not.toHaveBeenCalled();
    await joinRefusal({ ...base, role: "backstage", crew });
    expect(crew).toHaveBeenCalledTimes(1);
  });
});

describe("oneAtATime", () => {
  it("runs calls for one key in order, other keys alongside, and goes on after a failure", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) => async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      if (fail) throw new Error(name);
      return name;
    };
    const a = oneAtATime("k", slow("a", 20, true));
    const b = oneAtATime("k", slow("b", 1));
    const c = oneAtATime("other", slow("c", 1));
    await expect(a).rejects.toThrow("a");
    expect(await b).toBe("b");
    expect(await c).toBe("c");
    expect(order.indexOf("a:end")).toBeLessThan(order.indexOf("b:start"));
    expect(order.indexOf("c:start")).toBeLessThan(order.indexOf("a:end"));
  });
});
