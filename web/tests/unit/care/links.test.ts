/**
 * Family links on real accounts (C2 track D; real-app 8.5 「单元 care/links」, no-write-on-read, events-route): the
 * invitation's token (hash only, one use, 7 days), accepting (not yourself, not twice), his confirmation before she sees
 * anything, his switches per link with versions, history and consent records, stopping and leaving, her stream closing
 * on her link's end, and her reads writing nothing of his.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { DELETE as cancelDelete } from "@/app/api/family/invites/[id]/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { GET as accessGet } from "@/app/api/family/links/[id]/access/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { GET as grantsGet, POST as grantsPost } from "@/app/api/family/links/[id]/grants/route";
import { POST as leavePost } from "@/app/api/family/links/[id]/leave/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { GET as linksGet } from "@/app/api/family/links/route";
import { GET as sharedGet } from "@/app/api/family/shared/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { GET as weekGet } from "@/app/api/family/week/route";
import { GET as demoGrantsGet } from "@/app/api/family/grants/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { publish } from "@/lib/bus";
import { hashToken, newInviteToken, tokenLinkId, tokenMatches } from "@/lib/care/tokens";
import type { FamilyHomeData } from "@/lib/care/home-types";
import type { PatientLinkView } from "@/lib/care/types";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();
const decoder = new TextDecoder();
const PASSWORD = "a long test password";
const savedEnv = { ...process.env };
let blobDir: string;

beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-care-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
async function account(space: "example" | "blank" | "none", display = "Wei Ling"): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: PASSWORD, space, display_name: display });
}

function req(p: string, opts: { token?: string; body?: unknown; method?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `rp_at=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const t = (a: TestAccount) => a.tokens.access_token;

async function invite(him: TestAccount, label = "Wei Ling"): Promise<{ id: string; token: string; body: { link: PatientLinkView; path: string } }> {
  const res = await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: label, relation: "daughter", patient_label: "爸爸" } }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { link: PatientLinkView; path: string };
  const token = body.path.replace(/^\/invite\//, "");
  return { id: body.link.id, token, body };
}

async function linked(him: TestAccount, her: TestAccount): Promise<string> {
  const inv = await invite(him);
  expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }))).status).toBe(200);
  expect((await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(him), body: { yes: true } }), params(inv.id))).status).toBe(200);
  return inv.id;
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before "${needle}"; got: ${text}`);
    text += decoder.decode(value);
  }
  return text;
}

describe("the invitation token", () => {
  it("carries the link id, is 32 random bytes, and only its sha256 is stored", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(tokenLinkId(a.token)).toBe(a.linkId);
    expect(a.token.split(".")[1]).toHaveLength(43);
    expect(a.hash).toBe(hashToken(a.token));
    expect(tokenMatches(a.token, a.hash)).toBe(true);
    expect(tokenMatches(a.token, b.hash)).toBe(false);
    expect(tokenMatches(`${a.linkId}.${b.token.split(".")[1]}`, a.hash)).toBe(false);
    expect(tokenMatches(a.token, null)).toBe(false);
    expect(tokenLinkId("not-a-token")).toBeNull();
  });
});

describe("invite, accept, confirm", () => {
  let him: TestAccount;
  let her: TestAccount;
  beforeAll(async () => {
    him = await account("example", "陈先生");
    her = await account("none");
  });

  it("he invites: a 7-day one-time link, every switch off; the answer never holds the hash", async () => {
    const inv = await invite(him);
    expect(inv.body.link).toMatchObject({ state: "invited", familyLabel: "Wei Ling", relation: "daughter", patientLabel: "爸爸", her: null, version: 1 });
    expect(Object.values(inv.body.link.items).every((v) => v === false)).toBe(true);
    const row = await store.getCareLink(inv.id);
    expect(row?.invite_token_hash).toBe(hashToken(inv.token));
    expect(JSON.stringify(inv.body)).not.toContain(row!.invite_token_hash!);
    const days = (Date.parse(row!.invite_expires_at!) - Date.parse(row!.created_at)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it("she cannot see anything before accepting, or after accepting until he confirms", async () => {
    const inv = await invite(him);
    expect((await viewGet(req(`/api/family/view?link=${inv.id}`, { token: t(her) }))).status).toBe(404);
    const acc = await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    expect(acc.status).toBe(200);
    expect(((await acc.json()) as { next: string }).next).toBe(`/f?link=${inv.id}`);
    const waiting = await viewGet(req(`/api/family/view?link=${inv.id}`, { token: t(her) }));
    expect(waiting.status).toBe(403);
    expect(await waiting.json()).toEqual({ error: "link_not_active" });
    // his card: who accepted, by her name and login
    const mine = ((await (await linksGet(req("/api/family/links", { token: t(him) }))).json()) as { patient: PatientLinkView[] }).patient.find((l) => l.id === inv.id)!;
    expect(mine.state).toBe("accepted");
    expect(mine.her?.displayName).toBe("Wei Ling");
    expect(mine.her?.username).toBe(her.account.username);
    expect((await store.listConsentRecords(her.userId, { kind: "family_accept" })).at(-1)).toMatchObject({ decision: "granted", method: "invite_screen", scope_id: null });
    // he says no: void, she still sees nothing
    expect((await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(him), body: { yes: false } }), params(inv.id))).status).toBe(200);
    expect((await store.getCareLink(inv.id))?.status).toBe("declined");
    expect((await viewGet(req(`/api/family/view?link=${inv.id}`, { token: t(her) }))).status).toBe(403);
  });

  it("a token works once; not for himself; an expired one is 410; a cancelled one is gone", async () => {
    const inv = await invite(him);
    const third = await account("none", "Someone");
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(him), body: { token: inv.token } }))).status).toBe(409);
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(third), body: { token: inv.token } }))).status).toBe(200);
    const again = await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "invite_used" });
    // a token that is not quite right is the same 404 as none
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: `${inv.id}.${"A".repeat(43)}` } }))).status).toBe(404);
    // expired
    const old = newInviteToken();
    await store.createInvite({ id: old.linkId, patient_id: him.userId, family_label: "x", invite_token_hash: old.hash, invite_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: old.token } }))).status).toBe(410);
    // cancelled
    const c = await invite(him);
    expect((await cancelDelete(req(`/api/family/invites/${c.id}`, { token: t(him), method: "DELETE" }), params(c.id))).status).toBe(200);
    expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: c.token } }))).status).toBe(404);
  });

  it("only he confirms and changes switches; she gets 404 from his routes", async () => {
    const inv = await invite(him);
    await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: inv.token } }));
    expect((await confirmPost(req(`/api/family/links/${inv.id}/confirm`, { token: t(her), body: { yes: true } }), params(inv.id))).status).toBe(404);
    expect((await grantsPost(req(`/api/family/links/${inv.id}/grants`, { token: t(her), body: { items: { notes: true } } }), params(inv.id))).status).toBe(404);
    expect((await revokePost(req(`/api/family/links/${inv.id}/revoke`, { token: t(her), body: {} }), params(inv.id))).status).toBe(404);
    expect((await demoGrantsGet(req("/api/family/grants", { token: t(him) }))).status).toBe(404);
  });
});

describe("his switches, her view", () => {
  let him: TestAccount;
  let her: TestAccount;
  let id: string;
  beforeAll(async () => {
    him = await account("example", "陈先生");
    her = await account("none");
    id = await linked(him, her);
  });

  it("confirmed: every switch off, so her home has no section; the consent record is version 1", async () => {
    const home = (await (await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }))).json()) as FamilyHomeData;
    expect(Object.values(home.grants).every((v) => v === false)).toBe(true);
    expect(home).toMatchObject({ status: null, week: null, bp: null, questions: null, noReply: null, visitsShared: false, notesShared: false });
    const consent = (await store.listConsentRecords(him.userId, { kind: "family_share" })).at(-1);
    expect(consent).toMatchObject({ decision: "granted", method: "family_confirm" });
    expect((consent?.evidence as { version: number }).version).toBe(1);
  });

  it("each change is a version, a history row and a consent record; her home shows only what is on: with blood pressure off, not a reading", async () => {
    const r = await grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items: { dose_summary: true, bp_summary: true } } }), params(id));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ version: 2, items: { dose_summary: true, bp_summary: true, notes: false } });
    await grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items: { bp_summary: false, questions_count: true } } }), params(id));
    const g = (await (await grantsGet(req(`/api/family/links/${id}/grants`, { token: t(him) }), params(id))).json()) as { version: number; history: { version: number; turnedOn: string[]; turnedOff: string[] }[] };
    expect(g.version).toBe(3);
    expect(g.history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(g.history[1]).toMatchObject({ turnedOn: ["dose_summary", "bp_summary"], turnedOff: [] });
    expect(g.history[2]).toMatchObject({ turnedOn: ["questions_count"], turnedOff: ["bp_summary"] });
    const consents = (await store.listConsentRecords(him.userId, { kind: "family_share" })).filter((c) => (c.evidence as { link_id?: string })?.link_id === id);
    expect(consents.map((c) => (c.evidence as { version: number }).version)).toEqual([1, 2, 3]);

    const res = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    const raw = await res.text();
    const home = JSON.parse(raw) as FamilyHomeData;
    expect(home.status).not.toBeNull();
    expect(home.week?.days).toHaveLength(7);
    expect(home.bp).toBeNull();
    expect(home.questions).not.toBeNull();
    // The owner's decision of 2026-10-14: a switch that is on shows its kind in full. Blood pressure is off here, so
    // there is still not a reading in what she is sent; his medicine is on, so each medicine's cell says the reason he
    // gave when he did not take it (null where there is none), in her copy's own field: the store's column name and the
    // option's code never leave his space. (It was: never a reading and never a reason, whatever was on.)
    expect(raw).not.toMatch(/systolic|diastolic|"pulse"|reason_text/);
    const cells = home.week!.days.flatMap((d) => d.slots.flatMap((s) => s.cells));
    expect(cells.every((c) => c.reason === null || (c.mark === "missed" && typeof c.reason === "string" && c.reason.length > 0))).toBe(true);
    // questions are on: the waiting ones are worded, as many as are counted (five at most)
    expect(home.questions!.items).toHaveLength(Math.min(5, home.questions!.waiting));
    // the week names each medicine
    const named = home.week!.days.flatMap((d) => d.slots.flatMap((s) => s.cells.map((c) => c.name)));
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((n) => n && n !== "今天早上的药")).toBe(true);
    const week = (await (await weekGet(req(`/api/family/week?link=${id}&offset=-1`, { token: t(her) }))).json()) as { offset: number; days: unknown[] };
    expect(week.offset).toBe(-1);
    expect(week.days).toHaveLength(7);
  });

  it("visits and notes only while their switches are on", async () => {
    type Shared = { visits?: { lines: { speaker: string }[] }[]; notes?: { text: string }[] };
    let shared = (await (await sharedGet(req(`/api/family/shared?link=${id}`, { token: t(her) }))).json()) as Shared;
    expect(shared.visits).toBeUndefined();
    expect(shared.notes).toBeUndefined();
    await grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items: { notes: true, visit_transcripts: true } } }), params(id));
    shared = (await (await sharedGet(req(`/api/family/shared?link=${id}`, { token: t(her) }))).json()) as Shared;
    expect(shared.notes?.length).toBeGreaterThan(0);
    expect(shared.visits?.length).toBeGreaterThan(0);
    expect(shared.visits!.flatMap((v) => v.lines).every((l) => ["doctor", "dispenser", "pharmacist"].includes(l.speaker))).toBe(true);
    await grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items: { notes: false, visit_transcripts: false } } }), params(id));
    expect((await weekGet(req(`/api/family/week?link=${id}`, { token: t(her) }))).status).toBe(200);
  });

  it("her reads write nothing of his: no dose row is settled, only her own access-log rows", async () => {
    const before = (await store.listDoses(him.userId)).length;
    for (let i = 0; i < 3; i++) await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    expect((await store.listDoses(him.userId)).length).toBe(before);
    const access = (await (await accessGet(req(`/api/family/links/${id}/access`, { token: t(him) }), params(id))).json()) as { entries: { route: string; who: string }[] };
    expect(access.entries.length).toBeGreaterThan(0);
    expect(access.entries.every((e) => e.who === "Wei Ling")).toBe(true);
  });
});

describe("stopping and leaving", () => {
  it("his stop closes her stream with care_link.revoked for her link; another link's switches never reach her", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const son = await account("none", "Wei Jie");
    const id = await linked(him, her);
    const sonId = await linked(him, son);
    await grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items: { dose_summary: true } } }), params(id));
    const abort = new AbortController();
    const res = await eventsGet(req(`/api/events?link=${id}`, { token: t(her), signal: abort.signal }));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    // the stream opens with her own switches as they are now (its first frame; the one-second fix round of 10-11)
    const first = await readUntil(reader, "family_grant.changed");
    expect(first).toContain(id);
    expect(first).not.toContain(sonId);
    // the son's switch change is not hers
    await grantsPost(req(`/api/family/links/${sonId}/grants`, { token: t(him), body: { items: { notes: true } } }), params(sonId));
    const marker = publish(him.userId, "dose.logged", "marker", { dose: { medication_id: "med-amlodipine", day: 0, slot: "morning", state: "taken" } });
    let text = await readUntil(reader, `id: ${marker.id}`);
    expect(text).not.toContain("family_grant.changed");
    // he stops sharing with her: the close frame, then the stream ends
    expect((await revokePost(req(`/api/family/links/${id}/revoke`, { token: t(him), body: {} }), params(id))).status).toBe(200);
    text = await readUntil(reader, "care_link.revoked");
    const frame = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "care_link.revoked");
    expect(frame.data).toEqual({ link: { id, status: "revoked", by: "patient" } });
    expect(frame.say).toBe("");
    const end = await reader.read();
    expect(end.done).toBe(true);
    abort.abort();
    // her next request
    const after = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    expect(after.status).toBe(403);
    expect((await eventsGet(req(`/api/events?link=${id}`, { token: t(her) }))).status).toBe(403);
    // his consent is withdrawn, the son still sees his own link
    expect((await store.listConsentRecords(him.userId, { kind: "family_share" })).at(-1)).toMatchObject({ decision: "withdrawn" });
    expect((await viewGet(req(`/api/family/view?link=${sonId}`, { token: t(son) }))).status).toBe(200);
  });

  it("she leaves through her own link: the link ends for both; he sees she left", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none");
    const id = await linked(him, her);
    expect((await leavePost(req(`/api/family/links/${id}/leave?link=${id}`, { token: t(her), body: {} }), params(id))).status).toBe(200);
    expect((await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }))).status).toBe(403);
    const mine = ((await (await linksGet(req("/api/family/links", { token: t(him) }))).json()) as { patient: PatientLinkView[] }).patient.find((l) => l.id === id)!;
    expect(mine.state).toBe("left");
    expect((await store.listConsentRecords(her.userId, { kind: "family_accept" })).at(-1)).toMatchObject({ decision: "withdrawn", method: "family_leave" });
  });
});
