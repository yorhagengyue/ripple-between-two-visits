/**
 * M6/M7 fixer round 1 (the independent verification's defects that sit in the family / brief paths):
 *   - defect 1 (part): Wei Ling's phone on /p/brief or /p/family is sent to /f before anything renders. pageRole
 *     reads the role the same way the APIs do (lib/family/identity.ts: member row first, a forged rp_role cannot
 *     override it; once she has joined, a device without a row is a stranger); sendFamilyToF redirects her to /f and a
 *     stranger to /join. (The page-level proof is e2e/m6-family.spec.ts.)
 *   - defect 4 (part): /f's refetch, the switch page's reads and taps and her recorder go through requestJson, which
 *     never fails silently: every outcome is ok, http (status, code), network, timeout, bad_body or aborted;
 *     retryDelayMs paces the automatic retries; the shape checks reject bodies that are not the expected view.
 *   - defect 6: English counts have a singular ("Not taken: 1 day", "Not confirmed: 1 reading").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS, isFamilyViewData, isGrantsResponse, isUploadUrl, requestJson, RETRY_MAX_MS, retryDelayMs } from "@/lib/family/fetch";
import { allFamilyStrings, ft, ftn, type FamilyKey } from "@/lib/family/i18n";
import { FAMILY_HOME, pageRole, sendFamilyToF } from "@/lib/family/role";
import { familyView } from "@/lib/family/view";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

async function member(s: SessionRow, role: MemberRole): Promise<string> {
  return (await getMemoryStore().addMember(s.id, { role })).id;
}

/** The redirect next/navigation throws: NEXT_REDIRECT;<type>;<url>;<status>; */
async function redirectTarget(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    const digest = String((err as { digest?: unknown }).digest ?? "");
    expect(digest.startsWith("NEXT_REDIRECT;"), digest).toBe(true);
    return digest.split(";")[2] ?? "";
  }
}

describe("defect 1: his pages send Wei Ling's phone to /f", () => {
  it("pageRole: the member row wins over a forged rp_role; the cookie counts only in a session nobody joined as family", async () => {
    const store = getMemoryStore();
    // a session nobody joined as family (the e2e harness): the rp_role cookie still counts, nothing -> null
    const plain = await sessionAt(41);
    const himPlain = await member(plain, "patient");
    expect(await pageRole({ session: plain, memberId: himPlain, role: "family" }, store)).toBe("patient");
    expect(await pageRole({ session: plain, memberId: null, role: "family" }, store)).toBe("family");
    expect(await pageRole({ session: plain, memberId: null, role: " judge " }, store)).toBe("judge");
    expect(await pageRole({ session: plain, memberId: null, role: null }, store)).toBeNull();
    expect(await pageRole({ session: plain, memberId: null, role: "admin" }, store)).toBeNull();
    // a member row from another session does not count
    const other = await sessionAt(41);
    const hersElsewhere = await member(other, "family");
    expect(await pageRole({ session: plain, memberId: hersElsewhere, role: "patient" }, store)).toBe("patient");
    // in a session she has joined, only a row counts; any device without one acts as the least ("family")
    const s = await sessionAt(41);
    const her = await member(s, "family");
    const him = await member(s, "patient");
    expect(await pageRole({ session: s, memberId: her, role: "family" }, store)).toBe("family");
    expect(await pageRole({ session: s, memberId: her, role: "patient" }, store)).toBe("family"); // forged cookie
    expect(await pageRole({ session: s, memberId: him, role: "family" }, store)).toBe("patient");
    for (const [memberId, role] of [["no-such-member", "patient"], [null, "patient"], [null, "judge"], [null, null], [hersElsewhere, "patient"]] as const) {
      expect(await pageRole({ session: s, memberId, role }, store), `${memberId} ${role}`).toBe("family");
    }
  });

  it("sendFamilyToF sends her phone to /f and a stranger to /join, and lets his side through", async () => {
    const store = getMemoryStore();
    expect(FAMILY_HOME).toBe("/f");
    const plain = await sessionAt(41);
    expect(await redirectTarget(sendFamilyToF({ session: plain, memberId: null, role: "family" }, store))).toBe("/f");
    for (const role of ["patient", "judge", "backstage", "director", null] as const) {
      expect(await redirectTarget(sendFamilyToF({ session: plain, memberId: null, role }, store)), String(role)).toBeNull();
    }
    const s = await sessionAt(41);
    const her = await member(s, "family");
    expect(await redirectTarget(sendFamilyToF({ session: s, memberId: her, role: "patient" }, store))).toBe("/f");
    expect(await redirectTarget(sendFamilyToF({ session: s, memberId: await member(s, "patient"), role: "family" }, store))).toBeNull();
    expect(await redirectTarget(sendFamilyToF({ session: s, memberId: await member(s, "judge"), role: null }, store))).toBeNull();
    // once she has joined, a device with no row in his session (her phone with forged cookies) goes to /join
    for (const role of ["patient", "judge", "family", null] as const) {
      expect(await redirectTarget(sendFamilyToF({ session: s, memberId: null, role }, store)), String(role)).toBe("/join");
    }
    expect(await redirectTarget(sendFamilyToF({ session: s, memberId: "no-such-member", role: "patient" }, store))).toBe("/join");
  });
});

