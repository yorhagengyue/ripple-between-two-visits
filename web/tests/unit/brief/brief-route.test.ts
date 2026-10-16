/**
 * GET /api/brief (spec section 2; task M7): the same data /p/brief renders (lib/summary/brief.ts buildBrief after the
 * same settle + pattern sync the page runs), story-day gated, and Wei Ling (family role) gets 403 patient_only since
 * none of his switches covers the brief; patient, a judge's sandbox and a request with no role get 200.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as briefGet } from "@/app/api/brief/route";
import { POST as grantsPost } from "@/app/api/family/grants/route";
import { settleNoReply } from "@/lib/daily/doses";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import type { Locale } from "@/lib/i18n";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import { buildBrief, type BriefView } from "@/lib/summary/brief";

const R1_TEXT = "At home, we want it below 135 over 85.";
const D37_NOTE = "今天在大巴窑中心走了一圈，脚踝有点肿。";

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

function get(sessionId: string | null, opts: { locale?: string; cookie?: string } = {}): NextRequest {
  const q = new URLSearchParams();
  if (sessionId) q.set("session", sessionId);
  if (opts.locale) q.set("locale", opts.locale);
  return new NextRequest(`http://localhost/api/brief?${q}`, { headers: opts.cookie ? { cookie: opts.cookie } : {} });
}

async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

async function brief(s: SessionRow, opts: { locale?: string; cookie?: string } = {}): Promise<BriefView> {
  const res = await briefGet(get(s.id, opts));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return ((await res.json()) as { brief: BriefView }).brief;
}

/** What /p/brief renders for this session (app/p/brief/page.tsx), as JSON. */
async function pageData(s: SessionRow, locale: Locale): Promise<unknown> {
  const store = getMemoryStore();
  const fresh = (await store.getSession(s.id))!;
  await settleNoReply(store, fresh);
  await syncPatternQuestions(store, fresh);
  return JSON.parse(JSON.stringify(await buildBrief(store, fresh, locale)));
}

describe("GET /api/brief returns what /p/brief renders", () => {
  for (const locale of ["zh-Hans", "en"] as const) {
    it(`D41 (${locale}): equal to buildBrief after the page's own steps; the M7 numbers`, async () => {
      const s = await sessionAt(41);
      const view = await brief(s, { locale });
      expect(view).toEqual(await pageData(s, locale));
      expect(view.window).toMatchObject({ fromDay: 9, toDay: 41, lastVisit: { id: "v2" } });
      expect(view.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
      expect(view.target).toMatchObject({ text: R1_TEXT, date: "2026-08-24" });
      expect(view.doses).toMatchObject({ due: 33, taken: 29, missed: 4, unconfirmed: 0, missedDays: [15, 17, 24, 36] });
      expect(view.notes.map((n) => n.text)).toContain(D37_NOTE);
      expect(view.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    });
  }

  it("language: ?locale= first, then the rp_lang cookie, then English (the default since the owner's 10-15)", async () => {
    const s = await sessionAt(41);
    const pattern = (v: BriefView) => v.questions.shown.find((q) => q.origin === "pattern")!.text;
    const zh = pattern(await brief(s, { locale: "zh-Hans" }));
    const en = pattern(await brief(s, { locale: "en" }));
    expect(zh).not.toBe(en);
    expect(pattern(await brief(s))).toBe(en);
    expect(pattern(await brief(s, { cookie: "rp_lang=zh-Hans" }))).toBe(zh);
    expect(pattern(await brief(s, { cookie: "rp_lang=en" }))).toBe(en);
    expect(pattern(await brief(s, { locale: "zh-Hans", cookie: "rp_lang=en" }))).toBe(zh);
  });
});

describe("story-day gating through the route", () => {
  it("D29: nothing after D29; D0: no number from the doctor yet", async () => {
    const d29 = await brief(await sessionAt(29, "20:15"));
    expect(d29.window).toMatchObject({ fromDay: 9, toDay: 29 });
    expect(d29.bp).toMatchObject({ count: 7, notBelow: 6 });
    expect(d29.doses).toMatchObject({ due: 21, taken: 18, missed: 3 });
    expect(d29.notes.every((n) => n.day <= 29)).toBe(true);
    expect(d29.notes.map((n) => n.text)).not.toContain(D37_NOTE);
    expect(d29.questions.shown.map((q) => q.id)).not.toContain("q-knee-2");
    const d0 = await brief(await sessionAt(0));
    expect(d0.target).toBeNull();
    expect(d0.bp.count).toBe(0);
  });
});

describe("who may read it", () => {
  it("patient, judge, the crew screens and a request with no role: 200", async () => {
    const s = await sessionAt(41);
    for (const role of ["patient", "judge", "backstage", "director"] as const) await brief(s, { cookie: await device(s, role) });
    await brief(s);
  });

  it("Wei Ling (family): 403 patient_only, by her member row or her role cookie, even with every switch on", async () => {
    const s = await sessionAt(41);
    const her = await device(s, "family");
    const all = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
    // only his phone (a device with a patient row) changes the switches (lib/family/role.ts denyNonPatient, 10-09 B1)
    const his = await device(s, "patient");
    expect((await grantsPost(new NextRequest(`http://localhost/api/family/grants?session=${s.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: his }, body: JSON.stringify({ items: all }) }))).status).toBe(200);
    for (const cookie of [her, `rp_session=${s.id}; rp_role=family`]) {
      const res = await briefGet(get(s.id, { cookie }));
      expect(res.status, cookie).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      // her member row: patient_only; a role cookie with no row in a session she has joined is a stranger (B1, 10-09)
      expect(body.error).toBe(cookie === her ? "patient_only" : "member_required");
      expect(body).not.toHaveProperty("brief");
    }
  });

  it("400 without a session, 404 for an unknown one", async () => {
    expect((await briefGet(get(null))).status).toBe(400);
    expect((await briefGet(get("no-such-session"))).status).toBe(404);
  });
});
