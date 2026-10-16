/**
 * relayDoctorThreshold (lib/safety/threshold.ts; C2 track S for track B's blood pressure page, e2e-chains.md 16.1): a
 * reading above the doctor's own warning number gets the doctor's words, word for word, with the visit date, the time
 * point and the clip, and then the fixed 995 sentence (10-14, the owner's decision: the doctor's words first; and his
 * second that day: 995 if he feels very unwell, signal_995_unwell); anything else gets nothing. Demo sandbox, the example
 * account and a new account before and after he confirms his first visit.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getSpeechProvider } from "@/lib/asr";
import { relayDoctorThreshold } from "@/lib/safety/threshold";
import { TEMPLATES } from "@/lib/safety/templates";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow, VisitRow } from "@/lib/store/types";
import { confirmVisit, finalizeVisit, startVisit } from "@/lib/visit/pipeline";

const store = getMemoryStore();
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});

async function account(space: "blank" | "example"): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `th${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return a.scope!;
}

/** A visit he records on his account, transcribed from the v1 sample lines (what devfake / Whisper hand back). */
async function recordV1(scope: SessionRow): Promise<VisitRow> {
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  return (await store.getVisit(scope.id, visit.id))!;
}

describe("the demo sandbox (R2 from the 24 August visit)", () => {
  it("185/112 on D29: R2 first, word for word with its date, time point and stand-in clip, then 995 if he feels very unwell", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const relay = await relayDoctorThreshold(store, s, { systolic: 185, diastolic: 112 });
    expect(relay).not.toBeNull();
    expect(relay!.reading).toEqual({ systolic: 185, diastolic: 112 });
    expect(relay!.threshold).toMatchObject({ systolic: 180, visitId: "v1", visitDate: "2026-08-24", state: "confirmed", disputed: false });
    // 10-14: the doctor's own words lead; the 995 sentence comes after them, and (the owner's second decision that day)
    // it is for when he feels very unwell, no longer "Call 995 now"
    expect(relay!.lines.map((l) => l.sourceId)).toEqual(["visit:v1:R2", "referral:B1-01"]);
    expect(relay!.lines).toEqual([relay!.doctorLine, relay!.template]);
    expect(relay!.template).toMatchObject({ origin: "template", templateId: "signal_995_unwell", en: TEMPLATES.signal_995_unwell.en, zh: TEMPLATES.signal_995_unwell.zh });
    expect(relay!.doctorLine).toMatchObject({ en: R2, attribution: "doctor", origin: "span" });
    expect(relay!.doctorLine.zh).toBeUndefined();
    expect(relay!.doctorLine.cite).toMatchObject({
      visitId: "v1",
      date: "2026-08-24",
      requiredLine: "R2",
      utteranceId: "v1-u09",
      roleState: "confirmed",
      standInVoice: true,
      clipLabel: "代录音",
      clipUrl: `/api/visits/v1/clip?u=v1-u09&session=${s.id}`,
    });
    expect(typeof relay!.doctorLine.cite!.tStartMs).toBe("number");
    expect(JSON.stringify(relay)).not.toMatch(/high|normal|danger|偏高|正常|危险/i);
  });

  it("the English label of the clip follows the locale", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const relay = await relayDoctorThreshold(store, s, { systolic: 190 }, { locale: "en" });
    expect(relay!.doctorLine.cite!.clipLabel).toBe("stand-in recording");
    expect(relay!.reading.diastolic).toBeNull();
  });

  it("not above the doctor's number (180/100, 150/95), or not a number: nothing", async () => {
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    expect(await relayDoctorThreshold(store, s, { systolic: 180, diastolic: 100 })).toBeNull();
    expect(await relayDoctorThreshold(store, s, { systolic: 150, diastolic: 95 })).toBeNull();
    expect(await relayDoctorThreshold(store, s, { systolic: Number.NaN })).toBeNull();
  });

  it("D0 08:00, before the 09:30 visit (nobody replayed it): no warning line yet, so nothing", async () => {
    const s = await store.createSession({ story_day: 0, story_time: "08:00", ttl_hours: 1 });
    expect(await relayDoctorThreshold(store, s, { systolic: 200, diastolic: 120 })).toBeNull();
  });
});

describe("accounts", () => {
  it("the example account: R2 on its real date, a clip link without any scope id", async () => {
    const scope = await account("example");
    const relay = await relayDoctorThreshold(store, scope, { systolic: 185, diastolic: 112 });
    expect(relay).not.toBeNull();
    expect(relay!.doctorLine.cite).toMatchObject({ visitId: "v1", date: scope.d0, clipUrl: "/api/visits/v1/clip?u=v1-u09" });
    expect(JSON.stringify(relay)).not.toContain(scope.id);
  });

  it("a new account: nothing before any visit", async () => {
    const scope = await account("blank");
    expect(await relayDoctorThreshold(store, scope, { systolic: 200, diastolic: 120 })).toBeNull();
  });

  it("after his first visit: the line is relayed as 推断 until he confirms it, then as 医生说; a disputed line stays", async () => {
    const scope = await account("blank");
    const visit = await recordV1(scope);
    const before = await relayDoctorThreshold(store, scope, { systolic: 185, diastolic: 112 });
    expect(before).not.toBeNull();
    expect(before!.lines.map((l) => l.templateId ?? "doctor")).toEqual(["doctor", "signal_995_unwell"]);
    expect(before!.threshold).toMatchObject({ systolic: 180, visitId: visit.id, state: "inferred" });
    expect(before!.doctorLine.en).toContain("call 995");
    expect(before!.doctorLine.cite).toMatchObject({ visitId: visit.id, roleState: "inferred", date: visit.date });
    expect(before!.doctorLine.sourceId.startsWith(`visit:${visit.id}:`)).toBe(true);

    const [threshold] = (await store.listVisitItems(scope.id, { visit_id: visit.id })).filter((i) => i.type === "threshold");
    await confirmVisit(store, scope, visit.id, { mine: [], items: { [threshold.id]: "right" } });
    const after = await relayDoctorThreshold(store, scope, { systolic: 185, diastolic: 112 });
    expect(after!.threshold.state).toBe("confirmed");
    expect(after!.doctorLine.cite!.roleState).toBe("confirmed");
    expect(after!.doctorLine.attribution).toBe("doctor");
    expect(JSON.stringify(after)).not.toContain(scope.id);
    expect(await relayDoctorThreshold(store, scope, { systolic: 170, diastolic: 100 })).toBeNull();
  });
});