describe("defect 4: requestJson says what went wrong, never nothing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("2xx JSON that passes the check -> ok with the data; the request is same-origin, no-store, with a signal", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return json({ member: "wei-ling", items: { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await requestJson("/api/family/grants?session=s", { check: isGrantsResponse });
    expect(r).toMatchObject({ ok: true, status: 200, data: { member: "wei-ling" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a JSON body is sent as JSON; a POST that answers 403 patient_only -> http 403 with the code", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual({ items: { notes: true } });
      return json({ error: "patient_only" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestJson("/api/family/grants", { method: "POST", json: { items: { notes: true } } })).toEqual({ ok: false, problem: "http", status: 403, code: "patient_only" });
  });

  it("500 with no JSON -> http 500, no code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 500 })));
    expect(await requestJson("/api/family/view")).toEqual({ ok: false, problem: "http", status: 500, code: undefined });
  });

  it("no answer (fetch rejects) -> network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await requestJson("/api/family/view")).toEqual({ ok: false, problem: "network" });
  });

  it("no answer within the timeout -> timeout, and the request is aborted", async () => {
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );
    expect(await requestJson("/api/family/view", { timeoutMs: 30 })).toEqual({ ok: false, problem: "timeout" });
    expect(aborted).toBe(true);
    expect(FETCH_TIMEOUT_MS).toBe(8000);
  });

  it("the default timeout is 8 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))),
    );
    const p = requestJson("/api/family/view");
    await vi.advanceTimersByTimeAsync(7_999);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toEqual({ ok: false, problem: "timeout" });
  });

  it("the caller cancelling -> aborted (not an error to show)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))),
    );
    const ctrl = new AbortController();
    const p = requestJson("/api/family/view", { signal: ctrl.signal });
    ctrl.abort();
    expect(await p).toEqual({ ok: false, problem: "aborted" });
    const already = new AbortController();
    already.abort();
    expect(await requestJson("/api/family/view", { signal: already.signal })).toEqual({ ok: false, problem: "aborted" });
  });

  it("2xx that is not JSON, or not the expected shape -> bad_body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    expect(await requestJson("/api/family/view")).toEqual({ ok: false, problem: "bad_body", status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => json({ day: 29 })));
    expect(await requestJson("/api/family/view", { check: isFamilyViewData })).toEqual({ ok: false, problem: "bad_body", status: 200 });
  });

  it("expect any: a 2xx upload is ok without reading the body; a 413 is http 413", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await requestJson("/api/blob/upload", { method: "PUT", body: new Blob([new Uint8Array(4)]), expect: "any" })).toMatchObject({ ok: true, status: 204 });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "too_large" }, 413)));
    expect(await requestJson("/api/blob/upload", { method: "PUT", body: new Blob([new Uint8Array(4)]), expect: "any" })).toEqual({ ok: false, problem: "http", status: 413, code: "too_large" });
  });

  it("retries back off 1 s, 2 s, 4 s, 8 s, then every 15 s", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    expect(RETRY_MAX_MS).toBe(15_000);
    expect(retryDelayMs(-1)).toBe(1000);
    expect(retryDelayMs(Number.NaN)).toBe(1000);
  });

  it("shape checks: the family view, the switches, an upload link", async () => {
    const s = await sessionAt(29);
    const view = await familyView(getMemoryStore(), s);
    expect(isFamilyViewData(JSON.parse(JSON.stringify(view)))).toBe(true);
    expect(isFamilyViewData({ ...view, grants: { ...view.grants, notes: "yes" } })).toBe(false);
    expect(isFamilyViewData({ ...view, generatedAt: "now" })).toBe(false);
    expect(isFamilyViewData(null)).toBe(false);
    expect(isFamilyViewData([])).toBe(false);
    expect(isGrantsResponse({ member: "wei-ling", items: view.grants, updated_at: null })).toBe(true);
    expect(isGrantsResponse({ member: "wei-ling", items: { notes: true } })).toBe(false);
    expect(isUploadUrl({ path: "s/reminders/a.wav", url: "/api/blob/upload?x", method: "PUT", headers: { "content-type": "audio/wav" } })).toBe(true);
    expect(isUploadUrl({ path: "", url: "/x", method: "PUT", headers: {} })).toBe(false);
    expect(isUploadUrl({ path: "a", url: "/x", method: "PUT", headers: { n: 1 } })).toBe(false);
  });
});

