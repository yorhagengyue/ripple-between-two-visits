/**
 * When a medicine gets a time of day on an account, and who decided it (docs/plan/real-app.md 8.7 「单元 meds/slots」, line
 * 1496: 「「每天早上」定一格，标「药袋上写着」；「once daily」要他选，标「你选的时间」；模型的输出不影响格子。」; 2.16, line 248: 「没有时间词时，由他自己选
 * 「早上 / 中午 / 晚上 / 睡前」，标「你选的时间」」). This file guards the middle and the last part, which had no test:
 *
 *   - a label that says how often but not when ("once daily", 每天一次, 每日一次) gives the medicine NO time of day by
 *     itself: nothing is stored (dose_slots null, dose_slots_source null), no cell exists on any day, the minute job
 *     sends no reminder and settles no "no reply", and Today lists the medicine as one he still has to say the time for;
 *   - when he says the time (POST /api/doses/slots afterwards, or `slots` while confirming the label, POST /api/meds),
 *     the slot is the one he chose and it is marked as his: dose_slots_source "patient", the medicine page's
 *     「晚上吃 · 你选的时间」, Today's tag 「你选的时间」; reminders start with the next window after his choice;
 *   - 「每天早上」 / "every MORNING" gives the morning slot, marked as the label's (dose_slots_source "label", 「早上吃 · 药袋上
 *     写着」), and his `slots` in the same request do not change it;
 *   - whatever the label reader's model says about a time of day changes none of this. The model has no field for a
 *     slot: its transcription and its field read (lib/vision) go through lib/meds/parse-label.ts and the closed word
 *     table of lib/daily/slots.ts. The stubbed model here claims "evening" or "morning" in every place it can write
 *     (extra keys in the field-read JSON, a longer directions line in the field read, a comment line in the
 *     transcription); the once-daily medicine still has no slot until he chooses, and the every-morning one is still
 *     the morning's. A transcription whose dosing line the field read does not confirm is refused whole.
 *
 * How: the label reader's model is a stub LlmClient handed to readLabel (lib/meds/write.ts) the way
 * tests/unit/meds/account-round2.test.ts does; the confirmation and his choice go through the real route handlers with
 * his rp_at cookie; the cells, the job and the screens' data are read with the functions the pages use. Blank accounts,
 * the developer test clock frozen. tests/unit/meds/account-meds.test.ts has "every MORNING" from the sample photo
 * (slot morning, source label) and a changed directions line with his choice; tests/unit/daily/account-routes.test.ts
 * has POST /api/doses/slots for "twice daily".
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as slotsPost } from "@/app/api/doses/slots/route";
import { POST as medsPost } from "@/app/api/meds/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { blobPrefix, createLocalBlobStore, type BlobStore } from "@/lib/blob";
import { accountToday } from "@/lib/daily/account-today";
import { doseDay, medsWithoutSlot } from "@/lib/daily/cells";
import { runDoseDay } from "@/lib/daily/dose-run";
import { dt } from "@/lib/daily/i18n";
import { doseSlotsOf, slotsFromLabel } from "@/lib/daily/slots";
import { todayDoseData } from "@/lib/daily/today-view";
import type { Notice } from "@/lib/jobs/notify";
import type { ChatOpts, LlmClient } from "@/lib/llm/types";
import { mx, slotWords } from "@/lib/meds/account-copy";
import { buildMedCardView } from "@/lib/meds/card";
import type { LabelReadResponse, StoredLabel } from "@/lib/meds/types";
import { readLabel, type MedsDeps } from "@/lib/meds/write";
import { getMemoryStore } from "@/lib/store/memory";
import type { MedicationRow, SessionRow } from "@/lib/store/types";
import { setTestClock } from "@/lib/time/now";
import { labelPng } from "./helpers";

const store = getMemoryStore();
let dir: string;
let blob: BlobStore;
const saved = { ...process.env };
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-g-once-daily-"));
  blob = createLocalBlobStore({ dir });
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => setTestClock(null));

function setClock(iso: string): number {
  setTestClock({ at: iso, frozen: true });
  return Date.parse(iso);
}

/** A blank account laid out on Mon 12 Oct 2026 at 07:00 Singapore time (day 0 is that day). */
async function account(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setClock(SGT("2026-10-12", "07:00"));
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `od${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  return { a, scope: (await store.getSession(a.scope!.id))! };
}
const scopeNow = async (a: TestAccount) => (await store.getSession(a.scope!.id))!;

function req(p: string, token: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers: { cookie: `rp_at=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

interface Reading {
  /** the medicine line as printed */
  medicine: string;
  /** the dosing line as printed */
  directions: string;
  /** what the model adds to its field-read JSON besides the four fields it is asked for */
  claims?: Record<string, unknown>;
  /** the dosing line as the field read gives it, when the model makes it say more than the transcription */
  fieldDirections?: string;
  /** lines the model adds to its transcription */
  comments?: string[];
}

/** Everything a model could say about a time of day, for the slot it argues for. */
const claiming = (slot: "morning" | "evening") => ({
  slot,
  slots: [slot],
  dose_slots: [slot],
  dose_slots_source: "label",
  time: slot,
  time_of_day: slot,
  when: slot === "evening" ? "晚上" : "早上",
  reminder_time: slot === "evening" ? "18:45" : "08:45",
  frequency: "once_daily",
});

/** The label reader with a stand-in model (lib/vision's model path): it transcribes and reports what `r` says. */
function reader(r: Reading): { deps: MedsDeps; calls: ChatOpts[] } {
  const calls: ChatOpts[] = [];
  const llm = {
    provider: "fake",
    model: "fake-vision",
    async chat(opts: ChatOpts) {
      calls.push(opts);
      if (opts.json) return { content: JSON.stringify({ medicine: r.medicine, directions: r.fieldDirections ?? r.directions, date: null, clinic: null, ...(r.claims ?? {}) }), tokens: 1 };
      return { content: [r.medicine, r.directions, ...(r.comments ?? [])].join("\n"), tokens: 1 };
    },
  } as unknown as LlmClient;
  return { calls, deps: { store, blob, vision: { llm }, ask: { costGuard: null, checker: null, checkerReason: "unit test" } } };
}

/** He photographs a bag (any picture: the stub decides what is on it) and the label is read. */
async function read(scope: SessionRow, r: Reading): Promise<LabelReadResponse> {
  const p = `${blobPrefix(scope)}/labels/bag-${randomUUID().slice(0, 8)}.png`;
  await blob.putObject("labels", p, labelPng("amlodipine"), "image/png");
  const { deps, calls } = reader(r);
  const out = await readLabel({ sessionId: scope.id, path: p }, deps);
  expect(calls).toHaveLength(2); // the model was asked: the transcription and the field read
  return out;
}

/** He ticks every line of the label as right (POST /api/meds, the real route). */
async function confirm(a: TestAccount, got: LabelReadResponse, more: Record<string, unknown> = {}): Promise<MedicationRow> {
  const res = await medsPost(req("/api/meds", a.tokens.access_token, { read_token: got.read_token, confirmed: ["drug_text", "strength", "directions"], origin: "prescription", locale: "zh-Hans", ...more }));
  const text = await res.text();
  expect(res.status, text).toBe(201);
  const body = JSON.parse(text) as { med: MedicationRow; outcome: string };
  expect(body.outcome).toBe("label_confirmed");
  return body.med;
}

function collect(): { sent: Notice[]; send: (n: Notice) => Promise<{ sent: number }> } {
  const sent: Notice[] = [];
  return { sent, send: async (n) => (sent.push(n), { sent: 1 }) };
}

/** The mark on the medicine's own page (components/meds/elder/pages.tsx picks the words from card.slots this way). */
async function cardLine(scope: SessionRow, med: MedicationRow): Promise<string> {
  const card = await buildMedCardView(store, scope.id, med, { day: scope.story_day, locale: "zh-Hans" });
  const s = card.slots;
  return s?.slots.length ? mx("zh-Hans", s.source === "label" ? "card.slots.label" : "card.slots.patient", { slots: slotWords("zh-Hans", s.slots) }) : mx("zh-Hans", "card.slots.none");
}

const ONCE_DAILY: { name: string; reading: Reading }[] = [
  { name: "once daily", reading: { medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet once daily" } },
  { name: "ONCE A DAY", reading: { medicine: "AMLODIPINE 5MG TABLET", directions: "Take 1 tablet ONCE A DAY" } },
  { name: "每天一次", reading: { medicine: "AMLODIPINE 5MG TABLET", directions: "每天一次，每次一粒" } },
  { name: "每日一次", reading: { medicine: "AMLODIPINE 5MG TABLET", directions: "每日一次，每次一粒" } },
];

describe("the closed word table (lib/daily/slots.ts): how often is not when", () => {
  it("once daily / 每天一次 / 每日一次 name no slot; 每天早上 / every morning name the morning", () => {
    for (const { reading } of ONCE_DAILY) expect(slotsFromLabel(reading.directions), reading.directions).toBeNull();
    for (const words of ["Take 1 tablet daily", "OD", "一天一次，一次一片", "Take ONE tablet once daily with or after food"]) expect(slotsFromLabel(words), words).toBeNull();
    for (const words of ["每天早上吃一粒", "Take ONE tablet every MORNING", "早饭后一粒", "Take 1 tablet once daily in the morning"]) expect(slotsFromLabel(words), words).toEqual(["morning"]);
  });
});

describe("a label that says once daily and no time of day", () => {
  it.each(ONCE_DAILY)("「$name」: no slot by itself, nothing scheduled, no reminder and no 'no reply' on any day until he chooses", async ({ reading }) => {
    const { a, scope } = await account();
    const got = await read(scope, reading);
    // the label was understood (it is the medicine, with its dosing line), and the flow is told he has to choose
    expect(got.fields).toMatchObject({ drug_id: "amlodipine", directions: reading.directions });
    expect(got.fields.slots).toMatchObject({ frequency: "once_daily" });
    expect(got.fields.slots?.time).toBeUndefined();
    expect(got.dose_slots).toBeNull();

    const med = await confirm(a, got);
    expect(med).toMatchObject({ id: "med-amlodipine", status: "label_confirmed", origin: "prescription", start_day: 0, start_at: "2026-10-11T23:00:00.000Z" });
    expect(med.dose_slots ?? null).toBeNull();
    expect(med.dose_slots_source ?? null).toBeNull();
    const stored = (await store.getMed(scope.id, med.id))!;
    expect(stored.dose_slots ?? null).toBeNull();
    expect(stored.dose_slots_source ?? null).toBeNull();
    expect((stored.label as StoredLabel).directions).toBe(reading.directions);
    expect(doseSlotsOf(scope, stored)).toEqual({ slots: [], source: null });
    expect(await cardLine(scope, stored)).toBe("尚未设定服药时间");

    // three days go by, the minute job runs through every reminder stretch of every part of the day
    const out = collect();
    for (const date of ["2026-10-12", "2026-10-13", "2026-10-14"]) {
      for (const hhmm of ["08:45", "09:15", "09:46", "12:45", "13:50", "18:45", "19:50", "21:30", "22:40"]) {
        const now = setClock(SGT(date, hhmm));
        const s = await scopeNow(a);
        expect(await runDoseDay(store, s, now, { send: out.send }), `${date} ${hhmm}`).toEqual({ settled: 0, first: 0, second: 0, family: 0, sent: 0 });
        expect(await doseDay(store, s, s.story_day, now), `${date} ${hhmm}`).toEqual([]);
      }
    }
    expect(out.sent).toEqual([]);
    expect(await store.listDeliveries(scope.id, {})).toEqual([]);
    expect(await store.listDoses(scope.id)).toEqual([]);
    // Today knows the medicine and that it waits for his choice
    const now = setClock(SGT("2026-10-14", "22:40"));
    const s = await scopeNow(a);
    expect(s.story_day).toBe(2);
    expect(medsWithoutSlot(s, await store.listMeds(s.id), s.story_day).map((m) => m.id)).toEqual(["med-amlodipine"]);
    const today = todayDoseData(await accountToday(store, s, now, {}, "zh-Hans"), "zh-Hans", "Asia/Singapore");
    expect(today).toMatchObject({ focus: null, others: [], yesterday: [], noMeds: false, noSlot: [{ id: "med-amlodipine", name: "Amlodipine" }] });
  });

  it("he chooses 晚上 afterwards (POST /api/doses/slots): the slot is his choice, marked 「你选的时间」, and reminders start with the next window", async () => {
    const { a, scope } = await account();
    const med = await confirm(a, await read(scope, ONCE_DAILY[0].reading));
    expect(med.dose_slots ?? null).toBeNull();

    // the next day at 19:00, between that evening's first reminder (18:45) and its second (19:15)
    let now = setClock(SGT("2026-10-13", "19:00"));
    const res = await slotsPost(req("/api/doses/slots", a.tokens.access_token, { medication_id: med.id, slots: ["evening"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ medication: { id: "med-amlodipine", dose_slots: ["evening"], dose_slots_source: "patient" } });
    const chosen = (await store.getMed(scope.id, med.id))!;
    expect(chosen).toMatchObject({ dose_slots: ["evening"], dose_slots_source: "patient", start_at: "2026-10-13T11:00:00.000Z" });
    let s = await scopeNow(a);
    expect(doseSlotsOf(s, chosen)).toEqual({ slots: ["evening"], source: "patient" });
    expect(await cardLine(s, chosen)).toBe("晚间服用 · 你选的时间");
    expect(medsWithoutSlot(s, [chosen], s.story_day)).toEqual([]);

    // no cell for the evening he chose in (its first reminder came before his choice), none for the days before
    const out = collect();
    expect(await doseDay(store, s, s.story_day, now)).toEqual([]);
    expect(await runDoseDay(store, s, now, { send: out.send })).toEqual({ settled: 0, first: 0, second: 0, family: 0, sent: 0 });
    now = setClock(SGT("2026-10-13", "19:50"));
    expect(await runDoseDay(store, await scopeNow(a), now, { send: out.send })).toEqual({ settled: 0, first: 0, second: 0, family: 0, sent: 0 });
    expect(await store.listDoses(scope.id)).toEqual([]);

    // the next evening is his: one cell in the evening slot, asked at 18:45, tagged as the time he chose
    now = setClock(SGT("2026-10-14", "18:45"));
    s = await scopeNow(a);
    const day = await doseDay(store, s, s.story_day, now);
    expect(day.map((d) => [d.slot, d.schedule.first, d.phase, d.cells.map((c) => [c.medicationId, c.slotSource, c.tracked])])).toEqual([["evening", "18:45", "first", [["med-amlodipine", "patient", true]]]]);
    const today = todayDoseData(await accountToday(store, s, now, {}, "zh-Hans"), "zh-Hans", "Asia/Singapore");
    expect(today.noSlot).toEqual([]);
    expect(today.focus?.slot).toMatchObject({ slot: "evening", meds: [{ medicationId: "med-amlodipine", slotChosen: true, labelWords: "Take ONE tablet once daily" }] });
    expect(dt("zh-Hans", "today.slotChosen")).toBe("你选的时间");
    expect(await runDoseDay(store, s, now, { send: out.send })).toEqual({ settled: 0, first: 1, second: 0, family: 0, sent: 1 });
    expect(out.sent.map((n) => [n.kind, n.url])).toEqual([["dose_first", "/p/today?remind=dose-evening"]]);
    expect((await store.listDeliveries(scope.id, {})).map((d) => [d.kind, d.day, d.slot])).toEqual([["dose_first", 2, "evening"]]);
  });

  it("he chooses while confirming the label (POST /api/meds with slots): his choice, marked as his", async () => {
    const { a, scope } = await account();
    const med = await confirm(a, await read(scope, ONCE_DAILY[2].reading), { slots: ["night", "morning"] });
    expect(med).toMatchObject({ dose_slots: ["morning", "night"], dose_slots_source: "patient" });
    expect(await cardLine(scope, med)).toBe("早间、睡前服用 · 你选的时间");
    // confirmed at 07:00: this morning's 08:45 is the first reminder after his choice
    const now = setClock(SGT("2026-10-12", "08:45"));
    const s = await scopeNow(a);
    const day = await doseDay(store, s, s.story_day, now);
    expect(day.map((d) => [d.slot, d.cells.map((c) => c.slotSource)])).toEqual([
      ["morning", ["patient"]],
      ["night", ["patient"]],
    ]);
    const today = todayDoseData(await accountToday(store, s, now, {}, "zh-Hans"), "zh-Hans", "Asia/Singapore");
    expect(today.focus?.slot.meds[0]).toMatchObject({ slotChosen: true });
  });
});

describe("a label that says every morning", () => {
  it.each([
    { name: "every MORNING", directions: "Take ONE tablet every MORNING" },
    { name: "每天早上", directions: "每天早上吃一粒" },
  ])("「$name」: the morning slot, marked 「药袋上写着」; his slots in the same request do not change it", async ({ directions }) => {
    const { a, scope } = await account();
    const got = await read(scope, { medicine: "AMLODIPINE 5MG TABLET", directions });
    expect(got.dose_slots).toEqual(["morning"]);
    const med = await confirm(a, got, { slots: ["evening"] });
    expect(med).toMatchObject({ dose_slots: ["morning"], dose_slots_source: "label" });
    expect(await cardLine(scope, med)).toBe("早间服用 · 依药品标签");
    const now = setClock(SGT("2026-10-12", "08:45"));
    const s = await scopeNow(a);
    const day = await doseDay(store, s, s.story_day, now);
    expect(day.map((d) => [d.slot, d.cells.map((c) => [c.slotSource, c.labelWords])])).toEqual([["morning", [["label", directions]]]]);
    const today = todayDoseData(await accountToday(store, s, now, {}, "zh-Hans"), "zh-Hans", "Asia/Singapore");
    expect(today.focus?.slot.meds[0]).toMatchObject({ slotChosen: false, labelWords: directions });
    expect(today.noSlot).toEqual([]);
  });
});

describe("the model's output does not set the slot", () => {
  it.each(["evening", "morning"] as const)("once daily, and the model claims %s everywhere it can write: still no slot until he chooses", async (slot) => {
    const { a, scope } = await account();
    const word = slot === "evening" ? "EVENING" : "MORNING";
    const got = await read(scope, {
      medicine: "AMLODIPINE 5MG TABLET",
      directions: "Take ONE tablet once daily",
      claims: claiming(slot),
      // the field read says more than the label does (lib/vision/check.ts accepts a reading that contains the other)
      fieldDirections: `Take ONE tablet once daily (${word})`,
      comments: [`Suggested time: ${word}`, `Reminder slot = ${slot}`, slot === "evening" ? "建议晚上吃" : "建议早上吃"],
    });
    // what he is asked to confirm is the transcription's dosing line, and the flow is told he has to choose
    expect(got.fields).toMatchObject({ drug_id: "amlodipine", directions: "Take ONE tablet once daily" });
    expect(got.fields.slots?.time).toBeUndefined();
    expect(got.dose_slots).toBeNull();
    expect(JSON.stringify(got)).not.toMatch(/evening|EVENING|morning|MORNING|晚上|早上/);
    const med = await confirm(a, got);
    expect(med.dose_slots ?? null).toBeNull();
    expect(med.dose_slots_source ?? null).toBeNull();
    expect(doseSlotsOf(scope, med)).toEqual({ slots: [], source: null });
    const out = collect();
    for (const hhmm of ["08:45", "09:46", "18:45", "19:50"]) {
      const now = setClock(SGT("2026-10-13", hhmm));
      const s = await scopeNow(a);
      expect(await doseDay(store, s, s.story_day, now), hhmm).toEqual([]);
      expect(await runDoseDay(store, s, now, { send: out.send }), hhmm).toEqual({ settled: 0, first: 0, second: 0, family: 0, sent: 0 });
    }
    expect(out.sent).toEqual([]);
    // he chooses the other part of the day than the model argued for: his choice stands, marked as his
    const his = slot === "evening" ? "morning" : "evening";
    setClock(SGT("2026-10-13", "20:00"));
    const res = await slotsPost(req("/api/doses/slots", a.tokens.access_token, { medication_id: med.id, slots: [his] }));
    expect(await res.json()).toEqual({ medication: { id: med.id, dose_slots: [his], dose_slots_source: "patient" } });
  });

  it("every morning, and the model claims evening: the morning slot from the label's words, marked as the label's", async () => {
    const { a, scope } = await account();
    const got = await read(scope, { medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every MORNING", claims: claiming("evening"), comments: ["Suggested time: EVENING", "建议晚上吃"] });
    expect(got.dose_slots).toEqual(["morning"]);
    const med = await confirm(a, got);
    expect(med).toMatchObject({ dose_slots: ["morning"], dose_slots_source: "label" });
    expect(await cardLine(scope, med)).toBe("早间服用 · 依药品标签");
  });

  it("a dosing line with a time of day that the model's own field read does not confirm: the photo is refused, nothing is offered", async () => {
    const { scope } = await account();
    await expect(read(scope, { medicine: "AMLODIPINE 5MG TABLET", directions: "Take ONE tablet every EVENING", fieldDirections: "Take ONE tablet once daily" })).rejects.toMatchObject({ code: "label_unreadable", detail: { code: "reads_disagree" } });
    expect(await store.listMeds(scope.id)).toEqual([]);
  });
});
