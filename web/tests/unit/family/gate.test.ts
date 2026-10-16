/**
 * The family role's deny-by-default gate (lib/family/gate.ts, run by web/proxy.ts before every page and API):
 *   - the policy: exactly /f's and /join's needs are open to her; every other API method is 403, every other page a
 *     307 to /f; the upload link only for her reminder;
 *   - the folders: every route file under app/api and every page under app/ is classified by the policy, the
 *     allow-list names only routes and methods that exist, and every API route really answers her 403 through the
 *     proxy (a route added later is closed to her without anyone listing it);
 *   - who is calling: lib/family/identity.ts, the same answer at the gate, in the routes and on pages (her member row
 *     wins over a forged rp_role; once she has joined, a device with no row in the session is a stranger; her phone
 *     naming another session is family_elsewhere; rp_role alone counts only in a session nobody joined as family; a
 *     request with no device cookie at all is anonymous), no store read for a request that names no session, rows
 *     that cannot be read are 503 (never "pass"), the proxy reads the routes' own memory store and never builds one;
 *   - strangers and her phone elsewhere get nothing through the proxy, allow-list included; a request with no device at
 *     all gets only ANONYMOUS_API (joining, its own sandbox, the session row without members, the dataset page, the
 *     health checks) in a session nobody joined as family;
 *   - the proxy file: its matcher leaves out exactly the paths the gate says it does not look at.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_API,
  anonymousAllowed,
  FAMILY_API,
  FAMILY_PAGES,
  familyAccess,
  familyGate,
  gateIdentity,
  MEMORY_STORE_GLOBAL,
  OUTSIDE_GATE,
  outsideGate,
  proxyDirectory,
} from "@/lib/family/gate";
import type { Identity } from "@/lib/family/identity";
import { cachedLookup, memberDirectory, membersFrom, type MemberLookup } from "@/lib/family/member-cache";
import { pageIdentity, pageRole, requesterIdentity, requesterRole } from "@/lib/family/role";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionMemberRow, SessionRow } from "@/lib/store/types";
import { config as proxyConfig, proxy } from "@/proxy";

const WEB = path.join(__dirname, "..", "..", "..");
const APP = path.join(WEB, "app");

function find(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...find(p, name));
    else if (e.name === name) out.push(p);
  }
  return out;
}
function routeOf(file: string): string {
  const segs = path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segs.join("/")}`;
}
function apiRoutes(): { method: string; route: string }[] {
  const out: { method: string; route: string }[] = [];
  for (const file of find(path.join(APP, "api"), "route.ts")) {
    const src = readFileSync(file, "utf8");
    const methods = new Set<string>();
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)) methods.add(m[1] ?? m[2]);
    for (const method of methods) out.push({ method, route: routeOf(file) });
  }
  return out;
}
/** a concrete path for a route as written under app/ */
const concrete = (route: string) => route.replace(/\[[^\]/]+\]/g, "x1");

function req(method: string, p: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method, headers, body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) });
}

async function session(): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}
async function device(s: SessionRow, role: MemberRole): Promise<{ cookie: string; member: string }> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return { cookie: `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`, member: member.id };
}
const memoryDir = proxyDirectory({ STORE: "memory" });

/** For each allow-list entry with a body rule: a body her phone may send (the rule must accept it). */
const HER_BODY: Record<string, unknown> = {
  "/api/upload-url": { kind: "reminder", content_type: "audio/wav" },
  "/api/session/join": { code: "ABC123", role: "family" },
};
const herBody = (r: { route: string; body?: unknown }) => (r.body ? HER_BODY[r.route] : undefined);

// ------------------------------------------------------------------ the policy

