/**
 * The account side of /api/doses, /api/doses/slots and /api/bp (C2 track B; real-app 2.8, 6.2, 8.3): the day is the
 * server's (a day or a slot in the request is refused), undo deletes the row, he can say when he takes a medicine whose
 * label names no time, today's readings can be changed and deleted, a reading above the doctor's warning line comes back
 * with track S's relay; the demo keeps its own shapes; no answer names the scope. And no new word of track B judges.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as bpDelete, GET as bpGet, PATCH as bpPatch, POST as bpPost } from "@/app/api/bp/route";
import { DELETE as dosesDelete, POST as dosesPost } from "@/app/api/doses/route";
import { POST as slotsPost } from "@/app/api/doses/slots/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { allDailyStrings } from "@/lib/daily/i18n";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
let him: TestAccount;

function req(path: string, method: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `rp_at=${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `r${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
  setTestClock({ at: "2026-10-13T08:52:00+08:00", frozen: true });
});
afterAll(() => setTestClock(null));

describe("POST / DELETE /api/doses on an account", () => {
  it("no day in the request (400); today's answer is a fresh row; yesterday may be answered; undo deletes it", async () => {
    const t = him.tokens.access_token;
    expect((await dosesPost(req("/api/doses", "POST", t, { medication_id: "med-amlodipine", slot: "morning", state: "taken", day: 43 }))).status).toBe(400);
    const ok = await dosesPost(req("/api/doses", "POST", t, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }));
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(JSON.parse(text).dose).toMatchObject({ day: 43, slot: "morning", state: "taken", created_at: "2026-10-13T00:52:00.000Z" });
    expect(text).not.toContain(him.userId);
    const y = await dosesPost(req("/api/doses", "POST", t, { medication_id: "med-amlodipine", slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了", when: "yesterday" }));
    expect((await y.json()).dose).toMatchObject({ day: 42, state: "missed" });
    expect((await dosesPost(req("/api/doses", "POST", t, { medication_id: "med-amlodipine", slot: "night", state: "taken" }))).status).toBe(409);
    expect((await dosesPost(req("/api/doses", "POST", t, { medication_id: "nope", slot: "morning", state: "taken" }))).status).toBe(404);
    const undo = await dosesDelete(req("/api/doses", "DELETE", t, { medication_id: "med-amlodipine", slot: "morning" }));
    expect(undo.status).toBe(200);
    expect((await undo.json()).dose).toBeNull();
    expect(await store.listDoses(him.userId, { fromDay: 43, toDay: 43 })).toEqual([]);
  });

  it("the demo has no DELETE; a request without sign-in gets nothing", async () => {
    const demo = await store.createSession({ story_day: 43, story_time: "08:52", ttl_hours: 1 });
    expect((await dosesDelete(req(`/api/doses?session=${demo.id}`, "DELETE", null, { medication_id: "med-amlodipine", slot: "morning" }))).status).toBe(404);
    expect((await dosesPost(req("/api/doses", "POST", null, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }))).status).toBe(400);
  });
});

describe("POST /api/doses/slots: he says when he takes a medicine whose label names no time", () => {
  it("writes his choice (source patient) and a start moment; a medicine that is not his prescription: 404", async () => {
    const t = him.tokens.access_token;
    await store.upsertMed(him.userId, { id: "med-noslot", origin: "prescription", status: "label_confirmed", start_day: 43, label: { text: "Take 1 tablet twice daily", directions: "Take 1 tablet twice daily" } });
    const res = await slotsPost(req("/api/doses/slots", "POST", t, { medication_id: "med-noslot", slots: ["night", "morning"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).medication).toEqual({ id: "med-noslot", dose_slots: ["morning", "night"], dose_slots_source: "patient" });
    expect((await store.getMed(him.userId, "med-noslot"))?.start_at).toBe("2026-10-13T00:52:00.000Z");
    expect((await slotsPost(req("/api/doses/slots", "POST", t, { medication_id: "med-ibuprofen", slots: ["morning"] }))).status).toBe(404);
    expect((await slotsPost(req("/api/doses/slots", "POST", t, { medication_id: "med-noslot", slots: ["morning", "morning"] }))).status).toBe(400);
  });
});

describe("/api/bp on an account", () => {
  it("POST records today in the part of the day of his clock (a day or slot is refused); a phone uuid makes a resend harmless", async () => {
    const t = him.tokens.access_token;
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, day: 43 }))).status).toBe(400);
    expect((await bpPost(req("/api/bp", "POST", t, { systolic: 140, diastolic: 84, slot: "evening" }))).status).toBe(400);
    const id = randomUUID();
    const first = await bpPost(req("/api/bp", "POST", t, { id, systolic: 140, diastolic: 84, pulse: 72 }));
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.reading).toMatchObject({ id, day: 43, slot: "morning", systolic: 140, diastolic: 84, pulse: 72, state: "recorded" });
    expect(body.relay).toBeNull();
    const again = await bpPost(req("/api/bp", "POST", t, { id, systolic: 140, diastolic: 84, pulse: 72 }));
    expect(again.status).toBe(200);
    expect((await store.listBp(him.userId, { fromDay: 43, toDay: 43 })).filter((r) => r.id === id)).toHaveLength(1);
  });

  it("a reading above the doctor's warning line comes back with S's relay: the doctor's words first, then 995 if very unwell (owner 10-14)", async () => {
    const t = him.tokens.access_token;
    const res = await bpPost(req("/api/bp", "POST", t, { systolic: 185, diastolic: 112 }));
    const { relay } = await res.json();
    expect(relay.lines.map((s: { templateId?: string; en: string }) => s.templateId ?? s.en)).toEqual([
      "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.",
      "signal_995_unwell",
    ]);
    expect(relay.threshold).toMatchObject({ systolic: 180 });
  });

  it("PATCH and DELETE only today's readings; GET is the account's view", async () => {
    const t = him.tokens.access_token;
    const today = (await store.listBp(him.userId, { fromDay: 43, toDay: 43 }))[0];
    const patched = await bpPatch(req("/api/bp", "PATCH", t, { id: today.id, systolic: 138, diastolic: 82 }));
    expect((await patched.json()).reading).toMatchObject({ id: today.id, systolic: 138, diastolic: 82 });
    const old = (await store.listBp(him.userId, { toDay: 41 }))[0];
    expect((await bpPatch(req("/api/bp", "PATCH", t, { id: old.id, systolic: 1 + 130, diastolic: 80 }))).status).toBe(404);
    expect((await bpDelete(req("/api/bp", "DELETE", t, { id: old.id }))).status).toBe(404);
    expect((await bpDelete(req("/api/bp", "DELETE", t, { id: today.id }))).status).toBe(200);
    const view = await (await bpGet(req("/api/bp", "GET", t))).json();
    expect(view).toMatchObject({ day: 43, date: "2026-10-13", target: { kind: "target", systolic: 135, diastolic: 85, state: "confirmed" }, plan: null });
    expect(view.readings.every((r: { editable: boolean; day: number }) => r.editable === (r.day === 43))).toBe(true);
    expect(JSON.stringify(view)).not.toContain(him.userId);
  });
});

describe("track B's new words judge nothing", () => {
  it("every account string of lib/daily/i18n (Today, the dose answers, the blood pressure page, the notices) in both languages", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const [key, s] of allDailyStrings(locale)) {
        if (!/^(today\.|bp\.page\.|notice\.|slot\.|slotMed\.)/.test(key)) continue;
        expect(judgementHits(s), `${locale} ${key}: ${s}`).toEqual([]);
      }
    }
  });
});
