/**
 * The routes about the session itself, called directly (no proxy in front; M6 privacy, B1 wrap-up 10-10):
 *   GET /api/session         the session and its members' roles, never a member row id (that id is the device's
 *                            rp_member credential); a request with no device cookie at all gets the session row only;
 *                            Wei Ling's phone 403 patient_only; a stranger and her phone naming another session 403
 *                            (lib/family/role.ts sessionCaller).
 *   POST /api/session/reset  wipes what was recorded: her phone and a stranger 403, nothing reset; his phone and a
 *                            judge's sandbox reset it.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as sessionGET } from "@/app/api/session/route";
import { POST as resetPOST } from "@/app/api/session/reset/route";
import { CREW_COOKIE, crewCookieValue } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

/** Reset is the film crew's (lib/crew/gate.ts): the crew's cookie added to a device's own cookies. */
const withCrew = (cookie: string | undefined) => [cookie, `${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`].filter(Boolean).join("; ");

const BASE = "http://localhost:3200";

function req(method: string, p: string, cookie?: string): NextRequest {
  return new NextRequest(`${BASE}${p}`, { method, headers: cookie ? { cookie } : {} });
}

async function session(): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}

async function device(s: SessionRow, role: MemberRole): Promise<{ cookie: string; member: string }> {
  const m = await getMemoryStore().addMember(s.id, { role });
  return { cookie: `rp_session=${s.id}; rp_member=${m.id}; rp_role=${role}`, member: m.id };
}

describe("GET /api/session", () => {
  it("a device with a row: the session and its members' roles, never a member id", async () => {
    const s = await session();
    const his = await device(s, "patient");
    const her = await device(s, "family");
    const judge = await device(s, "judge");
    for (const who of [his, judge]) {
      const res = await sessionGET(req("GET", `/api/session?session=${s.id}`, who.cookie));
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text) as { session: SessionRow; members: Record<string, unknown>[] };
      expect(body.session).toMatchObject({ id: s.id, join_code: s.join_code, story_day: 41 });
      expect(body.members.map((m) => m.role).sort()).toEqual(["family", "judge", "patient"]);
      for (const m of body.members) expect(Object.keys(m).sort()).toEqual(["created_at", "device_label", "role"]);
      for (const id of [his.member, her.member, judge.member]) expect(text).not.toContain(id);
    }
  });

  it("in a session nobody joined as family: a cookie-only device gets the roles (no ids); a request with no cookie at all the session row only", async () => {
    const s = await session();
    const his = await device(s, "patient");
    for (const cookie of [`rp_session=${s.id}`, `rp_session=${s.id}; rp_role=patient`]) {
      const res = await sessionGET(req("GET", `/api/session?session=${s.id}`, cookie));
      expect(res.status, cookie).toBe(200);
      const text = await res.text();
      expect((JSON.parse(text) as { members: { role: string }[] }).members.map((m) => m.role), cookie).toEqual(["patient"]);
      expect(text, cookie).not.toContain(his.member);
    }
    const bare = await sessionGET(req("GET", `/api/session?session=${s.id}`));
    expect(bare.status).toBe(200);
    const text = await bare.text();
    expect(Object.keys(JSON.parse(text))).toEqual(["session"]);
    expect(text).not.toContain(his.member);
  });

  it("Wei Ling's phone 403 patient_only; once she has joined a device with no row 403 member_required; her phone elsewhere 403", async () => {
    const s = await session();
    const t = await session();
    const her = await device(s, "family");
    const mine = await sessionGET(req("GET", `/api/session?session=${s.id}`, her.cookie));
    expect(mine.status).toBe(403);
    expect(await mine.json()).toMatchObject({ error: "patient_only" });
    for (const cookie of [undefined, `rp_session=${s.id}`, `rp_session=${s.id}; rp_role=patient`]) {
      const res = await sessionGET(req("GET", `/api/session?session=${s.id}`, cookie));
      expect(res.status, String(cookie)).toBe(403);
      expect(await res.json(), String(cookie)).toMatchObject({ error: "member_required" });
    }
    const elsewhere = await sessionGET(req("GET", `/api/session?session=${t.id}`, her.cookie));
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.json()).toMatchObject({ error: "patient_only" });
  });

  it("an unknown session is 404, no session 400 (as before)", async () => {
    expect((await sessionGET(req("GET", "/api/session?session=nope"))).status).toBe(404);
    expect((await sessionGET(req("GET", "/api/session"))).status).toBe(400);
  });
});

describe("POST /api/session/reset", () => {
  it("without the crew: 404 for anyone; with it, her phone and a stranger 403, nothing reset; his phone and a judge's sandbox reset it", async () => {
    const store = getMemoryStore();
    const s = await session();
    const her = await device(s, "family");
    await store.setStoryDay(s.id, 30, "09:00");
    for (const cookie of [her.cookie, (await device(s, "patient")).cookie, undefined]) {
      const res = await resetPOST(req("POST", `/api/session/reset?session=${s.id}`, cookie));
      expect(res.status, String(cookie)).toBe(404);
      expect((await store.getSession(s.id))?.story_day).toBe(30);
    }
    for (const [cookie, code] of [
      [her.cookie, "patient_only"],
      [her.cookie.replace("rp_role=family", "rp_role=director"), "patient_only"],
      [`rp_session=${s.id}; rp_role=director`, "member_required"],
      ["", "member_required"],
    ] as const) {
      const res = await resetPOST(req("POST", `/api/session/reset?session=${s.id}`, withCrew(cookie || undefined)));
      expect(res.status, cookie).toBe(403);
      expect(await res.json(), cookie).toMatchObject({ error: code });
      expect((await store.getSession(s.id))?.story_day, cookie).toBe(30);
    }
    for (const role of ["patient", "judge"] as const) {
      await store.setStoryDay(s.id, 30, "09:00");
      const res = await resetPOST(req("POST", `/api/session/reset?session=${s.id}`, withCrew((await device(s, role)).cookie)));
      expect(res.status, role).toBe(200);
      expect((await store.getSession(s.id))?.story_day, role).not.toBe(30);
    }
  });
});
