/**
 * His settings and the facts about him stay in step (track C; real-app 2.5 「写在哪里」, 2.16 line 252, 2.23): his clinic
 * and each routine entry are a setting and a fact row; the first reminder of every part of the day can be set, shown
 * and asked for once; 称呼 and 语言 are changed from 「我」.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as factPatch } from "@/app/api/profile/facts/[id]/route";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/profile/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { doseDay, scopeSlotSchedule } from "@/lib/daily/cells";
import { addFact, answerFamilyFact, changeOwnFact, isShown, syncSettingFacts } from "@/lib/profile/facts";
import { hisName, saveHisName } from "@/lib/profile/identity";
import { applyOnboardAnswer } from "@/lib/profile/onboarding";
import { cleanSlotTime, reminderTimesPatch, saveSlotReminderTime, slotTimeKnown, slotTimes } from "@/lib/profile/reminder-times";
import { profileView } from "@/lib/profile/view";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { seedAccount, settingsKept } from "@/lib/story/example";
import { zonedTimeToUtcMs } from "@/lib/time/clock";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const quiet = { publish: () => {} };

function req(p: string, opts: { token?: string; body?: unknown; method?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function blankAt(date = "2026-10-10", time = "09:00") {
  const t = zonedTimeToUtcMs(date, time);
  const s = new MemoryStore({ now: () => new Date(t) });
  const scope = await seedAccount(s, { userId: randomUUID(), space: "blank", nowMs: t });
  return { store: s, scope, nowMs: t };
}

const shownFacts = async (s: MemoryStore, scope: SessionRow) => (await s.listProfileFacts(scope.id)).filter(isShown).map((f) => [f.kind, f.text, f.source]);

describe("his clinic and routine: a setting and a fact, kept in step", () => {
  it("a changed clinic, breakfast or habit replaces its fact; what he took off his week is put away", async () => {
    const { store: s, scope: start } = await blankAt();
    let scope = (await applyOnboardAnswer(s, start, { step: "clinic", clinic: "Blossom Family Clinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "breakfast", time: "08:30" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }, { label: "Market", label_zh: "去巴刹买菜", days: ["Sat"], time: "09:00" }] })).scope;
    expect(await shownFacts(s, scope)).toEqual([
      ["clinic", "Blossom Family Clinic", "patient"],
      ["routine", "早饭 · 早上 8:30", "patient"],
      ["routine", "打太极 · 周二、周四 · 早上 7:00", "patient"],
      ["routine", "去巴刹买菜 · 周六 · 早上 9:00", "patient"],
    ]);
    // the same answers again write nothing twice
    scope = (await applyOnboardAnswer(s, scope, { step: "clinic", clinic: "Blossom Family Clinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "breakfast", time: "08:30" })).scope;
    expect((await s.listProfileFacts(scope.id)).length).toBe(4);
    // a new clinic, a new breakfast time, and the week without the market
    scope = (await applyOnboardAnswer(s, scope, { step: "clinic", clinic: "Bedok Polyclinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "breakfast", time: "07:30" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }] })).scope;
    expect(await shownFacts(s, scope)).toEqual([
      ["routine", "打太极 · 周二、周四 · 早上 7:00", "patient"],
      ["clinic", "Bedok Polyclinic", "patient"],
      ["routine", "早饭 · 早上 7:30", "patient"],
    ]);
    // the earlier rows are kept for the record, not shown
    expect((await s.listProfileFacts(scope.id)).filter((f) => f.hidden === true).map((f) => f.text)).toEqual(["Blossom Family Clinic", "早饭 · 早上 8:30", "去巴刹买菜 · 周六 · 早上 9:00"]);
    expect(scope.settings).toMatchObject({ clinic: "Bedok Polyclinic", routine: [{ label: "Breakfast", time: "07:30" }, { label: "Tai chi" }] });
  });

  it("the other way round: a clinic fact he rewords or removes moves his clinic; a routine fact he removes leaves his week", async () => {
    const { store: s, scope: start } = await blankAt();
    let scope = (await applyOnboardAnswer(s, start, { step: "clinic", clinic: "Blossom Family Clinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue"], time: "07:00" }] })).scope;
    const [clinic, taiChi] = await s.listProfileFacts(scope.id);
    const reworded = await changeOwnFact(s, scope, clinic.id, { text: "Blossom Clinic (Toa Payoh)" }, quiet);
    expect(reworded.ok && reworded.scope.settings.clinic).toBe("Blossom Clinic (Toa Payoh)");
    scope = reworded.ok ? reworded.scope : scope;
    const off = await changeOwnFact(s, scope, taiChi.id, { hidden: true }, quiet);
    expect(off.ok && off.scope.settings.routine).toEqual([]);
    scope = off.ok ? off.scope : scope;
    const gone = await changeOwnFact(s, scope, clinic.id, { hidden: true }, quiet);
    expect(gone.ok && gone.scope.settings.clinic).toBeNull();
    expect((await profileView(s, gone.ok ? gone.scope : scope)).clinic).toBeNull();
  });

  it("his 对 to a family member's breakfast replaces the one he wrote, and the row says who wrote it", async () => {
    const { store: s, scope: start } = await blankAt();
    let scope = (await applyOnboardAnswer(s, start, { step: "breakfast", time: "08:30" })).scope;
    scope = await s.updateScope(scope.id, { settings: { reminder_time: "09:10" } });
    const entry = { label: "Breakfast", label_zh: "早饭", days: "daily", time: "07:30" };
    const hers = await addFact(s, scope, { kind: "routine", text: "早饭 · 早上 7:30", data: { entry } }, { kind: "helper" }, quiet);
    const yes = await answerFamilyFact(s, scope, hers.id, { kind: "yes" }, quiet);
    scope = yes.ok ? yes.scope : scope;
    expect(await shownFacts(s, scope)).toEqual([["routine", "早饭 · 早上 7:30", "family"]]);
    const v = await profileView(s, scope);
    expect(v.breakfastFact).toMatchObject({ source: "family", confirmed: true });
    // the morning reminder follows the new breakfast (the time he had set by hand no longer holds)
    expect(v.reminderAt).toBe("07:45");
  });

  it("settings written before facts had rows are given their rows the next time he changes one", async () => {
    const { store: s, scope: start } = await blankAt();
    const scope = await s.updateScope(start.id, { settings: { clinic: "Old Clinic", routine: [{ label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:00" }] } });
    expect(await s.listProfileFacts(scope.id)).toEqual([]);
    const added = await syncSettingFacts(s, scope, quiet);
    expect(added.map((f) => [f.kind, f.text, f.source, f.confirmed_by])).toEqual([
      ["clinic", "Old Clinic", "patient", "patient"],
      ["routine", "早饭 · 早上 8:00", "patient", "patient"],
    ]);
    expect(await syncSettingFacts(s, scope, quiet)).toEqual([]);
  });
});

describe("when each part of the day is reminded", () => {
  it("a time must be a time and lie in its part of the day", () => {
    expect(cleanSlotTime("midday", "12:10")).toBe("12:10");
    expect(cleanSlotTime("morning", "8:05")).toBe("08:05");
    expect(() => cleanSlotTime("midday", "25:00")).toThrowError(expect.objectContaining({ code: "time_invalid" }));
    expect(() => cleanSlotTime("midday", "18:00")).toThrowError(expect.objectContaining({ code: "time_out_of_range" }));
    expect(() => cleanSlotTime("night", "23:30")).toThrowError(expect.objectContaining({ code: "time_out_of_range" }));
    expect(() => cleanSlotTime("morning", "12:00")).toThrowError(expect.objectContaining({ code: "time_out_of_range" }));
  });

  it("saving one part's time moves that part only; null gives it back to his routine or the app", async () => {
    const { store: s, scope: start } = await blankAt();
    expect(slotTimes(start)).toEqual([
      { slot: "morning", first: "08:45", second: "09:15", source: "app" },
      { slot: "midday", first: "12:45", second: "13:15", source: "app" },
      { slot: "evening", first: "18:45", second: "19:15", source: "app" },
      { slot: "night", first: "21:30", second: "22:00", source: "app" },
    ]);
    expect(slotTimeKnown(start, "midday")).toBe(false);
    let scope = await saveSlotReminderTime(s, start, "midday", "12:10");
    scope = await saveSlotReminderTime(s, scope, "night", "21:00");
    expect(scope.settings.reminder_times).toEqual({ midday: "12:10", night: "21:00" });
    expect(slotTimeKnown(scope, "midday")).toBe(true);
    expect(slotTimeKnown(scope, "evening")).toBe(false);
    expect(scopeSlotSchedule(scope, "midday")).toEqual({ first: "12:10", second: "12:40", closes: "13:10" });
    expect(slotTimes(scope).map((t) => [t.slot, t.first, t.source])).toEqual([
      ["morning", "08:45", "app"],
      ["midday", "12:10", "own"],
      ["evening", "18:45", "app"],
      ["night", "21:00", "own"],
    ]);
    // the morning's own time lives where the app has always read it
    scope = await saveSlotReminderTime(s, scope, "morning", "08:00");
    expect(scope.settings.reminder_time).toBe("08:00");
    expect(scope.settings.reminder_times).toEqual({ midday: "12:10", night: "21:00" });
    expect((await profileView(s, scope)).reminderAt).toBe("08:00");
    scope = await saveSlotReminderTime(s, scope, "midday", null);
    scope = await saveSlotReminderTime(s, scope, "morning", null);
    expect(scope.settings.reminder_times).toEqual({ night: "21:00" });
    expect(slotTimes(scope).map((t) => [t.slot, t.first, t.source]).slice(0, 2)).toEqual([
      ["morning", "08:45", "app"],
      ["midday", "12:45", "app"],
    ]);
    await expect(saveSlotReminderTime(s, scope, "evening", "09:00")).rejects.toMatchObject({ code: "time_out_of_range" });
    expect(() => reminderTimesPatch(scope, { midday: "12:00", evening: "nope" })).toThrowError(expect.objectContaining({ code: "time_invalid" }));
    // a meal he has in his routine also says when: breakfast for the morning, a daily lunch for midday
    scope = await s.updateScope(scope.id, { settings: { routine: [{ label: "Lunch", label_zh: "午饭", days: "daily", time: "12:00" }] } });
    expect(slotTimeKnown(scope, "midday")).toBe(true);
    expect(slotTimes(scope)[1]).toEqual({ slot: "midday", first: "12:15", second: "12:45", source: "routine" });
  });

  it("a medicine's cell in that part of the day is reminded at the time he set", async () => {
    const { store: s, scope: start, nowMs } = await blankAt("2026-10-10", "09:00");
    await s.upsertMed(start.id, { id: "m1", drug_id: "metformin", origin: "prescription", status: "label_confirmed", start_day: 0, dose_slots: ["midday"], dose_slots_source: "patient", label: null });
    const before = await doseDay(s, start, 0, nowMs);
    expect(before.map((d) => [d.slot, d.schedule.first])).toEqual([["midday", "12:45"]]);
    const scope = await saveSlotReminderTime(s, start, "midday", "13:30");
    const after = await doseDay(s, scope, 0, nowMs);
    expect(after.map((d) => [d.slot, d.schedule.first, d.schedule.second, d.schedule.closes])).toEqual([["midday", "13:30", "14:00", "14:30"]]);
  });

  it("a reseed or a clear takes the times and the round's helper with the old timeline", () => {
    expect(settingsKept({ locale: "en", reminder_times: { midday: "12:10" }, onboarding_by: "family", push_prefs: { a: 1 } })).toEqual({ locale: "en", push_prefs: { a: 1 } });
  });
});

describe("the profile API: times, 称呼, 语言", () => {
  let him: TestAccount;

  beforeAll(async () => {
    him = await createAccountWithSpace(store, getAuthProvider(), { login: `t${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "blank", display_name: "陈先生", locale: "zh-Hans" });
  });

  const patch = (body: unknown) => profilePatch(req("/api/profile", { token: him.tokens.access_token, method: "PATCH", body }));

  it("accepts and validates the other parts' times; a refused time writes nothing", async () => {
    const ok = await patch({ reminder_times: { midday: "12:20", evening: "18:00" } });
    expect(ok.status).toBe(200);
    const slots = ((await ok.json()) as { profile: { slots: { slot: string; first: string; source: string }[] } }).profile.slots;
    expect(slots.map((t) => [t.slot, t.first, t.source])).toEqual([
      ["morning", "08:45", "app"],
      ["midday", "12:20", "own"],
      ["evening", "18:00", "own"],
      ["night", "21:30", "app"],
    ]);
    const bad = await patch({ clinic: "Should not be saved", reminder_times: { night: "03:00" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "time_out_of_range" });
    expect((await store.getSession(him.userId))?.settings.clinic).toBeUndefined();
    expect((await patch({ reminder_times: { lunch: "12:00" } })).status).toBe(400);
    const cleared = await patch({ reminder_times: { evening: null }, reminder_time: "08:10" });
    expect((await store.getSession(him.userId))?.settings.reminder_time).toBe("08:10");
    expect((await store.getSession(him.userId))?.settings.reminder_times).toEqual({ midday: "12:20" });
    expect(((await cleared.json()) as { profile: { reminderAt: string } }).profile.reminderAt).toBe("08:10");
    // a new breakfast time takes the morning reminder with it
    const moved = await patch({ breakfast: "07:00" });
    expect(((await moved.json()) as { profile: { reminderAt: string } }).profile.reminderAt).toBe("07:15");
  });

  it("his clinic through the API is a setting and his own fact; removing the fact clears the setting", async () => {
    const r = await patch({ clinic: "Blossom Family Clinic" });
    const p = ((await r.json()) as { profile: { clinic: string; clinicFact: { id: string; source: string } | null } }).profile;
    expect(p).toMatchObject({ clinic: "Blossom Family Clinic", clinicFact: { source: "patient" } });
    const gone = await factPatch(req(`/api/profile/facts/${p.clinicFact!.id}`, { token: him.tokens.access_token, method: "PATCH", body: { hidden: true } }), params(p.clinicFact!.id));
    expect(gone.status).toBe(200);
    const after = (await (await profileGet(req("/api/profile", { token: him.tokens.access_token }))).json()) as { profile: { clinic: string | null; clinicFact: unknown } };
    expect(after.profile).toMatchObject({ clinic: null, clinicFact: null });
  });

  it("称呼: his account's name and his profile's name fact; 语言: his account, his space, this browser", async () => {
    const scope = (await store.getSession(him.userId))!;
    expect(await hisName(store, scope)).toBe("陈先生");
    const r = await patch({ name: "  陈伯伯 " });
    expect(await r.json()).toMatchObject({ name: "陈伯伯", profile: { name: "陈伯伯" } });
    expect((await store.getAccount(him.userId))?.display_name).toBe("陈伯伯");
    expect((await store.listProfileFacts(him.userId)).filter((f) => f.kind === "name" && isShown(f)).map((f) => [f.text, f.source])).toEqual([["陈伯伯", "patient"]]);
    await saveHisName(store, scope, "Mr Tan");
    expect((await store.listProfileFacts(him.userId)).filter((f) => f.kind === "name" && isShown(f)).map((f) => f.text)).toEqual(["Mr Tan"]);
    expect((await patch({ name: "   " })).status).toBe(400);
    expect((await patch({ name: "x".repeat(41) })).status).toBe(400);

    const lang = await patch({ locale: "en" });
    expect(lang.status).toBe(200);
    expect(lang.headers.get("set-cookie")).toContain("rp_lang=en");
    expect((await store.getAccount(him.userId))?.locale).toBe("en");
    expect((await store.getSession(him.userId))?.settings.locale).toBe("en");
    expect((await patch({ locale: "fr" })).status).toBe(400);
  });

  it("on the example account the profile is Mr Tan's: only his own account's name changes", async () => {
    const ex = await createAccountWithSpace(store, getAuthProvider(), { login: `x${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "example", display_name: "评委" });
    const r = await profilePatch(req("/api/profile", { token: ex.tokens.access_token, method: "PATCH", body: { name: "Judge Lee" } }));
    expect(await r.json()).toMatchObject({ name: "Judge Lee", profile: { name: "陈先生（示例）" } });
  });
});
