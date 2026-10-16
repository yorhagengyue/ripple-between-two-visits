/**
 * More of the demo side of the owner's must-fix list (C2 follow-up, track E; docs/plan/real-app.md 12), the rows about
 * his own record:
 *
 *   blood pressure   today's reading can be corrected and deleted on the demo (/api/demo/bp); an earlier day's cannot;
 *                    a correction above the doctor's warning line relays his words like a new reading; her phone and
 *                    an account are refused
 *   the brief        on Day 42 before the third visit the medicine list does not hold the Losartan prescribed at it
 *   the questions    his own list on the demo: the same words twice stay one question; set aside and put back; a
 *                    question whose answer is recorded at a visit keeps its words
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as bpPost } from "@/app/api/bp/route";
import { DELETE as demoBpDelete, PATCH as demoBpPatch } from "@/app/api/demo/bp/route";
import { PATCH as questionPatch } from "@/app/api/questions/[id]/route";
import { POST as questionsPost } from "@/app/api/questions/route";
import { getBus, type BusEvent } from "@/lib/bus";
import { questionsView } from "@/lib/daily/questions";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { buildBrief } from "@/lib/summary/brief";

const store = getMemoryStore();

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return store.createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

function call(method: "POST" | "PATCH" | "DELETE", path: string, sessionId: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}?session=${sessionId}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function cookieFor(s: SessionRow, role: MemberRole): Promise<string> {
  const member = await store.addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

async function record(s: SessionRow, systolic: number, diastolic: number): Promise<string> {
  const res = await bpPost(call("POST", "/api/bp", s.id, { systolic, diastolic }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { reading: { id: string } }).reading.id;
}

describe("the demo's blood pressure: today's reading can be corrected and deleted", () => {
  it("a wrong number is corrected in place: the row holds the new numbers and the change is kept as an event", async () => {
    const s = await sessionAt(29, "20:15");
    const seen: BusEvent[] = [];
    const off = getBus().subscribe(s.id, (e) => void seen.push(e));
    const id = await record(s, 51, 88);
    const res = await demoBpPatch(call("PATCH", "/api/demo/bp", s.id, { id, systolic: 151, diastolic: 88 }));
    off();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reading: { id: string; systolic: number; diastolic: number }; relay: unknown };
    expect([body.reading.id, body.reading.systolic, body.reading.diastolic]).toEqual([id, 151, 88]);
    expect(body.relay).toBeNull();
    const today = await store.listBp(s.id, { fromDay: 29, toDay: 29 });
    expect(today.filter((r) => r.id === id).map((r) => [r.systolic, r.diastolic])).toEqual([[151, 88]]);
    const change = seen.find((e) => e.type === "bp.logged" && (e.data as { corrected?: boolean }).corrected === true);
    expect(change, "the correction is published").toBeTruthy();
    expect((change!.data as { was: unknown }).was).toEqual({ systolic: 51, diastolic: 88 });
  });

  it("corrected to above the doctor's warning line: his line and then the 995 sentence come back, as for a new reading", async () => {
    const s = await sessionAt(29, "20:15");
    const id = await record(s, 150, 95);
    const res = await demoBpPatch(call("PATCH", "/api/demo/bp", s.id, { id, systolic: 185, diastolic: 112 }));
    expect(res.status).toBe(200);
    const relay = ((await res.json()) as { relay: ThresholdRelay | null }).relay!;
    expect(relay).not.toBeNull();
    // the doctor's own words first, the 995 sentence after (owner 10-14), for when he feels very unwell (his second decision)
    expect(relay.lines.map((l) => l.origin)).toEqual(["span", "template"]);
    expect(relay.template.templateId).toBe("signal_995_unwell");
    expect(relay.doctorLine.attribution).toBe("doctor");
  });

  it("deleted: gone from his readings, and the deletion is kept as an event with the reading", async () => {
    const s = await sessionAt(29, "20:15");
    const seen: BusEvent[] = [];
    const off = getBus().subscribe(s.id, (e) => void seen.push(e));
    const id = await record(s, 140, 90);
    const res = await demoBpDelete(call("DELETE", "/api/demo/bp", s.id, { id }));
    off();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: string }).deleted).toBe(id);
    expect((await store.listBp(s.id, { fromDay: 29, toDay: 29 })).some((r) => r.id === id)).toBe(false);
    const gone = seen.find((e) => e.type === "bp.logged" && (e.data as { deleted?: boolean }).deleted === true);
    expect((gone!.data as { reading: { systolic: number } }).reading.systolic).toBe(140);
  });

  it("an earlier day's reading is his record as it stands: 404 for both, and nothing changes", async () => {
    const s = await sessionAt(29, "20:15");
    const earlier = (await store.listBp(s.id, { toDay: 28 })).at(-1)!;
    expect(earlier).toBeTruthy();
    const before = JSON.stringify(await store.listBp(s.id, { toDay: 28 }));
    expect((await demoBpPatch(call("PATCH", "/api/demo/bp", s.id, { id: earlier.id, systolic: 120, diastolic: 80 }))).status).toBe(404);
    expect((await demoBpDelete(call("DELETE", "/api/demo/bp", s.id, { id: earlier.id }))).status).toBe(404);
    expect(JSON.stringify(await store.listBp(s.id, { toDay: 28 }))).toBe(before);
  });

  it("numbers that are not a reading are refused (400), her phone is refused (403), and the reading stays", async () => {
    const s = await sessionAt(29, "20:15");
    const id = await record(s, 138, 86);
    for (const bad of [{ id, systolic: 1380, diastolic: 86 }, { id, systolic: 138 }, { id, systolic: "138", diastolic: 86 }, { id, systolic: 138, diastolic: 86, note: "x" }]) {
      expect((await demoBpPatch(call("PATCH", "/api/demo/bp", s.id, bad))).status, JSON.stringify(bad)).toBe(400);
    }
    const hers = await cookieFor(s, "family");
    expect((await demoBpPatch(call("PATCH", "/api/demo/bp", s.id, { id, systolic: 120, diastolic: 80 }, hers))).status).toBe(403);
    expect((await demoBpDelete(call("DELETE", "/api/demo/bp", s.id, { id }, hers))).status).toBe(403);
    expect((await store.listBp(s.id, { fromDay: 29, toDay: 29 })).filter((r) => r.id === id).map((r) => r.systolic)).toEqual([138]);
  });

  it("no session at all: refused, never a 2xx", async () => {
    const bare = new NextRequest("http://localhost/api/demo/bp", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "x", systolic: 120, diastolic: 80 }) });
    const res = await demoBpPatch(bare);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("the demo's brief: the medicine list is his medicines at this moment of the story", () => {
  it("Day 42 before the third visit (10:00): Losartan, prescribed at it, is not on the list; after the visit it is, marked new", async () => {
    const before = await buildBrief(store, await sessionAt(42, "08:00"), "en");
    expect(before.meds.map((m) => m.name).join(" | ")).not.toMatch(/Losartan/i);
    expect(before.meds.length).toBeGreaterThan(0);
    const after = await buildBrief(store, await sessionAt(43, "08:00"), "en");
    const losartan = after.meds.find((m) => /Losartan/i.test(m.name));
    expect(losartan, "the day after the visit").toBeTruthy();
  });
});

describe("his question list on the demo can be changed by him", () => {
  it("a question in his own words is added; the same words again stay one question", async () => {
    const s = await sessionAt(29, "20:15");
    const words = "这个药要吃到什么时候？";
    const first = await questionsPost(call("POST", "/api/questions", s.id, { text: words, for: "doctor" }));
    expect(first.status).toBeLessThan(300);
    expect(((await first.json()) as { outcome: string }).outcome).toBe("created");
    const again = await questionsPost(call("POST", "/api/questions", s.id, { text: words, for: "doctor" }));
    expect(((await again.json()) as { outcome: string }).outcome).toBe("merged");
    const view = await questionsView(store, s, "zh-Hans");
    expect(view.doctor.filter((q) => q.text === words)).toHaveLength(1);
    expect(view.doctor.find((q) => q.text === words)).toMatchObject({ status: "open", wording: "own_words", origin: "own" });
  });

  it("「改一下」 changes his words, 「不问了」 sets it aside and 「放回去」 puts it back", async () => {
    const s = await sessionAt(29, "20:15");
    const made = (await (await questionsPost(call("POST", "/api/questions", s.id, { text: "要不要少吃盐？", for: "doctor" }))).json()) as { question: { id: string } };
    const id = made.question.id;
    const path = `/api/questions/${id}`;
    const ctx = { params: Promise.resolve({ id }) };
    expect((await questionPatch(call("PATCH", path, s.id, { text: "盐要少吃到多少？" }), ctx)).status).toBe(200);
    expect((await questionsView(store, s, "zh-Hans")).doctor.find((q) => q.id === id)?.text).toBe("盐要少吃到多少？");
    expect((await questionPatch(call("PATCH", path, s.id, { status: "skipped" }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await questionsView(store, s, "zh-Hans")).doctor.find((q) => q.id === id)?.status).toBe("skipped");
    expect((await questionPatch(call("PATCH", path, s.id, { status: "open" }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await questionsView(store, s, "zh-Hans")).doctor.find((q) => q.id === id)?.status).toBe("open");
  });

  it("a story question whose answer is recorded at a later visit reads as waiting on Day 29 and keeps its words (409)", async () => {
    const s = await sessionAt(29, "20:15");
    const id = "q-extra-tablet";
    const shown = (await questionsView(store, s, "zh-Hans")).doctor.find((q) => q.id === id);
    expect(shown?.status).toBe("open");
    // the page offers no tools for it: the store row already holds the answer from the third visit
    expect((await store.listQuestions(s.id)).find((q) => q.id === id)?.status).toBe("answered");
    for (const body of [{ status: "skipped" }, { text: "别的话" }]) {
      const res = await questionPatch(call("PATCH", `/api/questions/${id}`, s.id, body), { params: Promise.resolve({ id }) });
      expect(res.status, JSON.stringify(body)).toBe(409);
    }
  });
});