describe("familyAccess: what the family role may use", () => {
  it("every body rule on the allow-list has an example body here (a new rule must say what it accepts)", () => {
    for (const r of FAMILY_API.filter((x) => x.body)) {
      expect(HER_BODY[r.route], r.route).toBeDefined();
      expect(r.body!(HER_BODY[r.route]), r.route).toBe(true);
    }
  });

  it("each allow-list entry is open for its method only", () => {
    for (const r of FAMILY_API) {
      const p = concrete(r.route);
      const got = familyAccess(r.method, p, herBody(r));
      expect(got.kind, `${r.method} ${r.route}`).toBe("allow");
      for (const other of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].filter((m) => m !== r.method)) {
        if (FAMILY_API.some((x) => x.method === other && x.route === r.route)) continue;
        expect(familyAccess(other, p).kind, `${other} ${r.route}`).toBe("deny");
      }
    }
  });

  it("the upload link is hers only for a reminder; the body decides, and an unreadable body is refused", () => {
    expect(familyAccess("POST", "/api/upload-url").kind).toBe("needs_body");
    expect(familyAccess("POST", "/api/upload-url", { kind: "reminder", content_type: "audio/wav" }).kind).toBe("allow");
    for (const body of [{ kind: "label" }, { kind: "recording" }, { kind: "segment" }, { kind: "Reminder" }, {}, null, "reminder", [{ kind: "reminder" }]]) {
      expect(familyAccess("POST", "/api/upload-url", body).kind, JSON.stringify(body)).toBe("deny");
    }
  });

  it("joining: her phone may join only as family (the code she already has cannot make her his, or staff)", () => {
    expect(familyAccess("POST", "/api/session/join").kind).toBe("needs_body");
    expect(familyAccess("POST", "/api/session/join", { code: "ABC123", role: "family" }).kind).toBe("allow");
    expect(familyAccess("POST", "/api/session/join", { code: "ABC123", role: "family", device_label: "Wei Ling" }).kind).toBe("allow");
    for (const body of [
      { code: "ABC123", role: "patient" },
      { code: "ABC123", role: "director" },
      { code: "ABC123", role: "backstage" },
      { code: "ABC123", role: "judge" },
      { code: "ABC123", role: "Family" },
      { code: "ABC123", role: ["family"] },
      { code: "ABC123" },
      {},
      null,
      "family",
      [{ code: "ABC123", role: "family" }],
    ]) {
      expect(familyAccess("POST", "/api/session/join", body).kind, JSON.stringify(body)).toBe("deny");
    }
    expect(familyAccess("GET", "/api/session/join").kind).toBe("deny");
  });

  it("anything else under /api is denied, including routes that do not exist yet and look-alike paths", () => {
    for (const [m, p] of [
      ["GET", "/api/notes"],
      ["GET", "/api/bp"],
      ["GET", "/api/session"],
      ["POST", "/api/session"],
      ["POST", "/api/session/reset"],
      ["GET", "/api/family/grants"],
      ["POST", "/api/family/grants"],
      ["GET", "/api/family/view/extra"],
      ["GET", "/api/family/viewx"],
      ["GET", "/api/reminders/x1/audio/more"],
      ["GET", "/api/notes-export"],
      ["GET", "/api"],
      ["DELETE", "/api/reminders"],
    ] as const) {
      expect(familyAccess(m, p).kind, `${m} ${p}`).toBe("deny");
    }
    // a trailing slash is the same route
    expect(familyAccess("GET", "/api/family/view/").kind).toBe("allow");
  });

  it("pages: /f and /join open; every other page (and anything unknown) goes to /f", () => {
    for (const p of ["/f", "/f/", "/join"]) expect(familyAccess("GET", p).kind, p).toBe("allow");
    for (const p of ["/", "/p", "/p/today", "/p/bp", "/p/visit/v1/review", "/backstage", "/backstage/crew", "/director", "/try", "/eval", "/how", "/design", "/f/x", "/join/x", "/fx", "/robots.txt"]) {
      expect(familyAccess("GET", p), p).toEqual({ kind: "redirect", to: "/f" });
    }
  });
});