describe("defect 6: counts read right in English", () => {
  it("one day / one reading in the singular, more in the plural; Chinese the same words", () => {
    expect(ftn("en", "f.doses.missed", 1)).toBe("Not taken: 1 day");
    expect(ftn("en", "f.doses.missed", 2)).toBe("Not taken: 2 days");
    expect(ftn("en", "f.doses.unconfirmed", 1)).toBe("Not confirmed: 1 day");
    expect(ftn("en", "f.doses.unconfirmed", 3)).toBe("Not confirmed: 3 days");
    expect(ftn("en", "f.bp.unconfirmed", 1)).toBe("Not confirmed: 1 reading");
    expect(ftn("en", "f.bp.unconfirmed", 2)).toBe("Not confirmed: 2 readings");
    expect(ftn("en", "f.doses.days", 1, { taken: 1, due: 1 })).toBe("Took his medicine on 1 of 1 day");
    expect(ftn("en", "f.doses.days", 2, { taken: 2, due: 2 })).toBe("Took his medicine on 2 of 2 days");
    expect(ftn("zh-Hans", "f.doses.missed", 1)).toBe("未服药：1 天");
    expect(ftn("zh-Hans", "f.doses.missed", 2)).toBe("未服药：2 天");
    expect(ftn("zh-Hans", "f.bp.unconfirmed", 1)).toBe("未确认：1 次");
    expect(ftn("zh-Hans", "f.doses.days", 1, { taken: 0, due: 1 })).toBe("1 天中 0 天已服药");
    // a key without a twin is used as it is
    expect(ftn("en", "f.bp.count", 1)).toBe("Readings this week: 1");
    // the twin is filled in the same way as the key
    expect(ft("en", "f.doses.missed_one")).toBe("Not taken: 1 day");
  });

  it("each twin sits next to its key in both languages; no English count reads '1 days' or '1 readings'", () => {
    const twins: FamilyKey[] = ["f.doses.days_one", "f.doses.missed_one", "f.doses.unconfirmed_one", "f.bp.unconfirmed_one"];
    for (const k of twins) {
      const base = k.replace(/_one$/, "") as FamilyKey;
      for (const locale of ["en", "zh-Hans"] as const) {
        expect(allFamilyStrings(locale)).toContain(ft(locale, k));
        expect(allFamilyStrings(locale), `${locale} ${base}`).toContain(ft(locale, base));
        expect(typeof ft(locale, base) === "string" && ft(locale, base).length > 0, `${locale} ${base}`).toBe(true);
      }
      expect(ftn("en", base, 1, { taken: 1, due: 1 })).not.toMatch(/\b1 (days|readings)\b/);
      expect(ftn("en", base, 1, { taken: 1, due: 1 })).toBe(ft("en", k, { n: 1, taken: 1, due: 1 }));
    }
  });

  it("D15 (Tue 8 Sep, the tai-chi morning missed): /f has one day not taken, and says it in the singular", async () => {
    const s = await sessionAt(15, "23:00");
    const view = await familyView(getMemoryStore(), s);
    expect(view.doses?.daysMissed).toBe(1);
    expect(ftn("en", "f.doses.missed", view.doses!.daysMissed)).toBe("Not taken: 1 day");
  });

  it("the new strings (errors, twins) are free of judgement words too", () => {
    for (const locale of ["en", "zh-Hans"] as const) {
      for (const k of ["f.error.load", "g.error.load", "rec.error", "f.doses.missed_one", "f.bp.unconfirmed_one"] as FamilyKey[]) {
        expect(judgementHits(ft(locale, k)), `${locale} ${k}`).toEqual([]);
      }
    }
  });
});

