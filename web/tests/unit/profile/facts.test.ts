/**
 * His profile and setting up (track C; M11, journey 01 建档, real-app 2.5, e2e-chains 12): who wrote each fact; a
 * family member's fact waits for his 对 / 改一下 / 不对 and moves nothing until then; the onboarding screens write his
 * settings or, while someone helps him, proposals; the example account's two buttons.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as examplePost } from "@/app/api/me/example/route";
import { PATCH as factPatch } from "@/app/api/profile/facts/[id]/route";
import { POST as factsPost } from "@/app/api/profile/facts/route";
import { POST as onboardPost } from "@/app/api/profile/onboard/route";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/profile/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { addFact, answerFamilyFact } from "@/lib/profile/facts";
import { applyOnboardAnswer, onboardHref, onboardingBy } from "@/lib/profile/onboarding";
import { profileView } from "@/lib/profile/view";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { seedAccount } from "@/lib/story/example";
import { zonedTimeToUtcMs } from "@/lib/time/clock";

const store = getMemoryStore();
const PASSWORD = "a long test password";

function req(p: string, opts: { token?: string; body?: unknown; method?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const quiet = { publish: () => {} };

async function blankAt(date = "2026-10-10", time = "09:00") {
  const t = zonedTimeToUtcMs(date, time);
  const s = new MemoryStore({ now: () => new Date(t) });
  const scope = await seedAccount(s, { userId: randomUUID(), space: "blank", nowMs: t });
  return { store: s, scope };
}

describe("facts: who wrote it, and what waits for him", () => {
  it("his own is confirmed as he writes it; a helper's and hers wait, and are not in his profile until he says 对", async () => {
    const { store: s, scope } = await blankAt();
    const own = await addFact(s, scope, { kind: "condition", text: "高血压" }, { kind: "patient" }, quiet);
    expect(own).toMatchObject({ source: "patient", confirmed_by: "patient" });
    const helper = await addFact(s, scope, { kind: "allergy", text: "青霉素" }, { kind: "helper" }, quiet);
    expect(helper).toMatchObject({ source: "family", entered_by: "family", confirmed_by: null });
    const herId = randomUUID();
    const hers = await addFact(s, scope, { kind: "condition", text: "爸爸有乙肝" }, { kind: "family", userId: herId, linkId: randomUUID(), label: "Wei Ling" }, quiet);
    expect(hers).toMatchObject({ source: "family", entered_by: "Wei Ling", entered_by_user_id: herId, confirmed_by: null });

    let view = await profileView(s, scope);
    expect(view.facts.map((f) => f.text)).toEqual(["高血压"]);
    expect(view.pending.map((f) => f.text)).toEqual(["青霉素", "爸爸有乙肝"]);

    expect(await answerFamilyFact(s, scope, hers.id, { kind: "yes" }, quiet)).toMatchObject({ ok: true, fact: { confirmed_by: "patient", source: "family" } });
    expect(await answerFamilyFact(s, scope, helper.id, { kind: "no" }, quiet)).toMatchObject({ ok: true, fact: { hidden: true } });
    view = await profileView(s, scope);
    expect(view.facts.map((f) => f.text)).toEqual(["高血压", "爸爸有乙肝"]);
    expect(view.facts.find((f) => f.text === "爸爸有乙肝")).toMatchObject({ source: "family", enteredBy: "Wei Ling", confirmed: true });
    expect(view.pending).toEqual([]);
    // an answered proposal cannot be answered again; his own fact is not a proposal
    expect(await answerFamilyFact(s, scope, hers.id, { kind: "no" }, quiet)).toEqual({ ok: false, status: 409, error: "not_pending" });
    expect(await answerFamilyFact(s, scope, own.id, { kind: "yes" }, quiet)).toEqual({ ok: false, status: 409, error: "not_pending" });
  });

  it("a routine or clinic she wrote moves nothing until he confirms; 改一下 keeps his words", async () => {
    const { store: s, scope } = await blankAt();
    const entry = { label: "Breakfast", label_zh: "早饭", days: "daily", time: "07:30" };
    const breakfast = await addFact(s, scope, { kind: "routine", text: "早饭 07:30", data: { entry } }, { kind: "helper" }, quiet);
    const clinic = await addFact(s, scope, { kind: "clinic", text: "Bedok Polyclinic" }, { kind: "helper" }, quiet);
    expect((await profileView(s, scope)).breakfast).toBeNull();
    expect((await profileView(s, scope)).reminderAt).toBe("08:45");
    const r1 = await answerFamilyFact(s, scope, breakfast.id, { kind: "yes" }, quiet);
    const after = r1.ok ? r1.scope : scope;
    expect((await profileView(s, after)).breakfast).toBe("07:30");
    expect((await profileView(s, after)).reminderAt).toBe("07:45");
    const r2 = await answerFamilyFact(s, after, clinic.id, { kind: "edit", text: "Bedok North Clinic" }, quiet);
    expect(r2).toMatchObject({ ok: true, fact: { text: "Bedok North Clinic", confirmed_by: "patient" } });
    const v = await profileView(s, r2.ok ? r2.scope : after);
    expect(v.clinic).toBe("Bedok North Clinic");
    expect(v.facts.find((f) => f.kind === "clinic")).toMatchObject({ editedByHim: true });
  });
});

describe("setting up, screen by screen", () => {
  it("his answers go into his settings and profile; skipped screens write nothing; he picks up where he left", async () => {
    const { store: s, scope: start } = await blankAt();
    expect(onboardHref(start)).toBe("/onboard/who");
    let scope: SessionRow = start;
    const step = async (a: Parameters<typeof applyOnboardAnswer>[2]) => {
      const r = await applyOnboardAnswer(s, scope, a);
      scope = r.scope;
      return r;
    };
    expect((await step({ step: "who", by: "self" })).href).toBe("/onboard/clinic");
    await step({ step: "clinic", clinic: " Blossom Family Clinic " });
    await step({ step: "breakfast", time: "8:00" });
    expect(onboardHref(scope)).toBe("/onboard/habits");
    await step({ step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" }] });
    await step({ step: "meds", choice: "later" });
    await step({ step: "age", age: 67 });
    await step({ step: "conditions", items: ["高血压", "高血压 "] });
    await step({ step: "allergies", items: null, none: true });
    await step({ step: "family", choice: "later" });
    await step({ step: "reminders", result: "later" });
    const done = await step({ step: "done" });
    expect(done).toMatchObject({ next: null, href: "/p/today" });
    expect(scope.onboarding).toBe("done");
    expect(onboardHref(scope)).toBe("/p/today");
    expect(scope.settings).toMatchObject({
      clinic: "Blossom Family Clinic",
      onboarding_by: "self",
      routine: [
        { label: "Breakfast", label_zh: "早饭", days: "daily", time: "08:00" },
        { label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" },
      ],
    });
    const v = await profileView(s, scope);
    expect(v).toMatchObject({ clinic: "Blossom Family Clinic", breakfast: "08:00", reminderAt: "08:15" });
    // every fact has its own row with where it came from: his clinic and his routine too, next to the settings
    expect(v.facts.map((f) => [f.kind, f.text, f.source, f.confirmed])).toEqual([
      ["clinic", "Blossom Family Clinic", "patient", true],
      ["routine", "早饭 · 早上 8:00", "patient", true],
      ["routine", "打太极 · 周二、周四 · 早上 7:30", "patient", true],
      ["age", "67", "patient", true],
      ["condition", "高血压", "patient", true],
      ["allergy", "没有已知的过敏", "patient", true],
    ]);
    expect(v.clinicFact).toMatchObject({ source: "patient", text: "Blossom Family Clinic" });
    expect(v.breakfastFact).toMatchObject({ source: "patient" });
    expect(v.habitFacts.map((f) => f?.source)).toEqual(["patient"]);
    expect(v.pending).toEqual([]);
  });

  it("a sign-up marked 「家人帮我操作」 decides the round: skipping the first screen keeps it, only his own choice there changes it", async () => {
    const { store: s, scope: start } = await blankAt();
    // what track A's sign-up records when 「家人帮我操作」 was chosen
    await s.addConsentRecord({ user_id: start.id, scope_id: start.id, kind: "terms_privacy", decision: "granted", version: "t", method: "signup_screen", assisted: true });
    expect(await onboardingBy(s, start)).toBe("family");
    // 「跳过」 on the first screen writes nothing about who is filling it in
    let scope = (await applyOnboardAnswer(s, start, { step: "who", by: null })).scope;
    expect(scope.settings.onboarding_by).toBeUndefined();
    scope = (await applyOnboardAnswer(s, scope, { step: "clinic", clinic: "Blossom Family Clinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "breakfast", time: "07:00" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "age", age: 67 })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "allergies", items: ["青霉素"] })).scope;
    const rows = await s.listProfileFacts(scope.id);
    expect(rows.map((f) => [f.kind, f.source, f.confirmed_by])).toEqual([
      ["clinic", "family", null],
      ["routine", "family", null],
      ["age", "family", null],
      ["allergy", "family", null],
    ]);
    expect(scope.settings.clinic).toBeUndefined();
    expect(scope.settings.routine).toBeUndefined();
    // he takes the phone and says on the first screen that he fills it in himself: from here on the facts are his
    scope = (await applyOnboardAnswer(s, scope, { step: "who", by: "self" })).scope;
    expect(await onboardingBy(s, scope)).toBe("self");
    scope = (await applyOnboardAnswer(s, scope, { step: "conditions", items: ["高血压"] })).scope;
    expect((await s.listProfileFacts(scope.id)).at(-1)).toMatchObject({ kind: "condition", source: "patient", confirmed_by: "patient" });
    // a sign-up he did himself: his own facts from the first screen on, skipped or not
    const { store: s2, scope: own } = await blankAt();
    await s2.addConsentRecord({ user_id: own.id, scope_id: own.id, kind: "terms_privacy", decision: "granted", version: "t", method: "signup_screen", assisted: false });
    const mine = (await applyOnboardAnswer(s2, (await applyOnboardAnswer(s2, own, { step: "who", by: null })).scope, { step: "age", age: 70 })).facts;
    expect(mine).toMatchObject([{ source: "patient", confirmed_by: "patient" }]);
  });

  it("while a family member fills it in for him, everything waits for his 对 and his settings stay as they were", async () => {
    const { store: s, scope: start } = await blankAt();
    let scope = (await applyOnboardAnswer(s, start, { step: "who", by: "family" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "clinic", clinic: "Blossom Family Clinic" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "breakfast", time: "07:00" })).scope;
    scope = (await applyOnboardAnswer(s, scope, { step: "conditions", items: ["糖尿病"] })).scope;
    expect(scope.settings.clinic).toBeUndefined();
    expect(scope.settings.routine).toBeUndefined();
    const v = await profileView(s, scope);
    expect(v.facts).toEqual([]);
    expect(v.pending.map((f) => [f.kind, f.text])).toEqual([
      ["clinic", "Blossom Family Clinic"],
      ["routine", "早饭 · 早上 7:00"],
      ["condition", "糖尿病"],
    ]);
    expect(v.reminderAt).toBe("08:45");
  });

  it("refuses an age, a time or a habit that is not one", async () => {
    const { store: s, scope } = await blankAt();
    await expect(applyOnboardAnswer(s, scope, { step: "age", age: 3 })).rejects.toMatchObject({ code: "age_invalid" });
    await expect(applyOnboardAnswer(s, scope, { step: "breakfast", time: "25:00" })).rejects.toMatchObject({ code: "time_invalid" });
    await expect(applyOnboardAnswer(s, scope, { step: "habits", habits: [{ label: "Walk", days: ["Funday"], time: "07:00" }] })).rejects.toMatchObject({ code: "routine_invalid" });
  });
});

describe("the routes", () => {
  let him: TestAccount;
  let her: TestAccount;
  let linkId: string;

  beforeAll(async () => {
    him = await createAccountWithSpace(store, getAuthProvider(), { login: `p${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "blank", onboarding: "started" });
    her = await createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "none" });
    const tokenHash = randomUUID().replace(/-/g, "").padEnd(64, "a");
    await store.createInvite({ patient_id: him.userId, family_label: "Wei Ling", invite_token_hash: tokenHash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    const acc = await store.acceptInvite(tokenHash, her.userId, "Wei Ling");
    linkId = acc.ok ? acc.link.id : "";
    await store.confirmLink(linkId, him.userId, true);
  });

  it("onboarding through the API, then his profile; nothing names his scope", async () => {
    const t = him.tokens.access_token;
    const post = async (body: unknown) => {
      const r = await onboardPost(req("/api/profile/onboard", { token: t, body }));
      expect(r.status).toBe(200);
      return (await r.json()) as { next: string | null; href: string };
    };
    expect((await post({ step: "who", by: "self" })).href).toBe("/onboard/clinic");
    expect((await post({ step: "clinic", clinic: "Blossom Family Clinic" })).next).toBe("breakfast");
    await post({ step: "breakfast", time: "08:30" });
    expect((await onboardPost(req("/api/profile/onboard", { token: t, body: { step: "age", age: 200 } }))).status).toBe(400);
    expect((await onboardPost(req("/api/profile/onboard", { token: t, body: { step: "nope" } }))).status).toBe(400);
    const r = await profileGet(req("/api/profile", { token: t }));
    const text = await r.text();
    expect(text).not.toContain(him.userId);
    expect(JSON.parse(text).profile).toMatchObject({ clinic: "Blossom Family Clinic", breakfast: "08:30", reminderAt: "08:45", onboarding: "started" });
    const patched = await profilePatch(req("/api/profile", { token: t, method: "PATCH", body: { breakfast: "07:45", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Sat"], time: "07:00" }] } }));
    expect(((await patched.json()) as { profile: { reminderAt: string; habits: unknown[] } }).profile).toMatchObject({ reminderAt: "08:00", habits: [{ label: "Tai chi", days: ["Sat"] }] });
  });

  it("she proposes through her link; only he answers; two phones writing at once both land", async () => {
    const proposal = await factsPost(req(`/api/profile/facts?link=${linkId}`, { token: her.tokens.access_token, body: { kind: "condition", text: "爸爸有乙肝" } }));
    expect(proposal.status).toBe(201);
    const fact = ((await proposal.json()) as { fact: { id: string; source: string; confirmed: boolean } }).fact;
    expect(fact).toMatchObject({ source: "family", confirmed: false });
    // she cannot confirm it (her link is not his own subject), nor read his profile through these routes
    expect([403, 404]).toContain((await factPatch(req(`/api/profile/facts/${fact.id}?link=${linkId}`, { token: her.tokens.access_token, method: "PATCH", body: { answer: "yes" } }), params(fact.id))).status);
    expect([403, 404]).toContain((await profileGet(req(`/api/profile?link=${linkId}`, { token: her.tokens.access_token }))).status);
    // his phone and hers at the same moment
    const [a, b] = await Promise.all([
      factsPost(req("/api/profile/facts", { token: him.tokens.access_token, body: { kind: "allergy", text: "青霉素" } })),
      factsPost(req(`/api/profile/facts?link=${linkId}`, { token: her.tokens.access_token, body: { kind: "other", text: "他喜欢早上去公园" } })),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const yes = await factPatch(req(`/api/profile/facts/${fact.id}`, { token: him.tokens.access_token, method: "PATCH", body: { answer: "yes" } }), params(fact.id));
    expect(((await yes.json()) as { fact: { confirmed: boolean } }).fact.confirmed).toBe(true);
    const view = (await (await profileGet(req("/api/profile", { token: him.tokens.access_token }))).json()) as { profile: { facts: { text: string }[]; pending: { text: string }[] } };
    expect(view.profile.facts.map((f) => f.text)).toEqual(expect.arrayContaining(["爸爸有乙肝", "青霉素"]));
    expect(view.profile.pending.map((f) => f.text)).toEqual(["他喜欢早上去公园"]);
  });

  it("the example account's two buttons: lay it out again, start from his own", async () => {
    const ex = await createAccountWithSpace(store, getAuthProvider(), { login: `e${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "example" });
    const t = ex.tokens.access_token;
    await store.addNote(ex.userId, { day: 42, text: "my note", source: "typed" });
    expect((await examplePost(req("/api/me/example", { token: t, body: { action: "dismiss_intro" } }))).status).toBe(200);
    expect((await store.getSession(ex.userId))?.settings.example_intro_dismissed).toBe(true);

    const reseed = await examplePost(req("/api/me/example", { token: t, body: { action: "reseed" } }));
    expect(await reseed.json()).toEqual({ href: "/p/today" });
    expect((await store.listNotes(ex.userId)).map((n) => n.text)).not.toContain("my note");
    expect(await store.getSession(ex.userId)).toMatchObject({ example_data: true, story_day: 42 });
    expect((await store.getSession(ex.userId))?.settings.example_intro_dismissed).toBeUndefined();

    const clear = await examplePost(req("/api/me/example", { token: t, body: { action: "clear" } }));
    expect(await clear.json()).toEqual({ href: "/onboard" });
    expect(await store.getSession(ex.userId)).toMatchObject({ example_data: false, template: "blank", onboarding: "started", story_day: 0 });
    expect(await store.listQuestions(ex.userId)).toEqual([]);
    expect((await store.listAccountEvents(ex.userId)).map((e) => e.kind)).toEqual(["example_reseeded", "example_cleared"]);
    expect((await store.listConsentRecords(ex.userId, { kind: "example_data" })).map((c) => c.decision)).toEqual(["granted", "withdrawn"]);
    // a blank account has no such buttons
    expect((await examplePost(req("/api/me/example", { token: t, body: { action: "reseed" } }))).status).toBe(409);
    expect((await examplePost(req("/api/me/example", { body: { action: "reseed" } }))).status).toBe(400);
  });
});