describe("the folders: every route and page is under the policy", () => {
  const routes = apiRoutes();

  it("finds the app's routes (sanity: the scan reads the real folders)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(50);
    expect(routes).toContainEqual({ method: "GET", route: "/api/notes" });
    expect(routes).toContainEqual({ method: "PATCH", route: "/api/meds/[id]" });
  });

  it("the allow-list and OUTSIDE_GATE name only routes and methods that exist", () => {
    for (const r of FAMILY_API) expect(routes, `${r.method} ${r.route}`).toContainEqual({ method: r.method, route: r.route });
    for (const o of OUTSIDE_GATE.filter((x) => x.prefix.startsWith("/api/"))) expect(routes.some((r) => r.route === o.prefix), o.prefix).toBe(true);
    const pages = find(APP, "page.tsx").map(routeOf);
    for (const p of FAMILY_PAGES) expect(pages, p.route).toContain(p.route);
  });

  it("every API method on every route: open to her exactly when it is on the allow-list", () => {
    const open: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.route}`;
      if (outsideGate(r.route)) continue;
      const listed = FAMILY_API.find((x) => x.method === r.method && x.route === r.route);
      const got = familyAccess(r.method, concrete(r.route), listed ? herBody(listed) : undefined);
      expect(got.kind, key).toBe(listed ? "allow" : "deny");
      if (listed) open.push(key);
    }
    expect(open.sort()).toEqual(FAMILY_API.map((r) => `${r.method} ${r.route}`).sort());
  });

  it("every page under app/: only /f and /join are hers", () => {
    for (const p of find(APP, "page.tsx").map(routeOf)) {
      const got = familyAccess("GET", concrete(p));
      expect(got.kind, p).toBe(FAMILY_PAGES.some((x) => x.route === p) ? "allow" : "redirect");
    }
  });

  it("through the proxy itself, her phone gets 403 patient_only from every closed API route and 307 /f from every closed page", async () => {
    const s = await session();
    const her = await device(s, "family");
    for (const r of routes) {
      if (outsideGate(r.route) || FAMILY_API.some((x) => x.method === r.method && x.route === r.route)) continue;
      const res = await proxy(req(r.method, `${concrete(r.route)}?session=${s.id}`, { cookie: her.cookie, body: r.method === "GET" || r.method === "DELETE" ? undefined : {} }));
      expect(res.status, `${r.method} ${r.route}`).toBe(403);
      expect((await res.json()).error, `${r.method} ${r.route}`).toBe("patient_only");
    }
    for (const p of find(APP, "page.tsx").map(routeOf)) {
      if (FAMILY_PAGES.some((x) => x.route === p)) continue;
      const res = await proxy(req("GET", concrete(p), { cookie: her.cookie }));
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location"), p).toBe("http://localhost/f");
    }
  });
});

// ------------------------------------------------------------------ who is calling

type Want = Identity["kind"] | `member:${MemberRole}` | `cookie:${MemberRole}`;
const label = (id: Identity): Want => (id.kind === "member" || id.kind === "cookie" ? `${id.kind}:${id.role}` : id.kind);

describe("who is calling: lib/family/identity.ts, the same answer at the gate, in the routes and on pages", () => {
  it("in a session she has joined: a row decides; with no row in it a device is a stranger, whatever it claims", async () => {
    const s = await session();
    const other = await session();
    const her = await device(s, "family");
    const his = await device(s, "patient");
    const cases: [string, string, Want][] = [
      ["her device", her.cookie, "member:family"],
      ["her member row with rp_role=patient", her.cookie.replace("rp_role=family", "rp_role=patient"), "member:family"],
      ["his member row with rp_role=family", his.cookie.replace("rp_role=patient", "rp_role=family"), "member:patient"],
      // her phone with its cookies dropped (a private window, fetch with credentials "omit"): nobody, not his side
      ["no cookies", "", "stranger"],
      ["his session id and rp_role=patient, no row (forged)", `rp_session=${s.id}; rp_role=patient`, "stranger"],
      ["his session id only", `rp_session=${s.id}`, "stranger"],
      ["rp_role=family without a row", `rp_session=${s.id}; rp_role=family`, "stranger"],
      ["an unknown member id", `rp_session=${s.id}; rp_member=nope`, "stranger"],
      ["a judge row of another session", `rp_session=${other.id}; rp_member=${(await device(other, "judge")).member}; rp_role=judge`, "stranger"],
      // a family device naming a session that is not its own
      ["rp_role=family, no session cookie", "rp_role=family", "family_elsewhere"],
      ["rp_role=family for another session", `rp_session=${other.id}; rp_role=family`, "family_elsewhere"],
    ];
    for (const [what, cookie, want] of cases) {
      const api = req("GET", `/api/notes?session=${s.id}`, { cookie });
      expect(label(await gateIdentity(api, memoryDir)), `api: ${what}`).toBe(want);
      expect(label(await requesterIdentity(api, s)), `route parity: ${what}`).toBe(want);
    }
    // pages read the cookie's session only (a ?session= on a page is ignored, as lib/session/server.ts does)
    expect(label(await gateIdentity(req("GET", `/p/bp?session=${other.id}`, { cookie: her.cookie }), memoryDir))).toBe("member:family");
    expect(label(await pageIdentity({ session: s, memberId: her.member, role: "family" }))).toBe("member:family");
    expect(label(await pageIdentity({ session: s, memberId: null, role: "patient" }))).toBe("stranger");
    expect(await pageRole({ session: s, memberId: null, role: "patient" })).toBe("family"); // a stranger acts as the least
    expect(await pageRole({ session: s, memberId: his.member, role: "family" })).toBe("patient");
    expect(label(await gateIdentity(req("GET", "/p/bp", { cookie: `rp_member=${her.member}` }), memoryDir))).toBe("none"); // no page session
  });

  it("in a session nobody joined as family (the e2e harness, scripts): rp_role counts in its own session, a device cookie alone is none, no cookie at all is anonymous", async () => {
    const s = await session();
    const other = await session();
    const his = await device(s, "patient");
    const cases: [string, string, Want][] = [
      ["his row", his.cookie, "member:patient"],
      ["rp_role=family alone", `rp_session=${s.id}; rp_role=family`, "cookie:family"],
      ["rp_role=patient alone", `rp_session=${s.id}; rp_role=patient`, "cookie:patient"],
      ["rp_role=patient for another session", `rp_session=${other.id}; rp_role=patient`, "none"],
      ["rp_role=family for another session", `rp_session=${other.id}; rp_role=family`, "family_elsewhere"],
      ["his session id only (the e2e harness's openDevice)", `rp_session=${s.id}`, "none"],
      // a private window, fetch with credentials "omit", curl with only ?session=: no device at all
      ["no cookies", "", "anonymous"],
      ["only the language cookie", "rp_lang=en", "anonymous"],
      ["empty device cookies", "rp_session=; rp_member=; rp_role=", "anonymous"],
    ];
    for (const [what, cookie, want] of cases) {
      const api = req("GET", `/api/notes?session=${s.id}`, { cookie });
      expect(label(await gateIdentity(api, memoryDir)), `api: ${what}`).toBe(want);
      expect(label(await requesterIdentity(api, s)), `route parity: ${what}`).toBe(want);
    }
    // the moment she joins, the same cookies are strangers
    await device(s, "family");
    for (const cookie of [`rp_session=${s.id}; rp_role=family`, `rp_session=${s.id}; rp_role=patient`, ""]) {
      expect(label(await requesterIdentity(req("GET", `/api/notes?session=${s.id}`, { cookie }), s)), cookie).toBe("stranger");
    }
  });

  it("her phone naming another session (made up, or someone else's real one) is family_elsewhere, never 'no role'", async () => {
    const s = await session();
    const other = await session();
    const her = await device(s, "family");
    const his = await device(s, "patient");
    const forged = her.cookie.replace("rp_role=family", "rp_role=patient");
    for (const target of [other.id, "nope-session"]) {
      for (const [what, cookie] of [
        ["her device", her.cookie],
        ["her member row with rp_role=patient", forged],
        ["her member row, no rp_role", `rp_session=${s.id}; rp_member=${her.member}`],
      ] as const) {
        expect(label(await gateIdentity(req("POST", `/api/session/join?session=${target}`, { cookie }), memoryDir)), `${what} -> ${target}`).toBe("family_elsewhere");
      }
      // his patient row does not travel to another session; there it is nobody's
      expect(label(await gateIdentity(req("GET", `/api/notes?session=${target}`, { cookie: his.cookie }), memoryDir)), `his -> ${target}`).toBe("none");
    }
    // the routes say the same for a real other session (routes only ask about sessions that exist)
    for (const cookie of [her.cookie, forged, his.cookie, `rp_session=${s.id}; rp_role=family`, `rp_session=${s.id}; rp_role=judge`]) {
      const r = req("GET", `/api/notes?session=${other.id}`, { cookie });
      expect(label(await requesterIdentity(r, other)), cookie).toBe(label(await gateIdentity(r, memoryDir)));
    }
    // a device whose own session is gone: no row there, no error
    const gone = `rp_session=gone-session; rp_member=${her.member}; rp_role=patient`;
    expect(label(await requesterIdentity(req("GET", `/api/notes?session=${other.id}`, { cookie: gone }), other))).toBe("none");
    // her own session's rows that cannot be read are 503 at the gate, never a pass
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const half = memberDirectory(async (sid) => {
      if (sid === s.id) throw new Error("database unreachable");
      return [];
    });
    const res = await familyGate(req("POST", `/api/session/join?session=${other.id}`, { cookie: forged, body: { code: s.join_code, role: "patient" } }), half);
    expect(res?.status).toBe(503);
    warn.mockRestore();
  });

  it("does not read the store for a request that names no session and does not say it is family", async () => {
    const list = vi.fn(async () => [] as SessionMemberRow[]);
    const dir = memberDirectory(list);
    for (const [p, cookie] of [
      ["/api/health", ""],
      ["/api/health", "rp_role=judge"],
      ["/api/session", "rp_member=m1"],
      ["/", ""],
      ["/how", "rp_role=patient"],
    ] as const) {
      expect(await familyGate(req("GET", p, { cookie }), dir), `${p} ${cookie}`).toBeNull();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("member rows that cannot be read are 503 role_unavailable, never a pass (also for a device with no cookies)", async () => {
    const broken = memberDirectory(async () => {
      throw new Error("database unreachable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const cookie of ["rp_session=s1; rp_member=m1; rp_role=patient", ""]) {
      const api = await familyGate(req("GET", "/api/notes?session=s1", { cookie }), broken);
      expect(api?.status, cookie).toBe(503);
      expect(await api?.json()).toMatchObject({ error: "role_unavailable" });
      expect(api?.headers.get("retry-after")).toBe("2");
    }
    const page = await familyGate(req("GET", "/p/today", { cookie: "rp_session=s1; rp_member=m1" }), broken);
    expect(page?.status).toBe(503);
    expect(await page?.text()).not.toContain("<");
    warn.mockRestore();
  });

  it("membersFrom: no such session has no rows; any other store error throws", async () => {
    const gone = membersFrom(() => ({ listMembers: async () => Promise.reject(Object.assign(new Error("No session"), { code: "session_not_found" })) }));
    expect(await gone("s")).toEqual([]);
    const down = membersFrom(() => ({ listMembers: async () => Promise.reject(Object.assign(new Error("fetch failed"), { code: "network" })) }));
    await expect(down("s")).rejects.toThrow("fetch failed");
    expect(await membersFrom(() => null)("s")).toEqual([]);
  });

  it("memberDirectory remembers found rows and 'family is here' for the TTL; misses and 'no family yet' are asked again", async () => {
    let t = 1000;
    let rows: SessionMemberRow[] = [{ id: "him", session_id: "s", role: "patient", device_label: null, created_at: "x" }];
    const list = vi.fn(async () => rows);
    const dir = memberDirectory(list, 60_000, () => t);
    expect(await dir.role("s", "him")).toBe("patient");
    expect(await dir.role("s", "him")).toBe("patient");
    expect(list).toHaveBeenCalledTimes(1);
    expect(await dir.hasFamily("s")).toBe(false);
    expect(await dir.hasFamily("s")).toBe(false);
    expect(list).toHaveBeenCalledTimes(3); // "no family yet" is never remembered: her join is seen at once
    rows = [...rows, { id: "her", session_id: "s", role: "family", device_label: null, created_at: "y" }];
    expect(await dir.hasFamily("s")).toBe(true);
    expect(await dir.hasFamily("s")).toBe(true);
    expect(await dir.role("s", "nobody")).toBeNull();
    expect(list).toHaveBeenCalledTimes(5);
    t += 60_001;
    expect(await dir.role("s", "him")).toBe("patient");
    expect(list).toHaveBeenCalledTimes(6);
    // a role read also learns that family is here (no second read)
    const list2 = vi.fn(async () => rows);
    const dir2 = memberDirectory(list2, 60_000, () => t);
    expect(await dir2.role("s", "him")).toBe("patient");
    expect(await dir2.hasFamily("s")).toBe(true);
    expect(list2).toHaveBeenCalledTimes(1);
    // without a TTL nothing is remembered
    const list3 = vi.fn(async () => rows);
    const dir3 = memberDirectory(list3);
    await dir3.role("s", "him");
    await dir3.role("s", "him");
    expect(list3).toHaveBeenCalledTimes(2);
  });

  it("cachedLookup remembers found roles for the TTL, asks again for misses and after expiry", async () => {
    let t = 1000;
    const inner = vi.fn<MemberLookup>(async (_s, m) => (m === "her" ? "family" : null));
    const lookup = cachedLookup(inner, 60_000, () => t);
    expect(await lookup("s", "her")).toBe("family");
    expect(await lookup("s", "her")).toBe("family");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await lookup("s", "nobody")).toBeNull();
    expect(await lookup("s", "nobody")).toBeNull();
    expect(inner).toHaveBeenCalledTimes(3);
    t += 60_001;
    expect(await lookup("s", "her")).toBe("family");
    expect(inner).toHaveBeenCalledTimes(4);
  });

  it("requesterRole / pageRole under STORE=supabase read the rows once a minute; STORE=memory reads every time", async () => {
    const listMembers = vi.fn(async (sid: string) => [{ id: "her", session_id: sid, role: "family" as MemberRole, device_label: null, created_at: "x" }]);
    const fake = { listMembers } as unknown as Parameters<typeof requesterRole>[2];
    const r = () => req("GET", "/api/notes?session=s-cache", { cookie: "rp_session=s-cache; rp_member=her; rp_role=patient" });
    vi.stubEnv("STORE", "memory");
    expect(await requesterRole(r(), { id: "s-cache" }, fake)).toBe("family");
    expect(await requesterRole(r(), { id: "s-cache" }, fake)).toBe("family");
    expect(listMembers).toHaveBeenCalledTimes(2);
    vi.stubEnv("STORE", "supabase");
    try {
      expect(await requesterRole(r(), { id: "s-cache" }, fake)).toBe("family");
      expect(await pageRole({ session: { id: "s-cache" }, memberId: "her", role: "patient" }, fake)).toBe("family");
      expect(await requesterRole(r(), { id: "s-cache" }, fake)).toBe("family");
      expect(listMembers).toHaveBeenCalledTimes(3); // one read for the three answers
      // an id that is not there is asked again (a device that just joined is never missed); with her in the session
      // (remembered) it is a stranger, which acts as the least a device can be
      const fresh = () => req("GET", "/api/notes?session=s-cache", { cookie: "rp_session=s-cache; rp_member=new" });
      expect(label(await requesterIdentity(fresh(), { id: "s-cache" }, fake))).toBe("stranger");
      expect(await requesterRole(fresh(), { id: "s-cache" }, fake)).toBe("family");
      expect(listMembers).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("in memory mode the proxy reads the routes' own store on globalThis and never builds one", async () => {
    const g = globalThis as Record<string, unknown>;
    const store = getMemoryStore();
    expect(g[MEMORY_STORE_GLOBAL]).toBe(store);
    const s = await session();
    const her = await device(s, "family");
    expect(await memoryDir.role(s.id, her.member)).toBe("family");
    expect(await memoryDir.hasFamily(s.id)).toBe(true);
    const saved = g[MEMORY_STORE_GLOBAL];
    try {
      delete g[MEMORY_STORE_GLOBAL];
      expect(await proxyDirectory({ STORE: "memory" }).role(s.id, her.member)).toBeNull();
      expect(await proxyDirectory({ STORE: "memory" }).hasFamily(s.id)).toBe(false);
      expect(g[MEMORY_STORE_GLOBAL]).toBeUndefined(); // the lookup did not create a store
    } finally {
      g[MEMORY_STORE_GLOBAL] = saved;
    }
  });
});

// ------------------------------------------------------------------ the gate and the proxy file

describe("familyGate and web/proxy.ts", () => {
  it("her phone: closed API 403 patient_only, closed page 307 /f, allowed paths pass; his phone passes everywhere", async () => {
    const s = await session();
    const her = await device(s, "family");
    const his = await device(s, "patient");
    const q = `?session=${s.id}`;
    expect((await familyGate(req("GET", `/api/notes${q}`, { cookie: her.cookie }), memoryDir))?.status).toBe(403);
    const page = await familyGate(req("GET", "/p/today", { cookie: her.cookie }), memoryDir);
    expect(page?.status).toBe(307);
    expect(page?.headers.get("location")).toBe("http://localhost/f");
    // a client-side navigation (RSC request) is redirected the same way
    expect((await familyGate(req("GET", "/p/bp?_rsc=1", { cookie: her.cookie, headers: { RSC: "1" } }), memoryDir))?.status).toBe(307);
    for (const p of ["/f", "/join", `/api/family/view${q}`, `/api/events${q}`, `/api/reminders${q}`, "/api/health"]) {
      expect(await familyGate(req("GET", p, { cookie: her.cookie }), memoryDir), p).toBeNull();
    }
    for (const p of ["/p/today", "/backstage", "/", `/api/notes${q}`, `/api/visits/v1${q}`]) {
      expect(await familyGate(req("GET", p, { cookie: his.cookie }), memoryDir), p).toBeNull();
    }
    expect(await familyGate(req("POST", `/api/session/reset${q}`, { cookie: his.cookie, body: {} }), memoryDir)).toBeNull();
  });

  it("reads a copy of the upload-link body: her reminder passes and the handler still gets the body; a label is 403", async () => {
    const s = await session();
    const her = await device(s, "family");
    const ok = req("POST", `/api/upload-url?session=${s.id}`, { cookie: her.cookie, body: { kind: "reminder", content_type: "audio/wav" } });
    expect(await familyGate(ok, memoryDir)).toBeNull();
    expect(await ok.json()).toEqual({ kind: "reminder", content_type: "audio/wav" });
    expect((await familyGate(req("POST", `/api/upload-url?session=${s.id}`, { cookie: her.cookie, body: { kind: "label", content_type: "image/png" } }), memoryDir))?.status).toBe(403);
    expect((await familyGate(req("POST", `/api/upload-url?session=${s.id}`, { cookie: her.cookie, body: "not json" }), memoryDir))?.status).toBe(403);
  });

  it("joining again: her phone with the session's own code is 403 for any role but family; his phone and a fresh phone still join", async () => {
    const s = await session();
    const other = await session();
    const her = await device(s, "family");
    const his = await device(s, "patient");
    const join = (cookie: string, role: string, q = "") => req("POST", `/api/session/join${q}`, { cookie, body: { code: s.join_code, role } });
    for (const role of ["patient", "director", "backstage", "judge"]) {
      // the session comes from her rp_session cookie (join names no ?session=), or from ?session=; the join route
      // reads only the code, so naming a session she has no row in must not make her a device with no role
      for (const q of ["", `?session=${s.id}`, "?session=nope-session", `?session=${other.id}`]) {
        const res = await familyGate(join(her.cookie, role, q), memoryDir);
        expect(res?.status, `${role}${q}`).toBe(403);
        expect(await res?.json(), `${role}${q}`).toMatchObject({ error: "patient_only" });
      }
      // a forged rp_role does not lift her out of the rule (her member row decides)
      expect((await familyGate(join(her.cookie.replace("rp_role=family", `rp_role=${role}`), role), memoryDir))?.status, `forged ${role}`).toBe(403);
    }
    // opening a session of her own is closed to her too, whatever session the request names
    for (const q of ["", "?session=nope-session", `?session=${other.id}`]) {
      expect((await familyGate(req("POST", `/api/session${q}`, { cookie: her.cookie, body: { story_day: 0 } }), memoryDir))?.status, `create${q}`).toBe(403);
    }
    const again = join(her.cookie, "family");
    expect(await familyGate(again, memoryDir)).toBeNull();
    expect(await again.json()).toEqual({ code: s.join_code, role: "family" }); // the handler still gets the body
    expect(await familyGate(join(his.cookie, "patient"), memoryDir)).toBeNull();
    expect(await familyGate(join("", "patient"), memoryDir)).toBeNull(); // a phone with no session yet: /join as before
    const members = await getMemoryStore().listMembers(s.id);
    expect(members.map((m) => m.role).sort()).toEqual(["family", "patient"]); // the gate itself adds nobody
  });

  it("never looks at the paths it leaves out, even for her", async () => {
    const list = vi.fn(async (sid: string) => [{ id: "m1", session_id: sid, role: "family" as MemberRole, device_label: null, created_at: "x" }]);
    const dir = memberDirectory(list);
    for (const p of ["/_next/static/chunks/a.js", "/_next/image?url=x", "/__nextjs_original-stack-frames", "/favicon.ico", "/worklets/pcm-recorder.js", "/api/blob/upload?token=t", "/api/preflight/upload"]) {
      expect(outsideGate(p.split("?")[0]), p).toBe(true);
      expect(await familyGate(req("GET", p, { cookie: "rp_session=s1; rp_member=m1" }), dir), p).toBeNull();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("a stranger in a session she has joined gets nothing: every API 403 member_required (allow-list included), pages 307 /join", async () => {
    const s = await session();
    await device(s, "family");
    const routes = apiRoutes();
    // her phone with its cookies dropped names his session; a forged cookie set has no row either
    for (const cookie of ["", `rp_session=${s.id}; rp_role=patient`, `rp_session=${s.id}; rp_role=family`]) {
      for (const r of routes) {
        if (outsideGate(r.route)) continue;
        const res = await proxy(req(r.method, `${concrete(r.route)}?session=${s.id}`, { cookie, body: r.method === "GET" || r.method === "DELETE" ? undefined : {} }));
        if (r.method === "POST" && r.route === "/api/session/join") {
          // joining with the code is the one way in (the handler reads only the code)
          expect(res.headers.get("x-middleware-next"), `${cookie || "no cookies"}: join`).toBe("1");
          continue;
        }
        expect(res.status, `${cookie || "no cookies"}: ${r.method} ${r.route}`).toBe(403);
        expect((await res.json()).error, `${r.method} ${r.route}`).toBe("member_required");
      }
    }
    // pages read the cookie: a forged rp_session of his is sent to /join, which is the one page it may open
    for (const p of find(APP, "page.tsx").map(routeOf)) {
      const res = await proxy(req("GET", concrete(p), { cookie: `rp_session=${s.id}; rp_role=patient` }));
      if (p === "/join") {
        expect(res.headers.get("x-middleware-next"), p).toBe("1");
        continue;
      }
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location"), p).toBe("http://localhost/join");
    }
    // before anyone joined as family a device that presents its session cookie still passes, as before M6 (the e2e
    // harness's openDevice); a request with no cookie at all does not (see "anonymous" below)
    const plain = await session();
    expect(await familyGate(req("GET", `/api/notes?session=${plain.id}`, { cookie: `rp_session=${plain.id}` }), memoryDir)).toBeNull();
    expect((await familyGate(req("GET", `/api/notes?session=${plain.id}`), memoryDir))?.status).toBe(403);
    expect((await familyGate(req("POST", `/api/family/grants?session=${plain.id}`, { body: { items: { notes: true } } }), memoryDir))?.status).toBe(403);
  });

  it("a request with no device at all, about a session nobody joined as family: every API 403 member_required except ANONYMOUS_API", async () => {
    const s = await session();
    await device(s, "patient"); // his phone is in; Wei Ling is not (a judge's sandbox, the shoot before she joins)
    const routes = apiRoutes();
    const open: string[] = [];
    for (const r of routes) {
      if (outsideGate(r.route)) continue;
      const key = `${r.method} ${r.route}`;
      const res = await proxy(req(r.method, `${concrete(r.route)}?session=${s.id}`, { body: r.method === "GET" || r.method === "DELETE" ? undefined : {} }));
      if (ANONYMOUS_API.some((a) => a.method === r.method && a.route === r.route)) {
        expect(res.headers.get("x-middleware-next"), `${key} is on ANONYMOUS_API`).toBe("1");
        open.push(key);
        continue;
      }
      expect(res.status, key).toBe(403);
      expect((await res.json()).error, key).toBe("member_required");
    }
    expect(open.sort()).toEqual(ANONYMOUS_API.map((a) => `${a.method} ${a.route}`).sort());
    // the same session from a device that presents its cookie (the e2e harness's openDevice), and from his own phone
    expect(await familyGate(req("GET", `/api/notes?session=${s.id}`, { cookie: `rp_session=${s.id}` }), memoryDir)).toBeNull();
    // a request that names no session reads nothing and is not refused (the landing, /how, the health check)
    for (const p of ["/api/health", "/api/notes", "/"]) expect(await familyGate(req("GET", p), memoryDir), p).toBeNull();
    // once she has joined, the same request is a stranger: only the join is left
    await device(s, "family");
    const sessionRead = await familyGate(req("GET", `/api/session?session=${s.id}`), memoryDir);
    expect(sessionRead?.status).toBe(403);
    expect(await sessionRead?.json()).toMatchObject({ error: "member_required" });
  });

  it("ANONYMOUS_API: real routes, each with its reason, none of them his data", () => {
    const routes = apiRoutes();
    for (const a of ANONYMOUS_API) {
      expect(routes, `${a.method} ${a.route}`).toContainEqual({ method: a.method, route: a.route });
      expect(a.why.length, `${a.method} ${a.route}`).toBeGreaterThan(10);
      expect(anonymousAllowed(a.method, a.route), `${a.method} ${a.route}`).toBe(true);
    }
    for (const [m, p] of [
      ["GET", "/api/notes"],
      ["GET", "/api/events"],
      ["GET", "/api/family/view"],
      ["GET", "/api/family/grants"],
      ["POST", "/api/family/grants"],
      ["GET", "/api/reminders"],
      ["POST", "/api/clock"],
      ["POST", "/api/session/reset"],
      ["GET", "/api/session/join"],
      ["DELETE", "/api/session"],
      ["GET", "/api/session/x"],
      ["GET", "/api/real/job-1"],
      ["GET", "/api/an-api-added-later"],
    ] as const) {
      expect(anonymousAllowed(m, p), `${m} ${p}`).toBe(false);
    }
  });

  it("her phone naming another real session gets nothing there: every API 403 patient_only, allow-list included", async () => {
    const s = await session();
    const t = await session();
    const her = await device(s, "family");
    for (const r of apiRoutes()) {
      if (outsideGate(r.route)) continue;
      const listed = FAMILY_API.find((x) => x.method === r.method && x.route === r.route);
      const body = r.method === "GET" || r.method === "DELETE" ? undefined : listed ? (herBody(listed) ?? {}) : {};
      const res = await proxy(req(r.method, `${concrete(r.route)}?session=${t.id}`, { cookie: her.cookie, body }));
      expect(res.status, `${r.method} ${r.route}`).toBe(403);
      expect((await res.json()).error, `${r.method} ${r.route}`).toBe("patient_only");
    }
    // and in her own session the allow-list still works
    expect((await proxy(req("GET", `/api/family/view?session=${s.id}`, { cookie: her.cookie }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("the proxy passes with NextResponse.next() and answers her itself", async () => {
    const s = await session();
    const her = await device(s, "family");
    const pass = await proxy(req("GET", `/api/family/view?session=${s.id}`, { cookie: her.cookie }));
    expect(pass.headers.get("x-middleware-next")).toBe("1");
    const stop = await proxy(req("GET", `/api/bp?session=${s.id}`, { cookie: her.cookie }));
    expect(stop.status).toBe(403);
  });

  it("the proxy matcher leaves out exactly the gate's OUTSIDE_GATE paths (and nothing it must see)", () => {
    expect(proxyConfig.matcher).toHaveLength(1);
    const re = new RegExp(`^${proxyConfig.matcher[0]}$`);
    for (const o of OUTSIDE_GATE) expect(re.test(o.prefix.endsWith("/") ? `${o.prefix}x.js` : o.prefix), o.prefix).toBe(false);
    for (const p of ["/", "/f", "/join", "/p/today", "/p/visit/v1/review", "/backstage", "/api/notes", "/api/events", "/api/blob/read", "/api/preflight/wait", "/api/upload-url"]) {
      expect(re.test(p), p).toBe(true);
    }
  });
});
