/**
 * The routes' own family-role checks when the device's member row cannot be read (STORE=supabase with the database
 * down or slow). They fail closed with the proxy gate's own answer, 503 role_unavailable with Retry-After: 2, and
 * never turn "could not tell" into "no role, so his side" (which would let her read or act):
 *   denyFamily      GET /api/notes, GET /api/bp, POST /api/ask, POST /api/clock (and every other route using it)
 *   denyNonPatient  POST /api/family/grants
 *   reminderAuthorFor  POST /api/reminders
 * Before 10-09 B1 fixer round 1 these threw, so the route answered 500 instead of 503.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { GET as bpGet } from "@/app/api/bp/route";
import { POST as clockPost } from "@/app/api/clock/route";
import { POST as grantsPost } from "@/app/api/family/grants/route";
import { GET as notesGet, POST as notesPost } from "@/app/api/notes/route";
import { POST as remindersPost } from "@/app/api/reminders/route";
import { familyGate } from "@/lib/family/gate";
import { memberDirectory } from "@/lib/family/member-cache";
import { reminderAuthorFor } from "@/lib/family/reminders";
import { denyFamily, denyNonPatient, ROLE_UNAVAILABLE, roleUnavailable } from "@/lib/family/role";
import { FAMILY_MEMBER } from "@/lib/family/types";
import { CREW_COOKIE, crewCookieValue } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow, Store } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

afterEach(() => {
  vi.restoreAllMocks();
});

function req(method: "GET" | "POST", p: string, sessionId: string, cookie?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}?session=${encodeURIComponent(sessionId)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function d41(): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}

async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

/** The memory store's member reads fail from now on (the way a database that does not answer looks to the routes). */
function membersDown(): void {
  vi.spyOn(getMemoryStore(), "listMembers").mockRejectedValue(new Error("fetch failed: database unreachable"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

async function expectUnavailable(res: Response | null, what: string): Promise<void> {
  expect(res, what).not.toBeNull();
  expect(res!.status, what).toBe(503);
  expect(res!.headers.get("retry-after"), what).toBe("2");
  const body = (await res!.json()) as { error: string; detail: string };
  expect(body.error, what).toBe(ROLE_UNAVAILABLE);
  expect(body.detail, what).toMatch(/Try again/);
}

describe("denyFamily / denyNonPatient: a member row that cannot be read is 503, never a pass", () => {
  it("answers 503 role_unavailable for every device that presents a member cookie, whatever its rp_role says", async () => {
    const s = await d41();
    const cookies = [await device(s, "family"), await device(s, "patient"), (await device(s, "family")).replace("rp_role=family", "rp_role=patient")];
    membersDown();
    for (const cookie of cookies) {
      await expectUnavailable(await denyFamily(req("GET", "/api/notes", s.id, cookie), s), `denyFamily ${cookie}`);
      await expectUnavailable(await denyNonPatient(req("POST", "/api/family/grants", s.id, cookie), s), `denyNonPatient ${cookie}`);
    }
  });

  it("a device without a member cookie is 503 too: whether she has joined decides what it is, so the rows are read", async () => {
    // since 10-09 (fixer, deny by default) a device with no row in a session she has joined is a stranger, so even a
    // call with no cookies cannot be answered without reading who is in the session; unreadable is 503, never a pass
    const s = await d41();
    membersDown();
    const spy = vi.mocked(getMemoryStore().listMembers);
    for (const cookie of [undefined, `rp_session=${s.id}; rp_role=family`, `rp_session=${s.id}; rp_role=patient`]) {
      await expectUnavailable(await denyFamily(req("GET", "/api/notes", s.id, cookie), s), `denyFamily ${cookie ?? "no cookies"}`);
      await expectUnavailable(await denyNonPatient(req("POST", "/api/family/grants", s.id, cookie), s), `denyNonPatient ${cookie ?? "no cookies"}`);
    }
    expect(spy).toHaveBeenCalled();
  });

  it("with the row readable the answers are unchanged (family 403 patient_only, his phone passes)", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const his = await device(s, "patient");
    expect((await denyFamily(req("GET", "/api/notes", s.id, her), s))?.status).toBe(403);
    expect(await denyFamily(req("GET", "/api/notes", s.id, his), s)).toBeNull();
    expect((await denyNonPatient(req("POST", "/api/family/grants", s.id, her), s))?.status).toBe(403);
    expect(await denyNonPatient(req("POST", "/api/family/grants", s.id, his), s)).toBeNull();
  });

  it("uses the store it is given (the routes pass none and get the app's store)", async () => {
    const s = await d41();
    const listMembers = vi.fn(async () => {
      throw new Error("down");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { listMembers } as unknown as Store;
    await expectUnavailable(await denyFamily(req("GET", "/api/notes", s.id, `rp_session=${s.id}; rp_member=m1`), s, broken), "given store");
    expect(listMembers).toHaveBeenCalledTimes(1);
  });

  it("the proxy gate and the routes give the same 503 body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = await familyGate(
      req("GET", "/api/notes", "s1", "rp_session=s1; rp_member=m1"),
      memberDirectory(async () => {
        throw new Error("down");
      }),
    );
    expect(gate?.status).toBe(503);
    expect(gate?.headers.get("retry-after")).toBe(roleUnavailable().headers.get("retry-after"));
    expect(await gate?.json()).toEqual(await roleUnavailable().json());
  });
});

describe("the routes: 503 role_unavailable (was 500) and nothing read or written", () => {
  it("GET /api/notes, GET /api/bp: 503, none of his words or numbers", async () => {
    const s = await d41();
    const her = await device(s, "family");
    membersDown();
    for (const [what, call] of [
      ["GET /api/notes", () => notesGet(req("GET", "/api/notes", s.id, her))],
      ["GET /api/bp", () => bpGet(req("GET", "/api/bp", s.id, her))],
    ] as const) {
      const res = await call();
      const text = await res.clone().text();
      await expectUnavailable(res, what);
      for (const x of ["今天在大巴窑中心走了一圈", "systolic", "150"]) expect(text, `${what}: ${x}`).not.toContain(x);
    }
  });

  it("POST /api/notes, POST /api/ask, POST /api/clock, POST /api/family/grants: 503 and nothing changes", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const store = getMemoryStore();
    const before = {
      notes: (await store.listNotes(s.id)).length,
      questions: (await store.listQuestions(s.id)).length,
      day: (await store.getSession(s.id))!.story_day,
      grants: (await store.getFamilyGrant(s.id, FAMILY_MEMBER))?.items ?? null,
    };
    membersDown();
    await expectUnavailable(await notesPost(req("POST", "/api/notes", s.id, her, { text: "她替他写的一句。" })), "POST /api/notes");
    await expectUnavailable(await askPost(req("POST", "/api/ask", s.id, her, { text: "我可以多吃一粒降压药吗？", locale: "zh-Hans" })), "POST /api/ask");
    // the story clock is the crew's (lib/crew/gate.ts): with the crew's cookie the route gets as far as who the device is
    await expectUnavailable(await clockPost(req("POST", "/api/clock", s.id, `${her}; ${CREW_COOKIE}=${crewCookieValue(DEV_ONLY_CREW_KEY)}`, { day: 0 })), "POST /api/clock");
    await expectUnavailable(await grantsPost(req("POST", "/api/family/grants", s.id, her, { items: { notes: true } })), "POST /api/family/grants");
    vi.restoreAllMocks();
    expect({
      notes: (await store.listNotes(s.id)).length,
      questions: (await store.listQuestions(s.id)).length,
      day: (await store.getSession(s.id))!.story_day,
      grants: (await store.getFamilyGrant(s.id, FAMILY_MEMBER))?.items ?? null,
    }).toEqual(before);
  });

  it("POST /api/reminders: reminderAuthorFor says 503 (never ok), the route answers 503 with Retry-After, no clip", async () => {
    const s = await d41();
    const her = await device(s, "family");
    const store = getMemoryStore();
    const clips = (await store.listReminderClips(s.id)).length;
    membersDown();
    expect(await reminderAuthorFor(req("POST", "/api/reminders", s.id, her), s)).toEqual({ ok: false, status: 503, code: ROLE_UNAVAILABLE });
    await expectUnavailable(await remindersPost(req("POST", "/api/reminders", s.id, her, { audio_path: `${s.id}/reminders/x.wav` })), "POST /api/reminders");
    vi.restoreAllMocks();
    expect((await store.listReminderClips(s.id)).length).toBe(clips);
  });
});