describe("the view is built with its reads side by side (STORE=supabase round trips), and says the same", () => {
  it("passing the switches in gives the same view as reading them; every section is there when all are on", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(43);
    await store.setFamilyGrant(s.id, "wei-ling", { notes: true, visit_transcripts: true });
    const read = await familyView(store, s);
    const given = await familyView(store, s, { grants: read.grants });
    expect({ ...given, generatedAt: 0 }).toEqual({ ...read, generatedAt: 0 });
    expect(Object.keys(read).sort()).toEqual(["bp", "day", "doses", "generatedAt", "grants", "notes", "questions", "visits"]);
  });

  it("each visit gets its own transcript, newest visit first, lines in time order, when several are read at once", async () => {
    const store = getMemoryStore();
    const s = await sessionAt(29);
    await store.setFamilyGrant(s.id, "wei-ling", { visit_transcripts: true });
    const say = (visit: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ t_start_ms: (n - i) * 1000, t_end_ms: (n - i) * 1000 + 900, text: `${visit} line ${n - i}`, role: "doctor" as const, role_state: "confirmed" as const, lang: "en" }));
    await store.addUtterances(s.id, "v1", say("v1", 3));
    await store.addUtterances(s.id, "v2", say("v2", 2));
    const v = await familyView(store, s);
    const ids = v.visits!.map((x) => x.id);
    expect(ids.indexOf("v2")).toBeLessThan(ids.indexOf("v1"));
    expect(v.visits!.find((x) => x.id === "v1")!.lines.map((l) => l.text)).toEqual(["v1 line 1", "v1 line 2", "v1 line 3"]);
    expect(v.visits!.find((x) => x.id === "v2")!.lines.map((l) => l.text)).toEqual(["v2 line 1", "v2 line 2"]);
  });

  it("GET /api/family/view settles the closed reminder window before counting, as before", async () => {
    const { GET } = await import("@/app/api/family/view/route");
    const { NextRequest } = await import("next/server");
    const store = getMemoryStore();
    const s = await sessionAt(42, "09:50"); // D42: no answer, both reminders gone, window closed
    const res = await GET(new NextRequest(`http://localhost/api/family/view?session=${s.id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { doses: { daysUnconfirmed: number } };
    const d42 = (await store.listDoses(s.id, { fromDay: 42, toDay: 42 }))[0];
    expect(d42).toMatchObject({ state: "unconfirmed", reason: "no_reply" });
    expect(body.doses.daysUnconfirmed).toBeGreaterThanOrEqual(1);
  });
});
